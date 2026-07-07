#!/usr/bin/env python3
"""
Tier-2 test of the vocabulary-sparsity hypothesis (paper.tex tab:vocab).

tab:vocab is a cross-model correlation (n=3, three confounds -- vocab size,
architecture, training data -- vary simultaneously). This script tests the
proposed MECHANISM within a single model instead: if quantization error in a
token's embedding row "doesn't get averaged away" for singleton tokens, then
positions whose target token is a hapax (occurs once in the eval corpus)
should show a larger BF16->q4 NLL increase than positions whose token is
high-frequency, *within the same model* -- no cross-model confounds at all.

Protocol: identical windowing to eval_ppl_wikitext2_cuda.py (512-token
non-overlapping windows, full WikiText-2 test split), but logs PER-TOKEN NLL
(reduction="none") instead of the per-window mean, for both BF16 and our
uniform q4 (RTN, group=64, matching mx.quantize exactly -- same function as
the main eval script). Buckets every scored position by its target token's
GLOBAL frequency in the tokenized corpus, then reports mean(NLL_q4 -
NLL_bf16) per bucket.

Checkpointed per model (resumes on interruption, same pattern as the main
eval scripts). Usage:
  python3 hapax_mechanism_test.py --model Qwen/Qwen2.5-7B-Instruct
"""
import argparse
import json
import os
import sys

import torch
import torch.nn.functional as F
from datasets import load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer

BUCKETS = [(1, 1, "hapax(=1)"), (2, 5, "low(2-5)"), (6, 20, "mid(6-20)"), (21, None, "high(21+)")]


