# [[os-for-agent]] Routing Accuracy Pipeline (Step 1–8)

> Eight-step incremental improvement of the cost-aware NL → LLVM-CID router (May 27–28, 2026). top1 0.30 → **0.830** on 200 held-out paraphrases. Plateau broken at Step 8 via per-channel ablation discovery + NL2IR projection head.

## Eval protocol (held constant across steps)

- Pool: 1243 LLVM (C / C++ / Rust) algos from `cid_dataset/dataset.json`, `llvm_only=True` filter
- Test set: for each LLVM algo with ≥2 paraphrases, sample 1 non-canonical phrase → 200 (query, expected) pairs (seed=123)
- Strict top-k: expected `algo_name` ∈ first k results
- Semantic-cluster top-k: any sibling under the same `cluster_key` (strip `_N`, `_NN`, `_hash` suffixes) ∈ first k
- Cost-aware scoring: `cosine_dist + 0.1 · h_cascade_norm` (lower better), λ_cost tuned in Step 3

## Timeline

| step | change | top1 strict | e2e latency |
|------|--------|-------------|-------------|
| 0 | MiniLM 384-D + TF-IDF | ~0.30 | — |
| 1 | gemini-2.5-flash paraphrase expansion (1243 × 8 phrases) | — | — |
| 2 | MiniLM → LaBSE 768-D, 1152-D hybrid | 0.50 | — |
| 3 | λ_cost 1.0 → 0.1 sweep | 0.50 (200 set) / 0.90 (10-canonical) | — |
| 4 | InfoNCE paraphrase-contrastive FT (3 epochs, τ=0.05) | 0.630 | — |
| 5 | NL↔IR cross-modal contrastive (4 epochs, τ=0.07) | 0.635 | — |
| 6 | 1920-D hybrid: TF-IDF + LaBSE-XM + IR-encoder | **0.640** | 34.7 ms |
| 7 | IR-aware paraphrase regeneration → re-train ❌ | 0.610 ([[negative-result]]) | — |
| **8** | **Ablation discovery + [[nl2ir-projection-head]] + 1536-D LB+IR hybrid** | **0.830** | **16.3 ms** |

## The Step 8 discovery

`ablation_channels.py` decomposed the 1920-D Step 6 hybrid by channel:

| combo | dim | top1 |
|---|---|---|
| TF only | 384 | 0.295 |
| LB (LaBSE-XM) only | 768 | **0.825** |
| IR only (with LB fallback) | 768 | 0.040 |
| TF + LB | 1152 | 0.635 |
| TF + LB + IR (Step 6 = current) | 1920 | 0.640 |

**LaBSE-XM alone outperformed the 1920-D ensemble by 18.5 pp.** Both TF-IDF and the IR channel (with LB fallback at query side) were *net noise* — the IR channel especially because registry vectors lived in IR-encoder space while query vectors fell back to LaBSE space inside the same channel.

**Fix (Step 8b)**: `train_nl2ir_head.py` — small residual MLP (768→1024→768 + LayerNorm) trained on (LaBSE-XM(NL), IR-encoder(IR)) pairs with symmetric InfoNCE + 0.3·MSE for 30 epochs. The head projects the query NL into the same IR-encoder subspace the registry IR vectors occupy.

| combo | dim | top1 |
|---|---|---|
| LB only | 768 | 0.825 |
| LB + IR (LB fallback) | 1536 | 0.760 |
| **LB + IR (NL2IR head)** | **1536** | **0.830** |

**Final wins:** top1 +30 %, top3 +13 %, top5 +9 %, encode latency −47 %, e2e latency −53 % — accuracy and speed improved simultaneously by *removing* the noisy channel.

## Multilingual transfer (Step 8 bonus, ko/ja)

The training pipeline only ever saw English paraphrases (gemini-2.5-flash output). But because the encoder is LaBSE (109-language SBERT), cross-lingual transfer is expected. Tested on 30 held-out queries translated to Korean and Japanese:

| lang | top1 strict | top1 semantic | top5 strict |
|---|---|---|---|
| en | 0.800 | 0.900 | 0.867 |
| ko | 0.633 | 0.733 | 0.833 |
| ja | 0.600 | 0.733 | 0.900 |

`random = 1/1243 ≈ 0.08 %`, so ~60 % top1 in untrained languages is a strong transfer signal. The −17 to −20 pp gap vs English comes from translation ambiguity (e.g. "k / 2 비트wise" matches both `k_shr_1` and `k_shr_2` equally) plus the fact that the InfoNCE/MSE losses had no Korean or Japanese signal during training. Saved as `cid_dataset/multilingual_eval_report.json`.

## Lessons

1. **Always ablate channels before concatenating them.** "More information" can subtract net accuracy when individual channels are misaligned.
2. **Cross-modal alignment must be honored on both sides.** A registry built with encoder A and queried with encoder B in the same slot only works if A and B map to the same metric space — otherwise the channel is noise.
3. **Distribution-aware paraphrase quality matters.** Step 7 generated IR-aware phrases ("LLVM ashr 7", "signed >> 7") that were *too precise* — they drifted the training distribution away from how downstream queries actually phrase things.
4. **Cost-aware routing helps only when the cosine signal is strong enough.** λ_cost=1.0 (default) destroyed accuracy because cheap variants won despite distant semantics; λ_cost=0.1 lets cosine dominate while still preferring cheaper algos on ties.

## Artifacts (commit `936f635` / `8fad069`)

- `cid_dataset/labse_xm/` — fine-tuned LaBSE (1.8 GB model gitignored, regen via `finetune_labse_xmodal_ir.py`)
- `cid_dataset/labse_xm/ir_encoder.pt` — IR opcode Transformer (4 MB, in git)
- `cid_dataset/nl2ir_head.pt` — Step 8 projection head (6 MB, in git)
- `cid_dataset/nl_embeddings.npz` — 1536-D LB+IR hybrid registry
- `bench_routing.py`, `ablation_channels.py`, `ablation_with_nl2ir.py` — reproducible eval

## Related

- [[os-for-agent]] — host project
- [[f-core]] — consumer NeuralOS
- [[labse-embedding-similarity]], [[infonce-contrastive]], [[nl2ir-projection-head]], [[negative-result]]
