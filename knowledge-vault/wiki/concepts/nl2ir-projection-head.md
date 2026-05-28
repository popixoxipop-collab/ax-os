# NL2IR Projection Head

> Small residual MLP that maps a natural-language embedding (LaBSE-XM, 768-D) into the LLVM-IR-opcode encoder subspace (also 768-D). Trained on (NL paraphrase, IR-encoder(IR opcodes)) pairs for an algorithm so that, at query time, the IR channel of a hybrid retrieval registry can be populated with a vector that *actually* lives in the same space as the registry IR vectors.

## Motivation

In [[os-for-agent]] Step 6, the routing registry was a 1920-D concat of TF-IDF (384) + LaBSE-XM(NL) (768) + IR-encoder(IR opcodes) (768). The cross-modal training of Step 5 had aligned LaBSE-XM(NL) with IR-encoder(IR) globally, so the query side filled the IR slot by simply reusing the LaBSE-XM(NL) vector. This was *almost* correct but not quite — registry IR vectors and query "IR" vectors lived in subtly different submanifolds, and the IR channel became net noise (IR-only retrieval scored top1=0.040).

## Definition

$$h_\theta : \mathbb{R}^{768}_\text{NL} \to \mathbb{R}^{768}_\text{IR}$$

Residual MLP:
$$h_\theta(x) = \text{L2}(\text{LayerNorm}(x + W_2 \cdot \text{GELU}(W_1 x)))$$

with $W_1 \in \mathbb{R}^{1024 \times 768}$, $W_2 \in \mathbb{R}^{768 \times 1024}$.

## Training objective

Symmetric InfoNCE with τ=0.05 plus weighted MSE:

$$\mathcal{L} = \mathcal{L}_\text{InfoNCE}(h_\theta(x_\text{NL}), y_\text{IR}) + 0.3 \cdot (1 - \cos(h_\theta(x_\text{NL}), y_\text{IR}))$$

where $x_\text{NL}$ = LaBSE-XM embedding of a paraphrase of algo $a$, and $y_\text{IR}$ = IR-encoder embedding of $a$'s IR opcode trajectories.

## Effect

| query side of IR slot | IR-only top1 | LB+IR top1 |
|---|---|---|
| LaBSE-XM fallback (Step 6) | 0.040 | 0.760 |
| **NL2IR head (Step 8)** | **0.160 (4×)** | **0.830** |

The IR channel goes from net noise to net positive once both sides of the slot live in the same metric space.

## Generalization

This is the standard fix for any retrieval hybrid where the registry side and query side of a channel are computed by different encoders: train a light projection head from the available query-side embedding into the registry-side embedding space.

## See also

- [[infonce-contrastive]]
- [[labse-embedding-similarity]]
- [[os-for-agent-step1-8]]
