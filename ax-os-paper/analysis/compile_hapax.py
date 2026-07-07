#!/usr/bin/env python3
"""Compile hapax-mechanism bucket results across models, alongside each
model's known WikiText-2 uniform-q4 ΔPPL%, to check whether the within-model
rare-vs-frequent-token gap tracks the cross-model sensitivity ranking."""
import json
import os

ART = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "artifacts")

MODELS = [
    ("Qwen2.5-1.5B", "qwen25_15b_instruct_hapax_buckets.json", 15.12),
    ("Qwen2.5-3B", "qwen25_3b_instruct_hapax_buckets.json", 11.96),
    ("Qwen2.5-7B", "qwen25_7b_instruct_hapax_buckets.json", 8.56),
    ("Mistral-7B", "mistral_7b_instruct_v03_hapax_buckets.json", 4.41),
]

print(f"{'Model':<14} {'dPPL%':>7} {'hapax_dNLL':>11} {'high_dNLL':>10} {'gap':>7} {'gap/high':>9}")
rows = []
for label, fname, dppl in MODELS:
    d = json.load(open(os.path.join(ART, fname)))
    b = d["buckets"]
    hapax = b["hapax(=1)"]["mean_delta_nll"]
    high = b["high(21+)"]["mean_delta_nll"]
    gap = hapax - high
    rows.append(dict(label=label, dppl=dppl, hapax=hapax, high=high, gap=gap,
                      gap_ratio=gap / high))
    print(f"{label:<14} {dppl:>6.2f}% {hapax:>+11.4f} {high:>+10.4f} {gap:>+7.4f} {gap/high:>8.1%}")

with open(os.path.join(ART, "hapax_compiled.json"), "w") as f:
    json.dump(rows, f, indent=2)
print("\nSaved: artifacts/hapax_compiled.json")
