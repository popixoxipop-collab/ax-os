#!/usr/bin/env python3
"""
HellaSwag / PIQA loglikelihood-scored multiple-choice eval for MLX models.

Direct port of ~/Desktop/postbackprop/scripts/local_eval.py's LMEvalWrapper.loglikelihood
+ eval_multiple_choice (PyTorch/SentencePiece) to MLX/mlx_lm's HF-style tokenizer.
Same algorithm: for each (context, candidate_continuation) pair, tokenize separately,
run one forward pass, sum the log-probability the model assigns to the continuation's
own tokens (teacher-forced, no generation/sampling needed), and pick the candidate with
the highest total log-likelihood as the model's answer.

No generation loop, no stop-token detection, no output parsing -- unlike an
ARC-AGI-style generation+grid-parsing eval, this only needs a single forward
pass per candidate, which is why HellaSwag/PIQA were chosen over ARC-AGI-2 for
this check.
"""
import mlx.core as mx


def loglikelihood(model, tokenizer, ctx: str, cont: str) -> float:
    ctx_ids = tokenizer.encode(ctx)
    cont_ids = tokenizer.encode(cont)
    all_ids = ctx_ids + cont_ids
    x = mx.array(all_ids[:-1])[None]
    y = all_ids[1:]

    logits = model(x)[0].astype(mx.float32)  # (seq_len-1, vocab)
    log_p = logits - mx.logsumexp(logits, axis=-1, keepdims=True)  # log_softmax

    start = max(0, len(ctx_ids) - 1)
    cont_target_ids = y[start:]
    n = len(cont_target_ids)
    row_idx = mx.arange(start, start + n)
    col_idx = mx.array(cont_target_ids)
    ll = log_p[row_idx, col_idx].sum()
    return float(ll.item())


def eval_hellaswag(model, tokenizer, n=200, log_every=50):
    from datasets import load_dataset
    ds = load_dataset("Rowan/hellaswag", split=f"validation[:{n}]")
    correct = 0
    for i, item in enumerate(ds):
        ctx = item["ctx"]
        choices = item["endings"]
        label = int(item["label"])
        lls = [loglikelihood(model, tokenizer, ctx, c) for c in choices]
        if lls.index(max(lls)) == label:
            correct += 1
        if (i + 1) % log_every == 0:
            print(f"  HellaSwag {i+1}/{n}: {correct/(i+1)*100:.1f}%", flush=True)
    acc = correct / len(ds)
    print(f"HellaSwag acc: {acc*100:.1f}%  (n={len(ds)})", flush=True)
    return acc


def eval_piqa(model, tokenizer, n=200, log_every=50):
    from datasets import load_dataset
    ds = load_dataset("ybisk/piqa", revision="refs/convert/parquet", split=f"validation[:{n}]")
    correct = 0
    for i, item in enumerate(ds):
        goal = item["goal"]
        choices = [item["sol1"], item["sol2"]]
        label = item["label"]
        lls = [loglikelihood(model, tokenizer, goal, c) for c in choices]
        if lls.index(max(lls)) == label:
            correct += 1
        if (i + 1) % log_every == 0:
            print(f"  PIQA {i+1}/{n}: {correct/(i+1)*100:.1f}%", flush=True)
    acc = correct / len(ds)
    print(f"PIQA acc: {acc*100:.1f}%  (n={len(ds)})", flush=True)
    return acc


if __name__ == "__main__":
    # Self-test: verify loglikelihood is well-formed (finite, and a longer/more
    # coherent continuation of the SAME context scores higher than a nonsense
    # one) before trusting it for the full n=200 HellaSwag/PIQA runs.
    import sys
    from mlx_lm.utils import load

    print("Loading model for self-test...", flush=True)
    model, tokenizer = load("mlx-community/Qwen2.5-1.5B-Instruct-bf16")

    ctx = "The weather today is sunny and warm, so I decided to"
    good = " go for a walk in the park."
    bad = " purple elephant seventeen quickly."
    ll_good = loglikelihood(model, tokenizer, ctx, good)
    ll_bad = loglikelihood(model, tokenizer, ctx, bad)
    print(f"loglikelihood(coherent continuation) = {ll_good:.3f}")
    print(f"loglikelihood(nonsense continuation) = {ll_bad:.3f}")
    ok = (ll_good == ll_good and ll_bad == ll_bad  # both finite (not NaN)
          and ll_good > ll_bad)
    print(f"self-test: {'PASS' if ok else 'FAIL'} "
          f"(coherent should score higher than nonsense)")
    if not ok:
        sys.exit(1)

    print("\nRunning small HellaSwag/PIQA smoke test (n=10 each)...", flush=True)
    eval_hellaswag(model, tokenizer, n=10, log_every=10)
    eval_piqa(model, tokenizer, n=10, log_every=10)
