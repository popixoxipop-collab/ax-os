#!/usr/bin/env python3
"""
Baseline Qwen2.5-1.5B-Instruct vs F2 (C4-trained bottleneck, L14, rank=8) on
HellaSwag/PIQA loglikelihood-scored accuracy. See eval/eval_mc.py for the
scoring method (ported from ~/Desktop/postbackprop/scripts/local_eval.py) and
scripts/save_f2_weights.py for how the F2 weights being loaded here were
produced (regression-checked against Track F/H's +1.45% C4 PPL delta).
"""
import json
import os
import sys
import time

import mlx.core as mx

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "eval"))
sys.path.insert(0, _HERE)
from bottleneck_filter import DenseBottleneck  # noqa: E402
from eval_mc import eval_hellaswag, eval_piqa  # noqa: E402
from run_spectral_swap import get_target, restore, MODEL_ID, DIM  # noqa: E402
from mlx_lm.utils import load  # noqa: E402

LAYER = 14
RANK = 8
TRACK = "A"
N_EXAMPLES = 200
ARTIFACTS_DIR = os.path.join(_HERE, "..", "artifacts")
WEIGHTS_PATH = os.path.join(ARTIFACTS_DIR, "f2_l14_r8_c4_trained.safetensors")
OUT_PATH = os.path.join(ARTIFACTS_DIR, "mc_eval_results.json")
C4_PPL_DELTA_PCT = 1.45  # already established (Track F/H, regression-confirmed by save_f2_weights.py)


def main():
    print(f"Loading model: {MODEL_ID} ...", flush=True)
    t0 = time.time()
    model, tokenizer = load(MODEL_ID)
    print(f"  loaded in {time.time()-t0:.2f}s", flush=True)

    print(f"\n=== [1/2] baseline ===", flush=True)
    t0 = time.time()
    base_hellaswag = eval_hellaswag(model, tokenizer, n=N_EXAMPLES)
    base_piqa = eval_piqa(model, tokenizer, n=N_EXAMPLES)
    print(f"  baseline eval wall time: {time.time()-t0:.1f}s", flush=True)

    print(f"\n=== [2/2] F2 (C4-trained, L14, rank={RANK}) ===", flush=True)
    parent, attr, orig = get_target(model, TRACK, LAYER)
    new_mod = DenseBottleneck(DIM, rank=RANK)
    new_mod.load_weights(WEIGHTS_PATH)
    setattr(parent, attr, new_mod)

    t0 = time.time()
    f2_hellaswag = eval_hellaswag(model, tokenizer, n=N_EXAMPLES)
    f2_piqa = eval_piqa(model, tokenizer, n=N_EXAMPLES)
    print(f"  F2 eval wall time: {time.time()-t0:.1f}s", flush=True)

    restore(parent, attr, orig)

    results = {
        "n_examples": N_EXAMPLES,
        "baseline": {"hellaswag_acc": base_hellaswag, "piqa_acc": base_piqa},
        "f2_c4": {"hellaswag_acc": f2_hellaswag, "piqa_acc": f2_piqa,
                  "c4_ppl_delta_pct": C4_PPL_DELTA_PCT},
    }
    os.makedirs(ARTIFACTS_DIR, exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(results, f, indent=2)

    print(f"\n=== summary (n={N_EXAMPLES}) ===")
    print(f"  HellaSwag: baseline {base_hellaswag*100:.1f}%  ->  F2 {f2_hellaswag*100:.1f}%  "
          f"(delta {(f2_hellaswag-base_hellaswag)*100:+.1f}pp)")
    print(f"  PIQA:      baseline {base_piqa*100:.1f}%  ->  F2 {f2_piqa*100:.1f}%  "
          f"(delta {(f2_piqa-base_piqa)*100:+.1f}pp)")
    print(f"  (for reference, F2's C4 PPL delta is +{C4_PPL_DELTA_PCT:.2f}%)")
    print(f"saved -> {OUT_PATH}")


if __name__ == "__main__":
    main()
