---
type: source
created: 2026-05-18
updated: 2026-05-18
raw_path: raw/karpathy-llm-wiki.md
source_url: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
author: [[andrej-karpathy]]
tags: [llm, knowledge-base, obsidian, methodology]
---

# Karpathy LLM-Wiki Gist

Andrej Karpathy의 LLM-기반 개인 지식베이스 패턴 원조 문서 — 이 vault의 schema가 기반하는 idea file.

## Key takeaways

- **RAG와의 차별점**: RAG는 매 질의마다 raw에서 재발견. LLM-wiki는 ingest 시점에 한 번 compile, 이후 *현재성 유지*.
- **3 레이어**: raw / wiki / [[schema-as-claude-md]] (CLAUDE.md 또는 AGENTS.md)
- **3 연산**: [[ingest-operation]] / [[query-operation]] / [[lint-operation]]
- **2 특수 파일**: `index.md` (catalog), `log.md` (chronological, grep-friendly prefix)
- **추천 도구**: [[qmd-search]], [[obsidian]], [[marp]], [[dataview]]
- **철학적 선조**: [[memex]] (Vannevar Bush, 1945) — Bush가 풀지 못한 "누가 유지보수하나"를 LLM이 해결

## Cited entities

- [[andrej-karpathy]]
- [[vannevar-bush]]
- [[obsidian]]
- [[tobi-luetke]] (qmd 저자)

## Cited concepts

- [[llm-wiki-pattern]] — 이 문서가 정의하는 패턴 그 자체
- [[rag]] — 대조 대상
- [[memex]] — 1945년 비전적 선조
- [[incremental-knowledge-compilation]]
- [[markdown-as-knowledge-substrate]]

## Quote (핵심)

> The tedious part of maintaining a knowledge base is not the reading or the thinking — it's the bookkeeping.
> LLMs don't get bored. The human curates sources and asks questions. The LLM does everything else.

## Provenance

- Author: [[andrej-karpathy]]
- URL: <https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>
- Fetched: 2026-05-18 (이 vault 초기 부트스트랩)
