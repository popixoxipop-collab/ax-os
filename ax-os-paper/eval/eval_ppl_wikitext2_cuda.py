#!/usr/bin/env python3
"""
Standard WikiText-2 test-set PPL evaluation on CUDA (transformers/PyTorch).
D4 cross-hardware companion to eval_ppl_wikitext2.py (MLX).

Protocol is replicated EXACTLY from the MLX script:
  - wikitext-2-raw-v1 test split, joined with "\n\n", tokenized once
  - windows: begin in range(0, n-1, stride=512), end = min(begin+512, n)
  - per window: input = chunk[:-1], target = chunk[1:],
    loss = cross_entropy(fp32 logits, target, reduction="mean")
  - PPL = exp(mean(window losses))  <- unweighted across windows

Precisions:
  --precision bf16      plain BF16 (baseline)
  --precision q4        RTN affine fake-quant, group=64, bits=4. DEPRECATED
                        for MLX-parity claims: this hand-rolled quantizer
                        was found to diverge from mx.quantize(mode='affine')
                        at 3B (+31.9% vs MLX's +11.7%) despite passing a
                        1.5B-only gate; see HANDOFF_D4_RESULTS.md Sec 2 for
                        the full investigation. For an authoritative,
                        byte-exact MLX-matching comparison, dequantize a
                        real mlx_lm.convert checkpoint instead -- see
                        eval_ppl_wikitext2_cuda_mlxparity.py. This path
                        covers every nn.Linear AND nn.Embedding weight
                        (incl. embed_tokens and lm_head), same coverage as
                        mlx_lm.convert -q, but is kept only as a from-scratch
                        RTN reference point, not an MLX-parity path. Fake
                        quant does NOT save memory (weights stay bf16).
  --precision nf4       bitsandbytes NF4 real 4-bit packing. Scheme exception
                        for models whose BF16 footprint exceeds VRAM (14B).
                        NOT scheme-identical to MLX q4 — document asymmetry.
  --precision awq       Real published AWQ checkpoint (--model must point at
                        the pre-quantized repo id, e.g.
                        Qwen/Qwen2.5-7B-Instruct-AWQ). Requires autoawq.
                        Independent baseline, not scheme-matched to our q4.
  --precision gptq      Real published GPTQ checkpoint (--model must point at
                        the pre-quantized repo id, e.g.
                        Qwen/Qwen2.5-7B-Instruct-GPTQ-Int4). Requires
                        gptqmodel. Independent baseline, not scheme-matched.

Checkpointing: saves NLLs to artifacts/<tag>_ppl_checkpoint.json every 100
strides; resumes automatically if a checkpoint exists.
"""
import argparse
import json
import math
import os
import sys

import torch
import torch.nn.functional as F
from datasets import load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer


