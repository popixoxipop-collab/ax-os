# AX OS Paper — Handoff

**Last updated:** 2026-06-20  
**Repo:** `github.com/popixoxipop-collab/ax-os` (paper lives in `ax-os-paper/`)  
**HEAD at handoff:** `12931b1`  
**Branch:** `main` (pushed to `origin/main`)

---

## 1. Current state

- `paper.tex` — 14 pages, compiles clean (pdflatex + bibtex, no errors, no undefined refs)
- `paper.pdf` — committed build, in sync with `paper.tex`
- **Best score estimate: 80.65 / 100** (2-rater weighted average, 2026-06-20)
  - ⚠️ LLM scorer calibration variance = ±10 pp — single-session scores unreliable for marginal tracking
  - 80.65 was achieved at commit `444e202` (C4 cross-arch ratio complete)

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
| Qwen2.5-7B | — | 15.92 | — | 1.45× |
| Mistral-7B | — | 10.53 | — | 1.39× |

> 7B/Mistral BF16 C4 baselines not measured (download constraint). C4/Wiki ratio used as proxy for corpus-independence.

### ARC-Easy downstream (§4.3)
- Qwen2.5-7B BF16: 52.5%, q4: 53.0%, ΔACC = +0.5pp (CI ±2.0pp) — null result (underpowered)

### Short-text screening (§3.3, tab:qwen_5way only — NOT comparable to WikiText-2)
- q4_uniform = 59.96 PPL (scheme selection use only)
- Do NOT mix with WikiText-2 numbers

---

## 4. What was done (2026-06-05 → 2026-06-20)

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

---

## 5. Reviewer critique — what's addressed vs. open

From adversarial review (2026-06-20, read `paper.tex` directly):

### ✅ Addressed
- **Methodology inconsistency (mlx-community vs local quantize):** All Qwen models re-quantized locally with `mlx_lm.convert` g64 (confound removed, stated in §3.3 / §6.3)
- **C4 cross-corpus:** §4.4 added, fully paired for 1.5B/3B, ratio-only for 7B/Mistral
- **barrios citation:** Upgraded to @inproceedings (EuroMLSys '26)
- **GPTQ/AWQ comparison (partial):** §5.2 now cites lin2023awq Table 4 — LLaMA-2-7B GPTQ g128 +4.0% / AWQ +2.4% as closest available proxy for Mistral-7B (+4.4%)

### ⬜ Open (fixable without new experiments)

**D1: ARC-Easy null-result framing**
- Current: "no statistically significant commonsense reasoning degradation"
- Correct: "+0.5pp with CI ±2.0pp is underpowered — cannot confirm absence of degradation"
- WHY fix: reviewers flag misleading positive framing of a null result
- COST: weakens a claim; net honest
- EXIT: change one sentence in §4.3 results paragraph

**D2: Abstract/body tone mismatch**
- Abstract: confident "+15.0%, +11.7%, +8.5%" with no hedging
- Body §5.1: "with four scale points, we report this as an observation, not a characterised trend"
- WHY fix: abstract sets expectations the body doesn't fulfill
- EXIT: add "preliminary" or "observational" qualifier to abstract claims

**D3: Vocabulary-sparsity hypothesis overstatement**
- n=3 architectures, three confounders vary simultaneously
- Already hedged in §5.1 but led as a "finding"
- EXIT: demote from finding to "candidate mechanism" in §5.1 framing

### ⬜ Open (require new experiments)

**D4: 2nd hardware platform (RTX 5070 Ti)**
- WHY: scientific_depth bottleneck is single-hardware scope (M1 Max only)
- COST: requires CUDA setup + model download (~2-4 hr per model)
- EXIT: `python eval/eval_ppl_wikitext2.py --device cuda --model artifacts/...`
- IMPACT: +4–6pp on scientific_depth (largest remaining lever)

**D5: 7B/Mistral BF16 C4 baseline**
- Currently missing — download constraint
- WHY: enables proper ΔPPL(C4) for all 4 models
- EXIT: download Qwen2.5-7B-bf16 and Mistral-7B-bf16, run `eval/eval_ppl_c4.py`

---

## 6. Artifacts and checkpoints

All C4 checkpoints under `artifacts/`:
- `qwen15b_q4_local_c4_ppl_checkpoint.json` — done=True
- `qwen3b_q4_local_c4_ppl_checkpoint.json` — done=True
- `qwen7b_q4_local_c4_ppl_checkpoint.json` — done=True (q4 only, no BF16)
- `mistral7b_q4_local_c4_ppl_checkpoint.json` — done=True (q4 only, no BF16)

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
- Stats: 595n / 813e / 53 communities (2026-06-20)
- God nodes: AX OS paper, Contribution 3 (scale-stratified q4), ΔPPL metric, _harness.mjs

---

## 9. Submission readiness

Current state is **submission-ready** for a workshop or short-paper venue. Blockers for a main-conference venue:

1. ⬜ 2nd hardware platform (D4 above) — scientific_depth
2. ⬜ ARC-Easy framing fix (D1) — evidence integrity
3. ⬜ Abstract hedging (D2) — consistency

Without D4, top candidate venues: ML workshop tracks, arXiv preprint only.  
With D4: MLSys workshop, EdgeAI workshop, EMNLP System Demonstrations.
