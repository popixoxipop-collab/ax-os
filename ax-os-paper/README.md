# AX OS: Architecture-Aware Quantization Sensitivity Study

A systematic measurement of 4-bit quantization (PTQ, MLX q4) perplexity degradation across model architectures and scales.

## Key Results

Uniform protocol: non-overlapping 512-token windows, full WikiText-2 test split, per-model tokenizer.

| Model | BF16 PPL | q4 PPL | ΔPPL |
|-------|----------|--------|------|
| Qwen2.5-1.5B | 12.70 | 14.60 | +15.0% |
| Qwen2.5-3B | 11.45 | 12.79 | +11.7% |
| Qwen2.5-7B | 10.14 | 11.01 | +8.5% |
| Qwen2.5-14B | 7.73 | 8.53 (+10.3%) | ✅ 8.5313 verified |
| Mistral-7B | 7.24 | 7.56 | +4.4% |

- **Cross-architecture gap at 7B**: 1.9× (Qwen more sensitive than Mistral)
- **Intra-family scale effect**: 1.8× range across 4.7× parameter increase (15.0%→8.5%), monotonically decreasing
- **Paper score**: 72.7/100 (paper-orchestra 6-axis rubric, post-Llama+throughput-fix+structural-refactor)

## Files

- `paper.tex` — Main LaTeX source
- `eval_ppl_wikitext2.py` — Full-corpus PPL evaluation (512-token non-overlapping windows)
- `eval_ppl_quick.py` — Quick eval (first 8192 tokens, 16 windows)
- `gen_scale_ppl_fig.py` — Regenerate `figures/fig_q4_scale_ppl.png`
- `figures/` — Paper figures

## Eval

```bash
# Full-corpus eval — checkpointing enabled (auto-resumes on Metal GPU crash)
# IMPORTANT: Close Chrome + heavy GPU apps first (Metal watchdog on 14B+)
python eval_ppl_wikitext2.py --model mlx-community/Qwen2.5-7B-4bit

# Quick eval (first 8192 tokens)
python eval_ppl_quick.py mlx-community/Qwen2.5-7B-4bit

# Regenerate scale figure
python gen_scale_ppl_fig.py 7.2432 7.5601
```

## Build

```bash
pdflatex paper && bibtex paper && pdflatex paper && pdflatex paper
```
