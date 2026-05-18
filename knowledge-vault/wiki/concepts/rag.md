---
type: concept
created: 2026-05-18
updated: 2026-05-18
tags: [llm, retrieval, methodology]
---

# RAG (Retrieval-Augmented Generation)

질의 시점에 raw 문서 집합에서 관련 chunk를 검색·임베딩 매칭으로 가져와 LLM 프롬프트에 주입하는 표준 패턴. NotebookLM, ChatGPT file upload, 대부분의 "AI 문서 챗봇"이 이 구조.

## 핵심 한계 ([[karpathy-llm-wiki-gist]] 관점)

> "The LLM is rediscovering knowledge from scratch on every question. There's no accumulation."

- 매 질의마다 raw에서 처음부터 fragment 모으기 — **bookkeeping 비용이 사용자에게 전가**되거나, 아예 일어나지 않음
- Cross-reference / synthesis는 채팅 히스토리에 휘발
- 5문서 종합 질의가 매번 처음부터

## [[llm-wiki-pattern]]과의 대조

[[llm-wiki-pattern]] 페이지의 표 참조.

## 그래도 RAG가 유효한 경우

- 문서 규모 매우 큼 (수만+ 페이지)
- 질의 빈도 낮음 (vault 유지보수 비용 정당화 어려움)
- 도메인이 빠르게 변함 (wiki가 stale 되기 쉬움)

## 관련 도구

- 벡터 DB (Pinecone, Weaviate, chroma)
- LangChain / LlamaIndex
- OpenAI Assistants API의 file_search
