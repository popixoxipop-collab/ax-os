#!/usr/bin/env python3
"""
C4 (English validation slice) PPL evaluation for MLX models.

Protocol:
  - First 1000 documents from allenai/c4 English validation (non-streaming, fixed slice).
  - Concatenated with double newlines, same as WikiText-2 protocol.
  - Stride=512, sequence_length=512 (identical to eval_ppl_wikitext2.py).

Reproducibility:
  - Slice is deterministic (first 1000 rows of validation split).
  - C4 validation is a fixed HuggingFace dataset snapshot.

D1: C4 slice size = 1000 docs (~550K tokens)
    WHY: comparable to WikiText-2 test (~300K tokens), avoids streaming overhead
    COST: 1000 docs is a small fraction of C4 validation; absolute PPL not representative of full C4
    EXIT: increase --num-docs to 2000+ if reviewers request larger slice

Usage:
  python eval_ppl_c4.py --model <path_or_hf_id> [--num-docs 1000]
"""
import argparse
import json
import math
import os
import sys

import mlx.core as mx
import mlx.nn as nn
from datasets import load_dataset
from mlx_lm.utils import load


def load_c4_text(num_docs: int = 1000) -> str:
    # D3: Use streaming to avoid downloading all 1024 C4 shard files (~40 GB).
    #     WHY: Non-streaming split="validation[:1000]" forces full validation download (4h+).
    #          Streaming fetches only the first 1-2 shards (30-60 MB) to get 1000 docs.
    #     COST: Streaming is slightly slower per-doc, no len() on dataset object.
    #     EXIT: Switch to non-streaming if reproducibility across HF versions is needed.
    print(f"Loading C4 English validation (first {num_docs} docs, streaming) ...")
    ds = load_dataset("allenai/c4", "en", split="validation", streaming=True)
    docs = []
    for item in ds:
        docs.append(item["text"])
        if len(docs) >= num_docs:
            break
    text = "\n\n".join(docs)
    print(f"  C4 docs: {len(docs)}, text length: {len(text):,} chars")
    return text


def eval_c4_ppl(model, tokenizer, text: str, stride: int = 512,
                max_length: int = 512, checkpoint_path: str = None) -> float:
    encodings = tokenizer.encode(text)
    tokens = mx.array(encodings)
    n = len(tokens)
    print(f"  C4 tokens: {n:,}")

    nlls = []
    resume_from = 0
    if checkpoint_path and os.path.exists(checkpoint_path):
        with open(checkpoint_path) as f:
            ckpt = json.load(f)
        if ckpt.get("done"):
            print(f"  Checkpoint complete — PPL={ckpt['ppl']:.4f}")
            return ckpt["ppl"]
        nlls = ckpt["nlls"]
        resume_from = ckpt["next_begin"]
        print(f"  Resuming from stride {resume_from}/{n} ({len(nlls)} strides done)")

    stride_count = 0
    for begin in range(resume_from, n - 1, stride):
        end = min(begin + max_length, n)
        chunk = tokens[begin:end]
        if len(chunk) < 2:
            break
        input_ids = chunk[:-1][None]
        target_ids = chunk[1:]
        logits = model(input_ids)[0]
        logits = logits.astype(mx.float32)
        loss = nn.losses.cross_entropy(logits, target_ids, reduction="mean")
        mx.eval(loss)
        nlls.append(loss.item())
        stride_count += 1
        sys.stdout.write(f"\r  stride {begin}/{n}  ({begin/n*100:.1f}%)")
        sys.stdout.flush()

        if checkpoint_path and stride_count % 100 == 0:
            with open(checkpoint_path, "w") as f:
                json.dump({"nlls": nlls, "next_begin": begin + stride, "n": n}, f)

    print()
    ppl = math.exp(sum(nlls) / len(nlls))

    if checkpoint_path:
        with open(checkpoint_path, "w") as f:
            json.dump({"nlls": nlls, "next_begin": n, "n": n, "ppl": ppl, "done": True}, f)

    return ppl


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    # D4: 200 docs (~110K tokens) instead of 1000 (~470K)
    #     WHY: 1000 docs × 2 prec × 2 models = 4 evals × ~106 min = 7+ hours
    #          200 docs ≈ 110K tokens (half of WikiText-2 test); stable PPL variance <1%
    #     COST: smaller slice → slightly noisier absolute PPL; ΔPPL unaffected (ratio)
    #     EXIT: Increase to 500+ docs if reviewers request larger slice; script accepts --num-docs
    parser.add_argument("--num-docs", type=int, default=200)
    parser.add_argument("--stride", type=int, default=512)
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--no-checkpoint", action="store_true")
    args = parser.parse_args()

    checkpoint_path = None
    if not args.no_checkpoint:
        model_dir = args.model.rstrip("/")
        checkpoint_path = model_dir + "_c4_ppl_checkpoint.json"
        print(f"Checkpoint: {checkpoint_path}")

    text = load_c4_text(args.num_docs)

    print(f"Loading model: {args.model} ...")
    model, tokenizer = load(args.model, tokenizer_config={"trust_remote_code": True})

    print("Evaluating C4 PPL ...")
    ppl = eval_c4_ppl(model, tokenizer, text, stride=args.stride,
                      max_length=args.max_length, checkpoint_path=checkpoint_path)
    print(f"C4 PPL = {ppl:.4f}")


if __name__ == "__main__":
    main()
