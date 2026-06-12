#!/usr/bin/env python3
"""
Standard WikiText-2 test-set PPL evaluation for MLX models.
Protocol: full test split, stride=512, sequence_length=512 (same as original paper measurements).
Usage: python eval_ppl_wikitext2.py --model <path_or_hf_id>

Supports checkpointing: saves NLLs to <model_dir>/ppl_checkpoint.json every 100 strides.
If a checkpoint exists, resumes from where it left off.
"""
import argparse
import json
import math
import os
import sys

import mlx.core as mx
import mlx.nn as nn
import numpy as np
from datasets import load_dataset
from mlx_lm.utils import load


def eval_wikitext2_ppl(model, tokenizer, stride=512, max_length=512, checkpoint_path=None):
    ds = load_dataset("wikitext", "wikitext-2-raw-v1", split="test")
    text = "\n\n".join(ds["text"])
    encodings = tokenizer.encode(text)
    tokens = mx.array(encodings)
    n = len(tokens)

    # Load checkpoint if exists
    nlls = []
    resume_from = 0
    if checkpoint_path and os.path.exists(checkpoint_path):
        with open(checkpoint_path) as f:
            ckpt = json.load(f)
        nlls = ckpt["nlls"]
        resume_from = ckpt["next_begin"]
        print(f"  Resuming from stride {resume_from}/{n} ({len(nlls)} strides done)")

    stride_count = 0
    for begin in range(resume_from, n - 1, stride):
        end = min(begin + max_length, n)
        chunk = tokens[begin:end]
        if len(chunk) < 2:
            break
        input_ids = chunk[:-1][None]   # (1, L-1)
        target_ids = chunk[1:]         # (L-1,)
        logits = model(input_ids)[0]   # (L-1, vocab)
        logits = logits.astype(mx.float32)
        loss = nn.losses.cross_entropy(logits, target_ids, reduction="mean")
        mx.eval(loss)
        nlls.append(loss.item())
        stride_count += 1
        sys.stdout.write(f"\r  stride {begin}/{n}  ({begin/n*100:.1f}%)")
        sys.stdout.flush()

        # Checkpoint every 100 strides
        if checkpoint_path and stride_count % 100 == 0:
            next_begin = begin + stride
            with open(checkpoint_path, "w") as f:
                json.dump({"nlls": nlls, "next_begin": next_begin, "n": n}, f)

    print()
    ppl = math.exp(sum(nlls) / len(nlls))

    # Save final checkpoint with PPL
    if checkpoint_path:
        with open(checkpoint_path, "w") as f:
            json.dump({"nlls": nlls, "next_begin": n, "n": n, "ppl": ppl, "done": True}, f)

    return ppl


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--stride", type=int, default=512)
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--no-checkpoint", action="store_true",
                        help="Disable checkpointing (original behavior)")
    args = parser.parse_args()

    # Checkpoint path: next to model dir
    checkpoint_path = None
    if not args.no_checkpoint:
        model_dir = args.model.rstrip("/")
        checkpoint_path = model_dir + "_ppl_checkpoint.json"
        print(f"Checkpoint: {checkpoint_path}")

    print(f"Loading {args.model} ...")
    model, tokenizer = load(args.model, tokenizer_config={"trust_remote_code": True})

    print("Evaluating WikiText-2 test PPL ...")
    ppl = eval_wikitext2_ppl(model, tokenizer, stride=args.stride,
                              max_length=args.max_length, checkpoint_path=checkpoint_path)
    print(f"PPL = {ppl:.4f}")


if __name__ == "__main__":
    main()
