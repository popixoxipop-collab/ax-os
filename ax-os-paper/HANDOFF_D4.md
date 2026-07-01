# AX OS Paper — D4 Execution Handoff (2nd hardware platform, RTX 5070 Ti)

**Created:** 2026-07-01
**Status:** open — last remaining blocker for main-conference submission tier
**Parent doc:** [`HANDOFF.md`](./HANDOFF.md) §5, [`HANDOFF_D4_D5.md`](./HANDOFF_D4_D5.md) §D4 (D5 is done; this document supersedes and expands that D4 section)
**Target machine:** RTX 5070 Ti (Blackwell, SM12.0, 15.9GB VRAM) — a **separate machine** from the M1 Max this repo has lived on so far. This handoff must be picked up on that machine directly; nothing here can be executed from the Mac session that wrote it.

---

## Why this exists

Every PPL/ΔPPL number in the paper so far was measured on **one hardware platform** (Apple Silicon, MLX). A reviewer could reasonably ask whether the q4 ΔPPL pattern is a property of the models/quantization, or an artifact of MLX's kernels. A second, architecturally unrelated platform (NVIDIA Blackwell, CUDA) that reproduces the same ΔPPL% pattern closes that gap. Estimated **+4–6pp on scientific_depth**, the single largest remaining score lever, and the one item separating "workshop submission" (already achievable now) from "full conference short-paper track."

---

## The one thing that must not go wrong: quantization-scheme parity

This is the most important paragraph in this document. Read it before writing any code.

The paper's methodology section already survived one reviewer critique about a quantization confound (mlx-community pre-quantized checkpoints vs. locally-quantized ones — fixed by re-quantizing everything locally with `mlx_lm.convert`, see `HANDOFF.md` §5). **D4 must not reopen that wound by switching quantization algorithms when switching hardware.**

MLX's `mx.quantize(..., group_size=64, bits=4, mode="affine")` — which is what every existing q4 number in this paper comes from — is a **plain per-group min-max affine RTN (round-to-nearest) quantizer**, not NF4, not GPTQ, not AWQ. Its exact formula, for each group of 64 consecutive elements in a row of a weight matrix:

```
alpha = max(group)
beta  = min(group)
s     = (alpha - beta) / 15          # 2^4 - 1 = 15
q_i   = round((w_i - beta) / s)      # integer in [0, 15]
w_hat_i = q_i * s + beta             # dequantized value used in the forward pass
```

**Do not use `bitsandbytes` `load_in_4bit` (NF4 by default), `auto-gptq`, or `awq` for the CUDA side.** Those are different algorithms with different error characteristics; a ΔPPL measured with NF4 on CUDA vs. affine-RTN on MLX is not a hardware comparison, it's a confounded scheme+hardware comparison, and a careful reviewer will notice the table says "q4" on both sides while meaning different things.

