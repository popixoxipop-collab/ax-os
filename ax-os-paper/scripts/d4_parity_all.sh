#!/bin/bash
# D4 final queue: MLX-parity q4 for 1.5B/7B/Mistral + 14B NF4 & BF16.
cd /home/alienware-r13/ax-os/ax-os-paper || exit 1
LOG=scripts/d4_parity_all.log
export PATH="$HOME/.local/bin:$PATH"

parity() {  # hf_id mlx_subdir ckpt_tag dmap
  echo "=== PARITY $1 [$4] ==="
  if [ ! -f "artifacts/mlx_q4/$2/config.json" ]; then
    python3 -m mlx_lm convert --hf-path "$1" --mlx-path "artifacts/mlx_q4/$2" \
      -q --q-bits 4 --q-group-size 64 2>&1
  fi
  python3 -u eval/eval_ppl_wikitext2_cuda_mlxparity.py --hf-model "$1" \
    --mlx-dir "artifacts/mlx_q4/$2" --device-map "$4" \
    --checkpoint "artifacts/${3}_cuda_q4mlx_ppl_checkpoint.json" 2>&1
}

{
echo "[parity-all start $(date -u +%H:%M:%S)]"
parity Qwen/Qwen2.5-1.5B-Instruct qwen15b qwen25_15b_instruct cuda
parity Qwen/Qwen2.5-7B-Instruct qwen7b qwen25_7b_instruct auto
parity mistralai/Mistral-7B-Instruct-v0.3 mistral7b mistral_7b_instruct_v03 auto

echo "=== 14B NF4 (scheme exception, real 4-bit packing) ==="
python3 -u eval/eval_ppl_wikitext2_cuda.py --model Qwen/Qwen2.5-14B-Instruct \
  --precision nf4 --device-map cuda 2>&1
echo "=== 14B BF16 (CPU offload baseline) ==="
python3 -u eval/eval_ppl_wikitext2_cuda.py --model Qwen/Qwen2.5-14B-Instruct \
  --precision bf16 --device-map auto 2>&1
echo "=== PARITY-ALL DONE ==="
} >> "$LOG" 2>&1
