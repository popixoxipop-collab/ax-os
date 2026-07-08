#!/usr/bin/env python3
"""
Persist F2's (DenseBottleneck, L14, rank=8) C4-fine-tuned weights to disk.

Track F/H's fine-tune runs (scripts/run_bottleneck_experiment.py) computed PPL
in-process then called restore(parent, attr, orig) to put the original FFN
back -- the trained bottleneck's weights only ever existed in that one
process's memory, never saved. This script repeats that exact fine-tune
(same recipe: L14, rank=8, same C4 doc slices/step count/optimizer) and
additionally calls new_mod.save_weights() before restoring, so a later script
(run_mc_eval.py) can load the trained F2 weights without re-training.

Reuses eval/bottleneck_filter.py and scripts/run_bottleneck_experiment.py's
building blocks unmodified -- this script only adds the save step and prints
a PPL regression check against Track F/H's already-recorded +1.45%.
"""
import os
import sys
import time

from mlx.utils import tree_flatten
import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "eval"))
sys.path.insert(0, _HERE)
from bottleneck_filter import DenseBottleneck, calibrate_init_std_bottleneck  # noqa: E402
from eval_ppl_c4 import eval_c4_ppl, load_c4_text  # noqa: E402
from run_spectral_swap import (  # noqa: E402
    get_target, measure_target_rms, restore, load_c4_text_slice,
    MODEL_ID, BASELINE_PPL, DIM,
)
from mlx_lm.utils import load  # noqa: E402

LAYER = 14
RANK = 8
TRACK = "A"
SEED = 0
ARTIFACTS_DIR = os.path.join(_HERE, "..", "artifacts")
WEIGHTS_PATH = os.path.join(ARTIFACTS_DIR, "f2_l14_r8_c4_trained.safetensors")
PREVIOUSLY_RECORDED_DELTA_PCT = 1.45  # Track F/H's measured number, for regression check


def main():
    os.makedirs(ARTIFACTS_DIR, exist_ok=True)
    print(f"Loading model: {MODEL_ID} ...", flush=True)
    t0 = time.time()
    model, tokenizer = load(MODEL_ID)
    print(f"  loaded in {time.time()-t0:.2f}s", flush=True)

    target_rms = measure_target_rms(model, tokenizer, TRACK, LAYER)
    factory = lambda std: DenseBottleneck(DIM, rank=RANK, init_std=std)  # noqa: E731
    init_std = calibrate_init_std_bottleneck(factory, target_rms, dim=DIM, seed=SEED)
    print(f"  calibrated init_std={init_std}", flush=True)

    mx.random.seed(SEED)
    parent, attr, orig = get_target(model, TRACK, LAYER)
    new_mod = DenseBottleneck(DIM, rank=RANK, init_std=init_std)
    setattr(parent, attr, new_mod)

    model.freeze()
    new_mod.unfreeze()
    trainable = dict(tree_flatten(model.trainable_parameters()))
    n_trainable = sum(v.size for v in trainable.values())
    expected = new_mod.num_params()
    if n_trainable != expected:
        restore(parent, attr, orig)
        raise RuntimeError(f"freeze isolation failed: expected {expected}, got {n_trainable}")
    print(f"  trainable params: {n_trainable}", flush=True)

    c4_train = load_c4_text_slice(200, 400)
    ids = mx.array(tokenizer.encode(c4_train))
    stride = 512
    chunks = []
    for begin in range(0, len(ids) - 1, stride):
        end = min(begin + stride, len(ids))
        chunk = ids[begin:end]
        if len(chunk) < 2:
            break
        chunks.append(chunk)
    print(f"  train chunks: {len(chunks)} (from {len(ids):,} tokens)", flush=True)

    def loss_fn(model, input_ids, target_ids):
        logits = model(input_ids)[0].astype(mx.float32)
        return nn.losses.cross_entropy(logits, target_ids, reduction="mean")

    lg = nn.value_and_grad(model, loss_fn)
    optimizer = optim.Adam(learning_rate=1e-3)

    losses = []
    step = 0
    t0 = time.time()
    total_steps = len(chunks)
    for chunk in chunks:
        input_ids = chunk[:-1][None]
        target_ids = chunk[1:]
        loss, grads = lg(model, input_ids, target_ids)
        optimizer.update(model, grads)
        mx.eval(loss, model.parameters(), optimizer.state)
        loss_val = loss.item()
        if loss_val != loss_val or abs(loss_val) == float("inf"):
            restore(parent, attr, orig)
            raise RuntimeError(f"non-finite loss at step {step+1}: {loss_val}")
        losses.append(loss_val)
        step += 1
        if step % 10 == 0 or step == total_steps:
            elapsed = time.time() - t0
            eta = (elapsed / step) * (total_steps - step)
            print(f"    step {step}/{total_steps} loss={losses[-1]:.4f} "
                  f"elapsed={elapsed:.0f}s eta={eta:.0f}s", flush=True)

    new_mod.save_weights(WEIGHTS_PATH)
    print(f"  saved trained bottleneck weights -> {WEIGHTS_PATH}", flush=True)

    c4_eval = load_c4_text(200)
    ckpt_path = os.path.join(ARTIFACTS_DIR, "f2_c4_trained_regression_check_c4_ppl_checkpoint.json")
    ppl = eval_c4_ppl(model, tokenizer, c4_eval, stride=512, max_length=512, checkpoint_path=ckpt_path)
    delta_pct = (ppl - BASELINE_PPL) / BASELINE_PPL * 100.0
    restore(parent, attr, orig)

    print(f"\n=== regression check ===")
    print(f"  PPL={ppl:.4f}  DeltaPPL%={delta_pct:+.2f}%  "
          f"(Track F/H recorded: +{PREVIOUSLY_RECORDED_DELTA_PCT:.2f}%)")
    diff = abs(delta_pct - PREVIOUSLY_RECORDED_DELTA_PCT)
    print(f"  diff from recorded value: {diff:.3f}pp -> "
          f"{'OK (within noise)' if diff < 0.3 else 'FLAG: diverged more than expected'}")


if __name__ == "__main__":
    main()
