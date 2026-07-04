#!/usr/bin/env python3
"""
WikiText-2 PPL on CUDA using weights dequantized from a REAL mlx_lm.convert -q
checkpoint. This removes all reimplementation ambiguity: the q4 weights are
exactly what MLX computes (mx.dequantize is the authoritative inverse), and
only the hardware executing the matmuls differs.

Memory: the HF model is loaded first and MLX tensors are dequantized and
injected ONE AT A TIME (a whole-model fp32 dict peaks >32GB for 7B and gets
OOM-killed in a 31GB WSL VM).

Usage:
  python3 eval_ppl_wikitext2_cuda_mlxparity.py \
    --hf-model Qwen/Qwen2.5-3B-Instruct --mlx-dir /path/to/mlx_q4_dir \
    [--device-map cuda|auto] [--checkpoint path.json]
"""
import argparse
import glob
import json
import math
import os
import sys

import mlx.core as mx
import numpy as np
import torch
import torch.nn.functional as F
from datasets import load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer


@torch.no_grad()
def inject_mlx_dequantized(model, mlx_dir):
    """Dequantize each MLX q4 tensor and copy it into the HF model, streaming."""
    cfg = json.load(open(os.path.join(mlx_dir, "config.json")))
    qcfg = cfg.get("quantization", {})
    gs, bits = qcfg.get("group_size", 64), qcfg.get("bits", 4)
    mode = qcfg.get("mode", "affine")
    print(f"  mlx quantization: group_size={gs} bits={bits} mode={mode}", flush=True)
    sd = model.state_dict()
    injected, missing = 0, []
    for f in sorted(glob.glob(os.path.join(mlx_dir, "*.safetensors"))):
        tensors = mx.load(f)
        qnames = [n for n in tensors
                  if n.endswith(".weight") and n[:-7] + ".scales" in tensors]
        for name in qnames:
            base = name[:-7]
            w_hat = mx.dequantize(tensors[name], tensors[base + ".scales"],
                                  tensors[base + ".biases"], group_size=gs,
                                  bits=bits, mode=mode)
            w32 = np.array(w_hat.astype(mx.float32))
            del w_hat
            if name in sd:
                assert sd[name].shape == tuple(w32.shape), f"shape mismatch {name}"
                sd[name].copy_(torch.from_numpy(w32).to(torch.bfloat16))
                injected += 1
            else:
                missing.append(name)
            del w32
        del tensors
        mx.clear_cache()
    if missing:
        print(f"  WARNING: {len(missing)} mlx tensors had no HF match: {missing[:5]}",
              flush=True)
    print(f"  injected {injected} dequantized tensors "
          f"(tie_word_embeddings={model.config.tie_word_embeddings})", flush=True)


@torch.no_grad()
def eval_ppl(model, tokenizer, stride=512, max_length=512, checkpoint_path=None):
    ds = load_dataset("Salesforce/wikitext", "wikitext-2-raw-v1", split="test")
    text = "\n\n".join(ds["text"])
    tokens = torch.tensor(tokenizer.encode(text), dtype=torch.long)
    n = len(tokens)
    device = next(model.parameters()).device

    nlls, resume_from = [], 0
    if checkpoint_path and os.path.exists(checkpoint_path):
        ckpt = json.load(open(checkpoint_path))
        if ckpt.get("done"):
            print(f"  Checkpoint already complete: PPL={ckpt['ppl']:.4f}", flush=True)
            return ckpt["ppl"]
        nlls, resume_from = ckpt["nlls"], ckpt["next_begin"]
        print(f"  Resuming from stride {resume_from}/{n}", flush=True)

    count = 0
    for begin in range(resume_from, n - 1, stride):
        chunk = tokens[begin:min(begin + max_length, n)]
        if len(chunk) < 2:
            break
        logits = model(chunk[:-1][None].to(device)).logits[0].float()
        nlls.append(F.cross_entropy(logits, chunk[1:].to(device),
                                    reduction="mean").item())
        count += 1
        sys.stdout.write(f"\r  stride {begin}/{n}  ({begin/n*100:.1f}%)")
        sys.stdout.flush()
        if checkpoint_path and count % 100 == 0:
            json.dump({"nlls": nlls, "next_begin": begin + stride, "n": n},
                      open(checkpoint_path, "w"))
    print(flush=True)
    ppl = math.exp(sum(nlls) / len(nlls))
    if checkpoint_path:
        json.dump({"nlls": nlls, "next_begin": n, "n": n, "ppl": ppl,
                   "done": True}, open(checkpoint_path, "w"))
    return ppl


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--hf-model", required=True)
    p.add_argument("--mlx-dir", required=True)
    p.add_argument("--device-map", default="cuda")
    p.add_argument("--checkpoint", default=None)
    args = p.parse_args()

    # Short-circuit BEFORE loading anything if the checkpoint is complete.
    if args.checkpoint and os.path.exists(args.checkpoint):
        ckpt = json.load(open(args.checkpoint))
        if ckpt.get("done"):
            print(f"  Checkpoint already complete: PPL={ckpt['ppl']:.4f}")
            print(f"PPL = {ckpt['ppl']:.4f}")
            return

    print(f"Loading {args.hf_model} on CPU ...", flush=True)
    # device_map={"": "cpu"} loads shard-by-shard (low_cpu_mem_usage path);
    # an eager full load bursts ~2x model size of host RAM and gets the whole
    # WSL VM killed under host memory pressure.
    model = AutoModelForCausalLM.from_pretrained(
        args.hf_model, dtype=torch.bfloat16, trust_remote_code=True,
        device_map={"": "cpu"})
    model.eval()

    print(f"Injecting dequantized MLX q4 weights from {args.mlx_dir} ...", flush=True)
    inject_mlx_dequantized(model, args.mlx_dir)

    if args.device_map == "cuda":
        model = model.cuda()
    else:
        from accelerate import dispatch_model, infer_auto_device_map
        dm = infer_auto_device_map(model, max_memory={0: "12GiB", "cpu": "18GiB"},
                                   no_split_module_classes=model._no_split_modules,
                                   dtype=torch.bfloat16)
        model = dispatch_model(model, dm)

    tokenizer = AutoTokenizer.from_pretrained(args.hf_model, trust_remote_code=True)
    print("Evaluating WikiText-2 test PPL ...", flush=True)
    ppl = eval_ppl(model, tokenizer, checkpoint_path=args.checkpoint)
    print(f"PPL = {ppl:.4f}")


if __name__ == "__main__":
    main()
