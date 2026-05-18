---
type: concept
created: 2026-05-18
updated: 2026-05-18
tags: [f-core, generative-model, p91, p95]
---

# Onion-Peeling Generation (양파 껍질 생성)

[[f-core]] P91~P95 chain의 생성 전략. **한 번에 12층 변환은 실패**(P90), **1층씩 양파 껍질 박리하듯 학습하면 완벽 복원**(P91)이라는 발견에서 파생.

## P-시리즈 진행

```
P90-C  GPT-2 deep layer decode (12층 직접)  →  FAIL (recall 0.00)
P91    L0 mirror 단일 레이어                →  PASS ★★★ (recall 1.00)
P92    12쌍 mirror sandwich                 →  FAIL (recall 0.25, 오류 누적)
P93    양방향 cascade                       →  CRASH
P94    N차원 동시 역전                      →  PARTIAL (recall 0.625, 1/30 params)
P95    Oracle-guided selective correction   →  PASS ★★★★★ (recall 0.856)
```

## P91 단일 레이어 mirror (실질 PASS)

- **Token Recall: 1.0000** (8문장 80토큰 완전 복원)
- Mirror: 14.17M params MLP, $768 \to 3072 \to 3072 \to 768$ + residual gate
- LaBSE L0 residual cosine: 0.665 (의미 있는 변환)
- Train/test recall 동일 1.00, cosine gap +0.06 → 일반화 OK

## P92 12쌍 sandwich 실패 분석

- Phase A: 12개 mirror 독립 학습 — avg cos 0.938
- Phase B: 전체 체인 recall=0.2500 ❌
- **근본 원인 3개**:
  1. L11 병목 (residual 0.302)
  2. 오류 누적 (12층 곱)
  3. 데이터 부족 (40문장/170M params)
- 흥미: 오류가 **의미적**(rain→river, baker→chef) — 무작위 아님

## P94 N차원 동시 역전

- 사용자 통찰: N차원에서는 순차가 아니라 N방향 동시 역전
- **5.5M params** (P92의 1/30), test recall 0.625 (P92의 2.5×)
- CID steering 첫 성공: Fire→Ice (α=10) ★

## P95 Oracle-guided correction (PASS)

[[density-gap]] 기반 oracle이 차원별 reversibility 판정:

- Oracle: 768D 중 easy=568, medium=198, **hard=2**
- 가역 차원 skip + 비가역 차원만 correction → **파라미터 극소화**
- Gate 자기조직화: enc 10.3%, dec 2.2% → **97.8% identity pass-through**
- 7.0M params, recall=0.856 (PASS), overfit=0.144

## 해석: Grover 원리

> "Attention ≈ soft Grover (query-key = oracle, value × weight = amplification)"

KDE density_gap = oracle (비가역적 차원 마킹) → 비가역 차원만 amplify.

## 관련

- [[v-trans]] — 양파 껍질이 V_trans 궤적을 layer-wise 재구성
- [[density-gap]] — P95 oracle의 정량 기준
- [[f-core]] Phase 7 typed_ir에 통합 예정

## 출처

- [[fcore-session-p90c-p99]]
