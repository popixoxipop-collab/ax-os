"""
HellaSwag accuracy evaluation using mlx_lm.
Usage: python eval_hellaswag_mlx.py <model_path> [n_samples]
"""
import sys, os, math, json
import mlx.core as mx
import mlx.nn as nn
import numpy as np
from mlx_lm import load
from datasets import load_dataset

def compute_nll_per_token(model, tokenizer, context: str, completion: str) -> float:
    ctx_ids = tokenizer.encode(context)
    full_ids = tokenizer.encode(context + completion)
    completion_start = len(ctx_ids)
    if len(full_ids) <= completion_start:
        return float('inf')

    input_ids = mx.array(full_ids[:-1])[None]   # (1, T-1)
    target_ids = full_ids[1:]

    logits = model(input_ids)                    # (1, T-1, V)
    logits = logits[0]                            # (T-1, V)
    mx.eval(logits)

    # Compute log-probs using nn.losses for numerical stability
    # log_softmax row-wise
    lsm = logits - mx.logsumexp(logits, axis=-1, keepdims=True)
    lsm_np = np.array(lsm.astype(mx.float32))   # cast to float32 first

    comp_targets = target_ids[completion_start - 1:]
    comp_lsm    = lsm_np[completion_start - 1:]

    if len(comp_targets) == 0:
        return float('inf')

    nll = -sum(float(comp_lsm[i, t]) for i, t in enumerate(comp_targets))
    return nll / len(comp_targets)

def evaluate(model_path: str, n_samples: int = 400, seed: int = 42):
    print(f"Loading: {model_path}", flush=True)
    model, tokenizer = load(model_path)

    print(f"Loading HellaSwag val ({n_samples} samples)...", flush=True)
    # Load without trust_remote_code (datasets >= 2.x)
    ds = load_dataset("Rowan/hellaswag", split="validation")

    rng = np.random.default_rng(seed)
    indices = rng.choice(len(ds), size=min(n_samples, len(ds)), replace=False)

    correct = 0
    for step, idx in enumerate(indices):
        ex = ds[int(idx)]
        ctx = ex["ctx"]
        endings = ex["endings"]
        label = int(ex["label"])

        nlls = [compute_nll_per_token(model, tokenizer, ctx, e) for e in endings]
        pred = int(np.argmin(nlls))
        if pred == label:
            correct += 1

        if (step + 1) % 50 == 0:
            acc_so_far = correct / (step + 1)
            print(f"  {step+1}/{n_samples}  acc={acc_so_far:.4f}", flush=True)

    acc = correct / len(indices)
    print(f"\n=== RESULT ===", flush=True)
    print(f"model={model_path}", flush=True)
    print(f"n={len(indices)}, accuracy={acc:.4f} ({acc*100:.1f}%)", flush=True)
    return {"model": model_path, "n": len(indices), "accuracy": round(acc, 4)}

if __name__ == "__main__":
    model_path = sys.argv[1] if len(sys.argv) > 1 else "path_a_artifacts/qwen7b_q4_local"
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 400
    result = evaluate(model_path, n_samples=n)
    with open(f"/tmp/hellaswag_{os.path.basename(model_path)}.json", "w") as f:
        json.dump(result, f)
    print("JSON:", json.dumps(result))
