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
