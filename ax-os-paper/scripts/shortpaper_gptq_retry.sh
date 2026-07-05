#!/bin/bash
# Retry: GPTQ-only runs (AWQ already succeeded in shortpaper_awq_gptq_grid.sh).
# The first attempt failed instantly on all 6 with
# "ImportError: Loading a GPTQ quantized model requires optimum" - now installed.
cd /home/alienware-r13/ax-os/ax-os-paper || exit 1
EVAL=eval/eval_ppl_wikitext2_cuda.py

run() {
  local tag="$1" model="$2"
  echo "=== [$tag] $model (gptq) start $(date -u +%H:%M:%S) ==="
  python3 -u "$EVAL" --model "$model" --precision gptq --device-map cuda
  echo "=== [$tag] $model (gptq) end $(date -u +%H:%M:%S) rc=$? ==="
}

run qwen15b_gptq Qwen/Qwen2.5-1.5B-Instruct-GPTQ-Int4
run qwen3b_gptq  Qwen/Qwen2.5-3B-Instruct-GPTQ-Int4
run qwen7b_gptq  Qwen/Qwen2.5-7B-Instruct-GPTQ-Int4
run mistral_gptq TechxGenus/Mistral-7B-Instruct-v0.3-GPTQ
run llama_gptq   hugging-quants/Meta-Llama-3.1-8B-Instruct-GPTQ-INT4
run qwen14b_gptq Qwen/Qwen2.5-14B-Instruct-GPTQ-Int4

echo "=== GPTQ RETRY ALL DONE $(date -u +%H:%M:%S) ==="
