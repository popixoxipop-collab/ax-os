#!/usr/bin/env python3
"""
Track C driver: cross-model hidden-state bridge (BridgeModule/BridgedBlock)
between Qwen2.5-1.5B-Instruct (recipient, frozen) and a 7B donor (Qwen2.5-7B
or Mistral-7B-v0.3, one MLP layer used, frozen). Only the bridge's P_up/
P_down/alpha are trained. See /Users/xox/.claude/plans/reactive-noodling-toucan.md.

Usage:
  python scripts/run_bridge_experiment.py --donor-model-id mlx-community/Qwen2.5-7B-Instruct-bf16 \
      --donor-layer 14 --insertion-layer 14 --tag qwen7b --timing-only
  python scripts/run_bridge_experiment.py --donor-model-id mlx-community/Qwen2.5-7B-Instruct-bf16 \
      --donor-layer 14 --insertion-layer 14 --tag qwen7b
"""

# D3: insertion_layer=14 (recipient & Qwen7B donor, both 28 layers) / 16 for
#     the Mistral-7B donor (round(14/28*32), same fractional midpoint) --
#     a single "each network's own approximate midpoint" heuristic, not a
#     re-derived finding.
#   WHY: family-agnostic prior (middle layers carry more transferable
#        representations) requiring no per-model empirical study to justify
#        as a v1 starting point -- copying the original Chimera's Gemma-
#        specific indices (E2B layer 12, donor L24) onto an unrelated model
#        family would have no more justification than any other guess.
#   COST: unlike the original's Born-Oracle-driven L24 choice, this is NOT
#        empirically validated for Qwen/Mistral. If v1 results are weak or
#        ambiguous, this is the first thing to suspect.
#   EXIT: run the lightweight stretch search from the plan -- short (2-epoch)
#        training runs at a few candidate layers, rank by dev-slice PPL,
#        commit the full 5-epoch run only to the winner.
#
# D4: N=1 donor layer (not the original's 9-layer L24-32 stack).
#   WHY: directly implements the original Chimera project's OWN ablation
#        finding (FINDINGS.md: L24 alone matched/beat the full 9-layer
#        stack; L25-28 measured to be pure noise) -- not a corner cut.
#   COST: that finding was established on Gemma4/31B, not re-validated here.
#        If N=1 underperforms on Qwen7B/Mistral7B, insufficient bridge
#        capacity (not the layer count itself) is the first thing to
#        suspect, per the plan's risk section.
#   EXIT: pass more than one index in attach_donor_layers(donor, [...]) --
#        already supported by its loop, zero code change needed elsewhere.
#
# D5: training data = C4 docs [200:600) (400 docs), disjoint from eval's
#     [0:200) slice; no PLI alignment loss term.
#   WHY (data): the success metric IS C4 PPL specifically, so training on
#        C4-distributed text directly matches the eval distribution and
#        reuses already-validated data-loading code, instead of porting the
#        original's 5-domain (arc/math/code/commonsense/science) loaders.
#   WHY (no PLI): the original repo's own README documents PLI
#        (embed_tokens_per_layer) as Gemma4-exclusive; no Qwen/Mistral
#        equivalent exists to port.
#   COST: doesn't test task-accuracy transfer (ARC-C/GSM8K-style) the way
#        the original's domain-mix training did; that's a different,
#        unexplored experiment. Pure CE-only training may converge
#        differently than the original's CE+PLI objective did.
#   EXIT: swap load_train_text for a domain-mixed loader if task-accuracy
#        signal is later wanted; no known PLI substitute exists for non-
#        Gemma architectures without inventing a new mechanism (out of scope).
import argparse
import json
import os
import sys
import time

import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
from mlx.utils import tree_flatten
from mlx_lm.utils import load

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "eval"))
from bridge_module import BridgeModule, BridgedBlock
from eval_ppl_c4 import eval_c4_ppl, load_c4_text

RECIPIENT_ID = "mlx-community/Qwen2.5-1.5B-Instruct-bf16"
RECIPIENT_DIM = 1536
BASELINE_PPL = 18.11
ARTIFACTS_DIR = os.path.join(os.path.dirname(__file__), "..", "artifacts")


def load_train_text(skip_docs, num_docs):
    from datasets import load_dataset
    ds = load_dataset("allenai/c4", "en", split="validation", streaming=True)
    ds = ds.skip(skip_docs).take(num_docs)
    docs = [item["text"] for item in ds]
    text = "\n\n".join(docs)
    print(f"  train docs: {len(docs)}, text length: {len(text):,} chars")
    return text