**What to build instead:** a small **fake-quantization** pass in plain PyTorch — for every `nn.Linear` weight in the model, apply the exact formula above (group_size=64 along the input dimension, matching MLX's per-row grouping), replace the weight with `w_hat` (still stored as bf16/fp32, no actual bit-packing needed), then run the forward pass normally. This is standard RTN "fake quant" practice, requires no custom CUDA kernel, and is algorithmically identical to what MLX did — the only difference left is the hardware executing the matmuls, which is exactly what D4 is supposed to test.

```python
import torch

def rtn_affine_quantize_(weight: torch.Tensor, group_size: int = 64, bits: int = 4):
    """In-place fake-quantize a 2D weight tensor, matching mx.quantize(mode='affine')."""
    assert weight.dim() == 2
    out_features, in_features = weight.shape
    assert in_features % group_size == 0
    w = weight.view(out_features, in_features // group_size, group_size)
    alpha = w.amax(dim=-1, keepdim=True)
    beta = w.amin(dim=-1, keepdim=True)
    levels = (1 << bits) - 1  # 15 for 4-bit
    s = (alpha - beta) / levels
    s = torch.where(s == 0, torch.ones_like(s), s)  # avoid /0 on constant groups
    q = torch.round((w - beta) / s).clamp(0, levels)
    w_hat = q * s + beta
    weight.copy_(w_hat.view(out_features, in_features))

@torch.no_grad()
def quantize_model_(model, group_size: int = 64, bits: int = 4):
    for name, module in model.named_modules():
        if isinstance(module, (torch.nn.Linear, torch.nn.Embedding)):
            rtn_affine_quantize_(module.weight.data, group_size, bits)
```

Note: `nn.Embedding`'s weight is `[vocab, hidden]`, same orientation as `nn.Linear`, so the same grouping-along-the-last-dimension logic applies unchanged. Some smaller models (check each model's `config.json["tie_word_embeddings"]`; Qwen2.5-7B has this `False`, so `embed_tokens` and `lm_head` are separate tensors there — don't assume it holds for the 1.5B/3B/14B configs, check each) tie `lm_head.weight` to `embed_tokens.weight` as the *same* underlying `Parameter`; the loop above will then quantize that shared tensor once via whichever module `named_modules()` visits first — harmless, since RTN is deterministic (quantizing an already-quantized tensor again is a no-op), just don't be surprised if you see it visited under two names.

**Coverage, already verified against `artifacts/qwen7b_q4_local/model.safetensors.index.json`:** `mlx_lm.convert -q` quantizes every `q_proj`/`k_proj`/`v_proj`/`o_proj`/`gate_proj`/`up_proj`/`down_proj` in every decoder layer, **and also `model.embed_tokens` and `lm_head`** (both show up with `.scales`/`.biases` alongside `.weight` in the checkpoint). It does *not* quantize `q_proj`/`k_proj`/`v_proj`'s plain `.bias` term (the attention bias vector, unrelated to quantization bias — don't confuse the two `.bias`/`.biases` keys). So `quantize_model_()` above must be extended to also fake-quantize `model.embed_tokens.weight` and `lm_head.weight` (both are 2D `[vocab, hidden]`-shaped, same grouping applies along the hidden axis) — quantizing only the decoder `Linear` layers and leaving embeddings/lm_head in full precision would under-quantize relative to MLX and bias ΔPPL low.

**Validation step (do this before running any of the 6 real models):** pick one small model already measured on both BF16 and q4 on the Mac (e.g. Qwen2.5-1.5B), run the CUDA BF16 + this fake-quant q4 pass, and check that ΔPPL% is close to the MLX number (+15.0% for 1.5B on WikiText-2). If it's off by more than a couple points, the grouping axis, clamp range, or module coverage is wrong — fix that before trusting any other number.

---

## What needs to happen

### 1. New eval script(s)

Write `eval/eval_ppl_wikitext2_cuda.py` (mirror the structure of the existing `eval/eval_ppl_wikitext2.py`, which is MLX-only — it has no `--device` flag today, contrary to what an earlier draft of this handoff assumed). Match the **exact same protocol**, including a quirk worth preserving rather than "fixing": the existing script computes PPL as `exp(mean(per-window mean NLL))`, i.e. every window (including a possibly-shorter final window) contributes equally regardless of token count, rather than the token-weighted PPL formula some other codebases use. For a fair comparison, replicate this exactly:

```python
# WikiText-2 test split, full text, joined with "\n\n", tokenized once.
# Non-overlapping windows: stride=512, max_length=512.
# For each window: input = chunk[:-1], target = chunk[1:],
#   loss = cross_entropy(logits, target, reduction="mean")  <- mean over this window only
# ppl = exp(mean(all window losses))                          <- unweighted across windows
```

Also port `eval/eval_ppl_c4.py`'s C4 protocol the same way if D4 is later extended to C4 (not required for the initial D4 exit criteria — WikiText-2 parity is the primary target).

Load models with `transformers.AutoModelForCausalLM.from_pretrained(..., torch_dtype=torch.bfloat16, device_map="cuda")` and `AutoTokenizer.from_pretrained(...)`. For q4, load the same BF16 checkpoint and apply `quantize_model_()` above before running eval — do **not** load a separately-hosted "4bit" checkpoint from the Hub (those are usually GPTQ/AWQ/bnb, i.e. the wrong scheme).

### 2. Models and exact repo IDs

