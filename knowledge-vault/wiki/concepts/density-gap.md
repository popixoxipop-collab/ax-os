---
type: concept
created: 2026-05-18
updated: 2026-05-18
tags: [f-core, kde, oracle, transversal-concept]
---

# Density Gap

[[f-core]] 횡단(transversal) 개념. KDE(Kernel Density Estimation)로 측정한 클래스 간 밀도 간극. 여러 영역에서 **oracle / order parameter** 역할.

## 정의 (대략)

분류 공간에서 top-1과 top-2 클래스의 KDE 밀도 차이:

$$
\text{density\_gap}(x) = \rho_{(1)}(x) - \rho_{(2)}(x)
$$

여기서 $\rho_{(k)}$는 $k$번째 최빈 클래스의 KDE 밀도. 클수록 분류 자신감 높음.

## 다양한 등장

### F-CORE 핵심 (P-시리즈)

- **P95 [[onion-peeling-generation]]**: oracle로 사용 — 차원별 reversibility 판정 → easy=568, medium=198, hard=2
- **P97 NS regime classification**: KDE 분류 정확도 DR=0.8465, density_gap=16.12
- **P99 [[v-trans]] V_trans 검증**: NS regularity 시뮬레이션에서 hard 차원 bounded

### Yang-Mills mass gap 프로그램 (P96~P111)

[[f-core]]의 millennium 응용. density_gap을 **order parameter**로 사용해 SU(2) 상전이 탐지.

- **Scaling law**: gap$(D) = 0.292 \times D^{0.796}$ ($R^2 = 0.968$)
- **Additive 분해**: $\alpha = \alpha_C + \alpha_F - \beta = 0.790$ (관측 0.796과 0.8% 일치)
- **L=8 SU(2)**: density_gap ↔ mass_gap **상관 r=-0.77** (L=4의 r=-0.206에서 크게 개선)
- **L→∞ 생존**: P104에서 N→∞ gap=10.2>0, bootstrap CI>>[0]
- **4D**: gap이 사라지는 차원이 아니라 **태어나는 차원** (P-시리즈 새 관찰)

### Millennium 적용 (Hodge → F-CORE 이전)

| 도구 | 출처 | 적용 |
|---|---|---|
| Density confidence | NS p150 | top1-top2 gap으로 오분류 100% 탐지 |
| Poly KDE+KDTree | Hodge p104 | 8.7× speedup, sklearn 제거 |

## 본 vault에서의 위치

[[f-core]]의 가장 빈번히 재등장하는 개념 중 하나. P-시리즈 거의 모든 분기에서 등장.

## 미등재 후속 (lint dangling 예상)

- [[yang-mills-mass-gap]] — gap=mass_gap dialogue 전모
- [[ns-regularity]] — P97-P99에서 density_gap 역할
- [[scaling-law-alpha-decomposition]] — α = α_C + α_F - β 정리

## 출처

- [[fcore-session-p90c-p99]] — Yang-Mills program + onion P95
- 미등재: P96-P105 separate sessions
