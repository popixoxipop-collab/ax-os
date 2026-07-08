#!/usr/bin/env python3
"""
Track I driver: rank-matched (real-rank<=8) complex arms isolating the
weight-type-alone effect that Track G's param-matched 2x2 confounded with
capacity. See ../SPECTRAL_LLM_SURGERY_FINDINGS.md ("Track G", the
"정정(2026-07-08, 사용자 지적으로 발견)" correction block) for full context.

D11: Track I - rank-matched (real-rank<=8) complex arms I1(frequency), I2(channel) via complex-rank=4
  WHY: Track G's param-count-matched 2x2 confounded weight-type (real vs complex) with capacity
       (rank 8 vs 16), because complex-rank-r gives real-rank<=2r while real-rank-r gives exactly r
       (Codex-proven). Rank-matching instead of param-matching gives true single-variable isolation:
       I1 vs G1 and I2 vs F2 both hold domain AND real-rank constant, varying only weight type.
  COST: I1/I2 use ~half the parameters of G1/F2/F1/G2 (~12.3K vs ~24.6K) for the same real-rank -
       an honest, expected tradeoff (complex numbers pack more rank per real parameter), not a bug.
       This means a lower DeltaPPL% for I1/I2 vs G1/F2 isn't "surprising" on efficiency grounds alone.
  EXIT: if I1-vs-G1 and I2-vs-F2 gaps point in different directions or very different magnitudes,
       that suggests weight-type and domain interact rather than contribute independently - report
       that plainly rather than forcing a single combined "weight-type effect" number.

I1 = DenseFFTBottleneck (F1's exact class, bottleneck_filter.py) at rank=4 instead of 8.
I2 = ComplexChannelPairBottleneck (G2's exact class, bottleneck_ablation.py) at rank=4 instead of 8.
Both classes already parameterize rank via their constructor -- no new model code needed, only
this driver script. Neither bottleneck_filter.py nor bottleneck_ablation.py is modified.

Mirrors scripts/run_bottleneck_ablation.py exactly in procedure/hyperparameters
(epochs=1, lr=1e-3, Adam, C4 doc slices 200-400 train / 0-200 eval, stride=512).
"""
import argparse
import json
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
from bottleneck_filter import DenseFFTBottleneck, calibrate_init_std_bottleneck  # noqa: E402
from bottleneck_ablation import ComplexChannelPairBottleneck  # noqa: E402
from eval_ppl_c4 import eval_c4_ppl, load_c4_text  # noqa: E402
from run_spectral_swap import (  # noqa: E402
    get_target, measure_target_rms, restore, load_c4_text_slice,
    MODEL_ID, BASELINE_PPL, DIM,
)
from mlx_lm.utils import load  # noqa: E402

LAYER = 14
RANK = 4  # D11: half of F1/F2/G1/G2's rank=8, so complex arms' real-rank (<=2*4=8) matches G1/F2's real-rank=8
TRACK = "A"  # get_target(model, "A", layer) -> (block, "mlp", block.mlp)
ARTIFACTS_DIR = os.path.join(_HERE, "..", "artifacts")
ORIG_FFN_PARAMS = 3 * DIM * 8960

ARMS = {
    "I1": DenseFFTBottleneck,           # F1's class, rank=4: frequency domain, complex
    "I2": ComplexChannelPairBottleneck,  # G2's class, rank=4: channel domain, complex, local pairing
}


def swap_in_bottleneck(model, arm, layer, rank, init_std, seed):
    mx.random.seed(seed)
    parent, attr, orig = get_target(model, TRACK, layer)
    cls = ARMS[arm]
    new_mod = cls(DIM, rank=rank, init_std=init_std)
    setattr(parent, attr, new_mod)
    return parent, attr, orig, new_mod


