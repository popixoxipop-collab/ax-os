#!/usr/bin/env python3
"""
Track A/B driver: swap a SpectralFilter into Qwen2.5-1.5B-Instruct's FFN
(Track A, model.model.layers[i].mlp) or attention output projection
(Track B, model.model.layers[i].self_attn.o_proj), measure C4 PPL zero-shot
and after a short calibration fine-tune.

Imports eval_c4_ppl/load_c4_text from eval/eval_ppl_c4.py UNMODIFIED.
See /Users/xox/.claude/plans/reactive-noodling-toucan.md for full spec.
"""
import argparse
import json
import os
import sys
import time

import numpy as np
import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
from mlx.utils import tree_flatten
from mlx_lm.utils import load

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "eval"))
from spectral_filter import SpectralFilter, ClusteredSpectralFilter, calibrate_init_std, output_rms  # noqa: E402
from eval_ppl_c4 import eval_c4_ppl, load_c4_text  # noqa: E402

MODEL_ID = "mlx-community/Qwen2.5-1.5B-Instruct-bf16"
BASELINE_PPL = 18.11
DIM = 1536
ARTIFACTS_DIR = os.path.join(_HERE, "..", "artifacts")
RESULTS_PATH = os.path.join(ARTIFACTS_DIR, "spectral_sweep_results.json")

PROBE_TEXT = ("The quick brown fox jumps over the lazy dog while the "
              "researchers carefully measured the output magnitude of each "
              "transformer sublayer across several representative sentences.")

ORIG_PARAMS = {"A": 3 * DIM * 8960, "B": DIM * DIM}  # FFN (gate+up+down), o_proj


def get_target(model, track, layer):
    block = model.model.layers[layer]
    if track == "A":
        return block, "mlp", block.mlp
    return block.self_attn, "o_proj", block.self_attn.o_proj


class _RMSRecorder(nn.Module):
    def __init__(self, wrapped):
        super().__init__()
        self.wrapped = wrapped
        self.last_rms = None

    def __call__(self, *args, **kwargs):
        out = self.wrapped(*args, **kwargs)
        self.last_rms = output_rms(out)
        return out


def measure_target_rms(model, tokenizer, track, layer):
    parent, attr, orig = get_target(model, track, layer)
    rec = _RMSRecorder(orig)
    setattr(parent, attr, rec)
    ids = mx.array(tokenizer.encode(PROBE_TEXT))[None]
    out = model(ids)
    mx.eval(out)
    rms = rec.last_rms
    setattr(parent, attr, orig)
    return rms


def swap_in(model, track, layer, K, init_std, seed):
    mx.random.seed(seed)
    parent, attr, orig = get_target(model, track, layer)
    new_mod = SpectralFilter(DIM, K=K, init_std=init_std)
    setattr(parent, attr, new_mod)
    return parent, attr, orig, new_mod


def restore(parent, attr, orig):
    setattr(parent, attr, orig)


def load_c4_text_slice(skip: int, num_docs: int) -> str:
    from datasets import load_dataset
    print(f"Loading C4 slice: skip={skip}, num_docs={num_docs} ...")
    ds = load_dataset("allenai/c4", "en", split="validation", streaming=True).skip(skip)
    docs = []
    for item in ds:
        docs.append(item["text"])
        if len(docs) >= num_docs:
            break
    text = "\n\n".join(docs)
    print(f"  slice docs: {len(docs)}, text length: {len(text):,} chars")
    return text


def run_zeroshot_config(model, tokenizer, c4_text, track, layer, K, init_mode, seed):
    if init_mode == "calibrated":
        target_rms = measure_target_rms(model, tokenizer, track, layer)
        init_std = calibrate_init_std(target_rms, dim=DIM, K=K, seed=seed)
    else:
        target_rms = None
        init_std = 0.02

    parent, attr, orig, new_mod = swap_in(model, track, layer, K, init_std, seed)
    ckpt_path = os.path.join(
        ARTIFACTS_DIR,
        f"qwen15b_spectral_track{track}_L{layer}_K{K}_{init_mode}_c4_ppl_checkpoint.json")

    t0 = time.time()
    ppl = eval_c4_ppl(model, tokenizer, c4_text, stride=512, max_length=512,
                       checkpoint_path=ckpt_path)
    dt = time.time() - t0

    orig_params = ORIG_PARAMS[track]
    ratio = orig_params / new_mod.num_params()
    delta_pct = (ppl - BASELINE_PPL) / BASELINE_PPL * 100.0

    result = dict(track=track, layer=layer, K=K, init_mode=init_mode,
                  init_std=init_std, target_rms=target_rms, ppl=ppl,
                  baseline_ppl=BASELINE_PPL, delta_pct=delta_pct,
                  orig_params=orig_params, new_params=new_mod.num_params(),
                  compression_ratio=ratio, wall_time_s=dt)

    restore(parent, attr, orig)
    print(f"  -> {track} L{layer} {init_mode}: PPL={ppl:.4f} DeltaPPL%={delta_pct:+.2f}% ({dt:.1f}s)",
          flush=True)
    return result


