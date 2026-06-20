# Graph Report - /Users/xox/ax-os-paper  (2026-06-20)

## Corpus Check
- 22 files · ~50,000 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 426 nodes · 601 edges · 27 communities detected
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 65 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_AX OS Core & Reports|AX OS Core & Reports]]
- [[_COMMUNITY_PPL Evaluation Protocol|PPL Evaluation Protocol]]
- [[_COMMUNITY_Prior Graph History|Prior Graph History]]
- [[_COMMUNITY_Model Registry & Baselines|Model Registry & Baselines]]
- [[_COMMUNITY_ARC-Easy Downstream|ARC-Easy Downstream]]
- [[_COMMUNITY_C4 Cross-Corpus & Hapax|C4 Cross-Corpus & Hapax]]
- [[_COMMUNITY_Quantization Literature|Quantization Literature]]
- [[_COMMUNITY_TypeScript API & Agents|TypeScript API & Agents]]
- [[_COMMUNITY_Scale-PPL Findings|Scale-PPL Findings]]
- [[_COMMUNITY_BRAIN Oracle Integration|BRAIN Oracle Integration]]
- [[_COMMUNITY_Zero-Dependency Test Suite|Zero-Dependency Test Suite]]
- [[_COMMUNITY_Reproducibility & Harness|Reproducibility & Harness]]
- [[_COMMUNITY_NLL Evaluation Functions|NLL Evaluation Functions]]
- [[_COMMUNITY_PPL Computation Core|PPL Computation Core]]
- [[_COMMUNITY_Graph Report Meta|Graph Report Meta]]
- [[_COMMUNITY_Paper Update Pipeline|Paper Update Pipeline]]
- [[_COMMUNITY_HellaSwag Evaluation|HellaSwag Evaluation]]
- [[_COMMUNITY_WikiText-2 Eval Script|WikiText-2 Eval Script]]
- [[_COMMUNITY_Quick Eval Script|Quick Eval Script]]
- [[_COMMUNITY_ARC-E Eval Script|ARC-E Eval Script]]
- [[_COMMUNITY_C4 Eval Script|C4 Eval Script]]
- [[_COMMUNITY_Scale Figure Generator|Scale Figure Generator]]
- [[_COMMUNITY_Thesis Scope Decision|Thesis Scope Decision]]
- [[_COMMUNITY_Paper Score Tracker|Paper Score Tracker]]
- [[_COMMUNITY_Scale Figure (dup)|Scale Figure (dup)]]
- [[_COMMUNITY_Throughput Metric|Throughput Metric]]
- [[_COMMUNITY_Artifact Size Metric|Artifact Size Metric]]

