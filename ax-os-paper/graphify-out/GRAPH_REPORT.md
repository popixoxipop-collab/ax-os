# Graph Report - /Users/xox/ax-os-paper  (2026-06-11)

## Corpus Check
- Corpus is ~48,484 words - fits in a single context window. You may not need a graph.

## Summary
- 120 nodes · 168 edges · 12 communities detected
- Extraction: 81% EXTRACTED · 19% INFERRED · 0% AMBIGUOUS · INFERRED: 32 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_AX OS Agent Architecture|AX OS Agent Architecture]]
- [[_COMMUNITY_PPL Protocol Comparison|PPL Protocol Comparison]]
- [[_COMMUNITY_Zero-Dep Test Harness|Zero-Dep Test Harness]]
- [[_COMMUNITY_Pareto Quantization Analysis|Pareto Quantization Analysis]]
- [[_COMMUNITY_Scale vs Quant Sensitivity|Scale vs Quant Sensitivity]]
- [[_COMMUNITY_Paper Scoring & Confound Fix|Paper Scoring & Confound Fix]]
- [[_COMMUNITY_Prior Graph Report|Prior Graph Report]]
- [[_COMMUNITY_Paper Figures Inventory|Paper Figures Inventory]]
- [[_COMMUNITY_Quick PPL Eval Script|Quick PPL Eval Script]]
- [[_COMMUNITY_Full-Corpus PPL Eval Script|Full-Corpus PPL Eval Script]]
- [[_COMMUNITY_Scale Figure Generator|Scale Figure Generator]]
- [[_COMMUNITY_Path B Re-Scope Option|Path B Re-Scope Option]]

## God Nodes (most connected - your core abstractions)
1. `AX OS Paper — Architecture-Aware Quantization Sensitivity Study` - 12 edges
2. `Qwen2.5-1.5B Model` - 10 edges
3. `_harness.mjs (Zero-Dependency Test Harness)` - 9 edges
4. `Graph Report — 96 nodes, 118 edges, 13 communities (2026-06-04)` - 8 edges
5. `Cross-architecture gap at 7B: 1.9× (Qwen more sensitive than Mistral)` - 7 edges
6. `q4 Uniform Quantization (~800 MB, ~70 PPL) — Pareto Dominant` - 7 edges
7. `Figure: WikiText-2 q4 PPL Increase vs. Scale` - 7 edges
8. `HANDOFF — paper.tex compiles clean, 9 pages, 15 cite keys, 4 figures` - 6 edges
9. `Peer-review score 65.5/100 (two independent raters, 6-axis rubric)` - 6 edges
10. `AX OS — TypeScript Multi-Agent OS Library` - 6 edges

## Surprising Connections (you probably didn't know these)
- `Community 9: Claim architecture dominates scale as predictor of q4 robustness (3.7× gap)` --semantically_similar_to--> `Cross-architecture gap at 7B: 1.9× (Qwen more sensitive than Mistral)`  [INFERRED] [semantically similar]
  graphify-out/GRAPH_REPORT.md → README.md
- `Community 4: Metric ΔPPL under uniform q4 (%) hub` --semantically_similar_to--> `Intra-family scale effect: 1.8× range across 4.7× parameter increase (15.0%→8.5%), monotonically decreasing`  [INFERRED] [semantically similar]
  graphify-out/GRAPH_REPORT.md → README.md
- `Qwen2.5-7B q4 local artifact (MLX, base: mlx-community/Qwen2.5-7B-Instruct-bf16)` --shares_data_with--> `Qwen2.5-7B: BF16 PPL 10.14 → q4 PPL 11.01, ΔPPL +8.5%`  [INFERRED]
  path_a_artifacts/qwen7b_q4_local/README.md → README.md
- `Mistral-7B q4 local artifact (MLX, base: mistralai/Mistral-7B-Instruct-v0.3)` --shares_data_with--> `Mistral-7B: BF16 PPL 7.24 → q4 PPL 7.56, ΔPPL +4.4%`  [INFERRED]
  path_a_artifacts/mistral7b_q4_local/README.md → README.md
- `Mistral-7B BF16 local artifact (MLX, base: mistralai/Mistral-7B-Instruct-v0.3)` --shares_data_with--> `Mistral-7B: BF16 PPL 7.24 → q4 PPL 7.56, ΔPPL +4.4%`  [INFERRED]
  path_a_artifacts/mistral7b_bf16/README.md → README.md

