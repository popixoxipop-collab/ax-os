# Graph Report - /Users/xox/ax-os-paper  (2026-06-20)

## Corpus Check
- 32 files · ~45,000 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 356 nodes · 494 edges · 25 communities detected
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 54 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Graphify Knowledge Graph|Graphify Knowledge Graph]]
- [[_COMMUNITY_AX OS Core Infrastructure|AX OS Core Infrastructure]]
- [[_COMMUNITY_Paper Structure & Oracle Design|Paper Structure & Oracle Design]]
- [[_COMMUNITY_Evaluation Protocol & Findings|Evaluation Protocol & Findings]]
- [[_COMMUNITY_Hapax & C4 Analysis Pipeline|Hapax & C4 Analysis Pipeline]]
- [[_COMMUNITY_Prior Work & Citations|Prior Work & Citations]]
- [[_COMMUNITY_TypeScript Agent System|TypeScript Agent System]]
- [[_COMMUNITY_Scale & Quantization Concepts|Scale & Quantization Concepts]]
- [[_COMMUNITY_Zero-Dependency Test Harness|Zero-Dependency Test Harness]]
- [[_COMMUNITY_BRAIN Oracle Integration|BRAIN Oracle Integration]]
- [[_COMMUNITY_Node.js Harness Implementation|Node.js Harness Implementation]]
- [[_COMMUNITY_Downstream Benchmark Scripts|Downstream Benchmark Scripts]]
- [[_COMMUNITY_Hapax Ablation Functions|Hapax Ablation Functions]]
- [[_COMMUNITY_HellaSwag Eval Functions|HellaSwag Eval Functions]]
- [[_COMMUNITY_Hapax Integration Functions|Hapax Integration Functions]]
- [[_COMMUNITY_ARC-Easy Eval Functions|ARC-Easy Eval Functions]]
- [[_COMMUNITY_Quick PPL Eval|Quick PPL Eval]]
- [[_COMMUNITY_WikiText-2 PPL Eval|WikiText-2 PPL Eval]]
- [[_COMMUNITY_C4 PPL Eval|C4 PPL Eval]]
- [[_COMMUNITY_Scale Figure Generator|Scale Figure Generator]]
- [[_COMMUNITY_Handoff Documents|Handoff Documents]]
- [[_COMMUNITY_Paper Score Tracking|Paper Score Tracking]]
- [[_COMMUNITY_Analysis Scripts|Analysis Scripts]]
- [[_COMMUNITY_Throughput Metrics|Throughput Metrics]]
- [[_COMMUNITY_Artifact Size Metrics|Artifact Size Metrics]]