def run_finetune_config(model, tokenizer, c4_train_text, c4_eval_text, track, layer, K,
                         init_std, seed, epochs=2, lr=1e-3, dry_run_steps=None):
    parent, attr, orig, new_mod = swap_in(model, track, layer, K, init_std, seed)

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
                print(f"    [track={track} L{layer}] step {step}/{total_steps} "
                      f"loss={losses[-1]:.4f} elapsed={elapsed:.0f}s eta={eta:.0f}s",
                      flush=True)
            if dry_run_steps and step >= dry_run_steps:
                stop = True
                break
    dt = time.time() - t0

    result = dict(track=track, layer=layer, K=K, init_std=init_std,
                  n_trainable=n_trainable, steps=step, losses=losses,
                  first_loss=losses[0], last_loss=losses[-1],
                  loss_finite=all(l == l and abs(l) != float("inf") for l in losses),
                  wall_time_s=dt)

    if dry_run_steps:
        restore(parent, attr, orig)
        return result

    ckpt_path = os.path.join(
        ARTIFACTS_DIR,
        f"qwen15b_spectral_track{track}_L{layer}_K{K}_finetuned_c4_ppl_checkpoint.json")
    ppl = eval_c4_ppl(model, tokenizer, c4_eval_text, stride=512, max_length=512,
                       checkpoint_path=ckpt_path)
    delta_pct = (ppl - BASELINE_PPL) / BASELINE_PPL * 100.0
    result.update(ppl=ppl, baseline_ppl=BASELINE_PPL, delta_pct=delta_pct)

    restore(parent, attr, orig)
    print(f"  -> {track} L{layer} finetuned: PPL={ppl:.4f} DeltaPPL%={delta_pct:+.2f}% "
          f"(loss {losses[0]:.3f}->{losses[-1]:.3f}, {dt:.1f}s)", flush=True)
    return result


# D3: Track D (clustered spectral filter) reuses swap_in's target-finding
#     (get_target/measure_target_rms) and the same checkpoint/eval harness
#     calls as Track A/B, but never touches swap_in/run_zeroshot_config/
#     run_finetune_config themselves -- new functions only, so the 18
#     already-verified Track A/B measurements can't regress from this edit.
def swap_in_clustered(model, track, layer, K, init_std, num_clusters, seed):
    mx.random.seed(seed)
    parent, attr, orig = get_target(model, track, layer)
    new_mod = ClusteredSpectralFilter(DIM, num_clusters=num_clusters, K=K, init_std=init_std)
    setattr(parent, attr, new_mod)
    return parent, attr, orig, new_mod


def run_cluster_zeroshot_config(model, tokenizer, c4_text, track, layer, K, num_clusters, init_mode, seed):
    chunk_dim = DIM // num_clusters
    if init_mode == "calibrated":
        target_rms = measure_target_rms(model, tokenizer, track, layer)
        init_std = calibrate_init_std(target_rms, dim=chunk_dim, K=K, seed=seed)
    else:
        target_rms = None
        init_std = 0.02

    parent, attr, orig, new_mod = swap_in_clustered(model, track, layer, K, init_std, num_clusters, seed)
    ckpt_path = os.path.join(
        ARTIFACTS_DIR,
        f"qwen15b_spectral_track{track}_L{layer}_K{K}_G{num_clusters}_{init_mode}_c4_ppl_checkpoint.json")

    t0 = time.time()
    ppl = eval_c4_ppl(model, tokenizer, c4_text, stride=512, max_length=512, checkpoint_path=ckpt_path)
    dt = time.time() - t0

    orig_params = ORIG_PARAMS[track]
    ratio = orig_params / new_mod.num_params()
    delta_pct = (ppl - BASELINE_PPL) / BASELINE_PPL * 100.0

    result = dict(track=track, layer=layer, K=K, num_clusters=num_clusters, init_mode=init_mode,
                  init_std=init_std, target_rms=target_rms, ppl=ppl,
                  baseline_ppl=BASELINE_PPL, delta_pct=delta_pct,
                  orig_params=orig_params, new_params=new_mod.num_params(),
                  compression_ratio=ratio, wall_time_s=dt)

    restore(parent, attr, orig)
    print(f"  -> {track} L{layer} G{num_clusters} {init_mode}: PPL={ppl:.4f} DeltaPPL%={delta_pct:+.2f}% "
          f"params={new_mod.num_params()} ratio={ratio:.1f}x ({dt:.1f}s)", flush=True)
    return result


