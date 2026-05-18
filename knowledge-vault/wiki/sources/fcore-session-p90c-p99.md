---
type: source
created: 2026-05-18
updated: 2026-05-18
raw_path: raw/fcore-2026-03-28-p90c-p99-onion.md
date_of_session: 2026-03-28
project: [[f-core]]
tags: [p90c, p91, p92, p94, p95, p97, p98, p99, p111, onion, oracle, ns, yang-mills]
---

# F-CORE Session 12 — P90-C through P99 + Yang-Mills

대형 세션 (2026-03-28). [[f-core]] P-시리즈 다수 실험 + Yang-Mills mass gap 프로그램 부분.

## Key takeaways (실험별)

| P | 주제 | 결과 | wikilink |
|---|---|---|---|
| P90-C | GPT-2 12층 직접 decode | FAIL (recall 0) | (failure baseline) |
| **P91** | L0 mirror 단일 레이어 | **PASS ★★★ (recall 1.0)** | [[onion-peeling-generation]] |
| P92 | 12쌍 sandwich | FAIL (recall 0.25), 오류 누적 | [[onion-peeling-generation]] |
| P94 | N차원 동시 역전 | PARTIAL (recall 0.625, 1/30 params) | [[onion-peeling-generation]] |
| **P95** | Oracle-guided selective | **PASS ★★★★★ (recall 0.856)** | [[onion-peeling-generation]] + [[density-gap]] |
| P97 | NS V_trans 시뮬레이션 | PARTIAL (Re=100 OK, turbulent 실패) | [[v-trans]] |
| P98 | NS Regularity Assault | PASS (수치적, 증명 아님) | [[density-gap]] |
| P99 | NS R₁ bounded | 핵심 발견: $R_1 = |S|/(\Omega \log\Omega)$ Re 따라 감소 | (lint future) |
| P111 | SU(2) L=8 mass gap | r=-0.77 ★★★★★ | [[density-gap]] |

## Cited entities

- [[f-core]]

## Cited concepts

- [[v-trans]] — P97 시뮬레이션
- [[onion-peeling-generation]] — P91-P95 chain 핵심
- [[density-gap]] — P95 oracle + P97-P99 NS + Yang-Mills

## 통찰 모음

- **점진적 학습 우월**: P90 직접 12층(FAIL) → P91 1층씩(PASS)
- **오류의 의미성**: P92 오류가 무작위 아닌 의미적 이웃 (rain→river)
- **Grover 원리**: Attention ≈ soft Grover, density_gap = oracle
- **NS 자기조절 루프**: $S>D \to \Omega\uparrow \to$ cascade $\to \Omega_2/\Omega \uparrow \to D \uparrow \to D>S \to \Omega\downarrow$
- **4D는 gap이 태어나는 차원**: 사라지는 차원이 아님

## 다음 (세션 종료 시점)

- P112 L=12 mass gap (r 추세 확인)
- P113 r=-0.77 해석적 설명
- 논문 초안
- F-CORE Phase 7에 P95 decoder 편입
- NS: $\Omega_2/\Omega$ 동적 하한 (Poincaré보다 강한) 해석적 도출

## Provenance

- Raw: `raw/fcore-2026-03-28-p90c-p99-onion.md`
- Original: `~/Desktop/F-CORE/history/2026-03-28_fcore-p90c-p91-p92-onion.md`
- Date: 2026-03-28
