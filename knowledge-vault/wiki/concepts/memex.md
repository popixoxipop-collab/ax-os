---
type: concept
created: 2026-05-18
updated: 2026-05-18
tags: [computing-history, knowledge-management, philosophy]
---

# Memex

[[vannevar-bush]]가 1945년 *As We May Think*에서 제안한 개인용 지식 저장 장치. 마이크로필름 기반, 소유자가 큐레이션하고 문서 간 "associative trails"를 직접 박아넣는 시스템. 웹·하이퍼링크의 직접적 영감.

## Bush의 비전

- **개인 큐레이션**: 공공 인덱스가 아닌 본인이 모은 자료
- **Associative trails**: 문서 간 사용자가 만든 경로가 문서 자체만큼 가치 있음
- **Private**: 외부 검색엔진에 의존하지 않는 사적 지식 자산

## 웹이 실현하지 못한 것

웹은 Bush의 일부만 실현 (하이퍼링크). 빠진 것:

1. **Personal curation** — 웹은 공공/광고 기반
2. **Maintained trails** — 링크 rot, 누가 trail을 관리?
3. **Synthesis over time** — 단순 링크 ≠ 종합

## LLM-Wiki와의 관계 ([[llm-wiki-pattern]])

[[karpathy-llm-wiki-gist]]가 명시적으로 인용:

> The part [Bush] couldn't solve was who does the maintenance. The LLM handles that.

LLM-wiki는 Memex의 미실현 부분 — **유지보수자의 부재** — 를 LLM으로 대체하여 완성하려는 시도로 위치 지을 수 있다.

## 비교

| 시스템 | Curation | Trails | Maintenance |
|---|---|---|---|
| Memex (1945, 비전) | 사용자 | 사용자 | **미해결** |
| Web (1989) | 분산 | 분산 | rot |
| Wikipedia (2001) | 공공 | 공공 | 자원봉사자 |
| Obsidian + manual (2020s) | 사용자 | 사용자 | 사용자 (burnout) |
| **[[llm-wiki-pattern]] (2026)** | **사용자** | **LLM** | **LLM** |
