# archify Element-Scoped AI Editor — 설계/계획 문서

> Status: DRAFT (사용자 승인 전) · 2026-07-18 · 계획 전용 — 이 문서로는 아무것도 구현하지 않음
> 대상: `/Users/xox/.claude/skills/archify` 스킬 고도화 + 이를 감싸는 인터랙티브 편집 앱

---

## 0. Context & Goal

archify는 JSON spec → self-contained HTML(inline SVG) 다이어그램을 만드는 CLI 스킬이다. 이 계획은 archify를 **요소 단위로 클릭해서 AI에게 "이것만 바꿔줘"라고 시키는 웹 에디터 앱**으로 포장한다: 상단 툴바(선택·그리기·편집·콘텐츠 검증▾·레이아웃 수정·콘텐츠 다듬기), 요소 클릭 → 빨간 하이라이트 → 플로팅 입력("이 [요소]에서 무엇을 변경해야 하나요?" / 취소 / ✓) → LLM이 **그 요소만** 수술적으로 수정 → 재렌더. 사용자는 비기술자여도 다이어그램을 가리키며 말로 고칠 수 있다. 첫 실전 대상은 사용자가 방금 완성한 hand-authored 슬라이드 3장(`p01/p02/p03_report_snapshot.html`)이다.

---

## 1. Ground Truth (이 세션에서 직접 검증한 사실)

| # | 사실 | 근거 |
|---|------|------|
| G1 | 렌더 출력의 노드/엣지/라벨은 **id·data-*·고유 class가 전혀 없는** 생 `<rect>/<text>/<path>`다. id는 UI chrome(`btn-theme`, `export-menu`, `arrowhead*`, `grid`)뿐 | `probe.html` 렌더 후 DOM 검사: 노드 "Agent Planner" = 무표식 rect 2 + text 3, `data-arch*` 매칭 0건 |
| G2 | 렌더러별 emit 지점이 함수 단위로 깔끔히 분리돼 있다 | workflow: `renderLane/Phase/Group/Node/EdgePath/EdgeLabel/Legend` (`render-workflow.mjs:370–441`), architecture: `renderBoundary/ConnectionPath/ConnectionLabel/Component/Legend`, sequence: `renderParticipant/Lifeline/Segment/Activation/Message`, dataflow: `renderStage/Node/FlowPath/FlowLabel`, lifecycle: `renderBands/State/TransitionPath/TransitionLabel` |
| G3 | 스키마는 엄격하다(`additionalProperties:false`, id 패턴 `^[a-zA-Z][a-zA-Z0-9_-]*$`). 단 **edge/flow/transition/message/card에는 id 필드가 없다** — from/to+index로 파생 id를 만들어야 함 | `workflow.schema.json`, `common.schema.json` 직접 확인 |
| G4 | 렌더러는 import 시점에 파일을 읽는 **spawn-per-run Node 스크립트**다(`loadDiagram`이 모듈 최상단). 브라우저 번들 불가(현재 형태) → 재렌더는 로컬 Node 프로세스가 필요 | `renderers/shared/cli.mjs`, `bin/archify.mjs`(spawnSync) |
| G5 | 템플릿은 sentinel slot 방식(`ARCHIFY:SVG_SLOT`, `ARCHIFY:CARDS_SLOT`)이고 `applyTemplate`이 placeholder 존재를 검사한다 → slot 추가는 정합 절차가 명확 | `assets/template.html`, `shared/utils.mjs:applyTemplate` |
| G6 | 검증 체인이 이미 3층으로 존재: ajv 스키마 → 렌더러 layout validation(겹침·라벨 충돌·경로 교차, 수정 제안 포함) → `check`(single_svg/finite_svg/orthogonal_arrows/legend_clearance) + 별도 overlap checker 2종(`scripts/check-line-overlaps.mjs`, `check-text-overlaps.mjs`) | `render-workflow.mjs:validateWorkflow`, `check` 실행 결과, `scripts/` |
| G7 | 테스트 스위트 존재(`test/` 9파일, golden 포함) → 렌더 출력 변경 시 golden 갱신 필요 | `test/` 목록 |
| G8 | hand-authored 슬라이드는 `data-object="true" data-object-type="textbox|shape"` div + 엣지용 임베디드 SVG 1개 구조, **구조화 소스 없음** (mockup 스크린샷이 바로 이 클래스) | 과제 grounding #3 (슬라이드 파일 자체는 현재 권한 차단 경로) |

**Provenance 두 클래스**: (a) archify-JSON-backed — 소스 JSON이 있어 "JSON 노드 수정 → 결정론적 재렌더"가 가능한 깨끗한 경로. (b) raw-DOM-backed — 소스 없이 DOM subtree를 직접 패치해야 하는 슬라이드. **MVP는 (b)를 먼저 겨냥하고**(사용자의 실제 첫 대상이 p01–p03), (a)는 렌더러 고도화와 함께 v1에서 완성한다. 두 클래스는 하나의 adapter 인터페이스 뒤에 숨긴다(§3.3).

---

## 2. Architecture Overview

```
┌────────────────────────────── Browser (static app) ──────────────────────────────┐
│  Editor Shell (vanilla JS, no build step)                                        │
│   · 툴바 6모드 state machine   · 플로팅 프롬프트   · findings 패널   · undo stack │
│   · 파일 로드(드래그/선택) & 다운로드                                            │
│  ┌─ Diagram Host ────────────────┐   ┌─ Element Model (adapter 계층) ─────────┐  │
│  │ sandboxed <iframe srcdoc>     │   │ ArchifyJsonAdapter  (class a)          │  │
│  │ + 주입된 editor-agent script  │◄──┤ DomObjectAdapter    (class b)          │  │
│  │   (hit-test·hover·bbox 보고,  │   │ 공통 API: enumerate/resolveHit/        │  │
│  │    postMessage 브리지)        │   │  contextFor/opsSchema/apply/verify/    │  │
│  └───────────────────────────────┘   │  serialize                             │  │
└───────────────┬──────────────────────┴──────────────┬────────────────────────────┘
                │ POST /render /validate /check       │ POST /v1/element-edit 등
                ▼ (class a에만 필요)                  ▼
   Local Render Service                    LLM Proxy Worker (Cloudflare)
   `archify serve` (신규 subcommand,       · Anthropic key server-side 주입
    zero-dep node:http, 기존 렌더러         · tool-use JSON-schema 강제 응답
    spawn 재사용)                           · origin allowlist·rate/token cap
                                                      │
                                           (optional, Later) Supabase persistence
```

원칙: **authoritative state는 항상 부모(Editor Shell)의 소스 모델**(class a=JSON, class b=파싱된 Document)에 있고, iframe은 순수 view다. 패치는 iframe을 라이브 변형하지 않고 소스 모델에 적용 후 re-srcdoc한다. editor-agent script는 에디터 로드 시에만 주입되며 **저장 파일에는 절대 포함되지 않는다**(저장물 청결 보장). LLM key는 Pipeline Lab과 동일하게 proxy worker 밖으로 나오지 않는다.

### 핵심 루프 (data flow)

```
1 SELECT   클릭 → editor-agent가 hit-test → ElementRef{id, kind, part, bbox} postMessage
2 PROMPT   부모가 bbox를 좌표 변환해 플로팅 입력 표시("이 [노드]에서 무엇을 변경해야 하나요?")
3 CONTEXT  adapter.contextFor(ref): 요소 소스 + 이웃 digest + 제약(레이아웃 budget) + 지시문
4 LLM      proxy worker 경유, 응답은 op 스키마로 강제(선택 id에 const-pinned) → 제한된 patch
5 VALIDATE patch를 소스 모델에 적용 시도: scope 검사 → (a) ajv+렌더러 layout 검증 / (b) sanitize
6 APPLY    통과 시 소스 모델 교체, (a) serve로 재렌더 / (b) 재직렬화 → iframe reload
7 VERIFY   (a) `check`+bleed-diff / (b) bleed-diff(+overlap checker) → 실패 시 자동 revert
8 FEEDBACK 변경 요소 2초 하이라이트 + undo toast. 실패 시 오류를 LLM에 1회 재시도 후 사용자 표출
```

---

## 3. Element-Addressing 설계 (linchpin)

### 3.1 Class (a): 렌더러 stamping — `data-arch-*` 계약

각 emit 함수(G2의 함수들)가 자기 출력 덩어리를 `<g>`로 감싸고 3개 속성을 찍는다:

```html
<g data-arch-id="planner" data-arch-kind="node" data-arch-part="body">
  <rect … class="c-mask"/><rect … class="c-backend"/><text …>Agent Planner</text>…
</g>
<g data-arch-id="e:chat->planner:1" data-arch-kind="edge" data-arch-part="path">
  <path d="…" class="a-emphasis" …/>
</g>
<g data-arch-id="e:chat->planner:1" data-arch-kind="edge" data-arch-part="label">
  <rect class="c-mask"/><text>plan</text>
</g>
```

- **id 규칙**: id가 있는 컬렉션(node/lane/phase/group/component/participant/state/stage-index)은 소스 id 그대로. **id가 없는 컬렉션(G3)은 파생 id**: `e:<from>-><to>:<edgeIndex>`(edge/flow/transition), `m:<from>-><to>:<msgIndex>`(message), `seg:<i>`, `act:<i>`, `card:<i>`. 파생 id는 배열 앞쪽 삽입/삭제 시 밀리므로, **에디터는 매 재렌더 후 선택을 재해석**하고 findings 핀은 스냅샷 hash와 함께 저장한다(§9 R3). 장기적으로 edge에 optional `id`를 스키마에 추가하는 것은 additive라 열려 있다.
- **kind 어휘**(모드별): workflow `lane|phase|group|node|edge|legend`, architecture `component|boundary|connection|legend`, sequence `participant|lifeline|segment|activation|message|legend`, dataflow `stage|node|flow|legend`, lifecycle `band|state|transition|rail|legend`, 공통 `card`(HTML 쪽, `renderCards`에서 stamping), `meta-title|meta-subtitle`(`applyTemplate`에서 h1/subtitle에 stamping).
- **part**: 한 논리 요소가 불연속 클러스터로 나뉘는 경우(엣지의 path는 노드보다 먼저, label은 나중에 그려지는 z-order 규칙 유지) 같은 id에 `part`만 달리한다. `<g>` 래핑은 연속 클러스터 단위라 paint 순서를 바꾸지 않는다.
- **선택 UX**: 클릭 1회 = 가장 안쪽 매칭(`closest('[data-arch-id]')`), 같은 자리 재클릭 = 상위로 순환(sublabel→node→group→lane). 하이라이트는 editor-agent가 `getBBox()` 기반 빨간 outline rect를 오버레이 레이어에 그린다(저장물에 안 남음).
- **check/테스트 영향**: `check-render-output.mjs`의 SVG 파싱이 `<g>` 래퍼를 투과하도록 확인·보정, `test/golden.mjs` 스냅샷 갱신, 신규 테스트 2종 — "모든 emit 요소가 stamping을 갖는가", "클릭 타깃→id→소스 JSON round-trip".
- **hybrid injection 규칙 갱신**: SKILL.md의 custom-shape injection 기법(placeholder rect 교체)은 **래퍼 `<g>`의 `data-arch-*`를 보존한 채 내부 geometry만 교체**하도록 문구를 갱신한다 — 이래야 게이트 같은 수제 도형도 선택 가능("gate"가 선택 대상인 이유).

### 3.2 Embedded source — 렌더 산출물의 자기서술화

`writeDiagram`이 렌더 시 소스 JSON을 산출물에 내장한다:

```html
<!-- ARCHIFY:SOURCE_SLOT_START --><script type="application/json" id="archify-source"
  data-archify-type="workflow" data-archify-version="2.11">{…이스케이프된 소스…}</script><!-- ARCHIFY:SOURCE_SLOT_END -->
```

- 템플릿에 신규 sentinel 추가 + `applyTemplate` 검사 목록 확장(G5의 기존 절차 그대로). `</script>` 이스케이프 필수.
- 효과: **에디터가 어떤 archify HTML을 열어도 소스 복원 → class (a) 편집 루프 진입 가능.** 별도 .json 사이드카 파일을 잃어버릴 일이 없다.
- export 메뉴/`check`는 SVG만 다루므로 영향 없음(테스트로 고정). hand-placed fallback 모드에서는 slot이 비어 있어도 유효.

### 3.3 Class (b): DomObjectAdapter (hand-authored 슬라이드)

- **로드 시 ephemeral id 부여**: `[data-object="true"]` 전수 스캔, 문서 순서로 `data-arch-eid="obj:<i>"`를 **부모 소스 모델에만** 부여(저장 시 제거 옵션 제공, 기본은 유지해 재열기 안정성 확보 — 사용자 확인 항목 §10 Q6). kind는 `data-object-type`(textbox/shape)에서 유도.
- **편집 대상**: 절대배치 div subtree(텍스트·스타일·기하). **임베디드 SVG 내부의 엣지/화살표는 MVP에서 선택 불가**로 명시적으로 자른다(무표식 path 덩어리라 class (a)와 같은 갭인데 소스도 없음 — v1+에서 geometry 휴리스틱 매핑 검토, §9 R2).
- **hit-test**: editor-agent가 `elementFromPoint` → `closest('[data-object]')` → eid 보고. 하이라이트는 `getBoundingClientRect` outline.

### 3.4 공통 Adapter 인터페이스 (두 클래스를 하나의 UI로)

```ts
interface DiagramAdapter {
  load(bytes): Doc                                    // a: HTML→embedded JSON 복원(없으면 안내), b: HTML 파싱
  enumerate(doc): ElementRef[]                        // 검증 findings 핀·요소 목록용
  resolveHit(hit): ElementRef | null
  contextFor(ref, mode): EditContext                  // §4.1
  opsSchema(mode, ref?): JSONSchema                   // LLM 응답 강제 스키마(모드·선택 id로 동적 pin)
  apply(doc, ops): { doc: Doc, changedIds: string[] } // ScopeViolation throw
  render(doc): Promise<string>                        // a: serve /render, b: serialize
  verify(doc, html): Promise<Finding[]>               // a: validate+check(+checkers), b: sanitize+bleed(+checkers)
  serialize(doc): bytes                               // 다운로드용(에디터 코드 미포함 보장)
}
```

---

## 4. Scoped AI Edit 메커니즘

### 4.1 LLM에 보내는 것 (요소당)

| | class (a) archify-JSON | class (b) raw-DOM |
|---|---|---|
| system | 모드별 계약 + 해당 diagram_type의 레이아웃 budget 요약(SKILL.md에서 발췌·압축, 수백 토큰) | 모드별 계약 + 슬라이드 좌표계·`data-object` 규약 + 허용 스타일 whitelist |
| element | 선택 요소의 소스 JSON 오브젝트 전체 | 선택 subtree `outerHTML` + computed 기하(`top/left/w/h/z`) |
| context | **소스 JSON 전문**(archify JSON은 수 KB로 작음 — probe 예제 88줄) + 선택 ref + 인접 digest(닿는 edge, 같은 lane 이웃의 id/label/col) | 이웃 data-object digest(type/bbox/텍스트 앞 80자) + 뷰포트 치수 |
| instruction | 플로팅 입력의 사용자 문장 | 동일 |

전문을 보내되 **응답은 요소 하나로 강제**하는 것이 핵심: LLM은 전체 그림을 이해하고, 출력 권한은 스키마가 자른다.

### 4.2 LLM이 반환하는 것 — 제약된 patch (자유 서식 전체 파일 출력 금지)

- **class (a): domain-op patch.** proxy가 tool-use JSON schema로 강제:
  ```json
  { "ops": [ { "op": "replace_node", "id": "planner", "node": { …스키마 준수 노드 전체… } } ] }
  ```
  op 어휘: `replace_node|replace_edge|replace_lane|update_meta|add_node|add_edge|remove_node|remove_edge|reject(reason)`. **선택 모드에서는 응답 스키마의 `id`를 `{"const":"<선택 id>"}`로 pin** — scope 위반이 파싱 단계에서 불가능해진다. 범위 밖 요구(예: "이거 옮기고 옆것도 밀어줘")는 `reject`로 반환 → UI가 "이 변경은 요소 범위를 넘습니다. 레이아웃 수정 모드로 실행할까요?" 에스컬레이션.
- **class (b): bounded DOM ops.**
  ```json
  { "ops": [ { "op": "setText", "eid": "obj:12", "text": "…" },
             { "op": "setStyle", "eid": "obj:12", "style": { "background": "#fee2e2", "width": "220px" } } ] }
  ```
  op 어휘: `setText|setStyle(whitelist: 위치·크기·색·폰트·테두리·배경·z-index)|setAttr(class·data-*만)|replaceInner(sanitized 인라인 subset)|replaceSubtree(identity 보존)|reject`. sanitizer가 `<script>`, 이벤트 핸들러 속성, 외부 URL을 무조건 제거.

### 4.3 적용·격리·검증 (bleed 방지)

1. **Scope gate(기계적)**: `apply()`가 ops의 대상 id ≠ 선택 id면 ScopeViolation — 프롬프트 신뢰가 아니라 코드가 막는다.
2. **재구성 검증(class a)**: ops 적용 → 전체 JSON 재구성 → `generated-validators` ajv 검사 → `serve /render` 시도(렌더러 layout validation이 겹침·라벨 충돌·경로 교차를 여기서 잡고 **수정 제안 문구까지 반환**) → `check` 통과.
3. **Bleed-diff(양 클래스)**: 적용 전/후 직렬화 결과를 구조 diff → 변경 노드 집합 ⊆ {선택 id의 part들}인지 assert. class (a)의 **정당한 예외 whitelist**: legend(노드 type 변경 시 legend 구성이 바뀜)와 viewBox/auto-height — 이 둘만 허용하고 테스트로 고정.
4. **자동 수리 1라운드**: 검증 실패 시 validator의 오류·제안 문구를 그대로 LLM에 되먹여 같은 op 스키마로 최대 1회 재시도(총 LLM 호출 ≤2). 재실패 → 자동 revert + 오류 표출(+오류 클래스가 겹침이면 레이아웃 모드 제안).
5. **Undo**: 직렬화 소스 스냅샷 ring(≤50), localStorage(파일 hash 키). 모든 적용은 스냅샷 후에만.

결정론: class (a) 렌더러는 순수 함수적(같은 JSON→같은 SVG)이므로 "한 노드만 바뀐 JSON → 그 클러스터만 바뀐 SVG"가 성립하고, 위 3의 diff가 이를 매 편집마다 실증한다.

---

## 5. 툴바 6모드 시맨틱스

