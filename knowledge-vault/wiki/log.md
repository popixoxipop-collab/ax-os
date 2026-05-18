# Log

> Append-only chronological event stream. 각 엔트리 prefix: `## [YYYY-MM-DD HH:MM] <op> | <subject>`
>
> 빠른 조회: `grep "^## \[" log.md | tail -10`

## [2026-05-18 14:30] init | vault created

- Vault 초기화. `~/knowledge-vault/` 디렉토리 구조 생성.
- Schema (`CLAUDE.md`) 정립 — Karpathy LLM-wiki 패턴 + 수학적 정의.
- 슬래시 커맨드 3종 등록: `/vault-ingest`, `/vault-query`, `/vault-lint`.
- 그래프 도구는 `/graphify` 위임.

## [2026-05-18 14:55] ingest | Karpathy LLM-Wiki Gist (bootstrap)

- Raw: `raw/karpathy-llm-wiki.md` (Karpathy idea file 자체)
- Source page: `sources/karpathy-llm-wiki-gist.md`
- 신규 entity: `andrej-karpathy`, `vannevar-bush`
- 신규 concept: `llm-wiki-pattern`, `rag`, `memex`
- index.md: 6 entries 추가 (entities 2 + concepts 3 + sources 1)
- 의미: vault 자기 부트스트랩. 패턴을 정의한 문서가 vault의 첫 source.

## [2026-05-18 15:10] query | RAG vs LLM-wiki 차이

- 후보: [[rag]], [[llm-wiki-pattern]], [[karpathy-llm-wiki-gist]]
- 답: 누적 / cross-ref 위치 / bookkeeping 비용 귀속 3축
- file-back: 안 함 (간단 비교)

## [2026-05-18 15:15] lint | initial scan (post-bootstrap)

- D1 dangling: 11 ([[obsidian]], [[marp]], [[dataview]], [[ingest-operation]], 등)
- D2-D7: 0
- 정책: dangling은 future-work 마커로 보존

## [2026-05-18 15:30] ingest | F-CORE Session P110 (Causality Threshold)

- Raw: `raw/fcore-2026-03-29-p110-causality.md`
- Source: `sources/fcore-session-p110-causality.md`
- 신규 entity: `f-core`
- 신규 concept: `v-trans`, `causality-threshold`
- 의미: V_trans 자기상관 감쇠율 M로 환각 사전 차단, F1=0.92.

## [2026-05-18 15:45] ingest | F-CORE Session 12 (P90-C ~ P111)

- Raw: `raw/fcore-2026-03-28-p90c-p99-onion.md`
- Source: `sources/fcore-session-p90c-p99.md`
- 신규 concept: `onion-peeling-generation`, `density-gap`
- 기존 페이지 업데이트: `f-core` (세션 목록), `v-trans` (P97 적용)
- index.md: +7 entries (concepts 4 + sources 2 + entity 1)
- 의미: F-CORE 첫 본격 ingest. P91 onion peel PASS, P95 Oracle, P111 SU(2) r=-0.77.
