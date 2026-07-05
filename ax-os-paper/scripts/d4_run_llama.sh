#!/bin/bash
# Llama-3.1-8B: BF16 baseline + q4 MLX-parity. Model cache lives in a shared
# NTFS cache readable via /mnt/g (originally populated from Windows while WSL
# outbound was down; safe to reuse now regardless of network state).
set -e
cd /home/alienware-r13/ax-os/ax-os-paper || exit 1
export PATH="$HOME/.local/bin:$PATH"
export HF_HOME=/mnt/g/hf_cache
echo "[llama run start $(date -u +%H:%M:%S)]"

echo "=== Llama-3.1-8B BF16 baseline ==="
python3 -u eval/eval_ppl_wikitext2_cuda.py --model meta-llama/Llama-3.1-8B-Instruct \
  --precision bf16 --device-map auto

echo "=== Llama-3.1-8B convert to MLX q4 ==="
if [ ! -f artifacts/mlx_q4/llama8b/config.json ]; then
  python3 -m mlx_lm convert --hf-path meta-llama/Llama-3.1-8B-Instruct \
    --mlx-path artifacts/mlx_q4/llama8b -q --q-bits 4 --q-group-size 64
fi

echo "=== Llama-3.1-8B q4mlx eval ==="
python3 -u eval/eval_ppl_wikitext2_cuda_mlxparity.py \
  --hf-model meta-llama/Llama-3.1-8B-Instruct --mlx-dir artifacts/mlx_q4/llama8b \
  --device-map auto \
  --checkpoint artifacts/llama_31_8b_instruct_cuda_q4mlx_ppl_checkpoint.json
echo "=== LLAMA DONE $(date -u +%H:%M:%S) ==="