def run_zeroshot_config(model, tokenizer, c4_text, arm, init_mode, seed):
    if init_mode == "calibrated":
        target_rms = measure_target_rms(model, tokenizer, TRACK, LAYER)
        cls = ARMS[arm]
        factory = lambda std: cls(DIM, rank=RANK, init_std=std)  # noqa: E731
        init_std = calibrate_init_std_bottleneck(factory, target_rms, dim=DIM, seed=seed)
    else:
        target_rms = None
        init_std = 0.02

    parent, attr, orig, new_mod = swap_in_bottleneck(model, arm, LAYER, RANK, init_std, seed)
    ckpt_path = os.path.join(
        ARTIFACTS_DIR,
        f"qwen15b_bottleneck_track{arm}_L{LAYER}_r{RANK}_{init_mode}_c4_ppl_checkpoint.json")

    t0 = time.time()
    ppl = eval_c4_ppl(model, tokenizer, c4_text, stride=512, max_length=512,
                       checkpoint_path=ckpt_path)
    dt = time.time() - t0

    ratio = ORIG_FFN_PARAMS / new_mod.num_params()
    delta_pct = (ppl - BASELINE_PPL) / BASELINE_PPL * 100.0

    result = dict(arm=arm, layer=LAYER, rank=RANK, init_mode=init_mode,
                  init_std=init_std, target_rms=target_rms, ppl=ppl,
                  baseline_ppl=BASELINE_PPL, delta_pct=delta_pct,
                  orig_params=ORIG_FFN_PARAMS, new_params=new_mod.num_params(),
                  compression_ratio=ratio, wall_time_s=dt)

    restore(parent, attr, orig)
    print(f"  -> {arm} L{LAYER} r{RANK} {init_mode}: PPL={ppl:.4f} DeltaPPL%={delta_pct:+.2f}% "
          f"params={new_mod.num_params()} ({dt:.1f}s)", flush=True)
    return result