## Hyperedges (group relationships)
- **Path A — Four locally-quantized model artifacts for uniform pipeline re-evaluation** — qwen15b_artifact, qwen3b_artifact, qwen7b_artifact, mistral7b_q4_artifact, mistral7b_bf16_artifact [INFERRED 0.85]
- **PPL measurement results across Qwen family and Mistral cross-arch** — readme_qwen15b_result, readme_qwen3b_result, readme_qwen7b_result, readme_mistral7b_result, readme_cross_arch_gap, readme_intra_family_scale_effect [EXTRACTED 0.95]
- **6-axis peer review rubric scores (paper-orchestra standard)** — handoff_score_scientific_depth, handoff_score_technical_execution, handoff_score_logical_flow, handoff_score_writing_clarity, handoff_score_evidence_presentation, handoff_score_academic_style [EXTRACTED 1.00]
- **Two improvement paths: Path A (re-run experiments) vs Path B (re-scope thesis)** — handoff_path_a, handoff_path_b, handoff_score_scientific_depth, handoff_score_technical_execution [EXTRACTED 0.90]
- **PPL protocol disambiguation — WikiText-2 vs short-text screening** — handoff_two_ppl_protocols, handoff_wikitext2_protocol, handoff_shorttext_protocol, rationale_protocol_separation [EXTRACTED 0.95]

## Communities

### Community 0 - "AX OS Agent Architecture"
Cohesion: 0.12
Nodes (24): AEQIntegration TypeScript API (quantize/getCompressionStats/benchmark), Agent Code (TypeScript), AX OS — TypeScript Multi-Agent OS Library, BRAIN_REAL=0 (Mock Mode), BRAIN_REAL=1 (Live Mode), Contribution 1: Zero-Dependency Test Harness, Contribution 2: Inline BRAIN_REAL Oracle Switching, Contribution 3: Scale-Stratified Uniform q4 Compression (+16 more)

### Community 1 - "PPL Protocol Comparison"
Cohesion: 0.13
Nodes (22): Fixed short-text screening protocol: Qwen-1.5B q4=59.96 — for tab:qwen_5way only, NOT comparable to WikiText-2, Rationale: TWO perplexity protocols — WikiText-2 (standard) vs fixed short-text screening (not comparable), WikiText-2 protocol (primary): Qwen-1.5B q4=16.75, Mistral-7B q4=9.27 — for tab:scale, tab:mistral, fig:scale_ppl, Mistral-7B BF16 local artifact (MLX, base: mistralai/Mistral-7B-Instruct-v0.3), Mistral-7B q4 local artifact (MLX, base: mistralai/Mistral-7B-Instruct-v0.3), PPL results log: Mistral-7B BF16 WikiText-2 eval in progress, PPL results log: Qwen2.5-7B q4 local WikiText-2 eval in progress, Qwen2.5-1.5B q4 local artifact (MLX, base: mlx-community/Qwen2.5-1.5B-Instruct-bf16) (+14 more)

### Community 2 - "Zero-Dep Test Harness"
Cohesion: 0.2
Nodes (14): 27/27 PASS (Test Result), aeq.test.mjs (AEQ Test File), agents.test.mjs (Agent Test File), AX OS Repository, brain.test.mjs (Brain Test File), expect / describe / it / beforeEach (Test API), _harness.mjs (Zero-Dependency Test Harness), node:assert/strict (Built-in Node.js Assert Module) (+6 more)

### Community 3 - "Pareto Quantization Analysis"
Cohesion: 0.33
Nodes (12): Catastrophic Degradation under Aggressive Quantization, Pareto Dominance — q4 Uniform Dominates All Others, Pareto Frontier (Size-Perplexity Trade-off), Size-Perplexity Pareto Figure (Qwen2.5-1.5B, Five Quantization Schemes), Model Size (MB), Perplexity (log scale, language model quality metric), Qwen2.5-1.5B Model, AEQ Mixed (2+6 bit) Quantization (~530 MB, ~162755 PPL — catastrophic degradation) (+4 more)

### Community 4 - "Scale vs Quant Sensitivity"
Cohesion: 0.32
Nodes (12): Model Scale Axis (Parameters in Billions), WikiText-2 Benchmark Dataset, Qwen2.5 Model Family (1.5B–7B), Figure: WikiText-2 q4 PPL Increase vs. Scale, Finding: 1.9× Cross-Architecture Gap at 7B Scale (Qwen vs Mistral), Finding: Monotonic ΔPPL Decrease with Scale (Qwen2.5: 15%→11.7%→8.5%), Finding: Larger Models Less Sensitive to q4 Quantization, ΔPPL (%) — Perplexity Increase from 4-bit Quantization (+4 more)

