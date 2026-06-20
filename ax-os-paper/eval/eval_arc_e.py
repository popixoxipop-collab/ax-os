#!/usr/bin/env python3
"""
ARC-Easy full test split evaluation using MLX models (NLL/token scoring).
n=2376 → CI ±2.0pp (95%), much tighter than HellaSwag n=400 ±4.1pp.

Usage: python eval_arc_e.py <model_path> <label>
"""
import sys, os, json, math
import mlx.core as mx
import mlx.nn as nn
import numpy as np
from mlx_lm.utils import load
from datasets import load_dataset

def compute_nll_per_token(model, tokenizer, ctx, completion):
    ctx_ids  = tokenizer.encode(ctx)
    full_ids = tokenizer.encode(ctx + completion)
    if len(full_ids) <= len(ctx_ids):
        return float('inf')
    inp  = mx.array(full_ids[:-1])[None]
    tgt  = full_ids[1:]
    logits = model(inp)[0].astype(mx.float32)
    mx.eval(logits)
    lsm  = logits - mx.logsumexp(logits, axis=-1, keepdims=True)
    lsm_np = np.array(lsm)
    start = len(ctx_ids) - 1
    comp_tgt = tgt[start:]
    comp_lsm = lsm_np[start:]
    if len(comp_tgt) == 0:
        return float('inf')
    nll = -sum(float(comp_lsm[i, t]) for i, t in enumerate(comp_tgt))
    return nll / len(comp_tgt)

def evaluate(model_path, label):
    print(f"\nLoading: {model_path}", flush=True)
    model, tokenizer = load(model_path)

    print("Loading ARC-Easy test split...", flush=True)
    ds = load_dataset("allenai/ai2_arc", "ARC-Easy", split="test")
    n = len(ds)
    print(f"n={n} examples", flush=True)

    correct = 0
    for step in range(n):
        ex = ds[step]
        ctx   = ex["question"]
        choices = ex["choices"]
        labels  = choices["label"]
        texts   = choices["text"]
        answer  = ex["answerKey"]

        # Build option map: A/B/C/D → text
        opts = dict(zip(labels, texts))
        opt_keys = list(opts.keys())
        opt_texts = [opts[k] for k in opt_keys]

        nlls = [compute_nll_per_token(model, tokenizer, ctx + " ", t) for t in opt_texts]
        pred_key = opt_keys[int(np.argmin(nlls))]
        if pred_key == answer:
            correct += 1

        if (step + 1) % 100 == 0:
            print(f"  {step+1}/{n}  acc={correct/(step+1):.4f}", flush=True)

    acc = correct / n
    ci  = 1.96 * math.sqrt(acc * (1 - acc) / n)
    print(f"\n=== RESULT ===")
    print(f"model={label}  n={n}  acc={acc:.4f} ({acc*100:.1f}%)  CI±{ci*100:.1f}pp")
    return {"model": label, "n": n, "accuracy": round(acc, 4), "ci_95pp": round(ci * 100, 1)}

if __name__ == "__main__":
    model_path = sys.argv[1]
    label      = sys.argv[2] if len(sys.argv) > 2 else os.path.basename(model_path)
    result = evaluate(model_path, label)
    out = f"/tmp/arc_e_{label.replace('/', '_').replace(' ', '_')}.json"
    with open(out, "w") as f:
        json.dump(result, f)
    print(f"Saved: {out}")
