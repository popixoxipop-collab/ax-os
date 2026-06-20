#!/usr/bin/env python3
"""
Hapax-vocabulary ablation: split WikiText-2 test into high-hapax and low-hapax
512-token chunks (using Qwen tiktoken tokenizer), then run PPL for both
Qwen-7B (bf16, q4) and Mistral-7B (bf16, q4) on each subset.

If DELTA-PPL is larger in the high-hapax subset, the vocabulary mechanism is supported.
"""
import json
import math
import os
import sys
from collections import Counter

import mlx.core as mx
import mlx.nn as nn
import numpy as np
from datasets import load_dataset
from mlx_lm.utils import load

QWEN7B_BF16 = "mlx-community/Qwen2.5-7B-Instruct-bf16"
QWEN7B_Q4   = os.path.expanduser("~/ax-os-paper/path_a_artifacts/qwen7b_q4_local")
MISTRAL_Q4  = os.path.expanduser("~/ax-os-paper/path_a_artifacts/mistral7b_q4_local")
MISTRAL_BF16 = "mistralai/Mistral-7B-Instruct-v0.3"

STRIDE = 512
TOP_FRAC = 0.25  # top-25% = high-hapax, bottom-25% = low-hapax

OUT = os.path.expanduser("~/ax-os-paper/hapax_ablation_results.json")

def chunk_ppl(model, token_chunks):
    """Compute average PPL over a list of token-ID lists (each ≥2 tokens)."""
    nlls = []
    for i, chunk in enumerate(token_chunks):
        if len(chunk) < 2:
            continue
        inp = mx.array(chunk[:-1])[None]
        tgt = mx.array(chunk[1:])
        logits = model(inp)[0].astype(mx.float32)
        loss = nn.losses.cross_entropy(logits, tgt, reduction="mean")
        mx.eval(loss)
        nlls.append(loss.item())
        if (i + 1) % 50 == 0:
            print(f"  chunk {i+1}/{len(token_chunks)}  running_ppl={math.exp(sum(nlls)/len(nlls)):.3f}")
    mean_nll = sum(nlls) / len(nlls)
    return math.exp(mean_nll)


def build_subsets(tokenizer_name="qwen"):
    ds = load_dataset("wikitext", "wikitext-2-raw-v1", split="test")
    text = "\n\n".join(ds["text"])

    # Load a tokenizer just for splitting (use tiktoken via mlx_lm tokenizer)
    from mlx_lm.utils import load as lm_load
    print("Loading tokenizer for subset construction...")
    _, tok = lm_load(QWEN7B_Q4)  # just tokenizer, no weights loaded here
    ids = tok.encode(text)
    n = len(ids)
    print(f"Total tokens (Qwen tokenizer): {n}")

    # Count global token frequencies
    freq = Counter(ids)
    hapax_set = {t for t, c in freq.items() if c == 1}
    print(f"Hapax tokens: {len(hapax_set)} / {len(freq)} unique")

    # Build 512-token chunks and compute per-chunk hapax fraction
    chunks = []
    chunk_hapax = []
    for begin in range(0, n - 1, STRIDE):
        end = min(begin + STRIDE, n)
        c = ids[begin:end]
        if len(c) < 8:
            continue
        hfrac = sum(1 for t in c if t in hapax_set) / len(c)
        chunks.append(c)
        chunk_hapax.append(hfrac)

    total = len(chunks)
    k = int(total * TOP_FRAC)
    ranked = sorted(range(total), key=lambda i: chunk_hapax[i])
    low_idx  = set(ranked[:k])
    high_idx = set(ranked[-k:])

    low_chunks  = [chunks[i] for i in range(total) if i in low_idx]
    high_chunks = [chunks[i] for i in range(total) if i in high_idx]

    mean_low  = sum(chunk_hapax[i] for i in range(total) if i in low_idx) / k
    mean_high = sum(chunk_hapax[i] for i in range(total) if i in high_idx) / k
    print(f"Low-hapax subset:  {k} chunks, mean hapax-frac={mean_low:.3f}")
    print(f"High-hapax subset: {k} chunks, mean hapax-frac={mean_high:.3f}")
    return low_chunks, high_chunks, mean_low, mean_high


def run_model(path, label, low_chunks, high_chunks):
    print(f"\n{'='*60}")
    print(f"Model: {label}")
    print(f"{'='*60}")
    print("Loading model...")
    model, _ = load(path)

    print("\n[LOW-HAPAX]")
    ppl_low = chunk_ppl(model, low_chunks)
    print(f"  PPL low-hapax: {ppl_low:.4f}")

    print("\n[HIGH-HAPAX]")
    ppl_high = chunk_ppl(model, high_chunks)
    print(f"  PPL high-hapax: {ppl_high:.4f}")

    del model
    mx.metal.clear_cache() if hasattr(mx, 'metal') else None
    return {"label": label, "ppl_low": round(ppl_low, 4), "ppl_high": round(ppl_high, 4)}


if __name__ == "__main__":
    low_chunks, high_chunks, mean_low, mean_high = build_subsets()

    results = []
    # Qwen 7B Q4
    results.append(run_model(QWEN7B_Q4, "Qwen2.5-7B-q4", low_chunks, high_chunks))
    # Qwen 7B BF16
    results.append(run_model(QWEN7B_BF16, "Qwen2.5-7B-bf16", low_chunks, high_chunks))
    # Mistral Q4
    results.append(run_model(MISTRAL_Q4, "Mistral-7B-q4", low_chunks, high_chunks))
    # Mistral BF16 (HF format, mlx_lm auto-loads)
    try:
        results.append(run_model(MISTRAL_BF16, "Mistral-7B-bf16", low_chunks, high_chunks))
    except Exception as e:
        print(f"Mistral BF16 failed: {e}")

    # Compute DELTA-PPL ratios
    summary = {
        "protocol": "hapax-ablation, top/bottom 25% chunks by hapax-fraction (Qwen tokenizer)",
        "chunk_stride": STRIDE,
        "n_chunks_per_subset": int(len(low_chunks)),
        "mean_hapax_frac_low": round(mean_low, 4),
        "mean_hapax_frac_high": round(mean_high, 4),
        "results": results
    }

    # Compute delta-ppl for paired models
    by_label = {r["label"]: r for r in results}
    for arch in ["Qwen2.5-7B", "Mistral-7B"]:
        q4 = by_label.get(f"{arch}-q4")
        bf16 = by_label.get(f"{arch}-bf16")
        if q4 and bf16:
            d_low  = (q4["ppl_low"]  - bf16["ppl_low"])  / bf16["ppl_low"]  * 100
            d_high = (q4["ppl_high"] - bf16["ppl_high"]) / bf16["ppl_high"] * 100
            print(f"\n{arch}: DELTA_PPL low={d_low:+.2f}%  high={d_high:+.2f}%")
            summary[f"delta_ppl_{arch}"] = {"low": round(d_low, 2), "high": round(d_high, 2)}

    with open(OUT, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"\nResults saved to {OUT}")
