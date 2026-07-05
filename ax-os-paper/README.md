# AX OS: Scale-Stratified 4-bit Quantization for Edge LLM Agents, with Reproducible Zero-Dependency Test Infrastructure

A systematic measurement of 4-bit quantization (PTQ, MLX q4) perplexity degradation across model architectures and scales.

## Key Results

Uniform protocol: non-overlapping 512-token windows, full WikiText-2 test split, per-model tokenizer.

| Model | BF16 PPL | q4 PPL | ΔPPL |
|-------|----------|--------|------|
| Qwen2.5-1.5B | 12.70 | 14.60 | +15.0% |
| Qwen2.5-3B | 11.45 | 12.79 | +11.7% |
| Qwen2.5-7B | 10.14 | 11.01 | +8.5% |
| Qwen2.5-14B | 7.73 | 8.53 | +10.3% |
| Mistral-7B | 7.24 | 7.56 | +4.4% |
| Llama-3.1-8B | 9.47 | 10.12 | +6.9% |

**Key findings:**
- **Cross-architecture gap at 7–8B**: 1.9× range — Qwen(+8.5%) > Llama(+6.9%) > Mistral(+4.4%)
- **Intra-family scale effect**: monotonically decreasing 15.0% to 8.5% (1.5B to 7B), non-monotone at 14B (+10.3%)
- **Cross-hardware validation (D4, 2026-07-04/05)**: all 6 models reproduced on RTX 5070 Ti/CUDA within 0.3pp of the Apple M1 Max/MLX numbers above (`tab:crosshw`), with a paired bootstrap 95% CI under 0.7pp wide on every model (computed for free from the CUDA runs' per-window NLL logs — the original MLX runs didn't retain those).
- **Real AWQ/GPTQ baselines (2026-07-06)**: replaced the old literature-proxy comparison with a direct, matched-protocol measurement against official Qwen AWQ/GPTQ-Int4 releases + established community quantizations (Mistral, Llama). Both dominate our uniform RTN as expected; the Mistral > Llama > Qwen robustness ordering mostly replicates across quantization method, not just hardware — the paper's strongest robustness evidence (`tab:awqgptq`). One point (Qwen2.5-14B GPTQ-Int4) excluded as a confirmed-broken checkpoint/kernel combination on this hardware (PPL 10× baseline, verified via direct generation — incoherent output), flagged explicitly rather than hidden.
- **ARC-Easy downstream**: Qwen2.5-7B BF16=52.5%, q4=53.0% (ΔACC=+0.5pp, CI=±2.0pp per condition, not paired) — no detectable degradation (underpowered; cannot rule out small effects)
- **HellaSwag downstream (2nd model+task, 2026-07-06)**: Qwen2.5-7B no change (78.25%→78.25%), Mistral-7B −0.5pp (79.5%→79.0%), both within ~±4.0pp CI
- **q8 lossless**: Qwen2.5-7B q8 ΔPPL=−0.28%; q4 (+8.5%) is the inflection point
- **Paper score**: internal paper-orchestra self-score 80.65/100 (6-axis rubric, 2026-06-20, ±10pp calibration variance noted by the tool itself) vs. an independent Codex CLI review (2026-07-05, deliberately not shown the internal score first, instructed to be adversarial): **56/100**, "borderline workshop paper, reject for a competitive short-conference track." Codex's specific factual claims (stale limitations text, a Mistral version typo, a matcher-count-off-by-one, an unsubstantiated Vitest-baseline comparison) were independently verified against the source before acting — all confirmed accurate — then fixed (commits `857c490`, `cb3eec9`). The gap between 80.65 and 56 is itself informative: treat the internal rubric as optimistic, the external review as the operative one for submission-readiness calls.

### C4 Cross-Corpus

| Model | BF16 C4 | q4 C4 | ΔPPL(C4) | ΔPPL(Wiki) | C4/Wiki ratio |
|-------|---------|-------|----------|-----------|--------------|
| Qwen2.5-1.5B | 18.11 | 21.04 | +16.2% | +15.0% | 1.44× |
| Qwen2.5-3B | 16.29 | 18.19 | +11.7% | +11.7% | 1.42× |
| Qwen2.5-7B | 14.77 | 15.92 | +7.80% | +8.5% | 1.45× |
| Mistral-7B | 10.08 | 10.53 | +4.47% | +4.4% | 1.39× |

**C4 key finding**: all four models now fully paired BF16+q4 (D5, 2026-07-01). Qwen2.5 family C4/Wiki q4 PPL ratio is scale-invariant at 1.42–1.45× (spread <2%). Mistral 1.39× (moderately lower, consistent with lower absolute PPL). ΔPPL(C4) tracks ΔPPL(Wiki) within 1.2pp for every model.

## Repository Structure