def run_cluster_finetune_config(model, tokenizer, c4_train_text, c4_eval_text, track, layer, K,
                                 num_clusters, init_std, seed, epochs=1, lr=1e-3):
    parent, attr, orig, new_mod = swap_in_clustered(model, track, layer, K, init_std, num_clusters, seed)

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
    total_steps = epochs * len(chunks)
    for _epoch in range(epochs):
        for chunk in chunks:
            input_ids = chunk[:-1][None]
            target_ids = chunk[1:]
            loss, grads = lg(model, input_ids, target_ids)
            optimizer.update(model, grads)
            mx.eval(loss, model.parameters(), optimizer.state)
            losses.append(loss.item())
            step += 1
            if step % 10 == 0 or step == total_steps:
                elapsed = time.time() - t0
                rate = elapsed / step
                eta = rate * (total_steps - step)
                print(f"    [track={track} L{layer} G{num_clusters}] step {step}/{total_steps} "
                      f"loss={losses[-1]:.4f} elapsed={elapsed:.0f}s eta={eta:.0f}s", flush=True)
    dt = time.time() - t0

    ckpt_path = os.path.join(
        ARTIFACTS_DIR,
        f"qwen15b_spectral_track{track}_L{layer}_K{K}_G{num_clusters}_finetuned_c4_ppl_checkpoint.json")
    ppl = eval_c4_ppl(model, tokenizer, c4_eval_text, stride=512, max_length=512, checkpoint_path=ckpt_path)
    delta_pct = (ppl - BASELINE_PPL) / BASELINE_PPL * 100.0

    result = dict(track=track, layer=layer, K=K, num_clusters=num_clusters, init_std=init_std,
                  n_trainable=n_trainable, steps=step,
                  first_loss=losses[0], last_loss=losses[-1],
                  loss_finite=all(l == l and abs(l) != float("inf") for l in losses),
                  wall_time_s=dt, ppl=ppl, baseline_ppl=BASELINE_PPL, delta_pct=delta_pct,
                  new_params=new_mod.num_params(),
                  compression_ratio=ORIG_PARAMS[track] / new_mod.num_params())

    restore(parent, attr, orig)
    print(f"  -> {track} L{layer} G{num_clusters} finetuned: PPL={ppl:.4f} DeltaPPL%={delta_pct:+.2f}% "
          f"(loss {losses[0]:.3f}->{losses[-1]:.3f}, {dt:.1f}s)", flush=True)
    return result


# D4: Track E -- activation-matching ("Theseus"-style teacher-mimic)
#     distillation instead of end-to-end CE fine-tuning.
#   WHY: user's observation -- CE fine-tuning routes an indirect signal
#        through 14 more frozen layers + a vocab-size softmax to reach a
#        ~6K-param filter; matching the filter's output directly against
#        the frozen original submodule's own output (MSE) is the direct
#        "BERT-of-Theseus" teacher-mimic objective already identified as
#        the right tool for this in the cleanlab-screen HANDOFF.md read
#        earlier this session ("Pure teacher-mimic: cleanlab adds little
#        -- supervision is the teacher's activations, not labels").
#   COST: needs a caching pass over the teacher's activations first (one
#        extra forward-only pass); doesn't test whether the *task* loss
#        (not just activation MSE) actually improves until the final
#        swap-in-and-eval-C4-PPL step -- a filter can match activations
#        well in MSE terms yet not translate to better PPL, so the final
#        eval_c4_ppl call is not optional here, it's the real verdict.
#   EXIT: if this doesn't help either, the bottleneck is very likely the
#        filter's functional FORM (spectral/gated structure itself), not
#        the training signal -- next step would be architecture search,
#        not more/better training.
class _IORecorder(nn.Module):
    """Wraps a target submodule and records every (input, output) pair it
    sees during a normal forward pass, without altering that pass's result."""
    def __init__(self, wrapped):
        super().__init__()
        self.wrapped = wrapped
        self.inputs = []
        self.outputs = []

    def __call__(self, x):
        out = self.wrapped(x)
        self.inputs.append(x)
        self.outputs.append(out)
        return out


