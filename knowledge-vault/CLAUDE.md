# Knowledge Vault — Schema (수학적 뼈대)

> 이 파일은 Karpathy LLM-wiki 패턴의 **schema layer**다. LLM은 vault에 작업을 가하기 전에 이 파일을 먼저 읽고, 아래 정의·연산·불변식을 준수해야 한다.

원조: <https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>

---

## 1. 정의 (Definitions)

### 1.1 Vault

$$
\mathcal{V} \;=\; (R, \, W, \, \Sigma, \, L)
$$

- $R$ — **raw store**. immutable. 사용자가 수집한 원본 자료.
- $W$ — **wiki**. mutable. LLM이 작성·유지하는 마크다운 그래프.
- $\Sigma$ — **schema** (이 파일). LLM이 따라야 할 규칙.
- $L$ — **log**. append-only 시간순 이벤트 스트림 (`wiki/log.md`).

### 1.2 Wiki as labeled directed graph

$$
W \;=\; (P, \, E, \, \lambda, \, \tau)
$$

- $P$ — pages (마크다운 파일 집합)
- $E \subseteq P \times P$ — wikilinks $[[\text{target}]]$ 로 표현되는 유향 간선
- $\lambda: P \to \mathsf{Type}$ — 페이지 타입 라벨링
- $\tau: P \to \mathbb{T}$ — 생성/수정 타임스탬프

### 1.3 페이지 타입 $\mathsf{Type}$

| 타입 | 위치 | 의미 |
|---|---|---|
| `entity` | `wiki/entities/` | 사람·장소·프로젝트·제품 등 고유 명사 |
| `concept` | `wiki/concepts/` | 추상 개념·이론·패턴 |
| `source` | `wiki/sources/` | $R$의 원본 1개에 대응하는 요약 페이지 |
| `query` | `wiki/queries/` | 사용자 질의의 file-back 결과 |
| `meta` | `wiki/{index,log}.md` | 인덱스·로그 |

### 1.4 특수 파일

- `wiki/index.md` — **content-oriented catalog**. $I: P \to (\text{one-line summary}, \, \lambda(p))$의 materialization. 모든 페이지가 여기에 1줄로 등재되어야 함.
- `wiki/log.md` — **chronological event stream**. append-only. 각 엔트리 prefix: `## [YYYY-MM-DD HH:MM] <op> | <subject>`

---

## 2. 연산 (Operations)

### 2.1 Ingest

$$
\delta : \mathsf{Source} \times W_t \;\to\; W_{t+1}
$$

신규 원본 $r \in R$이 도착하면 LLM은:

1. $r$을 읽고 핵심 요지 추출
2. 새 source page $p_r$ 생성 ($\lambda(p_r) = \texttt{source}$)
3. $r$이 언급하는 엔티티·개념 집합 $\{p_i\}$ 갱신
   - 기존에 있으면 in-place update + `[[p_r]]` backlink 추가
   - 없으면 신규 entity/concept page 생성
4. $I$ 갱신 (`wiki/index.md`에 신규 페이지 등록)
5. $L$에 엔트리 append: `## [t] ingest | <source-title>`

**불변식**:
- 단조성 (monotonicity): $|P_{t+1}| \geq |P_t|$. ingest는 페이지를 지우지 않는다.
- 출처 추적: $\lambda(p) = \texttt{source}$인 모든 페이지는 $R$ 내 원본 경로를 frontmatter에 기록.

### 2.2 Query

$$
q : \mathsf{Question} \times W \;\to\; \mathsf{Answer} \times \mathcal{P}(P) \;\to^?\; W'
$$

질의 $Q$가 들어오면:

1. `wiki/index.md` 먼저 읽고 후보 페이지 집합 $C \subseteq P$ 선정
2. $C$ 페이지들 본문 읽고 답 $A$ 합성
3. 인용 $\mathsf{cite}(A) \subseteq C$ 명시
4. (선택) file-back: $A$를 `wiki/queries/<slug>.md`로 영구화 → $W' = W \cup \{p_A\}$

