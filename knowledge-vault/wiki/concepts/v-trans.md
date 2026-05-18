---
type: concept
created: 2026-05-18
updated: 2026-05-18
tags: [f-core, cognitive-trajectory, embedding]
---

# V_trans

[[f-core]]의 **cognitive trajectory** 표현. 추론 과정에서 의미 임베딩 공간을 따라 움직이는 벡터 시퀀스. CID(Concept ID) 간 이동을 벡터장으로 본 것.

## 정의 (대략)

추론 단계 $i$에서의 hidden state $h_i$에 대해

$$
\vec{v}_i = h_{i+1} - h_i \quad \in \mathbb{R}^d
$$

또는 [[f-core]] Phase 7 typed_ir 구현 기준 P54 `rich_vtrans` 모듈의 출력. P48 `TransitionNWKernel`이 transition 모델링.

## 주요 활용

| 실험 | 용도 | 결과 |
|---|---|---|
| P54 | rich_vtrans 모듈 | 구현 |
| P97 | NS 시뮬레이션 레짐 예측 | Re=100 dir_cos=0.650 ✅, turbulent 실패 |
| **P110** [[causality-threshold]] | C(t) 감쇠율 M으로 환각 차단 | F1=0.92 (환각 탐지) |

## 핵심 발견 (P110)

V_trans 궤적의 **자기상관 함수 $C(t)$의 감쇠율 $M$**:

- **정상 추론** (인접 CID): $M = 0.036$ — 방향 일관, 느린 감쇠
- **환각** (랜덤 점프): $M = 0.137$ — 방향 급변, 빠른 감쇠
- **물리적 해석**: 코히어런트 추론 = 벡터장 상관 장기 유지 = 낮은 $M$
- 이는 P109 가설(M↑일수록 coherent)의 **부분 반증**

## 관련

- [[causality-threshold]] — M의 임계값 게이팅
- [[onion-peeling-generation]] — V_trans 궤적을 layer-wise reconstruct
- [[f-core]]
