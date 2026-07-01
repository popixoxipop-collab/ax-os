# AX OS Paper — D4/D5 Execution Handoff

**Created:** 2026-07-01
**Parent doc:** [`HANDOFF.md`](./HANDOFF.md) §5 "Open (require new experiments)"
**Goal:** clear D4 + D5, the two remaining blockers between "workshop submission" and "full conference short-paper track."

---

## D4: Second hardware platform (RTX 5070 Ti)

**Why it matters:** current scientific_depth bottleneck is single-hardware scope — all PPL/ΔPPL numbers were measured on M1 Max (MLX) only. A second, architecturally different platform (NVIDIA Blackwell, CUDA) turns the ΔPPL claim from "one Apple-Silicon anecdote" into a cross-hardware result. Estimated **+4–6pp**, the largest remaining score lever.

### Blocker found while writing this handoff
`eval/eval_ppl_wikitext2.py` has **no `--device cuda` flag** — it is MLX-only:
```
import mlx.core as mx
import mlx.nn as nn
from mlx_lm.utils import load
```
The `EXIT` command previously listed in `HANDOFF.md` (`--device cuda ...`) does not exist yet. This must be built, not just invoked.

### What needs to happen
1. **New eval script** `eval/eval_ppl_wikitext2_cuda.py` (or a `--backend {mlx,cuda}` switch in the existing one) using `transformers` + `bitsandbytes`/`auto-gptq`/`awq` for q4, matching the **exact same protocol** as the MLX script:
   - WikiText-2 full test split
   - 512-token non-overlapping stride
   - same 4-bit target (g64 equivalent — check what quant scheme is achievable on CUDA and note any scheme mismatch explicitly in the paper, don't silently swap methodology)
2. **Target machine:** RTX 5070 Ti (Blackwell, SM12.0, 15.9GB VRAM) — this is a *separate machine* from the Mac this repo currently lives on (see local memory `aeq_gpu_environment.md`). Confirm SSH/remote access path before starting; do not assume it's reachable from this session.
3. **Models to re-run** (same set as WikiText-2 table in `HANDOFF.md` §3):
   - Qwen2.5-1.5B, 3B, 7B, 14B
   - Mistral-7B
   - Llama-3.1-8B
   - 15.9GB VRAM ceiling → 14B in q4 should fit (~8-9GB), BF16 baseline for 14B will NOT fit on this card — plan to skip BF16-14B on CUDA or note VRAM-driven scope limit explicitly.
4. **Output:** new table in paper (§4.x "Cross-hardware validation") — BF16 PPL, q4 PPL, ΔPPL per model, side-by-side with the existing M1 Max column. The comparison that matters is **whether ΔPPL% is hardware-invariant**, not raw PPL (raw PPL differs by kernel/attention implementation even at "same" precision).
5. Update `HANDOFF.md` score trajectory table and §9 submission-readiness table once done.

### Exit criteria
- [ ] CUDA eval script written and validated against one MLX result (should match ΔPPL% within noise)
- [ ] All 6 models run BF16+q4 on RTX 5070 Ti (or documented exception for 14B BF16)
- [ ] Cross-hardware table added to paper.tex
- [ ] `results/ppl_results_cuda.txt` or equivalent checkpoint committed

---

## D5: 7B/Mistral BF16 C4 baseline — ✅ DONE (2026-07-01)

**Result:** Qwen2.5-7B BF16 C4=14.77 (ΔPPL(C4)=+7.80% vs WikiText-2 +8.5%). Mistral-7B BF16 C4=10.08 (ΔPPL(C4)=+4.47% vs WikiText-2 +4.4%). Both track WikiText-2 within 1.2pp, consistent with the corpus-invariance already shown for 1.5B/3B. Model repos used: `mlx-community/Qwen2.5-7B-Instruct-bf16`, `mlx-community/Mistral-7B-Instruct-v0.3` (unquantized bf16, no `-bf16` suffix variant exists for this repo — verified via `torch_dtype: bfloat16` in config.json, no `quantization` key). Checkpoints: `artifacts/qwen7b_bf16_c4_ppl_checkpoint.json`, `artifacts/mistral7b_bf16_c4_ppl_checkpoint.json`. paper.tex §4.4 table now has all 4 models fully paired; HANDOFF.md, README.md updated to match.

**Original why it mattered:** §4.4 C4 cross-corpus section was fully paired (BF16+q4) for 1.5B/3B but **q4-only** for 7B/Mistral — the BF16 baseline was never measured (blocked on model download). Without it, ΔPPL(C4) for the two largest models was unknown; only the C4/Wiki ratio proxy existed.

### What needs to happen
1. Download BF16 checkpoints:
   - `Qwen2.5-7B` (BF16, ~15GB)
   - `Mistral-7B-v0.1` or whichever variant matches the existing q4 Mistral-7B checkpoint already in `artifacts/` — **verify base model match first** (same base as `mistral7b_q4_local_c4_ppl_checkpoint.json` was quantized from)
2. Run existing script (no new code needed): `python eval/eval_ppl_c4.py --model <bf16 checkpoint>`
3. This can run on the M1 Max (MLX, same as existing measurements) — no CUDA dependency, no VRAM constraint issue since it's the same box already used for 1.5B/3B.
4. Update §3 C4 table in `HANDOFF.md` and the corresponding paper table — fill in the two missing BF16 C4 cells and compute real ΔPPL(C4) instead of the ratio proxy.

### Exit criteria
- [x] Qwen2.5-7B BF16 + Mistral-7B BF16 downloaded
- [x] `eval/eval_ppl_c4.py` run for both, checkpoints saved to `artifacts/`
- [x] §4.4 C4 table in paper.tex updated with real ΔPPL(C4) (no more "— not measured" cells for these two)

---

## Suggested order

D5 is done (2026-07-01, see above). D4 is the only remaining item — the bigger lift (new CUDA eval harness + separate RTX 5070 Ti machine) and the bigger payoff (+4–6pp on scientific_depth, the last blocker for main-conference submission tier).