## God Nodes (most connected - your core abstractions)
1. `AX OS: Scale-Stratified 4-bit Quantization for Edge LLM Agents, with Reproducible Zero-Dependency Test Infrastructure` - 36 edges
2. `AX OS Paper: Scale-Stratified 4-bit Quantization for Edge LLM Agents` - 34 edges
3. `AX OS: Scale-Stratified 4-bit Quantization for Edge LLM Agents` - 24 edges
4. `AX OS: Architecture-Aware Quantization Sensitivity Study` - 23 edges
5. `Scale-Stratified 4-bit Quantization Measurements (Contribution 1)` - 20 edges
6. `Figure 4: WikiText-2 q4 DPPL vs. Parameter Count (Qwen2.5 filled circles, Mistral cross, Llama diamond)` - 13 edges
7. `AX OS Paper README` - 13 edges
8. `AX OS Paper — Architecture-Aware Quantization Sensitivity Study` - 12 edges
9. `_harness.mjs: 40-line ES Module Zero-Dependency Test Shim` - 12 edges
10. `Contribution 1 (Primary): Scale-Stratified 4-bit Quantization Measurements` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Cross-architecture gap at 7B: 1.9× (Qwen more sensitive than Mistral)` --semantically_similar_to--> `Community 9: Claim architecture dominates scale as predictor of q4 robustness (3.7× gap)`  [INFERRED] [semantically similar]
  README.md → graphify-out/GRAPH_REPORT.md
- `Intra-family scale effect: 1.8× range across 4.7× parameter increase (15.0%→8.5%), monotonically decreasing` --semantically_similar_to--> `Community 4: Metric ΔPPL under uniform q4 (%) hub`  [INFERRED] [semantically similar]
  README.md → graphify-out/GRAPH_REPORT.md
- `Figure 4: WikiText-2 q4 DPPL vs. Parameter Count (Qwen2.5 filled circles, Mistral cross, Llama diamond)` --implements--> `analysis/gen_scale_ppl_fig.py`  [EXTRACTED]
  figures/fig_q4_scale_ppl.png → README.md
- `4-bit Post-Training Quantization (PTQ, q4, q_bits=4, q_group_size=64)` --conceptually_related_to--> `q8 Lossless Finding: Qwen2.5-7B q8 ΔPPL=-0.28%`  [INFERRED]
  paper.pdf → README.md
- `AEQIntegration Registry (model registry subsystem of AX OS, stores compressed artifacts)` --references--> `Qwen2.5-14B q4 Local Artifact (base: mlx-community/Qwen2.5-14B-Instruct-bf16, apache-2.0, MLX pipeline_tag=text-generation)`  [INFERRED]
  paper.pdf → path_a_artifacts/qwen14b_q4_local/README.md

## Hyperedges (group relationships)
- **AX OS Three Contributions (jointly address edge deployment decision)** —  [EXTRACTED 1.00]
- **Models in Scale Study (Qwen2.5 1.5B/3B/7B/14B + Mistral-7B + Llama-3.1-8B)** —  [EXTRACTED 1.00]
- **Evaluation Script Suite (ppl/c4/arc/hellaswag/quick)** —  [EXTRACTED 1.00]
- **Reproducibility Literature (Gundersen 2018 + Pineau 2021 motivate harness design)** —  [EXTRACTED 1.00]

## Communities

### Community 0 - "AX OS Core & Reports"
Cohesion: 0.04
Nodes (62): God Node: AX OS Paper (34 edges) — most connected in graph, AEQIntegration Registry (AEQ = Adaptive Expert Quantization, compressed model artifact store), AEQModelConfig — Registry Entry with status/expectedVRAM/expectedSpeedup, Apple M1 Max (68.7 GB unified memory, MLX backend) — Primary Evaluation Hardware, ARC-Easy Downstream Evaluation (NLL-per-token, n=2376, 95% CI ±2.0pp), AX OS: Scale-Stratified 4-bit Quantization for Edge LLM Agents, with Reproducible Zero-Dependency Test Infrastructure, C4 Cross-Corpus Generalization Experiment (§4.4), Ajayi and Odunayo 2025: Benchmarking On-Device ML on Apple Silicon with MLX (arXiv:2510.18921) (+54 more)

### Community 1 - "PPL Evaluation Protocol"
Cohesion: 0.06
Nodes (52): 512-Token Non-Overlapping Windows Evaluation Protocol (full WikiText-2 test split), AEQIntegration Registry (model registry subsystem of AX OS, stores compressed artifacts), Ajayi & Odunayo 2025: Benchmarking On-Device ML on Apple Silicon with MLX (arXiv:2510.18921), Apple M1 Max (68.7 GB unified memory, primary evaluation hardware), ARC-Easy Downstream: Qwen2.5-7B q4 ACC=53.03% vs BF16=52.53% (DACC=+0.50pp, CI plus-minus 2.0pp, n=2376), AWQ (Lin et al., 2023): Activation-Aware Weight Quantization, MLSys 2024 Best Paper, AX OS: TypeScript Multi-Agent Library, AX OS Paper: Scale-Stratified 4-bit Quantization for Edge LLM Agents (+44 more)

### Community 2 - "Prior Graph History"
Cohesion: 0.05
Nodes (48): Graph Report — 96 nodes, 118 edges, 13 communities (2026-06-04), Community 9: Claim architecture dominates scale as predictor of q4 robustness (3.7× gap), Community 1: AX OS TypeScript Multi-Agent OS Library hub, Community 4: Metric ΔPPL under uniform q4 (%) hub, Community 0: _harness.mjs — 40-line ES module, 11 matchers hub, Community 2: Size-Perplexity Pareto for Qwen2.5-1.5B hub, God node: AX OS TypeScript Multi-Agent OS Library (6 edges), God node: Contribution 3 — scale-stratified 4-bit quantization measurements (8 edges) (+40 more)

### Community 3 - "Model Registry & Baselines"
Cohesion: 0.07
Nodes (38): 512-Token Non-Overlapping Evaluation Window Protocol, AEQIntegration Drop-in Registry Entry for Mistral-7B q4, ARC-Easy Benchmark — Commonsense Reasoning Evaluation, Architecture-Aware Model Selection — Motivated by 1.9× Cross-Architecture Gap, C4 Corpus (Colossal Clean Crawled Corpus), Compression Ratio r = S_bf16 / S_q4 (≈3.5× for all models), ΔPPL Metric — Relative Perplexity Increase under q4, Deterministic PPL — Exact Measurements, No PRNG, No Calibration (+30 more)

### Community 4 - "ARC-Easy Downstream"
Cohesion: 0.12
Nodes (30): ARC-Easy Downstream Evaluation, ARC-Easy: No Degradation at q4 (ΔACC=+0.5pp, CI=±2.0pp), AX OS Paper README, AX OS: Architecture-Aware Quantization Sensitivity Study, C4 Cross-Corpus Stability for 1.5B/3B Models, C4 Cross-Corpus PPL Evaluation, Cross-Architecture PPL Gap at 7-8B (1.9x range), eval/eval_arc_e.py (ARC-Easy downstream) (+22 more)

### Community 5 - "C4 Cross-Corpus & Hapax"
Cohesion: 0.11
Nodes (21): build_subsets() — hapax-stratified subset builder, C4 English validation dataset, chunk_ppl() — per-chunk PPL computation, ΔPPL metric (q4 vs BF16 perplexity increase), eval_c4_ppl() — C4 stride PPL eval, eval_ppl_quick() — quick PPL on first N tokens, eval_wikitext2_ppl() — stride-based PPL eval, figures/fig_q4_scale_ppl.png (output figure) (+13 more)

### Community 6 - "Quantization Literature"
Cohesion: 0.08
Nodes (26): AWQ — Activation-Weighted Quantization, AX OS: Scale-Stratified 4-bit Quantization for Edge LLM Agents, ax-os-package.json — Non-standard Project Manifest Location, Edge LLM Deployment Problem, Future Work: Extend Scale Study to 32B+ Parameter Checkpoints, Future Work: Measure Throughput on CUDA Targets, Future Work: Validate Mixed-Precision AEQ on MoE Architectures, GPTQ — Second-Order Layer-by-Layer PTQ (+18 more)

### Community 7 - "TypeScript API & Agents"
Cohesion: 0.11
Nodes (26): AEQIntegration TypeScript API (quantize/getCompressionStats/benchmark), Agent Code (TypeScript), AX OS — TypeScript Multi-Agent OS Library, BRAIN_REAL=0 (Mock Mode), BRAIN_REAL=1 (Live Mode), Contribution 1: Zero-Dependency Test Harness, Contribution 2: Inline BRAIN_REAL Oracle Switching, Contribution 3: Scale-Stratified Uniform q4 Compression (+18 more)

### Community 8 - "Scale-PPL Findings"
Cohesion: 0.17
Nodes (24): Model Scale Axis (Parameters in Billions), Catastrophic Degradation under Aggressive Quantization, Pareto Dominance — q4 Uniform Dominates All Others, Pareto Frontier (Size-Perplexity Trade-off), WikiText-2 Benchmark Dataset, Qwen2.5 Model Family (1.5B–7B), Figure 4: WikiText-2 q4 DPPL vs. Parameter Count (Qwen2.5 filled circles, Mistral cross, Llama diamond), Size-Perplexity Pareto Figure (Qwen2.5-1.5B, Five Quantization Schemes) (+16 more)

### Community 9 - "BRAIN Oracle Integration"
Cohesion: 0.16
Nodes (15): 1,800,000ms Subprocess Timeout for BRAIN API ~140s Round-Trip, ax-os-demo-phase8.mjs — Phase-8 Demonstration Script, BRAIN_REAL Environment Variable Oracle Gate, brain.simulator Python Module, child_process.execSync — Subprocess Mechanism for Oracle, Contribution 3 (Enabling): Inline Oracle Design Pattern / BRAIN_REAL Gate, Finding: BRAIN Live Oracle Response 141.9s, alpha_id RRd5Rvmj Returned, Inline Oracle Design Pattern / BRAIN_REAL Gate (Contribution 3) (+7 more)

### Community 10 - "Zero-Dependency Test Suite"
Cohesion: 0.2
Nodes (14): 27/27 PASS (Test Result), aeq.test.mjs (AEQ Test File), agents.test.mjs (Agent Test File), AX OS Repository, brain.test.mjs (Brain Test File), expect / describe / it / beforeEach (Test API), _harness.mjs (Zero-Dependency Test Harness), node:assert/strict (Built-in Node.js Assert Module) (+6 more)

### Community 11 - "Reproducibility & Harness"
Cohesion: 0.15
Nodes (13): Dependency Drift — Primary Driver of Irreproducibility in ML Systems, Figure 2: _harness.mjs Design — Before/After (replaces 300MB vitest node_modules with single 40-line file), _harness.mjs: 40-line ES Module Zero-Dependency Test Shim, node:assert/strict — Node.js Built-in Assertion Module, Node.js node:test Built-in Module (stable since Node.js 20, experimental since Node.js 18), Node.js node:test Built-in Module (stable since Node.js 20), parser.test.mjs — 9 Specs for Parser Module, Rationale: _harness.mjs uses Node.js node:test + node:assert/strict builtins to avoid npm install dependency drift — primary driver of irreproducibility in ML systems (+5 more)

### Community 12 - "NLL Evaluation Functions"
Cohesion: 0.33
Nodes (5): ARC-Easy test dataset, compute_nll_per_token() in eval_arc_e, compute_nll_per_token() in eval_hellaswag_mlx, HellaSwag validation dataset, NLL-per-token scoring (completion ranking)

### Community 13 - "PPL Computation Core"
Cohesion: 0.53
Nodes (4): build_subsets(), chunk_ppl(), Compute average PPL over a list of token-ID lists (each ≥2 tokens)., run_model()

### Community 14 - "Graph Report Meta"
Cohesion: 0.33
Nodes (6): AMBIGUOUS Edge: gen_scale_ppl_fig.py → hapax_ablation_results.json (shares_data_with, low confidence), GRAPH_REPORT.md — 356 nodes, 494 edges, 25 communities (2026-06-20), Community: AX OS Core Infrastructure (48 nodes, cohesion 0.06), Community: BRAIN Oracle Integration (10 nodes, cohesion 0.24), Community: Evaluation Protocol & Findings (34 nodes, cohesion 0.11), Community: Zero-Dependency Test Harness (14 nodes, cohesion 0.20)

### Community 15 - "Paper Update Pipeline"
Cohesion: 0.7
Nodes (3): format_ablation_table(), load_results(), update_paper()

### Community 16 - "HellaSwag Evaluation"
Cohesion: 0.7
Nodes (3): compute_nll_per_token(), evaluate(), HellaSwag accuracy evaluation using mlx_lm. Usage: python eval_hellaswag_mlx.py

### Community 17 - "WikiText-2 Eval Script"
Cohesion: 0.83
Nodes (2): eval_wikitext2_ppl(), main()

### Community 18 - "Quick Eval Script"
Cohesion: 0.83
Nodes (2): eval_ppl_quick(), main()

### Community 19 - "ARC-E Eval Script"
Cohesion: 0.83
Nodes (2): compute_nll_per_token(), evaluate()

### Community 20 - "C4 Eval Script"
Cohesion: 0.83
Nodes (3): eval_c4_ppl(), load_c4_text(), main()

### Community 21 - "Scale Figure Generator"
Cohesion: 1.0
Nodes (0): 

### Community 22 - "Thesis Scope Decision"
Cohesion: 1.0
Nodes (1): Path B — Re-scope thesis: demote AX OS co-design narrative to quantization finding + appendices

### Community 23 - "Paper Score Tracker"
Cohesion: 1.0
Nodes (1): Paper Quality Score: 78.7/100 (paper-orchestra 6-axis rubric)

### Community 24 - "Scale Figure (dup)"
Cohesion: 1.0
Nodes (0): 

### Community 25 - "Throughput Metric"
Cohesion: 1.0
Nodes (1): Throughput τ (tok/s) — Wall-Clock 200-Token Generation

### Community 26 - "Artifact Size Metric"
Cohesion: 1.0
Nodes (1): Artifact Size S (MB) — Sum of .safetensors Files

## Ambiguous Edges - Review These
- `analysis/gen_scale_ppl_fig.py — Regenerate Figure 4 (WikiText-2 q4 PPL vs Scale)` → `AMBIGUOUS Edge: gen_scale_ppl_fig.py → hapax_ablation_results.json (shares_data_with, low confidence)`  [AMBIGUOUS]
  /Users/xox/ax-os-paper/graphify-out/GRAPH_REPORT.md · relation: references
- `gen_scale_ppl_fig.py` → `hapax_ablation_results.json (output artifact)`  [AMBIGUOUS]
  analysis/gen_scale_ppl_fig.py · relation: shares_data_with
- `results/hapax_ablation_results.json — Hapax Ablation Output Artifact` → `AMBIGUOUS Edge: gen_scale_ppl_fig.py → hapax_ablation_results.json (shares_data_with, low confidence)`  [AMBIGUOUS]
  /Users/xox/ax-os-paper/graphify-out/GRAPH_REPORT.md · relation: shares_data_with

## Knowledge Gaps
- **167 isolated node(s):** `Paper score: 73.02/100 (paper-orchestra 6-axis rubric)`, `Axis: logical_flow — weight 0.15, avg 71.0`, `Axis: writing_clarity — weight 0.15, avg 77.0`, `Axis: evidence_presentation — weight 0.20, avg 65.5`, `Axis: academic_style — weight 0.10, avg 74.0` (+162 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Scale Figure Generator`** (1 nodes): `gen_scale_ppl_fig.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Thesis Scope Decision`** (1 nodes): `Path B — Re-scope thesis: demote AX OS co-design narrative to quantization finding + appendices`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Paper Score Tracker`** (1 nodes): `Paper Quality Score: 78.7/100 (paper-orchestra 6-axis rubric)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Scale Figure (dup)`** (1 nodes): `gen_scale_ppl_fig.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Throughput Metric`** (1 nodes): `Throughput τ (tok/s) — Wall-Clock 200-Token Generation`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Artifact Size Metric`** (1 nodes): `Artifact Size S (MB) — Sum of .safetensors Files`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `analysis/gen_scale_ppl_fig.py — Regenerate Figure 4 (WikiText-2 q4 PPL vs Scale)` and `AMBIGUOUS Edge: gen_scale_ppl_fig.py → hapax_ablation_results.json (shares_data_with, low confidence)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `gen_scale_ppl_fig.py` and `hapax_ablation_results.json (output artifact)`?**
  _Edge tagged AMBIGUOUS (relation: shares_data_with) - confidence is low._
- **What is the exact relationship between `results/hapax_ablation_results.json — Hapax Ablation Output Artifact` and `AMBIGUOUS Edge: gen_scale_ppl_fig.py → hapax_ablation_results.json (shares_data_with, low confidence)`?**
  _Edge tagged AMBIGUOUS (relation: shares_data_with) - confidence is low._
- **Why does `AX OS: Scale-Stratified 4-bit Quantization for Edge LLM Agents, with Reproducible Zero-Dependency Test Infrastructure` connect `AX OS Core & Reports` to `BRAIN Oracle Integration`, `Graph Report Meta`?**
  _High betweenness centrality (0.131) - this node is a cross-community bridge._
- **Why does `AX OS Paper README` connect `AX OS Core & Reports` to `Prior Graph History`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Why does `AX OS Paper — Architecture-Aware Quantization Sensitivity Study` connect `Prior Graph History` to `AX OS Core & Reports`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **What connects `Paper score: 73.02/100 (paper-orchestra 6-axis rubric)`, `Axis: logical_flow — weight 0.15, avg 71.0`, `Axis: writing_clarity — weight 0.15, avg 77.0` to the rest of the system?**
  _167 weakly-connected nodes found - possible documentation gaps or missing edges._