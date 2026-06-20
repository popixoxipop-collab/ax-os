#!/usr/bin/env bash
# Path A: uniform-pipeline re-quantization + 3-run PPL measurement
# Run from repo root: bash ax-os-paper/run_path_a.sh
set -euo pipefail

OUT_DIR="$HOME/ax-os-paper/artifacts"
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/ppl_results.tsv"

echo -e "model\tprecision\tppl\trun" > "$LOG"

measure_ppl() {
  local model_path="$1"
  local label="$2"
  local prec="$3"
  local run="$4"
  # mlx_lm perplexity writes to stdout: "Perplexity: X.XX"
  result=$(python3 -m mlx_lm perplexity \
    --model "$model_path" \
    --data-path wikitext \
    --num-samples 50 \
    2>&1 | grep -oP '(?<=Perplexity: )\S+')
  echo -e "${label}\t${prec}\t${result}\t${run}" | tee -a "$LOG"
}

# ── Re-quantize Qwen2.5-1.5B with local pipeline (group_size=64) ──
Q15B_SRC="mlx-community/Qwen2.5-1.5B-Instruct-bf16"
Q15B_BF16="$OUT_DIR/qwen15b_bf16"
Q15B_Q4_1="$OUT_DIR/qwen15b_q4_run1"
Q15B_Q4_2="$OUT_DIR/qwen15b_q4_run2"
Q15B_Q4_3="$OUT_DIR/qwen15b_q4_run3"

echo "=== Converting Qwen2.5-1.5B BF16 for PPL baseline ==="
python3 -m mlx_lm convert --hf-path "$Q15B_SRC" --mlx-path "$Q15B_BF16" --dtype bfloat16

echo "=== Qwen2.5-1.5B BF16 PPL ==="
for run in 1 2 3; do
  measure_ppl "$Q15B_BF16" "Qwen2.5-1.5B" "bf16" "$run"
done

echo "=== Re-quantizing Qwen2.5-1.5B q4 (run 1) ==="
python3 -m mlx_lm convert --hf-path "$Q15B_SRC" --mlx-path "$Q15B_Q4_1" -q --q-bits 4 --q-group-size 64

echo "=== Re-quantizing Qwen2.5-1.5B q4 (run 2) ==="
python3 -m mlx_lm convert --hf-path "$Q15B_SRC" --mlx-path "$Q15B_Q4_2" -q --q-bits 4 --q-group-size 64

echo "=== Re-quantizing Qwen2.5-1.5B q4 (run 3) ==="
python3 -m mlx_lm convert --hf-path "$Q15B_SRC" --mlx-path "$Q15B_Q4_3" -q --q-bits 4 --q-group-size 64

echo "=== Qwen2.5-1.5B q4 PPL (3 runs) ==="
measure_ppl "$Q15B_Q4_1" "Qwen2.5-1.5B" "q4_local" "1"
measure_ppl "$Q15B_Q4_2" "Qwen2.5-1.5B" "q4_local" "2"
measure_ppl "$Q15B_Q4_3" "Qwen2.5-1.5B" "q4_local" "3"

# ── Re-quantize Qwen2.5-3B with local pipeline ──
Q3B_SRC="mlx-community/Qwen2.5-3B-Instruct-bf16"
Q3B_BF16="$OUT_DIR/qwen3b_bf16"
Q3B_Q4_1="$OUT_DIR/qwen3b_q4_run1"
Q3B_Q4_2="$OUT_DIR/qwen3b_q4_run2"
Q3B_Q4_3="$OUT_DIR/qwen3b_q4_run3"

echo "=== Converting Qwen2.5-3B BF16 ==="
python3 -m mlx_lm convert --hf-path "$Q3B_SRC" --mlx-path "$Q3B_BF16" --dtype bfloat16

echo "=== Qwen2.5-3B BF16 PPL ==="
for run in 1 2 3; do
  measure_ppl "$Q3B_BF16" "Qwen2.5-3B" "bf16" "$run"
done

echo "=== Re-quantizing Qwen2.5-3B q4 (3 runs) ==="
python3 -m mlx_lm convert --hf-path "$Q3B_SRC" --mlx-path "$Q3B_Q4_1" -q --q-bits 4 --q-group-size 64
python3 -m mlx_lm convert --hf-path "$Q3B_SRC" --mlx-path "$Q3B_Q4_2" -q --q-bits 4 --q-group-size 64
python3 -m mlx_lm convert --hf-path "$Q3B_SRC" --mlx-path "$Q3B_Q4_3" -q --q-bits 4 --q-group-size 64

echo "=== Qwen2.5-3B q4 PPL (3 runs) ==="
measure_ppl "$Q3B_Q4_1" "Qwen2.5-3B" "q4_local" "1"
measure_ppl "$Q3B_Q4_2" "Qwen2.5-3B" "q4_local" "2"
measure_ppl "$Q3B_Q4_3" "Qwen2.5-3B" "q4_local" "3"

echo ""
echo "=== DONE — results in $LOG ==="
cat "$LOG"
