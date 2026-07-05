#!/usr/bin/env python3
"""
Paired bootstrap CI on WikiText-2 delta-PPL for the D4 CUDA cross-hardware
checkpoints (which log per-window NLLs, unlike the original MLX runs).

For each model, resamples window indices with replacement (same indices
applied to both the bf16 and q4/nf4 NLL arrays, since both conditions were
evaluated on the identical token stream/windows), recomputing PPL for each
resample. Reports point estimate + 95% percentile CI for PPL_bf16, PPL_q4,
and deltaPPL% = (PPL_q4 - PPL_bf16) / PPL_bf16 * 100.
"""
import json
import math
import os
import sys

import numpy as np

ART = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "artifacts")

PAIRS = [
    ("Qwen2.5-1.5B", "qwen25_15b_instruct_cuda_bf16_ppl_checkpoint.json",
     "qwen25_15b_instruct_cuda_q4mlx_ppl_checkpoint.json"),
    ("Qwen2.5-3B", "qwen25_3b_instruct_cuda_bf16_ppl_checkpoint.json",
     "qwen25_3b_instruct_cuda_q4mlx_ppl_checkpoint.json"),
    ("Qwen2.5-7B", "qwen25_7b_instruct_cuda_bf16_ppl_checkpoint.json",
     "qwen25_7b_instruct_cuda_q4mlx_ppl_checkpoint.json"),
    ("Mistral-7B", "mistral_7b_instruct_v03_cuda_bf16_ppl_checkpoint.json",
     "mistral_7b_instruct_v03_cuda_q4mlx_ppl_checkpoint.json"),
    ("Llama-3.1-8B", "llama_31_8b_instruct_cuda_bf16_ppl_checkpoint.json",
     "llama_31_8b_instruct_cuda_q4mlx_ppl_checkpoint.json"),
    ("Qwen2.5-14B (NF4)", "qwen25_14b_instruct_cuda_bf16_ppl_checkpoint.json",
     "qwen25_14b_instruct_cuda_nf4_ppl_checkpoint.json"),
]

N_BOOT = 10000
RNG_SEED = 20260706


def load_nlls(fname):
    path = os.path.join(ART, fname)
    with open(path) as f:
        d = json.load(f)
    if not d.get("done"):
        raise RuntimeError(f"{fname} not marked done")
    return np.array(d["nlls"], dtype=np.float64)


def ppl_from_nlls(nlls):
    return math.exp(nlls.mean())


def paired_bootstrap(nlls_a, nlls_b, n_boot=N_BOOT, seed=RNG_SEED):
    assert len(nlls_a) == len(nlls_b), f"length mismatch {len(nlls_a)} vs {len(nlls_b)}"
    n = len(nlls_a)
    rng = np.random.default_rng(seed)
    ppl_a0 = ppl_from_nlls(nlls_a)
    ppl_b0 = ppl_from_nlls(nlls_b)
    dpct0 = (ppl_b0 - ppl_a0) / ppl_a0 * 100

    boot_dpct = np.empty(n_boot)
    boot_ppl_a = np.empty(n_boot)
    boot_ppl_b = np.empty(n_boot)
    for i in range(n_boot):
        idx = rng.integers(0, n, size=n)
        pa = math.exp(nlls_a[idx].mean())
        pb = math.exp(nlls_b[idx].mean())
        boot_ppl_a[i] = pa
        boot_ppl_b[i] = pb
        boot_dpct[i] = (pb - pa) / pa * 100

    def ci(x):
        return np.percentile(x, [2.5, 97.5])

    return {
        "n_windows": n,
        "ppl_a": ppl_a0, "ppl_a_ci": ci(boot_ppl_a).tolist(),
        "ppl_b": ppl_b0, "ppl_b_ci": ci(boot_ppl_b).tolist(),
        "dpct": dpct0, "dpct_ci": ci(boot_dpct).tolist(),
    }


def main():
    results = {}
    print(f"{'Model':<20} {'n':>5} {'PPL bf16':>10} {'PPL q4':>10} "
          f"{'dPPL%':>9} {'95% CI (pp)':>18}")
    for label, fa, fb in PAIRS:
        try:
            nlls_a = load_nlls(fa)
            nlls_b = load_nlls(fb)
        except Exception as e:
            print(f"{label:<20}  SKIP ({e})")
            continue
        r = paired_bootstrap(nlls_a, nlls_b)
        results[label] = r
        lo, hi = r["dpct_ci"]
        print(f"{label:<20} {r['n_windows']:>5} {r['ppl_a']:>10.4f} {r['ppl_b']:>10.4f} "
              f"{r['dpct']:>+8.2f}% [{lo:>+.2f}, {hi:>+.2f}]")

    out_path = os.path.join(ART, "bootstrap_ci_results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved: {out_path}")


if __name__ == "__main__":
    main()
