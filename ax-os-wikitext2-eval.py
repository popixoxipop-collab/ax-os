#!/usr/bin/env python3
"""
WikiText-2 standard perplexity evaluation for AX OS scale-stratified q4 paper.
Evaluates BF16 vs q4_uniform ppl at 1.5B, 3B, 7B scales.

Usage:
  python3 ax-os-wikitext2-eval.py [--quick] [--model LABEL]
"""

import argparse, json, math, sys, time
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
from mlx_lm import load
from datasets import load_dataset

RESULTS_PATH = Path("/Users/xox/ax-os-wikitext2-results.json")

MODELS = [
    # (label, hf_or_local_path, size_b, variant)
    ("qwen1.5b_bf16", "mlx-community/Qwen2.5-1.5B-Instruct-bf16",          1.5, "bf16"),
    ("qwen1.5b_q4",   "mlx-community/Qwen2.5-1.5B-Instruct-4bit",          1.5, "q4"),
    ("qwen3b_bf16",   "mlx-community/Qwen2.5-3B-Instruct-bf16",             3.0, "bf16"),
    ("qwen3b_q4",     "mlx-community/Qwen2.5-3B-Instruct-4bit",             3.0, "q4"),
    # 7B — Qwen2.5-7B for family consistency (Mistral-7B used as cross-model validation)
    ("qwen7b_bf16",   "mlx-community/Qwen2.5-7B-Instruct-bf16",             7.0, "bf16"),
    ("qwen7b_q4",     "mlx-community/Qwen2.5-7B-Instruct-4bit",             7.0, "q4"),
    # Cross-model: Mistral-7B (v0.2 bf16 ≈ v0.3 bf16 on WikiText-2)
    ("mistral7b_bf16", "mistralai/Mistral-7B-Instruct-v0.3",                 7.0, "bf16"),
    ("mistral7b_q4",  "/Users/xox/Desktop/AEQ/models/mistral-7b-v0.3-q4",  7.0, "q4"),
]


def get_wikitext2_tokens(tokenizer, max_tokens=None):
    """Load WikiText-2 test split and tokenize as a single sequence."""
    ds = load_dataset("wikitext", "wikitext-2-raw-v1", split="test")
    text = "\n".join(r["text"] for r in ds if r["text"].strip())
    tokens = tokenizer.encode(text)
    print(f"  [data] WikiText-2 test: {len(tokens):,} tokens")
    if max_tokens and len(tokens) > max_tokens:
        tokens = tokens[:max_tokens]
        print(f"  [data] truncated to {len(tokens):,} tokens")
    return tokens


def compute_perplexity(model, tokens, seq_len=512, stride=None, batch_size=1):
    """Sliding-window perplexity matching standard protocol."""
    if stride is None:
        stride = seq_len // 2
    tokens = mx.array(tokens)
    n = len(tokens)
    total_nll = 0.0
    total_count = 0
    pos = 0
    step = 0
    while pos < n - 1:
        end = min(pos + seq_len, n)
        chunk = tokens[pos:end]
        if len(chunk) < 2:
            break
        x = chunk[:-1][None]   # (1, T-1)
        y = chunk[1:][None]    # (1, T-1)
        logits = model(x)      # (1, T-1, vocab)
        logits = logits[0]     # (T-1, vocab)
        target = y[0]          # (T-1,)
        nll = nn.losses.cross_entropy(logits, target, reduction="sum")
        mx.eval(nll)
        total_nll  += float(nll.item())
        total_count += int(target.shape[0])
        step += 1
        if step % 20 == 0:
            ppl_so_far = math.exp(total_nll / total_count)
            print(f"    step {step:4d}  pos={pos:6d}/{n}  ppl={ppl_so_far:.3f}", end="\r", flush=True)
        pos += stride
        if end == n:
            break
    print()
    ppl = math.exp(total_nll / total_count)
    return ppl, total_count


def eval_model(label, model_path, size_b, variant, max_tokens, seq_len):
    print(f"\n{'='*60}")
    print(f"[eval] {label}  ({size_b}B {variant})")
    print(f"       model={model_path}")
    t0 = time.time()
    try:
        model, tokenizer = load(model_path)
        model.eval()
        tokens = get_wikitext2_tokens(tokenizer, max_tokens=max_tokens)
        ppl, n_tokens = compute_perplexity(model, tokens, seq_len=seq_len)
        elapsed = time.time() - t0
        print(f"  ppl={ppl:.4f}  tokens={n_tokens:,}  elapsed={elapsed:.0f}s")
        return {"model": model_path, "size_b": size_b, "variant": variant,
                "ppl": ppl, "n_tokens": n_tokens, "elapsed_s": round(elapsed, 1),
                "dataset": "wikitext-2-raw-v1/test", "seq_len": seq_len}
    except Exception as e:
        print(f"  ERROR: {e}")
        import traceback; traceback.print_exc()
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true",
                    help="Limit to 5K tokens (fast sanity check)")
    ap.add_argument("--model", default=None,
                    help="Run only this label (e.g. mistral7b_q4)")
    ap.add_argument("--seq-len", type=int, default=512)
    args = ap.parse_args()

    max_tokens = 5_000 if args.quick else 200_000
    seq_len    = args.seq_len

    results = {}
    if RESULTS_PATH.exists():
        results = json.loads(RESULTS_PATH.read_text())

    for label, model_path, size_b, variant in MODELS:
        if args.model and label != args.model:
            continue
        if label in results:
            print(f"[skip] {label} — already have ppl={results[label]['ppl']:.4f}")
            continue

        rec = eval_model(label, model_path, size_b, variant, max_tokens, seq_len)
        if rec:
            results[label] = rec
            RESULTS_PATH.write_text(json.dumps(results, indent=2))
            print(f"[saved] {RESULTS_PATH}")

    # ── Summary ──────────────────────────────────────────────
    print("\n" + "="*60)
    print("SCALE TREND SUMMARY (WikiText-2) — same-family pairs only")
    print(f"{'Scale':>7}  {'Family':>8}  {'BF16 ppl':>10}  {'q4 ppl':>10}  {'deg%':>7}")
    print("-"*52)
    # Explicit same-family pairs: bf_label, q4_label, scale, family
    PAIRS = [
        ("qwen1.5b_bf16", "qwen1.5b_q4",  1.5, "Qwen"),
        ("qwen3b_bf16",   "qwen3b_q4",    3.0, "Qwen"),
        ("qwen7b_bf16",   "qwen7b_q4",    7.0, "Qwen"),
        ("mistral7b_bf16","mistral7b_q4", 7.0, "Mistral"),
    ]
    for bk, qk, scale, family in PAIRS:
        if bk in results and qk in results:
            pb, pq = results[bk]['ppl'], results[qk]['ppl']
            deg = (pq - pb) / pb * 100
            print(f"{scale:>5}B  {family:>8}  {pb:>10.3f}  {pq:>10.3f}  {deg:>+7.1f}%")
        else:
            missing = ([bk] if bk not in results else []) + ([qk] if qk not in results else [])
            print(f"{scale:>5}B  {family:>8}  [missing: {', '.join(missing)}]")

if __name__ == "__main__":
    main()
