# AX OS Paper — D4/D5 Execution Handoff

**Created:** 2026-07-01
**Parent doc:** [`HANDOFF.md`](./HANDOFF.md) §5 "Open (require new experiments)"
**Goal:** clear D4 + D5, the two remaining blockers between "workshop submission" and "full conference short-paper track."

---

## D4: Second hardware platform (RTX 5070 Ti)

**Superseded by [`HANDOFF_D4.md`](./HANDOFF_D4.md)** — the full execution plan, including a corrected quantization-scheme-parity design (the sketch originally here suggested bitsandbytes/GPTQ/AWQ for CUDA q4, which would be a different algorithm than MLX's affine RTN group-64 scheme and would reopen the mlx-community-vs-local-quantize confound already fixed once in this paper — see `HANDOFF_D4.md` for why that matters and what to build instead).

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