**규칙**:
- 답변은 항상 인용 동반. 인용 없는 주장 금지.
- file-back 여부는 사용자가 결정. 가치 있다고 판단되면 영구화.

### 2.3 Lint

$$
\ell : W \;\to\; \mathsf{Diagnostics} \times W'
$$

불변식 위반을 탐지하고 가능하면 복구:

| 진단 | 조건 |
|---|---|
| **dangling wikilink** | $[[p_t]] \in p_s$ but $p_t \notin P$ |
| **orphan page** | $\deg^{-}(p) = 0 \land \lambda(p) \neq \texttt{meta}$ (인바운드 0) |
| **index drift** | $p \in P \land p \notin I$ |
| **missing concept** | $p_s$ 본문에 자주 등장하지만 대응 페이지 없음 |
| **stale claim** | $\tau(p)$가 오래되고, 더 새로운 $p'$가 모순되는 주장 |
| **contradiction** | $p_a, p_b \in P$ 사이 의미 충돌 |
| **broken provenance** | source page가 $R$ 내 원본을 못 찾음 |

### 2.4 Graph (외부 위임)

$$
\gamma : W \;\to\; \mathsf{GraphEmbedding}
$$

`/graphify ~/knowledge-vault/wiki/` — 별도 스킬 사용. community detection 결과는 새 concept page 후보로 환원 가능.

---

## 3. 워크플로

```
            ┌──────────────┐
  raw/r ──→ │  /vault-ingest │ ──→ W_{t+1}
            └──────────────┘
                    │
                    ▼
            ┌──────────────┐
   Q ────→ │  /vault-query  │ ──→ A, (file-back?)
            └──────────────┘
                    │
                    ▼
            ┌──────────────┐
            │  /vault-lint  │ ──→ Diagnostics, W'
            └──────────────┘
                    │
                    ▼
            ┌──────────────┐
            │   /graphify   │ ──→ γ(W) (communities, surprise edges)
            └──────────────┘
```

---

## 4. 페이지 컨벤션

### 4.1 Frontmatter (모든 페이지 필수)

```yaml
---
type: entity | concept | source | query
created: 2026-05-18
updated: 2026-05-18
tags: [tag1, tag2]
# source 타입은 추가로:
raw_path: raw/foo.pdf
# query 타입은 추가로:
question: "..."
cites: [[page-a]], [[page-b]]
---
```

### 4.2 본문 구조

- 첫 줄: `# <Title>` (파일명과 동일)
- 두 번째 줄: one-line summary (이 줄이 `index.md`에 그대로 복사됨)
- 본문은 자유 마크다운, $[[\text{wikilink}]]$로 다른 페이지 연결

### 4.3 명명 규칙

- 파일명: kebab-case, ascii (예: `bayesian-inference.md`, `andrej-karpathy.md`)
- 한글 페이지명도 허용하지만 wikilink는 normalization 필요

---

## 5. Vault 운영 원칙

1. **사람은 source 큐레이션, LLM은 bookkeeping** — 사용자는 raw/에만 손대고 wiki/는 LLM 영역.
2. **index.md는 매 ingest에 갱신** — drift 발생 시 lint가 잡지만 ingest 단계에서 막는 게 정석.
3. **log.md는 append-only** — 과거 엔트리 수정 금지. 정정은 새 엔트리로.
4. **인용 없는 주장 금지** — query 답변은 항상 $\mathsf{cite}(A) \subseteq P$ 명시.
5. **git** — vault는 단순 git 저장소. ingest/query/lint마다 커밋 권장.

---

## 6. 관련 도구

- **Obsidian** — `~/knowledge-vault/` 를 vault로 열어 GUI로 탐색. 그래프뷰, Web Clipper, Dataview.
- **graphify** — `/graphify wiki/` 로 community detection.
- **git** — `cd ~/knowledge-vault && git init && git add . && git commit`

---

## 7. 슬래시 커맨드

- `/vault-ingest <path>` — $\delta$ 실행
- `/vault-query <question>` — $q$ 실행 (file-back 옵션)
- `/vault-lint` — $\ell$ 실행
- `/graphify wiki/` — $\gamma$ 실행 (외부)
