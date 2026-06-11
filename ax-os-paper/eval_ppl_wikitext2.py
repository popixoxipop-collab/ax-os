#!/usr/bin/env python3
"""
Standard WikiText-2 test-set PPL evaluation for MLX models.
Protocol: full test split, stride=512, sequence_length=512 (same as original paper measurements).
Usage: python eval_ppl_wikitext2.py --model <path_or_hf_id>
"""
import argparse
import math
import sys

import mlx.core as mx
import mlx.nn as nn
import numpy as np
from datasets import load_dataset
from mlx_lm.utils import load


def eval_wikitext2_ppl(model, tokenizer, stride=512, max_length=512):
    ds = load_dataset("wikitext", "wikitext-2-raw-v1", split="test")
    text = "\n\n".join(ds["text"])
    encodings = tokenizer.encode(text)
    tokens = mx.array(encodings)
    n = len(tokens)

    nlls = []
    for begin in range(0, n - 1, stride):
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
        sys.stdout.write(f"\r  stride {begin}/{n}")
        sys.stdout.flush()

    print()
    ppl = math.exp(sum(nlls) / len(nlls))
    return ppl


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--stride", type=int, default=512)
    parser.add_argument("--max-length", type=int, default=512)
    args = parser.parse_args()

    print(f"Loading {args.model} ...")
    model, tokenizer = load(args.model, tokenizer_config={"trust_remote_code": True})

    print("Evaluating WikiText-2 test PPL ...")
    ppl = eval_wikitext2_ppl(model, tokenizer, stride=args.stride, max_length=args.max_length)
    print(f"PPL = {ppl:.4f}")


if __name__ == "__main__":
    main()