CUDA needs standard HF repos (not the `mlx-community/*-bf16` repos used on the Mac side — those are MLX-format and won't load in `transformers`). Use the base instruct models the MLX-community repos were themselves converted from:

| Model | HF repo id | Notes |
|---|---|---|
| Qwen2.5-1.5B | `Qwen/Qwen2.5-1.5B-Instruct` | |
| Qwen2.5-3B | `Qwen/Qwen2.5-3B-Instruct` | |
| Qwen2.5-7B | `Qwen/Qwen2.5-7B-Instruct` | |
| Qwen2.5-14B | `Qwen/Qwen2.5-14B-Instruct` | BF16 likely won't fit in 15.9GB VRAM — see below |
| Mistral-7B | `mistralai/Mistral-7B-Instruct-v0.3` | matches the exact version cited in paper.tex (§4, tab:mistral) |
| Llama-3.1-8B | `meta-llama/Llama-3.1-8B-Instruct` | **gated** — requires HF token with license accepted before download |

Verify tokenizer/config parity against the MLX-side artifacts before trusting results — e.g. `diff <(python -c "import json;print(json.load(open('config.json')))") ...` between the CUDA-downloaded config and `artifacts/qwen7b_q4_local/config.json`'s base fields (hidden_size, num_layers, etc. should match; only the `quantization` key differs).

### 3. VRAM budget (15.9GB card)

Rough BF16 footprint = 2 bytes/param, q4 fake-quant footprint ≈ same as BF16 (fake quant does **not** reduce memory — it dequantizes back to bf16/fp32 for the forward pass; only real bit-packing would save memory, and we deliberately skip that for scheme-parity reasons above). So both precisions cost the same VRAM per model:

| Model | Params | Approx weight VRAM (bf16, either precision) | Fits in 15.9GB? |
|---|---|---|---|
| 1.5B | 1.5B | ~3GB | yes, both |
| 3B | 3B | ~6GB | yes, both |
| 7B | 7B | ~14GB | yes, tight — watch for activation/KV overhead |
| 14B | 14B | ~28GB | **no** — skip both BF16 and fake-quant-q4 on this card, or fall back to real 4-bit packing for 14B only and note the asymmetry explicitly in the paper |
| Mistral-7B | 7B | ~14GB | yes, tight, same as Qwen-7B |
| Llama-3.1-8B | 8B | ~16GB | borderline — may not fit; test early, don't assume |

Since fake-quant doesn't save memory, 14B is the one model likely to need an explicit scope exception. If it doesn't fit, document that in the paper as an explicit hardware-driven limitation rather than silently dropping the row.

### 4. Preflight check before the real run

This machine's GPU (Blackwell, SM12.0) has had `prebuilt-wheel` compatibility issues before with exotic CUDA kernels (see local memory on AEQ vLLM/SGLang work — custom Triton/CUTLASS ops needed `custom_ops: none` / `VLLM_USE_TRITON_AWQ=1` patches). The plan above deliberately avoids bitsandbytes/vLLM/Triton kernels — it's plain PyTorch `round`/`clamp`/`matmul`/attention via standard `transformers` — so this risk is much lower than typical AEQ work on this card, but **do not assume it away**. Before running all 6 models: load the smallest model (Qwen2.5-1.5B), run one BF16 forward pass and one fake-quant q4 forward pass, and confirm no CUDA kernel errors before scaling up (mirrors the "RunPod preflight" lesson already learned on this project: verify locally/small-scale before committing a multi-hour run).

### 5. Output format (for merging back into the paper)

Once results land, they extend `paper.tex` `\cref{tab:scale}` (the main WikiText-2 table) with a second hardware column, or add a new table `tab:cross-hw` alongside it — decide based on how it reads once the numbers are in. Either way:
- Add new `\newcommand{...}` macros next to the existing C4 macros (see `paper.tex` lines ~17-31 for the pattern established during D5) rather than hardcoding numbers inline.
- Report **ΔPPL%** per model per hardware, not just raw PPL — raw PPL will differ between MLX and CUDA/PyTorch even at "same" precision due to attention implementation / kernel numerics; the claim that matters is "ΔPPL% is hardware-invariant," and that's the number a reviewer will check.
- Update `HANDOFF.md` §2 (score trajectory) and §9 (submission readiness) once done — §9 currently states D4 is the sole blocker for main-conference tier.

---

## Exit criteria

- [ ] `eval/eval_ppl_wikitext2_cuda.py` written, with fake-quant RTN affine group=64/bits=4 matching MLX's formula exactly
- [ ] Validation check passed: Qwen2.5-1.5B on CUDA reproduces ΔPPL ≈ +15.0% (within a couple points of the MLX number)
- [ ] All models run BF16+q4 except any VRAM-driven exceptions (expected: 14B, possibly Llama-3.1-8B), which must be explicitly documented rather than silently omitted
- [ ] Cross-hardware ΔPPL% table/column added to `paper.tex`, macros added following the existing pattern
- [ ] `HANDOFF.md` §2 and §9 updated; §9's "Single remaining blocker for main-conference: D4" line resolved once done
- [ ] Results checkpointed under `artifacts/` (e.g. `artifacts/{model}_cuda_{bf16,q4}_ppl_checkpoint.json`) and committed
