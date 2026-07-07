#!/bin/bash
cd /home/alienware-r13/ax-os/ax-os-paper || exit 1
export HF_HOME=/mnt/g/hf_cache

run() {
  local model="$1" devmap="$2"
  echo "=== [hapax] $model start $(date -u +%H:%M:%S) ==="
  python3 -u eval/hapax_mechanism_test.py --model "$model" --device-map "$devmap"
  local rc=$?
  echo "=== [hapax] $model end $(date -u +%H:%M:%S) rc=$rc ==="
  sleep 5
}

run Qwen/Qwen2.5-7B-Instruct cuda
run meta-llama/Llama-3.1-8B-Instruct cuda
run Qwen/Qwen2.5-14B-Instruct auto

echo "=== HAPAX GRID ALL DONE $(date -u +%H:%M:%S) ==="
