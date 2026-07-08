#!/usr/bin/env python3
"""
Track F driver: swap DenseFFTBottleneck (F1) / DenseBottleneck (F2) into
Qwen2.5-1.5B-Instruct's FFN at L14 (model.model.layers[14].mlp), measure C4
PPL zero-shot (noop + calibrated init) and after a short fine-tune. See
eval/bottleneck_filter.py for the module implementations and design rationale
(D1-D4), and ../SPECTRAL_LLM_SURGERY_FINDINGS.md for the Track A-E context
this follow-up tests.

Reuses get_target/measure_target_rms/restore/load_c4_text_slice/MODEL_ID/
BASELINE_PPL/DIM from run_spectral_swap.py UNMODIFIED (track="A" there maps
exactly to model.model.layers[i].mlp, which is all Track F ever touches), and
eval_c4_ppl/load_c4_text from eval_ppl_c4.py UNMODIFIED. Track A-E's own
files/artifacts are never written to by this script.
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
from bottleneck_filter import DenseFFTBottleneck, DenseBottleneck, calibrate_init_std_bottleneck, output_rms  # noqa: E402
from eval_ppl_c4 import eval_c4_ppl, load_c4_text  # noqa: E402
from run_spectral_swap import (  # noqa: E402
    get_target, measure_target_rms, restore, load_c4_text_slice,
    MODEL_ID, BASELINE_PPL, DIM,
)
from mlx_lm.utils import load  # noqa: E402

LAYER = 14  # D4 in bottleneck_filter.py: fixed at L14, not re-sweeping
RANK = 8    # D3 in bottleneck_filter.py: matches Track E K=16 budget (24,608)
TRACK = "A"  # get_target(model, "A", layer) -> (block, "mlp", block.mlp)
ARTIFACTS_DIR = os.path.join(_HERE, "..", "artifacts")
ORIG_FFN_PARAMS = 3 * DIM * 8960  # gate_proj + up_proj + down_proj, matches ORIG_PARAMS["A"]

ARMS = {
    "F1": DenseFFTBottleneck,
    "F2": DenseBottleneck,
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
    print(f"  -> {arm} L{LAYER} {init_mode}: PPL={ppl:.4f} DeltaPPL%={delta_pct:+.2f}% "
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
    print(f"  -> {arm} L{LAYER} finetuned: PPL={ppl:.4f} DeltaPPL%={delta_pct:+.2f}% "
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
    ap.add_argument("--arm", type=str, default="F1", choices=["F1", "F2"])
    args = ap.parse_args()

    os.makedirs(ARTIFACTS_DIR, exist_ok=True)

    print(f"Loading model: {MODEL_ID} ...")
    t0 = time.time()
    model, tokenizer = load(MODEL_ID)
    print(f"  loaded in {time.time()-t0:.2f}s")

    if args.phase == "dryrun":
        target_rms = measure_target_rms(model, tokenizer, TRACK, LAYER)
        cls = ARMS[args.arm]
        factory = lambda std: cls(DIM, rank=RANK, init_std=std)  # noqa: E731
        init_std = calibrate_init_std_bottleneck(factory, target_rms, dim=DIM, seed=args.seed)
        c4_train = load_c4_text_slice(200, 400)
        r = run_finetune_config(model, tokenizer, c4_train, None, args.arm, init_std,
                                 args.seed, epochs=1, lr=args.lr,
                                 dry_run_steps=args.dry_run_steps)
        print(json.dumps({k: v for k, v in r.items() if k != "losses"}, indent=2))
        print("losses:", r["losses"])

    elif args.phase == "zeroshot":
        c4_text = load_c4_text(args.num_docs)
        results = []
        for arm in ["F1", "F2"]:
            for mode in ["calibrated", "noop"]:
                r = run_zeroshot_config(model, tokenizer, c4_text, arm, mode, args.seed)
                results.append(r)
                _save(results, "zeroshot")
        _save(results, "zeroshot", final=True)

    elif args.phase == "finetune":
        c4_train = load_c4_text_slice(200, 400)
        c4_eval = load_c4_text(args.num_docs)
        results = []
        arms_to_run = [args.arm] if args.arm else ["F1", "F2"]
        for arm in arms_to_run:
            target_rms = measure_target_rms(model, tokenizer, TRACK, LAYER)
            cls = ARMS[arm]
            factory = lambda std, cls=cls: cls(DIM, rank=RANK, init_std=std)  # noqa: E731
            init_std = calibrate_init_std_bottleneck(factory, target_rms, dim=DIM, seed=args.seed)
            r = run_finetune_config(model, tokenizer, c4_train, c4_eval, arm, init_std,
                                     args.seed, epochs=args.epochs, lr=args.lr,
                                     dry_run_steps=None)
            results.append(r)
            _save(results, "finetune")
        _save(results, "finetune", final=True)


def _save(results, tag, final=False):
    path = os.path.join(ARTIFACTS_DIR, f"bottleneck_trackF_results_{tag}.json")
    with open(path, "w") as f:
        json.dump({"results": results, "done": final}, f, indent=2, default=str)


if __name__ == "__main__":
    main()
