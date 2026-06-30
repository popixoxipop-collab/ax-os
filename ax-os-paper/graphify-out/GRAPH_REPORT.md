# Graph Report - /Users/xox/ax-os-paper  (2026-06-20)

## Corpus Check
- 26 files · ~50,000 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 595 nodes · 813 edges · 53 communities (41 shown, 12 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 71 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Quantization Eval Pipeline|Quantization Eval Pipeline]]
- [[_COMMUNITY_Test Harness Infrastructure|Test Harness Infrastructure]]
- [[_COMMUNITY_Cross-Corpus C4 Eval|Cross-Corpus C4 Eval]]
- [[_COMMUNITY_PPL Scale Results|PPL Scale Results]]
- [[_COMMUNITY_Oracle BRAIN Integration|Oracle BRAIN Integration]]
- [[_COMMUNITY_Model Architecture|Model Architecture]]
- [[_COMMUNITY_PTQ Literature|PTQ Literature]]
- [[_COMMUNITY_Reproducibility|Reproducibility]]
- [[_COMMUNITY_Edge Deployment|Edge Deployment]]
- [[_COMMUNITY_Vocabulary Analysis|Vocabulary Analysis]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]

## God Nodes (most connected - your core abstractions)
1. `AX OS: Scale-Stratified 4-bit Quantization for Edge LLM Agents` - 78 edges
2. `AX OS Paper: Scale-Stratified 4-bit Quantization for Edge LLM Agents` - 34 edges
3. `AX OS: Scale-Stratified 4-bit Quantization for Edge LLM Agents, with Reproducible Zero-Dependency Test Infrastructure` - 34 edges
4. `AX OS: Architecture-Aware Quantization Sensitivity Study` - 23 edges
5. `Scale-Stratified 4-bit Quantization Measurements (Contribution 1)` - 20 edges
6. `_harness.mjs (expect/describe/it/beforeEach)` - 15 edges
7. `Figure 4: ΔPPL vs Parameter Count (WikiText-2)` - 15 edges
8. `Qwen2.5-7B` - 14 edges
9. `Mistral-7B` - 14 edges
10. `AX OS Paper README` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Cross-architecture gap at 7B: 1.9× (Qwen more sensitive than Mistral)` --semantically_similar_to--> `Community 9: Claim architecture dominates scale as predictor of q4 robustness (3.7× gap)`  [INFERRED] [semantically similar]
  README.md → graphify-out/GRAPH_REPORT.md
- `Intra-family scale effect: 1.8× range across 4.7× parameter increase (15.0%→8.5%), monotonically decreasing` --semantically_similar_to--> `Community 4: Metric ΔPPL under uniform q4 (%) hub`  [INFERRED] [semantically similar]
  README.md → graphify-out/GRAPH_REPORT.md
- `Figure 4: ΔPPL vs Parameter Count (WikiText-2)` --implements--> `analysis/gen_scale_ppl_fig.py`  [EXTRACTED]
  /Users/xox/ax-os-paper/paper.pdf → README.md
- `4-bit Post-Training Quantization (PTQ, q4, q_bits=4, q_group_size=64)` --conceptually_related_to--> `q8 Lossless Finding: Qwen2.5-7B q8 ΔPPL=-0.28%`  [INFERRED]
  paper.pdf → README.md
- `AEQIntegration Registry (model registry subsystem of AX OS, stores compressed artifacts)` --references--> `Llama-3.1-8B q4 Local Artifact (base: mlx-community/Meta-Llama-3.1-8B-Instruct-bf16, license: llama3.1, MLX library)`  [INFERRED]
  paper.pdf → path_a_artifacts/llama8b_q4_local/README.md

## Import Cycles
- None detected.

## Communities (53 total, 12 thin omitted)

### Community 0 - "Quantization Eval Pipeline"
Cohesion: 0.06
Nodes (48): AEQIntegration Registry (model registry subsystem of AX OS, stores compressed artifacts), Ajayi & Odunayo 2025: Benchmarking On-Device ML on Apple Silicon with MLX (arXiv:2510.18921), Apple M1 Max (68.7 GB unified memory, primary evaluation hardware), ARC-Easy Downstream: Qwen2.5-7B q4 ACC=53.03% vs BF16=52.53% (DACC=+0.50pp, CI plus-minus 2.0pp, n=2376), AWQ (Lin et al., 2023): Activation-Aware Weight Quantization, MLSys 2024 Best Paper, AX OS: TypeScript Multi-Agent Library, AX OS Paper: Scale-Stratified 4-bit Quantization for Edge LLM Agents, Barrios 2026: Native LLM/MLLM Inference at Scale on Apple Silicon (arXiv:2601.19139) (+40 more)

### Community 1 - "Test Harness Infrastructure"
Cohesion: 0.05
Nodes (48): Graph Report — 96 nodes, 118 edges, 13 communities (2026-06-04), Community 9: Claim architecture dominates scale as predictor of q4 robustness (3.7× gap), Community 1: AX OS TypeScript Multi-Agent OS Library hub, Community 4: Metric ΔPPL under uniform q4 (%) hub, Community 0: _harness.mjs — 40-line ES module, 11 matchers hub, Community 2: Size-Perplexity Pareto for Qwen2.5-1.5B hub, God node: AX OS TypeScript Multi-Agent OS Library (6 edges), God node: Contribution 3 — scale-stratified 4-bit quantization measurements (8 edges) (+40 more)

### Community 2 - "Cross-Corpus C4 Eval"
Cohesion: 0.07
Nodes (38): 512-Token Non-Overlapping Evaluation Window Protocol, AEQIntegration Drop-in Registry Entry for Mistral-7B q4, ARC-Easy Benchmark — Commonsense Reasoning Evaluation, Architecture-Aware Model Selection — Motivated by 1.9× Cross-Architecture Gap, C4 Corpus (Colossal Clean Crawled Corpus), Compression Ratio r = S_bf16 / S_q4 (≈3.5× for all models), ΔPPL Metric — Relative Perplexity Increase under q4, Deterministic PPL — Exact Measurements, No PRNG, No Calibration (+30 more)

### Community 3 - "PPL Scale Results"
Cohesion: 0.11
Nodes (34): 512-Token Non-Overlapping Windows Evaluation Protocol (full WikiText-2 test split), ARC-Easy Downstream Evaluation, ARC-Easy: No Degradation at q4 (ΔACC=+0.5pp, CI=±2.0pp), AX OS Paper README, AX OS: Architecture-Aware Quantization Sensitivity Study, C4 Cross-Corpus Stability for 1.5B/3B Models, C4 Cross-Corpus PPL Evaluation, Cross-Architecture PPL Gap at 7-8B (1.9x range) (+26 more)

### Community 4 - "Oracle BRAIN Integration"
Cohesion: 0.06
Nodes (34): Ajayi and Odunayo, 2025 (MLX Benchmarks), Barrios, 2026 (Scale-Up Inference Frameworks, Apple Silicon), Lin et al., 2024 (Edge LLM Frameworks Catalogue), Ouyang et al., 2024 (1500+ Quantized Checkpoints Study), Wan et al., 2024 (LLM Compression Survey), Xu et al., 2024a (On-device LM Design Axes Survey), Xu et al., 2024b (Statistical Power-Law, 7B–70B Scaling), Zhao et al., 2025 (PTQ Taxonomy Survey, 7B–70B) (+26 more)

### Community 5 - "Model Architecture"
Cohesion: 0.07
Nodes (28): Mistral-7B, avg_token_length, chars_per_token, entropy, hapax_count, hapax_ratio, n_tokens, n_unique (+20 more)

### Community 6 - "PTQ Literature"
Cohesion: 0.09
Nodes (25): vitest (Before: ~300MB node_modules, CI 15s cold install), Zero-Dependency Test Harness (_harness.mjs), 0 npm deps, 0 install step, ships inside AX OS repo, AEQ mixed 2+6 bit (~530MB, ppl=162755, catastrophic degradation), AEQ mixed 3+6 bit (~810MB, ppl ~120), BF16 baseline (~3050MB), Pareto frontier (size vs perplexity), q4_uniform (Pareto dominant, ~830MB) (+17 more)

### Community 7 - "Reproducibility"
Cohesion: 0.11
Nodes (21): build_subsets() — hapax-stratified subset builder, C4 English validation dataset, chunk_ppl() — per-chunk PPL computation, ΔPPL metric (q4 vs BF16 perplexity increase), eval_c4_ppl() — C4 stride PPL eval, eval_ppl_quick() — quick PPL on first N tokens, eval_wikitext2_ppl() — stride-based PPL eval, figures/fig_q4_scale_ppl.png (output figure) (+13 more)

### Community 8 - "Edge Deployment"
Cohesion: 0.11
Nodes (26): AEQIntegration TypeScript API (quantize/getCompressionStats/benchmark), Agent Code (TypeScript), AX OS — TypeScript Multi-Agent OS Library, BRAIN_REAL=0 (Mock Mode), BRAIN_REAL=1 (Live Mode), Contribution 1: Zero-Dependency Test Harness, Contribution 2: Inline BRAIN_REAL Oracle Switching, Contribution 3: Scale-Stratified Uniform q4 Compression (+18 more)

### Community 9 - "Vocabulary Analysis"
Cohesion: 0.16
Nodes (26): Model Scale Axis (Parameters in Billions), Catastrophic Degradation under Aggressive Quantization, Grouped-Query Attention (GQA) — Shared by All Three 7B Architectures, Pareto Dominance — q4 Uniform Dominates All Others, Pareto Frontier (Size-Perplexity Trade-off), WikiText-2 Benchmark Dataset, Qwen2.5 Model Family (1.5B–7B), Figure 4: ΔPPL vs Parameter Count (WikiText-2) (+18 more)

### Community 10 - "Community 10"
Cohesion: 0.15
Nodes (19): 27/27 PASS (node --test *.mjs, no install), aeq.test.mjs, aeq.test.mjs (AEQ Test File), agents.test.mjs, agents.test.mjs (Agent Test File), AX OS Repository, brain.test.mjs, brain.test.mjs (Brain Test File) (+11 more)

### Community 11 - "Community 11"
Cohesion: 0.14
Nodes (19): AX OS: Scale-Stratified 4-bit Quantization for Edge LLM Agents, with Reproducible Zero-Dependency Test Infrastructure, Ajayi and Odunayo 2025: Benchmarking On-Device ML on Apple Silicon with MLX (arXiv:2510.18921), AWQ (Lin et al., 2023): Activation-Aware Weight Quantization, MLSys 2024 Best Paper, Barrios 2026: Native LLM/MLLM Inference at Scale on Apple Silicon (arXiv:2601.19139), GPTQ (Frantar et al., 2023): Approximate Second-Order Layer-by-Layer Quantization, Gundersen and Kjensmo 2018: ML Reproducibility Survey (400 AAAI/IJCAI papers, 20-30% documented variables), Lin et al. 2024: Edge LLM Frameworks Survey, Pineau et al. 2021: NeurIPS 2019 Reproducibility Program — Code Submission + Hardware Checklist (+11 more)

### Community 12 - "Community 12"
Cohesion: 0.16
Nodes (15): 1,800,000ms Subprocess Timeout for BRAIN API ~140s Round-Trip, ax-os-demo-phase8.mjs — Phase-8 Demonstration Script, BRAIN_REAL Environment Variable Oracle Gate, brain.simulator Python Module, child_process.execSync — Subprocess Mechanism for Oracle, Contribution 3 (Enabling): Inline Oracle Design Pattern / BRAIN_REAL Gate, Finding: BRAIN Live Oracle Response 141.9s, alpha_id RRd5Rvmj Returned, Inline Oracle Design Pattern / BRAIN_REAL Gate (Contribution 3) (+7 more)

### Community 13 - "Community 13"
Cohesion: 0.15
Nodes (13): Dependency Drift — Primary Driver of Irreproducibility in ML Systems, Figure 2: _harness.mjs Design — Before/After (replaces 300MB vitest node_modules with single 40-line file), _harness.mjs: 40-line ES Module Zero-Dependency Test Shim, node:assert/strict — Node.js Built-in Assertion Module, Node.js node:test Built-in Module (stable since Node.js 20, experimental since Node.js 18), Node.js node:test Built-in Module (stable since Node.js 20), parser.test.mjs — 9 Specs for Parser Module, Rationale: _harness.mjs uses Node.js node:test + node:assert/strict builtins to avoid npm install dependency drift — primary driver of irreproducibility in ML systems (+5 more)

### Community 14 - "Community 14"
Cohesion: 0.18
Nodes (12): Figure 4: WikiText-2 q4 PPL Increase vs. Scale (scatter plot: Qwen2.5 family + Mistral-7B + Llama-3.1-8B), Paper Quality Score: 80.65/100 (paper-orchestra 6-axis rubric, 2026-06-20 current), Paper Score: 65.5/100 (initial baseline), AX OS Paper README, eval/eval_hellaswag_mlx.py — HellaSwag Evaluation Script, eval/eval_ppl_quick.py — Quick Eval (first 8192 tokens), analysis/gen_scale_ppl_fig.py — Regenerate Figure 4 (WikiText-2 q4 PPL vs Scale), analysis/hapax_ablation.py — Hapax Ablation Analysis Script (+4 more)

### Community 15 - "Community 15"
Cohesion: 0.18
Nodes (11): Apple M1 Max (68.7 GB unified memory, MLX backend) — Primary Evaluation Hardware, Contribution 1 (Primary): Scale-Stratified 4-bit Quantization Measurements, Contribution 2 (Enabling): Zero-Dependency _harness.mjs Test Harness, Figure 1: AX OS System Overview (AEQ pipeline + _harness.mjs + BRAIN_REAL gate), Figure 3: Size-Perplexity Pareto for Qwen2.5-1.5B — Five Quantization Schemes, Finding: _harness.mjs Achieves 27/27 Test Pass on Clean Node.js ≥18 Without npm install, Finding: Intra-family ΔPPL Monotonically Decreasing 1.5B→7B (15.0%→8.5%), Non-monotone at 14B (+10.3%), Finding: Mixed-Precision Recipes (aeq_mixed_3_6, aeq_mixed_2_6) Dominated by q4_uniform at 1.5B Scale (+3 more)

### Community 16 - "Community 16"
Cohesion: 0.20
Nodes (10): Clark et al., 2018 (ARC-Easy Benchmark), Raffel et al., 2020 (C4 Colossal Clean Crawled Corpus), ARC-Easy Downstream Accuracy Evaluation, C4 (Colossal Clean Crawled Corpus) Cross-Corpus Evaluation, Vocabulary Utilisation and Hapax Rate Hypothesis, Finding: C4/WikiText-2 ΔPPL Ratio Scale-Invariant (1.42–1.45×) within Qwen Family, AX OS Paper README, eval/eval_arc_e.py (ARC-Easy Downstream Eval) (+2 more)

### Community 17 - "Community 17"
Cohesion: 0.20
Nodes (9): chunk_stride, delta_ppl_Qwen2.5-7B, high, low, mean_hapax_frac_high, mean_hapax_frac_low, n_chunks_per_subset, protocol (+1 more)

### Community 18 - "Community 18"
Cohesion: 0.25
Nodes (8): Apple M1 Max (68.7 GB Unified Memory, Test Hardware), MLX Backend (Apple Silicon), mlx_lm.convert API (q_bits=4, q_group_size=64), Limitation: Confounded Cross-Arch Claim (mlx-community vs local mlx_lm.convert pipeline mismatch), AX OS Paper Handoff Document, Rationale: Path A (Re-run Experiments) vs Path B (Re-scope Thesis) for Score Improvement Beyond 65.5, Peer Review Score 65.5/100 (6-axis Rubric, 2 Raters, 2026-06-05), Peer Review Score 80.65/100 (paper-orchestra 6-axis Rubric, 2026-06-20)

### Community 19 - "Community 19"
Cohesion: 0.25
Nodes (8): ΔPPL (Perplexity Increase under q4 Compression), Fixed Short-Text Screening Protocol, WikiText-2 Standard Evaluation Protocol, Finding: Scale-Dependent q4 Tolerance (ΔPPL 15.0%→8.5% for 1.5B→7B, non-monotone at 14B), Qwen2.5-14B-Instruct, Qwen2.5-1.5B-Instruct, Rationale: Two Separate PPL Protocols — WikiText-2 (primary) vs Fixed Short-Text (scheme ranking only, not comparable), eval/eval_ppl_wikitext2.py (Full-Corpus PPL, 512-token Non-overlapping)

### Community 20 - "Community 20"
Cohesion: 0.33
Nodes (5): ARC-Easy test dataset, compute_nll_per_token() in eval_arc_e, compute_nll_per_token() in eval_hellaswag_mlx, HellaSwag validation dataset, NLL-per-token scoring (completion ranking)

### Community 21 - "Community 21"
Cohesion: 0.29
Nodes (7): Gundersen and Kjensmo, 2018 (ML Reproducibility Survey), Pineau et al., 2021 (NeurIPS 2019 Reproducibility Program), _harness.mjs Zero-Dependency Test Harness, Node.js node:test Built-in Module, ML System Reproducibility and Zero-Dependency Testing, Finding: 27/27 Tests Pass on Clean Node.js ≥18 with Zero npm install, Rationale: _harness.mjs Avoids npm install by Re-exporting node:test Built-ins (Dependency Drift Prevention)

### Community 22 - "Community 22"
Cohesion: 0.29
Nodes (7): AWQ — Activation-Weighted Quantization, GPTQ — Second-Order Layer-by-Layer PTQ, Post-Training Quantization (PTQ), SqueezeLLM — Dense-and-Sparse Decomposition Quantization, Frantar et al. 2023 — GPTQ: Second-Order PTQ for 175B in ~4 GPU Hours, Kim et al. 2024 — SqueezeLLM: Dense+Sparse Decomposition, +0.3pp LLaMA-7B on C4, Lin et al. 2023 — AWQ: 1% Salient Weights at Higher Precision, 3× Edge Speedup

### Community 23 - "Community 23"
Cohesion: 0.33
Nodes (5): done, n, next_begin, nlls, ppl

### Community 24 - "Community 24"
Cohesion: 0.33
Nodes (5): done, n, next_begin, nlls, ppl

### Community 25 - "Community 25"
Cohesion: 0.33
Nodes (5): done, n, next_begin, nlls, ppl

### Community 26 - "Community 26"
Cohesion: 0.33
Nodes (5): done, n, next_begin, nlls, ppl

### Community 27 - "Community 27"
Cohesion: 0.33
Nodes (6): AX OS TypeScript Multi-Agent Library, BRAIN_REAL Inline Oracle Switching Pattern, Scale-Stratified 4-bit Quantization Measurements, WorldQuant BRAIN Simulation API (Oracle), Finding: BRAIN_REAL Live Oracle Responds 141.9s (alpha_id RRd5Rvmj), Rationale: Single Env Var (BRAIN_REAL=1) Gate Enables Live Oracle Without Compiled Build Artifact

### Community 28 - "Community 28"
Cohesion: 0.53
Nodes (4): build_subsets(), chunk_ppl(), Compute average PPL over a list of token-ID lists (each ≥2 tokens)., run_model()

### Community 29 - "Community 29"
Cohesion: 0.33
Nodes (6): C4 Cross-Corpus Generalization Experiment (§4.4), Raffel et al. 2020: C4 Colossal Clean Crawled Corpus, Finding: C4/WikiText-2 ΔPPL Ratio Scale-Invariant at 1.42-1.45× (Qwen family, spread <2%), Rationale: 512-token non-overlapping windows chosen for full WikiText-2 coverage to ensure PPL values are not run-to-run estimates but exact measurements, WikiText-2 Evaluation Protocol (512-token non-overlapping windows, full test split), eval/eval_ppl_c4.py — C4 Cross-Corpus PPL Evaluation Script

### Community 30 - "Community 30"
Cohesion: 0.70
Nodes (3): compute_nll_per_token(), evaluate(), HellaSwag accuracy evaluation using mlx_lm. Usage: python eval_hellaswag_mlx.py

### Community 31 - "Community 31"
Cohesion: 0.70
Nodes (3): format_ablation_table(), load_results(), update_paper()

### Community 32 - "Community 32"
Cohesion: 0.40
Nodes (5): AEQIntegration Registry (AEQ = Adaptive Expert Quantization, compressed model artifact store), AEQModelConfig — Registry Entry with status/expectedVRAM/expectedSpeedup, GGUF Format: llama.cpp De Facto Standard for Distributing Quantized Models (memory-mappable, introduced Aug 2023), q4_uniform Quantization Scheme (q_bits=4, q_group_size=64, MLX mlx_lm.convert), Rationale: Uniform q4 chosen over mixed-precision because Pareto dominance holds at 1.5B scale; "less important layers can use fewer bits" intuition fails for small dense models

### Community 33 - "Community 33"
Cohesion: 0.50
Nodes (4): AWQ (Lin et al., 2023), GPTQ (Frantar et al., 2023), SqueezeLLM (Kim et al., 2024), Post-Training Quantization (PTQ)

### Community 34 - "Community 34"
Cohesion: 0.50
Nodes (4): AEQIntegration Model Registry, Uniform q4 (4-bit) Quantization Scheme, Finding: Mixed-Precision Inferior to Uniform q4 at 1.5B Dense Scale, Rationale: Uniform q4 Chosen as Pareto-Dominant Scheme (5-way Benchmark on Qwen2.5-1.5B)

### Community 36 - "Community 36"
Cohesion: 0.83
Nodes (3): eval_c4_ppl(), load_c4_text(), main()

### Community 39 - "Community 39"
Cohesion: 0.50
Nodes (4): ARC-Easy Downstream Evaluation (NLL-per-token, n=2376, 95% CI ±2.0pp), Clark et al. 2018: ARC-Easy/Challenge Benchmark Dataset, Finding: ARC-Easy No Degradation at q4 (Qwen2.5-7B ΔACC=+0.50pp, within CI ±2.0pp), eval/eval_arc_e.py — ARC-Easy Downstream Evaluation Script

### Community 40 - "Community 40"
Cohesion: 0.50
Nodes (4): Ouyang et al. 2024: Low-bit Quantization Degrades Undertrained Models Less; Larger Models More Robust (1500+ checkpoints), Xu et al. 2024b: Statistical Power-Law Model for Post-Compression Quality Prediction (7B-70B), Finding: 1.9× Cross-Architecture q4 PPL Gap at 7-8B Scale (Mistral +4.4%, Llama +6.9%, Qwen +8.5%), Vocabulary Sparsity Hypothesis: Hapax Rate Explains Cross-Architecture q4 Gap (Mistral 22.3% vs Qwen 34.6%)

### Community 42 - "Community 42"
Cohesion: 0.67
Nodes (3): Rajesh et al., 2025 (5 Runtimes on Apple Silicon Benchmark), Edge LLM Deployment on Consumer Hardware, GGUF Format (llama.cpp, De Facto Standard for Quantized Distribution)

## Ambiguous Edges - Review These
- `gen_scale_ppl_fig.py` → `hapax_ablation_results.json (output artifact)`  [AMBIGUOUS]
  analysis/gen_scale_ppl_fig.py · relation: shares_data_with

## Knowledge Gaps
- **245 isolated node(s):** `Paper score: 73.02/100 (paper-orchestra 6-axis rubric)`, `Axis: logical_flow — weight 0.15, avg 71.0`, `Axis: writing_clarity — weight 0.15, avg 77.0`, `Axis: evidence_presentation — weight 0.20, avg 65.5`, `Axis: academic_style — weight 0.10, avg 74.0` (+240 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `gen_scale_ppl_fig.py` and `hapax_ablation_results.json (output artifact)`?**
  _Edge tagged AMBIGUOUS (relation: shares_data_with) - confidence is low._
- **Why does `AX OS: Scale-Stratified 4-bit Quantization for Edge LLM Agents` connect `Oracle BRAIN Integration` to `Community 32`, `Community 33`, `Community 34`, `Cross-Corpus C4 Eval`, `Vocabulary Analysis`, `Community 42`, `Community 12`, `Community 13`, `Community 15`, `Community 16`, `Community 18`, `Community 19`, `Community 21`, `Community 22`, `Community 27`?**
  _High betweenness centrality (0.361) - this node is a cross-community bridge._
- **Why does `Figure 4: ΔPPL vs Parameter Count (WikiText-2)` connect `Vocabulary Analysis` to `Quantization Eval Pipeline`, `PPL Scale Results`, `Oracle BRAIN Integration`, `Edge Deployment`, `Community 19`?**
  _High betweenness centrality (0.233) - this node is a cross-community bridge._
- **Why does `AX OS: Scale-Stratified 4-bit Quantization for Edge LLM Agents, with Reproducible Zero-Dependency Test Infrastructure` connect `Community 11` to `Community 32`, `Community 39`, `Community 40`, `Community 12`, `Community 14`, `Community 15`, `Community 29`?**
  _High betweenness centrality (0.174) - this node is a cross-community bridge._
- **What connects `Paper score: 73.02/100 (paper-orchestra 6-axis rubric)`, `Axis: logical_flow — weight 0.15, avg 71.0`, `Axis: writing_clarity — weight 0.15, avg 77.0` to the rest of the system?**
  _246 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Quantization Eval Pipeline` be split into smaller, more focused modules?**
  _Cohesion score 0.06028368794326241 - nodes in this community are weakly interconnected._
- **Should `Test Harness Infrastructure` be split into smaller, more focused modules?**
  _Cohesion score 0.0549645390070922 - nodes in this community are weakly interconnected._