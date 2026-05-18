# LLM Wiki

A pattern for building personal knowledge bases using LLMs.

This is an idea file, it is designed to be copy pasted to your own LLM Agent (e.g. OpenAI Codex, Claude Code, OpenCode / Pi, or etc.). Its goal is to communicate the high level idea, but your agent will build out the specifics in collaboration with you.

## The core idea

Most people's experience with LLMs and documents looks like RAG: you upload a collection of files, the LLM retrieves relevant chunks at query time, and generates an answer. This works, but the LLM is rediscovering knowledge from scratch on every question. There's no accumulation. Ask a subtle question that requires synthesizing five documents, and the LLM has to find and piece together the relevant fragments every time. Nothing is built up. NotebookLM, ChatGPT file uploads, and most RAG systems work this way.

The idea here is different. Instead of just retrieving from raw documents at query time, the LLM **incrementally builds and maintains a persistent wiki** — a structured, interlinked collection of markdown files that sits between you and the raw sources. When you add a new source, the LLM doesn't just index it for later retrieval. It reads it, extracts the key information, and integrates it into the existing wiki — updating entity pages, revising topic summaries, noting where new data contradicts old claims, strengthening or challenging the evolving synthesis. The knowledge is compiled once and then *kept current*, not re-derived on every query.

This is the key difference: **the wiki is a persistent, compounding artifact.** The cross-references are already there. The contradictions have already been flagged. The synthesis already reflects everything you've read. The wiki keeps getting richer with every source you add and every question you ask.

You never (or rarely) write the wiki yourself — the LLM writes and maintains all of it. You're in charge of sourcing, exploration, and asking the right questions. The LLM does all the grunt work — the summarizing, cross-referencing, filing, and bookkeeping that makes a knowledge base actually useful over time. In practice, I have the LLM agent open on one side and Obsidian open on the other. The LLM makes edits based on our conversation, and I browse the results in real time — following links, checking the graph view, reading the updated pages. Obsidian is the IDE; the LLM is the programmer; the wiki is the codebase.

This can apply to a lot of different contexts. A few examples:

- **Personal**: tracking your own goals, health, psychology, self-improvement.
- **Research**: going deep on a topic over weeks or months.
- **Reading a book**: filing each chapter as you go.
- **Business/team**: an internal wiki maintained by LLMs.
- **Competitive analysis, due diligence, trip planning, course notes, hobby deep-dives**.

## Architecture

Three layers:

- **Raw sources** — your curated collection of source documents. Immutable.
- **The wiki** — a directory of LLM-generated markdown files. Owned by the LLM.
- **The schema** — a document (CLAUDE.md or AGENTS.md) that tells the LLM how the wiki is structured.

## Operations

- **Ingest** — drop a new source, LLM reads + updates 10-15 wiki pages + index + log.
- **Query** — search wiki, synthesize answer with citations, optionally file-back as a new page.
- **Lint** — health-check for contradictions, stale claims, orphans, missing cross-references.

## Indexing and logging

- **index.md** — content-oriented catalog. Every page listed with a one-line summary.
- **log.md** — chronological append-only event stream. Parseable with `grep "^## \[" log.md`.

## Optional: CLI tools

[qmd](https://github.com/tobi/qmd) — local BM25 + vector search over markdown files, with LLM rerank. Both CLI and MCP server.

## Tips

- Obsidian Web Clipper for web articles
- Download images locally (Obsidian hotkey)
- Obsidian graph view to see shape
- Marp for slide decks
- Dataview for frontmatter queries
- Git for version history

## Why this works

The tedious part of maintaining a knowledge base is not the reading or the thinking — it's the bookkeeping. LLMs don't get bored. The human curates sources and asks questions. The LLM does everything else.

Related in spirit to Vannevar Bush's Memex (1945) — but Bush couldn't solve who does the maintenance. The LLM handles that.

---

Source: <https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>
Author: Andrej Karpathy
Date fetched: 2026-05-18