def cache_teacher_io(model, tokenizer, track, layer, text, max_length=512, stride=512):
    """Runs the frozen original model forward over `text`, recording the
    target submodule's (input, output) pairs at every position. No gradient,
    no training -- this is the one-time cost of getting a direct supervision
    signal instead of routing through the rest of the network + CE loss."""
    parent, attr, orig = get_target(model, track, layer)
    rec = _IORecorder(orig)
    setattr(parent, attr, rec)

    ids = mx.array(tokenizer.encode(text))
    n_tok = len(ids)
    n_windows = 0
    for begin in range(0, n_tok - 1, stride):
        end = min(begin + max_length, n_tok)
        chunk = ids[begin:end]
        if len(chunk) < 2:
            break
        input_ids = chunk[:-1][None]
        out = model(input_ids)
        mx.eval(out)
        n_windows += 1

    restore(parent, attr, orig)

    inputs = mx.concatenate([i.reshape(-1, i.shape[-1]).astype(mx.float32) for i in rec.inputs], axis=0)
    targets = mx.concatenate([o.reshape(-1, o.shape[-1]).astype(mx.float32) for o in rec.outputs], axis=0)
    mx.eval(inputs, targets)
    print(f"  cached {n_windows} windows -> {inputs.shape[0]} token activations (dim={inputs.shape[1]})",
          flush=True)
    return inputs, targets


