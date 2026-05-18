---
type: concept
created: 2026-05-18
updated: 2026-05-18
tags: [f-core, hallucination, gating, p110]
---

# Causality Threshold (P110)

[[f-core]] P110 실험에서 정립된 환각 게이팅 메커니즘. [[v-trans]] 궤적의 자기상관 함수 $C(t)$의 감쇠율 $M$이 임계값을 넘으면 추론 차단.

## 정의

V_trans 궤적의 시간 자기상관

$$
C(t) = \mathbb{E}[\vec{v}_i \cdot \vec{v}_{i+t}] / \mathbb{E}[\|\vec{v}_i\|^2]
$$

가 지수 감쇠한다고 모델링:

$$
C(t) \approx e^{-M t}
$$

여기서 $M$이 **causality threshold 측정량**. $M$ 작을수록 코히어런트.

## 정량 결과

| 궤적 유형 | $M$ | 해석 |
|---|---|---|
| 정상 (인접 CID 따라 이동) | 0.036 | 방향 일관 |
| 환각 (랜덤 CID 점프) | 0.137 | 방향 급변 |

**Gate**: $M < M_\text{th} = 0.06$ ⇒ 추론 승인, else BLOCK

- 정상: 95.5% PASS
- 환각: 87.7% BLOCK

## 도메인별 성능

| 실험 | Metric | Value | 판정 |
|---|---|---|---|
| A. COPA Causality | AUC | 0.51 | 실패 (p=0.51) — 정답/오답 모두 합리적 |
| B. Hallucination | F1 | **0.92** (optimal 0.94) | 강력 분리 (p=3e-35) |
| C. WikiSection | F1 | 0.66 | 유의미하나 미약 (p=7.6e-8) |

## 의의

- **물리 아날로그**: [[onion-peeling-generation]]·NS 시뮬레이션과 같은 "벡터장 상관" 원리 — 의미 공간과 물리 공간이 같은 게이팅 원리 공유
- **환각 차단**: 모델 출력 전 단계에서 V_trans만으로 차단 가능 (추론 결과 검사 없이)
- **P109 가설 부분 반증**: M↑이 coherent가 아니라 그 반대

## 구현

- `~/Desktop/F-CORE/planets/core/typed_ir/causality_threshold.py`
- 결과: `logs/p110_causality_result.json`, `logs/p110_causality.png`
- 재사용 모듈: P48 [[v-trans]] kernel, P54 rich_vtrans, P34 pipeline, P37 gravity

## 출처

- [[fcore-session-p110-causality]]
