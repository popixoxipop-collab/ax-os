# Log

> Append-only chronological event stream. 각 엔트리 prefix: `## [YYYY-MM-DD HH:MM] <op> | <subject>`
>
> 빠른 조회: `grep "^## \[" log.md | tail -10`

## [2026-05-18 14:30] init | vault created

- Vault 초기화. `~/knowledge-vault/` 디렉토리 구조 생성.
- Schema (`CLAUDE.md`) 정립 — Karpathy LLM-wiki 패턴 + 수학적 정의.
- 슬래시 커맨드 3종 등록: `/vault-ingest`, `/vault-query`, `/vault-lint`.
- 그래프 도구는 `/graphify` 위임.
