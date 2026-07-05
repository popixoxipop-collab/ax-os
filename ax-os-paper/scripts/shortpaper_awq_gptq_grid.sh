#!/bin/bash
# Real AWQ + GPTQ baselines on the same 6 models, same WikiText-2 protocol,
# using official (Qwen) or well-established community (Mistral/Llama)
# pre-quantized checkpoints. Each eval is independently checkpointed/resumable.
cd /home/alienware-r13/ax-os/ax-os-paper || exit 1
EVAL=eval/eval_ppl_wikitext2_cuda.py

run() {
  local tag="$1" model="$2" precision="$3"
  echo "=== [$tag] $model ($precision) start $(date -u +%H:%M:%S) ==="
  python3 -u "$EVAL" --model "$model" --precision "$precision" --device-map cuda
  echo "=== [$tag] $model ($precision) end $(date -u +%H:%M:%S) rc=$? ==="
}

run qwen15b_awq  Qwen/Qwen2.5-1.5B-Instruct-AWQ        awq
run qwen15b_gptq Qwen/Qwen2.5-1.5B-Instruct-GPTQ-Int4   gptq

run qwen3b_awq   Qwen/Qwen2.5-3B-Instruct-AWQ           awq
run qwen3b_gptq  Qwen/Qwen2.5-3B-Instruct-GPTQ-Int4      gptq

run qwen7b_awq   Qwen/Qwen2.5-7B-Instruct-AWQ           awq
run qwen7b_gptq  Qwen/Qwen2.5-7B-Instruct-GPTQ-Int4      gptq

run mistral_awq  TechxGenus/Mistral-7B-Instruct-v0.3-AWQ  awq
run mistral_gptq TechxGenus/Mistral-7B-Instruct-v0.3-GPTQ gptq

run llama_awq    hugging-quants/Meta-Llama-3.1-8B-Instruct-AWQ-INT4  awq
run llama_gptq   hugging-quants/Meta-Llama-3.1-8B-Instruct-GPTQ-INT4 gptq

run qwen14b_awq  Qwen/Qwen2.5-14B-Instruct-AWQ          awq
run qwen14b_gptq Qwen/Qwen2.5-14B-Instruct-GPTQ-Int4     gptq

echo "=== ALL DONE $(date -u +%H:%M:%S) ==="