# D5: distillation init_std is calibrated per-(dim,K) via calibrate_init_std
#     (reusing Track A/D's own function), not a fixed constant, plus grad
#     clipping and a NaN-divergence guard.
#   WHY: K=16 (16 sequential multiplicative gate stages) diverged to NaN from
#        epoch 0 with a hardcoded init_std=0.1 that was fine for K=4 -- the
#        exact per-K sensitivity D1 in spectral_filter.py already documents
#        and calibrate_init_std already exists to handle; distill just never
#        called it. Confirmed via log: all 30 epochs train_mse=nan/val_mse=nan
#        for K=16, causing save_weights() to never fire (nan < best_val is
#        always False) and the subsequent load_weights() to crash on a
#        nonexistent file.
#   COST: one extra calibration forward pass per config (cheap, same as
#        Track A/D already pay).
#   EXIT: if a future K still diverges despite calibration + grad clipping,
#        the "diverged" result path below reports it cleanly instead of
#        crashing -- inspect train_log for the nan onset epoch.
def run_distill_config(model, tokenizer, tr_x, tr_y, val_x, val_y, c4_eval_text,
                        track, layer, K, num_clusters, seed, epochs, lr, batch_size, target_rms):
    mx.random.seed(seed)
    dim = tr_x.shape[1]
    chunk_dim = dim if num_clusters == 1 else dim // num_clusters
    init_std = calibrate_init_std(target_rms, dim=chunk_dim, K=K, seed=seed)
    if num_clusters == 1:
        new_mod = SpectralFilter(dim, K=K, init_std=init_std)
    else:
        new_mod = ClusteredSpectralFilter(dim, num_clusters=num_clusters, K=K, init_std=init_std)

    def loss_fn(m, x, y):
        pred = m(x).astype(mx.float32)
        return mx.mean((pred - y) ** 2)

    lg = nn.value_and_grad(new_mod, loss_fn)
    optimizer = optim.Adam(learning_rate=lr)

    n = tr_x.shape[0]
    best_val = float("inf")
    ckpt_path = os.path.join(ARTIFACTS_DIR, f"_distill_best_G{num_clusters}_K{K}_L{layer}.safetensors")
    log = []
    rng = np.random.RandomState(seed)
    t0 = time.time()
    for epoch in range(epochs):
        perm = rng.permutation(n)
        train_losses = []
        for i in range(0, n - batch_size + 1, batch_size):
            idx = mx.array(perm[i:i + batch_size])
            x_b, y_b = tr_x[idx], tr_y[idx]
            loss, grads = lg(new_mod, x_b, y_b)
            grads, _ = optim.clip_grad_norm(grads, max_norm=1.0)
            optimizer.update(new_mod, grads)
            mx.eval(loss, new_mod.parameters(), optimizer.state)
            train_losses.append(loss.item())
        val_loss_arr = loss_fn(new_mod, val_x, val_y)
        mx.eval(val_loss_arr)
        val_loss = val_loss_arr.item()
        train_loss_avg = sum(train_losses) / len(train_losses)
        log.append(dict(epoch=epoch, train_mse=train_loss_avg, val_mse=val_loss))
        print(f"    [distill G{num_clusters} K{K} L{layer}] epoch {epoch}: "
              f"train_mse={train_loss_avg:.6f} val_mse={val_loss:.6f} init_std={init_std:.4f}", flush=True)
        if val_loss == val_loss and val_loss < best_val:  # val_loss==val_loss excludes NaN
            best_val = val_loss
            new_mod.save_weights(ckpt_path)
    dt_train = time.time() - t0

    if best_val == float("inf"):
        print(f"  -> distill {track} L{layer} G{num_clusters} K{K}: DIVERGED "
              f"(all {epochs} epochs nan/inf, init_std={init_std:.4f}) -- skipping eval", flush=True)
        return dict(track=track, layer=layer, K=K, num_clusters=num_clusters,
                     diverged=True, init_std=init_std, train_log=log,
                     new_params=new_mod.num_params(),
                     compression_ratio=ORIG_PARAMS[track] / new_mod.num_params())

    new_mod.load_weights(ckpt_path)  # restore best-val checkpoint, not necessarily the last epoch

    parent, attr, orig = get_target(model, track, layer)
    setattr(parent, attr, new_mod)
    eval_ckpt_path = os.path.join(
        ARTIFACTS_DIR,
        f"qwen15b_spectral_track{track}_L{layer}_K{K}_G{num_clusters}_distilled_c4_ppl_checkpoint.json")
    t0e = time.time()
    ppl = eval_c4_ppl(model, tokenizer, c4_eval_text, stride=512, max_length=512,
                       checkpoint_path=eval_ckpt_path)
    dt_eval = time.time() - t0e
    delta_pct = (ppl - BASELINE_PPL) / BASELINE_PPL * 100.0
    orig_params = ORIG_PARAMS[track]
    ratio = orig_params / new_mod.num_params()
    restore(parent, attr, orig)

    result = dict(track=track, layer=layer, K=K, num_clusters=num_clusters,
                  diverged=False, init_std=init_std,
                  best_val_mse=best_val, train_log=log,
                  ppl=ppl, baseline_ppl=BASELINE_PPL, delta_pct=delta_pct,
                  orig_params=orig_params, new_params=new_mod.num_params(),
                  compression_ratio=ratio, train_time_s=dt_train, eval_time_s=dt_eval)
    print(f"  -> distill {track} L{layer} G{num_clusters} K{K}: best_val_mse={best_val:.6f} "
          f"PPL={ppl:.4f} DeltaPPL%={delta_pct:+.2f}% ratio={ratio:.1f}x "
          f"(train {dt_train:.1f}s, eval {dt_eval:.1f}s)", flush=True)
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", choices=["zeroshot", "dryrun", "finetune",
                                         "cluster-zeroshot", "cluster-finetune",
                                         "distill"], required=True)
    ap.add_argument("--K", type=int, default=4)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--num-docs", type=int, default=200)
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--dry-run-steps", type=int, default=25)
    ap.add_argument("--num-clusters", type=str, default="2,4,8,16",
                    help="comma-separated cluster counts for cluster-zeroshot/cluster-finetune/distill")
    ap.add_argument("--cluster-track", type=str, default="A")
    ap.add_argument("--cluster-layer", type=int, default=14)
    ap.add_argument("--distill-k", type=str, default="4,16",
                    help="comma-separated K values to try for the distill phase")
    ap.add_argument("--distill-epochs", type=int, default=30)
    ap.add_argument("--distill-lr", type=float, default=1e-3)
    ap.add_argument("--distill-batch-size", type=int, default=256)
    args = ap.parse_args()

    os.makedirs(ARTIFACTS_DIR, exist_ok=True)

    print(f"Loading model: {MODEL_ID} ...")
    t0 = time.time()
    model, tokenizer = load(MODEL_ID)
    print(f"  loaded in {time.time()-t0:.2f}s")

    layers = [4, 14, 24]
    tracks = ["A", "B"]

    if args.phase == "zeroshot":
        c4_text = load_c4_text(args.num_docs)
        results = []
        for track in tracks:
            for layer in layers:
                for mode in ["calibrated", "noop"]:
                    r = run_zeroshot_config(model, tokenizer, c4_text, track, layer,
                                             args.K, mode, args.seed)
                    results.append(r)
                    _save(results, "zeroshot")
        _save(results, "zeroshot", final=True)

    elif args.phase == "dryrun":
        c4_train = load_c4_text_slice(200, 400)
        track, layer = "A", 14
        target_rms = measure_target_rms(model, tokenizer, track, layer)
        init_std = calibrate_init_std(target_rms, dim=DIM, K=args.K, seed=args.seed)
        r = run_finetune_config(model, tokenizer, c4_train, None, track, layer, args.K,
                                 init_std, args.seed, epochs=1, lr=args.lr,
                                 dry_run_steps=args.dry_run_steps)
        print(json.dumps({k: v for k, v in r.items() if k != "losses"}, indent=2))
        print("losses:", r["losses"])

    elif args.phase == "finetune":
        c4_train = load_c4_text_slice(200, 400)
        c4_eval = load_c4_text(args.num_docs)
        results = []
        for track in tracks:
            for layer in layers:
                target_rms = measure_target_rms(model, tokenizer, track, layer)
                init_std = calibrate_init_std(target_rms, dim=DIM, K=args.K, seed=args.seed)
                r = run_finetune_config(model, tokenizer, c4_train, c4_eval, track, layer,
                                         args.K, init_std, args.seed, epochs=args.epochs,
                                         lr=args.lr, dry_run_steps=None)
                results.append(r)
                _save(results, "finetune")
        _save(results, "finetune", final=True)

    elif args.phase == "cluster-zeroshot":
        c4_text = load_c4_text(args.num_docs)
        clusters = [int(x) for x in args.num_clusters.split(",")]
        results = []
        for g in clusters:
            for mode in ["calibrated", "noop"]:
                r = run_cluster_zeroshot_config(model, tokenizer, c4_text, args.cluster_track,
                                                 args.cluster_layer, args.K, g, mode, args.seed)
                results.append(r)
                _save(results, "cluster_zeroshot")
        _save(results, "cluster_zeroshot", final=True)

    elif args.phase == "cluster-finetune":
        c4_train = load_c4_text_slice(200, 400)
        c4_eval = load_c4_text(args.num_docs)
        clusters = [int(x) for x in args.num_clusters.split(",")]
        results = []
        for g in clusters:
            target_rms = measure_target_rms(model, tokenizer, args.cluster_track, args.cluster_layer)
            chunk_dim = DIM // g
            init_std = calibrate_init_std(target_rms, dim=chunk_dim, K=args.K, seed=args.seed)
            r = run_cluster_finetune_config(model, tokenizer, c4_train, c4_eval, args.cluster_track,
                                             args.cluster_layer, args.K, g, init_std, args.seed,
                                             epochs=args.epochs, lr=args.lr)
            results.append(r)
            _save(results, "cluster_finetune")
        _save(results, "cluster_finetune", final=True)

    elif args.phase == "distill":
        c4_train_text = load_c4_text_slice(200, 400)
        c4_eval = load_c4_text(args.num_docs)
        all_x, all_y = cache_teacher_io(model, tokenizer, args.cluster_track,
                                         args.cluster_layer, c4_train_text)
        target_rms = output_rms(all_y)
        print(f"  teacher output target_rms = {target_rms:.4f}")
        n = all_x.shape[0]
        rng = np.random.RandomState(args.seed)
        perm = rng.permutation(n)
        n_val = max(1, n // 10)
        val_idx = mx.array(perm[:n_val])
        tr_idx = mx.array(perm[n_val:])
        tr_x, tr_y = all_x[tr_idx], all_y[tr_idx]
        val_x, val_y = all_x[val_idx], all_y[val_idx]
        mx.eval(tr_x, tr_y, val_x, val_y)
        print(f"  distill split: {tr_x.shape[0]} train / {val_x.shape[0]} val token activations")

        clusters = [int(x) for x in args.num_clusters.split(",")]
        ks = [int(x) for x in args.distill_k.split(",")]
        results = []
        for g in clusters:
            for k in ks:
                r = run_distill_config(model, tokenizer, tr_x, tr_y, val_x, val_y, c4_eval,
                                        args.cluster_track, args.cluster_layer, k, g, args.seed,
                                        epochs=args.distill_epochs, lr=args.distill_lr,
                                        batch_size=args.distill_batch_size, target_rms=target_rms)
                results.append(r)
                _save(results, "distill")
        _save(results, "distill", final=True)


def _save(results, tag, final=False):
    path = RESULTS_PATH.replace(".json", f"_{tag}.json")
    with open(path, "w") as f:
        json.dump({"results": results, "done": final}, f, indent=2, default=str)


if __name__ == "__main__":
    main()
