# Graph Report - /Users/xox/ax-os-paper  (2026-06-13)

## Corpus Check
- 13 files · ~50,000 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 193 nodes · 271 edges · 24 communities detected
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 39 edges (avg confidence: 0.82)
- Token cost: 9,200 input · 3,100 output

## Community Hubs (Navigation)
- [[_COMMUNITY_AX OS TypeScript API|AX OS TypeScript API]]
- [[_COMMUNITY_Eval Protocol & Commit History|Eval Protocol & Commit History]]
- [[_COMMUNITY_Citations & ARC-Easy Evidence|Citations & ARC-Easy Evidence]]
- [[_COMMUNITY_Test Suite & Repository|Test Suite & Repository]]
- [[_COMMUNITY_Scale-PPL Relationship|Scale-PPL Relationship]]
- [[_COMMUNITY_Pareto & Mixed-Precision|Pareto & Mixed-Precision]]
- [[_COMMUNITY_Peer Review & Path AB|Peer Review & Path A/B]]
- [[_COMMUNITY_Cross-Arch Gap & Vocab Sparsity|Cross-Arch Gap & Vocab Sparsity]]
- [[_COMMUNITY_Hardware & MLX Backend|Hardware & MLX Backend]]
- [[_COMMUNITY_Graph Report History|Graph Report History]]
- [[_COMMUNITY_Qwen2.5 Model Family Results|Qwen2.5 Model Family Results]]
- [[_COMMUNITY_Paper Figures|Paper Figures]]
- [[_COMMUNITY_Hapax Ablation Functions|Hapax Ablation Functions]]
- [[_COMMUNITY_WikiText-2 Eval Scripts|WikiText-2 Eval Scripts]]
- [[_COMMUNITY_BRAIN Oracle Integration|BRAIN Oracle Integration]]
- [[_COMMUNITY_HellaSwag Eval Functions|HellaSwag Eval Functions]]
- [[_COMMUNITY_Hapax Table Integration|Hapax Table Integration]]
- [[_COMMUNITY_Reproducibility Literature|Reproducibility Literature]]
- [[_COMMUNITY_Full-Corpus Eval Script|Full-Corpus Eval Script]]
- [[_COMMUNITY_Quick Eval Script|Quick Eval Script]]
- [[_COMMUNITY_ARC-Easy Eval Functions|ARC-Easy Eval Functions]]
- [[_COMMUNITY_Scale Figure Generator|Scale Figure Generator]]
- [[_COMMUNITY_Path B Scope Decision|Path B Scope Decision]]
- [[_COMMUNITY_Paper Quality Score|Paper Quality Score]]

