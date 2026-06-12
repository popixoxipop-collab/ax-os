# Graph Report - .  (2026-06-13)

## Corpus Check
- 10 files · ~25,000 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 169 nodes · 235 edges · 17 communities detected
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 35 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_AX OS Paper Scale-Stratified 4-bit Quan|AX OS Paper: Scale-Stratified 4-bit Quan]]
- [[_COMMUNITY_AX OS Paper — Architecture-Aware Quantiz|AX OS Paper — Architecture-Aware Quantiz]]
- [[_COMMUNITY_AX OS — TypeScript Multi-Agent OS Librar|AX OS — TypeScript Multi-Agent OS Librar]]
- [[_COMMUNITY__harness.mjs (Zero-Dependency Test Harne|_harness.mjs (Zero-Dependency Test Harne]]
- [[_COMMUNITY_Figure WikiText-2 q4 PPL Increase vs. S|Figure: WikiText-2 q4 PPL Increase vs. S]]
- [[_COMMUNITY_q4 Uniform Quantization (~800 MB, ~70 PP|q4 Uniform Quantization (~800 MB, ~70 PP]]
- [[_COMMUNITY_Peer-review score 65.5100 (two independ|Peer-review score 65.5/100 (two independ]]
- [[_COMMUNITY__harness.mjs Zero-Dependency Node.js Te|_harness.mjs: Zero-Dependency Node.js Te]]
- [[_COMMUNITY_Graph Report — 96 nodes, 118 edges, 13 c|Graph Report — 96 nodes, 118 edges, 13 c]]
- [[_COMMUNITY_HANDOFF — paper.tex compiles clean, 9 pa|HANDOFF — paper.tex compiles clean, 9 pa]]
- [[_COMMUNITY_chunk_ppl()|chunk_ppl()]]
- [[_COMMUNITY_eval_hellaswag_mlx.py|eval_hellaswag_mlx.py]]
- [[_COMMUNITY_eval_arc_e.py|eval_arc_e.py]]
- [[_COMMUNITY_main()|main()]]
- [[_COMMUNITY_eval_ppl_quick.py|eval_ppl_quick.py]]
- [[_COMMUNITY_gen_scale_ppl_fig.py|gen_scale_ppl_fig.py]]
- [[_COMMUNITY_Path B — Re-scope thesis demote AX OS c|Path B — Re-scope thesis: demote AX OS c]]

## God Nodes (most connected - your core abstractions)
1. `AX OS Paper: Scale-Stratified 4-bit Quantization for Edge LLM Agents` - 17 edges
2. `AX OS Paper — Architecture-Aware Quantization Sensitivity Study` - 12 edges
3. `Figure: WikiText-2 q4 PPL Increase vs. Scale (scatter plot, Qwen2.5/Mistral-7B/Llama-3.1-8B)` - 12 edges
4. `Qwen2.5-1.5B Model` - 10 edges
5. `_harness.mjs (Zero-Dependency Test Harness)` - 9 edges

## Surprising Connections (you probably didn't know these)
- `harness_node_modules` --eliminates--> `harness_zero_dependency`  [EXTRACTED]
   → 
- `concept_pareto_frontier` --violates--> `concept_catastrophic_degradation`  [EXTRACTED]
   → 
- `harness_mjs` --achieves--> `zero_external_runtime_deps`  [EXTRACTED]
   → 
- `harness_node_test` --enables--> `harness_zero_dependency`  [EXTRACTED]
   → 
- `harness_node_assert_strict` --enables--> `harness_zero_dependency`  [EXTRACTED]
   → 

## Hyperedges (group relationships)
- **Path A — Four locally-quantized model artifacts for uniform pipeline re-evaluation** — qwen15b_artifact, qwen3b_artifact, qwen7b_artifact, mistral7b_q4_artifact, mistral7b_bf16_artifact [INFERRED 0.85]
- **PPL measurement results across Qwen family and Mistral cross-arch** — readme_qwen15b_result, readme_qwen3b_result, readme_qwen7b_result, readme_mistral7b_result, readme_cross_arch_gap, readme_intra_family_scale_effect [EXTRACTED 0.95]
- **6-axis peer review rubric scores (paper-orchestra standard)** — handoff_score_scientific_depth, handoff_score_technical_execution, handoff_score_logical_flow, handoff_score_writing_clarity, handoff_score_evidence_presentation, handoff_score_academic_style [EXTRACTED 1.00]
- **Two improvement paths: Path A (re-run experiments) vs Path B (re-scope thesis)** — handoff_path_a, handoff_path_b, handoff_score_scientific_depth, handoff_score_technical_execution [EXTRACTED 0.90]
- **PPL protocol disambiguation — WikiText-2 vs short-text screening** — handoff_two_ppl_protocols, handoff_wikitext2_protocol, handoff_shorttext_protocol, rationale_protocol_separation [EXTRACTED 0.95]

## Communities

### Community 0 - "AX OS Paper: Scale-Stratified 4-bit Quan"
Cohesion: 0.09
Nodes (31): 512-Token Non-Overlapping Windows Evaluation Protocol, Apple M1 Max (68.7 GB unified memory, MLX backend), AWQ (Lin et al., 2023): Activation-Aware Weight Quantization, AX OS Paper: Scale-Stratified 4-bit Quantization for Edge LLM Agents, BRAIN_REAL=1 Inline Oracle Design Pattern, Cross-Architecture Gap at 7-8B Scale: 1.9× (Qwen2.5-7B +8.5% vs Mistral-7B +4.4%), eval_ppl_wikitext2.py: Full-Corpus PPL Evaluation Script, GGUF Format (llama.cpp): De Facto Standard for Distributing Quantized Models (+23 more)

### Community 1 - "AX OS Paper — Architecture-Aware Quantiz"
Cohesion: 0.12
Nodes (24): Commit bd17d64 — Corrected stale '15× gap' → '3.7×' in intro, Fixed short-text screening protocol: Qwen-1.5B q4=59.96 — for tab:qwen_5way only, NOT comparable to WikiText-2, Rationale: TWO perplexity protocols — WikiText-2 (standard) vs fixed short-text screening (not comparable), WikiText-2 protocol (primary): Qwen-1.5B q4=16.75, Mistral-7B q4=9.27 — for tab:scale, tab:mistral, fig:scale_ppl, Mistral-7B BF16 local artifact (MLX, base: mistralai/Mistral-7B-Instruct-v0.3), Mistral-7B q4 local artifact (MLX, base: mistralai/Mistral-7B-Instruct-v0.3), PPL results log: Mistral-7B BF16 WikiText-2 eval in progress, PPL results log: Qwen2.5-7B q4 local WikiText-2 eval in progress (+16 more)

### Community 2 - "AX OS — TypeScript Multi-Agent OS Librar"
Cohesion: 0.14
Nodes (21): AEQIntegration Registry, AEQIntegration TypeScript API (quantize/getCompressionStats/benchmark), Agent Code (TypeScript), AX OS: TypeScript Multi-Agent Library, AX OS — TypeScript Multi-Agent OS Library, BRAIN_REAL=0 (Mock Mode), BRAIN_REAL=1 (Live Mode), Contribution 1: Zero-Dependency Test Harness (+13 more)

### Community 3 - "_harness.mjs (Zero-Dependency Test Harne"
Cohesion: 0.2
Nodes (14): 27/27 PASS (Test Result), aeq.test.mjs (AEQ Test File), agents.test.mjs (Agent Test File), AX OS Repository, brain.test.mjs (Brain Test File), expect / describe / it / beforeEach (Test API), _harness.mjs (Zero-Dependency Test Harness), node:assert/strict (Built-in Node.js Assert Module) (+6 more)

### Community 4 - "Figure: WikiText-2 q4 PPL Increase vs. S"
Cohesion: 0.32
Nodes (12): Model Scale Axis (Parameters in Billions), WikiText-2 Benchmark Dataset, Qwen2.5 Model Family (1.5B–7B), Figure: WikiText-2 q4 PPL Increase vs. Scale (scatter plot, Qwen2.5/Mistral-7B/Llama-3.1-8B), Finding: 1.9× Cross-Architecture Gap at 7B Scale (Qwen vs Mistral), Finding: Monotonic ΔPPL Decrease with Scale (Qwen2.5: 15%→11.7%→8.5%), Finding: Larger Models Less Sensitive to q4 Quantization, ΔPPL (%) — Perplexity Increase from 4-bit Quantization (+4 more)

### Community 5 - "q4 Uniform Quantization (~800 MB, ~70 PP"
Cohesion: 0.33
Nodes (12): Catastrophic Degradation under Aggressive Quantization, Pareto Dominance — q4 Uniform Dominates All Others, Pareto Frontier (Size-Perplexity Trade-off), Size-Perplexity Pareto Figure (Qwen2.5-1.5B, Five Quantization Schemes), Model Size (MB), Perplexity (log scale, language model quality metric), Qwen2.5-1.5B Model, AEQ Mixed (2+6 bit) Quantization (~530 MB, ~162755 PPL — catastrophic degradation) (+4 more)

### Community 6 - "Peer-review score 65.5/100 (two independ"
Cohesion: 0.22
Nodes (10): Confound: Qwen q4 from mlx-community (group size unspecified) vs Mistral q4 from local mlx_lm.convert (group size 64), Path A — Re-run experiments to fix confounded cross-arch claim and add CIs, Peer-review score 65.5/100 (two independent raters, 6-axis rubric), Axis: academic_style — weight 0.10, avg 74.0, Axis: evidence_presentation — weight 0.20, avg 65.5, Axis: logical_flow — weight 0.15, avg 71.0, Axis: scientific_depth — weight 0.20, avg 58.0, Axis: technical_execution — weight 0.20, avg 56.0 (+2 more)

### Community 7 - "_harness.mjs: Zero-Dependency Node.js Te"
Cohesion: 0.22
Nodes (9): Dependency Drift: Primary Driver of ML Reproducibility Failure, Gundersen & Kjensmo 2018: ML Reproducibility Survey (400 AAAI/IJCAI papers), _harness.mjs: Zero-Dependency Node.js Test Harness (40-line, 27/27 specs), node:assert/strict (Built-in Assertion), node:test (Built-in Test Runner), Node.js node:test Built-in Module (stable since Node.js 20), Pineau et al. 2021: NeurIPS 2019 Reproducibility Program, Test Files (+1 more)

### Community 8 - "Graph Report — 96 nodes, 118 edges, 13 c"
Cohesion: 0.22
Nodes (9): Graph Report — 96 nodes, 118 edges, 13 communities (2026-06-04), Community 9: Claim architecture dominates scale as predictor of q4 robustness (3.7× gap), Community 1: AX OS TypeScript Multi-Agent OS Library hub, Community 4: Metric ΔPPL under uniform q4 (%) hub, Community 0: _harness.mjs — 40-line ES module, 11 matchers hub, Community 2: Size-Perplexity Pareto for Qwen2.5-1.5B hub, God node: AX OS TypeScript Multi-Agent OS Library (6 edges), God node: Contribution 3 — scale-stratified 4-bit quantization measurements (8 edges) (+1 more)

### Community 9 - "HANDOFF — paper.tex compiles clean, 9 pa"
Cohesion: 0.29
Nodes (7): Figure: fig_harness_architecture, Figure: fig_q4_scale_ppl (4-point: Qwen 1.5B/3B/7B + Mistral cross), Figure: fig_quantization_pareto, Figure: fig_system_overview, HANDOFF — paper.tex compiles clean, 9 pages, 15 cite keys, 4 figures, Rationale: Data-First rule — no measured values changed or fabricated during refinement, paper.tex — Main LaTeX source (9 pages)

### Community 10 - "chunk_ppl()"
Cohesion: 0.5
Nodes (3): chunk_ppl(), Compute average PPL over a list of token-ID lists (each ≥2 tokens)., run_model()

### Community 11 - "eval_hellaswag_mlx.py"
Cohesion: 0.67
Nodes (3): compute_nll_per_token(), evaluate(), HellaSwag accuracy evaluation using mlx_lm. Usage: python eval_hellaswag_mlx.py

### Community 12 - "eval_arc_e.py"
Cohesion: 1.0
Nodes (2): compute_nll_per_token(), evaluate()

### Community 13 - "main()"
Cohesion: 1.0
Nodes (2): eval_wikitext2_ppl(), main()

### Community 14 - "eval_ppl_quick.py"
Cohesion: 1.0
Nodes (2): eval_ppl_quick(), main()

### Community 15 - "gen_scale_ppl_fig.py"
Cohesion: 1.0
Nodes (0): 

### Community 16 - "Path B — Re-scope thesis: demote AX OS c"
Cohesion: 1.0
Nodes (1): Path B — Re-scope thesis: demote AX OS co-design narrative to quantization finding + appendices

## Knowledge Gaps
- **53 isolated node(s):** `eval_ppl_quick.py — Quick eval (first 8192 tokens, 16 windows)`, `gen_scale_ppl_fig.py — Regenerate fig_q4_scale_ppl figure`, `Paper score: 73.02/100 (paper-orchestra 6-axis rubric)`, `Axis: logical_flow — weight 0.15, avg 71.0`, `Axis: writing_clarity — weight 0.15, avg 77.0` (+48 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `gen_scale_ppl_fig.py`** (1 nodes): `gen_scale_ppl_fig.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Path B — Re-scope thesis: demote AX OS c`** (1 nodes): `Path B — Re-scope thesis: demote AX OS co-design narrative to quantization finding + appendices`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.