def rtn_affine_quantize_(weight, group_size=64, bits=4):
    assert weight.dim() == 2
    out_f, in_f = weight.shape
    assert in_f % group_size == 0
    w = weight.view(out_f, in_f // group_size, group_size)
    alpha = w.amax(dim=-1, keepdim=True)
    beta = w.amin(dim=-1, keepdim=True)
    levels = (1 << bits) - 1
    s = (alpha - beta) / levels
    s = torch.where(s == 0, torch.ones_like(s), s)
    q = torch.round((w - beta) / s).clamp(0, levels)
    w_hat = q * s + beta
    weight.copy_(w_hat.view(out_f, in_f).to(weight.dtype))


@torch.no_grad()
def quantize_model_(model, group_size=64, bits=4):
    seen = set()
    for _, module in model.named_modules():
        if isinstance(module, (torch.nn.Linear, torch.nn.Embedding)):
            w = module.weight
            if id(w) in seen:
                continue
            seen.add(id(w))
            rtn_affine_quantize_(w.data, group_size, bits)


@torch.no_grad()
def per_token_nlls(model, tokens, device, stride=512, max_length=512,
                    checkpoint_path=None):
    n = len(tokens)
    all_target_ids = []
    all_nlls = []
    resume_from = 0
    if checkpoint_path and os.path.exists(checkpoint_path):
        with open(checkpoint_path) as f:
            ckpt = json.load(f)
        if ckpt.get("done"):
            print(f"  checkpoint already complete ({len(ckpt['target_ids'])} positions)")
            return ckpt["target_ids"], ckpt["nlls"]
        all_target_ids, all_nlls = ckpt["target_ids"], ckpt["nlls"]
        resume_from = ckpt["next_begin"]
        print(f"  resuming from stride {resume_from}/{n}")

    stride_count = 0
    for begin in range(resume_from, n - 1, stride):
        end = min(begin + max_length, n)
        chunk = tokens[begin:end]
        if len(chunk) < 2:
            break
        input_ids = chunk[:-1][None].to(device)
        target_ids = chunk[1:].to(device)
        logits = model(input_ids).logits[0].float()
        # Large-vocab models (Qwen 151936, Llama 128256) OOM on a single
        # whole-window cross_entropy(reduction="none") call on a 16GB card;
        # chunk the loss computation over the sequence dim to cap the extra
        # peak memory it needs beyond the already-materialized logits.
        L = logits.shape[0]
        CE_CHUNK = 128
        nll_parts = []
        for s in range(0, L, CE_CHUNK):
            e = min(s + CE_CHUNK, L)
            nll_parts.append(F.cross_entropy(logits[s:e], target_ids[s:e], reduction="none"))
        nll = torch.cat(nll_parts)
        all_target_ids.extend(target_ids.tolist())
        all_nlls.extend(nll.tolist())
        del logits, nll, nll_parts
        if begin % (stride * 20) == 0:
            torch.cuda.empty_cache()
        stride_count += 1
        sys.stdout.write(f"\r  stride {begin}/{n} ({begin/n*100:.1f}%)")
        sys.stdout.flush()
        if checkpoint_path and stride_count % 50 == 0:
            with open(checkpoint_path, "w") as f:
                json.dump({"target_ids": all_target_ids, "nlls": all_nlls,
                           "next_begin": begin + stride, "n": n}, f)
    print()
    if checkpoint_path:
        with open(checkpoint_path, "w") as f:
            json.dump({"target_ids": all_target_ids, "nlls": all_nlls,
                       "next_begin": n, "n": n, "done": True}, f)
    return all_target_ids, all_nlls


def bucket_stats(target_ids, nlls_bf16, nlls_q4):
    from collections import Counter
    freq = Counter(target_ids)
    out = {}
    for lo, hi, label in BUCKETS:
        idx = [i for i, t in enumerate(target_ids)
               if freq[t] >= lo and (hi is None or freq[t] <= hi)]
        if not idx:
            out[label] = None
            continue
        d = [nlls_q4[i] - nlls_bf16[i] for i in idx]
        out[label] = {"n_positions": len(idx), "n_unique_tokens": len({target_ids[i] for i in idx}),
                       "mean_delta_nll": sum(d) / len(d),
                       "mean_nll_bf16": sum(nlls_bf16[i] for i in idx) / len(idx),
                       "mean_nll_q4": sum(nlls_q4[i] for i in idx) / len(idx)}
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True)
    p.add_argument("--device-map", default="cuda")
    p.add_argument("--stride", type=int, default=512)
    p.add_argument("--max-length", type=int, default=512)
    args = p.parse_args()

    tag = args.model.rstrip("/").split("/")[-1].lower().replace(".", "").replace("-", "_")
    artdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "artifacts")
    ckpt_bf16 = os.path.join(artdir, f"{tag}_hapax_bf16_checkpoint.json")
    ckpt_q4 = os.path.join(artdir, f"{tag}_hapax_q4_checkpoint.json")
    out_path = os.path.join(artdir, f"{tag}_hapax_buckets.json")

    print(f"Loading {args.model} ...")
    tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        args.model, dtype=torch.bfloat16, device_map=args.device_map, trust_remote_code=True)
    model.eval()
    device = next(model.parameters()).device

    ds = load_dataset("Salesforce/wikitext", "wikitext-2-raw-v1", split="test")
    text = "\n\n".join(ds["text"])
    tokens = torch.tensor(tokenizer.encode(text), dtype=torch.long)
    print(f"n_tokens={len(tokens)}")

    print("=== BF16 per-token NLL ===")
    target_ids, nlls_bf16 = per_token_nlls(model, tokens, device, args.stride,
                                            args.max_length, ckpt_bf16)

    if args.device_map != "cuda":
        # RTN on an already GPU/CPU-split model OOMs (large embed/lm_head
        # tensors need working memory beyond what's left on the card); the
        # main eval script's fix applies here too: quantize a *fresh* CPU
        # copy, then dispatch. Free the bf16-pass model first.
        print("=== Applying RTN q4 (fresh CPU load, then re-dispatch) ===")
        del model
        torch.cuda.empty_cache()
        model = AutoModelForCausalLM.from_pretrained(
            args.model, dtype=torch.bfloat16, device_map={"": "cpu"}, trust_remote_code=True)
        model.eval()
        quantize_model_(model)
        from accelerate import dispatch_model, infer_auto_device_map
        device_map = infer_auto_device_map(
            model, max_memory={0: "12GiB", "cpu": "18GiB"},
            no_split_module_classes=model._no_split_modules, dtype=torch.bfloat16)
        model = dispatch_model(model, device_map)
        device = next(model.parameters()).device
    else:
        print("=== Applying RTN q4 (in place) ===")
        quantize_model_(model)

    print("=== q4 per-token NLL ===")
    target_ids_q4, nlls_q4 = per_token_nlls(model, tokens, device, args.stride,
                                             args.max_length, ckpt_q4)
    assert target_ids == target_ids_q4, "bf16/q4 token sequences diverged -- bug"

    stats = bucket_stats(target_ids, nlls_bf16, nlls_q4)
    print(f"\n=== {args.model} bucket results ===")
    for label, s in stats.items():
        if s is None:
            print(f"  {label}: no positions")
        else:
            print(f"  {label:>12}: n_pos={s['n_positions']:>7} n_uniq={s['n_unique_tokens']:>6} "
                  f"mean_dNLL={s['mean_delta_nll']:+.4f}")

    with open(out_path, "w") as f:
        json.dump({"model": args.model, "buckets": stats}, f, indent=2)
    print(f"Saved: {out_path}")


if __name__ == "__main__":
    main()
