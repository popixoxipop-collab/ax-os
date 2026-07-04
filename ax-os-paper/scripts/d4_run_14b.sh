#!/bin/bash
cd /home/alienware-r13/ax-os/ax-os-paper || exit 1
export PATH="$HOME/.local/bin:$PATH"
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
echo "[14b run start $(date -u +%H:%M:%S)]"

echo "=== 14B NF4 (scheme exception: bitsandbytes real 4-bit, on-GPU) ==="
python3 -u eval/eval_ppl_wikitext2_cuda.py --model Qwen/Qwen2.5-14B-Instruct \
  --precision nf4 --device-map cuda

echo "=== 14B BF16 (CPU-offload baseline) ==="
python3 -u eval/eval_ppl_wikitext2_cuda.py --model Qwen/Qwen2.5-14B-Instruct \
  --precision bf16 --device-map auto

echo "=== 14B DONE $(date -u +%H:%M:%S) ==="
