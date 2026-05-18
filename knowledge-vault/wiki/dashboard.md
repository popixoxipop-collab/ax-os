---
type: meta
created: 2026-05-18
updated: 2026-05-18
---

# Dashboard

Dataview 기반 동적 뷰. index.md가 정적 카탈로그라면 이건 frontmatter 쿼리 결과.

## 페이지 통계

```dataview
TABLE length(rows) AS "count"
FROM "entities" OR "concepts" OR "sources" OR "queries"
GROUP BY type
```

## 최근 ingest된 sources

```dataview
TABLE
  date_of_session AS "session date",
  project AS "project",
  file.mtime AS "ingested"
FROM "sources"
SORT file.mtime DESC
```

## 모든 entity (태그별)

```dataview
LIST
FROM "entities"
SORT file.name ASC
```

## 모든 concept (태그별 grouping)

```dataview
TABLE tags
FROM "concepts"
SORT file.name ASC
```

## Query history (file-back된 질의)

```dataview
TABLE question, cites, created
FROM "queries"
SORT created DESC
```

---

## 사용 가이드

- 위 코드 블록은 ` ```dataview` 로 시작 — Dataview 플러그인 활성화 후 자동 렌더링
- frontmatter에 `tags`, `type`, `date_of_session` 등을 채우면 추가 쿼리 가능
- 새 페이지가 들어와도 **이 파일을 수정할 필요 없음** — 쿼리가 매번 vault 전체 스캔
