#!/usr/bin/env python3
"""Quick PPL estimation using first N tokens of WikiText-2 (offline mode).
Usage: HF_DATASETS_OFFLINE=1 python eval_ppl_quick.py --model <path> --max-tokens 8192
"""
import argparse
import math
import sys

import mlx.core as mx
import mlx.nn as nn
from datasets import load_dataset
from mlx_lm.utils import load


def eval_ppl_quick(model, tokenizer, max_tokens=8192, stride=512, max_length=512):
    ds = load_dataset("wikitext", "wikitext-2-raw-v1", split="test")
    text = "\n\n".join(ds["text"])
    encodings = tokenizer.encode(text)
    tokens = mx.array(encodings[:max_tokens])
    n = len(tokens)

    nlls = []
    for begin in range(0, n - 1, stride):
        end = min(begin + max_length, n)
        chunk = tokens[begin:end]
        if len(chunk) < 2:
            break
        input_ids = chunk[:-1][None]
        target_ids = chunk[1:]
        logits = model(input_ids)[0].astype(mx.float32)
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
    parser.add_argument("--max-tokens", type=int, default=8192)
    parser.add_argument("--stride", type=int, default=512)
    parser.add_argument("--max-length", type=int, default=512)
    args = parser.parse_args()

    print(f"Loading {args.model} ...")
    model, tokenizer = load(args.model, tokenizer_config={"trust_remote_code": True})

    print(f"Quick WikiText-2 PPL (first {args.max_tokens} tokens) ...")
    ppl = eval_ppl_quick(model, tokenizer, args.max_tokens, args.stride, args.max_length)
    print(f"PPL = {ppl:.4f}")


if __name__ == "__main__":
    main()
