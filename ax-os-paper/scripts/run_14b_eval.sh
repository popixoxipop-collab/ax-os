#!/usr/bin/env bash
# Qwen2.5-14B-Instruct: bf16 download → eval → local q4 convert → eval
# Protocol: eval_ppl_wikitext2.py (stride=512, non-overlapping, full corpus)
# Consistent with paper's current uniform-pipeline measurements.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../artifacts"
LOG="$OUT_DIR/14b_eval.log"
Q14B_BF16_HF="mlx-community/Qwen2.5-14B-Instruct-bf16"
Q14B_Q4_LOCAL="$OUT_DIR/qwen14b_q4_local"

mkdir -p "$OUT_DIR"
exec > >(tee -a "$LOG") 2>&1

echo "=== 14B eval start: $(date) ==="

echo ""
echo "--- Step 1: BF16 PPL (download + eval) ---"
python3 "$SCRIPT_DIR/../eval/eval_ppl_wikitext2.py" --model "$Q14B_BF16_HF"

echo ""
echo "--- Step 2: Local q4 quantization (group_size=64) ---"
python3 -m mlx_lm.convert \
  --hf-path "$Q14B_BF16_HF" \
  --mlx-path "$Q14B_Q4_LOCAL" \
  -q --q-bits 4 --q-group-size 64

echo ""
echo "--- Step 3: Q4 PPL eval ---"
python3 "$SCRIPT_DIR/../eval/eval_ppl_wikitext2.py" --model "$Q14B_Q4_LOCAL"

echo ""
echo "=== 14B eval complete: $(date) ==="
