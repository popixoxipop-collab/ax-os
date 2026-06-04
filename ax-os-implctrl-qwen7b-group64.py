#!/usr/bin/env python3
"""Implementation-difference control: Qwen2.5-7B local q4 (group 64).

Paper limitation (sec:results:limits): the Qwen q4 artifacts came from
mlx-community (group size unspecified) while Mistral q4 was produced locally
with mlx_lm.convert (group size 64). The +14.3% (Qwen) vs +3.9% (Mistral)
ΔPPL gap could be an artifact of that pipeline difference, not architecture.

This control re-quantizes the SAME Qwen2.5-7B bf16 with the IDENTICAL local
pipeline used for Mistral (q_bits=4, q_group_size=64) and re-measures
WikiText-2 PPL. Decision rule:
  - local ΔPPL ≈ +14%  → implementation confound ruled OUT, arch claim HOLDS
  - local ΔPPL ≈ +4%   → headline gap was a quantization-pipeline artifact

Reuses compute_perplexity / get_wikitext2_tokens from ax-os-wikitext2-eval.py
so the protocol is byte-identical to the published numbers. (CLAUDE.md §13)

Run:  PYTHONUNBUFFERED=1 python3 ax-os-implctrl-qwen7b-group64.py
"""
import os, sys, json, time, importlib.util
from pathlib import Path

import mlx.core as mx
from mlx_lm import convert, load

# ── reuse the exact eval protocol from the published script ──────────────────
_spec = importlib.util.spec_from_file_location(
    "wikieval", str(Path.home() / "ax-os-wikitext2-eval.py"))
wikieval = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(wikieval)

SRC_BF16 = "mlx-community/Qwen2.5-7B-Instruct-bf16"          # same source as published bf16 ppl
Q4_LOCAL = str(Path.home() / "Desktop/AEQ/models/qwen2.5-7b-q4-group64-local")
OUT      = str(Path.home() / "ax-os-implctrl-qwen7b-group64-result.json")

# Published reference numbers (ax-os-wikitext2-results.json)
QWEN7B_BF16_PPL        = 9.2154    # mlx-community/Qwen2.5-7B-Instruct-bf16
QWEN7B_Q4_MLXCOMM_PPL  = 10.5298   # mlx-community/Qwen2.5-7B-Instruct-4bit (group size unspecified)
MISTRAL7B_DEG          = 3.87      # cross-arch reference, %

MAX_TOKENS = 200_000
SEQ_LEN    = 512


def safetensors_mb(path: str) -> float:
    import glob
    total = sum(os.path.getsize(f) for f in glob.glob(os.path.join(path, "*.safetensors")))
    return round(total / 1e6, 1)


def main():
    os.makedirs(Path(Q4_LOCAL).parent, exist_ok=True)

    # ── 1. convert with the IDENTICAL local pipeline used for Mistral ────────
    if not (Path(Q4_LOCAL) / "config.json").exists():
        print(f"[convert] {SRC_BF16} -> {Q4_LOCAL} (q_bits=4, q_group_size=64)", flush=True)
        t0 = time.time()
        convert(SRC_BF16, mlx_path=Q4_LOCAL, quantize=True, q_bits=4, q_group_size=64)
        print(f"[convert] done in {time.time()-t0:.0f}s", flush=True)
    else:
        print(f"[convert] reuse existing artifact at {Q4_LOCAL}", flush=True)
    q4_mb = safetensors_mb(Q4_LOCAL)

    # ── 2. eval WikiText-2 with the published protocol ──────────────────────
    print(f"[eval] loading local q4 artifact...", flush=True)
    t0 = time.time()
    model, tokenizer = load(Q4_LOCAL)
    model.eval()
    tokens = wikieval.get_wikitext2_tokens(tokenizer, max_tokens=MAX_TOKENS)
    ppl, n_tokens = wikieval.compute_perplexity(model, tokens, seq_len=SEQ_LEN)
    elapsed = time.time() - t0
    print(f"[eval] local-q4-group64 ppl={ppl:.4f}  tokens={n_tokens:,}  elapsed={elapsed:.0f}s", flush=True)

    # ── 3. verdict ──────────────────────────────────────────────────────────
    deg_local   = (ppl - QWEN7B_BF16_PPL) / QWEN7B_BF16_PPL * 100
    deg_mlxcomm = (QWEN7B_Q4_MLXCOMM_PPL - QWEN7B_BF16_PPL) / QWEN7B_BF16_PPL * 100
    # confound contribution = how much of the published gap is explained by pipeline
    if abs(deg_mlxcomm - MISTRAL7B_DEG) > 1e-6:
        pipeline_share = (deg_mlxcomm - deg_local) / (deg_mlxcomm - MISTRAL7B_DEG) * 100
    else:
        pipeline_share = 0.0

    verdict = ("CONFOUND_RULED_OUT — arch-dominates-scale HOLDS"
               if deg_local >= 10.0 else
               "PIPELINE_ARTIFACT — headline gap shrinks under identical pipeline"
               if deg_local <= 6.0 else
               "PARTIAL — pipeline explains part of the gap")

    payload = {
        "experiment": "implementation-difference control (Qwen2.5-7B q4 group64 local)",
        "source_bf16": SRC_BF16,
        "local_artifact": Q4_LOCAL,
        "local_q4_size_mb": q4_mb,
        "pipeline": "mlx_lm.convert q_bits=4 q_group_size=64 (identical to Mistral)",
        "platform": f"MLX {mx.__version__}, Apple Silicon",
        "dataset": "wikitext-2-raw-v1/test",
        "seq_len": SEQ_LEN,
        "n_tokens": n_tokens,
        "elapsed_s": round(elapsed, 1),
        "ppl": {
            "qwen7b_bf16": QWEN7B_BF16_PPL,
            "qwen7b_q4_mlxcommunity": QWEN7B_Q4_MLXCOMM_PPL,
            "qwen7b_q4_local_group64": round(ppl, 4),
        },
        "deg_pct": {
            "mlxcommunity_q4": round(deg_mlxcomm, 2),
            "local_q4_group64": round(deg_local, 2),
            "mistral7b_crossarch": MISTRAL7B_DEG,
        },
        "pipeline_explains_pct_of_gap": round(pipeline_share, 1),
        "verdict": verdict,
    }
    Path(OUT).write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    print("\n" + "=" * 60, flush=True)
    print(json.dumps(payload, indent=2, ensure_ascii=False), flush=True)
    print(f"\n[done] wrote {OUT}", flush=True)


if __name__ == "__main__":
    main()
