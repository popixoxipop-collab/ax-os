# AX OS Paper — Handoff

**Last updated:** 2026-07-01  
**Repo:** `github.com/popixoxipop-collab/ax-os` (paper lives in `ax-os-paper/`)  
**HEAD at handoff:** `1dfc695`  
**Branch:** `main` (pushed to `origin/main`)

---

## 1. Current state

- `paper.tex` — 14 pages, compiles clean (pdflatex + bibtex, no errors, no undefined refs)
- `paper.pdf` — committed build, in sync with `paper.tex`
- **Best score estimate: 80.65 / 100** (2-rater weighted average, 2026-06-20)
  - ⚠️ LLM scorer calibration variance = ±10 pp — single-session scores unreliable for marginal tracking
  - 80.65 was achieved at commit `444e202` (C4 cross-arch ratio complete)
  - D1–D3 fixes (2026-07-01) are integrity/framing changes; they do not raise score but remove reviewer red flags

### Build
```bash
cd ax-os-paper
pdflatex -interaction=nonstopmode paper.tex
bibtex paper
pdflatex -interaction=nonstopmode paper.tex
pdflatex -interaction=nonstopmode paper.tex
```

### Repo structure
```
ax-os-paper/
├── paper.tex / paper.pdf / refs.bib
├── figures/               # 4 figures (harness, pareto, scale_ppl, system_overview)
├── eval/                  # eval_ppl_wikitext2.py, eval_ppl_c4.py, eval_arc_e.py, ...
├── analysis/              # hapax_ablation, tokenizer_analysis, gen_scale_ppl_fig
├── results/               # JSON results + ppl_results.txt
├── scripts/               # run_14b_eval.sh, run_llama8b_eval.sh, run_path_a.sh
└── artifacts/             # quantized model checkpoints + C4 checkpoints
```

---

## 2. Score trajectory

| Commit | Score | What changed |
|--------|-------|-------------|
| initial | 65.5 | baseline |
| uniform full-corpus, 4 models | 73.0 | +7.5 |
| 14B + tokenizer mechanism | 76.1 | +3.1 |
| Llama + throughput correction | 68.7 | −7.4 regression |
| structural refactor | 72.7 | +4.0 |
| ARC-Easy downstream eval | 77.4 | +4.7 |
| arXiv bib + oracle framing | 78.7 | +1.3 |
| `faf429d` §4.4 C4 1.5B/3B + macro cleanup | 80.0 | +1.3 |
| `444e202` 7B+Mistral C4 cross-arch ratio | **80.65** | +0.65 ← **best** |
| `6aa16bb` barrios @inproceedings | — | bib quality only |
| `12931b1` GPTQ/AWQ §5.2 context | — | addresses reviewer critique |
| `1dfc695` D1–D3 framing fixes | — | integrity only, no score change |
| D5 C4 4-model completion (this commit) | not yet re-scored | closes last C4 cross-corpus gap (Qwen-7B, Mistral-7B BF16) |

---

## 3. Key results (do not change without re-measurement)

### WikiText-2 (primary, 512-token non-overlapping, full test split)

| Model | BF16 PPL | q4 PPL | ΔPPL | Tok/s |
|-------|----------|--------|------|-------|
| Qwen2.5-1.5B | 12.70 | 14.60 | +15.0% | 166.6 |
| Qwen2.5-3B | 11.45 | 12.79 | +11.7% | 58.4 |
| Qwen2.5-7B | 10.14 | 11.01 | +8.5% | 63.8 |
| Qwen2.5-14B | 7.73 | 8.53 | +10.3% | 32.4 |
| Mistral-7B | 7.24 | 7.56 | +4.4% | 34.8 |
| Llama-3.1-8B | 9.47 | 10.12 | +6.9% | 28.0 |

### C4 cross-corpus (streaming 200 docs, same 512-token protocol)

| Model | BF16 C4 | q4 C4 | ΔPPL(C4) | C4/Wiki ratio |
|-------|---------|-------|----------|--------------|
| Qwen2.5-1.5B | 18.11 | 21.04 | +16.2% | 1.44× |
| Qwen2.5-3B | 16.29 | 18.19 | +11.7% | 1.42× |
| Qwen2.5-7B | 14.77 | 15.92 | +7.80% | 1.45× |
| Mistral-7B | 10.08 | 10.53 | +4.47% | 1.39× |