| 모드 | AI 범위 | class (a) 동작 | class (b) 동작 |
|------|---------|----------------|----------------|
| **선택** | 요소 1개, LLM | 클릭→플로팅 입력→§4 루프(replace_* pin) | 동일(DOM ops pin) |
| **그리기** | 요소 추가, LLM 선택적 | 팔레트(node type/edge)에서 빈 lane×col 클릭→`add_node` mini-form, 또는 자연어("여기 승인 게이트 추가")→`add_*` ops. 렌더러 검증이 배치 오류를 즉시 반려 | 클릭 지점에 `data-object` textbox/shape div 삽입 후 바로 편집 |
| **편집** | AI 없음, 수동 직접 편집 | 선택 요소의 property form(label/sublabel/type/tag/col/lane/variant — 스키마 enum이 드롭다운) → 같은 apply/검증 경로 | contenteditable 텍스트, 드래그 이동(top/left), 리사이즈 핸들, 스타일 패널 |
| **콘텐츠 검증 ▾** | 다이어그램 전체 read-only audit, LLM+기계 검증 | 드롭다운(제안, 사용자 확정 필요 §10 Q2): ① 맞춤법·문법 ② 용어 일관성 ③ 사실·정합성(참조 문서 첨부 시) ④ 구조 검증(ajv+layout+check+overlap checkers) ⑤ 전체. 결과는 **data-arch-id로 핀된 findings 패널** — 클릭=요소 점프, "AI로 고치기"=§4의 scoped edit 루프 재사용 | ①②③ 동일(텍스트 인벤토리 추출) + ④는 overlap checker(SVG부) + div 텍스트 겹침 확장판 |
| **레이아웃 수정** | 다이어그램 전체, LLM, **layout 필드만** | op whitelist가 `col|lane|yOffset|width|height|route|via|fromSide|toSide|labelDx/Dy/At|bias|viewBox`만 허용(내용 필드 잠금) — validator 출력·budget을 컨텍스트로 주고 validate 통과까지 루프(≤3) | style-only op 배치(위치·크기), overlap checker로 검증 |
| **콘텐츠 다듬기** | 다이어그램 전체, LLM, **텍스트 필드만** | 역방향 잠금: `label|sublabel|tag|cards|meta.title/subtitle`만 허용(geometry 잠금). 톤·용어 통일 지시 → 요소별 diff 리스트 → 전체/부분 승인 후 일괄 적용 | 모든 textbox의 setText 배치, 동일 승인 UX |

**모드별 field-class lock(레이아웃 필드 vs 콘텐츠 필드의 op-whitelist 이원화)이 광역 모드의 scope 규율**이다 — 선택 모드의 id-pin과 같은 원리를 필드 축으로 적용한 것.

---

## 6. 스킬 고도화 vs 앱 래퍼 — 무엇이 어디에 들어가나

### 스킬 내부에 랜딩 (`~/.claude/skills/archify`) — 기존 headless 계약 불변

| 변경 | 파일 | 성격 |
|------|------|------|
| S1 `data-arch-*` stamping | 5개 렌더러의 emit 함수(G2) + `shared/utils.mjs`(renderCards, applyTemplate) | additive 출력 속성 |
| S2 embedded source slot | `assets/template.html` + `shared/utils.mjs` + `shared/cli.mjs:writeDiagram` | additive sentinel |
| S3 `check` 호환 + 테스트 | `scripts/check-render-output.mjs`, `test/golden.mjs` 갱신, stamping/round-trip 테스트 신설 | 보수 |
| S4 신규 subcommand `archify serve [--port]` | `bin/archify.mjs` + `editor/server.mjs` | zero-dep node:http: 정적 에디터 서빙 + POST `/render|/validate|/check`(기존 렌더러 spawn 재사용, G4 그대로) |
| S5 에디터 정적 번들 | `editor/`(index.html, editor.js, adapters/, agent.js) | vanilla JS·no build — 스킬의 "no dependency install" 약속 유지 |
| S6 SKILL.md 갱신 | data-arch 계약 문서화, injection 기법의 attr 보존 규칙, `serve` 사용법 | 문서 |

`render/validate/inspect/check/examples/doctor/demo`의 CLI 의미는 손대지 않는다. 스킬은 지금처럼 headless로 쓰이고, `serve`는 순수 추가다.

### 앱 계층 (스킬 밖, Pipeline Lab 패턴)

- **LLM Proxy Worker**(Cloudflare, 별도 소형 배포 디렉토리): `POST /v1/element-edit | /v1/audit | /v1/layout | /v1/polish`. stateless, Anthropic key는 worker secret, 응답은 요청에 실린 op-schema로 강제(tool-use), origin allowlist + per-IP token/rate cap. 브라우저는 key를 절대 안 든다. 로컬 모드에서는 `archify serve`가 env-var key로 같은 계약을 대행 가능(요청 계약 동일 → 프런트 무수정).
- **호스팅 정적 에디터**: `editor/` 번들 그대로 정적 호스팅(class (b)는 Node 불필요라 완전 동작; class (a)는 로컬 serve 필요 안내).
- **(Later) Supabase**: 편집 이력·공유 세션.

---

## 7. Phasing

### MVP — "슬라이드 한 장에서 핵심 루프 끝까지" (class b 전용, 스킬 무변경)

- 범위: 정적 에디터 + proxy worker. p01 슬라이드 로드 → **선택 모드 완주**(클릭→하이라이트→플로팅 입력→LLM DOM-ops→sanitize+scope gate+bleed-diff→적용→하이라이트→undo→다운로드) + 편집 모드의 텍스트 직접 수정(거의 공짜). UI 언어 한국어, mockup 라벨 그대로.
- **의도적 컷**: class (a) 미지원(스킬 변경 0), 그리기·검증·레이아웃·다듬기 비활성(버튼은 보임), 단일 선택만, **임베디드 SVG 엣지 선택 불가**, 자동수리 루프 없음(단발+undo), persistence 없음, 멀티 슬라이드 내비 없음.
- 수용 기준: p01에서 "이 박스 제목을 X로 바꾸고 배경 강조" 류 요청이 10초 내 반영되고, **다른 요소의 직렬화 결과가 byte-identical**하며, undo가 복원한다.

### v1 — archify class (a) + 6모드 전부

- S1–S6 전부 랜딩(렌더러 stamping·embedded source·serve·테스트). ArchifyJsonAdapter + validate/check/bleed 루프 + 자동수리 ≤1회. 6모드 전 구현(검증 드롭다운·findings→fix, field-class lock, overlap checker 연동 + div 텍스트 겹침 확장 스크립트). undo/redo 히스토리 패널. **v1 착수 직후 class (a) 어댑터 spike를 먼저** 돌려 adapter API가 (b)에 과적합되지 않았는지 조기 검증(§9 R6).

### Later

- Supabase persistence·공유 링크, 멀티 선택·배치 ops, deck(멀티 슬라이드) 내비게이션, **(b)→(a) 승격 어시스턴트**("이 슬라이드를 archify JSON으로 변환"), 렌더러 I/O 분리 리팩토링→브라우저 번들(호스팅 단독 class (a)), Mermaid 붙여넣기 임포트 UI, 실시간 협업.

---

## 8. Key Decisions (D-id)

- **D1: 요소 주소화는 렌더러가 찍는 `data-arch-id/kind/part` 래퍼 `<g>` + 파생 id 스킴 + embedded source로 해결한다.**
  - WHY: 대안 대비 우월 — ① 기하 hit-test(`inspect --layout-json` 좌표 대조)는 현재 architecture 모드 전용인 데다 렌더와 어긋나면 침묵 오류, ② 사이드카 manifest 파일은 잃어버리면 끝, ③ `id=` 속성은 chrome id(`grid` 등)·문서 전역 유일성과 충돌 위험. data-*는 불활성·CSS 셀렉터 호환·복사에도 살아남고, embedded source는 산출물 하나로 round-trip을 완결한다.
  - COST: 출력 몇 KB 증가, golden 테스트 일괄 갱신, `check` 파서 보정, injection 기법 문서 갱신, 파생 id의 삽입/삭제 시 재해석 규칙 필요.
  - EXIT: 속성은 additive라 제거해도 기존 소비자 무영향. 제거 시 에디터는 `inspect --layout-json`을 5모드로 확장한 기하 hit-test로 후퇴.

- **D2: 두 provenance 클래스를 단일 DiagramAdapter 인터페이스 뒤에 둔다(MVP=(b), 전략 경로=(a)).**
  - WHY: 사용자의 실전 파일이 (b)인데 스킬 고도화의 본류는 (a) — 하나의 UI·패치 머신을 공유해야 검증 모드의 findings→fix 재사용 같은 시너지가 산다.
  - COST: 추상화 유지비 + 능력 격차((b)엔 스키마 검증이 없음)가 UI에 기능 플래그로 새어 나옴.
  - EXIT: (b) 슬라이드가 (a)로 승격 이관되면(Later의 어시스턴트) DomObjectAdapter를 동결·제거.

- **D3: patch는 자유 서식 전체 파일이 아니라 제약된 domain-op이다 — (a) 선택 id에 const-pin된 replace_* JSON ops, (b) sanitize되는 DOM ops. scope는 프롬프트가 아니라 스키마 pin + apply의 ScopeViolation + bleed-diff가 기계적으로 보증한다.**
  - WHY: 전체 파일 재작성은 범위 보증 불가·토큰 낭비·비결정적. 스키마 pin은 위반을 생성 단계에서 봉쇄하고, 재구성 후 ajv(`additionalProperties:false`, G3)가 필드 오염까지 잡는다.
  - COST: 표현력 제한 — 정당한 광역 편집("이거 옮기고 이웃 밀기")이 reject됨 → 에스컬레이션 UX가 필수.
  - EXIT: 명시적 사용자 확인("N개 요소가 바뀝니다")을 게이트로 하는 multi-element op 배치를 추가.

- **D4: LLM 경로는 stateless Cloudflare Worker proxy(키 server-side, tool-use 스키마 강제) — Pipeline Lab 검증 패턴 재사용.**
  - WHY: 브라우저 보관 키는 유출 경로, full backend는 과설계. 같은 저자가 이미 운영 중인 검증된 모양.
  - COST: worker 배포·운영 + 공개 URL 남용 방지(allowlist·cap) 필요.
  - EXIT: 요청 계약을 동일하게 유지한 채 `archify serve`(env-var key)로 스왑 — 프런트 무수정 오프라인 전환.

- **D5: 정확성 가드는 재렌더+검증 루프다 — (a) 모든 patch가 재구성→ajv→렌더러 layout 검증→check→bleed-diff(legend/viewBox whitelist)를 통과해야 적용, (b) sanitize+bleed-diff(+checkers). 실패는 자동 revert, 자동수리 ≤1회.**
  - WHY: 렌더러가 결정론적이고 검증 3층이 이미 존재(G6)하므로 검증이 싸고 총체적 — "한 요소만 바뀌었다"가 주장 아닌 diff 실증이 된다.
  - COST: 편집당 spawn 왕복 2회(~수백 ms)와 LLM 재시도 1회의 지연; 엄격 게이트가 과반려하면 UX 마찰.
  - EXIT: 오류 클래스별로 apply-with-warning(경고 후 적용) 완화 스위치.

- **D6: MVP는 class (b)(p01–p03) 정적 앱 + worker로 최소 완주를 증명하고, class (a)·스킬 변경(S1–S6)은 v1에 랜딩한다.**
  - WHY: 첫 실전 파일이 (b)고, (b)는 Node 런타임이 필요 없어 배포 가능한 최소 증명이 가장 빠르다. 스킬 변경은 golden·check 연쇄 갱신이 있어 테스트와 함께 묶는 게 안전.
  - COST: MVP가 전략 핵심(렌더러 고도화)을 미검증으로 남김 — adapter API의 (a) 적합성 리스크. 본 문서의 이중 설계 + v1 초입 spike로 완화.
  - EXIT: (b) DOM 편집이 hand-authored 다양성에 과하게 취약하면 MVP를 (a) local-first로 뒤집는다.

- **D7: 에디터 프런트와 serve는 스킬 저장소 안(`editor/` + subcommand), worker만 밖 — 스킬은 headless 계약을 유지한 채 앱이 된다.**
  - WHY: "skill 고도화 앱으로 포장"의 직역 — stamping 계약과 selection 로직은 버전 lockstep이 필요하고, 스킬 하나 설치로 `archify serve` 즉시 사용이 배포 스토리로 가장 짧다.
  - COST: 스킬 부피 증가, no-build 약속 때문에 에디터는 vanilla JS 규율 강제.
  - EXIT: 에디터가 수 파일을 넘게 자라면 serve의 HTTP 계약을 seam으로 별도 repo 분리.

---

## 8b. 확정된 결정 (2026-07-18, 사용자 승인) — §10 Open Questions 해소

이 세션에서 사용자가 §10의 오픈 퀘스천에 답해 아래를 확정. D4는 D10으로 대체(교체가 아니라 공급자 확정).

- **D8: MVP·앱은 정적 호스팅.**
  - WHY: class (b) 슬라이드는 Node 런타임 불필요 → 정적 호스팅만으로 완전 동작. Pipeline Lab이 GitHub Pages 정적 호스팅으로 이미 검증한 배포 경로라 최단.
  - COST: class (a) archify-JSON 재렌더는 로컬 Node(`archify serve`)가 필요 → 정적 단독으로는 (a)가 제약(v1에서 로컬 serve 병행 안내).
  - EXIT: 렌더러 I/O 분리→브라우저 번들화(Later)하면 (a)도 정적 단독 가능.

- **D9: 콘텐츠 검증 ▾ = 5항목 확정 — ①맞춤법·문법 ②용어 일관성 ③사실·정합성 ④구조·겹침 ⑤전체.**
  - WHY: §5 제안 그대로 승인. 기계검증(④: ajv+layout+check+overlap checker)과 LLM검증(①②③)의 명확한 이원.
  - COST: 항목 고정 → 새 검증축은 UI/프롬프트 확장 필요.
  - EXIT: 드롭다운을 config 배열(데이터 주도)로 만들어 항목 추가를 1줄로.

- **D10: 요소 편집 LLM = NVIDIA Build. 기존 `nvidia-proxy` 워커 + `llm.js::chatTool` 재사용(Anthropic/신규 워커 아님).**
  - WHY: 이 repo가 이미 `https://nvidia-proxy.popixoxipop.workers.dev`(worker/nvidia-proxy.js, `ALLOWED_ORIGIN="*"` → 새 오리진도 CORS 통과) + `docs/lab/llm.js::chatTool({model,messages,tool})`(OpenAI-compat `tools`+`tool_choice`로 함수 호출 강제, `tool_calls.arguments` 파싱)을 **운영 중**. 이 세션에서 워커 계약·클라이언트 코드 직접 확인. → 새 워커 배포 0, op-schema는 chatTool의 `input_schema`로 그대로 강제됨(D3의 기계적 scope 보증 유지). 키는 브라우저→프록시 `x-nvidia-api-key` 헤더로만 전달(앱 오리진에 미보관, 제출-폴링 전송).
  - COST: NVIDIA Build 모델별 tool_calls 신뢰도 편차(모델 선택 필요) + 제출-폴링 지연(수초~분, 워커가 async job-queue). 앱이 프록시 URL·NVIDIA 키를 사용자 입력으로 받아야 함(Pipeline Lab과 동일 연결설정 UX 재사용 가능).
  - EXIT: 요청 계약(OpenAI-compat chat + tools)을 동일 유지 → 프록시 URL만 바꿔 다른 공급자로 스왑.

- **D11: 그리기 모드 v1 = 노드 추가 + 엣지 드래그 연결 둘 다.**
  - WHY: 사용자 지시(완전한 저작 경험).
  - COST: 엣지 드래그(두 노드 드래그 연결→`add_edge`)는 포트 hit-test·경로 프리뷰가 필요해 v1 범위 확대. class (a)는 렌더러 layout 검증이 배치오류를 반려해주지만 class (b)는 임베디드 SVG 엣지라 난도 높음 → **(b)의 엣지 편집·드래그는 여전히 MVP/초기 컷 유지, 그리기 엣지는 (a) 우선 구현**.
  - EXIT: 엣지 드래그가 과부하면 v1은 노드추가만, 엣지 드래그를 v1.1로 분리.

**MVP LLM 경로 구체화(D10 반영)**: §7 MVP의 "proxy worker"는 신규 배포가 아니라 **기존 nvidia-proxy + chatTool 이식**이다 — `submitAndPoll`+`chatTool`을 에디터로 lift, `tool.input_schema`=class (b) DOM-ops 스키마(`setText|setStyle|setAttr|replaceInner|replaceSubtree|reject`), 반환 args를 sanitize+scope-gate+bleed-diff 후 적용. 사용자 연결설정(프록시 URL 기본값 + NVIDIA 키)은 Pipeline Lab config 패턴 재사용.

---

## 9. Risks

- **R1 범위-의도 충돌**: 요소 하나의 편집이 전역 결과를 갖는 요청(폭 늘리기→이웃 겹침)이 잦으면 reject/에스컬레이션 비율이 UX를 갉아먹는다. 측정: MVP에서 reject율 로깅 → 임계 초과 시 D3 EXIT 가동.
- **R2 class (b)의 검증 공백**: (b)엔 스키마·layout validator가 없어 정확성 하한이 sanitize+bleed-diff+사람 눈이다. 특히 **임베디드 SVG 엣지는 MVP에서 아예 편집 불가**로 잘랐음을 사용자에게 선명히 고지해야 실망을 막는다.
- **R3 파생 id 불안정**: edge 등 id 없는 컬렉션(G3)은 삽입/삭제 시 인덱스가 밀린다. 재렌더 후 재해석 + findings의 스냅샷 hash 동반으로 완화; 잔여 위험은 오래된 핀의 오지시.
- **R4 정당한 부수 변경**: 노드 type 변경이 legend를, 요소 추가가 auto-height/viewBox를 바꾸는 것은 정상이다 — bleed-diff whitelist를 좁게 정의하고 테스트로 고정하지 않으면 "한 요소만" 보증이 형해화된다.
- **R5 worker 남용/비용**: 공개 URL에 key가 실리는 구조적 리스크 — origin allowlist, per-IP token 예산, 모델 상한. 로컬 serve 경로가 항상 대안.
- **R5b ★ 라이브 편집 지연 (2026-07-19 실측)**: class-a 라이브 편집을 실제 NVIDIA 키로 앱에서 end-to-end 돌린 결과 — 머신(선택→chatTool→apply→serve재렌더→verify→bleed)은 **정상**(에러 0, 폴링 정상, mock 28/28)이나 **모델 호출이 312초+ 완료 안 됨**. 가설 검증:
  - H1 "class-a `replace_node`(노드 전체 재생성) 출력이 커서 느리다" → **반증**: 최소 patch op(필드 1개)과 무거운 replace_node op을 같은 모델·편집으로 비교했더니 **둘 다 220초+ pending**. op 크기는 lever가 아님.
  - **진짜 원인**: NVIDIA build-tier 지연 + 프록시의 **단일 레인 async 큐**(max_batch_size=1). 큐가 비었을 때 class-b setText는 162초였으나, 지금은 **깨끗한 단일 최소 호출조차 317초+ pending** — 혼잡만이 아니라 현재 build-tier가 호출당 5분+로 근본적으로 느림. 프록시 워커 주석도 "build-tier 모델은 부하 시 수 분"이라 명시(D-C).
  - **모델 비교 실측(2026-07-19~20, 같은 프록시·같은 tool-call patch op)**: `stepfun-ai/step-3.5-flash`=**58s(valid ✓)** < `llama-3.1-8b`=**110s(valid ✓)** < `llama-3.3-70b`=**>254s pending**. → 모델 선택이 지연의 주 레버. **결정 D15**(D13 8b 대체): 기본 모델 = **step-3.5-flash**(사용자 지정 + 실측 최저지연 + 유효 tool_call). ★ID 주의: 정확한 NVIDIA Build id는 `stepfun-ai/step-3.5-flash`(`stepfun/`·`step-3.5-flash`는 404 — 16모델 벤치마크 json에서 확인). COST: 여전히 58s(즉시 아님, mock이 즉시). flash급이라 아주 복잡한 지시는 대형모델보다 약할 수 있음. EXIT: 어려운 편집엔 연결설정에서 대형모델 상향.
  - **"다중레인 프록시" 조사 결과 — 요청된 접근은 오해**: `wrangler.toml`의 `max_batch_size=1`은 한 consumer 실행이 처리하는 **메시지 수**지 동시성이 아니고, 워커 핸들러(`for (const message of batch.messages)`)는 배치 내에서도 **직렬**이라 batch_size를 올려도 동시성 안 늘고 직렬 부하만 커짐. Cloudflare Queues는 `max_concurrency` 미설정 시 consumer 실행을 **자동 스케일**(이미 병렬). 진짜 단일 레인은 **NVIDIA build-tier per-key 지연/스로틀**. **진짜 다중레인** = 워커가 `.env`의 **7개 NVIDIA 키를 round-robin**해 NVIDIA 동시성 7×(실효 개선). 단 이건 **공유 Pipeline Lab 워커 수정 + 사용자 Cloudflare로 배포 필요**라 이 에이전트가 단독 배포 불가 → 준비만 하고 사용자 결정/배포 대상. EXIT: key-pool 워커 배포 시 재평가.
  - **결정(외화)**: 라이브 지연의 실효 레버는 ① 저지연 모델(8B, 완료·에디터 단독) + ② key-pool 다중레인 워커(준비, 배포는 사용자). op-size는 레버 아님(실측 반증) — 단 field-level `set_fields`는 지연 무관하게 더 나은 설계라 class-a select에도 통일(별도 작업). 데모는 mock 기본.