def rtn_affine_quantize_(weight: torch.Tensor, group_size: int = 64, bits: int = 4,
                         arith_fp32: bool = False):
    """In-place fake-quantize a 2D weight tensor with hand-rolled affine RTN.

    DEPRECATED for MLX-parity: this diverges from mx.quantize(mode='affine')
    at 3B+ despite passing a 1.5B-only gate (HANDOFF_D4_RESULTS.md Sec 2).
    Kept as a from-scratch RTN reference, not an MLX-matching path -- use
    eval_ppl_wikitext2_cuda_mlxparity.py for byte-exact MLX comparisons.

    arith_fp32 computes scale/round in fp32 (matching MLX kernel precision)
    instead of the weight's bf16 dtype; bf16 division shifts values across
    rounding boundaries and assigns different quantization levels.
    """
    assert weight.dim() == 2, f"expected 2D weight, got {tuple(weight.shape)}"
    out_features, in_features = weight.shape
    assert in_features % group_size == 0, (
        f"in_features={in_features} not divisible by group_size={group_size}"
    )
    w = weight.float() if arith_fp32 else weight
    w = w.view(out_features, in_features // group_size, group_size)
    alpha = w.amax(dim=-1, keepdim=True)
    beta = w.amin(dim=-1, keepdim=True)
    levels = (1 << bits) - 1  # 15 for 4-bit
    s = (alpha - beta) / levels
    s = torch.where(s == 0, torch.ones_like(s), s)  # avoid /0 on constant groups
    q = torch.round((w - beta) / s).clamp(0, levels)
    w_hat = q * s + beta
    weight.copy_(w_hat.view(out_features, in_features).to(weight.dtype))


@torch.no_grad()
def quantize_model_(model, group_size: int = 64, bits: int = 4, arith_fp32: bool = False):
    """Fake-quantize every Linear/Embedding weight (embed_tokens + lm_head included).

    Tied embed/lm_head share one Parameter; RTN is idempotent so visiting the
    shared tensor twice is a no-op. Attention .bias vectors are left untouched
    (mlx_lm.convert does not quantize them either).
    """
    seen = set()
    count = 0
    for name, module in model.named_modules():
        if isinstance(module, (torch.nn.Linear, torch.nn.Embedding)):
            w = module.weight
            if id(w) in seen:
                continue
            seen.add(id(w))
            rtn_affine_quantize_(w.data, group_size, bits, arith_fp32)
            count += 1
    print(f"  fake-quantized {count} weight tensors (RTN affine g={group_size} b={bits} "
          f"arith={'fp32' if arith_fp32 else 'native'})")


@torch.no_grad()
def eval_wikitext2_ppl(model, tokenizer, device, stride=512, max_length=512,
                       checkpoint_path=None):
    # "Salesforce/wikitext" is the canonical id required by datasets>=3;
    # identical content to the bare "wikitext" id the MLX script loads.
    ds = load_dataset("Salesforce/wikitext", "wikitext-2-raw-v1", split="test")
    text = "\n\n".join(ds["text"])
    encodings = tokenizer.encode(text)
    tokens = torch.tensor(encodings, dtype=torch.long)
    n = len(tokens)

    nlls = []
    resume_from = 0
    if checkpoint_path and os.path.exists(checkpoint_path):
        with open(checkpoint_path) as f:
            ckpt = json.load(f)
        if ckpt.get("done"):
            print(f"  Checkpoint already complete: PPL={ckpt['ppl']:.4f}")
            return ckpt["ppl"]
        nlls = ckpt["nlls"]
        resume_from = ckpt["next_begin"]
        print(f"  Resuming from stride {resume_from}/{n} ({len(nlls)} strides done)")

    stride_count = 0
    for begin in range(resume_from, n - 1, stride):
        end = min(begin + max_length, n)
        chunk = tokens[begin:end]
        if len(chunk) < 2:
            break
        input_ids = chunk[:-1][None].to(device)   # (1, L-1)
        target_ids = chunk[1:].to(device)          # (L-1,)
        logits = model(input_ids).logits[0]        # (L-1, vocab)
        logits = logits.float()
        loss = F.cross_entropy(logits, target_ids, reduction="mean")
        nlls.append(loss.item())
        stride_count += 1
        sys.stdout.write(f"\r  stride {begin}/{n}  ({begin/n*100:.1f}%)")
        sys.stdout.flush()

        if checkpoint_path and stride_count % 100 == 0:
            next_begin = begin + stride
            with open(checkpoint_path, "w") as f:
                json.dump({"nlls": nlls, "next_begin": next_begin, "n": n}, f)

    print()
    ppl = math.exp(sum(nlls) / len(nlls))

    if checkpoint_path:
        with open(checkpoint_path, "w") as f:
            json.dump({"nlls": nlls, "next_begin": n, "n": n, "ppl": ppl, "done": True}, f)

    return ppl


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="HF repo id or local path")
    parser.add_argument("--precision", choices=["bf16", "q4", "nf4", "awq", "gptq"], default="bf16")
    parser.add_argument("--stride", type=int, default=512)
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--group-size", type=int, default=64)
    parser.add_argument("--bits", type=int, default=4)
    parser.add_argument("--quant-arith", choices=["native", "fp32"], default="native",
                        help="dtype for computing quantization scales/levels")
    parser.add_argument("--device-map", default="cuda",
                        help="'cuda' (default) or 'auto' for CPU offload of oversized models")
    parser.add_argument("--checkpoint", default=None,
                        help="checkpoint JSON path (default: artifacts/<tag>_ppl_checkpoint.json)")
    parser.add_argument("--no-checkpoint", action="store_true")
    args = parser.parse_args()

    tag = args.model.rstrip("/").split("/")[-1].lower().replace(".", "").replace("-", "_")
    checkpoint_path = None
    if not args.no_checkpoint:
        checkpoint_path = args.checkpoint or os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "..", "artifacts",
            f"{tag}_cuda_{args.precision}_ppl_checkpoint.json")
        checkpoint_path = os.path.abspath(checkpoint_path)
        print(f"Checkpoint: {checkpoint_path}")

    print(f"Loading {args.model} [{args.precision}] ...")
    tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)

    load_kwargs = dict(device_map=args.device_map, trust_remote_code=True)
    if args.precision in ("bf16", "q4"):
        # awq/gptq checkpoints define their own storage dtype internally;
        # forcing bf16 here would fight the pre-quantized config.
        load_kwargs["dtype"] = torch.bfloat16
    if args.precision == "nf4":
        from transformers import BitsAndBytesConfig
        load_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
        )
    if args.precision == "q4" and args.device_map != "cuda":
        # Quantizing GPU-resident weights on a VRAM-full card crashes; for
        # offloaded models, load on CPU, fake-quant there, then dispatch.
        load_kwargs["device_map"] = {"": "cpu"}
        model = AutoModelForCausalLM.from_pretrained(args.model, **load_kwargs)
        model.eval()
        print("Applying RTN affine fake-quant on CPU ...")
        quantize_model_(model, args.group_size, args.bits,
                        arith_fp32=(args.quant_arith == "fp32"))
        from accelerate import dispatch_model, infer_auto_device_map
        device_map = infer_auto_device_map(
            model, max_memory={0: "12GiB", "cpu": "18GiB"},
            no_split_module_classes=model._no_split_modules, dtype=torch.bfloat16)
        model = dispatch_model(model, device_map)
    else:
        model = AutoModelForCausalLM.from_pretrained(args.model, **load_kwargs)
        model.eval()
        if args.precision == "q4":
            print("Applying RTN affine fake-quant ...")
            quantize_model_(model, args.group_size, args.bits,
                            arith_fp32=(args.quant_arith == "fp32"))

    device = next(model.parameters()).device
    print("Evaluating WikiText-2 test PPL ...")
    ppl = eval_wikitext2_ppl(model, tokenizer, device, stride=args.stride,
                             max_length=args.max_length,
                             checkpoint_path=checkpoint_path)
    print(f"PPL = {ppl:.4f}")


if __name__ == "__main__":
    main()
