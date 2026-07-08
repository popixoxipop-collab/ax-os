#!/usr/bin/env python3
"""
Track H driver: rank sweep and layer sweep for DenseBottleneck (F2), the
plain real-valued dense bottleneck from Track F (see eval/bottleneck_filter.py
D2) that beat DenseFFTBottleneck (F1) at L14/rank=8 (F2 +1.45% vs F1 +2.83%
fine-tuned dPPL%, see ../SPECTRAL_LLM_SURGERY_FINDINGS.md). Parameterizes
LAYER and RANK (run_bottleneck_experiment.py hardcodes both to 14/8) so both
axes can be swept without touching that script or its artifacts.

D9: rank sweep r in {4,16,32} for F2 at L14 (reusing existing r=8 data point)
  WHY: characterize how ΔPPL% scales with rank; check whether F2 can approach
       or beat Track B's o_proj-replacement quality (+1.09%) at a still-tiny
       rank, and find the point of diminishing returns.
  COST: r=32 uses 4x r=8's params (98,304 vs 24,576) -- still >400x
       compression vs the original 41.28M-param FFN, but no longer as
       extreme as r=8.
  EXIT: if still improving at r=32, a later track could push to r=64; if
       plateaued by r=16, r=32 already tells us that without needing to go
       further.

D10: layer sweep (L4, L24) for F2 at rank=8
  WHY: Track A found FFN-replacement training gives ZERO benefit over no-op
       ablation specifically at L24; test whether F2's architecture (already
       proven better than the per-bin family at L14) breaks that pattern or
       whether L24 is hard regardless of replacement architecture.
  COST: this only measures whether the pattern persists, it doesn't explain
       WHY L24 behaves this way if it does -- that stays an open question,
       not something to speculate about here.
  EXIT: if L24 remains stuck even with F2, that points to something
       layer-specific (e.g. residual-stream saturation at that depth) rather
       than an architecture limitation, motivating a completely different
       kind of follow-up (not more architecture variants at L24).

Reuses get_target/measure_target_rms/restore/load_c4_text_slice/MODEL_ID/
BASELINE_PPL/DIM from run_spectral_swap.py and eval_c4_ppl/load_c4_text from
eval_ppl_c4.py UNMODIFIED, and DenseBottleneck/calibrate_init_std_bottleneck
from eval/bottleneck_filter.py UNMODIFIED (read-only imports; none of those
files are touched by this script).
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
from bottleneck_filter import DenseBottleneck, calibrate_init_std_bottleneck  # noqa: E402
from eval_ppl_c4 import eval_c4_ppl, load_c4_text  # noqa: E402
from run_spectral_swap import (  # noqa: E402
    get_target, measure_target_rms, restore, load_c4_text_slice,
    MODEL_ID, BASELINE_PPL, DIM,
)
from mlx_lm.utils import load  # noqa: E402

TRACK = "A"  # get_target(model, "A", layer) -> (block, "mlp", block.mlp), same as Track F
ARM = "F2"
ARTIFACTS_DIR = os.path.join(_HERE, "..", "artifacts")
ORIG_FFN_PARAMS = 3 * DIM * 8960  # gate_proj + up_proj + down_proj, matches Track F


def swap_in_bottleneck(model, layer, rank, init_std, seed):
    mx.random.seed(seed)
    parent, attr, orig = get_target(model, TRACK, layer)
    new_mod = DenseBottleneck(DIM, rank=rank, init_std=init_std)
    setattr(parent, attr, new_mod)
    return parent, attr, orig, new_mod


def run_zeroshot_config(model, tokenizer, c4_text, layer, rank, init_mode, seed):
    if init_mode == "calibrated":
        target_rms = measure_target_rms(model, tokenizer, TRACK, layer)
        factory = lambda std: DenseBottleneck(DIM, rank=rank, init_std=std)  # noqa: E731
        init_std = calibrate_init_std_bottleneck(factory, target_rms, dim=DIM, seed=seed)
    else:
        target_rms = None
        init_std = 0.02

    parent, attr, orig, new_mod = swap_in_bottleneck(model, layer, rank, init_std, seed)
    ckpt_path = os.path.join(
        ARTIFACTS_DIR,
        f"qwen15b_bottleneck_track{ARM}_L{layer}_r{rank}_{init_mode}_c4_ppl_checkpoint.json")

    t0 = time.time()
    ppl = eval_c4_ppl(model, tokenizer, c4_text, stride=512, max_length=512,
                       checkpoint_path=ckpt_path)
    dt = time.time() - t0

    ratio = ORIG_FFN_PARAMS / new_mod.num_params()
    delta_pct = (ppl - BASELINE_PPL) / BASELINE_PPL * 100.0

    result = dict(arm=ARM, layer=layer, rank=rank, init_mode=init_mode,
                  init_std=init_std, target_rms=target_rms, ppl=ppl,
                  baseline_ppl=BASELINE_PPL, delta_pct=delta_pct,
                  orig_params=ORIG_FFN_PARAMS, new_params=new_mod.num_params(),
                  compression_ratio=ratio, wall_time_s=dt)

    restore(parent, attr, orig)
    print(f"  -> {ARM} L{layer} r{rank} {init_mode}: PPL={ppl:.4f} DeltaPPL%={delta_pct:+.2f}% "
          f"params={new_mod.num_params()} ({dt:.1f}s)", flush=True)
    return result


def run_finetune_config(model, tokenizer, c4_train_text, c4_eval_text, layer, rank, init_std, seed,
                         epochs=1, lr=1e-3, dry_run_steps=None):
    parent, attr, orig, new_mod = swap_in_bottleneck(model, layer, rank, init_std, seed)

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
    print(f"  train chunks: {len(chunks)} (from {len(ids):,} tokens)")

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
            losses.append(loss.item())
            step += 1
            if step % 10 == 0 or (dry_run_steps and step <= dry_run_steps) or step == total_steps:
                elapsed = time.time() - t0
                rate = elapsed / step
                eta = rate * (total_steps - step)
                print(f"    [L{layer} r{rank}] step {step}/{total_steps} loss={losses[-1]:.4f} "
                      f"elapsed={elapsed:.0f}s eta={eta:.0f}s", flush=True)
            if dry_run_steps and step >= dry_run_steps:
                stop = True
                break
    dt = time.time() - t0

    result = dict(arm=ARM, layer=layer, rank=rank, init_std=init_std,
                  n_trainable=n_trainable, steps=step, losses=losses,
                  first_loss=losses[0], last_loss=losses[-1],
                  loss_finite=all(l == l and abs(l) != float("inf") for l in losses),
                  wall_time_s=dt)

    if dry_run_steps:
        restore(parent, attr, orig)
        return result

    ckpt_path = os.path.join(
        ARTIFACTS_DIR,
        f"qwen15b_bottleneck_track{ARM}_L{layer}_r{rank}_finetuned_c4_ppl_checkpoint.json")
    ppl = eval_c4_ppl(model, tokenizer, c4_eval_text, stride=512, max_length=512,
                       checkpoint_path=ckpt_path)
    delta_pct = (ppl - BASELINE_PPL) / BASELINE_PPL * 100.0
    ratio = ORIG_FFN_PARAMS / new_mod.num_params()
    result.update(ppl=ppl, baseline_ppl=BASELINE_PPL, delta_pct=delta_pct,
                  orig_params=ORIG_FFN_PARAMS, new_params=new_mod.num_params(),
                  compression_ratio=ratio)

    restore(parent, attr, orig)
    print(f"  -> {ARM} L{layer} r{rank} finetuned: PPL={ppl:.4f} DeltaPPL%={delta_pct:+.2f}% "
          f"(loss {losses[0]:.3f}->{losses[-1]:.3f}, {dt:.1f}s)", flush=True)
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", choices=["dryrun", "zeroshot", "finetune"], required=True)
    ap.add_argument("--layer", type=int, required=True)
    ap.add_argument("--rank", type=int, required=True)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--num-docs", type=int, default=200)
    ap.add_argument("--epochs", type=int, default=1)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--dry-run-steps", type=int, default=25)
    ap.add_argument("--tag", type=str, required=True, help="results file tag, e.g. rank_r4 or layer_L4")
    args = ap.parse_args()

    os.makedirs(ARTIFACTS_DIR, exist_ok=True)

    print(f"Loading model: {MODEL_ID} ...")
    t0 = time.time()
    model, tokenizer = load(MODEL_ID)
    print(f"  loaded in {time.time()-t0:.2f}s")

    if args.phase == "dryrun":
        target_rms = measure_target_rms(model, tokenizer, TRACK, args.layer)
        factory = lambda std: DenseBottleneck(DIM, rank=args.rank, init_std=std)  # noqa: E731
        init_std = calibrate_init_std_bottleneck(factory, target_rms, dim=DIM, seed=args.seed)
        c4_train = load_c4_text_slice(200, 400)
        r = run_finetune_config(model, tokenizer, c4_train, None, args.layer, args.rank, init_std,
                                 args.seed, epochs=1, lr=args.lr,
                                 dry_run_steps=args.dry_run_steps)
        print(json.dumps({k: v for k, v in r.items() if k != "losses"}, indent=2))
        print("losses:", r["losses"])

    elif args.phase == "zeroshot":
        c4_text = load_c4_text(args.num_docs)
        results = []
        for mode in ["calibrated", "noop"]:
            r = run_zeroshot_config(model, tokenizer, c4_text, args.layer, args.rank, mode, args.seed)
            results.append(r)
            _save(results, args.tag)
        _save(results, args.tag, final=True)

    elif args.phase == "finetune":
        c4_train = load_c4_text_slice(200, 400)
        c4_eval = load_c4_text(args.num_docs)
        target_rms = measure_target_rms(model, tokenizer, TRACK, args.layer)
        factory = lambda std: DenseBottleneck(DIM, rank=args.rank, init_std=std)  # noqa: E731
        init_std = calibrate_init_std_bottleneck(factory, target_rms, dim=DIM, seed=args.seed)
        r = run_finetune_config(model, tokenizer, c4_train, c4_eval, args.layer, args.rank, init_std,
                                 args.seed, epochs=args.epochs, lr=args.lr,
                                 dry_run_steps=None)
        _save([r], args.tag, final=True)


def _save(results, tag, final=False):
    path = os.path.join(ARTIFACTS_DIR, f"bottleneck_trackH_results_{tag}.json")
    with open(path, "w") as f:
        json.dump({"results": results, "done": final}, f, indent=2, default=str)


if __name__ == "__main__":
    main()
