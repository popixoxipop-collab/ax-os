# AX OS: Architecture-Aware Quantization Sensitivity Study

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
- **ARC-Easy downstream**: Qwen2.5-7B BF16=52.5%, q4=53.0% (ΔACC=+0.5pp, CI=±2.0pp) — no degradation
- **q8 lossless**: Qwen2.5-7B q8 ΔPPL=−0.28%; q4 (+8.5%) is the inflection point
- **Paper score**: 78.7/100 (paper-orchestra 6-axis rubric)

### C4 Cross-Corpus (partial — 7B/Mistral pending)

| Model | BF16 C4 PPL | q4 C4 PPL | ΔPPL |
|-------|-------------|-----------|------|
| Qwen2.5-1.5B | 18.11 | 21.04 | +16.2% |
| Qwen2.5-3B | 16.29 | 18.19 | +11.7% |
| Qwen2.5-7B | — | TBD | — |
| Mistral-7B | — | TBD | — |

ΔPPL tracks WikiText-2 values closely, confirming cross-corpus stability for 1.5B/3B.

## Repository Structure

```
ax-os-paper/
├── paper.tex          # LaTeX source (11 pages)
├── refs.bib
├── paper.pdf          # Compiled output
├── figures/           # Paper figures
├── eval/              # Evaluation scripts
│   ├── eval_ppl_wikitext2.py   # Full-corpus PPL (512-token non-overlapping)
│   ├── eval_ppl_quick.py       # Quick eval (first 8192 tokens)
│   ├── eval_ppl_c4.py          # C4 cross-corpus PPL
│   ├── eval_arc_e.py           # ARC-Easy downstream eval
│   └── eval_hellaswag_mlx.py   # HellaSwag eval
├── analysis/          # Analysis scripts
│   ├── hapax_ablation.py
│   ├── integrate_hapax_ablation.py
│   ├── tokenizer_analysis.py
│   └── gen_scale_ppl_fig.py
├── results/           # JSON + text result files
│   ├── hapax_ablation_results.json
│   ├── hellaswag_results.json
│   ├── tokenizer_analysis_results.json
│   └── ppl_results.txt
├── scripts/           # Shell eval drivers
│   ├── run_14b_eval.sh
│   ├── run_llama8b_eval.sh
│   └── run_path_a.sh
└── artifacts/         # Downloaded/quantized model checkpoints + C4 checkpoints
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
| arXiv bib + oracle framing | 78.7 | +1.3 (current) |

Next: ajayi/barrios to peer-reviewed bib (+2pp), or 2nd hardware / full C4 for scientific_depth (+4 to 6pp).
