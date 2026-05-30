#!/usr/bin/env python3
"""AEQ q4 compression + benchmark for Mistral-7B-Instruct-v0.3 (MLX).

Mirrors the 2026-05-30 methodology (ax-os-aeq-benchmark-2026-05-30.json):
measure size / perplexity (fixed eval text) / tok-s for a base vs quantized model.

Scheme = MEASURED-best from the 2026-05-30 Qwen2.5-1.5B run: uniform q4 (group 64).
That run showed uniform q4 beats mixed-precision on BOTH size and quality for dense
models; mixed-precision is only a hypothesis for large MoE. So this real compression
uses the data-backed scheme, not an unvalidated mixed recipe. (CLAUDE.md §13)

Output: registerable q4 artifact + JSON result for ax-os AEQIntegration.
Run:  PYTHONUNBUFFERED=1 python3 aeq_compress_mistral_q4.py
"""
import os, json, time, glob, gc
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
from mlx_lm import convert, load, generate

SRC   = "mistralai/Mistral-7B-Instruct-v0.3"
Q4    = str(Path.home() / "Desktop/AEQ/models/mistral-7b-v0.3-q4")
OUT   = str(Path.home() / "Desktop/AEQ/aeq_mistral7b_q4_result.json")
AXOUT = str(Path.home() / "ax-os-aeq-mistral7b-q4-result.json")

# Fixed eval text — quantization-themed paragraph (same theme as the 2026-05-30 run)
EVAL_TEXT = (
    "Quantization reduces the numerical precision of neural network weights "
    "to shrink model size and accelerate inference. Mixed-precision schemes "
    "assign more bits to sensitive layers and fewer bits to redundant ones, "
    "trading accuracy for compression."
)
GEN_PROMPT = "Explain neural network quantization in one sentence."
GEN_TOKENS = 64


def safetensors_mb(path: str) -> float:
    total = sum(os.path.getsize(f) for f in glob.glob(os.path.join(path, "*.safetensors")))
    return round(total / 1e6, 1)


def hf_snapshot_dir(repo: str) -> str:
    base = Path.home() / ".cache/huggingface/hub" / f"models--{repo.replace('/', '--')}" / "snapshots"
    snaps = sorted(base.glob("*"), key=os.path.getmtime) if base.exists() else []
    return str(snaps[-1]) if snaps else ""


def perplexity(model, tokenizer, text: str) -> float:
    ids = tokenizer.encode(text)
    x = mx.array(ids)[None]                     # [1, T]
    logits = model(x[:, :-1])                   # [1, T-1, V]
    tgt = x[:, 1:]
    ce = nn.losses.cross_entropy(
        logits.reshape(-1, logits.shape[-1]).astype(mx.float32),
        tgt.reshape(-1), reduction="mean")
    mx.eval(ce)
    return round(float(mx.exp(ce)), 3)


def tok_per_sec(model, tokenizer) -> float:
    try:
        t0 = time.time()
        generate(model, tokenizer, prompt=GEN_PROMPT, max_tokens=GEN_TOKENS, verbose=False)
        dt = time.time() - t0
        return round(GEN_TOKENS / dt, 1) if dt > 0 else 0.0
    except Exception as e:           # never lose perplexity/size over a tok/s API quirk
        print(f"[tok/s] skipped: {e}", flush=True)
        return 0.0


def measure(label: str, model, tokenizer) -> dict:
    print(f"[{label}] measuring perplexity...", flush=True)
    ppl = perplexity(model, tokenizer, EVAL_TEXT)
    print(f"[{label}] measuring tok/s...", flush=True)
    tps = tok_per_sec(model, tokenizer)
    print(f"[{label}] ppl={ppl}  tok/s={tps}", flush=True)
    return {"perplexity": ppl, "tok_s": tps}


def main():
    os.makedirs(Path(Q4).parent, exist_ok=True)
    results = []

    # ── 1. bf16 baseline (downloads source into HF cache) ────────────────────
    print(f"[bf16] loading {SRC} (downloads ~14.5GB on first run)...", flush=True)
    t0 = time.time()
    model, tok = load(SRC)
    print(f"[bf16] loaded in {time.time()-t0:.0f}s", flush=True)
    bf16_dir = hf_snapshot_dir(SRC)
    bf16_mb = safetensors_mb(bf16_dir) if bf16_dir else None
    m = measure("bf16", model, tok)
    results.append({"variant": "bf16", "size_mb": bf16_mb, "compression": 1.0, **m})
    del model, tok
    gc.collect()
    mx.clear_cache()

    # ── 2. quantize to uniform q4 (group 64) ─────────────────────────────────
    print(f"[q4] quantizing -> {Q4} (q_bits=4, q_group_size=64)...", flush=True)
    t0 = time.time()
    convert(SRC, mlx_path=Q4, quantize=True, q_bits=4, q_group_size=64)
    print(f"[q4] converted in {time.time()-t0:.0f}s", flush=True)
    q4_mb = safetensors_mb(Q4)

    print(f"[q4] loading compressed artifact...", flush=True)
    model, tok = load(Q4)
    m = measure("q4_uniform", model, tok)
    comp = round(bf16_mb / q4_mb, 2) if (bf16_mb and q4_mb) else None
    results.append({"variant": "q4_uniform", "size_mb": q4_mb, "compression": comp, **m})
    del model, tok
    gc.collect()
    mx.clear_cache()

    # ── 3. emit result ───────────────────────────────────────────────────────
    payload = {
        "model": "Mistral-7B-Instruct-v0.3",
        "platform": f"MLX {mx.__version__}, Apple Silicon",
        "scheme": "uniform q4 (group 64) — measured-best from 2026-05-30 (CLAUDE.md §13)",
        "eval_text_tokens": len(EVAL_TEXT.split()),
        "artifact_path": Q4,
        "results": results,
    }
    for path in (OUT, AXOUT):
        with open(path, "w") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
    print(f"\n[done] wrote {OUT}", flush=True)
    print(json.dumps(payload, indent=2, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