> **D5 complete (2026-07-01):** all four models now have paired BF16+q4 C4 measurements. Qwen2.5-7B ΔPPL(C4)=+7.80% vs WikiText-2 +8.5%; Mistral-7B ΔPPL(C4)=+4.47% vs WikiText-2 +4.4% — both track their WikiText-2 values closely, closing the last cross-corpus gap (see `HANDOFF_D4_D5.md` §D5).

### ARC-Easy downstream (§4.3)
- Qwen2.5-7B BF16: 52.5%, q4: 53.0%, ΔACC = +0.5pp (CI ±2.0pp)
- **Null result (underpowered)** — no detectable degradation; test cannot rule out small effects

### Short-text screening (§3.3, tab:qwen_5way only — NOT comparable to WikiText-2)
- q4_uniform = 59.96 PPL (scheme selection use only)
- Do NOT mix with WikiText-2 numbers

---

## 4. What was done

### 2026-06-05 → 2026-06-20

| Commit | Change |
|--------|--------|
| `e1f11bf` | Repo modularized: eval/ analysis/ results/ scripts/ artifacts/ |
| `faf429d` | §4.4 C4 cross-corpus added (1.5B/3B BF16+q4 paired); dead macros removed |
| `444e202` | 7B+Mistral C4 q4-only ratio added; cross-arch ratio discussion |
| `823b8bc` | README updated with C4 full results and score 80.65 |
| `e96bcd9` | Graphify 356n/494e (post-modularization) |
| `6aa16bb` | `barrios2026native`: @misc → @inproceedings (EuroMLSys '26, ACM workshop) |
| `12931b1` | §5.2: GPTQ/AWQ cross-library context paragraph; README calibration note |
| `025c0e1` | Graphify 426n/601e |

### 2026-07-01

| Commit | Change |
|--------|--------|
| `1dfc695` | D1–D3 reviewer framing fixes (see §5 below) |
| (this commit) | D5: Qwen2.5-7B + Mistral-7B BF16 C4 baselines measured, closing last C4 cross-corpus gap |

---

## 5. Reviewer critique — status

### ✅ Addressed

- **Methodology inconsistency (mlx-community vs local quantize):** All Qwen models re-quantized locally with `mlx_lm.convert` g64 (confound removed, stated in §3.3 / §6.3)
- **C4 cross-corpus:** §4.4 added, fully paired BF16+q4 for all 4 models (1.5B/3B/7B/Mistral-7B) as of D5, 2026-07-01
- **barrios citation:** Upgraded to @inproceedings (EuroMLSys '26)
- **GPTQ/AWQ comparison (partial):** §5.2 cites lin2023awq Table 4 — LLaMA-2-7B GPTQ g128 +4.0% / AWQ +2.4% as proxy for Mistral-7B (+4.4%)
- **D1: ARC-Easy null-result framing** (`1dfc695`) — replaced "no statistically significant degradation" with "no detectable accuracy change; underpowered to rule out small effects; absence of evidence rather than evidence of absence"
- **D2: Abstract tone** (`1dfc695`) — added "with four scale points this is an observational result, not a characterised trend"; "motivating" → "suggesting"
- **D3: Vocabulary-sparsity overstatement** (`1dfc695`) — demoted from mechanism to "candidate mechanism"; table caption and lead-in now explicitly note n=3 / three confounders vary simultaneously
- **D5: 7B/Mistral BF16 C4 baseline** (2026-07-01) — Qwen2.5-7B BF16 C4=14.77 (ΔPPL=+7.80% vs WikiText-2 +8.5%), Mistral-7B BF16 C4=10.08 (ΔPPL=+4.47% vs WikiText-2 +4.4%); all 4 models now fully paired on C4, see `HANDOFF_D4_D5.md` §D5
- **D4: cross-hardware WikiText-2 on RTX 5070 Ti / CUDA** (2026-07-04) — q4 ΔPPL% reproduces MLX within 0.3 pp for all four affine-q4 models (1.5B +15.1%, 3B +12.0%, 7B +8.6%, Mistral +4.4%); five BF16 baselines match to 4 s.f.; 14B via NF4 (+7.0%, scheme exception). `tab:crosshw` added. Method correction: dequantize real `mlx_lm.convert` checkpoint, not a hand-rolled RTN (which diverged). See `HANDOFF_D4_RESULTS.md`

### ✅ D4 DONE (2026-07-04) — see [`HANDOFF_D4_RESULTS.md`](./HANDOFF_D4_RESULTS.md)

**D4: 2nd hardware platform (RTX 5070 Ti)** — cross-hardware reproduction landed.
- RESULT: q4 ΔPPL% reproduced on CUDA within **0.3 pp** of MLX for all four
  affine-q4 models (1.5B +15.1%, 3B +12.0%, 7B +8.6%, Mistral +4.4%); all five
  BF16 baselines match MLX to 4 s.f. Table `tab:crosshw` + macros added to `paper.tex`.
- METHOD CORRECTION: the from-scratch RTN fake-quantizer prescribed in
  `HANDOFF_D4.md` did **not** reproduce `mx.quantize` (3B diverged to +31.9%).
  Authoritative path = dequantize the real `mlx_lm.convert -q` checkpoint and
  inject → byte-exact scheme parity. Full write-up in `HANDOFF_D4_RESULTS.md` §2.
- SCHEME EXCEPTION: 14B uses bitsandbytes NF4 (BF16 28 GB > 15.9 GB card); flagged
  as a separate data point, not a parity comparison.
- OUTSTANDING: only Llama-3.1-8B (gated repo, needs license acceptance).

---

## 6. Artifacts and checkpoints

All C4 checkpoints under `artifacts/`:
- `qwen15b_q4_local_c4_ppl_checkpoint.json` — done=True
- `qwen3b_q4_local_c4_ppl_checkpoint.json` — done=True
- `qwen7b_q4_local_c4_ppl_checkpoint.json` — done=True (q4)
- `qwen7b_bf16_c4_ppl_checkpoint.json` — done=True (BF16, added D5 2026-07-01)
- `mistral7b_q4_local_c4_ppl_checkpoint.json` — done=True (q4)
- `mistral7b_bf16_c4_ppl_checkpoint.json` — done=True (BF16, added D5 2026-07-01)

WikiText-2 results: `results/ppl_results.txt`

---

## 7. Eval quick-reference

```bash
# Full WikiText-2 PPL (checkpointing, auto-resumes on Metal crash)
python eval/eval_ppl_wikitext2.py --model mlx-community/Qwen2.5-7B-4bit

# C4 cross-corpus
python eval/eval_ppl_c4.py --model mlx-community/Qwen2.5-7B-4bit

# ARC-Easy downstream
python eval/eval_arc_e.py --model mlx-community/Qwen2.5-7B-Instruct-4bit --n 200

# Regenerate scale figure
python analysis/gen_scale_ppl_fig.py 7.2432 7.5601
```

---

## 8. Knowledge graph

- Location: `graphify-out/graph.json`, `graphify-out/GRAPH_REPORT.md`, `graphify-out/graph.html`
- Stats: 426n / 601e / 27 communities (2026-06-20, after C4 eval update)
- God nodes: AX OS main paper (36e), Figure 4 scale-PPL (13e), _harness.mjs (12e), README (13e)

---

## 9. Submission readiness

| State | Venue tier |
|-------|-----------|
| **Now** (D1–D3 fixed) | Workshop / short-paper / arXiv preprint |
| + D4 (RTX 5070 Ti) | MLSys workshop, EdgeAI workshop, EMNLP System Demonstrations |
| + D4 + D5 | Full conference short-paper track |

**Single remaining blocker for workshop submission:** none — paper is clean.  
**Main-conference blocker (D4, 2nd hardware platform): RESOLVED 2026-07-04.**
Cross-hardware reproduction on RTX 5070 Ti (CUDA) agrees with M1 Max (MLX) within
0.3 pp on q4 ΔPPL% for all four affine-q4 models; `tab:crosshw` is in `paper.tex`.
Optional strengthening only: Llama-3.1-8B (gated) and extending the cross-hardware
sweep to C4. See `HANDOFF_D4_RESULTS.md`.
