# OS_for_Agent

> Cost-aware verifiable execution stack: natural language → measured/synthesized x86 ASM + cycle estimate + cryptographic attestation.

End state of a 14-step convergence from [USE_LLVM_LSTM](https://github.com/popixoxipop-collab/USE_LLVM_LSTM)'s LLVM-IR-trajectory → cycle predictor. Plugs into [[f-core]] as an `ExecutionSlot` in slot[11] of the 12-orthogonal-64-D NeuralOS layout.

## Identity

- **Repo (USE_LLVM_LSTM)**: https://github.com/popixoxipop-collab/USE_LLVM_LSTM
- **Repo (OS_for_Agent)**: https://github.com/popixoxipop-collab/OS_for_Agent
- **Owner**: `popixoxipop` (this user)
- **Status**: production-ready MCP server (22 tools across 6 layers)

## Core asset — landmark router

A cost-aware semantic router (`landmark_navigator.py`) that takes a natural-language description of an algorithm and returns the closest registered LLVM CID, weighed jointly by [[labse-embedding-similarity]] and execution cost (log cycles).

After the [[os-for-agent-step1-8]] training pipeline, the router scores **top1 0.830 / top3 0.930 / top5 0.935** on 200 held-out paraphrases (LLVM-only pool of 1243 algos), with end-to-end latency mean 16.3 ms (encode 14.2 ms + route 0.95 ms) on Apple Silicon MPS.

## Architecture (one paragraph)

NL prompt → [[labse-cross-modal-encoder]] (LaBSE-XM, 768-D) → 1536-D hybrid (LB + NL2IR(LB)) → cosine vs registry of 1243 LLVM algos → cost-adjusted score (`cosine_dist + 0.1 · log_cycles_norm`) → top CID → measured ASM/cycles from `cid_registry_v1.json`, with every call hash-chained into `zk_receipts.jsonl`.

## Pivot from generator to MCP

Original goal was an LSTM-trained seq2seq IR generator. The decisive pivot (합류 ★) was: **the LLM IS the generator; the infrastructure verifies**. The MCP server `oa_mcp_server.py` exposes 22 tools across Core RAG / Exec / Trust / Obs / Fed / Meta, and lets any MCP-aware client (Claude Code, Gemini CLI, Cursor) drive the routing + execution + attestation pipeline.

## Training pipeline

See [[os-for-agent-step1-8]] for the full timeline of accuracy improvements:
- Step 1-3: LaBSE + λ_cost tuning
- Step 4: InfoNCE paraphrase-contrastive FT
- Step 5: NL↔IR cross-modal contrastive
- Step 6: 1920-D IR-channel hybrid (later shown to underperform)
- Step 7: IR-aware paraphrase regeneration ([[negative-result]] — reverted)
- Step 8: Ablation discovery + [[nl2ir-projection-head]] → final 1536-D hybrid (top1 0.83)

## Related

- [[f-core]] — host NeuralOS that consumes the ExecutionSlot
- [[labse-embedding-similarity]] — base encoder
- [[infonce-contrastive]] — training objective for Step 4-5-8