def run_finetune_config(model, tokenizer, c4_train_text, c4_eval_text, arm, init_std, seed,
                         epochs=1, lr=1e-3, dry_run_steps=None):
    parent, attr, orig, new_mod = swap_in_bottleneck(model, arm, LAYER, RANK, init_std, seed)

    model.freeze()
    new_mod.unfreeze()

    trainable = dict(tree_flatten(model.trainable_parameters()))
    n_trainable = sum(v.size for v in trainable.values())
    expected = new_mod.num_params()
    if n_trainable != expected:
        restore(parent, attr, orig)
        raise RuntimeError(
            f"freeze isolation failed: expected {expected} trainable params, "
            f"got {n_trainable}: keys={list(trainable.keys())}")

    ids = mx.array(tokenizer.encode(c4_train_text))
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
    optimizer = optim.Adam(learning_rate=lr)

    losses = []
    step = 0
    t0 = time.time()
    total_steps = dry_run_steps if dry_run_steps else epochs * len(chunks)
    stop = False
    for _epoch in range(epochs):
        if stop:
            break
        for chunk in chunks:
            input_ids = chunk[:-1][None]
            target_ids = chunk[1:]
            loss, grads = lg(model, input_ids, target_ids)
            optimizer.update(model, grads)
            mx.eval(loss, model.parameters(), optimizer.state)
            loss_val = loss.item()
            if loss_val != loss_val or abs(loss_val) == float("inf"):
                restore(parent, attr, orig)
                raise RuntimeError(f"[arm={arm}] non-finite loss at step {step+1}: {loss_val}")
            losses.append(loss_val)
            step += 1
            if step % 10 == 0 or (dry_run_steps and step <= dry_run_steps) or step == total_steps:
                elapsed = time.time() - t0
                rate = elapsed / step
                eta = rate * (total_steps - step)
                print(f"    [arm={arm}] step {step}/{total_steps} loss={losses[-1]:.4f} "
                      f"elapsed={elapsed:.0f}s eta={eta:.0f}s", flush=True)
            if dry_run_steps and step >= dry_run_steps:
                stop = True
                break
    dt = time.time() - t0

    result = dict(arm=arm, layer=LAYER, rank=RANK, init_std=init_std,
                  n_trainable=n_trainable, steps=step, losses=losses,
                  first_loss=losses[0], last_loss=losses[-1],
                  loss_finite=all(l == l and abs(l) != float("inf") for l in losses),
                  wall_time_s=dt)

    if dry_run_steps:
        restore(parent, attr, orig)
        return result

    ckpt_path = os.path.join(
        ARTIFACTS_DIR,
        f"qwen15b_bottleneck_track{arm}_L{LAYER}_r{RANK}_finetuned_c4_ppl_checkpoint.json")
    ppl = eval_c4_ppl(model, tokenizer, c4_eval_text, stride=512, max_length=512,
                       checkpoint_path=ckpt_path)
    delta_pct = (ppl - BASELINE_PPL) / BASELINE_PPL * 100.0
    ratio = ORIG_FFN_PARAMS / new_mod.num_params()
    result.update(ppl=ppl, baseline_ppl=BASELINE_PPL, delta_pct=delta_pct,
                  orig_params=ORIG_FFN_PARAMS, new_params=new_mod.num_params(),
                  compression_ratio=ratio)

    restore(parent, attr, orig)
    print(f"  -> {arm} L{LAYER} r{RANK} finetuned: PPL={ppl:.4f} DeltaPPL%={delta_pct:+.2f}% "
          f"(loss {losses[0]:.3f}->{losses[-1]:.3f}, {dt:.1f}s)", flush=True)
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", choices=["dryrun", "zeroshot", "finetune"], required=True)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--num-docs", type=int, default=200)
    ap.add_argument("--epochs", type=int, default=1)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--dry-run-steps", type=int, default=25)
    ap.add_argument("--arm", type=str, default=None, choices=["I1", "I2"])
    args = ap.parse_args()

    os.makedirs(ARTIFACTS_DIR, exist_ok=True)

    for name, cls in ARMS.items():
        params = cls(DIM, rank=RANK).num_params()
        print(f"  {name} ({cls.__name__}) rank={RANK}: {params:,} params, "
              f"real-rank<={2*RANK}", flush=True)

    print(f"Loading model: {MODEL_ID} ...", flush=True)
    t0 = time.time()
    model, tokenizer = load(MODEL_ID)
    print(f"  loaded in {time.time()-t0:.2f}s", flush=True)

    if args.phase == "dryrun":
        arm = args.arm or "I1"
        target_rms = measure_target_rms(model, tokenizer, TRACK, LAYER)
        cls = ARMS[arm]
        factory = lambda std, cls=cls: cls(DIM, rank=RANK, init_std=std)  # noqa: E731
        init_std = calibrate_init_std_bottleneck(factory, target_rms, dim=DIM, seed=args.seed)
        c4_train = load_c4_text_slice(200, 400)
        r = run_finetune_config(model, tokenizer, c4_train, None, arm, init_std,
                                 args.seed, epochs=1, lr=args.lr,
                                 dry_run_steps=args.dry_run_steps)
        print(json.dumps({k: v for k, v in r.items() if k != "losses"}, indent=2))
        print("losses:", r["losses"])

    elif args.phase == "zeroshot":
        c4_text = load_c4_text(args.num_docs)
        arms_to_run = [args.arm] if args.arm else ["I1", "I2"]
        results = []
        for arm in arms_to_run:
            for mode in ["calibrated", "noop"]:
                r = run_zeroshot_config(model, tokenizer, c4_text, arm, mode, args.seed)
                results.append(r)
                _save(results, f"zeroshot_{arm}")
        _save(results, "zeroshot", final=True)

    elif args.phase == "finetune":
        c4_train = load_c4_text_slice(200, 400)
        c4_eval = load_c4_text(args.num_docs)
        results = []
        arms_to_run = [args.arm] if args.arm else ["I1", "I2"]
        for arm in arms_to_run:
            target_rms = measure_target_rms(model, tokenizer, TRACK, LAYER)
            cls = ARMS[arm]
            factory = lambda std, cls=cls: cls(DIM, rank=RANK, init_std=std)  # noqa: E731
            init_std = calibrate_init_std_bottleneck(factory, target_rms, dim=DIM, seed=args.seed)
            r = run_finetune_config(model, tokenizer, c4_train, c4_eval, arm, init_std,
                                     args.seed, epochs=args.epochs, lr=args.lr,
                                     dry_run_steps=None)
            results.append(r)
            _save(results, f"finetune_{arm}")
        _save(results, "finetune", final=True)


def _save(results, tag, final=False):
    path = os.path.join(ARTIFACTS_DIR, f"bottleneck_trackI_results_{tag}.json")
    with open(path, "w") as f:
        json.dump({"results": results, "done": final}, f, indent=2, default=str)


if __name__ == "__main__":
    main()