def build_windows(tokenizer, text, max_length=512, stride=512):
    """Only keeps FULL-length windows (drops a possibly-short final window)
    so they can be stacked into uniform-shape batches."""
    tokens = mx.array(tokenizer.encode(text))
    n = len(tokens)
    windows = []
    for begin in range(0, n - 1, stride):
        end = min(begin + max_length, n)
        chunk = tokens[begin:end]
        if len(chunk) < max_length:
            break
        windows.append((chunk[:-1], chunk[1:]))
    return windows


def batch_windows(windows, batch_size):
    """Groups (seq_len,) window pairs into (batch_size, seq_len) batches,
    dropping a final incomplete batch."""
    batches = []
    for i in range(0, len(windows) - batch_size + 1, batch_size):
        group = windows[i:i + batch_size]
        input_ids = mx.stack([g[0] for g in group])
        target_ids = mx.stack([g[1] for g in group])
        batches.append((input_ids, target_ids))
    return batches


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--donor-model-id", required=True)
    p.add_argument("--donor-layer", type=int, required=True)
    p.add_argument("--insertion-layer", type=int, default=14)
    p.add_argument("--tag", required=True)
    p.add_argument("--timing-only", action="store_true")
    p.add_argument("--timing-steps", type=int, default=10)
    p.add_argument("--num-train-docs", type=int, default=400)
    p.add_argument("--skip-docs", type=int, default=200)
    p.add_argument("--epochs", type=int, default=5)
    p.add_argument("--batch-size", type=int, default=4)
    p.add_argument("--lr-init", type=float, default=3e-4)
    p.add_argument("--lr-end", type=float, default=3e-5)
    p.add_argument("--eval-num-docs", type=int, default=200)
    args = p.parse_args()

    print(f"=== Track C bridge experiment: tag={args.tag} donor={args.donor_model_id} "
          f"donor_layer={args.donor_layer} insertion_layer={args.insertion_layer} ===")

    print("Loading recipient...")
    recipient, tokenizer = load(RECIPIENT_ID)
    print("Loading donor...")
    donor, _ = load(args.donor_model_id)

    donor_dim = donor.model.layers[0].mlp.gate_proj.weight.shape[1]
    print(f"  donor_dim (inferred) = {donor_dim}")

    bridge = BridgeModule(recipient_dim=RECIPIENT_DIM, donor_dim=donor_dim, alpha_init=0.1)
    bridge.attach_donor_layers(donor, [args.donor_layer])

    original_block = recipient.model.layers[args.insertion_layer]
    recipient.model.layers[args.insertion_layer] = BridgedBlock(original_block, bridge)

    # Freeze choreography: freeze everything in both models, then unfreeze
    # only the bridge's own P_up/P_down/alpha. Explicit donor.freeze() too,
    # independent of whatever recipient.freeze() reaches via shared refs.
    recipient.freeze()
    donor.freeze()
    bridge.P_up.unfreeze()
    bridge.P_down.unfreeze()
    bridge.unfreeze(keys="alpha", recurse=False)

    trainable = dict(tree_flatten(recipient.trainable_parameters()))
    n_trainable = sum(v.size for v in trainable.values())
    print(f"  trainable params: {n_trainable:,} across {len(trainable)} leaves: {list(trainable.keys())}")

    def loss_fn(model, input_ids, target_ids):
        logits = model(input_ids).astype(mx.float32)
        return nn.losses.cross_entropy(logits, target_ids, reduction="mean")

    loss_and_grad = nn.value_and_grad(recipient, loss_fn)

    print(f"Loading training text (C4 docs [{args.skip_docs}:{args.skip_docs + args.num_train_docs}))...")
    train_text = load_train_text(args.skip_docs, args.num_train_docs)
    windows = build_windows(tokenizer, train_text, max_length=512, stride=512)
    print(f"  {len(windows)} training windows (pre-batching)")
    batches = batch_windows(windows, args.batch_size)
    print(f"  {len(batches)} batches of size {args.batch_size}")

    total_steps = args.epochs * len(batches)
    schedule = optim.cosine_decay(args.lr_init, total_steps, args.lr_end)
    optimizer = optim.AdamW(learning_rate=schedule, weight_decay=0.01)

    def run_step(input_ids, target_ids):
        loss, grads = loss_and_grad(recipient, input_ids, target_ids)
        grads, _ = optim.clip_grad_norm(grads, max_norm=1.0)
        optimizer.update(recipient, grads)
        mx.eval(recipient.parameters(), optimizer.state, loss)
        return loss.item()

    if args.timing_only:
        print(f"=== TIMING CHECK: {args.timing_steps} steps (batch_size={args.batch_size}) ===")
        t0 = time.time()
        for i in range(args.timing_steps):
            input_ids, target_ids = batches[i % len(batches)]
            t_step0 = time.time()
            loss = run_step(input_ids, target_ids)
            print(f"  step {i}: loss={loss:.4f}  time={time.time() - t_step0:.3f}s")
        total = time.time() - t0
        print(f"TOTAL for {args.timing_steps} steps: {total:.2f}s ({total / args.timing_steps:.3f}s/step)")
        print(f"Extrapolated full run ({total_steps} steps, {args.epochs} epochs): "
              f"{total / args.timing_steps * total_steps / 60:.1f} min")
        return

    n_val = max(1, len(batches) // 5)
    train_batches = batches[:-n_val] if len(batches) > n_val else batches
    val_batches = batches[-n_val:] if len(batches) > n_val else batches
    print(f"  train batches: {len(train_batches)}  val batches: {len(val_batches)}")

    log = []
    for epoch in range(args.epochs):
        t_epoch = time.time()
        train_losses = [run_step(i, t) for i, t in train_batches]
        val_losses = []
        for input_ids, target_ids in val_batches:
            logits = recipient(input_ids).astype(mx.float32)
            vloss = nn.losses.cross_entropy(logits, target_ids, reduction="mean")
            mx.eval(vloss)
            val_losses.append(vloss.item())
        alpha_val = bridge.alpha.item()
        rec = {
            "epoch": epoch,
            "train_ce": sum(train_losses) / len(train_losses),
            "val_ce": sum(val_losses) / len(val_losses),
            "alpha": alpha_val,
            "time_s": time.time() - t_epoch,
        }
        log.append(rec)
        print(f"  epoch {epoch}: train_ce={rec['train_ce']:.4f} val_ce={rec['val_ce']:.4f} "
              f"alpha={alpha_val:.4f} time={rec['time_s']:.1f}s")

    os.makedirs(ARTIFACTS_DIR, exist_ok=True)
    with open(os.path.join(ARTIFACTS_DIR, f"bridge_{args.tag}_train_log.json"), "w") as f:
        json.dump(log, f, indent=2)

    trained_params = dict(tree_flatten(recipient.trainable_parameters()))
    mx.save_safetensors(os.path.join(ARTIFACTS_DIR, f"bridge_{args.tag}_trained.safetensors"), trained_params)
    print(f"  saved trainable checkpoint ({len(trained_params)} leaves)")

    trained_alpha = bridge.alpha.item()

    print("=== SANITY CHECK: forcing alpha=0, re-evaluating (should reproduce ~18.11) ===")
    bridge.alpha = mx.array(0.0, dtype=mx.float32)
    mx.eval(bridge.alpha)

    eval_text = load_c4_text(args.eval_num_docs)
    sanity_ppl = eval_c4_ppl(
        recipient, tokenizer, eval_text, stride=512, max_length=512,
        checkpoint_path=os.path.join(ARTIFACTS_DIR, f"bridge_{args.tag}_alpha0_sanity_c4_ppl_checkpoint.json"))
    print(f"  alpha=0 sanity PPL = {sanity_ppl:.4f}  (baseline={BASELINE_PPL}, delta={sanity_ppl - BASELINE_PPL:+.4f})")

    sanity_ok = abs(sanity_ppl - BASELINE_PPL) < 0.5
    if not sanity_ok:
        print("  *** SANITY CHECK FAILED -- alpha=0 did not reproduce baseline. "
              "This indicates a bug in the insertion/wrapping mechanism, NOT a bridge-effectiveness finding. ***")

    bridge.alpha = mx.array(trained_alpha, dtype=mx.float32)
    mx.eval(bridge.alpha)
    print(f"=== REAL EVAL: alpha={trained_alpha:.4f} ===")
    real_ppl = eval_c4_ppl(
        recipient, tokenizer, eval_text, stride=512, max_length=512,
        checkpoint_path=os.path.join(ARTIFACTS_DIR, f"bridge_{args.tag}_c4_ppl_checkpoint.json"))
    delta_pct = (real_ppl - BASELINE_PPL) / BASELINE_PPL * 100
    print(f"  real PPL = {real_ppl:.4f}  DeltaPPL% = {delta_pct:+.2f}%  (baseline={BASELINE_PPL})")

    summary = {
        "tag": args.tag,
        "donor_model_id": args.donor_model_id,
        "donor_layer": args.donor_layer,
        "insertion_layer": args.insertion_layer,
        "donor_dim": donor_dim,
        "n_trainable_params": n_trainable,
        "sanity_alpha0_ppl": sanity_ppl,
        "sanity_ok": sanity_ok,
        "trained_alpha": trained_alpha,
        "real_ppl": real_ppl,
        "baseline_ppl": BASELINE_PPL,
        "delta_ppl_pct": delta_pct,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "total_steps": args.epochs * len(train_batches),
        "train_log": log,
    }
    with open(os.path.join(ARTIFACTS_DIR, f"bridge_{args.tag}_summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    print(f"Summary saved to artifacts/bridge_{args.tag}_summary.json")


if __name__ == "__main__":
    main()
