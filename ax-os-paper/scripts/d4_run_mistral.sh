#!/bin/bash
cd /home/alienware-r13/ax-os/ax-os-paper || exit 1
export PATH="$HOME/.local/bin:$PATH"
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
echo "[mistral run start $(date -u +%H:%M:%S)]"
if [ ! -f artifacts/mlx_q4/mistral7b/config.json ]; then
  echo "=== converting Mistral to MLX q4 ==="
  python3 -m mlx_lm convert --hf-path mistralai/Mistral-7B-Instruct-v0.3 \
    --mlx-path artifacts/mlx_q4/mistral7b -q --q-bits 4 --q-group-size 64
fi
echo "=== eval Mistral q4mlx ==="
python3 -u eval/eval_ppl_wikitext2_cuda_mlxparity.py \
  --hf-model mistralai/Mistral-7B-Instruct-v0.3 --mlx-dir artifacts/mlx_q4/mistral7b \
  --device-map auto \
  --checkpoint artifacts/mistral_7b_instruct_v03_cuda_q4mlx_ppl_checkpoint.json
echo "=== MISTRAL DONE $(date -u +%H:%M:%S) ==="
