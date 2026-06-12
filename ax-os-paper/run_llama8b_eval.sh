#!/usr/bin/env bash
# Llama-3.1-8B: bf16 eval → local q4 convert → eval
# Cross-arch comparison addition to tab:scale
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/path_a_artifacts"
LOG="/tmp/eval_llama8b_main.log"
L8B_BF16_HF="mlx-community/Meta-Llama-3.1-8B-Instruct-bf16"
L8B_Q4_LOCAL="$OUT_DIR/llama8b_q4_local"

mkdir -p "$OUT_DIR"
exec > >(tee -a "$LOG") 2>&1
echo "=== Llama-3.1-8B eval start: $(date) ==="

echo "--- Step 1: BF16 PPL ---"
python3 "$SCRIPT_DIR/eval_ppl_wikitext2.py" --model "$L8B_BF16_HF"

echo "--- Step 2: Local q4 quantization ---"
mlx_lm.convert \
  --hf-path "$L8B_BF16_HF" \
  --mlx-path "$L8B_Q4_LOCAL" \
  -q --q-bits 4 --q-group-size 64

echo "--- Step 3: Q4 PPL eval ---"
python3 "$SCRIPT_DIR/eval_ppl_wikitext2.py" --model "$L8B_Q4_LOCAL"

echo "=== Llama-3.1-8B eval complete: $(date) ==="