```
ax-os-paper/
├── paper.tex          # LaTeX source (17 pages)
├── refs.bib
├── paper.pdf          # Compiled output
├── figures/           # Paper figures
├── eval/              # Evaluation scripts
│   ├── eval_ppl_wikitext2.py       # Full-corpus PPL, MLX (512-token non-overlapping)
│   ├── eval_ppl_wikitext2_cuda.py  # Same protocol, CUDA/transformers; --precision
│   │                                 bf16|q4|nf4|awq|gptq (awq/gptq: point --model at
│   │                                 the pre-quantized checkpoint repo directly)
│   ├── eval_ppl_wikitext2_cuda_mlxparity.py  # dequantized real-MLX-checkpoint parity path
│   ├── eval_ppl_quick.py       # Quick eval (first 8192 tokens)
│   ├── eval_ppl_c4.py          # C4 cross-corpus PPL
│   ├── eval_arc_e.py           # ARC-Easy downstream eval
│   └── eval_hellaswag_mlx.py   # HellaSwag eval (MLX; not yet ported to CUDA)
├── analysis/          # Analysis scripts
│   ├── hapax_ablation.py
│   ├── integrate_hapax_ablation.py
│   ├── tokenizer_analysis.py
│   ├── gen_scale_ppl_fig.py
│   ├── bootstrap_ci.py       # Paired bootstrap 95% CI from per-window NLL checkpoints
│   └── compile_baselines.py  # Compiles ours vs AWQ vs GPTQ ΔPPL% into one table
├── results/           # JSON + text result files
│   ├── hapax_ablation_results.json
│   ├── hellaswag_results.json
│   ├── tokenizer_analysis_results.json
│   └── ppl_results.txt
├── scripts/           # Shell eval drivers
│   ├── run_14b_eval.sh
│   ├── run_llama8b_eval.sh
│   ├── run_path_a.sh
│   ├── d4_run_llama.sh                    # D4 cross-hardware, Llama-3.1-8B leg
│   └── shortpaper_awq_gptq_grid.sh,        # Real AWQ/GPTQ baseline grid (6 models)
│       shortpaper_gptq_retry.sh             # + optimum-dependency retry
└── artifacts/         # Downloaded/quantized model checkpoints, PPL checkpoints
                        # (per-window NLLs — bootstrap_ci.py resamples these directly),
                        # C4 checkpoints, baselines_compiled.json, bootstrap_ci_results.json
```

## Eval

```bash
# Full-corpus WikiText-2 PPL (checkpointing — auto-resumes on Metal GPU crash)
# Close Chrome + heavy GPU apps first (Metal watchdog on 14B+)
python eval/eval_ppl_wikitext2.py --model mlx-community/Qwen2.5-7B-4bit

# C4 cross-corpus eval
python eval/eval_ppl_c4.py --model mlx-community/Qwen2.5-7B-4bit

# Quick eval (first 8192 tokens)
python eval/eval_ppl_quick.py mlx-community/Qwen2.5-7B-4bit

# Regenerate scale figure
python analysis/gen_scale_ppl_fig.py 7.2432 7.5601
```

## Build

```bash
pdflatex paper && bibtex paper && pdflatex paper && pdflatex paper
```

## Scoring Trajectory

| Commit | Score | Change |
|--------|-------|--------|
| initial | 65.5 | baseline |
| uniform full-corpus, 4 models | 73.0 | +7.5 |
| 14B + tokenizer mechanism | 76.1 | +3.1 |
| Llama + throughput correction | 68.7 | -7.4 regression |
| structural refactor | 72.7 | +4.0 |
| ARC-Easy downstream eval | 77.4 | +4.7 |
| arXiv bib + oracle framing | 78.7 | +1.3 |
| §4.4 C4 paired + macro cleanup | 80.0 | +1.3 |
| 7B+Mistral C4 cross-arch ratio | **80.65** | +0.65 |
| barrios @inproceedings upgrade | — | bib quality (LLM scorer noise too high) |
| GPTQ cross-library context §5.2 | — | addresses reviewer critique |
| D1–D3 reviewer framing fixes | — | integrity/honesty |
| D4: cross-hardware CUDA validation, all 6 models | — | scientific_depth lever landed (`4174781`, `857c490`...) |
| Independent Codex review | **56** | first *external*, adversarial score — see above |
| Codex-flagged fixes (tier A: factual, tier B: rigor scoping) | — | `857c490`, `cb3eec9` |
| Bootstrap CI + real AWQ/GPTQ baselines + HellaSwag ext. | — | `6f3c41d`, `8c3c777` |

**Note**: LLM scorer calibration variance ±10pp — internal scores not reliable for marginal tracking;
the 56/100 external review is the more trustworthy read on submission-readiness now.
Next: literature search for closely-related prior work (in progress), then decide target venue.