- **R6 adapter의 (b) 과적합**: MVP가 (b)만 다루므로 API가 DOM 중심으로 굳을 수 있음 — v1 첫 작업을 (a) spike로 고정(§7).
- **R7 ★ provenance class (c) — 단일 SVG 수제 슬라이드 (2026-07-20 실측)**: P02/P03 `report_snapshot`(pptx 유래 slide)은 흐름 전체가 **하나의 `<svg data-object>`** 안이고 개별 STEP 박스는 마커 없는 `<g><rect><text>`. 클릭 hit-test `closest('[data-object]')`가 SVG 통째를 잡아 **박스 단위 선택 불가**(재현: stepBoxOwnerIsWholeSvg=true, svg 내부 마커 0). P01이 되는 건 박스마다 별도 절대배치 `data-object` div라서(class b). class (a)도 아님(임베디드 소스 없음) → 두 어댑터 어디에도 안 맞는 3번째 형태.
  - **결정 D14**: 즉흥 대응 금지 — 두 실행 경로만 고려. ① **각 박스 `<g>`를 stamp**(data-object 부여)해 class-b hit-test가 내부 박스를 잡게 + SVG-aware 편집(setText는 `<text>`, setStyle은 SVG attr `fill/stroke/x/y/width` 매핑)을 DomAdapter에 확장 → 새 provenance class (c) 어댑터. ② **슬라이드를 archify JSON으로 재저작**해 class (a)로 승격(stamp+소스+serve 자동). WHY: class-b DomAdapter는 CSS div 전제라 SVG `<g>`에 setStyle이 안 통함(fill≠background) — stamp만으론 텍스트 편집만 되고 기하/색은 깨짐. COST: ①은 SVG-aware op 계층(신규), ②는 수제 슬라이드→JSON 역작(수작업). EXIT: 사용자 선택 — 텍스트만 급하면 ①의 stamp+setText 최소판, 완전 편집 원하면 ②.
  - **현재 상태 정직히**: P02/P03 슬라이드는 지금 에디터에서 "통째 1요소"로만 선택됨. P01(div-per-box)과 archify 생성 다이어그램(data-arch-id)은 요소별 정상.
  - **class-c 구현 완료(2026-07-20)** 후 실사용서 발견한 2차 갭 → **결정 D16**(class-c 텍스트 고도화):
    - **(a) 박스 내부 다층 텍스트**: 박스 `<g>`엔 `<text>`가 2~3줄(STEP 라벨+주 라벨, 또는 다이아몬드 "4.1"+"category="+"cognition-isolation?")인데 setText가 최대폰트 1줄만 편집 노출 → 나머지 줄 수정 불가. **해법**: 박스를 여전히 단일 선택 단위로 유지하되 편집 패널에 그 박스의 **모든 `<text>` 줄마다 입력 필드**(줄 인덱스로 스코프된 setText). 박스 내부 `<text>`를 별도 stamp하지 않음(그러면 박스 선택이 깨짐) — 패널 다중필드로만 처리.
    - **(b) 박스 외부 자유 텍스트**: 엣지 라벨/주석(YES/NO, "1.1 finding-code 연결?", "0 surface/...")은 박스 `<g>` 밖 독립 `<text>`(총 106 text 중 다수)라 미stamp → 선택 불가. **해법**: 박스 `<g>`에 안 든 자유 `<text>`를 신규 단위 `svgtext:N`으로 stamp → 텍스트/이동(x·y)/색(fill) 편집. hit-test: 박스 내부 클릭은 box `<g>` 우선, 자유 텍스트는 자기 자신.
    - WHY: 실사용자가 "이 텍스트는 왜 못 고치냐"를 실제로 부딪힘 — 편집기의 약속(요소별 편집)이 텍스트 층위까지 내려가야 완결. COST: 패널이 박스별 가변 필드 수, 자유텍스트 단위가 늘어 hit-test 우선순위 규칙 필요. EXIT: 다층 필드가 과하면 "주 라벨+더보기" 접이식으로.
  - **결정 D17 (Cmd+Z 단축키, 2026-07-20)**: 툴바 undo 버튼과 같은 `undo()`를 Cmd/Ctrl+Z에 배선. **★D17b — 부모에만 리스너를 걸면 원리적으로 동작 불가**: 요소를 클릭하면 포커스가 iframe으로 이동(`activeElement=diagram-frame`)해 부모 document의 keydown이 아예 발화 안 함(실측 `parentSawKeydown=[]`). 즉 "클릭→Cmd+Z"라는 최빈 경로에서 단축키가 죽는다 → iframe(agent.js)에도 리스너를 걸고 `postMessage("arch-undo")`로 부모에 합류. 입력창/인라인편집 포커스 중엔 브라우저 기본 undo에 양보(양쪽 동일 규칙). Redo는 스택이 단방향이라 미지원(EXIT: 커서형 양방향 스택으로 교체). 검증 `test/s8-undokey.test.mjs` 8/8. **교훈: 정적 확인은 관찰이 아니다 — 브라우저에서 돌려서야 드러난 진짜 버그.**
  - **결정 D18 (화살표 편집, 2026-07-20)** — 방향뒤집기(더블클릭)·CAD식 꼭짓점 드래그·화살촉 크기. 구조: `marker-end` 보유 42개(`<line>` 16 + `<path>` 34, 최대 6꼭짓점 직교 폴리라인), 화살촉은 `<defs>` **공유 마커 3개**(`#ah`/`#ah-muted`/`#ah-red`, markerWidth=10 refX=9).
    - **★공유 마커 함정**: 화살촉 크기를 마커에서 직접 바꾸면 **그 마커를 쓰는 모든 화살표가 함께 변함** → scope 보증 위반(bleed-diff가 전 화살표를 offender로 잡음). **해법**: 해당 화살표 전용으로 마커를 **복제**(`#ah-svgedge-N`)하고 markerWidth/Height 스케일 + **refX 비례 스케일**(9/10=0.9 유지, 안 그러면 촉이 선 끝에서 이탈/관통), 그 화살표의 `marker-end`만 복제본으로 교체. 재조정 시 복제본 재사용(defs 무한증식 방지). bleed-diff는 "선택 eid에서 파생된 defs 1건 추가"를 명시적으로 회계.
    - **얇은 선 hit-test**: 2px 선은 클릭 불가에 가까운데 hit-proxy 요소를 소스에 넣으면 bleed-diff에 걸림 → agent.js에서 **기하학적 최근접 세그먼트 판정**(클릭점↔각 화살표 세그먼트 거리 ~8px)으로 해결, 소스 무오염.
    - WHY: 화살표가 마지막 미주소 요소라 "요소별 편집" 약속의 구멍. COST: 단위 종류 4개(box/text/edge/div)로 어댑터 분기 증가, 복제 마커로 defs가 편집수만큼(단위당 1개) 늘어남. EXIT: 전역 화살촉 크기를 원하면 공유 마커 직접 편집 op를 별도로 추가(단 "전체 변경" 명시 필요). → **D19에서 실제로 채택됨**.
    - **★브리핑 정정(에이전트가 실행 중 발견)**: `markerWidth/markerHeight/refX`만 키워도 **촉이 안 커진다** — viewBox 없는 마커에서 그 속성들은 *클리핑 뷰포트* 크기지 내용 크기가 아니다(내용은 그대로인 채 refX만 밀려 촉이 선 끝에서 이탈). 올바른 방법은 마커 자식을 `<g transform="scale(s)">`로 감싸고 refX/refY도 s배. 내가 브리핑에 쓴 "refX 비례 조정" 처방은 필요조건이지 충분조건이 아니었다.
  - **결정 D19 (화살촉 크기 일괄/전역 조절, 2026-07-20)** — 사용자 요청으로 D18의 EXIT를 실제 구현. 툴바 "편집"을 "콘텐츠 검증 ▾"와 같은 드롭다운으로 만들고 하위 항목에 배치(편집 자체 클릭은 여전히 요소편집 모드 진입 — 근육기억 보존).
    - **의도적으로 요소-scope가 아님**: 공유 마커(`#ah`/`#ah-muted`/`#ah-red`)를 직접 편집 → 그걸 쓰는 모든 화살표가 함께 변함. "일괄"의 의미대로 **D18에서 만든 개별 복제 마커까지 같은 크기로 통일**(안 그러면 실제로 균일해 보이지 않아 요청을 배신). bleed-diff(요소 1개만 변경 증명)를 적용하지 않고, 기존 전역 모드(레이아웃/다듬기)의 **확인 게이트(`#wd-confirm`) + 단일 스냅샷 undo** 경로를 따름.
    - WHY: 다이어그램 전체 화살촉을 하나씩 조정하는 건 비현실적. COST: 개별 조정이 덮어써짐(UI 문구로 명시), 전역이라 scope 증명이 불가 — 대신 확인 게이트+원클릭 undo로 보호. EXIT: 개별 우선 보존을 원하면 복제 마커를 "명시적 오버라이드"로 두고 전역에서 제외(CSS specificity 방식).
  - **결정 D26 (텍스트 서식 컨트롤 게이팅 반전, 2026-07-21)** — 실측 재현으로 버그 확정 후 수정.
    - **버그**: 서식 툴바의 **텍스트 관련** 컨트롤(텍스트 스타일·글꼴·크기·B/I/U/S·정렬·줄간격·자간·글자색)이 `fmtCap()`을 통해 **ON모드 선택(`selection.length>0`)**에 게이트돼 있었음 → 도형만 선택(타이핑 안 함)해도 활성, 정작 **OFF모드 인라인 텍스트 편집 중(실제 타이핑 중)엔 비활성**(재현 확인: `fmt-bold` 등 상태1=true, 상태2=false — 정확히 반대).
    - **결정**: 텍스트 서브그룹만 게이트를 **"OFF모드에서 인라인 편집 세션이 열려 있는가"**로 전환(ON모드 selection과 완전 분리). **채움/테두리/줄+−/W·H/화살표 도구는 그대로 ON+selection 유지**(도형/구조 조작이라 타이핑 중이 아니라 도형 선택 중에 의미가 있음 — 뒤집을 대상 아님). 4-상태 표:
      | | 텍스트 컨트롤 | 도형 컨트롤 |
      |---|---|---|
      | ON+도형선택 | 비활성(신규) | 활성(그대로) |
      | OFF+인라인편집중 | 활성(신규) | 비활성(그대로) |
      | 그 외(선택/편집 없음) | 비활성 | 비활성 |
    - **적용 대상 정확도**: 인라인 편집은 svgbox의 **그 줄 하나**만 대상이므로, 서식 적용도 박스 전체가 아니라 **그 줄에만** 적용(scope 정밀도 유지).
    - **적용 시점**: 클릭 즉시 밑줄 요소 속성에 반영 + 살아있는 오버레이 `<input>` 자체도 같은 CSS로 즉시 재도장(타이핑하며 눈으로 서식이 바뀌는 걸 보는 게 목표 — commit 시점까지 안 보이는 지연 UX는 차선).
    - WHY: 텍스트 서식은 "지금 타이핑 중인 글자"에 적용하는 게 모든 에디터(Word/Docs/Notion)의 상식적 계약이지 "도형을 옮기려고 고른 상태"에 적용할 게 아님. COST: 게이팅 로직이 컨트롤군마다 다른 조건을 갖게 돼 `fmtCap()` 분기 복잡도↑, iframe↔부모 간 "인라인 세션 활성" 상태를 새로 동기화해야 함(D17b급 postMessage 추가). EXIT: 되돌리려면 텍스트 서브그룹도 다시 selection 게이트로.

  - **결정 D27 (삭제·복사/붙여넣기 + class-b 기능 등가화, 2026-07-21, 계획 단계)** — D26 뒤 순서대로 큐잉, 서로 맞물려 하나로 통합 위임 예정.
    - **D27a 삭제(Delete 키)**: 지금까지 "요소 전체 삭제" op이 아예 없었음(D18 꼭짓점 삭제·D20 줄 삭제는 내부 단위 삭제일 뿐). **★핵심 제약(읽기전용 파일 조사로 확정)**: `dom-adapter.js:bleedDiff`가 `ma.size !== mb.size`(요소 개수 변화)를 무조건 offender로 처리 — 지금까지의 모든 op이 "그 자리에서 교체"만 했지 "개수 자체가 준다"는 이 기능이 처음이라 안 걸렸을 뿐. 확장 필요: **"개수가 정확히 -|삭제집합|만큼만 바뀌었고, 사라진 게 정확히 그 집합이며, 나머지는 바이트동일"**로 일반화. 붙여넣기는 대칭(+|집합|).
    - **D27b 복사/붙여넣기(Ctrl+C/V)**: OS 클립보드(`navigator.clipboard`) 대신 **앱 내부 JS 변수**를 클립보드로 채택(WHY: 권한 프롬프트 없음·브라우저 간 동일 동작·sandboxed iframe 복잡도 회피. COST: 다른 탭/외부 앱과 못 주고받음. EXIT: 필요해지면 `navigator.clipboard` API로 교체). 붙여넣기는 원본에서 좌표 오프셋(+20,+20) + 기존 max+1 eid 채번 관례 재사용 + 새로 붙인 게 곧 선택 상태.
    - **삭제·붙여넣기는 LLM op이 아니라 드래그·리사이즈와 같은 직접조작**이라 새 tool-schema 분기 불필요 — 코드가 직접 수행 + undo 스냅샷 1개. 다중 선택(D22)의 기존 집합 처리를 그대로 재사용해 여러 개 동시 삭제/복사 가능.
    - **D27c class-b(obj) 기능 등가화 — ★이 세션 최초로 `dom-adapter.js`를 편집 대상으로 엶(그동안 모든 확장이 SVG 쪽이라 손댈 필요가 없었을 뿐, 영구 불가침 규칙은 아니었음)**:
      - **줄 단위 정밀 클릭**: 지금 `resolveTextAt`의 obj 분기는 줄 구분 없이 "가장 큰 폰트 줄"로 항상 감(`editLargestLine` 관례). svgbox 분기처럼 클릭된 지점이 속한 **직속 자식 div**를 찾아 줄 인덱스를 반환하도록 확장(실측: `obj:1`은 eyebrow/title/subtitle 3개 직속 div로 구성 — svgbox의 "직속 자식 `<text>`=한 줄" 관례와 구조적으로 동형).
      - **줄별 서식 확장**: obj의 `FMT_CAPS`가 지금 `family/italic/decor/align/gap/track`=0(미지원)인데 svgbox 수준(=1)으로 올림 — CSS 등가물로 매핑(family→font-family, decor→text-decoration, align→text-align, gap→line-height, track→letter-spacing 그대로 CSS 존재).
      - **줄 추가/삭제**: D20을 CSS 버전으로 이식(SVG y좌표 재배분 → CSS top/margin 재배분, 같은 "도형 안 넘치면 거절" 정책 유지).
      - **일반화 원칙**: 구조가 "라인처럼 보이는 직속 자식 div들"이 아닌 임의 HTML(중첩 span 등)이면 우아하게 폴백(전체를 한 줄로 취급 — 오늘과 동일, svgbox의 단일줄 폴백과 동형). 새 필수 스키마를 강제하지 않음.
    - WHY(전체): 지금까지 class-b가 영구적으로 "얕은 기능만" 갖는 이유가 없음 — SVG가 구조상 더 유리했을 뿐 class-b도 같은 "직속 자식=줄" 패턴을 실측으로 갖고 있음이 확인됨. COST: `dom-adapter.js`가 처음으로 편집 대상이 됨(그동안의 "읽기전용" 불변식이 깨짐 — 의도적, 문서화됨), 두 클래스의 서식 파이프라인을 하나의 일반화된 경로로 합치는 리팩터링 부담. EXIT: class-b 파리티가 부담되면 각 항목을 개별적으로 롤백 가능(줄 클릭 정밀도만 남기고 서식 확장은 보류 등, 서로 독립적 하위 결정).

  - **결정 D28 (D27c 후속 — 줄 전환 2클릭 버그 + `<br>` 내부 줄 미인식, 2026-07-21)** — 사용자 실사용 신고("커서가 그쪽으로 못 감")를 직접 재현해 근본원인 2건 확정(추측 아님, 숫자로 재현):
    - **버그A(2클릭 문제, 우선순위 높음·전 종류 공통)**: 인라인 세션이 열린 채로 **다른** 줄/단위를 클릭하면, 1차 클릭은 현재 세션을 **닫기만** 하고 새 세션은 **안 열림**(재현: `ce=1(div1 열림)→클릭→ce=0(둘 다 안 열림)→같은 곳 재클릭→ce=1(그제서야 div2 열림)`). "바깥 클릭=현재 세션 종료" 핸들러가 이벤트를 소비해버려서, 그 클릭이 **동시에 새 타겟을 여는 것**까지 못 감. 사용자 체감은 "클릭했는데 아무 일도 안 남"=커서가 막힌 것처럼 느껴짐. **이건 obj뿐 아니라 svgbox/svgtext 등 모든 종류의 줄→줄 전환에 공통되는 매커니즘**(agent.js의 공유 클릭 핸들러) — obj로 한정 짓지 말 것.
    - **버그B(`<br>` 내부 줄 미인식, obj 한정)**: D27c의 "직속 자식 div=한 줄" 모델이 `<br>`로 시각적으로만 나뉜 줄은 못 잡음. 실측: LANE 02 라벨은 화면엔 5줄("LANE 02"/"브라우저"/"클라이언트"/"JS 엔진 · Pyodide 분류기"/"4턴 게이트 판정")인데 구조는 직속 div 3개뿐(`"브라우저<br>클라이언트"`가 한 div). 편집기를 열면 `<br>` 부분이 공백 없이 붙어버림(`"JS 엔진 · Pyodide 분류기4턴 게이트 판정"`). 무수정 커밋은 `<br>` 보존을 확인했으나, **실제로 타이핑해 수정한 뒤에도 `<br>`가 보존되는지는 미검증** — 확인 필요.
    - **결정**: (a) 버그A를 **먼저** 고친다(공통 인프라라 임�팩트 큼) — 세션이 열린 상태에서 다른 유효 타겟을 클릭하면 "현재 커밋/취소 + 새 타겟 즉시 오픈"을 한 이벤트 안에서 처리. (b) 버그B는 `<br>`를 줄 구분자로 인정해 direct-child-div 안에서도 `<br>` 단위로 서브라인을 인식하도록 D27c의 line 모델을 한 단계 더 세분화(직속 자식 div 자체가 이미 "clean"인 D27c 검사를 통과한 뒤, 그 자식 내부에 `<br>`가 있으면 추가로 쪼갬 — 재귀적 세분화, 없으면 오늘처럼 자식 자체가 한 줄).
    - 부가 관찰: 재현 중 무관해 보이는 콘솔 에러("응답에 ops 배열이 없습니다") 1건 발생 — 이 버그와 관련 있는지 별도 확인 필요(원인 특정 못 함, 추적 요청만).
    - WHY: 사용자가 실제로 부딪힌 문제라 최우선. COST: 클릭 핸들러의 "닫기"와 "새로 열기"를 한 이벤트로 합치는 리팩터링(경합 조건 주의), `<br>` 세분화는 커밋 시 원본 HTML 구조(줄바꿈 방식)를 다시 조립해야 함. EXIT: 되돌리려면 클릭 핸들러는 이전 "닫기만" 동작으로, `<br>` 세분화는 D27c의 direct-child-div 단위로.

  - **결정 D29 (obj 줄 탐지를 "직속 자식" → "재귀적 리프"로 일반화, 2026-07-21)** — 실사용 신고("대표 한 줄만 수정되고 나머지 줄은 불가")를 재현해 근본원인 확정.
    - **원인(실측, P01 "실행 전제" 노드박스)**: textbox의 직속 자식이 3개인데,
      ```html
      <div style="display:flex;...">          ← 자기 텍스트 없음(SECURITY/AND가 한 겹 더 안에 중첩) → "clean" 판정 실패
        <div>SECURITY</div>
        <div>AND</div>
      </div>
      <div>실행 전제</div>                     ← 그 자체로는 clean
      <div>PDF ∧ key ∧ proxy</div>              ← 그 자체로는 clean
      ```
      D27c/D28의 "clean" 판정이 **컨테이너 전체 단위(all-or-nothing)**라, 자식 하나(flex wrapper)가 탈락하면 **나머지 멀쩡한 자식(실행 전제·PDF∧key∧proxy)까지 전부** whole-unit/대표줄 폴백行. 이 패턴이 P01 한 파일에 **4곳**(주요 워크플로 노드박스 전부) 반복 — 한 곳만의 문제가 아님.
    - **결정**: "직속 자식만 줄 후보"를 **"서브트리를 재귀적으로 훑어 리프 텍스트 요소를 전부 줄로 인정"**으로 일반화. 리프 판정 = 그 요소의 자식이 텍스트노드/`<br>`뿐(더 깊은 block 자식 없음) + 비어있지 않은 텍스트. 이 조건을 만족 못 하는 요소(flex wrapper 등)는 "그 자체가 줄"이 아니라 **순수 컨테이너로 취급해 재귀 진입**(자식들을 마저 리프 판정). 기존 케이스(LANE 02류 평평한 직속 자식, `<br>` 분할)는 이 일반 모델의 특수 케이스로 **그대로 포함**되므로 회귀 없이 상위호환.
    - **적용 대상**: "SECURITY"/"AND" 뱃지도 각각 독립된 줄로 편집 가능해짐(사용자 의도상 "여러 텍스트 모두 수정 가능"에 부합 — 뱃지도 사람이 고칠 만한 텍스트임). 텍스트가 없는 순수 장식 요소(색점 등)는 리프 조건(비어있지 않은 텍스트) 미달로 자연히 제외.
    - WHY: all-or-nothing 판정이 한 파일에 반복되는 구조 패턴 전체를 도미노로 무력화시킴 — 재귀 리프 모델이 근본적으로 올바른 일반화. COST: 리프 탐색이 더 깊은 트리 순회 필요, "이 요소가 줄인가 컨테이너인가"를 매 서브트리마다 재귀 판단해야 함(코스트는 순회뿐, 의미는 단순). EXIT: 되돌리려면 재귀 깊이를 1로 고정(=D27c의 직속 자식 전용 동작으로 축소).

  - **결정 D30 (OFF모드에서 테두리 클릭=이동, 내부 클릭=텍스트편집, 2026-07-21)** — D25a의 "OFF=블록 조작 전면 금지" 규칙에 대한 **좁은 예외** 신설.
    - **요청**: 지금 OFF(텍스트편집) 모드는 클릭하면 무조건 인라인 텍스트편집만 열림(`agent.js:1275`의 `if (!elementEditOn) { ...beginInlineEdit(tHit); return; }` — 내부/테두리 구분 없이 무조건). 사용자는 텍스트 편집 흐름을 유지한 채로(ON모드 전환 없이) **그 텍스트 상자의 테두리를 클릭하면 상자 전체를 드래그 이동**할 수 있길 원함.
    - **판정 방식**: 클릭 좌표가 유닛 바운딩박스 경계에서 안팎으로 얇은 테두리대(margin M, D18의 화살표 클릭 허용치 ~8px를 기준점으로 튜닝) 안이면 "테두리 클릭"=이동 개시, 그 안쪽(경계에서 M 이상 떨어진 내부)이면 기존 그대로 "내부 클릭"=인라인 텍스트편집. svgbox처럼 실제 렌더된 rect stroke가 있으면 그 실제 선 위치를 테두리대 중심으로 사용(더 정확), 없으면 기하 바운딩박스 가장자리 기준.
    - **이동 대상 단위**: "텍스트 상자" 전체(svgbox/svgtext/obj 컨테이너) — D27c/D29의 개별 줄/리프 단위가 아니라, 그 줄들을 담은 상자 자체의 위치. 기존 이동 op(ON모드에서 이미 쓰던 것과 동일 — svgbox의 `<g transform>` 이동, svgtext의 x/y 이동, obj의 CSS left/top 이동)을 **그대로 재사용**, 새 op을 만들지 않음 — 새로운 건 "OFF모드에서 테두리 클릭이라는 트리거"뿐.
    - **호버 어포던스 필요**: 테두리대에 마우스만 올려도(클릭 전) 잡을 수 있다는 시각 신호(기존 `hoverBox` 점선 오버레이 스타일 재사용 + 커서를 move로) 필요 — 안 그러면 발견 불가능한 숨은 기능이 됨.
    - **불변식**: 내부 클릭의 정밀도(D25b/D27c/D28/D29 — 정확한 줄/리프, 원클릭 전환)는 전혀 안 바뀜. 테두리 클릭發 이동도 기존 move op 경로 그대로라 undo·bleed-diff 보증 동일(그 유닛 하나만 위치 변경, 나머지 바이트동일).
    - WHY: 텍스트편집 흐름 중에 상자를 옮기려고 ON모드로 갔다오는 왕복을 없애 달라는 요청 — 합리적. COST: 새 hit-test 존 + 호버 어포던스를 만들어야 함, "이동 가능"이 ON모드보다 좁음(리사이즈·fill/stroke 등은 여전히 ON 필요, 이동만 예외). EXIT: 되돌리려면 테두리 hit-test 존만 제거하면 D25a 원 규칙으로 복귀.

