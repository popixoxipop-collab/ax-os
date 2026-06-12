#!/usr/bin/env python3
"""Regenerate fig_q4_scale_ppl.png with 4 Qwen scale points + 2 cross-arch references."""
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

mistral_bf16 = float(sys.argv[1]) if len(sys.argv) > 1 else 7.24
mistral_q4   = float(sys.argv[2]) if len(sys.argv) > 2 else 7.56
llama_bf16   = float(sys.argv[3]) if len(sys.argv) > 3 else 9.4669
llama_q4     = float(sys.argv[4]) if len(sys.argv) > 4 else 10.1245

qwen_params = [1.5, 3.0, 7.6, 14.0]
qwen_delta  = [15.0, 11.7, 8.5, 10.3]
mistral_param = 7.2
mistral_delta = round((mistral_q4 - mistral_bf16) / mistral_bf16 * 100, 1)
llama_param   = 8.0
llama_delta   = round((llama_q4 - llama_bf16) / llama_bf16 * 100, 1)

fig, ax = plt.subplots(figsize=(5.5, 3.8))

# Qwen: solid line 1.5B→7B (decreasing trend), dashed 7B→14B (uptick)
ax.plot(qwen_params[:3], qwen_delta[:3], 'o-', color='#1f77b4', linewidth=1.5,
        markersize=8, label='Qwen2.5', zorder=3)
ax.plot(qwen_params[2:], qwen_delta[2:], 'o--', color='#1f77b4', linewidth=1.2,
        markersize=8, zorder=3)  # dashed = non-monotone uptick

# Labels
label_offsets = [(5, 5), (5, 5), (-42, -14), (5, -14)]
for (x, y), (dx, dy) in zip(zip(qwen_params, qwen_delta), label_offsets):
    ax.annotate(f'+{y:.1f}%', (x, y), textcoords='offset points',
                xytext=(dx, dy), fontsize=8, color='#1f77b4')

# Mistral cross
ax.plot(mistral_param, mistral_delta, 'x', color='#d62728', markersize=12,
        markeredgewidth=2.5, label=f'Mistral-7B (+{mistral_delta:.1f}%)', zorder=4)
ax.annotate(f'+{mistral_delta:.1f}%', (mistral_param, mistral_delta),
            textcoords='offset points', xytext=(6, 5), fontsize=8, color='#d62728')

# Llama diamond
ax.plot(llama_param, llama_delta, 'D', color='#2ca02c', markersize=9,
        label=f'Llama-3.1-8B (+{llama_delta:.1f}%)', zorder=4)
ax.annotate(f'+{llama_delta:.1f}%', (llama_param, llama_delta),
            textcoords='offset points', xytext=(6, -13), fontsize=8, color='#2ca02c')

# Gap annotation (Qwen-7B vs Mistral-7B span)
gap = qwen_delta[2] / mistral_delta
mid_y = (qwen_delta[2] + mistral_delta) / 2
ax.annotate(f'{gap:.1f}× range', xy=(9.2, mid_y), fontsize=8,
            color='gray', style='italic', ha='left', va='center')

# Trend annotation
ax.annotate('uptick', xy=(14.0, 10.3), textcoords='offset points',
            xytext=(-10, 10), fontsize=7, color='#aaaaaa',
            arrowprops=dict(arrowstyle='->', color='#aaaaaa', lw=0.8))

ax.set_xlabel('Parameters (B)', fontsize=10)
ax.set_ylabel('$\\Delta$PPL (%)', fontsize=10)
ax.set_title('WikiText-2 q4 perplexity increase vs.\\ scale', fontsize=10)
ax.set_xlim(0.5, 17)
ax.set_ylim(0, max(qwen_delta) * 1.40)
ax.legend(fontsize=8, loc='upper right')
ax.grid(True, alpha=0.3, linestyle='--')
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)

# Legend note for dashed line
from matplotlib.lines import Line2D
custom = [Line2D([0],[0], color='#1f77b4', lw=1.2, ls='--',
                 label='non-monotone (14B)')]
handles, labels = ax.get_legend_handles_labels()
ax.legend(handles + custom, labels + ['non-monotone (14B)'],
          fontsize=7.5, loc='upper right')

plt.tight_layout()
outpath = 'figures/fig_q4_scale_ppl.png'
plt.savefig(outpath, dpi=150, bbox_inches='tight')
print(f"Saved: {outpath}")