## God Nodes (most connected - your core abstractions)
1. `AX OS Paper: Scale-Stratified 4-bit Quantization for Edge LLM Agents` - 34 edges
2. `Figure: WikiText-2 q4 PPL Increase vs. Scale (scatter plot, Qwen2.5/Mistral-7B/Llama-3.1-8B)` - 13 edges
3. `AX OS Paper — Architecture-Aware Quantization Sensitivity Study` - 12 edges
4. `Qwen2.5-1.5B Model` - 10 edges
5. `_harness.mjs: Zero-Dependency Node.js Test Harness (40-line ES module, 27/27 specs)` - 9 edges
6. `_harness.mjs (Zero-Dependency Test Harness)` - 9 edges
7. `Scale-Stratified q4 Sensitivity: DPPL decreasing 1.5B to 7B (15% to 8.5%), non-monotone uptick at 14B (+10.3%)` - 9 edges
8. `Graph Report — 96 nodes, 118 edges, 13 communities (2026-06-04)` - 8 edges
9. `Cross-architecture gap at 7B: 1.9× (Qwen more sensitive than Mistral)` - 7 edges
10. `q4 Uniform Quantization (~800 MB, ~70 PPL) — Pareto Dominant` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Cross-architecture gap at 7B: 1.9× (Qwen more sensitive than Mistral)` --semantically_similar_to--> `Community 9: Claim architecture dominates scale as predictor of q4 robustness (3.7× gap)`  [INFERRED] [semantically similar]
  README.md → graphify-out/GRAPH_REPORT.md
- `Intra-family scale effect: 1.8× range across 4.7× parameter increase (15.0%→8.5%), monotonically decreasing` --semantically_similar_to--> `Community 4: Metric ΔPPL under uniform q4 (%) hub`  [INFERRED] [semantically similar]
  README.md → graphify-out/GRAPH_REPORT.md
- `_harness.mjs: Zero-Dependency Node.js Test Harness (40-line ES module, 27/27 specs)` --achieves--> `Zero External Runtime Dependencies`  [INFERRED]
  paper.pdf → figures/fig_system_overview.png
- `AX OS Paper: Scale-Stratified 4-bit Quantization for Edge LLM Agents` --references--> `AX OS: TypeScript Multi-Agent Library`  [EXTRACTED]
  paper.pdf → README.md
- `WikiText-2 Full-Corpus PPL Evaluation Protocol` --implements--> `eval_ppl_quick.py: Quick Eval Script (first 8192 tokens, 16 windows)`  [INFERRED]
  paper.pdf → README.md

## Communities

### Community 0 - "AX OS TypeScript API"
Cohesion: 0.11
Nodes (26): AEQIntegration TypeScript API (quantize/getCompressionStats/benchmark), Agent Code (TypeScript), AX OS — TypeScript Multi-Agent OS Library, BRAIN_REAL=0 (Mock Mode), BRAIN_REAL=1 (Live Mode), Contribution 1: Zero-Dependency Test Harness, Contribution 2: Inline BRAIN_REAL Oracle Switching, Contribution 3: Scale-Stratified Uniform q4 Compression (+18 more)

### Community 1 - "Eval Protocol & Commit History"
Cohesion: 0.12
Nodes (24): Commit bd17d64 — Corrected stale '15× gap' → '3.7×' in intro, Fixed short-text screening protocol: Qwen-1.5B q4=59.96 — for tab:qwen_5way only, NOT comparable to WikiText-2, Rationale: TWO perplexity protocols — WikiText-2 (standard) vs fixed short-text screening (not comparable), WikiText-2 protocol (primary): Qwen-1.5B q4=16.75, Mistral-7B q4=9.27 — for tab:scale, tab:mistral, fig:scale_ppl, Mistral-7B BF16 local artifact (MLX, base: mistralai/Mistral-7B-Instruct-v0.3), Mistral-7B q4 local artifact (MLX, base: mistralai/Mistral-7B-Instruct-v0.3), PPL results log: Mistral-7B BF16 WikiText-2 eval in progress, PPL results log: Qwen2.5-7B q4 local WikiText-2 eval in progress (+16 more)

### Community 2 - "Citations & ARC-Easy Evidence"
Cohesion: 0.13
Nodes (16): Ajayi & Odunayo 2025: Benchmarking On-Device ML on Apple Silicon with MLX (arXiv:2510.18921), ARC-Easy Downstream: Qwen2.5-7B q4 ACC=53.03% vs BF16=52.53% (DACC=+0.50pp, CI plus-minus 2.0pp, n=2376), AWQ (Lin et al., 2023): Activation-Aware Weight Quantization, MLSys 2024 Best Paper, AX OS Paper: Scale-Stratified 4-bit Quantization for Edge LLM Agents, Barrios 2026: Native LLM/MLLM Inference at Scale on Apple Silicon (arXiv:2601.19139), Clark et al. 2018: ARC Benchmark — AI2 Reasoning Challenge, GPTQ (Frantar et al., 2023): Approximate Second-Order PTQ for GPT Models, Lin et al. 2024: Edge LLM Frameworks Design Axes Survey (+8 more)

### Community 3 - "Test Suite & Repository"
Cohesion: 0.2
Nodes (14): 27/27 PASS (Test Result), aeq.test.mjs (AEQ Test File), agents.test.mjs (Agent Test File), AX OS Repository, brain.test.mjs (Brain Test File), expect / describe / it / beforeEach (Test API), _harness.mjs (Zero-Dependency Test Harness), node:assert/strict (Built-in Node.js Assert Module) (+6 more)

### Community 4 - "Scale-PPL Relationship"
Cohesion: 0.28
Nodes (13): Model Scale Axis (Parameters in Billions), WikiText-2 Benchmark Dataset, Qwen2.5 Model Family (1.5B–7B), Figure: WikiText-2 q4 PPL Increase vs. Scale (scatter plot, Qwen2.5/Mistral-7B/Llama-3.1-8B), Finding: 1.9× Cross-Architecture Gap at 7B Scale (Qwen vs Mistral), Finding: Monotonic ΔPPL Decrease with Scale (Qwen2.5: 15%→11.7%→8.5%), Finding: Larger Models Less Sensitive to q4 Quantization, gen_scale_ppl_fig.py: Scale Figure Regeneration Script (+5 more)

### Community 5 - "Pareto & Mixed-Precision"
Cohesion: 0.33
Nodes (12): Catastrophic Degradation under Aggressive Quantization, Pareto Dominance — q4 Uniform Dominates All Others, Pareto Frontier (Size-Perplexity Trade-off), Size-Perplexity Pareto Figure (Qwen2.5-1.5B, Five Quantization Schemes), Model Size (MB), Perplexity (log scale, language model quality metric), Qwen2.5-1.5B Model, AEQ Mixed (2+6 bit) Quantization (~530 MB, ~162755 PPL — catastrophic degradation) (+4 more)

### Community 6 - "Peer Review & Path A/B"
Cohesion: 0.22
Nodes (10): Confound: Qwen q4 from mlx-community (group size unspecified) vs Mistral q4 from local mlx_lm.convert (group size 64), Path A — Re-run experiments to fix confounded cross-arch claim and add CIs, Peer-review score 65.5/100 (two independent raters, 6-axis rubric), Axis: academic_style — weight 0.10, avg 74.0, Axis: evidence_presentation — weight 0.20, avg 65.5, Axis: logical_flow — weight 0.15, avg 71.0, Axis: scientific_depth — weight 0.20, avg 58.0, Axis: technical_execution — weight 0.20, avg 56.0 (+2 more)

### Community 7 - "Cross-Arch Gap & Vocab Sparsity"
Cohesion: 0.22
Nodes (9): AEQIntegration Registry (model registry subsystem of AX OS, stores compressed artifacts), AX OS: TypeScript Multi-Agent Library, Cross-Architecture Gap at 7-8B: 1.9x range (Qwen2.5-7B +8.5% vs Mistral-7B +4.4% vs Llama +6.9%), Vocabulary-Sparsity Hypothesis: lower vocab utilisation means more quantization error per hapax token, Llama-3.1-8B q4 Local Artifact (base: mlx-community/Meta-Llama-3.1-8B-Instruct-bf16, license: llama3.1, MLX library), Llama-3.1-8B-Instruct (BF16 PPL=9.47, q4 PPL=10.12, DPPL=+6.9%, 28.0 tok/s), Qwen2.5-14B q4 Local Artifact (base: mlx-community/Qwen2.5-14B-Instruct-bf16, apache-2.0, MLX pipeline_tag=text-generation), Rationale: architecture-aware selection motivated by 1.9x cross-arch gap — scale alone insufficient predictor at 7-8B (+1 more)

### Community 8 - "Hardware & MLX Backend"
Cohesion: 0.22
Nodes (9): Apple M1 Max (68.7 GB unified memory, primary evaluation hardware), GGUF Format (llama.cpp, Aug 2023): De Facto Standard for Self-Contained Quantized Models, Mixed-Precision Quantization Failure at 1.5B: 3+6-bit and 2+6-bit dominated by uniform q4, MLX Backend (Apple Silicon inference framework, mlx_lm.convert API), Limitation: MoE Models Untested (mixed-precision conclusion applies only to dense transformers), 4-bit Post-Training Quantization (PTQ, q4, q_bits=4, q_group_size=64), q4_uniform Pareto-Dominant Scheme: PPL=59.96 at 840MB (vs aeq_mixed_3_6 PPL=130.97 at 736MB), q8 Lossless Finding: Qwen2.5-7B q8 DPPL=-0.28%; q4 (+8.5%) is inflection point (+1 more)

### Community 9 - "Graph Report History"
Cohesion: 0.22
Nodes (9): Graph Report — 96 nodes, 118 edges, 13 communities (2026-06-04), Community 9: Claim architecture dominates scale as predictor of q4 robustness (3.7× gap), Community 1: AX OS TypeScript Multi-Agent OS Library hub, Community 4: Metric ΔPPL under uniform q4 (%) hub, Community 0: _harness.mjs — 40-line ES module, 11 matchers hub, Community 2: Size-Perplexity Pareto for Qwen2.5-1.5B hub, God node: AX OS TypeScript Multi-Agent OS Library (6 edges), God node: Contribution 3 — scale-stratified 4-bit quantization measurements (8 edges) (+1 more)

### Community 10 - "Qwen2.5 Model Family Results"
Cohesion: 0.36
Nodes (8): Ouyang et al. 2024: 1500+ Quantized Checkpoints — Low-Bit Favors Undertrained LLMs, Qwen2.5-14B-Instruct (BF16 PPL=7.73, q4 PPL=8.53, DPPL=+10.3%, 32.4 tok/s), Qwen2.5-1.5B-Instruct (BF16 PPL=12.70, q4 PPL=14.60, DPPL=+15.0%, 166.6 tok/s), Qwen2.5-3B-Instruct (BF16 PPL=11.45, q4 PPL=12.79, DPPL=+11.7%, 58.4 tok/s), Qwen2.5-7B-Instruct (BF16 PPL=10.14, q4 PPL=11.01, DPPL=+8.5%, 63.8 tok/s), Qwen2.5 Model Family (1.5B/3B/7B/14B scale points), Scale-Stratified q4 Sensitivity: DPPL decreasing 1.5B to 7B (15% to 8.5%), non-monotone uptick at 14B (+10.3%), Xu et al. 2024b: Statistical Power-Law PTQ Quality Scaling (100T training tokens)

### Community 11 - "Paper Figures"
Cohesion: 0.29
Nodes (7): Figure: fig_harness_architecture, Figure: fig_q4_scale_ppl (4-point: Qwen 1.5B/3B/7B + Mistral cross), Figure: fig_quantization_pareto, Figure: fig_system_overview, HANDOFF — paper.tex compiles clean, 9 pages, 15 cite keys, 4 figures, Rationale: Data-First rule — no measured values changed or fabricated during refinement, paper.tex — Main LaTeX source (9 pages)

### Community 12 - "Hapax Ablation Functions"
Cohesion: 0.5
Nodes (3): chunk_ppl(), Compute average PPL over a list of token-ID lists (each ≥2 tokens)., run_model()

### Community 13 - "WikiText-2 Eval Scripts"
Cohesion: 0.5
Nodes (4): 512-Token Non-Overlapping Windows Evaluation Protocol (full WikiText-2 test split), eval_ppl_quick.py: Quick Eval Script (first 8192 tokens, 16 windows), eval_ppl_wikitext2.py: Full-Corpus PPL Evaluation Script (checkpointing, Metal crash recovery), WikiText-2 Full-Corpus PPL Evaluation Protocol

### Community 14 - "BRAIN Oracle Integration"
Cohesion: 0.5
Nodes (4): BRAIN_REAL=1 Inline Oracle Design Pattern (env-variable gate, zero mock overhead), Rationale: inline realSim() chosen so Phase-8 demo script stays standalone without compiled dist/ artifact, realSim() Inline Oracle Function (mirrors mock signature, spawns Python subprocess via child_process.execSync), WorldQuant BRAIN API (live quantitative oracle, 141.9s latency, alpha_id RRd5Rvmj)

### Community 15 - "HellaSwag Eval Functions"
Cohesion: 0.67
Nodes (3): compute_nll_per_token(), evaluate(), HellaSwag accuracy evaluation using mlx_lm. Usage: python eval_hellaswag_mlx.py

### Community 16 - "Hapax Table Integration"
Cohesion: 0.67
Nodes (2): format_ablation_table(), update_paper()

### Community 17 - "Reproducibility Literature"
Cohesion: 0.67
Nodes (3): Dependency Drift: Primary Driver of ML System Reproducibility Failure, Gundersen & Kjensmo 2018: ML Reproducibility Survey — 400 AAAI/IJCAI, only 20-30% adequate, Pineau et al. 2021: NeurIPS 2019 Reproducibility Program (JMLR)

### Community 18 - "Full-Corpus Eval Script"
Cohesion: 1.0
Nodes (2): eval_wikitext2_ppl(), main()

### Community 19 - "Quick Eval Script"
Cohesion: 1.0
Nodes (2): eval_ppl_quick(), main()

### Community 20 - "ARC-Easy Eval Functions"
Cohesion: 1.0
Nodes (2): compute_nll_per_token(), evaluate()

### Community 21 - "Scale Figure Generator"
Cohesion: 1.0
Nodes (0): 

### Community 22 - "Path B Scope Decision"
Cohesion: 1.0
Nodes (1): Path B — Re-scope thesis: demote AX OS co-design narrative to quantization finding + appendices

### Community 23 - "Paper Quality Score"
Cohesion: 1.0
Nodes (1): Paper Quality Score: 78.7/100 (paper-orchestra 6-axis rubric)

## Knowledge Gaps
- **64 isolated node(s):** `eval_ppl_quick.py — Quick eval (first 8192 tokens, 16 windows)`, `gen_scale_ppl_fig.py — Regenerate fig_q4_scale_ppl figure`, `Paper score: 73.02/100 (paper-orchestra 6-axis rubric)`, `Axis: logical_flow — weight 0.15, avg 71.0`, `Axis: writing_clarity — weight 0.15, avg 77.0` (+59 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Scale Figure Generator`** (1 nodes): `gen_scale_ppl_fig.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Path B Scope Decision`** (1 nodes): `Path B — Re-scope thesis: demote AX OS co-design narrative to quantization finding + appendices`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Paper Quality Score`** (1 nodes): `Paper Quality Score: 78.7/100 (paper-orchestra 6-axis rubric)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AX OS Paper: Scale-Stratified 4-bit Quantization for Edge LLM Agents` connect `Citations & ARC-Easy Evidence` to `AX OS TypeScript API`, `Cross-Arch Gap & Vocab Sparsity`, `Hardware & MLX Backend`, `Qwen2.5 Model Family Results`, `WikiText-2 Eval Scripts`, `BRAIN Oracle Integration`, `Reproducibility Literature`?**
  _High betweenness centrality (0.176) - this node is a cross-community bridge._
- **Why does `Figure: WikiText-2 q4 PPL Increase vs. Scale (scatter plot, Qwen2.5/Mistral-7B/Llama-3.1-8B)` connect `Scale-PPL Relationship` to `AX OS TypeScript API`, `Qwen2.5 Model Family Results`, `Pareto & Mixed-Precision`, `Cross-Arch Gap & Vocab Sparsity`?**
  _High betweenness centrality (0.112) - this node is a cross-community bridge._
- **Why does `_harness.mjs: Zero-Dependency Node.js Test Harness (40-line ES module, 27/27 specs)` connect `AX OS TypeScript API` to `Reproducibility Literature`, `Citations & ARC-Easy Evidence`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **What connects `eval_ppl_quick.py — Quick eval (first 8192 tokens, 16 windows)`, `gen_scale_ppl_fig.py — Regenerate fig_q4_scale_ppl figure`, `Paper score: 73.02/100 (paper-orchestra 6-axis rubric)` to the rest of the system?**
  _64 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `AX OS TypeScript API` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._
- **Should `Eval Protocol & Commit History` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
- **Should `Citations & ARC-Easy Evidence` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._