# Graph Report - /Users/xox/ax-os-paper/  (2026-06-04)

## Corpus Check
- 5 files · ~37,038 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 96 nodes · 118 edges · 13 communities detected
- Extraction: 80% EXTRACTED · 20% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY__harness.mjs — 40-line ES module, 11 m…|_harness.mjs — 40-line ES module, 11 m…]]
- [[_COMMUNITY_AX OS — TypeScript Multi-Agent OS Libr…|AX OS — TypeScript Multi-Agent OS Libr…]]
- [[_COMMUNITY_Size-Perplexity Pareto for Qwen2.5-1.5…|Size-Perplexity Pareto for Qwen2.5-1.5…]]
- [[_COMMUNITY_Before (vitest) flow|Before (vitest) flow]]
- [[_COMMUNITY_Metric ΔPPL under uniform q4 (%)|Metric: ΔPPL under uniform q4 (%)]]
- [[_COMMUNITY_env switch (BRAIN_REAL)|env switch (BRAIN_REAL)]]
- [[_COMMUNITY_Contribution 3 scale-stratified 4-bit…|Contribution 3: scale-stratified 4-bit…]]
- [[_COMMUNITY__harness.mjs (expect  describe  it …|_harness.mjs (expect / describe / it /…]]
- [[_COMMUNITY_Finding Mistral-7B q4 degrades only +…|Finding: Mistral-7B q4 degrades only +…]]
- [[_COMMUNITY_Claim architecture dominates scale as…|Claim: architecture dominates scale as…]]
- [[_COMMUNITY_Finding Qwen2.5 q4 ΔPPL nearly flat —…|Finding: Qwen2.5 q4 ΔPPL nearly flat —…]]
- [[_COMMUNITY_Uniform q4 4 bits per weight, 64-weig…|Uniform q4: 4 bits per weight, 64-weig…]]
- [[_COMMUNITY_5-way scheme screen (bf16q8q4mixed3…|5-way scheme screen (bf16/q8/q4/mixed3…]]

## God Nodes (most connected - your core abstractions)
1. `Size-Perplexity Pareto for Qwen2.5-1.5B (Five Quantization Schemes)` - 9 edges
2. `Contribution 3: scale-stratified 4-bit quantization measurements` - 8 edges
3. `Finding: Qwen2.5 q4 ΔPPL nearly flat — +16.2% (1.5B), +14.4% (3B), +14.3% (7B)` - 6 edges
4. `AX OS — TypeScript Multi-Agent OS Library (zero external runtime deps)` - 6 edges
5. `_harness.mjs — 40-line ES module, 11 matchers, .not negation` - 5 edges
6. `mlx_lm.convert (q_bits=4, q_group_size=64) uniform q4 pipeline` - 5 edges
7. `Finding: Mistral-7B q4 degrades only +3.9% ΔPPL at same 3.5x compression` - 5 edges
8. `Claim: architecture dominates scale as predictor of q4 robustness (3.7x cross-arch gap)` - 5 edges
9. `q4_uniform (~830 MB, perplexity ~60) - Pareto-dominant point` - 5 edges
10. `env switch (BRAIN_REAL)` - 5 edges

## Surprising Connections (you probably didn't know these)
- `AX OS — TypeScript Multi-Agent OS Library (zero external runtime deps)` --shares_data_with--> `Same Test Suite — Zero Code Change`  [INFERRED]
  figures/fig_system_overview.png → figures/fig_system_overview.png  _Bridges community 1 → community 5_
- `AX OS — zero-dependency TypeScript multi-agent OS library` --implements--> `Contribution 3: scale-stratified 4-bit quantization measurements`  [EXTRACTED]
  paper.pdf → paper.pdf  _Bridges community 0 → community 6_
- `Contribution 3: scale-stratified 4-bit quantization measurements` --implements--> `mlx_lm.convert (q_bits=4, q_group_size=64) uniform q4 pipeline`  [EXTRACTED]
  paper.pdf → paper.pdf  _Bridges community 6 → community 9_
- `Contribution 3: scale-stratified 4-bit quantization measurements` --references--> `Finding: Qwen2.5 q4 ΔPPL nearly flat — +16.2% (1.5B), +14.4% (3B), +14.3% (7B)`  [EXTRACTED]
  paper.pdf → paper.pdf  _Bridges community 6 → community 10_
- `Contribution 3: scale-stratified 4-bit quantization measurements` --references--> `Finding: Mistral-7B q4 degrades only +3.9% ΔPPL at same 3.5x compression`  [EXTRACTED]
  paper.pdf → paper.pdf  _Bridges community 6 → community 8_

## Hyperedges (group relationships)
- **The three co-designed AX OS contributions** — paper_contrib_harness, paper_contrib_oracle, paper_contrib_scale_q4 [EXTRACTED 0.95]
- **Scale-stratified q4 study data points** — paper_qwen_flat_curve, paper_mistral_3p9, paper_arch_dominates_scale [EXTRACTED 0.90]
- **PTQ prior art cited as foundation** — paper_gptq, paper_awq, paper_squeezellm [EXTRACTED 0.85]

## Communities

### Community 0 - "_harness.mjs — 40-line ES module, 11 m…"
Cohesion: 0.14
Nodes (14): 27/27 tests pass on clean Node.js checkout, no npm install, AX OS — zero-dependency TypeScript multi-agent OS library, BRAIN_REAL=1 env-var gate (auditable, deterministic toggle), brain.simulator / WorldQuant alpha oracle (~140s API latency), Contribution 1: zero-dependency node:test harness, Contribution 2: inline BRAIN_REAL oracle switching, Gundersen & Kjensmo 2018 — only 20-30% reproducibility variables documented, _harness.mjs — 40-line ES module, 11 matchers, .not negation (+6 more)

### Community 1 - "AX OS — TypeScript Multi-Agent OS Libr…"
Cohesion: 0.25
Nodes (11): AX OS — TypeScript Multi-Agent OS Library (zero external runtime deps), After: node:test / node:assert/strict / _harness.mjs / test files (built-in), Before: npm install / node_modules / vitest / test files, _harness.mjs, AEQIntegration (TypeScript API): quantize / getCompressionStats / benchmark, LLM (BF16 weights), Mistral-7B (3.56x | +1.6% ppl), quantize_model_q4() [scale-per-group] (+3 more)

### Community 2 - "Size-Perplexity Pareto for Qwen2.5-1.5…"
Cohesion: 0.36
Nodes (10): AEQ mixed (2+6 bit) (~570 MB, perplexity 162755 - severe degradation), AEQ mixed (3+6 bit) (~830 MB, perplexity ~120), BF16 baseline (~2950 MB, lowest perplexity ~50), Size-Perplexity Pareto for Qwen2.5-1.5B (Five Quantization Schemes), Pareto Frontier (size vs perplexity tradeoff), Insight: q4_uniform dominates AEQ mixed schemes (smaller-or-equal size, lower perplexity), q4_uniform (~830 MB, perplexity ~60) - Pareto-dominant point, q8_uniform (~1580 MB, near-baseline perplexity) (+2 more)

### Community 3 - "Before (vitest) flow"
Cohesion: 0.22
Nodes (10): After (_harness.mjs) flow, Before (vitest) flow, Cold install: ~15 s | CI cache: 300+ MB, Zero-Dependency Test Harness: _harness.mjs Design, node_modules/ (~300 MB), npm install, _harness.mjs: 0 npm deps, 0 install step, ships inside AX OS repo, test2.spec.ts (+2 more)

### Community 4 - "Metric: ΔPPL under uniform q4 (%)"
Cohesion: 0.36
Nodes (9): WikiText-2 q4 perplexity increase vs. scale chart, Insight: flat intra-family Qwen curve (~14-16%) vs Mistral cross-arch outlier (+3.9%), Metric: ΔPPL under uniform q4 (%), Mistral-7B (cross-arch): +3.9% ΔPPL, Qwen2.5 1.5B: +16.2% ΔPPL, Qwen2.5 3B: +14.4% ΔPPL, Qwen2.5 7B: +14.3% ΔPPL, Qwen2.5 same-family curve (flat intra-family scaling) (+1 more)

### Community 5 - "env switch (BRAIN_REAL)"
Cohesion: 0.29
Nodes (8): Agent Code (TypeScript), BRAIN_REAL=0 (mock), BRAIN_REAL=1 (live), env switch (BRAIN_REAL), Live BRAIN API Call, Same Test Suite — Zero Code Change, Simulated BRAIN Response, Contribution 2: Inline BRAIN_REAL Oracle Switching

### Community 6 - "Contribution 3: scale-stratified 4-bit…"
Cohesion: 0.29
Nodes (7): AWQ (Lin et al. 2023) — 1% salient weights protected, 3x edge speedup, MLSys 2024 best paper, Contribution 3: scale-stratified 4-bit quantization measurements, GGUF format (llama.cpp, memory-mappable single-file quantized models), GPTQ (Frantar et al. 2023) — 2nd-order layerwise PTQ, 175B in ~4 GPU-hrs, MLX framework (Apple Silicon unified memory inference), Rajesh et al. 2025 — 5-runtime Apple Silicon comparison (MLX highest throughput), SqueezeLLM (Kim et al. 2024) — dense+sparse decomposition, outliers at full precision

### Community 7 - "_harness.mjs (expect / describe / it /…"
Cohesion: 0.38
Nodes (7): aeq.test.mjs, agents.test.mjs, brain.test.mjs, _harness.mjs (expect / describe / it / beforeEach), node:assert/strict (built-in), node --test *.mjs (no install) | 27/27 PASS, node:test (built-in)

### Community 8 - "Finding: Mistral-7B q4 degrades only +…"
Cohesion: 0.4
Nodes (5): AEQIntegration registry (AEQModelConfig, status=available, measured VRAM/speedup), 3.5x compression ratio (S_bf16 / S_q4), Rationale: all quantitative system parameters empirically derived, not estimated, Finding: Mistral-7B q4 degrades only +3.9% ΔPPL at same 3.5x compression, Mistral-7B-Instruct-v0.3 q4 artifact (4078 MB, +3.9% ppl, +17% throughput) registered in AEQIntegration

### Community 9 - "Claim: architecture dominates scale as…"
Cohesion: 0.6
Nodes (5): Claim: architecture dominates scale as predictor of q4 robustness (3.7x cross-arch gap), Control: Qwen2.5-7B local q4 group64 = +16.3% ΔPPL (vs mlx-community +14.3%, Mistral +3.9%) — confound ruled out, Controlled confound: Qwen q4 pipeline (group size) — re-tested, gap survives, mlx_lm.convert (q_bits=4, q_group_size=64) uniform q4 pipeline, Zhao et al. 2025 — quantization benchmark across 7B-70B architectures

### Community 10 - "Finding: Qwen2.5 q4 ΔPPL nearly flat —…"
Cohesion: 0.5
Nodes (5): Limitation: single hardware (M1 Max); RTX 5070 Ti deployment target unmeasured, Hardware: Apple M1 Max, 68.7GB unified memory, MLX backend, Ouyang et al. 2024 — 1500+ checkpoints, larger/undertrained models more q-robust, Finding: Qwen2.5 q4 ΔPPL nearly flat — +16.2% (1.5B), +14.4% (3B), +14.3% (7B), Xu et al. 2024 — power-law model of post-compression quality

### Community 11 - "Uniform q4: 4 bits per weight, 64-weig…"
Cohesion: 0.5
Nodes (4): Limitation: mixed-precision-vs-uniform conclusion applies only to dense; MoE untested, Perplexity PPL=exp(mean CE), float32 before exp, Uniform q4: 4 bits per weight, 64-weight shared scale groups, WikiText-2 standard evaluation corpus

### Community 12 - "5-way scheme screen (bf16/q8/q4/mixed3…"
Cohesion: 1.0
Nodes (1): 5-way scheme screen (bf16/q8/q4/mixed3+6/mixed2+6) on short text, ranking-only

## Knowledge Gaps
- **30 isolated node(s):** `Three interlocking edge-LLM problems: compression, verifiable testing, live oracle integration`, `node:test (Node.js built-in test runner, stable since Node 20)`, `node:assert/strict (backs expect())`, `Rationale: ax-os-package.json naming avoids parent package.json shadowing vitest`, `27/27 tests pass on clean Node.js checkout, no npm install` (+25 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `5-way scheme screen (bf16/q8/q4/mixed3…`** (1 nodes): `5-way scheme screen (bf16/q8/q4/mixed3+6/mixed2+6) on short text, ranking-only`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Contribution 3: scale-stratified 4-bit quantization measurements` connect `Contribution 3: scale-stratified 4-bit…` to `_harness.mjs — 40-line ES module, 11 m…`, `Claim: architecture dominates scale as…`, `Finding: Qwen2.5 q4 ΔPPL nearly flat —…`, `Finding: Mistral-7B q4 degrades only +…`?**
  _High betweenness centrality (0.109) - this node is a cross-community bridge._
- **Why does `AX OS — zero-dependency TypeScript multi-agent OS library` connect `_harness.mjs — 40-line ES module, 11 m…` to `Contribution 3: scale-stratified 4-bit…`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `AX OS — TypeScript Multi-Agent OS Library (zero external runtime deps)` (e.g. with `After: node:test / node:assert/strict / _harness.mjs / test files (built-in)` and `Same Test Suite — Zero Code Change`) actually correct?**
  _`AX OS — TypeScript Multi-Agent OS Library (zero external runtime deps)` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Three interlocking edge-LLM problems: compression, verifiable testing, live oracle integration`, `node:test (Node.js built-in test runner, stable since Node 20)`, `node:assert/strict (backs expect())` to the rest of the system?**
  _30 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `_harness.mjs — 40-line ES module, 11 m…` be split into smaller, more focused modules?**
  _Cohesion score 0.14 - nodes in this community are weakly interconnected._