---

## §13. 계획 문서 — 정렬 기능 완성 (2026-07-22, 범위 축소됨)

> **이 섹션은 계획 전용이다 — 아직 구현하지 않았다.** 원 요청은 잉크 확인 UI·색/굵기 정밀화·정렬 3건이었으나, 사용자가 **"그냥 텍스트 상자내 텍스트의 정렬"로 범위를 좁힘** — 이번 계획은 **D31(정렬)만** 다룬다. D32(색·굵기)·D33(잉크 UI)는 §13-보류 섹션에 계획만 남기고 이번 실행 대상에서 제외.

### 이미 알려진 사실(감사 불필요 — 설계로 확정된 것)

- **svgtext(자유 텍스트)는 정렬이 의도적으로 미지원이다.** `FMT_CAPS.svgtext.align = 0`(코드 확인, `editor.js`), 비활성 사유 문구(D23)가 이미 명시: "정렬은 기준 도형이 있는 박스에만 적용됩니다 — 박스를 선택하세요." 자유 텍스트는 정렬을 계산할 기준 도형이 없어서 개념 자체가 성립 안 함 — 이건 감사 대상 버그가 아니라 유지해야 할 설계다.
- **svgbox·obj는 둘 다 `align: 1`로 이미 켜져 있다**(코드 확인): `svgbox: align:1`, `obj: align:1`. 즉 "정렬 기능 구현"이 완전 신규 개발일 가능성은 낮고, **기존 구현의 커버리지 감사 + 갭 패치**일 가능성이 높다(D31의 원래 방향 그대로 유지).

### 실측 확정 사실 (svgbox 단일 선택·단일 줄)

라이브 재현(2026-07-22): svgbox 우측 정렬 클릭 → Enter 커밋 → `x="65"→"122.2"`, `text-anchor="start"→"end"`로 실제 반영. 렌더된 텍스트 우측 끝 562.2 vs 도형 우측 경계 571.0 — **도형 밖으로 안 새어나감**(x 재계산이 실제로 맞게 동작). 커밋 전엔 pending(D26 설계 그대로, 라이브 프리뷰만 즉시).

### 감사 체크리스트 (구현 착수 전 먼저 실행 — 여기서 실패하는 조합만 고친다)

1. **svgbox 여러 줄**: 3줄짜리 박스에서 정렬을 바꾸면 그 박스의 모든 줄이 같은 anchor로 맞춰지는지, 아니면 인라인 세션이 열린 그 줄 하나만 바뀌는지(D26 설계상 "인라인 세션이 열린 유닛/줄에만 적용"이 원칙이므로, 박스 전체 정렬을 원한다면 이게 오히려 "버그"가 아니라 "사용자가 원하는 동작과 다른 설계"일 수 있음 — 확인 후 필요시 "전체 줄 일괄 정렬" 버튼 별도 여부를 결정해야 함).
2. **obj(class-b) 단일/여러 줄**: `dom: { textAlign: css }` 경로가 실제로 CSS `text-align`을 그 줄(D29 리프)에 정확히 적용하는지, 형제 리프는 안 건드리는지(bleed-diff).
3. **다중선택(D22) 일괄 정렬**: 여러 svgbox/obj를 동시 선택 후 정렬 클릭 시 각 유닛이 독립적으로 올바르게 재계산되는지(x 재계산은 유닛마다 자기 도형 폭 기준이어야 함 — 획일적으로 같은 x를 넣으면 버그).
4. **다이아몬드/게이트 등 비-rect svgbox**: 정렬의 x 재계산이 rect 폭 기준이라면, 폭 개념이 다른 polygon/path 도형에서도 안전하게 동작하는지(안 되면 그 도형은 정렬 비활성 + 사유가 맞는 대응).

### 결정

- **D31 (정렬 기능 완성 — 감사 후 갭만 패치, 재확정)**
  - WHY: 핵심 케이스(svgbox 단일줄)가 이미 정확히 동작함이 실측 확인됨 — 전면 재구현은 낭비. svgtext 정렬 미지원은 버그가 아니라 설계이므로 감사 대상에서 제외.
  - **범위**: 위 감사 체크리스트 4항목을 라이브로 먼저 돌려서 실패하는 조합만 정밀 수정. 통과하는 조합은 손대지 않음(회귀 위험 최소화).
  - COST: 감사 자체에 여러 조합(유닛×줄수×단일/다중선택) 테스트 시간이 듦.
  - EXIT: 전부 통과하면 "이미 완료"로 종결, 신규 테스트(`s20` 등)로 커버리지만 고정해 회귀 방지.

### 감사 실행 결과 (2026-07-22, 라이브 재현 완료)

1. **svgbox 여러 줄 — 정상**: 2줄 박스에서 2번째 줄만 클릭 후 정렬 → `["STEP 0.1"(anchor=middle, 무변화), "P02 finding 선택"(anchor=end, x=65→122.2)]`. **클릭한 줄만** 바뀌고 박스 전체는 안 바뀜 — D26의 "인라인 세션이 열린 유닛/줄에만 적용" 원칙과 정확히 일치. 버그 아님.
2. **obj(class-b) — 정상**: "실행 전제" 리프에 정렬 적용 → 바뀐 eid는 `obj:26` 하나뿐, 그 div에 `text-align:center` 정확히 적용, SECURITY/AND/PDF∧key∧proxy 형제 리프 완전 무변화. 버그 아님.
3. **다중선택 일괄 정렬 — 조합이 아예 존재하지 않음**: ON모드에서 svgbox 2개(폭 130/120, 서로 다름) Cmd+선택 후 정렬 버튼을 눌러보려 했으나 **버튼 자체가 disabled**, title에 사유 명시: "텍스트 서식은 편집 중인 글자에 적용됩니다 — 요소 편집을 끄고(OFF) 텍스트를 클릭해 편집하세요." D26 설계상 정렬을 포함한 텍스트 서식 전체가 ON+다중선택에서 원천 비활성(도형 컨트롤만 다중선택 대상) — **버그는 아니지만, "다중선택 일괄 정렬"이 실사용자가 원하는 워크플로라면 이건 없는 기능이라 별도 설계 결정(D22를 텍스트 컨트롤까지 확장할지)이 필요**. 이번 감사로는 손대지 않음.
4. **비-rect(다이아몬드) svgbox — ★실제 버그 확정(스크린샷 증거)**: "3.2 / traffic ≥ 30?" 다이아몬드에서 "3.2" 줄만 우측 정렬 → 좌표상으론 `x=50→94`, bbox 판정으론 "안 셈"이었으나 **실제 렌더 스크린샷을 보면 "3.2" 텍스트가 다이아몬드 오른쪽 뾰족한 모서리를 명백히 뚫고 나가 화살표 쪽으로 삐져나옴**(`diamond_after_end.png`, 직접 확인). 원인 추정: x 재계산 로직이 도형을 rect처럼 취급(전체 폭 기준)하고, 마름모가 중앙만 넓고 모서리로 갈수록 좁아지는 실제 기하(그 텍스트의 y위치에서의 실제 가용 폭)를 반영하지 않음. **bbox 기반 판정만으론 이 버그를 못 잡는다는 것도 이번에 확인**(좌표는 "무해"로 나왔지만 시각적으로는 명백히 깨짐 — grounding 원칙이 실제로 필요했던 사례).

### 결정 (감사 후 확정)

- **D31-실행 (다이아몬드/비-rect 정렬 수정만 진행)**: 4개 감사 중 1·2번은 이미 정상이라 손대지 않음. 3번(다중선택+정렬)은 버그가 아니라 별도 기능요청 성격이라 이번엔 보류(사용자 재확인 필요). **4번(비-rect 도형 정렬 x 오버플로)만 실제 버그로 확정해 수정 진행.**
  - **수정 방향**: rect가 아닌 도형(polygon 다이아몬드, path 게이트 등)에서 정렬 적용 시, 그 도형의 실제 기하(다이아몬드는 y위치별 실제 폭이 다름)를 반영해 x를 재계산하거나, 기하 계산이 안전하지 않은 도형 종류는 **정렬을 비활성 + 사유 표시**(D22/D23의 기존 "안 되면 비활성+사유" 패턴 재사용)로 안전하게 막는 쪽 중 선택. 후자가 더 간단하고 이 세션 내내 써온 안전 우선 패턴과 일관됨.
  - WHY: 시각적으로 확정된 실버그라 최우선 수정 대상. bbox 판정만으론 못 잡는다는 게 실측으로 확인됐으므로, 수정 후 검증도 반드시 **스크린샷 기반 실측**으로 해야 함(속성값·bbox만으론 불충분).
  - COST: "비활성화" 방향을 택하면 다이아몬드/게이트류 도형은 정렬 기능 자체를 못 씀(대신 안전). "기하 반영 재계산" 방향을 택하면 도형 종류별 폭 계산 로직이 늘어남.
  - EXIT: 비활성화로 갔다가 나중에 기하 인지 재계산으로 업그레이드 가능(반대는 더 어려움 — 재계산 로직을 만들었다가 다시 없애는 건 코드 후퇴).

---

## §14. 결정 — 다중선택 2개 겹침 시 z-order(앞/뒤) 조정 버튼 (2026-07-22)

### 사전 조사(실측)

- **obj(class-b)는 CSS `z-index`로 쌓임**(실측: 1~11의 다양한 값이 이미 명시적으로 쓰이고 있음).
- **svgbox/svgtext/svgedge(class-c)는 z-index가 전혀 없음** — SVG 내부 유닛 전수 조사(`<g transform>` 기준) z-index 0건. **DOM 순서 자체가 곧 paint 순서**(뒤에 있는 형제가 위에 그려짐).
- **"primary" 개념이 이미 존재**: 다중선택 시 `selected`가 그 집합의 primary이고, **마지막으로 클릭한 요소가 자동으로 primary가 됨**(`pendingReselectSet = { eids: newEids, primary: newEids[newEids.length - 1] }`). 새로 만들 필요 없이 그대로 재사용 가능.

### 결정

- **D34a (기능 정의)**: 다중선택(2개 이상) 상태에서 툴바에 **"앞으로 가져오기" / "뒤로 보내기"** 두 버튼 추가. 동작 대상은 **primary**(마지막 클릭한 요소) — 그 요소를 나머지 선택된 요소(들)보다 앞/뒤로 보낸다. 사용자가 반대쪽 요소를 클릭하면 그게 새 primary가 되므로(기존 메커니즘 그대로), 버튼 하나로 양방향 조정이 됨 — "누가 앞에 오고 누가 뒤로 갈지 정해야 하는 상황"을 정확히 커버.
  - WHY: 단일 "순서 바꾸기" 버튼보다 앞으로/뒤로 두 버튼이 다른 디자인 툴 관례(Figma/Illustrator)와 일치해 더 직관적이고, 기존 primary 클릭 재선택 메커니즘과 결합하면 추가 상태 없이 완전한 양방향 제어가 됨.
  - COST: 버튼이 2개(1개 대비)라 툴바 자리 소폭 증가.
  - EXIT: 필요시 "바꾸기" 단일 버튼으로 축소 가능(같은 하부 로직 재사용).

