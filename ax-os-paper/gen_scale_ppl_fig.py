#!/usr/bin/env python3
"""Regenerate fig_q4_scale_ppl.png with updated full-corpus measurements."""
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

# Updated full-corpus measurements (eval_ppl_wikitext2.py, 512-token non-overlapping windows)
# Usage: python gen_scale_ppl_fig.py <mistral_bf16_ppl> <mistral_q4_ppl>
mistral_bf16 = float(sys.argv[1]) if len(sys.argv) > 1 else 8.92
mistral_q4   = float(sys.argv[2]) if len(sys.argv) > 2 else 9.27

qwen_params = [1.5, 3.0, 7.6]  # billions
qwen_delta  = [15.0, 11.7, 8.5]  # % ΔPPL (full corpus)
mistral_param = 7.2
mistral_delta = round((mistral_q4 - mistral_bf16) / mistral_bf16 * 100, 1)

print(f"Mistral ΔPPL = ({mistral_q4} - {mistral_bf16}) / {mistral_bf16} * 100 = {mistral_delta:.1f}%")
gap = qwen_delta[2] / mistral_delta if mistral_delta > 0 else float('inf')
print(f"Cross-arch gap at 7B: {gap:.1f}x (Qwen {qwen_delta[2]}% / Mistral {mistral_delta}%)")

fig, ax = plt.subplots(figsize=(5.0, 3.5))

# Qwen family: filled circles
ax.plot(qwen_params, qwen_delta, 'o-', color='#1f77b4', linewidth=1.5,
        markersize=8, label='Qwen2.5 (filled circles)', zorder=3)
for x, y in zip(qwen_params, qwen_delta):
    ax.annotate(f'+{y:.1f}%', (x, y), textcoords='offset points',
                xytext=(5, 5), fontsize=8, color='#1f77b4')

# Mistral: cross marker
ax.plot(mistral_param, mistral_delta, 'x', color='#d62728', markersize=12,
        markeredgewidth=2.5, label=f'Mistral-7B (+{mistral_delta:.1f}%)', zorder=3)
ax.annotate(f'+{mistral_delta:.1f}%', (mistral_param, mistral_delta),
            textcoords='offset points', xytext=(5, -12), fontsize=8, color='#d62728')

# Annotations
ax.annotate(f'{gap:.1f}× gap',
            xy=(7.2, (qwen_delta[2] + mistral_delta) / 2),
            fontsize=8, color='gray', style='italic',
            ha='left', va='center',
            xytext=(7.4, (qwen_delta[2] + mistral_delta) / 2),
            arrowprops=None)

ax.set_xlabel('Parameters (B)', fontsize=10)
ax.set_ylabel('$\\Delta$PPL (%)', fontsize=10)
ax.set_title('WikiText-2 q4 perplexity increase vs.\ scale', fontsize=10)
ax.set_xlim(0.8, 10)
ax.set_ylim(0, max(qwen_delta) * 1.3)
ax.legend(fontsize=8)
ax.grid(True, alpha=0.3, linestyle='--')
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)

plt.tight_layout()
outpath = 'figures/fig_q4_scale_ppl.png'
plt.savefig(outpath, dpi=150, bbox_inches='tight')
print(f"Saved: {outpath}")