### Community 5 - "Paper Scoring & Confound Fix"
Cohesion: 0.2
Nodes (12): Commit bd17d64 — Corrected stale '15× gap' → '3.7×' in intro, Confound: Qwen q4 from mlx-community (group size unspecified) vs Mistral q4 from local mlx_lm.convert (group size 64), Path A — Re-run experiments to fix confounded cross-arch claim and add CIs, Peer-review score 65.5/100 (two independent raters, 6-axis rubric), Axis: academic_style — weight 0.10, avg 74.0, Axis: evidence_presentation — weight 0.20, avg 65.5, Axis: logical_flow — weight 0.15, avg 71.0, Axis: scientific_depth — weight 0.20, avg 58.0 (+4 more)

### Community 6 - "Prior Graph Report"
Cohesion: 0.22
Nodes (9): Graph Report — 96 nodes, 118 edges, 13 communities (2026-06-04), Community 9: Claim architecture dominates scale as predictor of q4 robustness (3.7× gap), Community 1: AX OS TypeScript Multi-Agent OS Library hub, Community 4: Metric ΔPPL under uniform q4 (%) hub, Community 0: _harness.mjs — 40-line ES module, 11 matchers hub, Community 2: Size-Perplexity Pareto for Qwen2.5-1.5B hub, God node: AX OS TypeScript Multi-Agent OS Library (6 edges), God node: Contribution 3 — scale-stratified 4-bit quantization measurements (8 edges) (+1 more)

### Community 7 - "Paper Figures Inventory"
Cohesion: 0.29
Nodes (7): Figure: fig_harness_architecture, Figure: fig_q4_scale_ppl (4-point: Qwen 1.5B/3B/7B + Mistral cross), Figure: fig_quantization_pareto, Figure: fig_system_overview, HANDOFF — paper.tex compiles clean, 9 pages, 15 cite keys, 4 figures, Rationale: Data-First rule — no measured values changed or fabricated during refinement, paper.tex — Main LaTeX source (9 pages)

### Community 8 - "Quick PPL Eval Script"
Cohesion: 1.0
Nodes (2): eval_ppl_quick(), main()

### Community 9 - "Full-Corpus PPL Eval Script"
Cohesion: 1.0
Nodes (2): eval_wikitext2_ppl(), main()

### Community 10 - "Scale Figure Generator"
Cohesion: 1.0
Nodes (0): 

### Community 11 - "Path B Re-Scope Option"
Cohesion: 1.0
Nodes (1): Path B — Re-scope thesis: demote AX OS co-design narrative to quantization finding + appendices

## Knowledge Gaps
- **36 isolated node(s):** `eval_ppl_quick.py — Quick eval (first 8192 tokens, 16 windows)`, `gen_scale_ppl_fig.py — Regenerate fig_q4_scale_ppl figure`, `Paper score: 73.02/100 (paper-orchestra 6-axis rubric)`, `Axis: logical_flow — weight 0.15, avg 71.0`, `Axis: writing_clarity — weight 0.15, avg 77.0` (+31 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Scale Figure Generator`** (1 nodes): `gen_scale_ppl_fig.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Path B Re-Scope Option`** (1 nodes): `Path B — Re-scope thesis: demote AX OS co-design narrative to quantization finding + appendices`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AX OS Paper — Architecture-Aware Quantization Sensitivity Study` connect `PPL Protocol Comparison` to `Paper Scoring & Confound Fix`, `Paper Figures Inventory`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Why does `Cross-architecture gap at 7B: 1.9× (Qwen more sensitive than Mistral)` connect `Paper Scoring & Confound Fix` to `PPL Protocol Comparison`, `Prior Graph Report`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `Cross-architecture gap at 7B: 1.9× (Qwen more sensitive than Mistral)` (e.g. with `Qwen2.5-7B: BF16 PPL 10.14 → q4 PPL 11.01, ΔPPL +8.5%` and `Mistral-7B: BF16 PPL 7.24 → q4 PPL 7.56, ΔPPL +4.4%`) actually correct?**
  _`Cross-architecture gap at 7B: 1.9× (Qwen more sensitive than Mistral)` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `eval_ppl_quick.py — Quick eval (first 8192 tokens, 16 windows)`, `gen_scale_ppl_fig.py — Regenerate fig_q4_scale_ppl figure`, `Paper score: 73.02/100 (paper-orchestra 6-axis rubric)` to the rest of the system?**
  _36 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `AX OS Agent Architecture` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
- **Should `PPL Protocol Comparison` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._