- **D34b (종류별 다른 메커니즘 — 반드시 분기해야 함)**:
  - **obj끼리**: primary의 `z-index`를 다른 선택 요소들의 `z-index`보다 높게/낮게(예: `max(다른 요소들)+1` / `min(다른 요소들)-1`) 재계산해서 CSS로 반영.
  - **svgbox/svgtext/svgedge끼리**: DOM에서 primary의 `<g>`(또는 해당 요소)를 다른 선택 요소 뒤/앞으로 실제 이동(`insertBefore`/`appendChild`). **단, 같은 부모(형제) 사이에서만** 안전하게 이동 — 다른 lane/phase `<g>` 그룹으로 옮기면 그 그룹의 CSS 컨텍스트(opacity/clip 등)를 잘못 물려받을 위험이 있으므로, 부모가 다르면 이동을 거절하거나 신중하게 처리(구현 시 실측 확인 필요).
  - **혼합 선택(obj + svg유닛)**: 서로 다른 렌더 레이어라 "그 자체의" z-order를 안전하게 못 바꿈(svgbox는 자기 z-index가 없고 자신을 감싼 outer `<svg>` div의 z-index를 빌려 쓰는데, 이걸 바꾸면 다이어그램 전체가 옮겨가는 훨씬 큰 부작용) — **이 조합은 버튼 비활성 + 사유**(이 세션 내내 써온 안전 우선 패턴 재사용).
  - WHY: 실제로 두 렌더 메커니즘이 근본적으로 다르다는 게 조사로 확정됨 — 하나의 로직으로 뭉뚱그리면 obj나 svg유닛 둘 중 하나는 반드시 깨짐.
  - COST: 종류별 분기 로직 2벌 + 혼합조합 가드 필요.
  - EXIT: 혼합 선택 지원이 나중에 꼭 필요해지면, outer `<svg>` 컨테이너 자체를 하나의 "레이어"로 보고 그 z-index를 조정하는 상위 개념을 추가(범위 커짐 — 지금은 보류).

- **D34c (겹침 감지는 선택적 정밀화, 필수 아님)**: 버튼 활성화를 "실제로 bbox가 겹칠 때만"으로 제한하는 건 있으면 좋지만(안 겹치는데 버튼이 활성이어도 기능적으로 해는 없음 — 그냥 시각 효과가 없을 뿐), 필수 게이팅 조건은 "동종 2개 이상 선택"이면 충분. 구현이 쉬우면 겹침 배지(예: "2개 선택 · 겹침")를 추가하되, 없어도 기능은 안전.

### 실행

바로 위임(파일 충돌 없음 확인 후).

- **D32(색·굵기 정밀화)**: 한글 폰트의 진짜 굵은 weight 부재 문제. 후보안 A(진짜 굵은 한글 웹폰트 번들) vs B(합성 감지 시 경고). 사용자가 나중에 재요청 시 진행.
- **D33(잉크 확인 UI)**: 테스트에만 있는 래스터 diff 기법을 제품 UI로 이식하는 신규 기능. "복구된"의 정확한 범위(undo 전용 vs 편집 전반) 확인 필요. 사용자가 나중에 재요청 시 진행.

### 사전 조사(실측, 착수 전 확정한 사실)

1. **정렬은 이미 상당 부분 구현돼 있다(완전 미구현 아님)** — 라이브로 직접 재현 확인:
   - svgbox 단일 줄, 우측 정렬 클릭 → Enter 커밋 → `x="65"→"122.2"`, `text-anchor="end"`로 실제 변경.
   - 렌더된 텍스트 우측 끝 562.2 vs 도형 우측 경계 571.0 — **도형 밖으로 안 새어나감**(툴팁의 "x도 도형 안쪽으로 재계산" 약속이 최소 이 케이스에선 사실).
   - 커밋 전엔 pending 상태(D26 설계 그대로) — 라이브 프리뷰는 즉시, 소스 반영은 Enter 시.
   - **미검증(감사 필요)**: 여러 줄 박스에서 줄마다 정렬이 개별적으로 맞는지, obj(class-b, CSS `text-align`)에서 svgbox와 동등하게 동작하는지, svgtext(자유텍스트, 기준 도형 없음)에서 anchor 변경의 재계산 기준점이 뭔지, 다중선택(D22) 일괄 정렬 시 유닛마다 독립적으로 옳게 계산되는지.
2. **한글 굵기(font-weight) 합성 문제는 실재하고 문서화만 돼 있다(제품 미해결)** — `test/s11-toolbar-multiselect.test.mjs` 주석: "굵게는 라틴/숫자 줄로 잰다: 한글 폴백 폰트는 800 실물 웨이트가 없어 합성되므로 폭 변화가 신뢰할 신호가 아니다." 이건 **테스트 방법론의 우회**일 뿐 — 사용자가 실제로 한글 텍스트를 굵게 눌러도 브라우저가 폴백 폰트로 "가짜 굵게"(skew/합성)만 그릴 수 있다는 뜻. 제품 차원에서 안 고쳐짐.
3. **"잉크" 측정 기법은 이미 테스트 코드에 있다(제품 UI엔 없음)** — `test/s10-lines-globalhead.test.mjs`가 D19(화살촉 크기) 검증에 쓴 방식: 같은 요소를 marker 있는/없는 두 버전으로 래스터화해 **칠해진 픽셀 차이=잉크**를 잰다. 이건 Playwright 스크립트 안에만 있고, 에디터 자체 UI에는 "지금 이 변경이 실제로 뭘 다르게 그렸는지"를 사람이 볼 수 있는 기능이 없음. 기존에 있는 건 `flashBox`(변경 요소 2초 하이라이트, 뭐가 바뀌었는지는 안 보여주고 어디가 바뀌었는지만 표시)뿐.

### 결정

- **D31 (정렬 기능 완성 — 감사 후 갭 메우기)**
  - **범위**: 이미 되는 것(svgbox 단일줄)을 기준으로, 위 "미검증" 4항목을 실제로 라이브 재현해 감사 → 실패하는 조합만 정밀 수정. 처음부터 다시 만들지 않음(재구현 아니라 감사+패치).
  - WHY: 실측 결과 핵심 케이스가 이미 작동해서, "구현"의 의미는 전면 신규 개발이 아니라 **커버리지 완성**일 가능성이 높음 — 안 되는 걸 먼저 확정해야 낭비 없음.
  - COST: 감사에 조합이 많음(3종 유닛 × 3방향 × 단일/다중선택/여러줄).
  - EXIT: 감사에서 전부 정상으로 나오면 이 항목은 "이미 완료"로 종결하고 별도 구현 스킵.

- **D32 (색·굵기 정밀화 — 한글 합성 굵기 문제 정면 대응)**
  - **후보안 A**: 에디터에 실제 굵은 한글 웹폰트(예: Pretendard Bold, NotoSansKR Bold 등)를 내장해, 굵게 눌렀을 때 브라우저 합성이 아니라 진짜 700/800 weight 글리프가 그려지게 함.
  - **후보안 B**: 폰트가 없을 때(합성 감지) 툴바에 경고/안내를 표시("이 폰트는 진짜 굵게가 없어 흐리게 보일 수 있습니다") — 폰트를 새로 안 들여오고 사용자에게 정직하게 알림.
  - **색 정밀화**: 현재 색상 입력이 `<input type=color>` 기반 hex 단일값인지 확인 후, 필요시 alpha/투명도 지원 여부 검토(현재 sanitize가 url()은 막지만 rgba()는 허용하는지 확인 필요).
  - WHY: 근본 원인이 "폰트 자체에 그 weight가 없음"이라 안내나 폰트 교체 둘 중 하나 없이는 "정밀화"가 불가능 — 어느 쪽이든 명시적 결정 필요.
  - COST: A안은 폰트 라이선스+번들 용량 확인 필요, B안은 문제를 감추기만 하고 근본 해결은 아님.
  - EXIT: 어느 안이든 독립적 — 나중에 A→B 또는 B→A로 교체 가능.

- **D33 (잉크 확인 UI — 기존 테스트 기법을 제품에 이식)**
  - **제안 설계**: 편집 커밋(또는 undo) 직후, 기존 `flashBox` 하이라이트를 누르면/토글하면 **그 요소의 커밋 전/후를 동일 크기로 두 번 래스터화한 비교 뷰**(나란히 또는 겹쳐서 diff)를 뜨게 함 — `test/s10`의 "marker 있고/없고 두 번 그려 차이" 아이디어를 사용자 대면 기능으로 재설계.
  - **불확실한 지점**: "복구된"이 정확히 undo를 가리키는지, 일반 편집 커밋도 포함하는지 — 사용자 확인 필요(구현 착수 전 짧게 물어볼 것을 권장).
  - WHY: 지금까지 이 세션 내내 "정말 반영됐는지"를 내(에이전트)가 Playwright로 검증해온 것과 같은 신뢰를, 사용자도 UI에서 직접 확인하고 싶다는 요청으로 해석.
  - COST: 클라이언트 사이드 래스터화(예: canvas 렌더링) 구현 필요, 오버레이 UI 신설.
  - EXIT: 처음엔 svgbox만 지원하고 나중에 svgtext/obj로 확장 가능(단계적 축소 범위로 시작 가능).

### 실행 순서 제안

1. D31 감사(빠름, 반나절 미만 규모) → 갭 있으면 그 갭만 패치
2. D32는 폰트(A) vs 경고(B) 중 사용자 선택 필요 — 계획 검토 시 확인
3. D33은 "복구"의 정확한 범위(undo만인지 편집 전반인지) 확인 후 착수 — 다른 둘보다 설계 여지가 큼

