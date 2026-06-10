---
name: postbackprop-competition-rules
description: The Post-Backprop Challenge 대회 핵심 제약사항 — 위반 시 즉시 실격
metadata: 
  node_type: memory
  type: project
  originSessionId: c429a42d-b18d-44ce-b8ef-bea2e7eff63e
---

# The Post-Backprop Challenge — 절대 제약사항

**대회 URL:** https://www.kaggle.com/competitions/the-post-backprop-challenge-zero-gradient-learning-for-efficiency
**마감:** 약 1개월 남음 (2026-06-11 기준)
**상금:** $10,000 (조건 미달 시 무상금 — Community Kudos만)

---

## PASS/FAIL 조건 (위반 = 즉시 실격)

### ① Zero Existing Optimizers
- `torch.autograd` 전역 사용 **금지**
- `loss.backward()` 전역 사용 **금지**
- `jax.grad` **금지**
- `torch.optim.Adam`, `torch.optim.SGD` 등 표준 옵티마이저 **금지**
- raw tensor로 직접 global chain rule 계산도 **금지** (여전히 backprop으로 간주)
- **핵심 룰:** layer l의 weight 업데이트는 layer l+1에서 전파된 error signal에 의존해서는 안 됨

### ② Zero Pretrained Weights
- 검증 가능한 random seed로 초기화 필수
- `from_pretrained()` **금지**
- distillation, teacher forcing **금지**
- 사전학습 체크포인트 다운로드 **금지**

### ③ Hardware Constraints
- Kaggle 표준 T4 단일 GPU
- 전체 pretraining + fine-tuning 3시간 이내 완료
- 메모리 사용량 50% 이상 감소 (vs AdamW baseline)

### ④ Model Requirements
- **4B+ trainable parameters** (파라미터 수 검증 필수)
- **Conversational LM** — "not just next-word prediction on a raw text corpus"
- Token-level (char-level 불가)

### ⑤ Benchmark Thresholds (현실적으로 달성 어려움)
| 지표 | 요건 | 현실 예상 (20M 토큰) |
|------|------|---------------------|
| WikiText-103 PPL | < 20 | ~300-800 |
| HellaSwag | > 55% | ~26-30% |
| PIQA | > 65% | ~53-58% |
| MT-Bench | > 5.0 | ~1-2 |

**→ 상금 달성 거의 불가능. 목표: best valid attempt (Community Kudos + 연구 기여)**

---

## 우리 아키텍처 결정 (2026-06-11)

- **방식:** BLL (Block Local Learning) — detach()로 블록 경계 분리, 블록 내 local autograd 허용
- **데이터:** FineWeb-Edu (품질 최고, 동일 토큰 대비 PPL -23% vs RedPajama)
- **모델:** Dense 4B (d_model=3072, n_heads=24, n_layers=36, FFN_mult=4, vocab=32K BPE)
- **MoE 기각:** BLL 환경에서 router 전문화 미검증, 붕괴 리스크
- **메모리 감소:** AdamW 이론치 ~50GB vs BLL ~11GB = 78% 감소 ✅

---

## BLL 규정 준수 논리

```python
# Block 1: layers 0-8, local loss
loss_1 = CE(local_head_1(h_8), next_token)
loss_1.backward()  # autograd는 block 내부만 — global chain rule 아님 ✅
update(layers_0_to_8)

# Block 2: detach → layers 9-17
h_8_detached = h_8.detach()  # layer 9의 업데이트가 layer 10+ 오류에 의존 안 함 ✅
loss_2 = CE(local_head_2(h_17), next_token)
```

**Why:** `detach()`가 block 경계에서 gradient flow를 차단 → layer l의 update가 layer l+1 error에 의존하지 않음.

---

## 현재 구현 상태 (`~/Desktop/postbackprop/`)

- `model/architecture.py` — GPT4B 4.17B, SwiGLU, RoPE ✅
- `optimizer/bll.py` — BLLOptimizer, CPUOffloadAdamState (FP32) ✅  
- `optimizer/bll_nf4.py` — NF4 quantized BLL, embed/lm_head 제외 버그 수정 ✅
- `scripts/proxy_convergence.py` — 수렴 검증 완료 (+60% vs random) ✅
- **미완:** token-level tokenizer, FineWeb-Edu pipeline, 대화형 fine-tuning, lm-eval

**Why:** 2026-06-11 규정 확인 후 char-level → token-level 전환 결정

**How to apply:** postbackprop 작업 시 항상 이 파일 먼저 확인. 특히 optimizer 코드 작성 전.
