# AX OS Paper — Handoff

**Last updated:** 2026-06-05
**Repo:** `github.com/popixoxipop-collab/ax-os` (tracked under `/Users/xox`, paper lives in `ax-os-paper/`)
**HEAD at handoff:** `bd17d64` (pushed to `origin/main`)

---

## 1. Current state

- `paper.tex` (33 KB) compiles **clean** — 9 pages, no errors, no undefined refs/citations.
- `paper.pdf` is the committed build output, in sync with `paper.tex`.
- Local `origin/main` are synchronized at `bd17d64`.
- 4 figures present and referenced: `fig_harness_architecture`, `fig_quantization_pareto`,
  `fig_q4_scale_ppl` (4-point: Qwen 1.5B/3B/7B + Mistral cross), `fig_system_overview`.
- 15 `\cite` keys ↔ 15 `refs.bib` entries (1:1, no missing references).

### Build command
```bash
cd ax-os-paper
pdflatex -interaction=nonstopmode paper.tex
bibtex paper
pdflatex -interaction=nonstopmode paper.tex
pdflatex -interaction=nonstopmode paper.tex
# clean: rm -f paper.aux paper.bbl paper.blg paper.log paper.out
```
> `pdflatex` (not `latexmk`, which is absent). `tectonic` is also available.

---

## 2. Latest peer-review score — **65.5 / 100**

Two independent raters, 6-axis rubric (per `~/CLAUDE.md` paper-orchestra rule —
no Skill call; two parallel agents, identical standard rubric, weighted average):

| Axis | Weight | Rater A | Rater B | Avg |
|---|---|---|---|---|
| scientific_depth | 0.20 | 58 | 58 | 58.0 |
| technical_execution | 0.20 | 52 | 60 | 56.0 |
| logical_flow | 0.15 | 70 | 72 | 71.0 |
| writing_clarity | 0.15 | 78 | 76 | 77.0 |
| evidence_presentation | 0.20 | 66 | 65 | 65.5 |
| academic_style | 0.10 | 74 | 74 | 74.0 |

Weighted total = 58·0.20 + 56·0.20 + 71·0.15 + 77·0.15 + 65.5·0.20 + 74·0.10 = **65.5**

---

## 3. What was done this session (2026-06-04 → 06-05)

| Commit | Change |
|---|---|
| `807bfd5` | Escaped 10 literal `Δ` (U+0394) → `$\Delta$` (was raising pdflatex Unicode errors) |
| `3bd7e5e` | Disclosed **two PPL protocols**; tab:qwen_5way caption; stale "for both model sizes"; single-artifact limitation |
| `a09aa88` | Quantization-pipeline confound limitation + knowledge graph (graphify-out) |
| `bd17d64` | **Corrected stale "15× gap" → "3.7×"** in intro (leftover from old short-text numbers) |

**No measured values were changed or fabricated** (Data-First rule). Refinement was limited to
reconciling internal inconsistencies and adding honest limitations.

### Key fact for future editors: TWO perplexity protocols (do not conflate)
- **WikiText-2 (standard, primary)** → `tab:scale`, `tab:mistral`, `fig:scale_ppl`.
  Qwen-1.5B q4 = 16.75, Mistral-7B q4 = 9.27.
- **Fixed short-text screening** → `tab:qwen_5way` only (scheme ranking).
  Qwen-1.5B q4 = 59.96. **Not comparable** to WikiText-2 numbers. Methodology §3.3 now states this.

---

## 4. Open issues — score ceiling for text-only edits is reached

The two lowest axes (scientific_depth 58, technical_execution 56) cannot be raised by
prose edits. Both raters converged on the same blockers. Each requires a user decision:

### Path A — Re-run experiments (raises TE/SD, needs GPU time)
1. **Confounded cross-arch claim.** Qwen q4 = mlx-community (group size unspecified);
   Mistral q4 = local `mlx_lm.convert` (group size 64). The +3.9% vs +14.3% "architecture
   dominates" claim is not cleanly attributable. → Re-quantize **all** models with one
   identical pipeline, then re-measure ΔPPL. (Already disclosed as a limitation in §6.3.)
2. **n=1 point estimates, no CI.** Add multi-run variance across quant runs / calibration
   subsets. (Disclosed in §6.2 "Single artifact per configuration".)
3. **3-point scale curve.** Add 13B (and ideally 34B) to test whether the intra-family
   plateau continues. (Future work already names 13B/34B.)

### Path B — Re-scope the thesis (text work, but changes the paper's claim)
- The "AX OS / co-design" narrative bundles three orthogonal contributions (test harness,
  oracle toggle, quantization study) with no real interaction. Both raters flagged this as
  rhetorical. → Option: demote to "quantization finding + two engineering appendices", or
  demonstrate a genuine system interaction that justifies the unified framing.

### Verified NON-issues (do not "fix")
- The "15× gap" inconsistency was **real** and is now fixed (`bd17d64`). Body is consistently 3.7×.
- (Earlier a grep miss caused a false "hallucination" call — corrected.)

---

## 5. Suggested next step

Pick **Path A** or **Path B** for the next score→fix cycle, then re-run the 2-rater
scoring to measure the delta. If neither, the paper is internally consistent and
submission-shaped at 65.5/100 with honest limitations.