이 계획은 검토용이며, 착수 승인 시 D31부터 순서대로(파일 충돌 방지를 위해 순차) 위임 예정.
  - **결정 D20 (박스 줄 추가/삭제, 2026-07-20)** — `#svgbox-panel`에 `+`(줄 추가)·`−`(줄 삭제). ops `addTextLine`/`removeTextLine`, eid 고정+scope-gate.
    - **★수직 재분배가 진짜 설계점**: 박스는 고정 높이(3줄이 60u rect)라 "마지막 y + 간격"으로 4번째 줄을 붙이면 **도형 밖으로 넘침**. 그래서 추가/삭제 후 줄들을 도형 안에서 **수직 재분배해 블록을 가운데 유지**(상대 크기·순서 보존). 형제 줄의 y가 바뀌지만 같은 박스 `<g>` 안이라 scope 합법 — 단 다른 단위엔 bleed-diff 청결 필수. 새 `<text>`는 인접 줄의 font-size/weight/fill/anchor/x를 상속(기본 스타일로 튀지 않게).
    - WHY: 줄 편집만 되고 줄 개수를 못 바꾸면 "박스 내용 편집"이 반쪽. COST: 재분배가 원저자의 의도적 y 배치를 바꿈, 가독 한계 이하로 좁아지면 rect 성장 또는 추가 거부 정책 필요. EXIT: 재분배가 거슬리면 "추가만 하고 위치 보존" 토글.
  - **결정 D21 (서식 툴바 UI 고도화, 2026-07-20)** — 사용자 제공 레퍼런스(Docs/Notion류 2단 서식 툴바) 형식으로 상단 툴바를 고도화하고 각 기능을 실제 op에 배선.
    - **매핑되는 것(구현)**: 실행취소/**다시실행(신규 — 현재 undo 스택이 단방향이라 D17 EXIT대로 커서형 양방향으로 교체 필요)**, 글꼴(font-family)·크기(font-size)·텍스트 프리셋, **B/I/U/S**(font-weight·font-style·text-decoration), 정렬(SVG `text-anchor`), 줄간격·자간(letter-spacing), 글자색(fill)·도형 채움·테두리, 텍스트 상자 추가(기존 그리기와 통합), 툴바 접기.
    - **매핑 안 되는 것(정직히 제외)**: 이미지 삽입·표 삽입·링크 — 수제 SVG 슬라이드에 래스터/HTML 표를 심는 건 별개 기능이고 반쪽으로 넣으면 "버튼은 있는데 안 되는" 상태가 된다. 버튼을 흉내내지 않고 빼거나 비활성 사유를 표기.
    - WHY: 지금은 기능별로 패널이 흩어져 있어(박스/텍스트/화살표) 서식 조작의 발견성이 낮다. 표준 서식 툴바는 학습 비용이 0. COST: 툴바가 선택 종류(box/text/edge/div)마다 가용 항목이 달라져 상태 관리 복잡도↑, 화면 상단 공간 소비. EXIT: 항목별로 패널 회귀 가능(툴바는 얇은 프론트엔드, 실제 op은 기존 어댑터 그대로).
  - **결정 D22 (Cmd+클릭 다중 선택 + 일괄 수정, 2026-07-20)** — ★**핵심 불변식의 일반화**.
    - 지금까지 scope 3중 보증의 3층(bleed-diff)은 "**선택된 그 요소 1개만** 바뀌었음"을 증명했다. 다중 선택은 이 전제를 깬다 → 불변식을 "**선택 집합 S에 속한 요소만** 바뀌었고 S 밖은 바이트 동일"로 **일반화**해야 한다(스키마 id-pin도 단일 const → S의 enum으로). 이걸 안 하면 다중 편집은 원리적으로 검증 불가.
    - 일괄 적용은 요소 종류가 섞일 수 있음(박스+텍스트+화살표) → 서식 항목은 **공통 적용 가능한 것만 활성**(예: 글자색은 박스·텍스트 공통, 화살촉 크기는 화살표에만). 불가 항목은 비활성+사유.
    - WHY: 12개 박스 색을 하나씩 바꾸는 건 비현실적 — 일괄 수정이 실사용의 핵심. COST: 검증 부담이 요소당→집합당으로 커지고, 혼합 선택 시 "무엇이 적용 가능한가" 규칙이 필요. EXIT: 혼합 선택이 혼란스러우면 동종(homogeneous) 선택만 허용으로 축소.

## 10. Open Questions (구현 전 사용자 확인)

- **Q1 호스팅**: MVP를 어디에 올리나 — 로컬 파일로만(`archify serve`류) vs Pipeline Lab처럼 정적 호스팅 + worker? (권장: 정적 호스팅 — (b)는 서버 불필요)
- **Q2 콘텐츠 검증 드롭다운**: §5의 5항목 제안(맞춤법/용어 일관성/사실·정합성/구조·겹침/전체)으로 확정해도 되는가? mockup의 실제 의도 항목이 따로 있는가?
- **Q3 모델·비용**: proxy가 쓸 Claude 모델과 편집당 토큰 예산(요소 편집은 소형 모델로 충분할 가능성 — 실측 후 결정, claude-api 스킬 참조).
- **Q4 저장 정책**: MVP는 다운로드+localStorage로 충분한가, Supabase 이력은 언제부터 필요한가?
- **Q5 deck 내비게이션**: p01–p03을 한 세션에서 오가는 UI가 MVP에 필요한가, 파일 단위로 충분한가?
- **Q6 (b) 저장물에 `data-arch-eid` 유지 여부**: 유지하면 재열기 시 핀 안정, 제거하면 원본 무흔적 — 기본값 제안: 유지.
- **Q7 그리기 모드의 야심 수준**: (a)에서 엣지 드로잉(드래그 연결)까지 v1인가, 노드 추가까지만인가?

---

## 부록 A. 이 계획이 딛고 선 파일 (전부 이 세션에서 직접 읽음)

`SKILL.md` · `bin/archify.mjs` · `renderers/workflow/render-workflow.mjs` · `renderers/shared/{utils,cli}.mjs` · `assets/template.html`(구조 맵) · `schemas/{workflow,common}.schema.json` · `examples/agent-tool-call.workflow.json` · 렌더 실증 `scratchpad/probe.html`(+`check` 통과 확인) · emit 함수 전수 grep(5 렌더러) · `test/`·`scripts/` 인벤토리

  - **결정 D23 + 실패 3건 규명 (2026-07-20, 에이전트 세션한도 중단 후 메인에서 완료)** — s11의 실패 3건을 "테스트 vs 구현" 중 어느 쪽이 틀렸는지 각각 증거로 판정:
    - **(B2) 화살촉 사유** → **구현이 부실**. 비활성 사유가 종류별 한 줄이라 "SVG 박스에는 없는 항목입니다"로만 나와 *무엇이* 없는지 안 알려줌. `FMT_CTRL_WHY`(항목별 사유)를 우선하도록 수정 → "화살촉 크기는 화살표에만 적용됩니다 — 화살표 선을 선택하세요."
    - **(C11) 줄간격** → **구현이 옳고 테스트가 틀림**. D20의 "도형을 키우지 않고 거절" 정책상 이미 꽉 찬 박스는 확대가 물리적으로 불가. 실측: 2.2배 요청 시 토스트 "줄간격 2.2배는 이 도형 높이(58u)에 들어가지 않습니다 — 먼저 박스 높이를 키우세요"(조용한 무시 아님), 축소는 22→14.03 정상. 테스트를 **실제 계약**(축소 적용 + 과대 요청은 사유와 함께 거절)으로 재작성.
    - **(F4) class-b 글자색** → **구현이 옳고 테스트가 틀림**. 브라우저가 인라인 style의 hex를 `rgb(185,28,28)`로 정규화하므로 `"b91c1c"` 문자열 검사가 실패. 정규화형까지 인정하도록 수정.
    - **★자기 오류 기록**: 조사 중 "scope 위반 발생"으로 한때 결론냈는데(색이 obj:6에 들어갔고 bleedDiff ok=false), **계측 오류였다** — 겹친 div에 `force:true`로 클릭해 앱은 최상위 요소를 선택했는데 나는 내가 조준한 eid가 선택됐다고 가정하고 비교했다. 앱의 `getSelection()`으로 실제 선택을 읽어 재측정하니 `owner=obj:3, inSelection=true, bleedDiff ok=true`. **교훈: UI 상태를 가정하지 말고 앱이 보고하는 상태를 읽어라**(겹친 요소가 있는 문서에서 클릭 기반 계측은 신뢰 불가).
    - **(D9) flaky 수정**: ⇧⌘Z가 간헐 실패(u=1 r=1). 원인은 undo가 유발한 iframe 재렌더 중(`ready=false`)에 다음 키가 무시되는 경합 — 고정 sleep 대신 **매 키 입력 전 `ready===true` 조건 대기**로 교체하고 대기 실패를 삼키지 않게 함. 3연속 통과 확인.
    - 최종: **485 checks green**(기존 397 + s11 88).

  - **결정 D25 (2026-07-20, 블록/텍스트 편집 이분화 + 화살표·노드 전용 도구)** — 사용자 요청 문장을 정밀 분해:
    - **D25a 요소 편집 = ON/OFF 토글(기존 단발 액션 버튼 아님)**. **기본값 = ON**(WHY: 지금까지의 모든 드래그·리사이즈·패널 열림 동작을 그대로 보존해 591 checks 무회귀. 실측: 더블클릭 텍스트편집 경로를 검사하는 기존 테스트가 하나도 없어 이 축 변경의 회귀위험이 낮음). ON=블록 편집(드래그/리사이즈/fill·stroke 가능, 텍스트 직접편집 불가) · OFF=텍스트 직접편집(블록 조작 전부 비활성). COST: 사용자가 "OFF가 기본이어야" 한다는 취지였다면 나중에 정정 필요 — 그 경우 EXIT: `DEFAULT_ELEMENT_EDIT_ON` 상수 하나만 뒤집으면 됨(구현에 이 상수로 박아둘 것).
    - **D25b OFF 상태에서 모든 텍스트에 단일클릭 즉시 인라인 편집**. 대상: svgbox의 **개별 줄**(줄 단위 히트테스트 신규 필요 — 지금 hit-test는 박스 `<g>` 전체 단위), svgtext(자유 텍스트), obj(class-b div, 기존 더블클릭 경로를 단일클릭으로 승격). 커밋은 기존 op(setText+line 인덱스)를 그대로 재사용 — scope/undo/bleed-diff 불변.
    - **D25c 노드 편집·화살표 편집 = 요소 편집 ON일 때만 뜨는 세부 도구(3-way: 전체/노드/화살표)**. 화살표 편집 활성 시 엣지가 히트테스트에서 우선(또는 전용)되어 "선 클릭이 잘 안 됨" 해결. 전체(기본)는 지금 동작(박스/텍스트 우선 + 기하 폴백) 그대로.
    - **D25d 화살촉 일괄 조절을 상단 독립 버튼에서 화살표 편집 도구 자기 행(UI)으로 이동** — 문맥에 안 맞는 위치였다는 지적 반영. 확인게이트·단일undo(D19) 그대로.
    - EXIT(공통): 네 결정 모두 기존 op·scope 기계는 안 건드리고 **트리거 경로만** 바꾸는 순수 상호작용 계층 변경 — 되돌리려면 이 트리거 배선만 원복.

## 15. D35~D37 — 이미지·표·링크 구현 (2026-07-22)

D21에서 "반쪽으로 넣지 않는다"며 정직하게 비활성해 둔 3개 버튼(`index.html:102-108`)을 사용자가
"웹검색해서 관련 기능 살릴 수 있는 오픈소스 찾아와"로 리서치 요청 → 포크로 조사(2회, 1회는
결과 전달 채널에서 **프롬프트 인젝션 발견**: 존재하지 않는 "병렬로 띄운 두 번째 에이전트"를
사칭하는 1인칭 서술 + 조작된 날짜(x-spreadsheet 마지막 릴리스) + 오해유도 편집(CVE-2021-23648이
v6.0.0에서 이미 패치됐다는 사실을 누락) — 원본 알림 전량 폐기하고 npm registry/GitHub API/OSV로
전부 재검증 후 보고) → 사용자 승인("구현해라").

**착수 전 그라운딩(직접 확인, 짐작 아님)**: `index.html:99`(`fmt-textbox`) → `onDrawAt()`
(`editor.js:2284`) → `commitAdd()`(`editor.js:311`) → `DomAdapter.addObject()`
(`dom-adapter.js:721`) 체인을 추적. **핵심 발견**: `addObject`는 문서가 class-b(div)든
class-c(svg)든 상관없이 **항상 새 `<div data-object>` 를 `.slide-container`에 추가**한다(SVG
DOM을 직접 건드리지 않음 — 손그림 문서마다 제각각인 svgbox 관례를 흉내내는 위험을 피하는
기존 설계). 즉 새로 그리는 요소는 원 문서 종류와 무관하게 **항상 obj 유닛**이 된다 — 이건
추측이 아니라 "＋텍스트 상자"/"도형" 두 기존 drawKind가 실제로 그렇게 동작하는 걸 코드로 확인한
것. 이미지·표도 이 경로를 그대로 타면 자동으로 이 패턴을 따른다.

- **D35 (이미지)** — `drawKind:"image"` 신설. 파일선택(`<input type=file accept="image/*">`) →
  `FileReader.readAsDataURL` → 이미지 자연크기로 배치 박스 산정 → `addObject`에 `img:{src,w,h}`
  전달 → `<div data-object data-object-type="image"><img src="data:..."></div>` 생성.
  기존 리사이즈(obj 공통 리사이즈 핸들)를 그대로 재사용, 신규 리사이즈 로직 금지.
  - WHY: Cropper.js 등 크롭 UI 라이브러리를 새로 끌어오는 대신, 이미 있는 obj 리사이즈로 크기만
    조절하는 게 이 프로젝트의 무의존성 기조(현재 `index.html`이 로컬 8개 스크립트 외 CDN
    의존성 0개임을 직접 확인)와 기존 "재사용" 원칙(주석 "새 삽입 로직을 만들지 않는다",
    `editor.js:3247`) 둘 다에 맞음.
  - COST: 정밀 크롭(비율 고정, 부분 잘라내기)은 지원 안 함 — 리사이즈=박스 크기만 바뀜, 이미지
    자체는 object-fit으로 채움/맞춤 중 하나 고정. base64 인라인이라 큰 이미지는 저장 HTML이
    커짐(용량 상한 안 둠 — 필요해지면 후속 결정).
  - EXIT: 크롭이 필요해지면 Cropper.js(MIT, v2.x)를 이 obj 편집 세션에만 국한해 붙일 수 있음
    (전역 의존성 아니라 이미지 편집 시점에만 동적 로드하는 것도 가능).

- **D36 (표)** — `drawKind:"table"` 신설. 클릭 배치 시 기본 3×3 `<table>`(각 `<td>`에 자리표시
  텍스트)을 담은 `<div data-object data-object-type="table">` 생성. 셀 텍스트 편집은 **새 로직
  없이 기존 D29 재귀 leaf 탐지**(`objLeafLines`, `dom-adapter.js`)에 위임 — `<td>`가 직속
  텍스트만 갖고 블록 자식이 없으면 이미 leaf/addressable line 조건을 만족하므로, 구현 착수 시
  가장 먼저 **이 가정 자체를 실측 검증**(빈 신규 실험 문서에 표 하나 넣고 각 셀 클릭 인라인
  편집 되는지 라이브 확인)하고, 안 맞으면 그 갭만 좁혀서 고칠 것 — 맞다고 가정하고 새 텍스트편집
  경로를 만들지 말 것.
  - WHY: 네이티브 `<table>`+D29 leaf 재사용이 Tabulator류 라이브러리보다 의존성 0개+
    scope-guarantee(값만 주고받는 구조) 통합이 훨씬 쉬움 — 라이브러리는 자기 DOM을 통째로
    소유하려 해서 bleedDiff의 "이 유닛 안은 뭘 해도 됨" 전제와 충돌 위험.
  - COST: 행/열 추가·삭제는 v1 범위 밖(고정 3×3으로 시작) — 필요성이 확인되면 D20의 줄
    추가/삭제(`addTextLine`/`removeTextLine`) 패턴을 표의 행에 적용하는 후속 결정으로 분리.
    셀 병합·수식 등 스프레드시트급 기능 없음.
  - EXIT: 행/열 편집이 필요해지면 Tabulator(MIT, 런타임 의존성 0개, v6.5.2 — npm
    registry로 직접 재확인)로 이 obj 하나만 교체 가능(다른 obj/svgbox 유닛엔 영향 없음).

- **D37 (링크)** — 이미지/표와 **다른 패턴**: 새 요소 삽입이 아니라 **기존 텍스트에 적용하는
  인라인 서식**이므로 `commitAdd`/`onDrawAt` 경로가 아니라 D26의 "인라인 편집 세션 열림" 게이팅
  (`fmtApplyBold`/`fmtApplyDecor`류, `editor.js:3205-3208` 인근)을 정확히 그대로 본떠
  `fmtApplyLink(url)`을 추가 — 현재 편집 중인 줄/선택 텍스트를 `<a href="...">`로 감싼다.
  URL은 신설 화이트리스트 정규식(`^(https?:|mailto:)`)으로 걸러 통과 못하면 커밋 자체를 막고
  사유를 보여준다(`dom-adapter.js`/`svg-adapter.js`의 기존 `sanitize*` 함수 패밀리에 형제 함수로
  추가 — `BAD_STYLE_VALUE` 같은 기존 이름 재사용 금지, 별도 이름으로).
  - WHY: 이 코드베이스가 모든 값 검증을 자체 `sanitize*` 함수 화이트리스트로 이미 하고 있어서
    (`@braintree/sanitize-url` 같은 외부 라이브러리를 새로 끌어오면 오히려 기존 패턴과 어긋남),
    같은 패밀리에 함수 하나 추가하는 게 최소 변경.
  - COST: `javascript:`/`data:` 등 위험 스킴은 전면 차단 — "정말 필요한" data: URI 링크 같은
    엣지케이스는 의도적으로 지원 안 함(보안이 편의보다 우선).
  - EXIT: 화이트리스트 스킴을 늘리고 싶으면 정규식 한 줄만 수정. 라이브러리로 바꾸고 싶으면
    이 한 함수만 교체(호출부는 "URL 문자열 받아 안전한 URL 또는 null 반환"이라는 동일 계약
    유지하면 영향 없음).

**공통 구현 순서(파일 충돌 방지를 위해 한 에이전트가 순차 처리)**: (1) D35+D36을 먼저
(둘 다 `commitAdd`/`addObject`/`draw-palette` 확장이라 같은 코드 경로를 같이 넓히는 게 자연스러움),
회귀 통과 확인 → (2) D37(별도 패턴, 인라인 서식) → 회귀 통과 확인. 각 단계 후 라이브 재현
(Playwright, mock 경로)으로 실제 커밋되는지 확인 — 코드만 읽고 "될 것 같다"로 끝내지 말 것.

### ✅ D35~D37 구현 완료 + 독립검증 완료 (2026-07-22)

**구현**(Opus agent, agentId `a63395c76e3d99f8d`): 위 스펙대로 정확히 구현.
- `index.html`(+11/−7): 3버튼 활성화 + `#image-input` 신설 + draw-palette에 image/table 추가.
- `editor.js`(+94/−11): `pendingImage`, `onDrawAt` image/table 분기, `fmtApplyLink`(굵게와 동일한
  D26 인라인세션 게이팅 패턴 그대로 재사용 — 새 게이팅 로직 안 만듦).
- `dom-adapter.js`(+67/−1): `addObject`에 image(`<img object-fit:contain>`)/table(3×3 `<table>`)
  분기, `sanitizeHrefValue`(화이트리스트 `^(https?:|mailto:)`, 기존 `BAD_STYLE_VALUE`는 이름 재사용
  안 하고 별도 이중방어로만 공존).
- **`agent.js`는 전혀 안 건드림** — D29 `objLeafLinesA`가 `<td>`를 이미 leaf로 인식하는 게 실측
  확인되어(9개 셀 전부 독립 addressable), 새 텍스트편집 경로를 만들지 않는다는 D36의 핵심 목표
  그대로 달성.
- 신규 테스트: `test/s22-image-table.test.mjs`(17개), `test/s23-link.test.mjs`(12개), 기존
  `s11`의 B9 체크 재작성(3버튼 비활성 확인 → 활성 확인으로).

**독립검증**(fork agent `a18b2733b6c582c7a`, 세션한도로 1회 중단 후 SendMessage로 동일 에이전트
재개 — 새 에이전트 아님): 6개 항목 전부 "확인됨"으로 판정, 불일치 0건.
- git: 커밋 없음, 예상 밖 파일변경 없음(HEAD 여전히 D30의 `a9f91a7`).
- diff 직접 읽음: `agent.js`는 `.s22.bak`와 byte-identical(무변경 주장 사실), 나머지 3파일의
  실제 코드가 자체보고와 정확히 일치, 신규 CDN/의존성 0건.
  - D29 leaf-detection을 코드 흐름(walk/hasBlockChild/hasDirectText)까지 직접 추적해 "가정이
    아니라 사실"로 확정.
- 풀회귀: 24개 파일 **순차실행**(구현 에이전트가 보고한 "배치 시 간헐 NO_RESULT"의 원인을
  `grep "const PORT"`로 직접 구조 확인 — 여러 test 파일이 포트를 공유해서 병렬/급속배치에서만
  충돌 나는 것, 순차실행에선 발생 안 함 → 회귀 아니라는 결론 자체도 재검증됨) → **905
  passed / 0 failed**, 구현 에이전트 주장(905)과 정확히 일치.
- **보안 핵심 항목(링크 sanitizer)은 기존 테스트를 넘어 검증 에이전트가 자체적으로 20개 케이스
  신규 작성**(`data:`, `vbscript:`, `file:`, `tel:`, 대문자 `JAVASCRIPT:`, 앞공백 우회 등) —
  순수함수 15케이스+E2E 3케이스, 전부 거부 확인(20/20 pass). 스크립트는 검증 후 삭제(repo에
  흔적 없음).
- undo 3종 전부 byte-identical 복원 확인.

**최종 결론**: D21에서 "반쪽으로 넣지 않는다"며 비활성해뒀던 이미지/표/링크 3개 버튼이
전부 실제로 동작. 테스트 905/905 그린. 새 의존성 0개(리서치 결론대로 전부 자체구현).

## 16. D38~D42 — 라이브 사용 피드백(2026-07-23): 버그 2건 확정 + 비-버그 2건 + 신규 기능 3건

사용자가 실제 배포된 로컬 서버(4600)로 D35~D37을 써보고 스크린샷 3장과 함께 7개 항목 보고.
investigation-protocol대로 포크 조사(agentId `ad572ab500ffe14d7`) 선행 — 재현 먼저, 가설
3개+, 근본원인 확정 후에만 수정 방향 결정.

### 확정된 버그 2건

- **D38 (표 리사이즈 크기 불일치)** — **근본원인 확정**(추측 아님, 실측): `dom-adapter.js`의
  table 삽입 스타일(`width:100%;height:100%`, `table-layout:fixed` 없음)에서, div를 표의
  min-content(테두리+padding으로 결정)보다 작게 리사이즈하면 브라우저가 %지정을 무시하고
  min-content로 렌더 — 바깥 div는 `overflow` 미지정(기본 visible)이라 초과분이 그대로
  삐져나와 선택 핸들(div 기준) 밖으로 표가 넘침. 실측: 100×50으로 리사이즈 요청 →
  실제 렌더 100×100(높이 2배).
  - **수정 방향**: `<table>`에 `table-layout:fixed` 추가 + `<td>`에 `overflow:hidden;
    min-width:0` 류로 브라우저의 min-content 강제를 무력화 → div가 지정한 크기를 표가
    항상 실제로 따르게. (대안이었던 "리사이즈 하한 걸기"는 채택 안 함 — 사용자의 자유로운
    리사이즈 권한을 뺏는 트레이드오프라 최소침습적 수정 아님.)
  - WHY: 선택핸들(무엇을 보고 있다고 사용자가 믿는 크기)과 실제 렌더가 항상 일치해야
    한다는 건 이 에디터 전체의 암묵적 불변식(D20의 도형 리사이즈도 이 원칙).
  - COST: 극단적으로 작은 표는 텍스트가 잘리거나 안 보일 수 있음(사용자가 수동으로 그렇게
    만든 결과라 허용).
  - EXIT: 잘림이 실사용에서 문제되면 D20처럼 "최소크기 미만 리사이즈 거절+사유" 정책으로 대체.

- **D39 (이미지 종횡비 왜곡)** — **근본원인 확정**: `dom-adapter.js`의 `<img>` style이
  `object-fit:contain`(비율유지+레터박스). 사용자가 명시적으로 "박스크기에 맞춰 왜곡되어도
  됨"이라 요청 — 검토 없이 그대로 반영: `object-fit:fill`(비율무시, 박스에 꽉 채움) 1줄 교체.
  - WHY: 사용자의 명시적 결정(재론 불필요).
  - COST: 종횡비 안 맞는 리사이즈 시 이미지가 눈에 띄게 늘어남 — 의도된 트레이드오프.
  - EXIT: 그 한 줄만 원복하면 D35 당시 동작(contain)으로 복귀 가능.

### 비-버그로 확정된 2건 (조사로 반증, 코드 수정 대상 아님)

- **링크 버튼 미활성 — 재현 안 됨**. `editor.js`의 `FMT_CAPS.obj.link:1`이 굵게와 완전히
  동일한 패턴(`FMT_TEXT_CTRLS`/`updateFmtBar`)으로 배선돼 있음을 코드로 확인, obj 텍스트
  인라인세션에서 실제로 활성화되는 것도 재현 확인. 유력 가설: 사용자 브라우저 탭이
  D35~D37 배포 이전 상태로 열려 있어 새로고침 필요(정적서버라 파일은 최신이지만 이미 연
  탭의 JS는 그대로 — 새로고침 안 하면 절대 안 바뀜). 또는 svgbox/svg자유텍스트에서
  테스트했을 가능성(그쪽은 설계상 항상 비활성 — 자유텍스트엔 링크 미지원, 버그 아님).
  **사용자에게 강력 새로고침 후 obj에서 재확인 요청함 — 답변 대기, 코드 수정 보류.**
- **Option+클릭 꼭짓점삭제 — 이미 지원됨**. `agent.js`의 삭제 조건이 `e.altKey`이고, Mac의
  Option 키는 DOM 이벤트에서 Alt와 동일한 속성으로 잡힘(별도 처리 불필요) — Playwright로
  이 Mac 세션에서 직접 재현해 `altKey:true` 확인. 실제 갭은 툴팁이 "Alt+클릭"만 표기해
  Mac 사용자가 이미 되는 걸 몰랐을 뿐 — **코드 아니라 라벨 문구만 "Alt(Option)+클릭"로
  보강**(D42 phase에 곁들임, 별도 라운드 불필요).

### 신규 기능 3건

- **D40 (표 삽입 행/열 지정 다이얼로그)** — 사용자가 정확한 목업 제시(표 삽입 모달, 행/열
  각각 −/+ 스테퍼 입력, 확인/취소). D36의 "고정 3×3(v1 범위)"을 확장 — draw 모드에서 표
  kind 선택 시 캔버스 클릭 **전에** 이 모달을 먼저 띄워 행/열을 받고, 그 값으로
  `addObject`의 table 분기가 동적으로 N×M 그리드를 생성하도록. D38과 같은 코드 경로라
  **같은 라운드에서 함께 처리**.
  - WHY: 고정 3×3은 v1 스코프컷이었을 뿐 최종 형태가 아님 — 사용자가 즉시 구체적 요청.
  - COST: draw 흐름에 한 단계(치수 입력 모달) 추가 — textbox/shape/image는 여전히
    즉시배치라 표만 다른 흐름이 되는 비일관성 있음(의도적 — 표만 사전에 알아야 할 치수가
    있어서 다름).
  - EXIT: 다이얼로그가 불필요해지면 기본값(3×3)으로 바로 넘어가는 스킵 옵션 추가 가능.

- **D41 (다중선택 그룹 이동)** — 2개+ 요소 선택 상태에서 그 중 하나를 드래그하면 선택된
  전부가 상대위치를 유지한 채 함께 이동. 지금은 다중선택에서 배치서식(D22)/z-order(D34)만
  가능하고 드래그이동은 단일선택 전용.
  - WHY: 실사용상 여러 요소를 정렬해서 옮기는 게 자연스러운 요구 — 사용자 명시 요청.
  - COST: 드래그 로직이 selection 전체를 순회하며 각 유닛의 시작-오프셋을 유지해야 함
    (단일유닛 드래그보다 계산 복잡도↑). bleedDiff는 "이동한 여러 eid 전부 반영, 그 밖은
    불변"으로 다시 일반화 필요 — D34의 reorder처럼 `bleedDiff`에 새 모드 추가 또는 기존
    `"replace"` 모드의 다중-eid 버전으로 확장(구현 시 실제로 존재하는 모드들을 확인해서
    적합한 것 선택 또는 신설).
  - EXIT: 문제되면 다중선택 시 드래그를 다시 막고 단일선택으로 강제하는 것으로 원복 가능.

- **D42 (화살표 끝점 스냅)** — 화살표 CAD 편집(D18) 중 끝점을 드래그할 때, 근처 요소의
  꼭짓점(4모서리) 또는 다른 두 꼭짓점의 중간지점에 가까워지면 자동으로 그 지점에 달라붙음.
  Option+클릭 라벨 문구 보강도 이 phase에 곁들임(같은 파일 영역, `agent.js`).
  - WHY: 손으로 정확히 꼭짓점에 맞추기 어려움 — 사용자 명시 요청.
  - COST: 스냅 반경 임계값이 너무 넓으면 의도치 않은 스냅, 너무 좁으면 효과 없음 — 임의값
    금지 원칙(CLAUDE.md §13)에 따라 기존 D25c의 화살표 클릭반경 확장 사례(8px→22px, 이미
    실측 기반으로 확정된 값)를 참고해 일관된 스케일의 값 사용, 새 숫자를 직관으로 넣지 않음.
  - EXIT: 스냅이 거슬리면 토글 옵션 추가 또는 반경 0으로 사실상 비활성화 가능.

### 실행 순서 (파일 충돌 방지, 한 에이전트가 순차 처리)
Phase 1: D38+D40(표, 같은 코드경로) → 회귀 → Phase 2: D39(이미지, 1줄) → 회귀 →
Phase 3: D41(그룹이동) → 회귀 → Phase 4: D42(화살표 스냅 + Option라벨 문구) → 회귀.
링크버튼은 사용자 재확인 전까지 코드 변경 없음.

### ✅ D38~D42 구현 완료 + 독립검증 완료 (2026-07-23)

구현(Opus agent `a4459a8c903349e35`, 세션한도로 1회 중단 후 SendMessage로 동일 에이전트
재개): 4 Phase 전부 완료. **라이브검증 중 자기가 낸 회귀를 스스로 발견해 수정**(D38/D40
작업 중 표 div의 `position:absolute;left/top` 스타일을 실수로 드롭 → 표가 0,0 풀폭 렌더 →
프로브로 발견 후 복원) — 이 자기수정까지 포함해 독립검증(fork `a19f1adbb553c70aa`, 역시
세션한도 1회 자동재개 후 완료) 전부 통과. 최종 905→**949**(0 fail), 자체보고와 독립재확인
정확히 일치. `EDGE_HIT_PX_FOCUS=22`(D25c 기존값) 스냅반경으로 재사용 확인(임의 신규값 없음).
diff 5개 파일 전부 실측 일치, git 커밋 없음.

**판단필요로 플래그된 2건 → 사용자 확인 완료**:
- **D38 세로축소**: 지금 구현(overflow:hidden 클립)은 **기각** — 사용자가 "폰트/패딩 자동
  축소"를 선택. → **D43으로 확장 결정**(아래).
- **D42 스냅범위**: "요소 자신의 9곳(모서리4+변중점4+중심)만" 방식에 **"서로 다른 두 요소
  간 중간지점도 추가"**를 사용자가 선택(내 권장안이었던 "현행 유지"가 아니라 확장 쪽). →
  **D44로 확장 결정**(아래).

## 17. D43~D44 — 사용자 확인 후 확장 결정 (2026-07-23)

- **D43 (표 세로축소 시 폰트/패딩 자동축소)** — D38의 `overflow:hidden` 클립 방식을
  대체(완전 제거는 아님 — 극단적 축소의 안전망으로 유지)하고, 표 div가 표의 자연
  높이보다 작아지면 폰트크기·셀패딩을 **동적으로 축소**해 클립 없이 내용이 박스에
  들어맞게 한다.
  - 리사이즈 종료 시점(mouseup, 매 mousemove 아님 — 성능)에 표의 intrinsic 높이를
    측정 → 박스보다 크면 폰트크기/패딩을 비례 축소 → 재측정 → 필요시 반복(또는
    단발 비율계산, 구현 시 성능/정확도 트레이드오프 판단) → 그래도 안 맞으면(폰트가
    가독 하한 밑으로 내려가야 하는 극단적 축소) 기존 `overflow:hidden`이 최종
    안전망으로 남아있어 삐져나오진 않음.
  - **폰트 하한값**: 임의로 새로 정하지 말고, 이 코드베이스에 이미 있는 최소
    가독 폰트크기 관련 상수/정책(예: D26/D31류 텍스트서식 코드에 이미 하한이
    있는지 먼저 grep해서 확인 — 있으면 재사용, 없으면 그때 가장 가까운 기존
    폰트크기 값을 근거로 정하고 그 근거를 주석에 남길 것).
  - WHY: 사용자가 "클립보다 자동축소"를 명시 선택 — 표 내용이 안 보이게 잘리는 것보다
    작아져도 전부 보이는 쪽을 선호.
  - COST: 아주 작게 줄이면 글자가 매우 작아져 읽기 어려울 수 있음(그래도 "안 보임"보다
    "작게라도 보임"이 낫다는 게 사용자 선택) — 계산 비용도 클립 방식보다 큼(리사이즈마다
    측정+조정 루프).
  - EXIT: 특정 폰트하한 밑에서 다시 클립으로 폴백하는 조합은 이미 설계에 포함(안전망).

- **D44 (화살표 스냅 — 서로 다른 두 요소 간 중간지점 추가)** — 기존 D42의
  "요소 자신의 9개 앵커"에 더해, **서로 다른 두 요소의 꼭짓점 사이 정중앙**도
  스냅 후보에 포함.
  - **조합폭발 방지 필수**: 요소가 N개면 순진하게 모든 요소쌍×모든 꼭짓점쌍(4×4)을
    다 후보로 만들면 N²×16으로 폭발 — 반드시 스코프를 좁혀라. 방향 제안(구현 시
    실측하며 최종 결정): (a) 현재 드래그 커서 위치에서 일정 반경(D25c 22px류 기존
    상수 재사용 고려) 이내의 요소쌍만 후보 계산 — 화면 전체를 매 프레임 순회하지
    않음. (b) 또는 서로 "가까운"(예: 두 요소 bbox간 거리가 일정 임계 이내) 요소쌍만.
    임의 숫자 신설 최소화, 기존 D25c/D42 상수와 일관된 스케일 사용.
  - WHY: 사용자가 원래 요청("다른 요소들의 꼭짓점 간 중간 지점")의 문자 그대로의
    의미를 명시적으로 선택 — D42 구현이 그 문장을 "요소 하나의 변중점"으로 좁게
    해석했던 걸 정정.
  - COST: 후보점이 늘어나 스냅 판정 계산량↑, 스코프를 안 좁히면 성능 문제 + "아무데나
    다 스냅되는" UX 잡음 위험 — 위 스코프 제한이 필수 완화책.
  - EXIT: 성능/UX 문제가 실사용에서 드러나면 스코프 반경을 좁히거나 이 확장만
    끄는 플래그 추가 가능(요소 자신의 9앵커는 그대로 유지).

### 실행 순서
한 에이전트가 순차: D43(표) → 회귀 → D44(화살표) → 회귀. 두 항목은 서로 다른
파일(D43은 dom-adapter.js/editor.js, D44는 agent.js)이라 순서 유연하나, 파일충돌
방지를 위해 순차 진행 원칙 유지.

### ✅ D43~D44 구현 완료 + 독립검증 완료 (2026-07-23)

구현(Opus agent `ad316558b07793329`): 2 Phase 완료. **폰트하한**은 새 숫자 아니라
`dom-adapter.js`의 기존 `OBJ_LINE_MIN_PX=12`(D20 유래)를 재사용(agent.js는 다른
실행컨텍스트라 값 복제+출처주석). **스냅스코프 반경** `SNAP_PAIR_FOCUS_R=
EDGE_HIT_PX_FOCUS(22)×8=176px`는 데모 문서 최근접요소 중앙거리 중앙값(64px) 실측
기반. 조합폭발 방지 3단계(커서 176px 반경 필터→거리순 8개 CAP→쌍마다 마주보는
꼭짓점만) 확인. 최종 949→**970**(0 fail).

독립검증(fork `a6ee7d871e80d916e`): 7개 항목 전부 확인, **가장 중요했던 판정
(s26 테스트 오라클 수정이 회귀 은폐인지)은 "정당한 수정"으로 결론** — D44가 새
스냅후보를 추가했으니 "자유지점"의 정의 자체를 갱신한 것이지 assertion을 물렁하게
바꾼 게 아님. 970/970 재확인. 성능 자릿수(0.02ms대) 독립 재구현으로 재확인.

**불일치 1건 발견(경미, 문서 정정)**: 구현 에이전트가 "클립 없이 맞음"이라고 한 D43
표현이 **과장**으로 판명 — 실제로는 "≤6회 반복+선형근사(테두리 등 고정오버헤드
무시)"라 **일부 축소비율에서 완전수렴을 보장 못 하고 소폭 잔여클립이 발생**할 수
있음(자체 설계에 이미 있는 overflow:hidden 안전망이 정확히 이 경우를 위한 것 —
숨겨진 결함 아니라 문서화 안 된 설계 특성). **정정된 설명**: "대부분의 축소비율에서
폰트/패딩 축소로 클립 없이 수렴하고, 수렴 안 되는 나머지는 안전망이 처리한다"가
정확한 동작.

**최종**: D38~D44 전체(표/이미지/링크/그룹이동/화살표스냅, +표세로자동축소+
교차요소스냅확장) 구현+독립검증 완료. 테스트 876→905→949→**970**. 링크버튼
비활성 신고 건은 재현 안 됨(코드 정상 확인됨) — 사용자 새로고침 후 재확인 답변 대기 중.

## 18. D45 — 링크 버튼 비활성 대비 수정 (2026-07-24)

D38~D44 문서화 시점에 "재현 안 됨, 새로고침 후 재확인 대기"로 남아있던 링크 버튼 건을
라이브(Playwright) 재조사로 재확인.

### 재현 결과 — 실제로는 재현됨(단, 기능 아니라 시각 버그)

기능 게이팅 자체는 정상(선택없음/ON모드블록선택/class-c svgbox·svgtext/class-a 문서 —
전부 의도대로 비활성, obj 인라인편집 세션 중만 활성, 6개 조합 실측). **진짜 원인은
`styles.css:571`의 `.fmt-btn:disabled { color: #4E4E58; }`가 활성/비활성 구분을 텍스트
color 하나에만 의존**한다는 것 — 링크 버튼 라벨이 이모지(`🔗`, `index.html`)라 브라우저가
이모지 글리프에 고유색을 강제해 `color` 변경의 영향을 안 받음. 결과적으로 활성/비활성
스크린샷이 거의 구분 안 됨. `fmt-image`/`fmt-table`도 같은 `.fmt-btn` 베이스라 잠재적으로
동일 증상.

### 결정 D45 (기존 `.excluded` 패턴 재사용)

바로 아래 `.fmt-btn.excluded`(다이아몬드/게이트 등 "의도적 제외" 표시용, styles.css:573)가
정확히 같은 문제(이모지가 color 무시)를 이미 `filter: grayscale(1); opacity: .62;`로
해결해뒀음 — 같은 처리를 `.fmt-btn:disabled` 베이스 규칙에도 적용.

- WHY: 새 메커니즘을 만들 필요 없이, 코드베이스에 이미 검증된 동일 문제의 해법이 있었다
  (`.excluded`). 재사용이 최소침습.
- COST: 없음에 가까움 — 기존 opacity 기반 톤다운을 disabled 전반에 일반화할 뿐, 다른
  상호작용(hover/on 등)과 안 겹침(`:hover:not(:disabled)`가 이미 disabled를 배제).
- EXIT: 되돌리려면 `filter`/`opacity` 두 선언만 제거.

**적용**: `styles.css:571` 직접 수정(오케스트레이터가 직접, 위임 없이 — 1줄 규모라 새
에이전트 왕복이 과함). 회귀 검증은 이어지는 D32/D33 구현 라운드의 풀회귀에 포함.

**남은 원 질문("링크 버튼이 항상 안 눌린다")에 대한 추가 설명**: 활성화 조건 자체가
"OFF모드+obj 텍스트 인라인편집 세션 중"뿐이라 창이 좁음 — 이번 시각 수정과 별개로,
사용자가 실제로 그 좁은 조건 안에서 시도했는지는 여전히 별개 변수(대비 문제 수정으로
최소한 "보여서 오해"는 해소됨).

## 19. D32-실행 — 한글 굵게 실물 폰트 임베드 (2026-07-24)

사용자가 후보안 A(실제 bold 폰트 추가, B=경고문구는 기각)로 방향 확정 후 구현.

### 폰트 선택

**Pretendard**(OFL, `fonts/LICENSE`) 채택 — 스택 1순위였던 "IBM Plex Sans KR"은 기각.
근거(실측): Google Fonts CDN에서 IBM Plex Sans KR을 받으면 **가중치당 94개**의
유니코드 range-subset woff2로 쪼개져 나온다(400+700 합 188파일) — Google의 CJK
프로그레시브 로딩 전략이라 프로덕션 웹에선 합리적이지만, "no-build·정적파일 나열"
원칙의 이 프로젝트에서 자체호스팅하기엔 과함. Pretendard는 GitHub 공식 배포
(`packages/pretendard/dist/web/static/woff2/`)에서 **가중치당 파일 1개**(전체
글리프 포함, 서브셋 안 됨)로 제공돼 최소침습적으로 자체호스팅 가능 — 이미 스택
2순위였던 점도 부합.

### 구현

- `fonts/Pretendard-Bold.woff2`(773KB) + `fonts/Pretendard-Regular.woff2`(748KB) +
  `fonts/LICENSE`(OFL 원문, 재배포 조건 준수) 신규.
- `styles.css`에 `@font-face` 2개(family "Pretendard", weight 400 / 700-900).
- `server.mjs`에 `.woff2` MIME 타입(`font/woff2`) 추가(기존은 `application/octet-stream`
  폴백 — 브라우저가 font-face 로딩엔 관대해 기능은 됐지만 정확한 타입으로 교정).

### ★라이브 검증에서 발견한 회귀(계획엔 없었음) — Bold만 넣었더니 본문까지 굵어짐

당초 계획은 "Bold 1개만, Regular는 문제없어 미변경"이었으나 Playwright로 실제
`document.fonts`/canvas 잉크를 측정해보니 **weight 400 요청과 700 요청의 렌더
결과가 픽셀 단위로 완전히 동일**했다 — CSS 폰트매칭이 한 family에 얼굴이 하나만
등록되면 그 family로의 모든 굵기 요청을 "가장 가까운 등록 얼굴"로 스냅해버려서,
Bold만 등록하면 **일반 본문(400)까지 그 Bold 글리프로 렌더**되는 부작용이 실측
확인됨(계획을 신뢰하지 않고 라이브로 재검증했기 때문에 배포 전에 잡음 — 이
프로젝트의 grounding 원칙이 실제로 필요했던 사례, D31의 다이아몬드 사례와 동형).
→ Regular도 함께 등록해 해결. 수정 후 재측정: 400/700 잉크 픽셀수가 뚜렷이
갈라짐(1107 vs 1690) — 스크린샷으로도 확인(`d32_pretendard_regular_vs_bold.png`,
실제 굵기 차이가 시각적으로 뚜렷함, 스큐/합성 흔적 없음).

- WHY: 계획 단계의 "Bold만"은 문제 되는 부분만 최소 침습하려는 의도였으나, CSS
  폰트매칭 메커니즘이 그 가정(가중치별 독립)을 깬다는 게 이 코드베이스 밖의
  브라우저 표준 동작이라 실측 없인 알 수 없었다.
- COST: 에셋이 1개(773KB)에서 2개(1.5MB)로 증가.
- EXIT: Regular 얼굴을 빼려면 본문 폰트를 애초에 "Pretendard"가 아닌 다른
  family로 분리해야 함(더 큰 변경) — 지금 구조에선 사실상 필수 동반.

### ★스코프 컷(의도적, 문서화) — export/다운로드 문서엔 아직 미적용

이 폰트 임베드는 **라이브 에디터 세션에만** 적용된다(styles.css가 로컬 상대경로
`fonts/*.woff2`를 참조 — `archify serve`로 서빙될 때만 유효). 다운로드/직렬화된
문서(`serialize(doc)`)엔 아직 반영 안 됨 — 다운로드해서 다른 곳에서 열면 이 문서
이전과 동일하게 폰트 합성으로 되돌아간다(더 나빠지진 않음, 딱 원래 상태 유지).

- **왜 이번 라운드에서 안 했나**: D35(이미지 삽입)가 이미 `FileReader.readAsDataURL`로
  바이너리를 base64 임베드하는 선례를 만들어놔서(`editor.js:3486`) 방향 자체는
  명확하지만, 그 임베드가 실제로 일어나는 지점이 문서 종류별 serialize 경로
  (`archify-adapter.js`/`dom-adapter.js`/`svg-adapter.js`)라 — 이번 위임 범위를
  "폰트 에셋+styles.css(+필요시 template.html)"로 좁혀 D33(잉크UI, editor.js/
  index.html 담당)과 파일충돌 없이 병행했기 때문에 그 파일들은 손대지 않았다.
  무리하게 범위를 넘기느니 정직하게 컷하는 쪽을 택함(D21/D31/D34b와 같은 패턴).
- **COST**: 다운로드한 파일을 다른 브라우저/오프라인에서 열면 bold 한글이 다시
  합성으로 보일 수 있음 — 알려진 제약으로 명시.
  - **불균일 적용 시 트레이드오프**: 폰트 base64 임베드는 문서당 +1.4MB(400+700
    둘 다) ~ +1MB(700만) 수준 — 대부분 다른 삽입 자산(이미지)보다 무겁고, **그
    문서가 실제로 굵은 한글을 쓰지 않아도 무조건 붙는다**는 점이 이미지(사용자가
    명시적으로 넣은 것만 임베드)와 다른 지점.
- **EXIT/다음 단계 제안**: 다음 라운드에서 (a) 문서에 실제 weight≥700 한글 텍스트가
  있을 때만 조건부로 base64 임베드(불필요한 팽창 방지), 또는 (b) 사용자에게
  "이 문서를 오프라인/외부 공유용으로 내보낼 때 굵은 한글 폰트도 포함할까요?"
  체크박스로 선택권을 주는 안 — 둘 다 설계 여지가 있어 사용자 확인 후 진행 권장.

### 색 정밀화 감사(D32 부속) — 결론: 사전 결정 불필요, 감사만

- 색 입력 UI는 `<input type="color">`(index.html:162-164, `fmt-textcolor`/`fmt-fill`/
  `fmt-stroke`) — 브라우저 네이티브 위젯이라 **구조적으로 alpha(투명도) 표현 불가**
  (hex 6자리만 산출, HTML 표준 제약이지 이 코드베이스의 제약이 아님).
- **sanitizer는 이미 rgba를 허용한다**(`svg-adapter.js:36`의 `RGB_RE`가
  `rgba?\(...,\s*[\d.]+%?\s*\)?` — 4번째 alpha 컴포넌트 옵셔널로 이미 매치,
  `BAD_STYLE_VALUE`도 rgba를 안 막음). 즉 **백엔드 검증 단은 이미 정밀함** — 갭은
  전적으로 프런트 위젯.
- 이건 "sanitizer가 막고 있는 명백한 버그"가 아니라 "새 UI 위젯을 만들어야 하는
  기능 확장"이라 이번엔 구현하지 않음(직접 지시 사항인 D32 굵기 문제와 결이
  다르고, 사용자가 명시 답한 질문도 아님) — 감사 결과만 보고, 필요하면 별도
  확인 후 진행.

### 검증

- Playwright로 `document.fonts.check/load`가 두 얼굴 모두 `status:"loaded"` 확인,
  400/700 잉크 픽셀수 분리(1107 vs 1690) 확인, 스크린샷 확인(속성값만 보고 판단
  안 함 — 라이브 관찰 원칙 준수).
- 풀회귀 `node test/run-all.mjs`: **970/970 유지**(회귀 0).
- 동시 진행 중이던 D33과 파일 경계 준수(`editor.js`/`index.html` 미접촉, `styles.css`/
  `server.mjs`/`fonts/`만 변경). git 커밋 없음(이 디렉토리는 ax-os 워킹트리 안이라
  커밋 대상 아님 — HANDOFF.md 기존 방침 그대로).

## 20. D33-실행 — 잉크(렌더 픽셀) 비교 UI, "편집 전반" 범위 (2026-07-24)

사용자가 범위를 "편집 전반"(undo 한정 아님)으로 확정 후 구현.

### 채택 UX

`test/s10-lines-globalhead.test.mjs`의 `raster()`(marker 있는/없는 두 버전을 data URL→Image→
canvas→getImageData로 래스터화해 alpha≥60 픽셀수를 "잉크"로 삼는 기법)를 `editor.js`의
`rasterizeUnit(html, eid)`로 그대로 이식 — Playwright 전용이 아니라 순수 DOM/Canvas API라
제품 코드에 직접 이식 가능함을 실측 확인. 진입점은 DECISIONS.md 제안("flashBox를 누르면")
대신 **툴바 버튼**(`#btn-ink-compare`, "🔍 변경 비교")으로 갈음했다 — flashBox 자체는
`agent.js`(iframe) 소관인데 이번 위임은 파일충돌 방지를 위해 `editor.js`+`index.html`로
스코프가 좁혀져 있었기 때문(D32 fork가 동시에 `styles.css`/폰트를 작업 중). 버튼은
비교 대상이 있을 때만 활성화되고, 클릭 시 `#ink-panel`(기존 `#polish-panel`과 같은
`.pp-head`/`.pp-actions` 클래스 재사용, 위치만 인라인 스타일로 — `styles.css` 미변경 원칙)에
전/후 캔버스 2개 + 잉크 픽셀수 + 차이를 보여준다.

### 캡처 지점 — 계획을 뒤집은 실측 발견

당초 브리핑은 "`opts.flashEid`가 있는 commitOps 커밋마다 캡처"였으나 **실측 결과
`commitFormat`(fmtFill/fmtBold 등 툴바 서식 커밋의 실제 경로)은 `flashEid`를 아예 안
넘긴다**(LLM 편집 경로 등 일부만 사용) — 이대로면 정작 가장 흔한 "색 바꾸기" 같은 서식
커밋이 전부 잉크비교 캡처에서 빠져 "편집 전반"이 아니라 "LLM 편집 한정"이 됐을 것(디버그
스크립트로 `undoDepth`는 증가하는데 `lastInkCompare`는 계속 null임을 재현해 확정). 캡처
기준을 `opts.flashEid` 대신 **`commitOps`의 `allowed`**(그 커밋의 scope-gate·bleed-diff와
동일한 소스 — 모든 commitOps 호출에 항상 존재)로 바꿔 해결. `allowed`가 Set(다중선택,
D22)일 때는 크기 1(단일 대상)만 지원 — 여럿이 동시에 바뀐 비교는 "무엇을 보여줄지"가
불분명해 v1 범위 밖으로 명시적으로 컷(D23/D31/D34b와 같은 패턴).

### obj(HTML) 범위 — (a) 제외+사유 채택

브리핑의 두 선택지 중 **(a) 제외+사유**를 채택, `foreignObject` 실험은 하지 않음(브리핑이
권장한 기본안 그대로 — 억지로 끼워맞추지 않음 원칙). `rasterizeUnit`이 eid를
`svg[data-object]` 서브트리 안에서 못 찾으면(obj는 애초에 그 밖의 진짜 HTML div) null을
반환하고, `openInkCompare`가 이를 감지해 패널 본문 대신 사유 메시지로 안전 대체.

### ★구현 중 발견한 자체 버그(계획엔 없었음) — svgbox 자손 제거 오류

s10의 strip 조건(`el === target || el.contains(target) || el.closest("defs")`)을 그대로
이식했더니 svgbox(내용이 target `<g>`의 **자손**인 rect/text) 래스터화가 매번 ink=0으로
나옴(신설 테스트 (C2)가 최초 실패로 잡아냄) — s10의 원기법은 target 자신이 leaf(화살표
path/line, 자기 stroke가 곧 내용)인 경우만 맞는 조건이었다. `target.contains(el)`(자손
판정)을 대칭으로 추가해 해결, 수정 후 실측 ink 7920px(둘 다, fill 색만 바꿔 면적 불변이라
정상)로 스크린샷까지 육안 확인.

### 검증

- 신규 `test/s28-ink-compare.test.mjs`(22개, node --check 통과): svgbox fill 커밋→버튼
  활성화→패널 열림→전/후 캔버스·ink수치·차이 텍스트 확인, 새 문서 로드 시 이전 비교
  안 남음, obj 커밋은 버튼은 켜지되 열면 미지원 메시지, `rasterizeUnit` 직접호출로 svgbox는
  ink>100 obj는 null 수치 재확인, 콘솔 에러 0. 스크린샷 2장(`s28_svgbox_compare.png`
  — 전/후 색 다르게 렌더됨을 육안 확인, `s28_obj_unsupported.png` — 사유 메시지 확인) 직접
  열람.
- 풀회귀 `node test/run-all.mjs`: **970→992**(신규 22개 전부 포함, 회귀 0).
- 동시 진행 중이던 D32와 파일 경계 준수(`styles.css`/`fonts/`/`server.mjs` 미접촉,
  `editor.js`/`index.html`/신규 테스트 1개만 변경). git 커밋 없음(ax-os 워킹트리 — 기존
  방침 그대로).

- WHY: read-only 관찰 도구(소스 모델에 op 미적용)라 3중 scope 보증은 해당 없지만, 캡처
  기준을 `allowed`로 통일한 것 자체가 이 코드베이스의 "bleed-diff와 같은 소스로 scope를
  정의한다"는 기존 불변식과 결이 같다.
- COST: `agent.js`(flashBox 자체)를 안 건드려 "하이라이트를 누르면"이라는 원래 제안보다
  발견성이 낮음(별도 툴바 버튼을 알아야 함) — 파일경계 우선한 트레이드오프. 다중선택
  비교 미지원, obj 비교 미지원(두 컷 다 사유 명시).
- EXIT: 발견성 개선이 필요하면 `agent.js`에 flashBox 클릭→postMessage 경로를 별도
  라운드로 추가해 버튼과 병행 가능(제거 아니라 추가라 낮은 리스크). 다중선택/obj 지원은
  각각 독립적으로 나중에 확장 가능(현재 컷이 서로 안 얽혀 있음).

## 21. D47 — Shift 정점 드래그, 서로 다른 이웃이면 두 축 동시 스냅 (2026-08-04)

사용자 재현: "shift 키 입력 시에 수직/수평 동기화가 하나만 되는 거 같다" — D18의
`orthoSnap`(agent.js) 주석에 이미 "더 가까운 축 하나만"으로 **의도적으로** 문서화돼 있던
동작이었다(버그가 아니라 원래 그렇게 설계됨). 재현/원인 확정 후 사용자에게 "지금 고도화"로
확정.

### 원인 (agent.js:808-819, 개정 전)

`orthoSnap(pts, i, x, y)`는 드래그 중인 정점의 양옆 이웃(있으면 각각) 중 x가 더 가까운
이웃과 y가 더 가까운 이웃을 **독립적으로** 찾은 뒤, 최종적으로 `bdx<=bdy` 삼항연산자로
**둘 중 하나의 축만** 반환했다. 두 이웃이 서로 다른 축을 대표하는 "코너" 배치(예: 이전
정점과는 x가, 다음 정점과는 y가 이미 맞음)에서도 항상 한 축만 맞춰지고 나머지 축은
커서를 그대로 따라갔다.

### 결정

이웃 소스(어느 이웃에서 x·y 각각이 나왔는지, `bxSrc`/`bySrc`)를 추적해 **서로 다른
이웃에서 나왔을 때만** 두 축을 동시에 반환(`{x:bx, y:by}`)하도록 개정. 같은 이웃이
두 축을 다 이기거나(그 이웃이 x·y 둘 다 더 가까움) 이웃이 하나뿐인 경우(끝쪽 정점)는
**기존 단일축 폴백을 그대로 유지**.

- WHY: 두 이웃이 있고 각기 다른 축을 대표할 때만 "동시 스냅"이 의미 있는 코너를 만든다.
  같은 이웃이 두 축을 다 이기는 경우까지 무조건 `{x:bx,y:by}`로 바꾸면 그 이웃의 좌표와
  완전히 같아져 드래그 중인 정점이 이웃 위에 포개지고 세그먼트 길이가 0이 되는 퇴화가
  생긴다(끝쪽 정점의 유일한 이웃도 같은 이유로 항상 이 함정에 걸림) — 나이브하게 "항상
  둘 다 반환"으로 고쳤으면 이 회귀를 냈을 것.
- COST: 판정 분기 하나(이웃 소스 비교) 추가. 기존의 "임계값 없이 항상 스냅" 정책은
  그대로 유지(새 임계값을 도입하지 않음 — 요청 범위 밖).
- EXIT: 항상 단일축으로 되돌리려면 `bxSrc!==bySrc` 분기를 지우고 기존 삼항연산자만
  남기면 됨(1줄 되돌리기).

### 검증

- `test/s30-ortho-snap-dual-axis.test.mjs` 신설(12개) — `demo_svg_slide.html`의 기존
  6정점 직교 라우팅(`M228,196…L105,470`) 재사용, idx1=(228,210)의 이웃 idx0=(228,196)·
  idx2=(14,210)로 실측: (A1) Shift 없는 드래그는 스냅 없이 원시 좌표로 이동(딜타가
  유의미함을 먼저 확증) → (A2) 같은 딜타를 Shift 누른 채 드래그하면 서로 다른 이웃의
  x(228)·y(210)가 동시에 스냅 → (B) 커서를 한쪽 이웃(idx0) 쪽으로 바짝 붙이면(같은
  이웃이 두 축 다 이김) y만 스냅되고 x는 커서 그대로 — idx0 좌표로 완전히 포개지지
  **않음**을 명시적으로 확인(EXIT 노트의 퇴화 방지가 실제로 작동함을 증명). 세 케이스
  전부 `maskedSerialize` 방식 독립 bleed-diff(대상 정점 서브트리를 통째로 마스킹 후
  문서 전체 비교 — 대상이 `obj:N`(class-c svg 래퍼) 안에 중첩된 svgedge라 단순
  "eid별 outerHTML 비교"는 조상(`obj:N`)의 자연스러운 자식-변화까지 오탐한다는 걸
  구현 중 직접 재현해 확인, dom-adapter.js의 실제 `maskedSerialize`와 같은 원리로
  고침) 확인.
- 회귀: `s9-svgedge.test.mjs` 75/75, `s26-arrow-snap.test.mjs`(D42/D44 끝점 스냅) 18/18
  전부 무회귀 유지(둘 다 이 세션에서 직접 재실행 확인). 전체 스위트(`run-all.mjs`)는
  동시 진행 중이던 D46(다른 파일: `dom-adapter.js`/`svg-adapter.js`/`editor.js`, 여기는
  `agent.js`만 — 파일 경계 겹치지 않음) 완료 후 한 번에 합쳐서 실행 — **완료, 결과는
  다음 절(D46-실행 검증)에 통합 기록**.
- git 커밋 없음(`archify/`는 ax-os 워킹트리 안 — HANDOFF.md 기존 방침 그대로).

## 22. D46-실행 — 다이어그램 콘텐츠 굵은 한글 폰트 폴백 (2026-08-04)

D46 계획(위 §21 직전, 세션 앞부분에서 사용자 승인)대로 구현. 위임(정밀 브리핑) → 독립
재검증(git diff 직접 읽기·풀회귀 재실행·라이브 프로브) 4단계 전부 이 세션에서 수행.

### 구현 (계획과 정확히 일치, git diff로 직접 확인)

- `dom-adapter.js`(+106줄): `HANGUL_RE`(자모/호환자모/자모확장A·B/음절 5개 유니코드
  범위), `isBoldWeight`(editor.js의 기존 정의와 판정기준 일치, ≥600 또는 "bold"),
  `hasOwnFontSource`(head의 `@font-face`/`@import`/font 관련 `<link>` 존재 여부),
  `needsBoldFallback`(`#arch-bold-fallback` 존재 여부 — 이후 편집의 게이트),
  `prependFallbackFamily`(idempotent 접두), `loadFallbackFontsBase64`(fetch+base64,
  모듈 캐시), `injectFallbackStyle`(400+700 900 두 얼굴, base64 self-contained),
  `retrofitExistingBoldHangul`(SVG `text[font-weight]` + obj `[style]` 양쪽 소급),
  `ensureBoldFallback`(단일 진입점). `applyOps`의 `setStyle` 브랜치에 훅 추가.
- `svg-adapter.js`(+7줄): `applyTextStyleTo`에 동형 훅(`t.ownerDocument` 사용, 새
  파라미터 불필요) — 툴바·LLM 자연어 편집 두 경로 모두 이 저수준 함수로 수렴하므로
  하나의 훅으로 둘 다 커버(계획 §"핵심 근거"의 예측이 실측으로 확인됨).
- `editor.js`(+4줄): `loadDom`을 `async`로 전환, `sourceDoc = doc;` 직전에
  `await DomAdapter.ensureBoldFallback(doc)`(폰트 fetch 실패 시 try/catch로 흡수 —
  기존 합성 굵기로 degrade할 뿐 로드 자체는 안 막음). 호출부 3곳(`loadHtml`, 데모
  로더, file-input 핸들러, `__archTest.load`) 전부 `ready` 게이트로 이미 보호돼
  있어 무수정.
- 스코프 밖(계획대로 미접촉): `styles.css`, `server.mjs`, `archify-adapter.js`
  (class-a는 `#fmt-bold`가 애초에 `disabled`라 무관, 세션 앞부분에서 라이브로
  직접 확인함), `index.html`(새 UI 없음, 완전 자동).

### 검증 — 4단계 모두 실측(자기보고 그대로 안 믿음)

1. **git diff 직접 읽기**: 세 파일 diff 전문을 직접 읽어 브리핑과 정확히 일치함을
   확인(임의로 다른 지점을 건드리지 않았음, 훅 위치·조건문 전부 계획 그대로).
2. **신규 `test/s29-bold-hangul-fallback.test.mjs`(339줄, 29개 체크) 코드 직접 읽음**:
   `rasterizeUnitTest` 함정(§21 계획 검토 단계에서 지적됨 — 그 함수는 `<head>`를
   못 봄) 회피해 실제 `frame().locator(...).screenshot()`+canvas 잉크 비교로 대체돼
   있음을 확인. SVG `<text>` 축 + obj(HTML) 축 양쪽 소급수정 각각 검증, "아직 안
   굵은 줄"과 "이미 굵은 옆줄"을 구분해 스코프 정밀도까지 확인, p01(자기 폰트
   있음)에서 폴백 미주입+family 불변 대조군, 다운로드→새 브라우저 컨텍스트로
   `file://` 직접 열기(서버 완전 배제)까지 — 계획의 (a)/(b)/(c) 시나리오를 전부
   실제로 구현했음을 코드 레벨에서 확인.
   - 구현 중 발견한 실측 사실(계획에 없었던 디테일, 정직하게 기록됨): `demo_svg_slide.html`의
     한글 `<text>` 41개가 전수 이미 `font-weight≥600`이라 "토글할 안 굵은 줄"이 없어서,
     이 서브테스트 전용 최소 픽스처를 별도로 구성함 — s28 관례(픽스처 직접 작성) 재사용.
   - `download.path()`가 확장자 없는 임시경로라 `file://`로 직접 열면 브라우저가
     `text/plain`으로 취급해 `<head>`가 파싱 안 되는 함정을 실측으로 발견·`.html`
     확장자 사본 경로로 우회(실제 다운로드 콘텐츠 자체는 이 우회 전에 이미 직접
     파일 읽기로 검증 완료된 상태였음 — 우회는 재로드 시나리오만의 문제).
3. **독립 재실행**: `s29`를 내가 직접 재실행 — **29/29**, 위임받은 에이전트의 자기
   보고와 동일 결과를 독립적으로 재현. 별도로 내 자신의 프로브 스크립트(에이전트
   코드 재사용 안 함)로 실행 중인 `archify serve`(포트 4600)에 `demo_svg_slide.html`을
   로드해 iframe `document.fonts`를 직접 찍음 — **Pretendard 400/700 900 둘 다
   loaded** 확인(이 세션 최초에 버그를 발견했던 것과 동일 기법 — 그때는 0개였던
   자리에 지금은 로드돼 있음을 같은 잣대로 직접 봄).
4. **전체 회귀 독립 재실행**: 위임받은 에이전트가 자체 Monitor로 "1033 pass / 0
   fail, 31 files"를 보고했으나, 그대로 믿지 않고 별도로 내가 직접
   `node test/run-all.mjs`를 처음부터 백그라운드로 재실행 — **동일하게 1033 pass /
   0 fail, 31개 파일**(992 기존 베이스라인 + s29 29개 + s30 12개 = 1033, 산수도
   일치). 기존 29개 파일 각각의 pass/fail 카운트도 베이스라인과 파일 단위로
   바이트가 아니라 숫자 단위 일치 확인(회귀 0).

### D32 기록 정정(§19 관련)

D32-실행(§19)의 "굵게 눌렀을 때 한글 합성 굵기 문제 해소"라는 서술은 **에디터 자체
UI에만 해당**했고 다이어그램 콘텐츠에는 적용된 적이 없었다는 게 이번 세션에서
실측으로 확정됐다(대화 앞부분에서 `document.fonts`를 parent 페이지와 iframe 양쪽에서
직접 대조해 발견). D46이 실제로 다이어그램 콘텐츠 쪽을 처음으로 해결한다. §19는
과거 기록이라 그대로 두되(당시 관찰 자체는 진짜였다 — 에디터 UI는 실제로 고쳐졌음,
인과 설명이 다이어그램까지 넓게 잘못 미친 것), 이 절이 정정 기록이다.

- WHY(4단계 재검증 관행): 이 코드베이스 HANDOFF.md의 "완료 보고를 절대 그대로 믿지
  않는다" 원칙 — fork/subagent의 자기보고를 그대로 믿었다가 사후에 뒤집힌 전례(D32의
  인과 오귀속 자체가 그 예)가 있어, 위임 결과물은 매번 git diff·테스트 코드·전체
  회귀·라이브 프로브 4단계로 독립 재현해야 신뢰할 수 있다.
- COST: 이번 세션에서만 위임 왕복(≈35분) 외에 독립검증에 추가로 상당한 시간 소요
  (diff 정독, 테스트 코드 정독, 프로브 스크립트 직접 작성·실행, 전체 스위트 재실행).
- EXIT: 없음(검증 관행 자체는 지속 — 되돌릴 대상이 아님).
