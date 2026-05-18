---
type: concept
created: 2026-05-18
updated: 2026-05-18
tags: [methodology, knowledge-management, llm]
---

# LLM-Wiki Pattern

LLM이 raw source를 ingest할 때마다 영구적인 마크다운 wiki를 incremental하게 컴파일·유지하는 패턴. RAG와의 핵심 차이는 **누적**과 **bookkeeping의 자동화**.

## 정식 정의 (이 vault 기준)

본 vault의 [[schema-as-claude-md]] §1에서 수학적으로 명시:

$$
\mathcal{V} = (R, W, \Sigma, L), \quad W = (P, E, \lambda, \tau)
$$

연산 셋:

- $\delta$: $[[ingest-operation]]$ — Source × $W_t$ → $W_{t+1}$
- $q$: $[[query-operation]]$ — Question × $W$ → Answer
- $\ell$: $[[lint-operation]]$ — $W$ → Diagnostics × $W'$

## 핵심 주장 ([[karpathy-llm-wiki-gist]])

1. **The wiki is a persistent, compounding artifact.**
2. Cross-reference / contradiction flag / synthesis가 이미 wiki에 박혀 있어서 매 질의 재계산 불필요.
3. 인간은 source curation + question asking, LLM은 나머지 전부.
4. Obsidian = IDE, LLM = programmer, wiki = codebase.

## [[rag]]와의 대조

| 측면 | RAG | LLM-Wiki |
|---|---|---|
| 누적 | ✗ (매번 raw에서 재발견) | ✓ (compile once) |
| Cross-ref | 질의 시점 추론 | wiki에 미리 박힘 |
| 모순 감지 | 없음 | [[lint-operation]]이 잡음 |
| Synthesis 보존 | 채팅 히스토리에 휘발 | file-back으로 영구화 가능 |

## [[memex]]와의 관계

- 정신적 선조. 같은 비전: 개인 큐레이션 + associative trails.
- 차이: Bush는 "유지보수자 문제"를 못 풀었다. LLM-wiki는 LLM이 그 역할.

## 구현 사례

- 본 vault (`~/knowledge-vault/`)
- 강의 커리큘럼 (Obsidian × Claude Code, 16강)
- OpenHuman (tinyhumansai) — 제품화, 구독 기반
- ΩmegaWiki — 640+★ Claude Code skills 컬렉션 (gist 댓글 언급)

## 적용 도메인

- 개인 (목표, 건강, 자기개선)
- 연구 (논문 deep dive)
- 책 읽기 (Tolkien Gateway-style fan wiki를 1인용으로)
- 비즈니스 / 팀 (Slack/회의록 → 위키)
- 경쟁 분석, due diligence, 여행 계획, 강의 노트, 취미
