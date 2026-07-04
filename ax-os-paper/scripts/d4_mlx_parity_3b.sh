#!/bin/bash
cd /home/alienware-r13/ax-os/ax-os-paper || exit 1
LOG=scripts/d4_mlx_parity.log
{
echo "[parity 3B start $(date -u +%H:%M:%S)]"
export PATH="$HOME/.local/bin:$PATH"
if [ ! -f artifacts/mlx_q4/qwen3b/config.json ]; then
  python3 -m mlx_lm convert --hf-path Qwen/Qwen2.5-3B-Instruct \
    --mlx-path artifacts/mlx_q4/qwen3b -q --q-bits 4 --q-group-size 64 2>&1 | tail -3
fi
python3 eval/eval_ppl_wikitext2_cuda_mlxparity.py \
  --hf-model Qwen/Qwen2.5-3B-Instruct --mlx-dir artifacts/mlx_q4/qwen3b \
  --checkpoint artifacts/qwen25_3b_instruct_cuda_q4mlx_ppl_checkpoint.json 2>&1 | tail -8
echo "=== PARITY 3B DONE ==="
} >> "$LOG" 2>&1