## God Nodes (most connected - your core abstractions)
1. `AX OS Paper: Scale-Stratified 4-bit Quantization for Edge LLM Agents` - 34 edges
2. `AX OS: Scale-Stratified 4-bit Quantization for Edge LLM Agents` - 24 edges
3. `AX OS: Architecture-Aware Quantization Sensitivity Study` - 23 edges
4. `Scale-Stratified 4-bit Quantization Measurements (Contribution 1)` - 20 edges
5. `Figure: WikiText-2 q4 PPL Increase vs. Scale (scatter plot, Qwen2.5/Mistral-7B/Llama-3.1-8B)` - 13 edges
6. `AX OS Paper — Architecture-Aware Quantization Sensitivity Study` - 12 edges
7. `Qwen2.5-1.5B Model` - 10 edges
8. `_harness.mjs (Zero-Dependency Test Harness)` - 9 edges
9. `_harness.mjs (Zero-Dependency Test Harness)` - 9 edges
10. `Scale-Stratified q4 Sensitivity: DPPL decreasing 1.5B to 7B (15% to 8.5%), non-monotone uptick at 14B (+10.3%)` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Cross-architecture gap at 7B: 1.9× (Qwen more sensitive than Mistral)` --semantically_similar_to--> `Community 9: Claim architecture dominates scale as predictor of q4 robustness (3.7× gap)`  [INFERRED] [semantically similar]
  README.md → graphify-out/GRAPH_REPORT.md
- `Intra-family scale effect: 1.8× range across 4.7× parameter increase (15.0%→8.5%), monotonically decreasing` --semantically_similar_to--> `Community 4: Metric ΔPPL under uniform q4 (%) hub`  [INFERRED] [semantically similar]
  README.md → graphify-out/GRAPH_REPORT.md
- `Figure: WikiText-2 q4 PPL Increase vs. Scale (scatter plot, Qwen2.5/Mistral-7B/Llama-3.1-8B)` --implements--> `analysis/gen_scale_ppl_fig.py`  [EXTRACTED]
  /Users/xox/ax-os-paper/figures/fig_q4_scale_ppl.png → README.md
- `4-bit Post-Training Quantization (PTQ, q4, q_bits=4, q_group_size=64)` --conceptually_related_to--> `q8 Lossless Finding: Qwen2.5-7B q8 ΔPPL=-0.28%`  [INFERRED]
  paper.pdf → README.md
- `AEQIntegration Registry (model registry subsystem of AX OS, stores compressed artifacts)` --references--> `Qwen2.5-14B q4 Local Artifact (base: mlx-community/Qwen2.5-14B-Instruct-bf16, apache-2.0, MLX pipeline_tag=text-generation)`  [INFERRED]
  paper.pdf → path_a_artifacts/qwen14b_q4_local/README.md

## Hyperedges (group relationships)
- **Path A — Four locally-quantized model artifacts for uniform pipeline re-evaluation** — qwen15b_artifact, qwen3b_artifact, qwen7b_artifact, mistral7b_q4_artifact, mistral7b_bf16_artifact [INFERRED 0.85]
- **6-axis peer review rubric scores (paper-orchestra standard)** — handoff_score_scientific_depth, handoff_score_technical_execution, handoff_score_logical_flow, handoff_score_writing_clarity, handoff_score_evidence_presentation, handoff_score_academic_style [EXTRACTED 1.00]
- **Two improvement paths: Path A (re-run experiments) vs Path B (re-scope thesis)** — handoff_path_a, handoff_path_b, handoff_score_scientific_depth, handoff_score_technical_execution [EXTRACTED 0.90]
- **PPL protocol disambiguation — WikiText-2 vs short-text screening** — handoff_two_ppl_protocols, handoff_wikitext2_protocol, handoff_shorttext_protocol, rationale_protocol_separation [EXTRACTED 0.95]

## Communities

### Community 0 - "Graphify Knowledge Graph"
Cohesion: 0.05
Nodes (50): Graph Report — 96 nodes, 118 edges, 13 communities (2026-06-04), Community 9: Claim architecture dominates scale as predictor of q4 robustness (3.7× gap), Community 1: AX OS TypeScript Multi-Agent OS Library hub, Community 4: Metric ΔPPL under uniform q4 (%) hub, Community 0: _harness.mjs — 40-line ES module, 11 matchers hub, Community 2: Size-Perplexity Pareto for Qwen2.5-1.5B hub, God node: AX OS TypeScript Multi-Agent OS Library (6 edges), God node: Contribution 3 — scale-stratified 4-bit quantization measurements (8 edges) (+42 more)

### Community 1 - "AX OS Core Infrastructure"
Cohesion: 0.06
Nodes (48): AEQIntegration Registry (model registry subsystem of AX OS, stores compressed artifacts), Ajayi & Odunayo 2025: Benchmarking On-Device ML on Apple Silicon with MLX (arXiv:2510.18921), Apple M1 Max (68.7 GB unified memory, primary evaluation hardware), ARC-Easy Downstream: Qwen2.5-7B q4 ACC=53.03% vs BF16=52.53% (DACC=+0.50pp, CI plus-minus 2.0pp, n=2376), AWQ (Lin et al., 2023): Activation-Aware Weight Quantization, MLSys 2024 Best Paper, AX OS: TypeScript Multi-Agent Library, AX OS Paper: Scale-Stratified 4-bit Quantization for Edge LLM Agents, Barrios 2026: Native LLM/MLLM Inference at Scale on Apple Silicon (arXiv:2601.19139) (+40 more)

### Community 2 - "Paper Structure & Oracle Design"
Cohesion: 0.06
Nodes (41): 512-Token Non-Overlapping Evaluation Window Protocol, AEQIntegration Registry — Compressed Model Artifact Store, AEQIntegration Drop-in Registry Entry for Mistral-7B q4, AEQModelConfig — Registry Entry with status/expectedVRAM/expectedSpeedup, Apple M1 Max — Primary Evaluation Hardware (68.7GB unified memory), ARC-Easy Benchmark — Commonsense Reasoning Evaluation, Architecture-Aware Model Selection — Motivated by 1.9× Cross-Architecture Gap, C4 Corpus (Colossal Clean Crawled Corpus) (+33 more)

### Community 3 - "Evaluation Protocol & Findings"
Cohesion: 0.11
Nodes (34): 512-Token Non-Overlapping Windows Evaluation Protocol (full WikiText-2 test split), ARC-Easy Downstream Evaluation, ARC-Easy: No Degradation at q4 (ΔACC=+0.5pp, CI=±2.0pp), AX OS Paper README, AX OS: Architecture-Aware Quantization Sensitivity Study, C4 Cross-Corpus Stability for 1.5B/3B Models, C4 Cross-Corpus PPL Evaluation, Cross-Architecture PPL Gap at 7-8B (1.9x range) (+26 more)

### Community 4 - "Hapax & C4 Analysis Pipeline"
Cohesion: 0.11
Nodes (21): build_subsets() — hapax-stratified subset builder, C4 English validation dataset, chunk_ppl() — per-chunk PPL computation, ΔPPL metric (q4 vs BF16 perplexity increase), eval_c4_ppl() — C4 stride PPL eval, eval_ppl_quick() — quick PPL on first N tokens, eval_wikitext2_ppl() — stride-based PPL eval, figures/fig_q4_scale_ppl.png (output figure) (+13 more)

### Community 5 - "Prior Work & Citations"
Cohesion: 0.07
Nodes (27): AWQ — Activation-Weighted Quantization, AX OS: Scale-Stratified 4-bit Quantization for Edge LLM Agents, ax-os-package.json — Non-standard Project Manifest Location, Edge LLM Deployment Problem, Future Work: Extend Scale Study to 32B+ Parameter Checkpoints, Future Work: Measure Throughput on CUDA Targets, Future Work: Validate Mixed-Precision AEQ on MoE Architectures, GGUF Format — De Facto Standard for Distributing Quantized Models (llama.cpp) (+19 more)

### Community 6 - "TypeScript Agent System"
Cohesion: 0.11
Nodes (26): AEQIntegration TypeScript API (quantize/getCompressionStats/benchmark), Agent Code (TypeScript), AX OS — TypeScript Multi-Agent OS Library, BRAIN_REAL=0 (Mock Mode), BRAIN_REAL=1 (Live Mode), Contribution 1: Zero-Dependency Test Harness, Contribution 2: Inline BRAIN_REAL Oracle Switching, Contribution 3: Scale-Stratified Uniform q4 Compression (+18 more)

### Community 7 - "Scale & Quantization Concepts"
Cohesion: 0.17
Nodes (24): Model Scale Axis (Parameters in Billions), Catastrophic Degradation under Aggressive Quantization, Pareto Dominance — q4 Uniform Dominates All Others, Pareto Frontier (Size-Perplexity Trade-off), WikiText-2 Benchmark Dataset, Qwen2.5 Model Family (1.5B–7B), Figure: WikiText-2 q4 PPL Increase vs. Scale (scatter plot, Qwen2.5/Mistral-7B/Llama-3.1-8B), Size-Perplexity Pareto Figure (Qwen2.5-1.5B, Five Quantization Schemes) (+16 more)

### Community 8 - "Zero-Dependency Test Harness"
Cohesion: 0.2
Nodes (14): 27/27 PASS (Test Result), aeq.test.mjs (AEQ Test File), agents.test.mjs (Agent Test File), AX OS Repository, brain.test.mjs (Brain Test File), expect / describe / it / beforeEach (Test API), _harness.mjs (Zero-Dependency Test Harness), node:assert/strict (Built-in Node.js Assert Module) (+6 more)

### Community 9 - "BRAIN Oracle Integration"
Cohesion: 0.24
Nodes (10): 1,800,000ms Subprocess Timeout for BRAIN API ~140s Round-Trip, ax-os-demo-phase8.mjs — Phase-8 Demonstration Script, BRAIN_REAL Environment Variable Gate, brain.simulator Python Module, child_process.execSync — Subprocess Mechanism for Oracle, Inline Oracle Design Pattern / BRAIN_REAL Gate (Contribution 3), realSim() Inline Function — Python Subprocess Oracle Mirror, Finding: BRAIN Live Oracle Response 141.9s, alpha_id RRd5Rvmj Returned (+2 more)

### Community 10 - "Node.js Harness Implementation"
Cohesion: 0.2
Nodes (10): Dependency Drift — Primary Driver of Irreproducibility in ML Systems, _harness.mjs — 40-line ES Module Zero-Dependency Test Shim, node:assert/strict — Node.js Built-in Assertion Module, Node.js node:test Built-in Module (stable since Node.js 20), parser.test.mjs — 9 Specs for Parser Module, registry-loop.test.mjs — 10 Specs for Compressed Model Registry, Finding: _harness.mjs Achieves 27/27 Test Pass on Clean Node.js ≥18 Without npm install, router.test.mjs — 8 Specs for Router Module (+2 more)

### Community 11 - "Downstream Benchmark Scripts"
Cohesion: 0.33
Nodes (5): ARC-Easy test dataset, compute_nll_per_token() in eval_arc_e, compute_nll_per_token() in eval_hellaswag_mlx, HellaSwag validation dataset, NLL-per-token scoring (completion ranking)

### Community 12 - "Hapax Ablation Functions"
Cohesion: 0.53
Nodes (4): build_subsets(), chunk_ppl(), Compute average PPL over a list of token-ID lists (each ≥2 tokens)., run_model()

### Community 13 - "HellaSwag Eval Functions"
Cohesion: 0.7
Nodes (3): compute_nll_per_token(), evaluate(), HellaSwag accuracy evaluation using mlx_lm. Usage: python eval_hellaswag_mlx.py

### Community 14 - "Hapax Integration Functions"
Cohesion: 0.7
Nodes (3): format_ablation_table(), load_results(), update_paper()

### Community 15 - "ARC-Easy Eval Functions"
Cohesion: 0.83
Nodes (2): compute_nll_per_token(), evaluate()

### Community 16 - "Quick PPL Eval"
Cohesion: 0.83
Nodes (2): eval_ppl_quick(), main()

### Community 17 - "WikiText-2 PPL Eval"
Cohesion: 0.83
Nodes (2): eval_wikitext2_ppl(), main()

### Community 18 - "C4 PPL Eval"
Cohesion: 0.83
Nodes (3): eval_c4_ppl(), load_c4_text(), main()

### Community 19 - "Scale Figure Generator"
Cohesion: 1.0
Nodes (0): 

### Community 20 - "Handoff Documents"
Cohesion: 1.0
Nodes (1): Path B — Re-scope thesis: demote AX OS co-design narrative to quantization finding + appendices

### Community 21 - "Paper Score Tracking"
Cohesion: 1.0
Nodes (1): Paper Quality Score: 78.7/100 (paper-orchestra 6-axis rubric)

### Community 22 - "Analysis Scripts"
Cohesion: 1.0
Nodes (0): 

### Community 23 - "Throughput Metrics"
Cohesion: 1.0
Nodes (1): Throughput τ (tok/s) — Wall-Clock 200-Token Generation

### Community 24 - "Artifact Size Metrics"
Cohesion: 1.0
Nodes (1): Artifact Size S (MB) — Sum of .safetensors Files

## Ambiguous Edges - Review These
- `gen_scale_ppl_fig.py` → `hapax_ablation_results.json (output artifact)`  [AMBIGUOUS]
  analysis/gen_scale_ppl_fig.py · relation: shares_data_with

## Knowledge Gaps
- **137 isolated node(s):** `eval_ppl_quick.py — Quick eval (first 8192 tokens, 16 windows)`, `gen_scale_ppl_fig.py — Regenerate fig_q4_scale_ppl figure`, `Paper score: 73.02/100 (paper-orchestra 6-axis rubric)`, `Axis: logical_flow — weight 0.15, avg 71.0`, `Axis: writing_clarity — weight 0.15, avg 77.0` (+132 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Scale Figure Generator`** (1 nodes): `gen_scale_ppl_fig.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Handoff Documents`** (1 nodes): `Path B — Re-scope thesis: demote AX OS co-design narrative to quantization finding + appendices`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Paper Score Tracking`** (1 nodes): `Paper Quality Score: 78.7/100 (paper-orchestra 6-axis rubric)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Analysis Scripts`** (1 nodes): `gen_scale_ppl_fig.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Throughput Metrics`** (1 nodes): `Throughput τ (tok/s) — Wall-Clock 200-Token Generation`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Artifact Size Metrics`** (1 nodes): `Artifact Size S (MB) — Sum of .safetensors Files`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `gen_scale_ppl_fig.py` and `hapax_ablation_results.json (output artifact)`?**
  _Edge tagged AMBIGUOUS (relation: shares_data_with) - confidence is low._
- **Why does `AX OS: Architecture-Aware Quantization Sensitivity Study` connect `Evaluation Protocol & Findings` to `Hapax & C4 Analysis Pipeline`?**
  _High betweenness centrality (0.100) - this node is a cross-community bridge._
- **Why does `AX OS Paper: Scale-Stratified 4-bit Quantization for Edge LLM Agents` connect `AX OS Core Infrastructure` to `Evaluation Protocol & Findings`, `TypeScript Agent System`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **Why does `Figure: WikiText-2 q4 PPL Increase vs. Scale (scatter plot, Qwen2.5/Mistral-7B/Llama-3.1-8B)` connect `Scale & Quantization Concepts` to `AX OS Core Infrastructure`, `Evaluation Protocol & Findings`, `TypeScript Agent System`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **What connects `eval_ppl_quick.py — Quick eval (first 8192 tokens, 16 windows)`, `gen_scale_ppl_fig.py — Regenerate fig_q4_scale_ppl figure`, `Paper score: 73.02/100 (paper-orchestra 6-axis rubric)` to the rest of the system?**
  _137 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Graphify Knowledge Graph` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `AX OS Core Infrastructure` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._