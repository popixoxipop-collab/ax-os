// Editor Shell — 설계 §2: authoritative state는 항상 이 파일이 들고 있는 파싱된 Document
// (sourceDoc)이고, iframe은 순수 view다. 모든 편집은 [소스 클론에 적용 → bleed-diff 실증 →
// 통과 시 승격 → srcdoc 재구축] 순서로만 일어난다.
//
// stage 3: 6모드 전부 활성(선택·그리기·편집·콘텐츠 검증·레이아웃 수정·콘텐츠 다듬기).
//  · 모든 LLM/수동 op 경로는 sanitize → scope/field 검사 → bleed-diff(집합 일반화) → 적용.
//  · 광역 모드(레이아웃/다듬기)는 field-class lock(위치·크기 vs 텍스트) + 변경집합 ⊆ 허용집합.
//  · 그리기는 addDiff(요소 1개 추가, 나머지 바이트 동일)로 검증.
const ArchEditor = (() => {
  const DEMO_FILE = "p01_report_snapshot.html";
  const SLIDE_W = 1920;
  const SLIDE_H = 1080;
  const UNDO_MAX = 50;

  let sourceDoc = null;
  let fileName = DEMO_FILE;
  let selected = null;          // { eid, kind, rect{x,y,w,h} } — 주 선택(마지막 클릭). rect는 슬라이드 px
  // ★ D22: 선택은 이제 **집합** S다. selected는 그 집합의 마지막 원소(주 선택)이고, 기존 단일
  //   경로(팝오버·패널·드래그)는 전부 selected만 보므로 |S|=1일 때 동작이 완전히 동일하다.
  //   scope 3중 보증(스키마 pin · sanitize 게이트 · bleed-diff)은 이제 selection 전체를 축으로 돈다.
  let selection = [];           // [{eid, kind, rect, svgbox, svgtext, svgedge, shape}]
  // ── D26: OFF 인라인 텍스트 편집 세션(부모 측 미러) ──
  // ★ 텍스트 서식 컨트롤의 게이트는 이제 이 세션이지 selection이 아니다(D26). agent.js가 인라인
  //   편집의 수명(begin/preview/commit/cancel)을 소유하고 postMessage로 여기에 미러한다.
  //   { eid, kind, line|null, origText, pendingSvg{}, pendingDom{}, pendingGap|null, previewCss{} }.
  //   서식 클릭은 **즉시 커밋하지 않고**(그러면 재렌더가 오버레이·미커밋 텍스트를 날린다) 여기에
  //   pending으로 쌓였다가 Enter 커밋 때 텍스트와 **한 배치**로 적용된다(단일 undo). Escape는 폐기.
  let inlineSession = null;
  let undoStack = [];           // 과거 스냅샷 (≤50)
  let redoStack = [];           // D21: 되돌린 스냅샷 — 새 편집이 들어오면 잘린다(표준 커서형 히스토리)
  let pendingReselectSet = null; // 재렌더 후 복원할 선택 집합 { eids, primary }
  let fmtCollapsed = false;      // 서식 툴바 접힘 상태(선택이 바뀌어도 유지)
  let busy = false;
  let pendingFlash = null;
  // D33: 직전 commitOps의 전/후 전체문서 스냅샷 — "편집 전반"(undo 한정 아님) 잉크 비교용.
  // { eid, beforeHTML, afterHTML } | null. rasterize는 SVG 단위(svgbox/svgtext/svgedge)만
  // 가능(HTML obj는 네이티브 DOM→canvas API가 없음 — openInkCompare에서 사유 표시로 대체).
  let lastInkCompare = null;
  let pendingReselect = null;   // 편집 모드 재렌더 후 재선택할 eid
  let pendingInlineOpen = null; // D28(A): 줄→줄 전환 커밋이 재렌더를 유발한 경우, 재렌더 후 다시 열 인라인 타깃 { eid, kind, line }
  let pendingLineFocus = null;  // 줄 추가 후 포커스할 줄 인덱스(재렌더 왕복 뒤 복원)
  let pendingGlobalHead = null; // { scale, markers, edges, clones } — 화살촉 일괄 조절 확인 대기
  // ── D27b: 앱 내부 클립보드(navigator.clipboard 아님 — 권한 프롬프트 회피·sandboxed iframe 복잡도 회피,
  //   결정 D27b). { items:[{kind, html}], from } · load 사이에도 유지(교차문서 붙여넣기 nice-to-have). ──
  let clipboard = null;
  const PASTE_DELTA = 20;       // 붙여넣기 좌표 오프셋(원본과 안 겹치게) — obj=px, svg=user units
  let scale = 1;
  let viewReady = false;
  let toastTimer = null;

  let mode = "select";          // select | draw | edit | audit | layout | polish
  // ── D25a/c: 요소 편집(블록) ON/OFF 토글 + 3-way focus 도구 ──
  // ★ 기본값은 명시 상수 하나에 박아 둔다(EXIT: 이 한 줄만 뒤집으면 OFF-기본으로 바뀐다).
  //   기본 ON인 이유: 편집 모드 진입 + 요소 클릭이 드래그·리사이즈·패널을 arm하던 기존 591 checks의
  //   전제를 그대로 보존한다(대규모 재작성 없이 무회귀). ON=블록 편집(오늘 동작·텍스트 직접편집 불가),
  //   OFF=텍스트 직접(인라인) 편집(블록 조작 전부 비활성).
  const DEFAULT_ELEMENT_EDIT_ON = true;
  let elementEditOn = DEFAULT_ELEMENT_EDIT_ON;
  let editFocus = "all";        // "all"(전체·기본) | "node"(노드 편집) | "arrow"(화살표 편집) — ON일 때만 의미
  // ★ 사용자 요청(2026-07-21): 선택 시 다이어그램 위에 뜨던 플로팅 상세 팝업 4종을 **DOM·배선까지 물리 제거**.
  //   툴바가 이미 채움/테두리/글자색/글꼴/크기/정렬/방향/화살촉을 담고, 팝업 고유 기능(박스 줄 D20 · 수치 크기)은
  //   툴바 row2로 이전했으며, 줄 텍스트는 요소 편집 OFF 인라인이 담당한다 → 팝업 자체가 불필요해 삭제.
  let drawKind = "textbox";     // 그리기 팔레트
  // D35: 이미지 그리기 — 버튼 클릭 시 파일선택→data URI+실측 크기를 여기 담아두고, drawKind="image"로
  //   전환한다. 캔버스 클릭(onDrawAt)이 이 값을 소비해 배치한다(취소 시 null → 그리기 진입 안 함).
  let pendingImage = null;      // { src, width, height } | null
  // D40: 표 삽입 다이얼로그가 확정한 행·열. 표 그리기 진입 시 다이얼로그로 채워지고, 캔버스 클릭(onDrawAt)이
  //   이 값을 commitAdd→addObject에 실어 N×M 그리드를 만든다(기본 2×2, sane 범위 1~20).
  let pendingTable = { rows: 2, cols: 2 };
  let findings = [];            // 콘텐츠 검증 결과 [{eid, kind, issue, suggestion, other?}]
  let pendingLayoutOps = null;  // { ops, allowed, notes } — 레이아웃 확인 대기
  let pendingPolish = null;     // { rows:[{eid,before,after,op}], notes } — 다듬기 승인 대기
  const boxReqs = new Map();    // collectBoxes 요청 대기 (reqId → {resolve,timer})
  let reqSeq = 0;

  // ── stage 4: class-a(archify-JSON) 통합 상태 ──
  // provenance는 로드 시 확정된다: 임베디드 소스가 있으면 "archify"(class a), 없으면 "dom"(class b).
  // class a는 소스 JSON을 편집→`archify serve`가 서버측 재렌더(렌더러는 spawn-per-run이라 브라우저
  // 번들 불가, plan G4). class b는 그대로 정적 DOM 편집. 둘을 한 UI 뒤에 숨긴다.
  let provenance = "dom";       // "dom" | "archify"
  let archModel = null;         // class a 모델 { type, source, version, html }
  let serveAvailable = false;   // /render 도달 가능성(class a 편집 게이트)
  const serveBase = "";         // 같은 오리진의 archify serve (config.js는 read-only라 동일-오리진 고정)
  const META_KINDS = new Set(["meta-title", "meta-subtitle"]);
  const EDGE_KINDS = new Set(["edge", "connection", "flow", "transition", "message"]);
  // stage 5: class-a는 이제 6모드 전부 지원. 잠금은 serve 미도달 시에만(재렌더 불가).
  const MODE_GATE_TIP = "archify serve 연결 후 편집 가능 (python -m http.server로는 재렌더 불가)";

  // ── stage 5: class-a 5모드 상태 ──
  let archEditRef = null;         // 편집 폼 대상 ref
  let archDrawSub = "node";       // "node" | "edge" — 그리기 하위 모드
  let archEdgeSource = null;      // add_edge 대기 소스 노드 id
  let pendingArchLayout = null;   // { ops, allowed, notes }
  let pendingArchPolish = null;   // { rows, notes }

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---------------- view ----------------

  function buildSrcdoc() {
    const clone = sourceDoc.cloneNode(true);
    const s = clone.createElement("script");
    s.setAttribute("data-arch-editor-agent", "");
    s.textContent = ArchAgent.source();
    (clone.body || clone.documentElement).appendChild(s);
    return "<!doctype html>\n" + clone.documentElement.outerHTML;
  }

  // class a 뷰: serve가 재렌더한 stamped HTML(archModel.html)에 에이전트만 주입한다. 소스 모델은
  // 부모(archModel.source)가 authoritative이고 이 HTML은 순수 view — 저장물엔 에이전트가 안 남는다.
  function buildArchSrcdoc() {
    const doc = new DOMParser().parseFromString(archModel.html, "text/html");
    const s = doc.createElement("script");
    s.setAttribute("data-arch-editor-agent", "");
    s.textContent = ArchAgent.source();
    (doc.body || doc.documentElement).appendChild(s);
    return "<!doctype html>\n" + doc.documentElement.outerHTML;
  }

  function render() {
    viewReady = false;
    $("diagram-frame").srcdoc = provenance === "archify" ? buildArchSrcdoc() : buildSrcdoc();
  }

  function frameWin() {
    const f = $("diagram-frame");
    return f && f.contentWindow ? f.contentWindow : null;
  }
  function postToView(msg) {
    const w = frameWin();
    if (w) w.postMessage(msg, "*");
  }
  // D25a/c: 요소 편집 토글·focus를 뷰(agent)에 함께 내려 hit-test/인라인편집 트리거를 일치시킨다.
  function postMode() { postToView({ type: "arch-mode", mode, drawKind, provenance, elementEditOn, editFocus }); }

  function layout() {
    const wrap = $("stage-wrap");
    const availW = Math.max(200, wrap.clientWidth - 48);
    const availH = Math.max(200, wrap.clientHeight - 48);
    scale = Math.min(1, availW / SLIDE_W, availH / SLIDE_H);
    if (!(scale > 0)) scale = 1;
    const stage = $("stage");
    stage.style.width = Math.round(SLIDE_W * scale) + "px";
    stage.style.height = Math.round(SLIDE_H * scale) + "px";
    $("diagram-frame").style.transform = scale < 0.9995 ? "scale(" + scale + ")" : "";
  }

  // ---------------- floating positioning ----------------

  function positionFloating(pop, rect, popW, popH) {
    const stageBox = $("stage").getBoundingClientRect();
    const x = stageBox.left + rect.x * scale;
    const y = stageBox.top + rect.y * scale;
    const h = rect.h * scale;
    const left = Math.min(Math.max(8, x), window.innerWidth - popW - 8);
    let top = y + h + 10;
    if (top + popH > window.innerHeight - 8) top = Math.max(8, y - popH - 10);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }

  // (팝업 폐지: positionEdgePanel 삭제 — 화살표 상세 팝업이 없어 위치 계산이 불필요. 화살표 도구는 툴바 row3.)

  function kindLabel(kind) {
    if (kind === "textbox") return "텍스트 상자";
    if (kind === "shape") return "도형";
    if (kind === "svgbox") return "SVG 박스";
    if (kind === "svgtext") return "자유 텍스트";
    if (kind === "svgedge") return "화살표";
    return "요소";
  }

  // class a(archify) 요소 종류 라벨 — 렌더러 data-arch-kind 어휘.
  function archKindLabel(kind) {
    const M = {
      node: "노드", component: "컴포넌트", participant: "참가자", state: "상태", stage: "스테이지",
      lane: "레인", phase: "페이즈", group: "그룹", boundary: "경계", band: "밴드",
      edge: "엣지", connection: "연결", flow: "흐름", transition: "전이", message: "메시지",
      "meta-title": "제목", "meta-subtitle": "부제", legend: "범례",
    };
    return M[kind] || "요소";
  }

  // 선택 요소의 표시 id/종류(두 클래스 공용): class a는 data-arch-id, class b는 data-arch-eid.
  function selId() { return selected ? (selected.id != null ? selected.id : selected.eid) : null; }
  function selKindText() {
    if (!selected) return "요소";
    return provenance === "archify" ? archKindLabel(selected.kind) : kindLabel(selected.kind);
  }

  // ---------------- 선택 모드 popover ----------------

  function openPopover() {
    const pop = $("floating-input");
    pop.hidden = false;
    positionFloating(pop, selected.rect, 430, 130);
    $("fi-kind").textContent = selKindText();
    $("fi-eid").textContent = selId();
    const input = $("fi-text");
    input.placeholder = "이 " + selKindText() + "에서 무엇을 변경해야 하나요?";
    input.value = "";
    setPopError(""); setPopBusy(false);
    input.focus();
  }
  function closePopover() {
    $("floating-input").hidden = true;
    setPopError(""); setPopBusy(false);
  }
  function clearSelection() {
    selected = null;
    selection = [];
    postToView({ type: "arch-clear" });
    updateFmtBar();
  }

  // ---------------- D22: 선택 집합 ----------------
  // 부모가 집합의 유일한 소유자다. 뷰(agent)는 arch-select-set을 받아 "그리기만" 한다 —
  // 뷰가 스스로 집합을 추론하면 재렌더·undo 뒤에 부모 상태와 반드시 어긋난다.
  function syncSelected() { selected = selection.length ? selection[selection.length - 1] : null; }
  function postSelectionSet() {
    postToView({ type: "arch-select-set", eids: selection.map((s) => s.eid), primary: selected ? selected.eid : null });
  }
  function selectionSet() { return new Set(selection.map((s) => s.eid)); }
  function hitToUnit(d) {
    return { eid: d.eid, kind: d.kind, rect: d.rect, svgbox: !!d.svgbox, svgtext: !!d.svgtext, svgedge: !!d.svgedge, shape: d.shape || null };
  }
  // 평범한 클릭 = 집합을 그 하나로 교체(기존 동작 그대로).
  function selectOne(d) {
    selection = [hitToUnit(d)];
    syncSelected();
    postSelectionSet();
    updateFmtBar();
  }
  // Cmd/Ctrl+클릭 = 토글. 이미 있으면 빼고(주 선택은 남은 것 중 마지막), 없으면 끝에 더한다.
  function selectToggle(d) {
    const i = selection.findIndex((s) => s.eid === d.eid);
    if (i >= 0) selection.splice(i, 1);
    else selection.push(hitToUnit(d));
    syncSelected();
    postSelectionSet();
    updateFmtBar();
  }
  function isMulti() { return selection.length > 1; }
  function setPopError(msg) { const el = $("fi-error"); el.hidden = !msg; el.textContent = msg || ""; }
  function setPopBusy(on) { $("fi-busy").hidden = !on; $("fi-run").disabled = on; $("fi-text").disabled = on; }

  // ---------------- toast ----------------

  function showToast(text, opts = {}) {
    const t = $("toast");
    $("toast-text").textContent = text;
    const act = $("toast-action");
    if (opts.actionLabel && opts.onAction) {
      act.hidden = false; act.textContent = opts.actionLabel;
      act.onclick = () => { hideToast(); opts.onAction(); };
    } else { act.hidden = true; act.onclick = null; }
    t.hidden = false;
    // D24: 서식 툴바가 상단으로 옮겨가면서 하단 겹침이 원천 소멸했다 → 토스트는 CSS 기본
    // 위치(bottom:26px)로 되돌린다. (D21 시절의 동적 오프셋은 이제 불필요하고, 남겨두면
    // 툴바 높이만큼 토스트가 붕 떠 보인다.)
    t.style.bottom = "";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, opts.ms || 3500);
  }
  function hideToast() { $("toast").hidden = true; }

  // ---------------- 공통 apply 코어 (scope-gate·bleed-diff·undo·render) ----------------

  // undo 스냅샷은 태그된 객체다: class b는 {kind:"dom", html}, class a는 {kind:"arch", model}.
  // 두 클래스가 한 스택을 공유하되 복원 시 kind로 분기한다(undoDepth 훅은 양쪽 공통).
  //
  // ★ D21/D17 EXIT: 단방향 스택 → **커서형 양방향**. undo는 현재 상태를 redo 가지에 올린 뒤
  //   과거로 가고, redo는 그 반대다. 새 편집(pushUndo)이 들어오면 redo 가지를 자른다 —
  //   되돌린 뒤 다른 길로 갔는데 옛 미래가 남아 있으면 "다시 실행"이 지금과 무관한 상태를
  //   덮어씌운다(표준 히스토리 모델이 이걸 자르는 이유).
  function pushUndo(snap) {
    undoStack.push(snap);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack = [];
  }
  // "지금" 상태의 스냅샷 — undo/redo가 반대편 가지에 쌓기 위해 필요하다.
  function currentSnap() {
    return provenance === "archify"
      ? { kind: "arch", model: archModel }
      : { kind: "dom", html: DomAdapter.serializeRaw(sourceDoc) };
  }
  function restoreSnap(snap) {
    if (snap.kind === "arch") archModel = snap.model;   // class a: 모델 스냅샷 복원
    else sourceDoc = DomAdapter.parse(snap.html);        // class b/c: HTML 스냅샷 복원
  }

  // ops(각자 eid 보유) 적용. allowed = 허용 eid(문자열/배열/Set). 통과 시 소스 승격 + 재렌더.
  // opts.apply로 적용 함수를 갈아끼운다(class c SVG 박스는 SvgAdapter.applyOps). bleed-diff는
  // 허용 eid 집합 축이라 class b/c 공용 — SVG 박스 <g>가 바깥 svg의 후손이어도 조상-skip +
  // maskedSerialize 경로가 "박스 밖 바이트 동일"을 그대로 실증한다.
  function commitOps(ops, allowed, opts = {}) {
    const before = DomAdapter.serializeRaw(sourceDoc);
    const nextDoc = sourceDoc.cloneNode(true);
    const applyFn = opts.apply || DomAdapter.applyOps;
    try { applyFn(nextDoc, ops); }
    catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
    // opts.bleed로 bleed-diff를 갈아끼운다(화살표 화살촉 크기는 <defs>에 그 화살표 전용 marker
    // 클론 1개를 정당하게 추가하므로 SvgAdapter.bleedDiff가 그 예외만 좁게 화이트리스트한다).
    const diff = (opts.bleed || DomAdapter.bleedDiff)(sourceDoc, nextDoc, allowed);
    if (!diff.ok) return { ok: false, error: "bleed-diff 실패 — 허용 범위 밖 변경: " + diff.offenders.join(", ") };
    pushUndo({ kind: "dom", html: before });
    sourceDoc = nextDoc;
    if (opts.flashEid) pendingFlash = { eid: opts.flashEid };
    // D33: "편집 전반" 스코프 — opts.flashEid는 LLM 편집 등 일부 경로에서만 설정되므로(예:
    // commitFormat/fmtFill류 toolbar 서식 커밋엔 없음, 실측으로 확인) flash 유무와 무관하게
    // **모든** commitOps 커밋에서 allowed(그 커밋의 scope-gate 대상, bleed-diff와 동일 소스)를
    // 기준으로 캡처한다. 다중선택(Set 크기>1) 편집은 v1 범위 밖 — "여럿이 동시에 바뀐 비교"는
    // 개념이 복잡해(어떤 한 요소를 보여줄지 불분명) 스킵, 단일 대상일 때만 지원.
    {
      const eids = allowed instanceof Set ? [...allowed] : (Array.isArray(allowed) ? allowed : [allowed]);
      if (eids.length === 1 && eids[0]) {
        lastInkCompare = { eid: eids[0], beforeHTML: before, afterHTML: DomAdapter.serializeRaw(sourceDoc) };
        updateInkBtn();
      }
    }
    if (opts.reselectEid) pendingReselect = opts.reselectEid;
    // D22: 배치 편집 후 선택 집합을 그대로 되살린다(연속 서식 조작이 한 번에 끊기지 않도록).
    if (opts.keepSelection && selection.length) {
      pendingReselectSet = { eids: selection.map((s) => s.eid), primary: selected ? selected.eid : null };
    }
    render();
    updateUndoBtn();
    return { ok: true };
  }

  // 요소 추가(그리기) — 소스만 승격(재렌더는 호출측이 모드 전환 후 수행). addDiff로 검증.
  function commitAdd(spec) {
    const before = DomAdapter.serializeRaw(sourceDoc);
    const nextDoc = sourceDoc.cloneNode(true);
    let added;
    try { added = DomAdapter.addObject(nextDoc, spec); }
    catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
    const diff = DomAdapter.addDiff(sourceDoc, nextDoc, added.eid);
    if (!diff.ok) return { ok: false, error: "add-diff 실패: " + diff.offenders.join(", ") };
    pushUndo({ kind: "dom", html: before });
    sourceDoc = nextDoc;
    updateUndoBtn();
    return { ok: true, eid: added.eid, kind: added.kind };
  }

  // ---------------- D27a/b: 삭제 · 복사/붙여넣기 (직접조작 — LLM op 아님) ----------------
  //   드래그·리사이즈와 같은 직접조작이라 tool-schema 분기가 없다. 대신 스키마-pin→sanitize 대신
  //   commitOps의 apply/bleed 슬롯에 삭제·붙여넣기 함수를 끼우고, bleed-diff의 개수-회계 일반화
  //   (mode:"remove"/"add")로 "그 밖은 바이트 동일"을 그대로 실증한다. 단일 스냅샷 → 단일 undo.
  //   ★ 게이트: 블록 편집(edit+ON) + class-b/c(수제 슬라이드)만. archify(class-a)는 JSON 재렌더라
  //     DOM 삭제/추가가 다음 렌더에서 사라진다(정직하게 무동작).
  function directEditGate() {
    return sourceDoc && provenance !== "archify" && mode === "edit" && elementEditOn && !busy;
  }
  function elForEid(doc, eid) { return DomAdapter.getByEid(doc, eid); }

  function deleteSelection() {
    if (!directEditGate() || !selection.length) return;
    const set = new Set(selection.map((s) => s.eid));
    const n = set.size;
    const res = commitOps([], set, {
      apply: (doc) => DomAdapter.deleteUnits(doc, set),
      bleed: (b, a, al) => DomAdapter.bleedDiff(b, a, al, { mode: "remove" }),
    });
    if (!res.ok) { showToast("삭제 실패: " + res.error, { ms: 5000 }); return; }
    clearSelection(); selected = null;
    // ★ 화살표는 노드 삭제로 자동 삭제·재라우팅되지 않는다(이 수제 슬라이드엔 엣지↔노드 그래프 모델이
    //   없다 — class-a/archify JSON과 달리). 박스를 지운 뒤 그 자리를 가리키던 화살표가 붕 뜨는 건
    //   버그가 아니라 예상된 동작이다.
    showToast(n + "개 요소 삭제됨 (연결된 화살표는 그대로 — 필요하면 화살표도 선택해 삭제)", { actionLabel: "실행 취소", onAction: undo });
  }

  function copySelection() {
    if (!directEditGate() || !selection.length) return;
    const items = [];
    for (const u of selection) {
      const el = elForEid(sourceDoc, u.eid);
      if (el) items.push({ kind: unitKind(u), html: el.outerHTML });
    }
    if (!items.length) return;
    clipboard = { items, from: fileName };
    showToast(items.length + "개 요소 복사됨 · Ctrl/Cmd+V로 붙여넣기");
  }

  // 클립보드 항목 하나를 nextDoc에 붙여넣는다(kind별 어댑터로 분기). 반환 { eid, unit } | null.
  function pasteOne(doc, item) {
    let r;
    if (item.kind === "obj") r = DomAdapter.pasteObj(doc, item.html, PASTE_DELTA, PASTE_DELTA);
    else r = SvgAdapter.pasteUnit(doc, item.html, item.kind, PASTE_DELTA, PASTE_DELTA);
    if (!r) return null;
    const unit = {
      eid: r.eid, kind: r.kind, rect: { x: 40, y: 40, w: 120, h: 60 },
      svgbox: r.kind === "svgbox", svgtext: r.kind === "svgtext", svgedge: r.kind === "svgedge",
      shape: null,
    };
    return { eid: r.eid, unit };
  }

  function pasteClipboard() {
    if (!directEditGate()) return;
    if (!clipboard || !clipboard.items.length) { showToast("클립보드가 비어 있습니다 — 먼저 Ctrl/Cmd+C로 복사하세요."); return; }
    const before = DomAdapter.serializeRaw(sourceDoc);
    const nextDoc = sourceDoc.cloneNode(true);
    const newEids = [], newSel = [];
    try {
      // 모든 항목에 같은 오프셋을 주면 항목 간 상대 배치가 그대로 보존된다(다중 선택 붙여넣기).
      for (const it of clipboard.items) { const r = pasteOne(nextDoc, it); if (r) { newEids.push(r.eid); newSel.push(r.unit); } }
    } catch (e) { showToast("붙여넣기 실패: " + ((e && e.message) || String(e)), { ms: 5000 }); return; }
    if (!newEids.length) { showToast("붙여넣을 대상이 이 문서에 맞지 않습니다."); return; }
    const set = new Set(newEids);
    const diff = DomAdapter.bleedDiff(sourceDoc, nextDoc, set, { mode: "add" });
    if (!diff.ok) { showToast("붙여넣기 검증 실패(bleed): " + diff.offenders.join(", "), { ms: 5000 }); return; }
    pushUndo({ kind: "dom", html: before });
    sourceDoc = nextDoc;
    // 새로 붙인 것을 선택 집합으로 → 곧바로 드래그해 배치 가능.
    selection = newSel; syncSelected();
    if (newEids.length === 1) pendingReselect = newEids[0];                                   // 단일: 드래그까지 arm
    else pendingReselectSet = { eids: newEids, primary: newEids[newEids.length - 1] };         // 다중: 집합 하이라이트
    render();
    updateUndoBtn();
    updateFmtBar();
    showToast(newEids.length + "개 요소 붙여넣기 (+" + PASTE_DELTA + "," + PASTE_DELTA + ") · 드래그해 배치하세요", { actionLabel: "실행 취소", onAction: undo });
  }

  // ---------------- 선택 모드 편집 루프 (§4) ----------------

  function buildMessages(ctx, instruction) {
    const system = [
      "당신은 다이어그램 슬라이드의 요소 단위(element-scoped) 편집기다.",
      "문서: 절대배치(position:absolute) HTML 슬라이드, 뷰포트 " + ctx.viewport.width + " × " + ctx.viewport.height + ".",
      "너는 정확히 한 개의 요소만 편집한다: data-arch-eid=\"" + ctx.eid + "\" (종류: " + ctx.kind + ").",
      "반드시 edit_element 도구를 호출해 ops 배열만 반환한다. 규칙:",
      "- 모든 op의 eid는 \"" + ctx.eid + "\" 고정 (스키마상 다른 값은 불가능)",
      "- setText: 이 요소의 대표 텍스트 줄(가장 큰 font-size 줄)의 텍스트를 교체한다",
      "- setStyle: 인라인 스타일. 허용 키는 top,left,width,height,color,background,fontSize,fontWeight,border,borderRadius,zIndex 뿐. 길이 값은 px 단위 문자열(예: \"220px\")",
      "- setAttr: class 또는 data-* 속성만 (data-arch-eid, data-object 변경 금지)",
      "- 다른 요소를 옮기거나 바꿔야만 가능한 요청, 이 요소 범위를 넘는 요청이면 ops를 [{op:\"reject\", reason:\"...한국어 사유...\"}] 하나로 반환한다",
      "- 요청한 변경만 최소로 수행한다. script·외부 URL 삽입 금지.",
    ].join("\n");
    const neighborLines = ctx.neighbors.map((n) => n.eid + " · " + n.kind + " · " + n.box + " · " + (n.text || "(텍스트 없음)"));
    const user = [
      "[선택 요소] eid=" + ctx.eid + " · kind=" + ctx.kind,
      "[outerHTML]", ctx.outerHTML, "",
      "[실측 박스(px)] " + (ctx.box ? "left=" + ctx.box.left + ", top=" + ctx.box.top + ", width=" + ctx.box.width + ", height=" + ctx.box.height : "(없음)"),
      "[뷰포트] " + ctx.viewport.width + " × " + ctx.viewport.height, "",
      "[이웃 요소 요약] (eid · kind · box · 텍스트 앞부분)", neighborLines.join("\n"), "",
      "[사용자 지시]", instruction,
    ].join("\n");
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  async function requestOps(ctx, instruction) {
    if ($("mock-toggle").checked) return ArchMock.generate(instruction, ctx.eid);
    if (!ArchConfig.has("nvidia-key")) throw new Error("NVIDIA 키가 없습니다 — 연결 설정에서 키를 입력하거나 mock 토글을 켜세요.");
    const tool = {
      name: "edit_element",
      description: "선택된 단일 요소에 대한 제한된 편집 op 목록(setText/setStyle/setAttr/reject)을 반환한다.",
      input_schema: DomAdapter.buildToolSchema(ctx.eid),
    };
    return await ArchLLM.chatTool({
      model: ArchConfig.get("model") || ArchConfig.DEFAULT_MODEL,
      messages: buildMessages(ctx, instruction), tool, maxTokens: 4000, temperature: 0,
    });
  }

  async function runEdit(instruction) {
    if (busy || !selected) return;
    if (provenance === "archify") { await runArchEdit(instruction); return; }
    if (selected.svgbox || selected.svgtext || selected.svgedge) { await runSvgEdit(instruction); return; }
    if (!sourceDoc) return;
    if (!instruction) { setPopError("지시를 입력하세요."); return; }
    busy = true; setPopBusy(true); setPopError("");
    const eid = selected.eid;
    try {
      const ctx = DomAdapter.contextFor(sourceDoc, eid, selected.rect);
      const raw = await requestOps(ctx, instruction);
      const { ops, reject, notes } = DomAdapter.sanitizeOps(raw, eid);
      if (reject) { setPopError("AI가 거절함: " + reject.reason); return; }
      if (!ops.length) { setPopError("적용할 수 있는 변경이 없습니다." + (notes.length ? " (" + notes.join("; ") + ")" : "")); return; }
      const res = commitOps(ops, eid, { flashEid: eid });
      if (!res.ok) { setPopError(res.error); return; }
      closePopover(); clearSelection();
      showToast("적용됨 · " + eid + (notes.length ? " (일부 항목 sanitize됨)" : ""), { actionLabel: "실행 취소", onAction: undo });
      if (notes.length) console.warn("[sanitize notes]", notes);
    } catch (err) {
      const prefix = err && err.name === "ScopeViolation" ? "범위 위반: " : "실패: ";
      setPopError(prefix + (err && err.message ? err.message : String(err)));
    } finally { busy = false; setPopBusy(false); }
  }

  // ---------------- 선택 모드 편집 루프 · class a (archify-JSON, ASYNC serve 왕복) ----------------
  // 흐름: resolveHit → contextFor → opsSchema(select) 강제 → chatTool/mock → apply(scope-gate) →
  //       serve /render(서버측 결정론적 재렌더) → verify(validate+check+bleed-diff) → 통과 시 승격.
  // class b와 동일한 UX(busy·에러·undo·flash)를 async 경로로 재현한다.

  function buildArchMessages(ctx, instruction) {
    const system = [
      "당신은 archify 다이어그램(JSON 소스 기반)의 요소 단위(element-scoped) 편집기다.",
      "다이어그램 종류: " + ctx.diagramType + ".",
      "레이아웃 예산: " + (ctx.budget || "(없음)"),
      "너는 정확히 하나의 요소만 편집한다: id=\"" + ctx.id + "\" (종류: " + ctx.kind + ").",
      "반드시 edit_element 도구를 호출해 ops 배열만 반환한다. 규칙:",
      "- op의 대상 id는 \"" + ctx.id + "\" 고정 (스키마상 다른 값은 불가능).",
      "- set_fields로 '바뀌는 필드만' 반환한다(예: {\"label\":\"...\"}). 나머지 필드는 건드리지 않으며 그대로 보존된다.",
      "- 이 요소 범위를 넘는 요청(다른 요소 이동/추가, 이웃 밀기 등)이면 [{op:\"reject\", reason:\"...한국어 사유...\"}] 하나만 반환한다.",
      "- 레이아웃 예산(라벨 길이·컬럼 범위 등)을 위반하지 않는다. 요청한 최소 변경만 수행한다.",
    ].join("\n");
    const neighborLines = (ctx.neighbors || []).map((n) => "- " + JSON.stringify(n));
    const user = [
      "[선택 요소 소스 JSON]",
      JSON.stringify(ctx.element, null, 2), "",
      "[이웃 요소 요약]",
      neighborLines.join("\n") || "(없음)", "",
      "[전체 소스 JSON]",
      JSON.stringify(ctx.source), "",
      "[사용자 지시]",
      instruction,
    ].join("\n");
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  function archMockExtract(instr) {
    const s = String(instr || "").trim();
    const q = s.match(/['"'‘“「『]([^'"'’”」』]+)['"'’”」』]/);
    if (q) return q[1].trim();
    const m = s.match(/(?:을|를)\s*(.+?)\s*(?:으로|로)\s*(?:바꿔|변경|수정|교체)/);
    if (m) return m[1].trim();
    return s || "수정됨";
  }

  // class-a 결정론적 mock (mock.js는 read-only라 인라인) — 선택 요소의 라벨/텍스트만 바꾼다.
  // stage-5 set_fields op으로 바뀐 필드 하나(label 또는 meta 제목)만 반환한다 → 스키마·bleed 통과,
  // 그 요소 클러스터만 재렌더(전체 오브젝트를 재생성하지 않아 경량·저오류).
  function archMockOps(instruction, ref) {
    const text = archMockExtract(instruction);
    if (META_KINDS.has(ref.kind)) {
      const key = ref.kind === "meta-title" ? "title" : "subtitle";
      return { ops: [{ op: "set_fields", id: ref.id, kind: ref.kind, fields: { [key]: text } }] };
    }
    return { ops: [{ op: "set_fields", id: ref.id, kind: ref.kind, fields: { label: text } }] };
  }

  async function requestArchOps(ctx, ref, instruction) {
    if ($("mock-toggle").checked) return archMockOps(instruction, ref);
    if (!ArchConfig.has("nvidia-key")) throw new Error("NVIDIA 키가 없습니다 — 연결 설정에서 키를 입력하거나 mock 토글을 켜세요.");
    const tool = {
      name: "edit_element",
      description: "선택된 단일 다이어그램 요소의 '바뀐 필드만' 담은 set_fields op 또는 reject를 반환한다.",
      input_schema: ArchifyJsonAdapter.opsSchema("select", ref),
    };
    return await ArchLLM.chatTool({
      model: ArchConfig.get("model") || ArchConfig.DEFAULT_MODEL,
      messages: buildArchMessages(ctx, instruction), tool, maxTokens: 4000, temperature: 0,
    });
  }

  // 선택-모드 scoped edit 코어 — 팝오버(runArchEdit)와 검증 findings의 "AI로 고치기"
  // (fixArchFinding)가 공유한다. apply(scope-gate) → serve /render → verify(단일 id
  // strict bleed) → 통과 시 승격. 실패 시 validator 메시지를 되먹여 최대 1회 자동수리(총 ≤2 LLM 호출).
  // 반환: { ok, changedId } | { ok:false, error|rejected }. UI 표출/토스트는 호출측 몫.
  async function archScopedEdit(ref, instruction) {
    const beforeModel = archModel;
    const beforeHtml = archModel.html;
    const ctx = ArchifyJsonAdapter.contextFor(archModel, ref);
    let lastFindings = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const instr = attempt === 0 ? instruction
        : instruction + "\n\n[직전 시도가 검증 실패 — 아래를 지키도록 고쳐서 다시 시도]\n" + (lastFindings || []).map((f) => f.message).join("\n");
      const raw = await requestArchOps(ctx, ref, instr);
      let applied;
      try { applied = ArchifyJsonAdapter.apply(archModel, raw, { ref, mode: "select" }); }
      catch (e) { return { ok: false, error: (e && e.name === "ScopeViolation" ? "범위 위반: " : "실패: ") + (e && e.message ? e.message : String(e)) }; }
      if (applied.rejected && !applied.changedIds.length) return { ok: false, rejected: applied.rejected };
      if (!applied.changedIds.length) return { ok: false, error: "적용할 변경이 없습니다." };
      const nextModel = applied.model;
      let html;
      try { html = await ArchifyJsonAdapter.render(nextModel, { baseUrl: serveBase }); }
      catch (e) { return { ok: false, error: "재렌더 실패(archify serve): " + (e && e.message ? e.message : String(e)) }; }
      let vr;
      try {
        vr = await ArchifyJsonAdapter.verify(nextModel, html, {
          baseUrl: serveBase, selectedId: ref.id, selectedKind: ref.kind, selectedCollection: ref.collection, beforeHtml,
        });
      } catch (e) { return { ok: false, error: "검증 실패: " + (e && e.message ? e.message : String(e)) }; }
      if (vr.ok) {
        pushUndo({ kind: "arch", model: beforeModel });
        archModel = ArchifyJsonAdapter.commit(nextModel, html);
        updateUndoBtn();
        return { ok: true, changedId: ref.id };
      }
      lastFindings = vr.findings; // 자동 revert(archModel 미변경) — 다음 라운드에 되먹임
    }
    return { ok: false, error: "검증 실패 — 자동 되돌림: " + (lastFindings || []).map((f) => f.message).slice(0, 2).join(" · ") };
  }

  async function runArchEdit(instruction) {
    if (!archModel) return;
    if (!serveAvailable) { setPopError("archify serve가 필요합니다 (python -m http.server로는 재렌더 불가)."); return; }
    if (!instruction) { setPopError("지시를 입력하세요."); return; }
    busy = true; setPopBusy(true); setPopError("");
    try {
      const ref = ArchifyJsonAdapter.resolveHit(archModel, { id: selected.id, kind: selected.kind, part: selected.part });
      if (!ref) { setPopError("선택 요소를 소스에서 찾을 수 없습니다: " + selected.id); return; }
      const res = await archScopedEdit(ref, instruction);
      if (!res.ok) { setPopError(res.rejected ? "AI가 거절함: " + res.rejected.reason : res.error); return; }
      pendingFlash = { id: ref.id };
      closePopover();
      selected = null;
      render();
      showToast("적용됨(archify) · " + ref.id, { actionLabel: "실행 취소", onAction: undo });
    } catch (err) {
      const prefix = err && err.name === "ScopeViolation" ? "범위 위반: " : "실패: ";
      setPopError(prefix + (err && err.message ? err.message : String(err)));
    } finally { busy = false; setPopBusy(false); }
  }

  // ================================================================= stage 5
  // class-a 5모드(편집·그리기·검증·레이아웃·다듬기). 모든 재렌더는 archify serve.
  // 편집=수동 property form(set_fields), 그리기=add_node form + add_edge 클릭-클릭,
  // 검증=LLM ①②③⑤ + native ④(/validate), 레이아웃/다듬기=광역 field-lock(set_fields).

  const ARCH_NODE_KINDS = new Set(["node", "component", "participant", "state", "stage"]);

  // class-a iframe 클릭 라우터(모드별). agent는 archify에서 모든 클릭을 arch-hit로
  // 보내고, 여기서 모드에 따라 분기한다. audit/layout/polish는 하이라이트만(무시).
  function handleArchHit(d) {
    const hit = { id: d.id, kind: d.kind, part: d.part, rect: d.rect };
    if (mode === "select") {
      selected = hit;
      // class-a도 서식 툴바를 **띄우되 전 항목 비활성**으로 둔다 — 조용히 숨기면 "왜 안 뜨지"가 되고,
      // 사유를 적어 보여주면 "여긴 속성 폼을 쓰라"는 안내가 된다(D21: 아무 일도 안 하는 버튼 금지).
      selection = [{ eid: hit.id, kind: hit.kind, rect: hit.rect }];
      updateFmtBar();
      if (!serveAvailable) { showToast("archify serve가 필요합니다 — 이 요소를 편집하려면 `archify serve`로 실행하세요."); return; }
      openPopover();
    } else if (mode === "edit") {
      if (!serveAvailable) { showToast("archify serve가 필요합니다 (재렌더 불가)."); return; }
      openArchEditForm(hit);
    } else if (mode === "draw") {
      onArchDrawHit(hit);
    }
  }

  // ---------------- class-a 편집 (수동 property form, LLM 없음) ----------------

  function archFormSpec(kind) {
    const E = ArchifyJsonAdapter.ENUMS;
    if (ARCH_NODE_KINDS.has(kind)) return [
      { key: "label", label: "라벨", type: "text" },
      { key: "sublabel", label: "부라벨", type: "text" },
      { key: "type", label: "종류", type: "select", options: E.componentType },
      { key: "tag", label: "태그", type: "text" },
      { key: "lane", label: "레인", type: "laneSelect" },
      { key: "col", label: "컬럼(0–5)", type: "number" },
    ];
    if (EDGE_KINDS.has(kind)) return [
      { key: "label", label: "라벨", type: "text" },
      { key: "variant", label: "variant", type: "select", options: E.variant, empty: true },
      { key: "route", label: "경로", type: "select", options: E.route, empty: true },
      { key: "fromSide", label: "출발면", type: "select", options: E.side, empty: true },
      { key: "toSide", label: "도착면", type: "select", options: E.side, empty: true },
    ];
    if (kind === "lane") return [
      { key: "label", label: "라벨", type: "text" },
      { key: "variant", label: "variant", type: "select", options: ["normal", "exception"], empty: true },
    ];
    if (kind === "phase" || kind === "group") return [
      { key: "label", label: "라벨", type: "text" },
      { key: "variant", label: "variant", type: "select", options: E.variant, empty: true },
      { key: "fromCol", label: "fromCol", type: "number" },
      { key: "toCol", label: "toCol", type: "number" },
    ];
    return [{ key: "label", label: "텍스트", type: "text" }]; // meta / fallback
  }

  function archLaneOptions() {
    const src = archModel && archModel.source ? archModel.source : {};
    return (src.lanes || []).map((l) => l.id);
  }

  function buildArchFormFields(ref) {
    const wrap = $("af-fields");
    wrap.innerHTML = "";
    const spec = archFormSpec(ref.kind);
    const src = ref.source || {};
    // meta: source obj is meta, value is title/subtitle
    const metaKey = ref.kind === "meta-title" ? "title" : ref.kind === "meta-subtitle" ? "subtitle" : null;
    for (const f of spec) {
      const row = document.createElement("label");
      row.className = "af-row";
      const cap = document.createElement("span");
      cap.className = "af-cap";
      cap.textContent = f.label;
      row.appendChild(cap);
      let input;
      const cur = metaKey ? (src[metaKey] || "") : (src[f.key] != null ? src[f.key] : "");
      if (f.type === "select" || f.type === "laneSelect") {
        input = document.createElement("select");
        const opts = f.type === "laneSelect" ? archLaneOptions() : f.options;
        const list = f.empty ? ["", ...opts] : opts;
        for (const o of list) {
          const opt = document.createElement("option");
          opt.value = o; opt.textContent = o === "" ? "—" : o;
          if (String(o) === String(cur)) opt.selected = true;
          input.appendChild(opt);
        }
      } else {
        input = document.createElement("input");
        input.type = f.type === "number" ? "number" : "text";
        if (f.type === "number") { input.min = "0"; input.max = "5"; input.step = "1"; }
        input.value = cur;
      }
      input.id = "af-" + f.key;
      input.dataset.key = f.key;
      input.dataset.ftype = f.type;
      row.appendChild(input);
      wrap.appendChild(row);
    }
  }

  function openArchEditForm(hit) {
    const ref = ArchifyJsonAdapter.resolveHit(archModel, { id: hit.id, kind: hit.kind, part: hit.part });
    if (!ref) { showToast("선택 요소를 소스에서 찾을 수 없습니다: " + hit.id); return; }
    archEditRef = ref;
    const pop = $("arch-edit-form");
    pop.hidden = false;
    positionFloating(pop, hit.rect, 340, 260);
    $("af-eid").textContent = ref.id + " · " + archKindLabel(ref.kind);
    buildArchFormFields(ref);
    setAfError(""); setAfBusy(false);
  }
  function closeArchEditForm() { $("arch-edit-form").hidden = true; archEditRef = null; setAfError(""); setAfBusy(false); }
  function setAfError(msg) { const el = $("af-error"); el.hidden = !msg; el.textContent = msg || ""; }
  function setAfBusy(on) { $("af-busy").hidden = !on; $("af-apply").disabled = on; }

  function collectArchFormFields(ref) {
    const spec = archFormSpec(ref.kind);
    const src = ref.source || {};
    const metaKey = ref.kind === "meta-title" ? "title" : ref.kind === "meta-subtitle" ? "subtitle" : null;
    const fields = {};
    for (const f of spec) {
      const el = $("af-" + f.key);
      if (!el) continue;
      let v = el.value;
      const curRaw = metaKey ? (src[metaKey] != null ? src[metaKey] : "") : (src[f.key] != null ? src[f.key] : "");
      if (f.type === "number") {
        if (v === "") { if (curRaw !== "" && curRaw != null) fields[f.key] = null; continue; }
        v = parseFloat(v); if (isNaN(v)) continue;
        if (v !== curRaw) fields[f.key] = v;
      } else {
        if ((v || "") === (String(curRaw) || "")) continue;
        fields[f.key] = v === "" ? null : v;
      }
    }
    if (metaKey && fields.label !== undefined) { fields[metaKey] = fields.label; delete fields.label; }
    return fields;
  }

  // 편집 커밋 코어(폼 UI와 테스트 훅 공용) — set_fields(scope-gate) → serve /render →
  // verify(단일 요소 + incident edges allow) → 통과 시 승격. 반환 { ok, changedIds } | { ok:false, error }.
  async function archEditCommit(ref, fields) {
    const before = archModel, beforeHtml = archModel.html;
    let applied;
    try { applied = ArchifyJsonAdapter.apply(archModel, { ops: [{ op: "set_fields", id: ref.id, kind: ref.kind, fields }] }, { ref, mode: "edit" }); }
    catch (e) { return { ok: false, error: (e && e.name === "ScopeViolation" ? "범위 위반: " : "실패: ") + (e && e.message ? e.message : String(e)) }; }
    const nextModel = applied.model;
    let html;
    try { html = await ArchifyJsonAdapter.render(nextModel, { baseUrl: serveBase }); }
    catch (e) { return { ok: false, error: "재렌더 실패 — 자동 되돌림: " + cleanServeError(e) }; }
    const allowedIds = ArchifyJsonAdapter.expandAllowed(nextModel, applied.changedIds);
    let vr;
    try { vr = await ArchifyJsonAdapter.verify(nextModel, html, { baseUrl: serveBase, allowedIds, beforeHtml }); }
    catch (e) { return { ok: false, error: "검증 실패: " + (e && e.message ? e.message : String(e)) }; }
    if (!vr.ok) return { ok: false, error: "검증 실패 — 자동 되돌림: " + (vr.findings || []).map((f) => f.message).slice(0, 2).join(" · "), findings: vr.findings };
    pushUndo({ kind: "arch", model: before });
    archModel = ArchifyJsonAdapter.commit(nextModel, html);
    updateUndoBtn();
    return { ok: true, changedIds: applied.changedIds };
  }

  async function applyArchEditForm() {
    if (busy || !archEditRef) return;
    const ref = archEditRef;
    const fields = collectArchFormFields(ref);
    if (!Object.keys(fields).length) { setAfError("변경된 필드가 없습니다."); return; }
    busy = true; setAfBusy(true); setAfError("");
    try {
      const res = await archEditCommit(ref, fields);
      if (!res.ok) { setAfError(res.error); return; }
      pendingFlash = { id: ref.id };
      closeArchEditForm(); render();
      showToast("편집 적용 · " + ref.id, { actionLabel: "실행 취소", onAction: undo });
    } finally { busy = false; setAfBusy(false); }
  }

  // ---------------- class-a 그리기 (add_node 폼 + add_edge 클릭-클릭) ----------------

  // add_node/add_edge 공통 커밋: apply(add) → serve /render → validate(배치오류) +
  // addDiff(새 클러스터만) 검증 → 통과 시 승격, 실패 시 fix suggestion 표출.
  async function archCommitAdd(op, newIdHint, label) {
    const before = archModel, beforeHtml = archModel.html;
    let applied;
    try { applied = ArchifyJsonAdapter.apply(archModel, { ops: [op] }, { mode: "all" }); }
    catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
    const newIds = applied.changedIds;
    const nextModel = applied.model;
    let html;
    try { html = await ArchifyJsonAdapter.render(nextModel, { baseUrl: serveBase }); }
    catch (e) { return { ok: false, error: "배치 불가 — " + cleanServeError(e) }; } // 렌더러 layout validation이 배치오류를 반려
    let vr;
    try { vr = await ArchifyJsonAdapter.verify(nextModel, html, { baseUrl: serveBase, addedIds: newIds, beforeHtml }); }
    catch (e) { return { ok: false, error: "검증 실패: " + (e && e.message ? e.message : String(e)) }; }
    if (!vr.ok) return { ok: false, error: "검증 실패 — 자동 되돌림: " + (vr.findings || []).map((f) => f.message).slice(0, 2).join(" · ") };
    pushUndo({ kind: "arch", model: before });
    archModel = ArchifyJsonAdapter.commit(nextModel, html);
    pendingFlash = { id: newIdHint || newIds[newIds.length - 1] };
    render(); updateUndoBtn();
    return { ok: true, id: newIdHint || newIds[newIds.length - 1] };
  }

  function cleanServeError(e) {
    const m = (e && e.message ? e.message : String(e)).replace(/^.*HTTP \d+:\s*/, "");
    return m.split("\n").slice(0, 3).join(" ").slice(0, 240);
  }

  async function runArchAddNode(spec) {
    if (busy || !archModel) return { ok: false, error: "busy" };
    busy = true; setAdError("");
    try {
      const node = { id: spec.id, lane: spec.lane, col: spec.col, type: spec.type, label: spec.label };
      const res = await archCommitAdd({ op: "add_node", node }, spec.id, "노드");
      if (!res.ok) { setAdError(res.error); return res; }
      showToast("노드 추가 · " + spec.id, { actionLabel: "실행 취소", onAction: undo });
      return res;
    } finally { busy = false; }
  }

  async function runArchAddEdge(from, to) {
    if (busy || !archModel) return { ok: false, error: "busy" };
    busy = true; setAdError("");
    try {
      const res = await archCommitAdd({ op: "add_edge", edge: { from, to } }, null, "엣지");
      if (!res.ok) { setAdError(res.error); showToast("엣지 추가 실패: " + res.error); return res; }
      showToast("엣지 추가 · " + from + " → " + to, { actionLabel: "실행 취소", onAction: undo });
      return res;
    } finally { busy = false; }
  }

  function setAdError(msg) { const el = $("ad-error"); if (el) { el.hidden = !msg; el.textContent = msg || ""; } }

  // 그리기 캔버스 클릭(엣지 연결 하위모드에서 소스→대상 노드 두 번 클릭)
  function onArchDrawHit(hit) {
    if (archDrawSub !== "edge") return; // 노드 추가는 폼 주도 — 캔버스 클릭 무시
    if (!ArchifyJsonAdapter.isNodeKind(hit.kind)) { showToast("노드를 클릭하세요 (엣지 연결)"); return; }
    if (!archEdgeSource) {
      archEdgeSource = hit.id;
      postToView({ type: "arch-select", id: hit.id });
      showToast("소스: " + hit.id + " → 대상 노드를 클릭하세요");
      return;
    }
    if (hit.id === archEdgeSource) { showToast("다른 노드를 대상으로 선택하세요"); return; }
    const from = archEdgeSource, to = hit.id;
    archEdgeSource = null;
    runArchAddEdge(from, to);
  }

  function openArchDrawPanel() {
    const p = $("arch-draw-panel");
    if (!p) return;
    p.hidden = false;
    setArchDrawSub(archDrawSub);
    // populate add_node lane/type dropdowns
    const laneSel = $("ad-lane"); laneSel.innerHTML = "";
    for (const id of archLaneOptions()) { const o = document.createElement("option"); o.value = id; o.textContent = id; laneSel.appendChild(o); }
    const typeSel = $("ad-type"); typeSel.innerHTML = "";
    for (const t of ArchifyJsonAdapter.ENUMS.componentType) { const o = document.createElement("option"); o.value = t; o.textContent = t; typeSel.appendChild(o); }
    setAdError("");
  }
  function setArchDrawSub(sub) {
    archDrawSub = sub;
    archEdgeSource = null;
    [...document.querySelectorAll("#arch-draw-panel [data-adsub]")].forEach((b) => b.classList.toggle("active", b.dataset.adsub === sub));
    $("ad-node-form").hidden = sub !== "node";
    $("ad-edge-hint").hidden = sub !== "edge";
  }

  // add_node 폼 제출: id는 세션 유일값 자동 발급
  function freshArchNodeId() {
    const src = archModel.source || {};
    const F = ArchifyJsonAdapter.TYPE_FIELDS[archModel.type] || ArchifyJsonAdapter.TYPE_FIELDS.workflow;
    const ids = new Set((src[F.nodes] || []).map((n) => n && n.id));
    let i = 1; while (ids.has("n" + i)) i++;
    return "n" + i;
  }
  async function submitArchAddNode() {
    if (busy) return;
    const lane = $("ad-lane").value, type = $("ad-type").value;
    const col = parseInt($("ad-col").value, 10);
    const label = $("ad-label").value.trim() || "새 노드";
    if (!lane) { setAdError("레인을 선택하세요."); return; }
    if (!(col >= 0 && col <= 5)) { setAdError("컬럼은 0–5 사이여야 합니다."); return; }
    const res = await runArchAddNode({ id: freshArchNodeId(), lane, col, type, label });
    if (res.ok) $("ad-label").value = "";
  }

  // ---------------- class-a 콘텐츠 검증 (①②③⑤ LLM · ④ native /validate) ----------------

  function buildArchAuditMessages(kind, inv) {
    const focus = {
      1: "맞춤법·띄어쓰기·문법 오류만",
      2: "용어/표기 불일치(같은 개념을 다르게 부르는 곳)만",
      3: "요소 텍스트 간 사실·정합성 모순만 (참조 문서 없음 — 내부 일관성 위주, 확신 없으면 지적 자제)",
      5: "맞춤법·용어 일관성·사실 정합성 전반",
    }[kind] || "전반";
    const system = [
      "당신은 archify 다이어그램의 텍스트 감수자다. 아래 요소 인벤토리를 읽고 " + focus + " 지적한다.",
      "반드시 report_findings 도구로 findings 배열을 반환한다. 각 finding = {arch_id(주어진 목록 중 하나), issue(한국어 지적), suggestion(고칠 방향, 한국어)}.",
      "지적할 게 없으면 findings를 빈 배열로. 존재하지 않는 arch_id를 만들지 않는다.",
    ].join("\n");
    const lines = inv.map((e) => e.arch_id + " · " + e.kind + " · " + (e.text || "(빈 텍스트)"));
    return [{ role: "system", content: system }, { role: "user", content: "[요소 인벤토리]\n" + lines.join("\n") + "\n\n[지시] " + AUDIT_LABEL[kind] + " 관점으로 감수." }];
  }

  async function requestArchAudit(kind, inv) {
    if ($("mock-toggle").checked) return archMockAudit(kind, inv);
    if (!ArchConfig.has("nvidia-key")) throw new Error("NVIDIA 키가 없습니다 — 연결 설정에서 키를 입력하거나 mock을 켜세요.");
    const tool = { name: "report_findings", description: "요소별 감수 지적 목록을 반환한다.", input_schema: ArchifyJsonAdapter.buildAuditSchema(inv.map((e) => e.arch_id)) };
    return await ArchLLM.chatTool({ model: ArchConfig.get("model") || ArchConfig.DEFAULT_MODEL, messages: buildArchAuditMessages(kind, inv), tool, maxTokens: 4000, temperature: 0 });
  }

  async function runArchAudit(kind) {
    if (busy) return;
    mode = "audit"; updateModeUI(); postMode();
    $("audit-menu").hidden = true; $("btn-audit").setAttribute("aria-expanded", "false");
    openFindingsPanel();
    $("fp-title").textContent = "콘텐츠 검증(archify) · " + AUDIT_LABEL[kind];
    setFpStatus(kind === 4 ? "구조·겹침 native 검증 중…" : "AI 검증 중…", kind === 4 ? "mech" : "busy");
    findings = []; renderFindings(kind); busy = true;
    try {
      if (kind === 4) {
        const nv = await ArchifyJsonAdapter.nativeValidate(archModel, { baseUrl: serveBase });
        findings = nv.findings.map((f) => ({ eid: f.arch_id, kind: f.arch_id ? "structure" : "info", issue: f.issue, suggestion: f.suggestion }));
        setFpStatus(nv.ok ? "구조 검증 통과 · 0건" : "native 검증 · " + findings.length + "건 (겹침·교차·라벨충돌)", "mech");
      } else {
        const inv = ArchifyJsonAdapter.textInventory(archModel).filter((e) => e.text);
        const raw = await requestArchAudit(kind, inv);
        findings = ((raw && raw.findings) || []).filter((f) => f && f.arch_id).map((f) => ({ eid: f.arch_id, kind: "ai", issue: f.issue, suggestion: f.suggestion }));
        setFpStatus("AI 검증 완료 · " + findings.length + "건", "ai");
      }
    } catch (err) {
      setFpStatus("검증 실패: " + (err && err.message ? err.message : String(err)), "");
      findings = [];
    } finally { busy = false; renderFindings(kind); }
  }

  // finding "AI로 고치기" — 선택-모드 scoped edit 루프를 재사용해 그 요소만 고친다.
  async function fixArchFinding(f, btn) {
    if (busy || !archModel) return;
    if (!f.eid) { showToast("이 지적은 특정 요소에 고정되지 않았습니다."); return; }
    const ref = ArchifyJsonAdapter.resolveHit(archModel, { id: f.eid });
    if (!ref) { showToast("요소를 찾을 수 없음: " + f.eid); return; }
    busy = true; if (btn) btn.disabled = true;
    try {
      const res = await archScopedEdit(ref, f.suggestion || f.issue || "이 요소의 지적 사항을 고쳐줘");
      if (!res.ok) { showToast(res.rejected ? "AI가 거절함: " + res.rejected.reason : res.error); return; }
      pendingFlash = { id: ref.id }; render();
      showToast("고침 적용 · " + ref.id, { actionLabel: "실행 취소", onAction: undo });
    } catch (err) { showToast("고치기 실패: " + (err && err.message ? err.message : String(err))); }
    finally { busy = false; if (btn) btn.disabled = false; }
  }

  // ---------------- class-a 광역 field-lock 커밋 코어 (레이아웃/다듬기 공용) ----------------
  // set_fields ops(이미 field-lock sanitize됨) → apply → serve /render → verify
  // (레이아웃은 changed ⊇ incident edges까지 allow, 다듬기는 changed만) → 통과 시 승격.
  async function archApplyFieldOps(ops, mode) {
    const before = archModel, beforeHtml = archModel.html;
    let applied;
    try { applied = ArchifyJsonAdapter.apply(archModel, { ops }, { mode }); }
    catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
    const nextModel = applied.model;
    let html;
    try { html = await ArchifyJsonAdapter.render(nextModel, { baseUrl: serveBase }); }
    catch (e) { return { ok: false, error: "재렌더 실패 — 자동 되돌림: " + cleanServeError(e), reverted: true }; }
    const allowedIds = mode === "layout" ? ArchifyJsonAdapter.expandAllowed(nextModel, applied.changedIds) : applied.changedIds;
    let vr;
    try { vr = await ArchifyJsonAdapter.verify(nextModel, html, { baseUrl: serveBase, allowedIds, beforeHtml }); }
    catch (e) { return { ok: false, error: "검증 실패: " + (e && e.message ? e.message : String(e)) }; }
    if (!vr.ok) return { ok: false, error: "검증 실패 — 자동 되돌림: " + (vr.findings || []).map((f) => f.message).slice(0, 2).join(" · "), reverted: true, findings: vr.findings };
    pushUndo({ kind: "arch", model: before });
    archModel = ArchifyJsonAdapter.commit(nextModel, html);
    render(); updateUndoBtn();
    return { ok: true, changedIds: applied.changedIds };
  }

  // ---------------- class-a 레이아웃 수정 (광역, geometry 필드만) ----------------

  function buildArchLayoutMessages(instruction, inv) {
    const system = [
      "당신은 archify 다이어그램의 레이아웃 편집기다. 다이어그램 종류: " + archModel.type + ".",
      "layout_edits 도구로 ops를 반환한다. 각 op = set_fields{ id(주어진 목록 중 하나), fields }.",
      "★ fields는 위치·라우팅(레이아웃) 필드만 허용된다: " + ArchifyJsonAdapter.LAYOUT_FIELDS.join(", ") + ". 텍스트·색은 스키마에 없어 불가.",
      "겹치지 않게 지시대로 재배치한다. 바꿀 필요 없는 요소는 op를 내지 않는다.",
      "워크플로 규칙: col은 정수 0–5(고정 x), lane은 기존 lane id, 같은 lane의 노드는 서로 8px 이상 떨어져야 한다.",
    ].join("\n");
    const nodeLines = inv.nodes.map((n) => n.id + " · lane=" + n.lane + " col=" + n.col + (n.width ? " w=" + n.width : ""));
    const edgeLines = inv.edges.map((e) => e.id + " · " + e.from + "→" + e.to + " route=" + e.route);
    return [{ role: "system", content: system }, { role: "user", content: "[노드 배치]\n" + nodeLines.join("\n") + "\n\n[엣지 라우팅]\n" + edgeLines.join("\n") + "\n\n[지시] " + instruction }];
  }

  async function requestArchLayout(instruction, inv, ids) {
    if ($("mock-toggle").checked) return archMockLayout(instruction, inv);
    if (!ArchConfig.has("nvidia-key")) throw new Error("NVIDIA 키가 없습니다 — 연결 설정에서 키를 입력하거나 mock을 켜세요.");
    const tool = { name: "layout_edits", description: "위치·라우팅(레이아웃)만 바꾸는 set_fields 목록.", input_schema: ArchifyJsonAdapter.buildLayoutSchema(ids) };
    return await ArchLLM.chatTool({ model: ArchConfig.get("model") || ArchConfig.DEFAULT_MODEL, messages: buildArchLayoutMessages(instruction, inv), tool, maxTokens: 6000, temperature: 0 });
  }

  async function runArchLayout(instruction) {
    if (busy) return;
    if (!instruction) { setWdError("지시를 입력하세요."); return; }
    busy = true; setWdBusy(true); setWdError("");
    try {
      const inv = ArchifyJsonAdapter.layoutInventory(archModel);
      const ids = [...inv.nodes.map((n) => n.id), ...inv.edges.map((e) => e.id)];
      const raw = await requestArchLayout(instruction, inv, ids);
      const { ops, reject, notes } = ArchifyJsonAdapter.sanitizeLayoutOps(raw, ids);
      if (reject) { setWdError("AI가 거절함: " + reject.reason); return; }
      if (!ops.length) { setWdError("적용할 레이아웃 변경이 없습니다." + (notes.length ? " (필드 잠금: " + notes.slice(0, 2).join("; ") + ")" : "")); return; }
      const allowed = [...new Set(ops.map((o) => o.id))];
      pendingArchLayout = { ops, allowed, notes };
      $("wd-confirm-text").innerHTML = "<b>" + allowed.length + "개</b> 요소의 위치·라우팅이 바뀝니다. 적용할까요?" +
        (notes.length ? "<br><span style='font-size:12px;color:#9A9AA5'>필드 잠금으로 걸러진 항목 " + notes.length + "건</span>" : "");
      $("wd-confirm").hidden = false;
    } catch (err) { setWdError("실패: " + (err && err.message ? err.message : String(err))); }
    finally { busy = false; setWdBusy(false); }
  }

  async function applyArchLayout() {
    if (!pendingArchLayout) { $("wd-confirm").hidden = true; return; }
    const { ops } = pendingArchLayout;
    $("wd-confirm").hidden = true;
    busy = true; setWdBusy(true);
    try {
      const res = await archApplyFieldOps(ops, "layout");
      if (!res.ok) { setWdError(res.error); showToast("레이아웃 적용 실패: " + res.error); return; }
      showToast(res.changedIds.length + "개 요소 레이아웃 변경 적용됨", { actionLabel: "실행 취소", onAction: undo });
    } finally { busy = false; setWdBusy(false); pendingArchLayout = null; }
  }

  // ---------------- class-a 콘텐츠 다듬기 (광역, 텍스트 필드만) ----------------

  function buildArchPolishMessages(instruction, inv) {
    const system = [
      "당신은 archify 다이어그램의 카피 에디터다.",
      "polish_edits 도구로 ops를 반환한다. 각 op = set_fields{ id(주어진 목록 중 하나), fields }.",
      "★ fields는 텍스트 필드만 허용된다: label, sublabel, tag (meta 요소는 title/subtitle). 위치·크기는 스키마에 없어 불가.",
      "톤/용어 통일·군더더기 제거 등 지시를 따른다. 바꿀 필요 없는 요소는 op를 내지 않는다.",
    ].join("\n");
    const lines = inv.map((e) => e.arch_id + " · " + e.kind + " · " + (e.text || "(빈 텍스트)"));
    return [{ role: "system", content: system }, { role: "user", content: "[요소 텍스트]\n" + lines.join("\n") + "\n\n[지시] " + instruction }];
  }

  async function requestArchPolish(instruction, inv, ids) {
    if ($("mock-toggle").checked) return archMockPolish(instruction, inv);
    if (!ArchConfig.has("nvidia-key")) throw new Error("NVIDIA 키가 없습니다 — 연결 설정에서 키를 입력하거나 mock을 켜세요.");
    const tool = { name: "polish_edits", description: "텍스트만 바꾸는 set_fields 목록.", input_schema: ArchifyJsonAdapter.buildPolishSchema(ids) };
    return await ArchLLM.chatTool({ model: ArchConfig.get("model") || ArchConfig.DEFAULT_MODEL, messages: buildArchPolishMessages(instruction, inv), tool, maxTokens: 6000, temperature: 0 });
  }

  function polishAfterText(fields) {
    if (fields.label != null) return fields.label;
    if (fields.title != null) return fields.title;
    if (fields.subtitle != null) return fields.subtitle;
    if (fields.sublabel != null) return fields.sublabel;
    if (fields.tag != null) return fields.tag;
    return JSON.stringify(fields);
  }

  async function runArchPolish(instruction) {
    if (busy) return;
    if (!instruction) { setWdError("지시를 입력하세요."); return; }
    busy = true; setWdBusy(true); setWdError("");
    try {
      const inv = ArchifyJsonAdapter.textInventory(archModel).filter((e) => e.text);
      const ids = inv.map((e) => e.arch_id);
      const raw = await requestArchPolish(instruction, inv, ids);
      const { ops, reject, notes } = ArchifyJsonAdapter.sanitizePolishOps(raw, ids);
      if (reject) { setWdError("AI가 거절함: " + reject.reason); return; }
      if (!ops.length) { setWdError("적용할 텍스트 변경이 없습니다." + (notes.length ? " (필드 잠금: " + notes.slice(0, 2).join("; ") + ")" : "")); return; }
      const invMap = new Map(inv.map((e) => [e.arch_id, e]));
      pendingArchPolish = { rows: ops.map((o) => ({ eid: o.id, before: (invMap.get(o.id) || {}).label || (invMap.get(o.id) || {}).text || "", after: polishAfterText(o.fields), op: o })), notes };
      renderPolishRows(pendingArchPolish.rows);
      $("wd-bar").hidden = true; $("findings-panel").hidden = true; $("polish-panel").hidden = false;
    } catch (err) { setWdError("실패: " + (err && err.message ? err.message : String(err))); }
    finally { busy = false; setWdBusy(false); }
  }

  async function applyArchPolish() {
    if (!pendingArchPolish) return;
    const checked = [...document.querySelectorAll("#pp-list input[type=checkbox]:checked")].map((c) => c.dataset.eid);
    const ops = pendingArchPolish.rows.filter((r) => checked.includes(r.eid)).map((r) => r.op);
    if (!ops.length) { showToast("선택된 항목이 없습니다."); return; }
    busy = true;
    try {
      const res = await archApplyFieldOps(ops, "polish");
      if (!res.ok) { showToast("다듬기 적용 실패: " + res.error); return; }
      showToast(ops.length + "개 텍스트 다듬기 적용됨", { actionLabel: "실행 취소", onAction: undo });
      closePolish();
    } finally { busy = false; pendingArchPolish = null; }
  }

  // ---------------- class-a 결정론적 mock (mock.js는 class-b 전용이라 인라인) ----------------

  function archMockAudit(kind, inv) {
    const nodes = (inv || []).filter((e) => ARCH_NODE_KINDS.has(e.kind) && e.text);
    const n = kind === 5 ? 2 : 1;
    const label = { 1: "맞춤법·문법", 2: "용어 일관성", 3: "사실·정합성", 5: "전체" }[kind] || "검증";
    const findings = [];
    for (let i = 0; i < Math.min(n, nodes.length); i++) {
      const t = nodes[i];
      findings.push({ arch_id: t.arch_id, issue: "[mock · " + label + "] '" + (t.text || "").slice(0, 18) + "' 항목에 예시 지적을 답니다.", suggestion: "라벨을 '검증본" + (i + 1) + "'로 바꿔줘" });
    }
    if (!findings.length && inv[0]) findings.push({ arch_id: inv[0].arch_id, issue: "[mock] 지적할 텍스트 요소를 찾지 못했습니다.", suggestion: "라벨을 '검증본'로 바꿔줘" });
    return { findings };
  }

  // geometry 지시면 텍스트 op을 일부러 내 field-lock이 걸러냄을 보이고, 아니면 빈 col로 이동.
  function archMockLayout(instruction, inv) {
    const s = String(instruction || "");
    const nodes = inv.nodes || [];
    if (/텍스트|제목|라벨|label|이름|색/i.test(s)) {
      const n0 = nodes[0] || { id: "x", kind: "node" };
      return { ops: [{ op: "set_fields", id: n0.id, kind: n0.kind, fields: { label: "레이아웃모드-텍스트변경-시도" } }] };
    }
    for (const nd of nodes) {
      const occupied = new Set(nodes.filter((m) => m.lane === nd.lane && m.id !== nd.id).map((m) => m.col));
      occupied.add(nd.col);
      for (let c = 0; c <= 5; c++) { if (!occupied.has(c)) return { ops: [{ op: "set_fields", id: nd.id, kind: nd.kind, fields: { col: c } }] }; }
    }
    return { ops: [{ op: "reject", reason: "mock: 이동할 빈 컬럼이 없습니다." }] };
  }

  // 위치·크기 지시면 geometry op을 일부러 내 역방향 field-lock이 걸러냄을 보이고,
  // 아니면 meta:subtitle(레이아웃 무관 = reflow 안전)을 다듬는다.
  function archMockPolish(instruction, inv) {
    const s = String(instruction || "");
    if (/위치|크기|이동|정렬|간격|좌표|컬럼|레인|col|lane|width|height/i.test(s)) {
      const e0 = inv[0] || { arch_id: "x" };
      return { ops: [{ op: "set_fields", id: e0.arch_id, fields: { col: 0 } }] };
    }
    const sub = inv.find((e) => e.arch_id === "meta:subtitle");
    if (sub) return { ops: [{ op: "set_fields", id: "meta:subtitle", fields: { subtitle: "다듬은 부제 — 간결하게" } }] };
    const t = inv.find((e) => ARCH_NODE_KINDS.has(e.kind) && e.label);
    if (t) return { ops: [{ op: "set_fields", id: t.arch_id, fields: { label: (t.label || "").split(/\s+/)[0] || "다듬음" } }] };
    return { ops: [{ op: "reject", reason: "mock: 다듬을 텍스트가 없습니다." }] };
  }

  // ---------------- 편집 모드 (수동, LLM 없음) ----------------

  function hexOnly(value, dflt) {
    const v = String(value || "").trim();
    let m = /^#([0-9a-fA-F]{6})$/.exec(v);
    if (m) return "#" + m[1].toLowerCase();
    m = /^#([0-9a-fA-F]{3})$/.exec(v);
    if (m) return "#" + m[1].split("").map((c) => c + c).join("").toLowerCase();
    return dflt;
  }
  function normalizeWeight(w) {
    const v = String(w || "").trim();
    if (v === "bold") return "700";
    if (v === "normal") return "400";
    if (/^(400|500|600|700|800)$/.test(v)) return v;
    return "";
  }

  // ★ 팝업 폐지(2026-07-21): 상세 팝업 4종(#edit/#svgbox/#svgtext/#svgedge-panel)을 DOM·배선까지 삭제했다.
  //   선택 전환·모드 전환 시 "열린 상세 팝업을 닫는다"는 정리 호출이 여러 곳에 있어, 그 호출부 호환을 위해
  //   단일 no-op로 남긴다(닫을 팝업이 없으므로 아무 일도 하지 않는다). class-b 글자색·배경·크기·굵기는
  //   툴바(fmtTextColor/fmtFill/fmtSize/fmtWeight)가 담당하므로 applyManualStyle도 함께 삭제.
  function closeDetailPanels() {}

  // 드래그 이동 / 리사이즈 커밋 (agent가 실측 geometry props를 보냄)
  //   D43: 표를 세로로 줄이면 뷰(agent.fitTableFont)가 실측해 셀 폰트를 축소한 값을 props.fontSize로 함께
  //     보낸다 — 위치·크기와 같은 단일 setStyle(target:box) op에 실어 단일 undo·단일 bleed로 커밋한다
  //     (fontSize는 이미 STYLE_WHITELIST에 있어 sanitize 통과, div에 얹으면 셀이 상속+em 패딩이 비례 축소).
  function applyGeom(eid, props) {
    const style = {};
    for (const k of ["left", "top", "width", "height", "fontSize"]) if (props && props[k] != null) style[k] = props[k];
    if (!Object.keys(style).length) return;
    const raw = { ops: [{ op: "setStyle", eid, style, target: "box" }] };
    const { ops } = DomAdapter.sanitizeOps(raw, eid);
    if (!ops.length) { showToast("위치·크기 값이 유효하지 않습니다."); return; }
    const res = commitOps(ops, eid, { reselectEid: eid });
    if (!res.ok) { showToast(res.error); return; }
    showToast("위치·크기 변경 · " + eid, { actionLabel: "실행 취소", onAction: undo });
  }

  // D41: 다중 선택 그룹 이동 커밋 — 뷰가 실측한 각 유닛의 새 위치를 한 배치 op로 모아 단일 undo로 커밋한다.
  //   obj는 setStyle(target:box, left/top), svgbox/svgtext는 move(x,y). sanitizeBatch가 선택집합 게이트+어댑터
  //   라우팅을, commitOps(apply=applyMixedOps, bleed=SvgAdapter.bleedDiff)가 "선택 집합 밖 바이트 동일"을 실증한다.
  //   → D22 배치서식과 완전히 같은 커밋 인프라를 재사용(새 bleed 모드 불필요 — "replace"가 이미 다중 eid 집합축).
  function applyGroupMove(moves) {
    if (!directEditGate() || !Array.isArray(moves) || moves.length < 1) return;
    const set = selectionSet();
    const rawOps = [];
    for (const m of moves) {
      if (!m || !set.has(m.eid)) continue;   // 선택 집합 밖은 무시(뷰-부모 상태 어긋남 방어)
      if (m.kind === "obj") rawOps.push({ op: "setStyle", eid: m.eid, target: "box", style: { left: m.left, top: m.top } });
      else if (m.kind === "svgbox" || m.kind === "svgtext") rawOps.push({ op: "move", eid: m.eid, x: m.x, y: m.y });
    }
    if (!rawOps.length) return;
    let prepared;
    try { prepared = sanitizeBatch(rawOps, set); }
    catch (err) { showToast((err.name === "ScopeViolation" ? "범위 위반: " : "실패: ") + err.message, { ms: 6000 }); return; }
    if (!prepared.ops.length) return;
    const res = commitOps(prepared.ops, set, { apply: applyMixedOps, bleed: SvgAdapter.bleedDiff, keepSelection: true });
    if (!res.ok) { showToast("그룹 이동 실패: " + res.error, { ms: 7000 }); return; }
    showToast("그룹 이동 · " + rawOps.length + "개 요소", { actionLabel: "실행 취소", onAction: undo });
  }

  // contenteditable 텍스트 커밋
  // D26: obj(class-b) 인라인 커밋도 setText + pending 서식(setStyle target:text)을 한 배치로 → 단일 undo.
  //   ON 더블클릭 등 세션 없는 경로는 changed 미지정(=true)·pending 없음 → 종전과 동일.
  function applyText(eid, text, changed) {
    const hasSess = inlineSession && inlineSession.eid === eid && inlineSession.kind === "obj";
    const line = hasSess ? inlineSession.line : null;   // D27c(a): 편집한 줄 인덱스(깨끗한 구조일 때만 non-null)
    const pend = hasSess ? inlinePendingOps() : [];
    if (hasSess) inlineSession = null;
    const raw = [];
    if (changed !== false && typeof text === "string") {
      const op = { op: "setText", eid, text };
      if (line != null) op.line = line;
      raw.push(op);
    }
    raw.push(...pend);
    // D28: 무변경 + 무-pending 커밋(줄→줄 전환에서 타이핑 없이 넘어가는 obj 인라인 커밋)은 raw가 비어 있다.
    //   DomAdapter.sanitizeOps는 빈 ops 배열에 "응답에 ops 배열이 없습니다"를 throw하므로(select-mode 계약),
    //   sanitize 이전에 먼저 가드한다. (형제 applyInlineCommit은 sanitize 후 가드라 이 경로만 그동안 던졌음.)
    if (!raw.length) { updateFmtBar(); return; }
    const { ops } = DomAdapter.sanitizeOps({ ops: raw }, eid);
    if (!ops.length) { updateFmtBar(); return; }
    const res = commitOps(ops, eid, { reselectEid: eid });
    if (!res.ok) { showToast(res.error); updateFmtBar(); return; }
    showToast((changed === false ? "서식 변경 · " : "텍스트 변경 · ") + eid, { actionLabel: "실행 취소", onAction: undo });
    updateFmtBar();
  }

  // ---------------- class c: SVG 박스 편집 (§3.3 확장) ----------------
  // 공통 커밋: SvgAdapter.sanitizeOps로 색 토큰/좌표/도형 잠금 → commitOps(apply=SvgAdapter.applyOps)
  // → DomAdapter.bleedDiff(집합 축, 박스 밖 바이트 동일 실증) → undo 스택은 class b와 공유.
  function commitSvgOps(rawOps, eid, opts = {}) {
    const shape = SvgAdapter.shapeOf(sourceDoc, eid);
    const { ops, reject, notes } = SvgAdapter.sanitizeOps({ ops: rawOps }, eid, shape);
    if (reject) return { ok: false, reject, notes };
    if (!ops.length) return { ok: false, error: "적용 가능한 변경이 없습니다.", notes };
    const res = commitOps(ops, eid, { apply: SvgAdapter.applyOps, bleed: SvgAdapter.bleedDiff, ...opts });
    return { ...res, notes };
  }

  // 선택 모드 LLM 편집 루프 (SVG 박스). class b runEdit과 같은 UX(busy·에러·undo·flash).
  function buildSvgMessages(ctx, instruction) {
    if (ctx.kind === "svgedge") return buildSvgEdgeMessages(ctx, instruction);
    if (ctx.kind === "svgtext") return buildSvgTextMessages(ctx, instruction);
    const lineHint = (ctx.lines && ctx.lines.length > 1)
      ? "- setText: 박스 라벨 텍스트 교체. 이 박스는 여러 줄이다 — 특정 줄을 바꾸려면 line(0-based 문서순)을 함께 준다. line 생략 시 주 라벨(줄 " + (ctx.mainLine >= 0 ? ctx.mainLine : 0) + ")을 바꾼다.\n  줄 목록: " + ctx.lines.map((l) => l.index + "=\"" + l.text + "\"").join(", ")
      : "- setText: 박스 대표 라벨 텍스트 교체";
    const system = [
      "당신은 다이어그램 슬라이드의 인라인 SVG 박스 단위(element-scoped) 편집기다.",
      "대상은 <svg viewBox=\"" + ctx.viewBox + "\"> 안의 박스 <g transform=\"translate(x y)\">이며, 정확히 하나만 편집한다: data-arch-eid=\"" + ctx.eid + "\" (도형: " + ctx.shape + ").",
      "반드시 edit_svg_box 도구로 ops 배열만 반환한다. op 어휘(각 op의 eid는 \"" + ctx.eid + "\" 고정, 스키마상 다른 값 불가):",
      lineHint,
      "- setFill: 박스 도형의 fill(채움색) — 유효한 CSS/SVG 색 토큰(hex/rgb/hsl/named)",
      "- setStroke: 박스 도형의 stroke(테두리색)",
      "- move: <g transform> 이동 — x,y는 SVG user 좌표(현재 x=" + ctx.current.x + ", y=" + ctx.current.y + ")",
      ctx.resizable ? "- resize: rect 폭·높이(현재 width=" + ctx.current.width + ", height=" + ctx.current.height + ")" : "- (이 박스는 rect가 아니라 resize 불가)",
      "- addTextLine{afterIndex?,text?}: 줄 추가(생략 시 맨 끝). 스타일은 이웃 줄에서 자동 상속되고 전 줄의 세로 위치가 도형 안에서 자동 재배분된다 — y를 직접 주지 않는다.",
      "- removeTextLine{line}: 그 줄 삭제(남은 줄 자동 재배분). 0줄까지 허용.",
      "- 범위를 넘는 요청이면 ops=[{op:\"reject\", reason:\"...한국어...\"}].",
      "- CSS background로 SVG 도형 색을 바꿀 수 없다 — 반드시 setFill/setStroke를 쓴다.",
    ].join("\n");
    const user = [
      "[선택 SVG 박스] eid=" + ctx.eid + " · 도형=" + ctx.shape,
      "[현재] fill=" + ctx.current.fill + " · stroke=" + ctx.current.stroke + " · text=\"" + ctx.current.text + "\" · translate(" + ctx.current.x + "," + ctx.current.y + ")" + (ctx.current.width != null ? " · " + ctx.current.width + "×" + ctx.current.height : ""),
      "[outerHTML]", ctx.outerHTML, "",
      "[사용자 지시]", instruction,
    ].join("\n");
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  // D16(b): 자유 <text> 단위 LLM 메시지 — setText/setFill/move만(stroke·resize 없음).
  function buildSvgTextMessages(ctx, instruction) {
    const system = [
      "당신은 다이어그램 슬라이드의 인라인 SVG 자유 텍스트(엣지 라벨·주석) 단위 편집기다.",
      "대상은 <svg viewBox=\"" + ctx.viewBox + "\"> 안의 독립 <text>이며, 정확히 하나만 편집한다: data-arch-eid=\"" + ctx.eid + "\".",
      "반드시 edit_svg_box 도구로 ops 배열만 반환한다. op 어휘(각 op의 eid는 \"" + ctx.eid + "\" 고정):",
      "- setText: 텍스트 내용 교체",
      "- setFill: 글자색 fill(유효한 CSS/SVG 색 토큰). ※ 텍스트에 stroke/resize는 없다.",
      "- move: 위치 이동 — x,y는 SVG user 좌표(현재 x=" + ctx.current.x + ", y=" + ctx.current.y + ")",
      "- 범위를 넘는 요청이면 ops=[{op:\"reject\", reason:\"...한국어...\"}].",
    ].join("\n");
    const user = [
      "[선택 SVG 텍스트] eid=" + ctx.eid,
      "[현재] fill=" + ctx.current.fill + " · text=\"" + ctx.current.text + "\" · pos(" + ctx.current.x + "," + ctx.current.y + ")",
      "[outerHTML]", ctx.outerHTML, "",
      "[사용자 지시]", instruction,
    ].join("\n");
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  // D18: 화살표 단위 LLM 메시지 — 방향/정점/화살촉 크기만(색·텍스트 없음).
  function buildSvgEdgeMessages(ctx, instruction) {
    const c = ctx.current;
    const ptsText = c.points ? c.points.map((p, i) => i + ":(" + p.x + "," + p.y + ")").join(" → ") : "(M/L 직선 경로가 아니라 기하 편집 불가)";
    const system = [
      "당신은 다이어그램 슬라이드의 인라인 SVG 화살표(엣지) 단위 편집기다.",
      "대상은 <svg viewBox=\"" + ctx.viewBox + "\"> 안의 " + c.tag + " 화살표이며, 정확히 하나만 편집한다: data-arch-eid=\"" + ctx.eid + "\".",
      "반드시 edit_svg_edge 도구로 ops 배열만 반환한다. op 어휘(각 op의 eid는 \"" + ctx.eid + "\" 고정, 스키마상 다른 값 불가):",
      "- flipEdge: 화살표 방향 반전(정점 순서를 뒤집는다 — 화살촉은 항상 끝점에 있으므로 반대편으로 간다)",
      "- moveVertex{index,x,y}: 그 꼭짓점만 SVG user 좌표로 이동",
      "- addVertex{afterIndex,x,y}: afterIndex 뒤에 꼭짓점 삽입(경로 우회 추가)",
      "- deleteVertex{index}: 꼭짓점 제거(최소 2개는 남아야 한다)",
      "- setHeadSize{scale}: 화살촉 크기 배율 " + SvgAdapter.HEAD_MIN + "~" + SvgAdapter.HEAD_MAX + " (현재 " + c.headScale + "배). 이 화살표 전용 marker가 복제되어 다른 화살표는 영향받지 않는다.",
      "- 이 화살표는 색·텍스트 편집 대상이 아니다(라벨은 별도 자유 텍스트 단위).",
      "- 범위를 넘는 요청이면 ops=[{op:\"reject\", reason:\"...한국어...\"}].",
    ].join("\n");
    const user = [
      "[선택 화살표] eid=" + ctx.eid + " · 태그=" + c.tag + " · 꼭짓점 " + c.vertexCount + "개",
      "[정점열(user 좌표)] " + ptsText,
      "[선] stroke=" + c.stroke + " · stroke-width=" + c.strokeWidth + " · marker-end=#" + (c.markerEnd || "(없음)") + " · 화살촉 배율=" + c.headScale,
      "[outerHTML]", ctx.outerHTML, "",
      "[사용자 지시]", instruction,
    ].join("\n");
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  async function requestSvgOps(ctx, instruction) {
    if ($("mock-toggle").checked) return ArchMock.generateSvg(instruction, ctx.eid, ctx.shape);
    if (!ArchConfig.has("nvidia-key")) throw new Error("NVIDIA 키가 없습니다 — 연결 설정에서 키를 입력하거나 mock을 켜세요.");
    const isEdge = ctx.kind === "svgedge";
    const tool = {
      name: isEdge ? "edit_svg_edge" : "edit_svg_box",
      description: isEdge
        ? "선택된 단일 SVG 화살표에 대한 제한된 편집 op 목록(flipEdge/moveVertex/addVertex/deleteVertex/setHeadSize/reject)을 반환한다."
        : "선택된 단일 SVG 박스에 대한 제한된 편집 op 목록(setText/setFill/setStroke/move/resize/reject)을 반환한다.",
      input_schema: SvgAdapter.buildToolSchema(ctx.eid, ctx.shape),
    };
    return await ArchLLM.chatTool({
      model: ArchConfig.get("model") || ArchConfig.DEFAULT_MODEL,
      messages: buildSvgMessages(ctx, instruction), tool, maxTokens: 2000, temperature: 0,
    });
  }

  async function runSvgEdit(instruction) {
    if (!sourceDoc) return;
    if (!instruction) { setPopError("지시를 입력하세요."); return; }
    busy = true; setPopBusy(true); setPopError("");
    const eid = selected.eid;
    try {
      const ctx = SvgAdapter.contextFor(sourceDoc, eid, selected.rect);
      const raw = await requestSvgOps(ctx, instruction);
      const res = commitSvgOps((raw && raw.ops) || [], eid, { flashEid: eid });
      if (res.reject) { setPopError("AI가 거절함: " + res.reject.reason); return; }
      if (!res.ok) { setPopError(res.error + (res.notes && res.notes.length ? " (" + res.notes.join("; ") + ")" : "")); return; }
      closePopover(); clearSelection();
      showToast("적용됨 · " + eid + (res.notes && res.notes.length ? " (일부 sanitize됨)" : ""), { actionLabel: "실행 취소", onAction: undo });
    } catch (err) {
      const prefix = err && err.name === "ScopeViolation" ? "범위 위반: " : "실패: ";
      setPopError(prefix + (err && err.message ? err.message : String(err)));
    } finally { busy = false; setPopBusy(false); }
  }

  // ---- 편집 모드: SVG 박스 스타일 패널 (fill/stroke/text/size, AI 없음) ----
  // ★ 팝업 폐지: openSvgPanel/closeSvgPanel + 팝업 줄 편집 UI(buildSvgTextLines/updateLineAddRow)를 삭제.
  //   박스 채움/테두리는 툴바 색 컨트롤, 줄 추가/삭제·크기는 툴바 row2, 줄 텍스트는 요소 편집 OFF 인라인이 담당.

  // D25b: OFF 인라인 편집 커밋(뷰에서 온 setText). svgbox는 클릭한 줄 인덱스로 스코프, svgtext는 전체.
  //   class-b obj(HTML div)는 contenteditable→arch-text(applyText) 경로가 처리하므로 여기 안 온다.
  //   기존 op(setText+line)·commitSvgOps를 그대로 재사용 → scope-gate/bleed-diff/undo 전부 불변.
  // D26: 인라인 세션의 pending 서식을 op으로. svgbox는 그 줄만(line 스코프), svgtext는 전체, obj는 setStyle.
  function inlinePendingOps() {
    if (!inlineSession) return [];
    const s = inlineSession, ops = [];
    if (s.kind === "obj") {
      if (Object.keys(s.pendingDom).length) {
        const op = { op: "setStyle", eid: s.eid, target: "text", style: { ...s.pendingDom } };
        if (s.line != null) op.line = s.line;   // D27c(a): 그 줄 div에만 서식 적용
        ops.push(op);
      }
      if (s.pendingHref) {   // D37: 그 줄을 <a href>로 감싸는 op(굵게 setStyle target:text와 같은 줄 스코프)
        const op = { op: "setLink", eid: s.eid, target: "text", href: s.pendingHref };
        if (s.line != null) op.line = s.line;
        ops.push(op);
      }
      return ops;
    }
    if (Object.keys(s.pendingSvg).length) {
      const op = { op: "setTextStyle", eid: s.eid, style: { ...s.pendingSvg } };
      if (s.kind === "svgbox" && s.line != null) op.line = s.line;
      ops.push(op);
    }
    if (s.pendingGap != null) ops.push({ op: "setLineSpacing", eid: s.eid, spacing: s.pendingGap });
    return ops;
  }
  // D26: 인라인 커밋 = setText(변경 시) + pending 서식을 **한 배치**로 → 단일 undo, bleed는 그 줄만.
  //   agent가 changed(텍스트 변경 여부)를 실어 보낸다. 아무 변화 없으면 무커밋(세션만 종료).
  function applyInlineCommit(eid, kind, line, text, changed) {
    if (busy) return;
    if (changed === undefined) changed = (typeof text === "string");   // 직접 훅 호출(테스트) 하위호환: 텍스트 주면 커밋
    const pend = inlinePendingOps();
    inlineSession = null;                 // pending은 위에서 읽었으니 세션 종료
    const ops = [];
    if (changed && typeof text === "string") {
      const op = { op: "setText", eid, text };
      if (kind === "svgbox" && line != null && line >= 0) op.line = line;
      ops.push(op);
    }
    ops.push(...pend);
    if (!ops.length) { updateFmtBar(); return; }
    const res = commitSvgOps(ops, eid, {});
    if (res.reject) { showToast("거절: " + res.reject.reason); updateFmtBar(); return; }
    if (!res.ok) { showToast(res.error || "적용 불가"); updateFmtBar(); return; }
    const where = (kind === "svgbox" && line != null) ? "(" + (line + 1) + "줄) " : "";
    const what = changed ? "텍스트" : "서식";
    showToast(what + " " + where + "· " + eid, { actionLabel: "실행 취소", onAction: undo });
    updateFmtBar();
  }

  // (팝업 폐지: applySvgLine 삭제 — 줄 텍스트 편집은 요소 편집 OFF 인라인이 담당)

  // 줄 추가 — 스타일은 어댑터가 이웃 줄에서 상속하고 y는 전 줄을 도형 안에서 재배분한다.
  // 기본 문구를 넣는 이유: 빈 <text>는 렌더에 아무것도 안 나와 "버튼이 안 먹었다"로 보인다.
  // 곧바로 그 줄 입력에 포커스가 가므로 원치 않으면 지우면 된다.
  const NEW_LINE_TEXT = "새 줄";
  function applyAddLine() {
    if (busy || !selected) return;
    const eid = selected.eid;
    // D27c(c): obj(class-b)는 DomAdapter.applyOps의 addObjLine으로(넘치면 throw→커밋 취소). bleed는 replace
    //   모드로 충분 — 새 줄 div엔 eid가 없어 개수 불변, 컨테이너(eid)는 허용집합이라 그 안 변경은 정당.
    if (!selected.svgbox && unitKind(selected) === "obj") {
      const info = DomAdapter.objLineInfo(sourceDoc, eid);
      if (!info.clean) { showToast(info.why || OBJ_NOLINES_WHY, { ms: 5000 }); return; }
      const res = commitOps([{ op: "addObjLine", eid, text: NEW_LINE_TEXT }], eid, { reselectEid: eid });
      if (!res.ok) { showToast(res.error || "줄 추가 불가", { ms: 6000 }); return; }
      showToast((info.lines + 1) + "줄 추가됨 · " + eid, { actionLabel: "실행 취소", onAction: undo });
      return;
    }
    if (!selected.svgbox) return;
    const before = SvgAdapter.styleSnapshot(sourceDoc, eid);
    const idx = (before.lines || []).length;      // 맨 끝에 추가 → 새 줄의 인덱스
    const res = commitSvgOps([{ op: "addTextLine", eid, text: NEW_LINE_TEXT }], eid, { reselectEid: eid });
    if (res.reject) { showToast("거절: " + res.reject.reason); return; }
    if (!res.ok) { showToast(res.error || "줄 추가 불가", { ms: 6000 }); return; }
    pendingLineFocus = idx;
    showToast((idx + 1) + "줄 추가됨 · " + eid, { actionLabel: "실행 취소", onAction: undo });
  }

  function applyRemoveLine(line) {
    if (busy || !selected) return;
    const eid = selected.eid;
    if (!selected.svgbox && unitKind(selected) === "obj") {
      const info = DomAdapter.objLineInfo(sourceDoc, eid);
      if (!info.clean) { showToast(info.why || OBJ_NOLINES_WHY, { ms: 5000 }); return; }
      const res = commitOps([{ op: "removeObjLine", eid, line }], eid, { reselectEid: eid });
      if (!res.ok) { showToast(res.error || "줄 삭제 불가"); return; }
      showToast((line + 1) + "줄 삭제됨 · " + eid, { actionLabel: "실행 취소", onAction: undo });
      return;
    }
    if (!selected.svgbox) return;
    const res = commitSvgOps([{ op: "removeTextLine", eid, line }], eid, { reselectEid: eid });
    if (res.reject) { showToast("거절: " + res.reject.reason); return; }
    if (!res.ok) { showToast(res.error || "줄 삭제 불가"); return; }
    showToast((line + 1) + "줄 삭제됨 · " + eid, { actionLabel: "실행 취소", onAction: undo });
  }

  // (팝업 폐지: openSvgTextPanel/closeSvgTextPanel · openSvgEdgePanel/closeSvgEdgePanel · applySvgEdgeOp 삭제.
  //  자유 텍스트 글자색은 툴바, 텍스트는 OFF 인라인 · 화살표 방향/화살촉은 툴바 row3 · 정점 편집은 뷰 드래그.)

  // 뷰(agent)에서 온 화살표 기하 편집 — eid는 메시지가 실어온 값을 그대로 pin(선택과 동일해야 함).
  function applyEdgeGeom(eid, op, label) {
    const res = commitSvgOps([{ ...op, eid }], eid, { reselectEid: eid });
    if (res.reject) { showToast("거절: " + res.reject.reason); return; }
    if (!res.ok) { showToast(res.error || "적용 불가"); return; }
    showToast(label + " · " + eid, { actionLabel: "실행 취소", onAction: undo });
  }

  // 자유 텍스트 드래그 이동 커밋(agent가 실측 x/y user 좌표를 보냄).
  function applySvgTextMove(eid, x, y) {
    const res = commitSvgOps([{ op: "move", eid, x, y }], eid, { reselectEid: eid });
    if (!res.ok) { showToast(res.error || "이동 실패"); return; }
    showToast("위치 변경 · " + eid, { actionLabel: "실행 취소", onAction: undo });
  }

  // (팝업 폐지: applySvgOp 삭제 — 채움/테두리/글자색은 툴바 색 컨트롤(fmtFill/fmtStroke/fmtTextColor)이 담당)
  function applySvgMove(eid, x, y) {
    const res = commitSvgOps([{ op: "move", eid, x, y }], eid, { reselectEid: eid });
    if (!res.ok) { showToast(res.error || "이동 실패"); return; }
    showToast("위치 변경 · " + eid, { actionLabel: "실행 취소", onAction: undo });
  }
  function applySvgResize(eid, geom) {
    const ops = [{ op: "resize", eid, width: geom.width, height: geom.height }];
    if (geom.x != null && geom.y != null) ops.push({ op: "move", eid, x: geom.x, y: geom.y });
    const res = commitSvgOps(ops, eid, { reselectEid: eid });
    if (!res.ok) { showToast(res.error || "크기 변경 실패"); return; }
    showToast("크기 변경 · " + eid, { actionLabel: "실행 취소", onAction: undo });
  }

  // ═══════════════ D21/D22: 서식 툴바 (컨텍스트 · 집합 적용) ═══════════════
  //
  // 설계 요지 세 가지:
  //  1) 툴바는 **얇은 프런트엔드**다. 실제 변경은 전부 기존 어댑터 op(setTextStyle/setFill/…)으로
  //     나가고 commitOps의 scope-gate → bleed-diff → undo를 그대로 통과한다.
  //  2) 적용 대상은 항상 **선택 집합 S**다. |S|=1이면 예전과 완전히 같은 경로(집합 크기만 1).
  //  3) 혼합 선택에서는 **모든 선택 종류에서 유효한 항목만** 활성. 불가 항목은 사유와 함께 비활성
  //     (버튼은 있는데 아무 일도 안 일어나는 상태를 만들지 않는다).

  // 단위 종류별 능력표 — "혼합 선택에서 무엇이 켜지는가"의 단일 출처(교집합).
  const FMT_CAPS = {
    svgbox: { preset: 1, family: 1, size: 1, weight: 1, italic: 1, decor: 1, align: 1, gap: 1, track: 1, textcolor: 1, fill: 1, stroke: 1, head: 0, flip: 0, link: 0 },
    svgtext: { preset: 1, family: 1, size: 1, weight: 1, italic: 1, decor: 1, align: 0, gap: 0, track: 1, textcolor: 1, fill: 0, stroke: 0, head: 0, flip: 0, link: 0 },
    svgedge: { preset: 0, family: 0, size: 0, weight: 0, italic: 0, decor: 0, align: 0, gap: 0, track: 0, textcolor: 0, fill: 0, stroke: 0, head: 1, flip: 1, link: 0 },
    // D27c(b): obj를 svgbox 수준으로 올림(CSS 등가물 매핑). stroke만 0 유지(div는 SVG stroke가 없다 —
    //   테두리 border는 별개 개념이고 툴바 stroke는 setStroke(SVG) 전용). family→font-family·italic→font-style·
    //   decor→text-decoration·align→text-align·gap→line-height·track→letter-spacing(전부 직접 CSS 존재).
    obj: { preset: 1, family: 1, size: 1, weight: 1, italic: 1, decor: 1, align: 1, gap: 1, track: 1, textcolor: 1, fill: 1, stroke: 0, head: 0, flip: 0, link: 1 },
  };
  // 비활성 사유 — 종류마다 "왜 이 단위엔 그 개념이 없는지"를 한 줄로.
  const FMT_LIMIT = {
    svgbox: "SVG 박스에는 없는 항목입니다",
    svgtext: "자유 텍스트: 기준 도형이 없어 정렬·줄간격이 없고, 도형 채움·테두리도 없습니다",
    svgedge: "화살표: 방향·꼭짓점·화살촉 크기만 편집합니다(글자·도형 색 없음)",
    obj: "class-b 요소(div): 어댑터 스타일 화이트리스트(글자색·배경·글자크기·굵기)만 허용됩니다",
  };
  const FMT_ARCH_WHY = "archify(class-a)는 JSON 소스에서 서버 재렌더되므로 DOM 서식이 다음 렌더에서 사라집니다 — 편집 모드의 속성 폼을 쓰세요.";
  // D23: 항목별 사유 — "이 항목은 무엇에만 쓰는가". 종류별 사유(FMT_LIMIT)보다 먼저 쓰인다.
  const FMT_CTRL_WHY = {
    head: "화살촉 크기는 화살표에만 적용됩니다 — 화살표 선을 선택하세요.",
    flip: "방향 뒤집기는 화살표에만 적용됩니다 — 화살표 선을 클릭해 선택하세요.",
    gap: "줄간격은 여러 줄을 담은 박스에만 적용됩니다 — 박스를 선택하세요.",
    align: "정렬은 기준 도형이 있는 박스에만 적용됩니다 — 박스를 선택하세요.",
    stroke: "테두리는 도형이 있는 박스·화살표에만 적용됩니다.",
    link: "링크는 HTML 텍스트 요소(수제 슬라이드의 텍스트 상자·표 셀)에만 적용됩니다 — SVG 텍스트에는 지원되지 않습니다.",
  };
  // D31-실행: 정렬 x 재계산은 사각형(rect) 박스에서만 기하학적으로 안전하다. 다이아몬드(polygon)·
  //   게이트(path) 등 비-rect 도형은 y위치별 실제 폭이 도형 전체 폭보다 좁아, 전체 폭 기준으로
  //   x를 재계산하면 글자가 도형 모서리를 뚫고 나간다(스크린샷으로 확정된 실버그 — svgbox:12 다이아).
  //   그래서 resize가 rect 전용인 것과 같은 방식(isResizable)으로 비-rect svgbox 정렬은 사유와 함께
  //   비활성한다. obj(class-b)는 CSS text-align이라 기하 문제가 없어 그대로 허용.
  const FMT_ALIGN_NONRECT_WHY = "정렬은 사각형 박스에만 적용됩니다 — 다이아몬드·게이트 같은 도형은 글자가 모서리를 넘칠 수 있어 정렬을 지원하지 않습니다.";
  // 툴바가 쓰는 글꼴 후보 — 문서가 실제로 쓰는 값 + 어디서나 해석되는 제네릭 패밀리.
  const FMT_GENERIC_FONTS = ["sans-serif", "serif", "monospace"];
  // D26: 텍스트 서브그룹 — 이 항목들만 게이트가 selection이 아니라 **인라인 편집 세션**이다.
  //   나머지(fill/stroke/head/flip = 도형·구조)는 그대로 ON 선택 게이트(§도형 서브그룹은 미변경).
  const FMT_TEXT_CTRLS = new Set(["preset", "family", "size", "weight", "italic", "decor", "align", "gap", "track", "textcolor", "link"]);
  const FMT_TEXT_GATE_WHY = "텍스트 서식은 편집 중인 글자에 적용됩니다 — 요소 편집을 끄고(OFF) 텍스트를 클릭해 편집하세요.";

  function unitKind(u) {
    if (u.svgedge) return "svgedge";
    if (u.svgtext) return "svgtext";
    if (u.svgbox) return "svgbox";
    return "obj";
  }
  function isBoldWeight(w) {
    const n = parseInt(w, 10);
    if (Number.isFinite(n)) return n >= 600;
    return String(w || "").trim() === "bold";
  }
  function boldWeight() {
    try { return SvgAdapter.typeScale(sourceDoc).boldWeight; } catch (_) { return "700"; }
  }

  // D26: 인라인 편집 세션이 서식 대상으로 삼는 단위(정확히 편집 중인 그 unit+line 하나).
  //   세션이 없으면 빈 배열 → 텍스트 서식은 전부 비활성(= 도형만 선택한 상태에선 잠긴다).
  function fmtTextTargets() {
    if (!inlineSession) return [];
    const k = inlineSession.kind;
    return [{
      eid: inlineSession.eid, kind: k,
      svgbox: k === "svgbox", svgtext: k === "svgtext", svgedge: false,
      line: (inlineSession.line != null ? inlineSession.line : null),
      inline: true,
    }];
  }

  // 항목별 가용성. D26: 텍스트 서브그룹은 **인라인 편집 세션**을, 도형 서브그룹은 종전대로 selection을 본다.
  function fmtCap(ctrl) {
    if (provenance === "archify") return { ok: false, why: FMT_ARCH_WHY };
    // ── 텍스트 서브그룹: OFF 인라인 편집 세션에서만(도형 선택이 아니라 "지금 타이핑 중인 글자"에) ──
    if (FMT_TEXT_CTRLS.has(ctrl)) {
      if (!sourceDoc || !inlineSession) return { ok: false, why: FMT_TEXT_GATE_WHY };
      const k = inlineSession.kind;
      if (!(FMT_CAPS[k] && FMT_CAPS[k][ctrl])) return { ok: false, why: FMT_CTRL_WHY[ctrl] || FMT_LIMIT[k] };
      // D31-실행: 비-rect svgbox(다이아 polygon·게이트 path)는 정렬 x 재계산이 도형 밖으로 새어나가므로
      //   정렬만 비활성 + 사유(resize가 rect 전용인 것과 동형). obj는 CSS text-align이라 기하 문제 없음 → 통과.
      if (ctrl === "align" && k === "svgbox" && SvgAdapter.shapeOf(sourceDoc, inlineSession.eid) !== "rect") {
        return { ok: false, why: FMT_ALIGN_NONRECT_WHY };
      }
      if (ctrl === "gap" && k !== "obj") {
        // svgbox 줄간격은 "줄 사이" 개념이라 2줄 미만 박스에는 적용할 것이 없다.
        // (obj는 gap→line-height가 그 줄 div에 적용되므로 줄 수 제약 없음 — D27c(b).)
        const s = SvgAdapter.textStyleSnapshot(sourceDoc, inlineSession.eid);
        if (!s || s.lineCount < 2) return { ok: false, why: "줄이 2개 이상인 박스에만 적용됩니다." };
      }
      return { ok: true };
    }
    // ── 도형 서브그룹(fill/stroke/head/flip): 그대로 ON 선택 게이트 ── (D26: 이 로직은 미변경)
    if (!sourceDoc || !selection.length) return { ok: false, why: "선택된 요소가 없습니다." };
    const bad = [...new Set(selection.map(unitKind).filter((k) => !(FMT_CAPS[k] && FMT_CAPS[k][ctrl])))];
    // D23: 비활성 사유는 "항목이 어디에 속하는지"를 우선 말한다.
    if (bad.length) return { ok: false, why: FMT_CTRL_WHY[ctrl] || bad.map((k) => FMT_LIMIT[k]).join(" · ") };
    // D24: 방향 뒤집기는 M/L 직선 폴리라인에서만 성립한다(곡선 경로는 정점 열이 없어 뒤집을 대상 자체가 없다).
    if (ctrl === "flip") {
      const curved = selection.filter((u) => !SvgAdapter.edgeSnapshot(sourceDoc, u.eid).editable);
      if (curved.length) return { ok: false, why: "M/L 직선 경로가 아니라 방향을 뒤집을 수 없습니다(곡선 경로 " + curved.length + "개)" };
    }
    return { ok: true };
  }

  // 선택 집합의 현재 값 — 서로 다르면 mixed(표시는 "혼합", 조작하면 전부 그 값으로 통일).
  function agree(list) {
    const v = list.filter((x) => x != null && x !== "");
    if (!v.length) return { value: null, mixed: false, empty: true };
    return { value: v[0], mixed: v.some((x) => String(x) !== String(v[0])), empty: false };
  }
  function fmtValues() {
    const acc = { bold: [], italic: [], underline: [], strike: [], family: [], size: [], track: [], anchor: [], textcolor: [], fill: [], stroke: [], gap: [], head: [] };
    if (!sourceDoc) return acc;
    // D26: 인라인 세션 중이면 값의 출처는 selection이 아니라 **편집 중인 그 줄**(+ 아직 미커밋 pending).
    //   그래야 B/I 토글이 그 줄의 실제 상태를 반영하고, 서식을 눌러 pending이 쌓이면 즉시 켜짐으로 보인다.
    if (inlineSession) {
      const k = inlineSession.kind;
      if (k === "obj") {
        // D27c(b): 편집 중인 그 줄(inlineSession.line)의 CSS 서식 전체를 읽고 pending을 덮어쓴다.
        const s = DomAdapter.styleSnapshot(sourceDoc, inlineSession.eid, inlineSession.line);
        const pd = inlineSession.pendingDom || {};
        const g = (key, fb) => (pd[key] != null ? pd[key] : fb);
        const size = pd.fontSize != null ? parseFloat(pd.fontSize) : (parseFloat(s.fontSize) || null);
        const dec = g("textDecoration", s.textDecoration) || "";
        const al = g("textAlign", s.textAlign);
        acc.bold.push(isBoldWeight(g("fontWeight", s.fontWeight)));
        acc.italic.push(g("fontStyle", s.fontStyle) === "italic");
        acc.underline.push(/underline/.test(dec));
        acc.strike.push(/line-through/.test(dec));
        acc.family.push(g("fontFamily", s.fontFamily) || "");
        acc.size.push(Number.isFinite(size) ? size : null);
        acc.track.push(pd.letterSpacing != null ? parseFloat(pd.letterSpacing) : (parseFloat(s.letterSpacing) || null));
        acc.anchor.push(al === "center" ? "middle" : al === "right" ? "end" : al === "left" ? "start" : (al || ""));
        acc.gap.push(pd.lineHeight != null ? parseFloat(pd.lineHeight) : (parseFloat(s.lineHeight) || null));
        acc.textcolor.push(g("color", s.color));
        return acc;
      }
      const base = SvgAdapter.lineTextStyle(sourceDoc, inlineSession.eid, inlineSession.line);
      if (!base) return acc;
      const ps = inlineSession.pendingSvg || {};
      const val = (key, fallback) => (ps[key] != null ? ps[key] : fallback);
      const dec = ps.textDecoration != null ? ps.textDecoration : ((base.underline ? "underline " : "") + (base.strike ? "line-through" : ""));
      acc.bold.push(isBoldWeight(val("fontWeight", base.fontWeight)));
      acc.italic.push(val("fontStyle", base.fontStyle) === "italic");
      acc.underline.push(/underline/.test(dec));
      acc.strike.push(/line-through/.test(dec));
      acc.family.push(val("fontFamily", base.fontFamily));
      acc.size.push(val("fontSize", base.fontSize));
      acc.track.push(val("letterSpacing", base.letterSpacing));
      acc.anchor.push(val("textAnchor", base.textAnchor));
      acc.textcolor.push(val("fill", base.fill));
      if (k === "svgbox") {
        const t = SvgAdapter.textStyleSnapshot(sourceDoc, inlineSession.eid);
        acc.gap.push(inlineSession.pendingGap != null ? inlineSession.pendingGap : (t ? t.lineGap : null));
      }
      return acc;
    }
    for (const u of selection) {
      const k = unitKind(u);
      if (k === "svgedge") { const e = SvgAdapter.edgeSnapshot(sourceDoc, u.eid); acc.head.push(e.headScale); continue; }
      if (k === "obj") {
        const s = DomAdapter.styleSnapshot(sourceDoc, u.eid);
        acc.bold.push(isBoldWeight(s.fontWeight));
        acc.size.push(parseFloat(s.fontSize) || null);
        acc.textcolor.push(s.color); acc.fill.push(s.background);
        continue;
      }
      const t = SvgAdapter.textStyleSnapshot(sourceDoc, u.eid);
      if (!t) continue;
      acc.bold.push(isBoldWeight(t.fontWeight)); acc.italic.push(t.fontStyle === "italic");
      acc.underline.push(t.underline); acc.strike.push(t.strike);
      acc.family.push(t.fontFamily); acc.size.push(t.fontSize); acc.track.push(t.letterSpacing);
      acc.anchor.push(t.textAnchor); acc.textcolor.push(t.fill);
      if (k === "svgbox") {
        const s = SvgAdapter.styleSnapshot(sourceDoc, u.eid);
        acc.fill.push(s.fill); acc.stroke.push(s.stroke); acc.gap.push(t.lineGap);
      }
    }
    return acc;
  }

  // ---- 툴바 렌더 ----
  function fmtSetEnabled(el, cap) {
    if (!el) return;
    el.disabled = !cap.ok;
    if (cap.ok) el.removeAttribute("data-why"); else el.setAttribute("data-why", cap.why);
    if (!cap.ok && cap.why) el.title = cap.why;
  }
  // ★ 비활성 항목은 켜짐/혼합 표시를 반드시 지운다 — 실제로 렌더해 보니 "회색인데 보라색으로
  //   켜져 있는" 버튼이 생겨 '적용 중'으로 읽혔다(비활성 사유와 정면으로 모순).
  function fmtToggleBtn(id, ctrl, state) {
    const el = $(id);
    if (!el) return;
    const cap = fmtCap(ctrl);
    fmtSetEnabled(el, cap);
    el.classList.toggle("on", cap.ok && !state.mixed && state.value === true);
    el.classList.toggle("mixed", cap.ok && !!state.mixed);
  }
  function fmtNumInput(id, ctrl, state, dflt) {
    const el = $(id);
    if (!el) return;
    const cap = fmtCap(ctrl);
    fmtSetEnabled(el, cap);
    el.classList.toggle("mixed", cap.ok && !!state.mixed);
    // 비활성이면 값도 비운다(적용되지 않을 수치를 보여주면 그게 현재 값처럼 읽힌다).
    el.value = !cap.ok || state.mixed || state.empty || state.value == null ? "" : String(state.value);
    el.placeholder = !cap.ok ? "—" : state.mixed ? "혼합" : (dflt || "");
  }
  function fmtColorInput(id, ctrl, state, dflt) {
    const el = $(id);
    if (!el) return;
    fmtSetEnabled(el, fmtCap(ctrl));
    el.value = hexOnly(state.mixed ? "" : state.value, dflt);
  }

  function fmtSelectionLabel() {
    if (!selection.length) return "";
    if (selection.length === 1) return selection[0].eid;
    const counts = {};
    selection.forEach((u) => { const k = unitKind(u); counts[k] = (counts[k] || 0) + 1; });
    const names = { svgbox: "박스", svgtext: "텍스트", svgedge: "화살표", obj: "요소" };
    return selection.length + "개 선택 · " + Object.keys(counts).map((k) => names[k] + " " + counts[k]).join(" + ");
  }

  function fillFmtChoices() {
    // 프리셋·글꼴 목록은 **문서에서 유도**한다(§13 데이터 우선) — 이 슬라이드가 실제로 쓰는
    // 글자 크기·굵기·글꼴이 곧 선택지가 되어야 "제목"이 이 슬라이드의 제목과 같은 눈금이 된다.
    const ps = $("fmt-preset"), ff = $("fmt-font");
    if (!ps || !ff || !sourceDoc) return;
    let scale = { presets: [] };
    try { scale = SvgAdapter.typeScale(sourceDoc); } catch (_) { scale = { presets: [] }; }
    ps.innerHTML = "";
    const ph = document.createElement("option"); ph.value = ""; ph.textContent = "텍스트 스타일"; ps.appendChild(ph);
    scale.presets.forEach((p) => {
      const o = document.createElement("option");
      o.value = p.id; o.textContent = p.label + " · " + p.fontSize + "u";
      o.dataset.size = String(p.fontSize); o.dataset.weight = String(p.fontWeight);
      ps.appendChild(o);
    });
    const fonts = new Set();
    sourceDoc.querySelectorAll('[data-svgbox="1"] > text, [data-svgtext="1"]').forEach((t) => {
      const f = (t.getAttribute("font-family") || "").trim();
      if (f) fonts.add(f);
    });
    FMT_GENERIC_FONTS.forEach((f) => fonts.add(f));
    ff.innerHTML = "";
    const fph = document.createElement("option"); fph.value = ""; fph.textContent = "글꼴"; ff.appendChild(fph);
    [...fonts].forEach((f) => { const o = document.createElement("option"); o.value = f; o.textContent = f; ff.appendChild(o); });
  }

  // D24: 표시 규칙이 바뀌었다.
  //   before — "선택이 있을 때만"(mode select|edit)
  //   after  — **편집 모드면 선택이 없어도 뜬다**. 선택 모드에서는 예전 그대로 선택이 있을 때만.
  //   WHY: 사용자가 "편집을 누르면 도구가 나와야 한다"고 요구했다. 선택 종속이면 도구 목록을
  //        보려면 먼저 뭔가를 골라야 하는데, 무엇을 고를지 알려주는 게 도구 목록이라 순환이다.
  //   COST: 선택 없는 동안 전 항목이 회색이라 "고장난 바"로 오해될 수 있다 → 배지를
  //        "요소를 선택하세요"(경고색)로 바꿔 비활성이 **상태**임을 명시한다.
  function fmtBarVisible() {
    return mode === "edit" || (mode === "select" && selection.length > 0);
  }
  function updateFmtBar() {
    const bar = $("fmt-bar");
    if (!bar) return;
    // Issue 1(s13): 이 모드에서 서식 툴바가 **구조적으로** 뜰 수 있는가? (edit·select만 — fmtBarVisible과 동일 모드 조건)
    // 뜰 수 없는 4모드(draw/audit/layout/polish)에서는 body.fmt-inert로 CSS가 예약 공간을 display:none으로 접어
    // 스테이지를 위로 붙인다. edit·select에서는 예약 공간을 유지해 select↔edit 좌표 불변식(s9)을 지킨다.
    // ★fmtBarShown()/bar.hidden 계약은 건드리지 않는다 — 이건 순수 렌더링/공간 최적화다.
    const inert = !(mode === "edit" || mode === "select");
    const wasInert = document.body.classList.contains("fmt-inert");
    document.body.classList.toggle("fmt-inert", inert);
    const show = fmtBarVisible();
    const was = !bar.hidden;
    bar.hidden = !show;
    // 상단 부착(normal flow)이라 표시 여부 또는 예약공간(inert)이 바뀌면 스테이지 가용 높이가 달라진다 → 재레이아웃.
    // (행 구성이 고정이라 **선택이 바뀔 때는** 높이가 그대로다 — edit·select 내부 선택 변화는 리플로우 없음.)
    if (was !== show || wasInert !== inert) layout();
    // 편집 버튼의 aria-expanded = "이 버튼이 여는 상단 툴바가 지금 펼쳐져 있는가".
    const be = $("btn-edit"); if (be) be.setAttribute("aria-expanded", String(show));
    if (!show) { $("fmt-inspect-panel").hidden = true; $("fmt-inspect").setAttribute("aria-expanded", "false"); return; }
    $("fmt-rows").hidden = fmtCollapsed;
    $("fmt-collapsed").hidden = !fmtCollapsed;
    // D26: 인라인 편집 중이면 배지는 "무엇을 편집 중인지"를 보인다(도형 미선택이라도 비어 있지 않다).
    const empty = selection.length === 0 && !inlineSession;
    const label = inlineSession
      ? "편집 중: " + inlineSession.eid + (inlineSession.line != null ? " · " + (inlineSession.line + 1) + "줄" : "")
      : (empty ? "요소를 선택하세요" : fmtSelectionLabel());
    const badge = $("fmt-sel"), cbadge = $("fmt-collapsed-sel");
    badge.textContent = label; cbadge.textContent = label;
    badge.classList.toggle("multi", isMulti()); cbadge.classList.toggle("multi", isMulti());
    badge.classList.toggle("empty", empty); cbadge.classList.toggle("empty", empty);
    badge.title = empty ? "다이어그램에서 박스·자유 텍스트·화살표를 클릭하면 여기에 대상이 표시됩니다" : "적용 대상";
    updateEditToolsUI();
    updateArrowRow();
    updateBoxToolsUI();
    if (fmtCollapsed) return;

    fillFmtChoices();
    const v = fmtValues();
    fmtToggleBtn("fmt-bold", "weight", agree(v.bold));
    fmtToggleBtn("fmt-italic", "italic", agree(v.italic));
    fmtToggleBtn("fmt-underline", "decor", agree(v.underline));
    fmtToggleBtn("fmt-strike", "decor", agree(v.strike));
    const anchor = agree(v.anchor);
    const alignCap = fmtCap("align");
    ["start", "middle", "end"].forEach((a) => {
      const el = $("fmt-align-" + a);
      fmtSetEnabled(el, alignCap);
      el.classList.toggle("on", alignCap.ok && !anchor.mixed && anchor.value === a);
      el.classList.toggle("mixed", alignCap.ok && !!anchor.mixed);
    });
    fmtNumInput("fmt-size", "size", agree(v.size), "크기");
    fmtNumInput("fmt-linegap", "gap", agree(v.gap), "1.35");
    fmtNumInput("fmt-track", "track", agree(v.track), "0");
    fmtNumInput("fmt-head", "head", agree(v.head), "1.0");
    fmtColorInput("fmt-textcolor", "textcolor", agree(v.textcolor), "#1a1f2b");
    fmtColorInput("fmt-fill", "fill", agree(v.fill), "#eef2f8");
    fmtColorInput("fmt-stroke", "stroke", agree(v.stroke), "#2f3b4a");
    fmtSetEnabled($("fmt-size-inc"), fmtCap("size"));
    fmtSetEnabled($("fmt-size-dec"), fmtCap("size"));
    fmtSetEnabled($("fmt-flip"), fmtCap("flip"));
    fmtSetEnabled($("fmt-link"), fmtCap("link"));   // D37: 링크 — 인라인 세션(obj)일 때만 활성
    updateZorderUI();   // D34: 겹침 순서 버튼(앞으로/뒤로) 가용성·사유·대상 표시
    fmtSetEnabled($("fmt-preset"), fmtCap("preset"));
    const famCap = fmtCap("family");
    fmtSetEnabled($("fmt-font"), famCap);
    const fam = agree(v.family);
    $("fmt-font").value = famCap.ok && !fam.mixed && fam.value ? String(fam.value) : "";
    $("fmt-preset").value = "";
    if (!$("fmt-inspect-panel").hidden) renderInspect();
  }

  // ── D24: 화살표(CAD) 행 ──
  // 이 행은 **항상 있다**(높이 불변 계약). 화살표가 선택됐을 때만 켜지고, 아닐 땐 어디서
  // 켜지는지를 스스로 설명한다 — 발견성 회귀(사용자 신고)의 직접적 수정 지점이다.
  //   ★ 텍스트는 innerHTML이 아니라 DOM으로 조립한다: 여기 들어가는 값(꼭짓점 수 등)은
  //     불러온 파일에서 유래하므로 신뢰 입력이 아니다(renderInspect와 같은 규칙).
  const EDGE_AFFORDANCES = [
    ["드래그", "꼭짓점 이동"],
    ["중간점", "꼭짓점 추가"],
    ["Shift", "직교 스냅"],
    ["Alt(Option)+클릭", "꼭짓점 삭제"],   // D42: Mac Option 키 표기 보강(기능은 e.altKey로 이미 정상 — 순수 표기)
    ["더블클릭", "방향 뒤집기"],
  ];
  function updateArrowRow() {
    const hint = $("fmt-edge-hint");
    if (!hint) return;
    const edges = selection.filter((u) => unitKind(u) === "svgedge");
    hint.textContent = "";
    hint.classList.toggle("live", edges.length > 0);
    if (!edges.length) {
      hint.textContent = selection.length
        ? "화살표를 선택하면 방향·꼭짓점 도구가 여기서 켜집니다 (선 위를 클릭 — 박스·텍스트가 겹치면 그쪽이 먼저 잡힙니다)"
        : "화살표 선을 클릭하면 방향 뒤집기·꼭짓점 편집이 여기서 켜집니다";
      return;
    }
    // 선택된 화살표의 실제 꼭짓점 수 + 직접조작 어포던스 전체를 한 줄로.
    const snaps = edges.map((u) => SvgAdapter.edgeSnapshot(sourceDoc, u.eid));
    const verts = snaps.reduce((n, s) => n + (s.vertexCount || 0), 0);
    const curved = snaps.filter((s) => !s.editable).length;
    hint.appendChild(document.createTextNode(
      (edges.length > 1 ? "화살표 " + edges.length + "개 · " : "") + "꼭짓점 " + verts + "개"
      + (curved ? " · 곡선 " + curved + "개는 기하 편집 불가" : "") + " — "));
    EDGE_AFFORDANCES.forEach(([k, v], i) => {
      if (i) hint.appendChild(document.createTextNode(" · "));
      const kb = document.createElement("kbd"); kb.textContent = k;
      hint.appendChild(kb);
      hint.appendChild(document.createTextNode(" " + v));
    });
  }

  // ★ 박스 전용 툴바 컨트롤(줄 추가/삭제 · 수치 크기) — 플로팅 #svgbox-panel을 대체한다.
  //   단일 svgbox 선택일 때만 보이고, 값은 그 박스 스냅샷에서 채운다. 커밋은 팝업이 쓰던 것과 같은
  //   applyAddLine/applyRemoveLine/applySvgResize(→commitSvgOps) — scope/bleed/undo 전부 불변.
  function updateBoxToolsUI() {
    const linebox = $("fmt-linebox"), sizebox = $("fmt-sizebox");
    if (!linebox || !sizebox) return;
    const single = !isMulti() && selected;
    const isBox = !!(single && selected.svgbox);
    // D27c(c): 줄 추가/삭제는 svgbox뿐 아니라 obj(class-b)에도 — 깨끗한 줄 구조면 활성, 아니면 비활성+사유.
    //   ★ archify(class-a)는 sourceDoc이 없고 selected가 arch id라 obj로 오인하면 objLineInfo(null)가 터진다 → 제외.
    const isObj = !!(single && sourceDoc && provenance !== "archify" && !selected.svgbox && !selected.svgtext && !selected.svgedge && unitKind(selected) === "obj");
    const idx = $("fmt-line-idx");
    // 수치 크기(W/H)는 svgbox(rect) 전용 — obj는 CSS라 코너 드래그/속성으로 조절(여기 미노출).
    sizebox.hidden = !isBox;
    if (isBox) {
      const snap = SvgAdapter.styleSnapshot(sourceDoc, selected.eid);
      const n = (snap.lines || []).length;
      linebox.hidden = false;
      $("fmt-line-add").disabled = snap.canAddLine === false;
      $("fmt-line-add").title = snap.canAddLine === false ? "도형 높이가 부족합니다 — 먼저 크기를 키우세요" : "맨 아래에 줄 추가";
      idx.max = String(Math.max(1, n)); idx.placeholder = n ? String(n) : "";
      if (!idx.value || parseInt(idx.value, 10) > n) idx.value = n ? String(n) : "";
      $("fmt-line-del").disabled = n === 0; $("fmt-line-del").title = "지정 줄 삭제";
      const wh = $("fmt-w"), hh = $("fmt-h"), ap = $("fmt-size-apply");
      const resizable = !!snap.resizable;
      wh.disabled = !resizable; hh.disabled = !resizable; ap.disabled = !resizable;
      if (resizable) { wh.value = snap.width != null ? snap.width : ""; hh.value = snap.height != null ? snap.height : ""; }
      else { wh.value = ""; hh.value = ""; }
      sizebox.title = resizable ? "박스 크기(rect) — 코너 드래그로도 조절 가능" : (snap.shape || "이 도형") + "은 수치 크기 조정을 유보합니다(색·줄·이동 가능)";
    } else if (isObj) {
      linebox.hidden = false;
      const info = DomAdapter.objLineInfo(sourceDoc, selected.eid);
      if (!info.clean) {
        // 그레이스풀 폴백(D27c(d)): 줄 구조가 아니면 비활성 + 사유(D22/D23의 disabled-with-reason 관례).
        const why = info.why || OBJ_NOLINES_WHY;
        $("fmt-line-add").disabled = true; $("fmt-line-add").title = why;
        $("fmt-line-del").disabled = true; $("fmt-line-del").title = why;
        idx.value = ""; idx.placeholder = ""; idx.max = "1";
        linebox.title = why;
      } else {
        const n = info.lines;
        $("fmt-line-add").disabled = info.canAddLine === false;
        $("fmt-line-add").title = info.canAddLine === false ? "텍스트 상자 높이가 부족합니다 — 먼저 크기를 키우세요" : "맨 아래에 줄 추가";
        idx.max = String(Math.max(1, n)); idx.placeholder = n ? String(n) : "";
        if (!idx.value || parseInt(idx.value, 10) > n) idx.value = n ? String(n) : "";
        $("fmt-line-del").disabled = n === 0; $("fmt-line-del").title = "지정 줄 삭제";
        linebox.title = "텍스트 상자 줄(직속 자식 div) — 추가/삭제. 줄 텍스트는 '요소 편집'을 끄고 줄을 클릭해 편집.";
      }
    } else {
      linebox.hidden = true;
    }
  }
  const OBJ_NOLINES_WHY = "이 텍스트 상자는 줄(직속 자식) 구조가 아니어서 줄 추가/삭제를 할 수 없습니다.";

  // ── D24: 편집 도구 그룹(구 편집 ▾) ──
  // 드롭다운이 사라지면서 "지금 어느 하위 동작 상태인가"를 버튼 자신이 보여줘야 한다.
  function updateEditToolsUI() {
    const el = document.querySelector('#edit-menu [data-editsub="element"]');
    const inEdit = mode === "edit";
    // D25a: "요소 편집" = ON/OFF 토글. .on == elementEditOn(편집 모드에서). aria-checked 동기화.
    if (el) {
      el.classList.toggle("on", inEdit && elementEditOn);
      el.setAttribute("aria-checked", String(inEdit && elementEditOn));
    }
    // D25c: 3-way focus 그룹(전체/노드/화살표)은 요소 편집 ON일 때만 보인다(OFF엔 좁힐 게 없다).
    const seg = $("edit-focus");
    if (seg) {
      seg.hidden = !(inEdit && elementEditOn);
      [...seg.querySelectorAll("[data-focus]")].forEach((b) => b.classList.toggle("on", b.dataset.focus === editFocus));
    }
    updateHeadAllRow();
  }

  // ---------------- D25a/c: 요소 편집 토글 · 노드/화살표 focus ----------------
  // OFF로 가면 블록 편집 상태(선택·패널·크롬·일괄바)를 전부 정리한다 — 텍스트 편집은 단일 대상뿐이라
  // 선택 집합/패널이 남으면 상태가 어긋난다. postMode로 뷰에 즉시 반영.
  function setElementEditOn(on) {
    const next = !!on;
    if (next === elementEditOn) { updateEditToolsUI(); return; }
    elementEditOn = next;
    if (elementEditOn) inlineSession = null;   // D26: 블록 편집(ON)으로 올라오면 열린 인라인 세션 미러 해제
    if (!elementEditOn) {
      closeDetailPanels();
      $("gh-bar").hidden = true; pendingGlobalHead = null; $("wd-confirm").hidden = true;
      clearSelection(); selected = null;
      editFocus = "all";   // focus 도구는 ON 전용
    }
    updateEditToolsUI();
    updateFmtBar();
    postMode();
  }
  function setEditFocus(f) {
    if (f !== "all" && f !== "node" && f !== "arrow") return;
    if (!elementEditOn) elementEditOn = true;   // 도구를 고르는 건 블록 편집 의도 → ON으로 올린다
    editFocus = f;
    // 화살표 편집을 벗어나면 열려 있던 일괄 바/확인 게이트를 접는다(문맥 이탈).
    if (f !== "arrow" && !$("gh-bar").hidden) { $("gh-bar").hidden = true; pendingGlobalHead = null; $("wd-confirm").hidden = true; }
    updateEditToolsUI();
    updateFmtBar();
    postMode();
  }

  // D25d: 화살촉 일괄 조절('전체 적용')을 3행(화살표 도구 행)에 노출·게이트. 화살표 편집 focus에서만 뜬다.
  function updateHeadAllRow() {
    const btn = $("fmt-head-all");
    if (!btn) return;
    const show = mode === "edit" && elementEditOn && editFocus === "arrow";
    btn.hidden = !show;
    if (!show) return;
    const av = globalHeadAvailability();
    btn.disabled = !av.ok;
    btn.title = av.ok
      ? "화살촉 크기 일괄 조절 — 문서 전체의 모든 화살촉을 같은 크기로(개별 조정도 덮어씀). "
        + "적용 전 확인 창이 뜨고, 실행 취소 한 번으로 전부 되돌아갑니다."
      : av.why;
  }

  // D25d: 3행 '전체 적용' = 구 1행 globalhead 버튼의 순수 이전. 같은 D19 바(#gh-bar)를 연다 —
  //   확인 게이트(#wd-confirm)·단일 undo·문서 전체 setGlobalHeadSize(개별 클론 통일)가 전부 그대로다.
  //   추가로 선택된 화살표의 per-arrow 값(옆 슬라이더 #fmt-head)이 있으면 그걸 시드로 이어 준다.
  function runGlobalHeadFromRow() {
    const headv = parseFloat($("fmt-head").value);
    const arrowSel = selection.some((u) => unitKind(u) === "svgedge");
    if (!openGlobalHeadBar()) return;   // 실패(마커 없음 등)면 토스트만 뜨고 종료
    if (arrowSel && Number.isFinite(headv) && headv > 0) {
      $("gh-size").value = String(headv);
      $("gh-sizeval").textContent = headv.toFixed(1) + "×";
    }
  }

  // ⓘ 선택 정보 — 무엇이 선택됐고 어떤 항목이 왜 비활성인지. 혼합 선택에서 특히 필요하다.
  const FMT_CTRL_LABEL = {
    preset: "텍스트 프리셋", family: "글꼴", size: "글자 크기", weight: "굵게(B)", italic: "기울임(I)",
    decor: "밑줄·취소선(U/S)", align: "정렬", gap: "줄간격", track: "자간",
    textcolor: "글자색", fill: "도형 채움", stroke: "테두리", head: "화살촉 크기",
    flip: "방향 뒤집기", link: "링크(🔗)",
  };
  // ★ innerHTML로 조립하지 않는다: eid·shape는 **불러온 파일에서 온 속성값**이라 신뢰 입력이 아니다
  //   (stampBoxes는 기존 data-arch-eid를 보존하므로 악의적 슬라이드가 값을 심어둘 수 있다).
  //   전부 textContent로만 넣으면 이 경로에 인젝션 여지가 원천적으로 없다.
  function renderInspect() {
    const p = $("fmt-inspect-panel");
    const kinds = { svgbox: "SVG 박스", svgtext: "자유 텍스트", svgedge: "화살표", obj: "class-b 요소" };
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    p.textContent = "";
    p.appendChild(mk("div", "fi-sec", "선택 " + selection.length + "개"));
    const ul = document.createElement("ul");
    selection.forEach((u) => {
      const li = document.createElement("li");
      li.appendChild(mk("code", null, u.eid));
      li.appendChild(document.createTextNode(" · " + (kinds[unitKind(u)] || "요소") + (u.shape ? " (" + u.shape + ")" : "")));
      ul.appendChild(li);
    });
    p.appendChild(ul);
    p.appendChild(mk("div", "fi-sec", "비활성 항목 · 사유"));
    const off = Object.keys(FMT_CTRL_LABEL).map((c) => ({ c, cap: fmtCap(c) })).filter((x) => !x.cap.ok);
    if (!off.length) p.appendChild(mk("div", "why", "모든 항목 적용 가능"));
    else {
      const ul2 = document.createElement("ul");
      off.forEach((x) => {
        const li = document.createElement("li");
        li.appendChild(document.createTextNode(FMT_CTRL_LABEL[x.c] + " — "));
        li.appendChild(mk("span", "why", x.cap.why));
        ul2.appendChild(li);
      });
      p.appendChild(ul2);
    }
    p.appendChild(mk("div", "fi-sec", "알려진 한계"));
    p.appendChild(mk("div", "why",
      "서식은 줄(<text>) 단위로 적용됩니다 — SVG에는 문자 단위 rich text가 없어 한 줄 안에서 일부 글자만 굵게 하는 것은 지원하지 않습니다."));
  }
  function toggleInspect() {
    const p = $("fmt-inspect-panel");
    const open = p.hidden;
    p.hidden = !open;
    $("fmt-inspect").setAttribute("aria-expanded", String(open));
    if (open) renderInspect();
  }

  // ---- 배치 커밋: scope-gate(집합) → 종류별 sanitize → applyOps → bleed-diff(집합) → 단일 undo ----
  function applyMixedOps(doc, ops) {
    const touched = [];
    const svg = ops.filter((o) => SvgAdapter.isSvgEid(o.eid));
    const dom = ops.filter((o) => !SvgAdapter.isSvgEid(o.eid));
    if (svg.length) touched.push(...SvgAdapter.applyOps(doc, svg));
    if (dom.length) touched.push(...DomAdapter.applyOps(doc, dom));
    return touched;
  }
  function scopeViolation(msg) { const e = new Error(msg); e.name = "ScopeViolation"; return e; }

  // ★ D22 2차 보증의 배치판. 어댑터가 둘(SVG/DOM)로 나뉘어 있어도 **집합 게이트는 한 곳**이다.
  //   집합 밖 eid는 여기서 무조건 ScopeViolation — 단일 선택(크기 1)도 정확히 같은 코드를 지난다.
  function sanitizeBatch(rawOps, set) {
    for (const op of rawOps) {
      if (!op || typeof op !== "object") continue;
      if (op.op === "reject") continue;
      if (!set.has(op.eid)) {
        throw scopeViolation("op가 선택 집합(" + set.size + "개) 밖(" + op.eid + ")을 대상으로 함 — 적용 거부");
      }
    }
    const notes = [], ops = [];
    const svgRaw = rawOps.filter((o) => SvgAdapter.isSvgEid(o.eid));
    const domRaw = rawOps.filter((o) => !SvgAdapter.isSvgEid(o.eid));
    if (svgRaw.length) {
      const r = SvgAdapter.sanitizeOps({ ops: svgRaw }, set, (e) => SvgAdapter.shapeOf(sourceDoc, e));
      ops.push(...r.ops); notes.push(...r.notes);
    }
    // class-b는 DomAdapter(읽기 전용)가 단일 eid 계약이라 op마다 부른다 — 집합 게이트는 위에서 이미 통과.
    for (const o of domRaw) {
      const r = DomAdapter.sanitizeOps({ ops: [o] }, o.eid);
      ops.push(...r.ops); notes.push(...r.notes);
    }
    return { ops, notes };
  }

  function commitFormat(rawOps, label) {
    if (busy || !sourceDoc || !selection.length) return { ok: false, error: "선택 없음" };
    const set = selectionSet();
    let prepared;
    try { prepared = sanitizeBatch(rawOps, set); }
    catch (err) {
      showToast((err.name === "ScopeViolation" ? "범위 위반: " : "실패: ") + err.message, { ms: 6000 });
      return { ok: false, error: err.message, name: err.name };
    }
    if (!prepared.ops.length) {
      showToast("적용할 수 있는 변경이 없습니다." + (prepared.notes.length ? " (" + prepared.notes[0] + ")" : ""), { ms: 5000 });
      return { ok: false, error: "no ops", notes: prepared.notes };
    }
    // bleed-diff는 집합 축(SvgAdapter.bleedDiff → marker 예외만 좁게 허용 후 DomAdapter로 위임).
    const res = commitOps(prepared.ops, set, { apply: applyMixedOps, bleed: SvgAdapter.bleedDiff, keepSelection: true });
    if (!res.ok) { showToast("적용 실패: " + res.error, { ms: 7000 }); return res; }
    showToast(label + " · " + (selection.length > 1 ? selection.length + "개 요소" : selection[0].eid)
      + (prepared.notes.length ? " (일부 sanitize됨)" : ""), { actionLabel: "실행 취소", onAction: undo });
    updateFmtBar();
    return { ...res, notes: prepared.notes, count: prepared.ops.length };
  }

  // ---- D26: 텍스트 서식은 인라인 세션에 pending 누적 + 라이브 프리뷰(즉시 커밋 아님) ----
  //   WHY: 서식 클릭마다 commitFormat하면 재렌더가 오버레이 <input>과 아직 커밋 안 된 타이핑을
  //        날린다. 그래서 서식은 세션의 pending에 병합만 하고, 오버레이엔 같은 CSS를 즉시 입혀
  //        "타이핑하며 눈으로 서식이 바뀌는" 프리뷰만 준다. 실제 소스 반영·undo는 Enter 커밋 때
  //        setText와 **한 배치**로(applyInlineCommit / applyText) → 단일 undo·bleed 그 줄만.
  //   svg(svgbox/svgtext) = setTextStyle(svgbox는 줄 스코프), obj = setStyle(target:text), 줄간격 = setLineSpacing.
  //   fontScale: SVG user-unit→화면 px 배율은 viewBox 스케일에 얽혀 프리뷰가 취약하므로 크기만은
  //   비율(신규/기존)을 보내 agent가 자기 <input>의 기준 px에 곱한다(직접 px는 안 맞음).
  function pendInline(spec) {
    if (!inlineSession) return;
    if (spec.svg) Object.assign(inlineSession.pendingSvg, spec.svg);
    if (spec.dom) Object.assign(inlineSession.pendingDom, spec.dom);
    if (spec.gap != null) inlineSession.pendingGap = spec.gap;
    if (spec.preview) Object.assign(inlineSession.previewCss, spec.preview);
    postToView({ type: "arch-inline-preview", style: spec.preview || {}, fontScale: (spec.fontScale != null ? spec.fontScale : null) });
    updateFmtBar();
  }
  // 인라인 세션에서 그 줄의 현재 기준 크기(비율 계산용).
  function inlineBaseSize() {
    const b = SvgAdapter.lineTextStyle(sourceDoc, inlineSession.eid, inlineSession.line);
    return b && b.fontSize > 0 ? b.fontSize : 14;
  }
  function fmtApplyBold() {
    if (!inlineSession) return;
    const on = !(agree(fmtValues().bold).value === true);   // 세션은 단일 대상이라 mixed 없음
    const w = on ? boldWeight() : "400";
    pendInline({ svg: { fontWeight: w }, dom: { fontWeight: w }, preview: { fontWeight: w } });
  }
  function fmtApplyItalic() {
    if (!inlineSession) return;
    const on = !(agree(fmtValues().italic).value === true);
    const v = on ? "italic" : "normal";
    // D27c(b): obj는 CSS font-style로도 함께 pending(svg 대상엔 무해, obj 대상엔 이게 실 커밋).
    pendInline({ svg: { fontStyle: v }, dom: { fontStyle: v }, preview: { fontStyle: v } });
  }
  function fmtApplyDecor(which) {
    if (!inlineSession) return;
    const vals = fmtValues();
    const curU = agree(vals.underline).value === true, curS = agree(vals.strike).value === true;
    const nextU = which === "u" ? !curU : curU;
    const nextS = which === "s" ? !curS : curS;
    const dec = nextU && nextS ? "underline line-through" : nextU ? "underline" : nextS ? "line-through" : "none";
    pendInline({ svg: { textDecoration: dec }, dom: { textDecoration: dec }, preview: { textDecoration: dec === "none" ? "none" : dec } });
  }
  // D37: 링크 — 굵게/기울임과 같은 인라인-세션 게이트(값 입력이 필요해 즉시 토글 대신 URL을 받는다).
  //   화이트리스트 선검증(입력 즉시 피드백) → pendingHref 스테이징. 커밋 때 inlinePendingOps가 setLink op을
  //   내고 DomAdapter가 그 줄을 <a href>로 감싼다. sanitize는 커밋 경로(sanitizeOps)에서 한 번 더(이중 방어).
  function fmtApplyLink(url) {
    if (!inlineSession) return;
    const cap = fmtCap("link");
    if (!cap.ok) { showToast(cap.why, { ms: 5000 }); return; }
    const clean = DomAdapter.sanitizeHrefValue(url);
    if (!clean) { showToast("링크는 http/https/mailto 주소만 허용됩니다 (javascript:·data: 등 위험 스킴은 차단).", { ms: 5000 }); return; }
    inlineSession.pendingHref = clean;
    showToast("링크 적용 예약 · 편집을 마치면 그 줄이 링크(" + clean + ")가 됩니다", { ms: 4000 });
  }
  function fmtApplyAlign(anchor) {
    if (!inlineSession) return;
    // D31-실행: 비-rect svgbox 정렬은 비활성(위 fmtCap) — 버튼은 disabled지만 테스트/프로그램 경로도
    //   같은 사유로 막아 도형 밖 오버플로를 원천 차단(fmtApplyFlip과 동형 방어).
    const cap = fmtCap("align");
    if (!cap.ok) { showToast(cap.why, { ms: 5000 }); return; }
    const css = anchor === "middle" ? "center" : anchor === "end" ? "right" : "left";
    pendInline({ svg: { textAnchor: anchor }, dom: { textAlign: css }, preview: { textAlign: css } });
  }
  function fmtApplyFont(family) {
    if (!family || !inlineSession) return;
    pendInline({ svg: { fontFamily: family }, dom: { fontFamily: family }, preview: { fontFamily: family } });
  }
  function fmtApplySize(px) {
    if (!inlineSession) return;
    const n = parseFloat(px);
    if (!Number.isFinite(n) || n < SvgAdapter.FONT_MIN || n > SvgAdapter.FONT_MAX) { showToast("글자 크기는 " + SvgAdapter.FONT_MIN + "~" + SvgAdapter.FONT_MAX + " 사이여야 합니다."); return; }
    if (inlineSession.kind === "obj") { pendInline({ dom: { fontSize: n + "px" }, preview: { fontSize: n + "px" } }); return; }
    pendInline({ svg: { fontSize: n }, fontScale: n / inlineBaseSize() });   // 줄 스코프(setTextStyle는 line을 붙여 커밋됨)
  }
  function fmtNudgeSize(delta) {
    const v = agree(fmtValues().size);
    const base = Number.isFinite(parseFloat(v.value)) ? parseFloat(v.value) : 14;
    fmtApplySize(Math.round((base + delta) * 100) / 100);
  }
  function fmtApplyPreset(id) {
    if (!id || !inlineSession) return;
    const opt = [...$("fmt-preset").options].find((o) => o.value === id);
    if (!opt) return;
    const size = parseFloat(opt.dataset.size), weight = opt.dataset.weight;
    if (inlineSession.kind === "obj") { pendInline({ dom: { fontSize: size + "px", fontWeight: weight }, preview: { fontSize: size + "px", fontWeight: weight } }); return; }
    pendInline({ svg: { fontSize: size, fontWeight: weight }, preview: { fontWeight: weight }, fontScale: size / inlineBaseSize() });
  }
  function fmtApplyTrack(v) {
    if (!inlineSession) return;
    const n = parseFloat(v);
    if (!Number.isFinite(n)) { showToast("자간에 숫자를 입력하세요."); return; }
    // svg=user units(letterSpacing 숫자), obj=CSS letter-spacing(px). preview는 오버레이 <input>(px).
    pendInline({ svg: { letterSpacing: n }, dom: { letterSpacing: n + "px" }, preview: { letterSpacing: n + "px" } });
  }
  function fmtApplyGap(v) {
    if (!inlineSession) return;
    const n = parseFloat(v);
    if (!Number.isFinite(n)) { showToast("줄간격에 숫자를 입력하세요."); return; }
    // D27c(b): obj는 gap→line-height(그 줄 div의 CSS). svgbox는 setLineSpacing(줄 사이 재배분, pendingGap).
    if (inlineSession.kind === "obj") { pendInline({ dom: { lineHeight: String(n) }, preview: { lineHeight: String(n) } }); return; }
    pendInline({ gap: n });   // 박스 줄간격 — 줄 사이 개념이라 프리뷰(<input> 한 줄)에는 안 비침(커밋 때 반영)
  }
  function fmtApplyTextColor(color) {
    if (!inlineSession) return;
    pendInline({ svg: { fill: color }, dom: { color }, preview: { color } });
  }
  function fmtApplyFill(color) {
    const ops = [];
    for (const u of selection) {
      const k = unitKind(u);
      if (k === "svgbox") ops.push({ op: "setFill", eid: u.eid, color });
      else if (k === "obj") ops.push({ op: "setStyle", eid: u.eid, target: "box", style: { background: color } });
    }
    commitFormat(ops, "도형 채움");
  }
  function fmtApplyStroke(color) {
    commitFormat(selection.filter((u) => unitKind(u) === "svgbox").map((u) => ({ op: "setStroke", eid: u.eid, color })), "테두리");
  }
  function fmtApplyHead(v) {
    const n = parseFloat(v);
    if (!Number.isFinite(n)) { showToast("화살촉 배율에 숫자를 입력하세요."); return; }
    commitFormat(selection.filter((u) => unitKind(u) === "svgedge").map((u) => ({ op: "setHeadSize", eid: u.eid, scale: n })), "화살촉 크기 " + n);
  }
  // ★ D24 회귀 수정: 방향 뒤집기를 툴바로 끌어올린다.
  //   기존 op(flipEdge)을 그대로 쓰고 **집합 경로**(commitFormat)로 보낸다 → 화살표를 여러 개
  //   골라 한 번에 뒤집어도 scope-gate·bleed-diff·단일 undo가 그대로 성립한다.
  //   (패널의 se-flip은 단일 전용 applySvgEdgeOp을 계속 쓴다 — 둘 다 같은 op으로 수렴.)
  function fmtApplyFlip() {
    const cap = fmtCap("flip");
    if (!cap.ok) { showToast(cap.why, { ms: 5000 }); return; }
    commitFormat(selection.filter((u) => unitKind(u) === "svgedge").map((u) => ({ op: "flipEdge", eid: u.eid })), "방향 뒤집기");
  }

  // ---------------- D34: 겹침 순서(z-order) — 다중선택 primary 앞/뒤 ----------------
  //   대상은 항상 primary(= selected = 마지막 클릭). 나머지 선택 요소(들)를 기준으로 앞/뒤로 옮긴다.
  //   반대쪽 요소를 (Cmd+)클릭해 primary로 만들면(기존 재선택 메커니즘 그대로) 두 버튼만으로 완전한
  //   양방향 제어가 된다 — 새 상태 없음.
  //   ★ 종류별 메커니즘이 근본적으로 다르다(D34b, 조사로 확정):
  //     · obj(class-b): CSS z-index 재계산(front=max(others)+1 / back=min(others)-1) — 인라인 스타일 커밋.
  //     · svg 유닛(class-c): DOM 형제 순서 재배치(SVG는 z-index 없음, 뒤 형제가 위) — 같은 부모 안에서만.
  //   혼합(obj+svg)·부모 교차(svg)·2개 미만·archify는 비활성+사유(안전 우선 관례 재사용, D22/D23/D31).
  //   ★ 다중선택에서 촉발되지만 실제 변형은 **primary 하나**뿐이라 scope(allowed)는 primary 단일이다 —
  //     "한 요소의 z-index/DOM 위치 변경"은 본질적으로 단일 대상 변형이다. bleed-diff가 "primary만
  //     바뀌었다"를 증명한다(obj=replace 모드 / svg=reorder 모드).
  const ZORDER_WHY_FEW = "겹침 순서는 2개 이상 선택했을 때 조정합니다 — Cmd/Ctrl+클릭으로 겹친 요소를 더 선택하세요.";
  const ZORDER_WHY_MIXED = "겹침 순서: 같은 종류끼리만 조정합니다. 도형·텍스트·화살표(SVG)와 class-b 요소(div)는 렌더 레이어가 달라(SVG 유닛은 자기 z-index가 없이 바깥 <svg> div의 z-index를 빌려 씀) 함께 앞뒤로 보낼 수 없습니다 — 각각 따로 선택하세요.";
  const ZORDER_WHY_CROSS = "겹침 순서: 서로 다른 그룹(<g> lane/phase 등)의 요소는 그룹 경계를 넘지 않도록 재배치를 막습니다(다른 opacity/clip/transform 컨텍스트를 물려받아 렌더가 깨질 수 있음) — 같은 그룹 안의 요소끼리 선택하세요.";
  const ZORDER_WHY_ARCH = "겹침 순서는 수제 슬라이드(class-b/c)에서만 조정합니다 — archify(JSON) 다이어그램은 서버 재렌더라 DOM 순서 변경이 다음 렌더에서 사라집니다.";

  // 버튼 가용성 + 종류(obj|svgc) 판정. shape 서브그룹과 같은 selection 게이트(인라인 세션 아님).
  function zorderCap() {
    if (provenance === "archify") return { ok: false, why: ZORDER_WHY_ARCH };
    if (!sourceDoc || selection.length < 2) return { ok: false, why: ZORDER_WHY_FEW };
    const kinds = selection.map(unitKind);
    const anyObj = kinds.some((k) => k === "obj");
    const anySvg = kinds.some((k) => k !== "obj");
    if (anyObj && anySvg) return { ok: false, why: ZORDER_WHY_MIXED };
    if (anyObj) return { ok: true, kind: "obj" };
    // class-c: 전원이 같은 부모(형제)인지 확인 — 다른 <g> 그룹이면 비활성+사유(안전 제약, D34b).
    const parents = selection.map((u) => { const el = SvgAdapter.unitEl(sourceDoc, u.eid); return el ? el.parentNode : null; });
    if (parents.some((p) => !p)) return { ok: false, why: ZORDER_WHY_FEW };
    if (parents.some((p) => p !== parents[0])) return { ok: false, why: ZORDER_WHY_CROSS };
    return { ok: true, kind: "svgc" };
  }

  function updateZorderUI() {
    const f = $("fmt-front"), b = $("fmt-back");
    if (!f || !b) return;
    const cap = zorderCap();
    [f, b].forEach((el) => {
      el.disabled = !cap.ok;
      if (cap.ok) el.removeAttribute("data-why"); else el.setAttribute("data-why", cap.why);
    });
    const pid = selected ? selected.eid : "";
    f.title = cap.ok ? "앞으로 가져오기 — 주 대상(" + pid + ")을 다른 선택 요소들 앞에 그립니다" : cap.why;
    b.title = cap.ok ? "뒤로 보내기 — 주 대상(" + pid + ")을 다른 선택 요소들 뒤로 보냅니다" : cap.why;
  }

  function fmtApplyZorder(dir) {
    const cap = zorderCap();
    if (!cap.ok) { showToast(cap.why, { ms: 5000 }); return; }
    if (!selected) return;
    const primary = selected;                                  // 마지막 클릭 = primary
    const others = selection.filter((u) => u.eid !== primary.eid);
    if (!others.length) { showToast(ZORDER_WHY_FEW, { ms: 5000 }); return; }

    if (cap.kind === "obj") {
      // obj: z-index 재계산. 이미 극단이면(값을 낮추는 역효과 방지) no-op 안내.
      const zs = others.map((u) => DomAdapter.objZIndex(sourceDoc, u.eid));
      const pz = DomAdapter.objZIndex(sourceDoc, primary.eid);
      const maxO = Math.max(...zs), minO = Math.min(...zs);
      if (dir === "front" && pz > maxO) { showToast("이미 다른 선택 요소들보다 앞에 있습니다 · " + primary.eid); return; }
      if (dir === "back" && pz < minO) { showToast("이미 다른 선택 요소들보다 뒤에 있습니다 · " + primary.eid); return; }
      const target = dir === "front" ? maxO + 1 : minO - 1;
      const op = { op: "setStyle", eid: primary.eid, target: "box", style: { zIndex: String(target) } };
      // scope=primary 단일 → 표준 replace 모드 bleed-diff(primary의 outerHTML만 바뀜, 나머지 바이트 동일).
      const res = commitOps([op], primary.eid, { apply: DomAdapter.applyOps, bleed: DomAdapter.bleedDiff, keepSelection: true, flashEid: primary.eid });
      if (!res.ok) { showToast("겹침 순서 변경 실패: " + res.error, { ms: 7000 }); return; }
      showToast((dir === "front" ? "앞으로 가져옴" : "뒤로 보냄") + " · " + primary.eid + " (z-index " + target + ")", { actionLabel: "실행 취소", onAction: undo });
    } else {
      // class-c: 이미 극단이면 재배치·undo 낭비 없이 안내(compareDocumentPosition 선판정).
      const pel = SvgAdapter.unitEl(sourceDoc, primary.eid);
      const rels = others.map((u) => SvgAdapter.unitEl(sourceDoc, u.eid)).filter(Boolean);
      const FOLLOWING = 4, PRECEDING = 2;
      const alreadyFront = pel && rels.length && rels.every((r) => (r.compareDocumentPosition(pel) & FOLLOWING));
      const alreadyBack = pel && rels.length && rels.every((r) => (r.compareDocumentPosition(pel) & PRECEDING));
      if (dir === "front" && alreadyFront) { showToast("이미 다른 선택 요소들보다 앞에 있습니다 · " + primary.eid); return; }
      if (dir === "back" && alreadyBack) { showToast("이미 다른 선택 요소들보다 뒤에 있습니다 · " + primary.eid); return; }
      const op = { op: "reorder", eid: primary.eid, dir, refEids: others.map((u) => u.eid) };
      // scope=primary 단일 → reorder 모드 bleed-diff(primary만 위치 이동, 내용·나머지 불변, 같은 부모).
      const res = commitOps([op], primary.eid, {
        apply: (doc, ops) => SvgAdapter.applyReorder(doc, ops[0]),
        bleed: (bd, ad, al) => SvgAdapter.bleedDiff(bd, ad, al, { mode: "reorder" }),
        keepSelection: true, flashEid: primary.eid,
      });
      if (!res.ok) { showToast("겹침 순서 변경 실패: " + res.error, { ms: 7000 }); return; }
      showToast((dir === "front" ? "앞으로 가져옴" : "뒤로 보냄") + " · " + primary.eid, { actionLabel: "실행 취소", onAction: undo });
    }
    updateFmtBar();
  }

  function fmtCollapse(on) {
    fmtCollapsed = !!on;
    updateFmtBar();
  }

  // ---------------- 그리기 모드 ----------------

  function onDrawAt(x, y, kind) {
    if (busy) return;
    // D35: 이미지는 파일선택이 선행돼야 한다 — pendingImage가 없으면(취소/직접호출) 무동작.
    if (kind === "image" && !pendingImage) { showToast("이미지를 먼저 선택하세요."); return; }
    // 종류별 기본 배치 크기. 이미지는 실측 종횡비(pendingImage), 표는 3×3이 들어갈 320×140.
    let W, H, imgSrc = null;
    if (kind === "shape") { W = 200; H = 110; }
    else if (kind === "image") { W = pendingImage.width; H = pendingImage.height; imgSrc = pendingImage.src; }
    else if (kind === "table") { W = 320; H = 140; }
    else { W = 240; H = 60; }   // textbox
    const left = clamp(Math.round(x - W / 2), 0, SLIDE_W - W);
    const top = clamp(Math.round(y - H / 2), 0, SLIDE_H - H);
    const spec = { kind, left, top, width: W, height: H };
    if (kind === "image") spec.imgSrc = imgSrc;
    if (kind === "table") { spec.rows = pendingTable.rows; spec.cols = pendingTable.cols; }   // D40: 다이얼로그가 정한 행/열
    const res = commitAdd(spec);
    if (!res.ok) { showToast("추가 실패: " + res.error); return; }
    if (kind === "image") pendingImage = null;   // 소비 완료 — 다음 삽입은 새 파일선택 필요
    // 새 요소로 편집 모드 진입: 모드 먼저 바꾸고 재렌더 → arch-ready가 편집모드+재선택을 건다
    mode = "edit";
    updateModeUI();
    pendingReselect = res.eid;
    render();
    const label = { shape: "도형", image: "이미지", table: "표" }[kind] || "텍스트 상자";
    showToast(label + " 추가됨 → 편집 모드", { actionLabel: "실행 취소", onAction: undo });
  }

  // ---------------- 박스 수집 (검증·레이아웃 컨텍스트) ----------------

  function collectBoxes() {
    return new Promise((resolve, reject) => {
      if (!frameWin() || !viewReady) { reject(new Error("뷰가 준비되지 않았습니다.")); return; }
      const reqId = "b" + (++reqSeq);
      const timer = setTimeout(() => { boxReqs.delete(reqId); reject(new Error("박스 수집 시간 초과")); }, 6000);
      boxReqs.set(reqId, { resolve, timer });
      postToView({ type: "arch-collect-boxes", reqId });
    });
  }

  // ---------------- 콘텐츠 검증 (audit) ----------------

  const AUDIT_LABEL = { 1: "맞춤법·문법", 2: "용어 일관성", 3: "사실·정합성", 4: "구조·겹침", 5: "전체" };

  function buildAuditMessages(kind, inv) {
    const focus = {
      1: "맞춤법·띄어쓰기·문법 오류만",
      2: "용어/표기 불일치(같은 개념을 다르게 부르는 곳)만",
      3: "요소 텍스트 간 사실·정합성 모순만 (참조 문서 없음 — 내부 일관성 위주로, 확신 없으면 지적 자제)",
      5: "맞춤법·용어 일관성·사실 정합성 전반",
    }[kind] || "전반";
    const system = [
      "당신은 다이어그램 슬라이드의 텍스트 감수자다. 아래 요소 인벤토리를 읽고 " + focus + " 지적한다.",
      "반드시 report_findings 도구로 findings 배열을 반환한다. 각 finding = {eid(주어진 목록 중 하나), issue(한국어 지적), suggestion(고칠 방향, 한국어)}.",
      "지적할 게 없으면 findings를 빈 배열로 반환한다. 존재하지 않는 eid를 만들지 않는다.",
    ].join("\n");
    const lines = inv.map((e) => e.eid + " · " + e.kind + " · " + (e.text || "(빈 텍스트)"));
    return [{ role: "system", content: system }, { role: "user", content: "[요소 인벤토리]\n" + lines.join("\n") + "\n\n[지시] " + AUDIT_LABEL[kind] + " 관점으로 감수." }];
  }

  async function requestAudit(kind, inv) {
    if ($("mock-toggle").checked) return ArchMock.audit(kind, inv);
    if (!ArchConfig.has("nvidia-key")) throw new Error("NVIDIA 키가 없습니다 — 연결 설정에서 키를 입력하거나 mock을 켜세요.");
    const eids = inv.map((e) => e.eid);
    const tool = { name: "report_findings", description: "요소별 감수 지적 목록을 반환한다.", input_schema: DomAdapter.buildAuditSchema(eids) };
    return await ArchLLM.chatTool({
      model: ArchConfig.get("model") || ArchConfig.DEFAULT_MODEL,
      messages: buildAuditMessages(kind, inv), tool, maxTokens: 4000, temperature: 0,
    });
  }

  // ④ 기계적 검증: 겹침(bounding box) + 텍스트 오버플로. 배경/가이드(면적>10%)는 제외,
  // 포함관계(frac≥0.85 — 라벨이 상자 안)는 정상, 부분 겹침(0.15<frac<0.85)만 지적.
  function mechanicalAudit(boxes) {
    const SLIDE = SLIDE_W * SLIDE_H;
    const BG = 0.10, NEST = 0.85, MIN = 0.15, TOL = 4;
    const out = [];
    const area = (b) => b.w * b.h;
    const inter = (a, b) => {
      const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      return x * y;
    };
    // D18: 화살표(svgedge)는 겹침 판정에서 제외한다 — 엣지는 본래 박스를 잇고 가로지르므로
    // 포함하면 "정상 연결"이 전부 겹침 findings로 쏟아진다(검증 모드의 신호 대 잡음 붕괴).
    const content = boxes.filter((b) => !b.edge && area(b) > 0 && area(b) / SLIDE <= BG);
    for (let i = 0; i < content.length; i++) {
      for (let j = i + 1; j < content.length; j++) {
        const A = content[i], B = content[j];
        const it = inter(A, B); if (it <= 0) continue;
        const frac = it / Math.min(area(A), area(B));
        if (frac >= NEST || frac <= MIN) continue;
        const small = area(A) <= area(B) ? A : B, other = small === A ? B : A;
        out.push({
          eid: small.eid, kind: "overlap", other: other.eid,
          issue: "다른 요소(" + other.eid + ")와 약 " + Math.round(frac * 100) + "% 겹칩니다.",
          suggestion: "이 요소를 이동하거나 크기를 줄여 겹침을 해소하세요.",
        });
      }
    }
    for (const b of boxes) {
      if (!b.hasH) continue; // 높이 auto는 내용에 맞춰 성장 → 오버플로 없음
      if (b.sh > b.ch + TOL || b.sw > b.cw + TOL) {
        out.push({
          eid: b.eid, kind: "overflow",
          issue: "내용이 상자 밖으로 넘칩니다 (내용 " + Math.round(b.sw) + "×" + Math.round(b.sh) + " > 상자 " + Math.round(b.cw) + "×" + Math.round(b.ch) + ").",
          suggestion: "상자 크기를 키우거나 글자 크기를 줄이세요.",
        });
      }
    }
    return out;
  }

  function openFindingsPanel() { $("polish-panel").hidden = true; $("findings-panel").hidden = false; }
  function closeFindings() { $("findings-panel").hidden = true; }
  function setFpStatus(text, cls) { const el = $("fp-status"); el.className = "fp-status" + (cls ? " " + cls : ""); el.textContent = text; }

  async function runAudit(kind) {
    if (busy) return;
    mode = "audit"; updateModeUI(); postMode();
    $("audit-menu").hidden = true;
    $("btn-audit").setAttribute("aria-expanded", "false");
    openFindingsPanel();
    $("fp-title").textContent = "콘텐츠 검증 · " + AUDIT_LABEL[kind];
    setFpStatus(kind === 4 ? "구조·겹침 기계 검증 중…" : "AI 검증 중…", kind === 4 ? "mech" : "busy");
    findings = [];
    renderFindings(kind);
    busy = true;
    try {
      if (kind === 4) {
        const boxes = await collectBoxes();
        findings = mechanicalAudit(boxes);
        setFpStatus("기계 검증 완료 · " + findings.length + "건 (겹침·오버플로)", "mech");
      } else {
        const inv = DomAdapter.textInventory(sourceDoc).filter((e) => e.text);
        const raw = await requestAudit(kind, inv);
        findings = ((raw && raw.findings) || []).filter((f) => f && f.eid).map((f) => ({ eid: f.eid, kind: "ai", issue: f.issue, suggestion: f.suggestion }));
        setFpStatus("AI 검증 완료 · " + findings.length + "건", "ai");
      }
    } catch (err) {
      setFpStatus("검증 실패: " + (err && err.message ? err.message : String(err)), "");
      findings = [];
    } finally {
      busy = false;
      renderFindings(kind);
    }
  }

  function renderFindings(kind) {
    const list = $("fp-list");
    list.innerHTML = "";
    if (!findings.length) {
      const empty = document.createElement("div");
      empty.className = "fp-empty";
      empty.textContent = busy ? "" : "지적 사항이 없습니다. 👍";
      list.appendChild(empty);
      return;
    }
    // 안전: 정적 skeleton만 innerHTML로 넣고, 동적 값(eid/issue/suggestion)은 전부 textContent로.
    findings.forEach((f, i) => {
      const row = document.createElement("div");
      row.className = "finding";
      row.dataset.eid = f.eid;
      row.dataset.idx = String(i);
      row.innerHTML =
        '<div class="finding-top"><span class="finding-kind"></span><span class="finding-eid"></span></div>' +
        '<div class="finding-issue"></div><div class="finding-sugg"></div>' +
        '<div class="finding-actions"><button type="button" class="finding-fix">AI로 고치기</button></div>';
      const TAG = { overlap: ["overlap", "겹침"], overflow: ["overflow", "오버플로"], structure: ["structure", "구조"], info: ["info", "정보"], ai: ["ai", "AI"] };
      const [kindTag, kindTxt] = TAG[f.kind] || TAG.ai;
      const kEl = row.querySelector(".finding-kind");
      kEl.className = "finding-kind " + kindTag; kEl.textContent = kindTxt;
      row.querySelector(".finding-eid").textContent = f.eid || "(전체)";
      row.querySelector(".finding-issue").textContent = f.issue || "";
      const sugg = row.querySelector(".finding-sugg");
      if (f.suggestion) sugg.textContent = "→ " + f.suggestion; else sugg.hidden = true;
      const fixBtn = row.querySelector(".finding-fix");
      if (!f.eid) { fixBtn.hidden = true; } // 특정 요소에 핀되지 않은 지적(구조 헤더 등)은 고치기 불가
      row.addEventListener("click", (e) => { if (e.target.closest(".finding-fix")) return; selectFinding(f, row); });
      fixBtn.addEventListener("click", (e) => { e.stopPropagation(); fixFinding(f, e.target); });
      list.appendChild(row);
    });
  }

  function selectFinding(f, rowEl) {
    [...document.querySelectorAll(".finding")].forEach((r) => r.classList.remove("sel"));
    if (rowEl) rowEl.classList.add("sel");
    if (!f.eid) return;
    if (provenance === "archify") {
      postToView({ type: "arch-select", id: f.eid });
      postToView({ type: "arch-flash", id: f.eid });
    } else {
      postToView({ type: "arch-select", eid: f.eid });
      postToView({ type: "arch-flash", eid: f.eid });
    }
  }

  // finding의 suggestion을 지시문으로 선택-모드 scoped edit 루프를 재사용해 그 요소만 고친다.
  async function fixFinding(f, btn) {
    if (provenance === "archify") { await fixArchFinding(f, btn); return; }
    if (busy || !sourceDoc) return;
    const eid = f.eid;
    if (!DomAdapter.getByEid(sourceDoc, eid)) { showToast("요소를 찾을 수 없음: " + eid); return; }
    busy = true; if (btn) btn.disabled = true;
    try {
      const ctx = DomAdapter.contextFor(sourceDoc, eid, null);
      const raw = await requestOps(ctx, f.suggestion || "이 요소의 지적 사항을 고쳐줘");
      const { ops, reject, notes } = DomAdapter.sanitizeOps(raw, eid);
      if (reject) { showToast("AI가 거절함: " + reject.reason); return; }
      if (!ops.length) { showToast("적용할 변경이 없습니다." + (notes.length ? " (" + notes.join("; ") + ")" : "")); return; }
      const res = commitOps(ops, eid, { flashEid: eid });
      if (!res.ok) { showToast(res.error); return; }
      showToast("고침 적용 · " + eid, { actionLabel: "실행 취소", onAction: undo });
    } catch (err) {
      showToast("고치기 실패: " + (err && err.message ? err.message : String(err)));
    } finally { busy = false; if (btn) btn.disabled = false; }
  }

  // ---------------- 광역 모드 바 (레이아웃 / 다듬기) ----------------

  function openWdBar(kind) {
    const bar = $("wd-bar");
    $("wd-badge").textContent = kind === "layout" ? "레이아웃 수정" : "콘텐츠 다듬기";
    $("wd-input").placeholder = kind === "layout"
      ? "예: 모든 노드를 오른쪽으로 40px 이동 / 겹치지 않게 정렬"
      : "예: 문어체로 통일하고 군더더기를 줄여줘";
    $("wd-input").value = "";
    setWdBusy(false); setWdError("");
    bar.hidden = false;
    $("wd-input").focus();
  }
  function setWdBusy(on) { $("wd-busy").hidden = !on; $("wd-run").disabled = on; $("wd-input").disabled = on; }
  function setWdError(msg) { const el = $("wd-error"); el.hidden = !msg; el.textContent = msg || ""; }

  function buildLayoutMessages(instruction, elements) {
    const system = [
      "당신은 다이어그램 슬라이드의 레이아웃 편집기다. 뷰포트 " + SLIDE_W + "×" + SLIDE_H + " (px).",
      "layout_edits 도구로 ops를 반환한다. 각 op = setStyle(eid=주어진 목록, style=top/left/width/height/zIndex 중 일부, px 문자열).",
      "★ 위치·크기(geometry)만 바꾼다. 텍스트·색·폰트는 절대 바꾸지 않는다(스키마에 없음).",
      "겹치지 않게, 지시대로 재배치한다. 바꿀 필요 없는 요소는 op를 내지 않는다.",
    ].join("\n");
    const lines = elements.map((e) => e.eid + " · left=" + e.left + " top=" + e.top + " w=" + e.width + " h=" + e.height);
    return [{ role: "system", content: system }, { role: "user", content: "[요소 위치·크기]\n" + lines.join("\n") + "\n\n[지시] " + instruction }];
  }
  function buildPolishMessages(instruction, inv) {
    const system = [
      "당신은 다이어그램 슬라이드의 카피 에디터다.",
      "polish_edits 도구로 ops를 반환한다. 각 op = setText(eid=주어진 목록, text=다듬은 대표 텍스트 줄).",
      "★ 텍스트만 바꾼다. 위치·크기·색은 절대 바꾸지 않는다(스키마에 없음).",
      "톤/용어 통일·군더더기 제거 등 지시를 따른다. 바꿀 필요 없는 요소는 op를 내지 않는다.",
    ].join("\n");
    const lines = inv.map((e) => e.eid + " · " + (e.text || "(빈 텍스트)"));
    return [{ role: "system", content: system }, { role: "user", content: "[요소 대표 텍스트]\n" + lines.join("\n") + "\n\n[지시] " + instruction }];
  }

  async function requestLayout(instruction, elements, eids) {
    if ($("mock-toggle").checked) return ArchMock.layout(instruction, elements);
    if (!ArchConfig.has("nvidia-key")) throw new Error("NVIDIA 키가 없습니다 — 연결 설정에서 키를 입력하거나 mock을 켜세요.");
    const tool = { name: "layout_edits", description: "위치·크기(geometry)만 바꾸는 setStyle op 목록.", input_schema: DomAdapter.buildLayoutSchema(eids) };
    return await ArchLLM.chatTool({ model: ArchConfig.get("model") || ArchConfig.DEFAULT_MODEL, messages: buildLayoutMessages(instruction, elements), tool, maxTokens: 6000, temperature: 0 });
  }
  async function requestPolish(instruction, inv, eids) {
    if ($("mock-toggle").checked) return ArchMock.polish(instruction, inv);
    if (!ArchConfig.has("nvidia-key")) throw new Error("NVIDIA 키가 없습니다 — 연결 설정에서 키를 입력하거나 mock을 켜세요.");
    const tool = { name: "polish_edits", description: "텍스트만 바꾸는 setText op 목록.", input_schema: DomAdapter.buildPolishSchema(eids) };
    return await ArchLLM.chatTool({ model: ArchConfig.get("model") || ArchConfig.DEFAULT_MODEL, messages: buildPolishMessages(instruction, inv), tool, maxTokens: 6000, temperature: 0 });
  }

  async function runLayout(instruction) {
    if (busy) return;
    if (!instruction) { setWdError("지시를 입력하세요."); return; }
    busy = true; setWdBusy(true); setWdError("");
    try {
      const boxes = await collectBoxes();
      const elements = boxes.map((b) => ({ eid: b.eid, left: Math.round(b.x), top: Math.round(b.y), width: Math.round(b.w), height: Math.round(b.h) }));
      const eids = elements.map((e) => e.eid);
      const raw = await requestLayout(instruction, elements, eids);
      const { ops, reject, notes } = DomAdapter.sanitizeLayoutOps(raw, eids);
      if (reject) { setWdError("AI가 거절함: " + reject.reason); return; }
      if (!ops.length) {
        setWdError("적용할 위치·크기 변경이 없습니다." + (notes.length ? " (필드 잠금: " + notes.slice(0, 2).join("; ") + ")" : ""));
        return;
      }
      const allowed = [...new Set(ops.map((o) => o.eid))];
      pendingLayoutOps = { ops, allowed, notes };
      $("wd-confirm-text").innerHTML = "<b>" + allowed.length + "개</b> 요소의 위치·크기가 바뀝니다. 적용할까요?" +
        (notes.length ? "<br><span style='font-size:12px;color:#9A9AA5'>필드 잠금으로 걸러진 항목 " + notes.length + "건</span>" : "");
      $("wd-confirm").hidden = false;
    } catch (err) { setWdError("실패: " + (err && err.message ? err.message : String(err))); }
    finally { busy = false; setWdBusy(false); }
  }

  function applyLayout() {
    if (!pendingLayoutOps) { $("wd-confirm").hidden = true; return; }
    const { ops, allowed } = pendingLayoutOps;
    $("wd-confirm").hidden = true;
    const res = commitOps(ops, allowed);
    if (!res.ok) { setWdError(res.error); showToast("적용 실패: " + res.error); pendingLayoutOps = null; return; }
    showToast(allowed.length + "개 요소 위치·크기 변경 적용됨", { actionLabel: "실행 취소", onAction: undo });
    pendingLayoutOps = null;
  }

  async function runPolish(instruction) {
    if (busy) return;
    if (!instruction) { setWdError("지시를 입력하세요."); return; }
    busy = true; setWdBusy(true); setWdError("");
    try {
      const inv = DomAdapter.textInventory(sourceDoc).filter((e) => e.text);
      const eids = inv.map((e) => e.eid);
      const raw = await requestPolish(instruction, inv, eids);
      const { ops, reject, notes } = DomAdapter.sanitizePolishOps(raw, eids);
      if (reject) { setWdError("AI가 거절함: " + reject.reason); return; }
      if (!ops.length) {
        setWdError("적용할 텍스트 변경이 없습니다." + (notes.length ? " (필드 잠금: " + notes.slice(0, 2).join("; ") + ")" : ""));
        return;
      }
      const invMap = new Map(inv.map((e) => [e.eid, e.text]));
      pendingPolish = { rows: ops.map((o) => ({ eid: o.eid, before: invMap.get(o.eid) || "", after: o.text, op: o })), notes };
      renderPolishList();
      $("wd-bar").hidden = true;
      $("findings-panel").hidden = true;
      $("polish-panel").hidden = false;
    } catch (err) { setWdError("실패: " + (err && err.message ? err.message : String(err))); }
    finally { busy = false; setWdBusy(false); }
  }

  function renderPolishList() { renderPolishRows(pendingPolish.rows); }
  function renderPolishRows(rows) {
    const list = $("pp-list");
    list.innerHTML = "";
    rows.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "polish-row";
      row.innerHTML =
        '<div class="pr-top"><input type="checkbox" checked><span class="finding-eid"></span></div>' +
        '<div class="pr-before"></div><div class="pr-after"></div>';
      const cb = row.querySelector("input[type=checkbox]");
      cb.dataset.eid = r.eid; cb.dataset.idx = String(i);
      row.querySelector(".finding-eid").textContent = r.eid;
      row.querySelector(".pr-before").textContent = r.before || "(빈 텍스트)";
      row.querySelector(".pr-after").textContent = r.after;
      list.appendChild(row);
    });
    $("pp-selectall").checked = true;
  }

  function closePolish() { $("polish-panel").hidden = true; pendingPolish = null; pendingArchPolish = null; }

  function applyPolish() {
    if (!pendingPolish) return;
    const checked = [...document.querySelectorAll("#pp-list input[type=checkbox]:checked")].map((c) => c.dataset.eid);
    const ops = pendingPolish.rows.filter((r) => checked.includes(r.eid)).map((r) => r.op);
    if (!ops.length) { showToast("선택된 항목이 없습니다."); return; }
    const allowed = [...new Set(ops.map((o) => o.eid))];
    const res = commitOps(ops, allowed);
    if (!res.ok) { showToast("적용 실패: " + res.error); return; }
    showToast(ops.length + "개 텍스트 다듬기 적용됨", { actionLabel: "실행 취소", onAction: undo });
    closePolish();
  }

  // ---------------- 모드 전환 ----------------

  // stage 5: class a도 6모드 전부 지원한다. 단 모든 편집이 archify serve 재렌더에
  // 의존하므로, serve 미도달 시에는 편집 계열 5모드를 잠근다(선택은 관람 가능).
  // class b(dom)는 항상 6모드 활성.
  function updateModeGating() {
    const lock = provenance === "archify" && !serveAvailable;
    [...document.querySelectorAll(".mode[data-mode]")].forEach((b) => {
      const m = b.getAttribute("data-mode");
      if (m === "select") { b.disabled = false; b.removeAttribute("title"); return; }
      b.disabled = lock;
      if (lock) b.setAttribute("title", MODE_GATE_TIP); else b.removeAttribute("title");
    });
  }

  // serve 도달성 프로브. archify serve는 모든 응답에 CORS 헤더(Access-Control-Allow-Origin)를
  // 붙이지만 python http.server는 안 붙인다 → 200 GET(콘솔 에러 無)으로 둘을 명확히 구분한다.
  // (POST/OPTIONS 프로브는 http.server가 501을 반환해 브라우저가 콘솔 에러를 남기므로 회피.)
  async function probeServe() {
    try {
      const res = await fetch(serveBase + "/index.html", { method: "GET", cache: "no-store" });
      if (!res.ok) return false;
      return res.headers.get("access-control-allow-origin") != null;
    } catch (_) { return false; }
  }

  function updateServeBanner() {
    const el = $("serve-banner");
    if (el) el.hidden = !(provenance === "archify" && !serveAvailable);
  }

  function updateModeUI() {
    [...document.querySelectorAll(".mode[data-mode]")].forEach((b) => b.classList.toggle("active", b.getAttribute("data-mode") === mode));
    const arch = provenance === "archify";
    // 그리기: class b는 draw-palette(텍스트/도형), class a는 arch-draw-panel(노드/엣지)
    $("draw-palette").hidden = !(mode === "draw" && !arch);
    const adp = $("arch-draw-panel"); if (adp) adp.hidden = !(mode === "draw" && arch);
    if (mode !== "layout" && mode !== "polish") $("wd-bar").hidden = true;
    if (mode !== "audit") { $("audit-menu").hidden = true; $("btn-audit").setAttribute("aria-expanded", "false"); }
    // 편집 하위 UI(화살촉 일괄 바)는 편집 모드를 벗어나면 함께 접는다.
    // (D24: 편집 도구 그룹은 서식 툴바 안에 있어 updateFmtBar가 함께 감춘다 — 별도 정리 불필요.)
    if (mode !== "edit") { $("gh-bar").hidden = true; pendingGlobalHead = null; }
    updateModeGating();
    updateFmtBar();       // 서식 툴바는 선택 모드·편집 모드에서만(광역 모드로 가면 접힌다)
    layout();
  }

  function setMode(m) {
    mode = m;
    // D25a: 편집 모드 진입 시 요소 편집은 항상 기본값(ON)·focus는 전체로 리셋 — "편집 모드 진입 = 요소 편집 기본 ON"(계약).
    //   편집 모드 안에서 토글/사이드도구를 바꾼 상태는 그 안에 머무는 동안만 유지되고, 모드를 나갔다 오면 초기화된다.
    if (m === "edit") { elementEditOn = DEFAULT_ELEMENT_EDIT_ON; editFocus = "all"; }
    inlineSession = null;   // D26: 모드 전환 시 인라인 세션 미러 해제(agent도 cancelInlineEdit로 뷰를 접는다)
    closePopover(); closeDetailPanels(); closeArchEditForm(); closeFindings(); closePolish();
    $("wd-confirm").hidden = true;
    pendingLayoutOps = null; pendingArchLayout = null; pendingArchPolish = null; archEdgeSource = null;
    pendingGlobalHead = null; pendingLineFocus = null; $("gh-bar").hidden = true;
    clearSelection(); selected = null;
    updateModeUI();
    if (m === "draw" && provenance === "archify") openArchDrawPanel();
    else if (m === "layout") openWdBar("layout");
    else if (m === "polish") openWdBar("polish");
    else $("wd-bar").hidden = true;
    postMode();
  }

  function toggleAuditMenu() {
    const menu = $("audit-menu");
    const open = menu.hidden;
    menu.hidden = !open;
    $("btn-audit").setAttribute("aria-expanded", String(open));
  }

  // D24: "편집 ▾ 드롭다운"은 없어졌다 — 두 하위 항목은 서식 툴바의 편집 도구 그룹(#edit-menu)
  // 으로 접혀 들어갔고, 그 그룹은 **편집 모드면 항상 보인다**(툴바와 생사를 함께한다).
  // 따라서 "메뉴가 열려 있다" == "편집 도구가 보인다" == "서식 툴바가 편집 모드로 떠 있다".
  // 여닫는 별도 상태가 없으므로 toggle/close도 없다 — 모드가 곧 상태다.
  function isEditToolsOpen() {
    const g = $("edit-menu"), bar = $("fmt-bar");
    return !!(g && bar && !bar.hidden && mode === "edit" && !fmtCollapsed);
  }

  // 화살촉 일괄 조절은 인라인 SVG marker를 직접 고치는 동작이라 class-b/c(수제 슬라이드)에서만
  // 뜻이 있다. class-a(archify)는 JSON→서버 재렌더라 DOM 편집이 다음 렌더에서 날아간다 → 잠근다.
  function globalHeadAvailability() {
    if (provenance === "archify") return { ok: false, why: "archify(class-a) 다이어그램은 JSON 소스에서 재렌더되므로 DOM marker 편집이 유지되지 않습니다." };
    if (!sourceDoc) return { ok: false, why: "문서가 로드되지 않았습니다." };
    const inv = SvgAdapter.markerInventory(sourceDoc);
    if (!inv.total) return { ok: false, why: "이 문서에는 화살촉(marker) 정의가 없습니다." };
    return { ok: true, inv };
  }
  // D25d: 화살촉 일괄 게이팅은 3행 '전체 적용'으로 이전됐다 — 이 함수는 하위호환 별칭으로 남긴다.
  function updateEditMenuGating() { updateHeadAllRow(); }

  // ---------------- 화살촉 크기 일괄 조절 (문서 전체 · 확인 게이트) ----------------
  // 요소 스코프의 정반대라 bleed-diff로 지킬 수 없다 → 광역 모드(레이아웃/다듬기)와 같은
  // "확인 다이얼로그 → 적용" 경로를 쓰고, 스냅샷을 한 번만 쌓아 Cmd+Z 한 번에 전부 되돌린다.
  function openGlobalHeadBar() {
    const av = globalHeadAvailability();
    if (!av.ok) { showToast(av.why, { ms: 5000 }); return false; }
    const cur = av.inv.scales.length === 1 ? av.inv.scales[0] : 1;
    $("gh-size").value = String(cur);
    $("gh-sizeval").textContent = cur.toFixed(1) + "×";
    setGhError("");
    $("gh-bar").hidden = false;
    updateEditToolsUI();   // 툴바의 "전체" 버튼을 켜짐 상태로 — 지금 문서 전체 모드임을 보이게
    layout();
    return true;
  }
  function closeGlobalHeadBar() {
    $("gh-bar").hidden = true;
    setGhError("");
    if (pendingGlobalHead) { pendingGlobalHead = null; $("wd-confirm").hidden = true; }
    updateEditToolsUI();
    layout();
  }
  function setGhError(msg) { const el = $("gh-error"); if (el) { el.hidden = !msg; el.textContent = msg || ""; } }

  // 적용 버튼 → 확인 다이얼로그(무엇이 몇 개 바뀌는지 + 개별 조정 덮어쓰기 고지).
  function runGlobalHead() {
    if (busy) return;
    const av = globalHeadAvailability();
    if (!av.ok) { setGhError(av.why); return; }
    const scale = parseFloat($("gh-size").value);
    if (!Number.isFinite(scale) || scale <= 0) { setGhError("배율이 유효하지 않습니다."); return; }
    $("gh-sizeval").textContent = scale.toFixed(1) + "×";   // 슬라이더를 코드로 세팅한 경우에도 라벨 일치
    pendingGlobalHead = { scale, markers: av.inv.total, edges: av.inv.edges, clones: av.inv.clones };
    $("wd-confirm-text").innerHTML =
      "화살표 <b>" + av.inv.edges + "개</b>의 화살촉이 모두 <b>" + scale.toFixed(1) + "×</b>로 바뀝니다 (문서 전체)." +
      (av.inv.clones ? "<br><span style='font-size:12px;color:#F4B183'>개별 조정된 화살표 " + av.inv.clones + "개도 같은 크기로 덮어씁니다.</span>" : "") +
      "<br><span style='font-size:12px;color:#9A9AA5'>실행 취소(Cmd+Z) 한 번으로 전체가 되돌아갑니다.</span>";
    $("wd-confirm").hidden = false;
  }

  // 실제 적용 — 단일 스냅샷 → 문서 전체 marker 스케일 → 재렌더. bleed-diff는 쓰지 않는다(광역이 목적).
  function applyGlobalHead() {
    if (!pendingGlobalHead) { $("wd-confirm").hidden = true; return { ok: false, error: "대기 중인 변경 없음" }; }
    const { scale } = pendingGlobalHead;
    $("wd-confirm").hidden = true;
    pendingGlobalHead = null;
    const before = DomAdapter.serializeRaw(sourceDoc);
    const nextDoc = sourceDoc.cloneNode(true);
    let r;
    try { r = SvgAdapter.setGlobalHeadSize(nextDoc, scale); }
    catch (e) { r = { ok: false, note: (e && e.message) || String(e) }; }
    if (!r.ok) { setGhError(r.note); showToast("적용 실패: " + r.note); return { ok: false, error: r.note }; }
    pushUndo({ kind: "dom", html: before });
    sourceDoc = nextDoc;
    clearSelection(); selected = null;
    closeDetailPanels();
    render();
    updateUndoBtn();
    $("gh-size").value = String(r.scale);
    $("gh-sizeval").textContent = r.scale.toFixed(1) + "×";
    showToast("화살촉 " + r.scale.toFixed(1) + "× 일괄 적용 · 화살표 " + r.edges + "개 / marker " + r.markers + "개",
      { actionLabel: "실행 취소", onAction: undo });
    return { ok: true, ...r };
  }

  // ---------------- undo / download / load ----------------

  function closeAllSelPanels() {
    closePopover(); closeDetailPanels();
    $("wd-confirm").hidden = true;
  }
  function undo() {
    if (!undoStack.length || busy) return;
    const snap = undoStack.pop();
    redoStack.push(currentSnap());                 // 지금 상태를 미래 가지로
    if (redoStack.length > UNDO_MAX) redoStack.shift();
    closeAllSelPanels();
    clearSelection();
    restoreSnap(snap);
    render();
    updateUndoBtn();
    showToast("실행 취소됨 (남은 취소 " + undoStack.length + "회 · 다시 실행 " + redoStack.length + "회)");
  }
  // D21: 다시 실행 — undo의 정확한 거울상. 스냅샷 기반이라 class-a/b/c 어느 편집이든 동일하다.
  function redo() {
    if (!redoStack.length || busy) return;
    const snap = redoStack.pop();
    undoStack.push(currentSnap());                 // 지금 상태를 과거 가지로 (여기선 redo를 비우지 않는다)
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    closeAllSelPanels();
    clearSelection();
    restoreSnap(snap);
    render();
    updateUndoBtn();
    showToast("다시 실행됨 (남은 다시 실행 " + redoStack.length + "회)");
  }
  function updateUndoBtn() {
    const noUndo = undoStack.length === 0, noRedo = redoStack.length === 0;
    $("btn-undo").disabled = noUndo;
    const rb = $("btn-redo"); if (rb) rb.disabled = noRedo;
    const fu = $("fmt-undo"); if (fu) fu.disabled = noUndo;
    const fr = $("fmt-redo"); if (fr) fr.disabled = noRedo;
  }

  function updateInkBtn() {
    const b = $("btn-ink-compare");
    if (b) b.disabled = !lastInkCompare;
  }

  // D33: html 문자열에서 eid가 가리키는 SVG 단위(svgbox/svgtext/svgedge)만 골라 래스터화.
  // test/s10-lines-globalhead.test.mjs의 headInk()/raster() 기법 그대로 이식 — 순수 DOM/Canvas
  // API라 Playwright 전용이 아니다: 대상+조상+<defs>만 남기고 나머지 제거 → data URL → Image →
  // canvas → getImageData 알파채널 카운트. obj(HTML div)는 그 svg[data-object] 서브트리 밖이라
  // target이 안 잡혀 null을 반환한다(호출측이 "미지원"으로 처리).
  async function rasterizeUnit(html, eid) {
    const d = new DOMParser().parseFromString(html, "text/html");
    const svg = d.querySelector("svg[data-object]");
    if (!svg) return null;
    const clone = svg.cloneNode(true);
    const target = clone.querySelector('[data-arch-eid="' + eid + '"]');
    if (!target) return null;
    // s10 headInk()의 strip 조건(target·조상·<defs>만 보존)은 target 자체가 leaf(path/line, 자기
    // stroke가 곧 내용)인 화살표 전용이었다. svgbox는 눈에 보이는 내용(rect/text)이 target(<g>)의
    // **자손**이라 el.contains(target)(조상 판정)만으론 그 자손들이 전부 제거돼 ink=0이 된다
    // (실측으로 확정 — s28 (C2) 최초 실패). target.contains(el)(자손 판정)을 추가해 대칭으로 보존.
    [...clone.querySelectorAll("*")].forEach((el) => {
      if (el === target || el.contains(target) || target.contains(el) || el.closest("defs")) return;
      el.remove();
    });
    const vb = (clone.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
    if (!vb[2] || !vb[3]) return null;
    clone.setAttribute("width", String(vb[2]));
    clone.setAttribute("height", String(vb[3]));
    clone.removeAttribute("style");
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res; img.onerror = () => rej(new Error("raster fail"));
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(clone.outerHTML);
    });
    const c = document.createElement("canvas");
    c.width = vb[2]; c.height = vb[3];
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] >= 60) ink++;
    return { canvas: c, ink };
  }

  // D33: "🔍 변경 비교" 버튼 — 직전 commitOps 커밋(편집 전반, undo 한정 아님)의 전/후를 나란히
  // 래스터화해 보여준다. 소스 모델을 전혀 건드리지 않는 read-only 관찰 도구(op 미적용 — scope
  // 3중보증은 애초에 해당 없음, apply 경로를 전혀 타지 않는다).
  async function openInkCompare() {
    if (!lastInkCompare) return;
    const { eid, beforeHTML, afterHTML } = lastInkCompare;
    const panel = $("ink-panel");
    const bHolder = $("ink-before-holder"), aHolder = $("ink-after-holder");
    const bCount = $("ink-before-count"), aCount = $("ink-after-count");
    const bodyEl = $("ink-body"), deltaEl = $("ink-delta"), unsupportedEl = $("ink-unsupported");
    bHolder.textContent = ""; aHolder.textContent = ""; bCount.textContent = ""; aCount.textContent = ""; deltaEl.textContent = "";
    panel.hidden = false;
    let before = null, after = null;
    try { [before, after] = await Promise.all([rasterizeUnit(beforeHTML, eid), rasterizeUnit(afterHTML, eid)]); }
    catch (e) { before = null; after = null; }
    if (!before || !after) {
      // obj(HTML) 단위이거나(가장 흔한 경우) 래스터화 실패 — 안전하게 비활성 메시지로 대체
      // (이 코드베이스 전반의 "안 되면 비활성+사유" 원칙, D23/D31/D34b와 동일 패턴).
      bodyEl.hidden = true; deltaEl.hidden = true;
      unsupportedEl.hidden = false;
      unsupportedEl.textContent = "이 요소(" + eid + ")는 잉크 비교를 지원하지 않습니다 — HTML 텍스트 상자·표·이미지(obj)는 브라우저에 DOM→캔버스 API가 없어 SVG 요소(도형·자유텍스트·화살표)만 지원됩니다.";
      return;
    }
    bodyEl.hidden = false; deltaEl.hidden = false; unsupportedEl.hidden = true;
    before.canvas.style.maxWidth = "100%"; after.canvas.style.maxWidth = "100%";
    bHolder.appendChild(before.canvas); aHolder.appendChild(after.canvas);
    bCount.textContent = "잉크(칠해진 픽셀) " + before.ink + "px";
    aCount.textContent = "잉크(칠해진 픽셀) " + after.ink + "px";
    const delta = after.ink - before.ink;
    deltaEl.textContent = "차이: " + (delta > 0 ? "+" : "") + delta + "px" + (delta === 0 ? " (렌더상 차이 없음 — 속성만 바뀌었을 수 있음)" : "");
  }

  function download() {
    let html;
    if (provenance === "archify") {
      if (!archModel) return;
      html = ArchifyJsonAdapter.serialize(archModel);   // 이미 clean(에이전트 미주입 · 소스 임베드)
    } else {
      if (!sourceDoc) return;
      html = DomAdapter.serializeClean(sourceDoc);
    }
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName.replace(/\.html?$/i, "") + ".edited.html";
    document.body.appendChild(a);
    a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // provenance 자동 판별: 임베디드 archify 소스가 있으면 class a, 없으면 class b.
  function loadHtml(html, name) {
    let isArchify = false;
    try { isArchify = ArchifyJsonAdapter.hasEmbeddedSource(html); } catch (_) { isArchify = false; }
    return isArchify ? loadArchify(html, name) : loadDom(html, name);
  }

  function resetLoadState(name) {
    fileName = name;
    undoStack = [];
    redoStack = [];
    lastInkCompare = null;   // D33: 새 문서 로드 시 이전 문서의 전/후 스냅샷이 남아있으면 안 됨
    updateInkBtn();
    selected = null; selection = []; pendingReselectSet = null;
    findings = []; pendingLayoutOps = null; pendingPolish = null;
    pendingGlobalHead = null; pendingLineFocus = null;
    mode = "select"; drawKind = "textbox";
    updateFmtBar();
    closePopover(); closeDetailPanels(); closeFindings(); closePolish();
    $("wd-confirm").hidden = true; $("wd-bar").hidden = true; $("gh-bar").hidden = true;
    $("empty-state").hidden = true;
    updateFmtBar();   // 새 문서 = 선택 모드 · 선택 없음 → 툴바는 접힌다(mode 대입 뒤 한 번 더)
  }

  function loadDom(html, name) {
    provenance = "dom";
    archModel = null;
    serveAvailable = false;
    const { doc, count } = DomAdapter.load(html);
    // class c: 인라인 <svg data-object> 안의 박스 <g>들을 svgbox:N으로 stamp → 박스 단위 선택·편집.
    // (DomAdapter.assignEids가 obj:N을 찍은 뒤에 실행 — 바깥 svg는 컨테이너, 박스는 개별 유닛이 됨.)
    let svgBoxes = { count: 0, rectCount: 0 };
    let svgTexts = { count: 0 };
    let svgEdges = { count: 0 };
    try { svgBoxes = SvgAdapter.stampBoxes(doc); } catch (_) { svgBoxes = { count: 0, rectCount: 0 }; }
    // D16(b): 박스 밖 자유 <text>를 svgtext:N으로 stamp — ★ stampBoxes 뒤(박스 소유 텍스트 제외).
    try { svgTexts = SvgAdapter.stampTexts(doc); } catch (_) { svgTexts = { count: 0 }; }
    // D18: marker-end를 가진 화살표를 svgedge:N으로 stamp — ★ 위 둘 뒤(박스 소유 화살표 제외).
    try { svgEdges = SvgAdapter.stampEdges(doc); } catch (_) { svgEdges = { count: 0 }; }
    sourceDoc = doc;
    resetLoadState(name);
    updateModeUI();          // gating: 6모드 전부 활성
    updateServeBanner();     // dom이면 배너 숨김
    render();
    layout();
    updateUndoBtn();
    const svgNote = svgBoxes.count
      ? " (SVG 박스 " + svgBoxes.count + "개" + (svgTexts.count ? " · 자유 텍스트 " + svgTexts.count + "개" : "") + (svgEdges.count ? " · 화살표 " + svgEdges.count + "개" : "") + " 포함)"
      : "";
    showToast("불러옴: " + name + " · 편집 가능한 요소 " + count + "개" + svgNote);
  }

  async function loadArchify(html, name) {
    let model;
    try { model = ArchifyJsonAdapter.load(html); }
    catch (err) { showToast("archify 소스 복원 실패: " + (err && err.message ? err.message : String(err))); return; }
    provenance = "archify";
    archModel = { ...model };
    sourceDoc = null;
    resetLoadState(name);
    updateModeUI();          // gating: class-b 5모드 잠금, 선택만 활성
    render();                // serve가 없어도 뷰는 즉시 표시(관람 가능)
    layout();
    updateUndoBtn();
    const src = model.source || {};
    const list = src.nodes || src.components || src.participants || src.states || [];
    showToast("불러옴(archify · " + model.type + "): " + name + " · 요소 " + list.length + "개");
    // serve 도달성 프로브 후 배너/편집 게이트 갱신(뷰 표시 뒤 비동기).
    // serve 도달 확인 후에야 5개 편집 모드가 열린다(updateModeGating 재실행).
    serveAvailable = await probeServe();
    updateServeBanner();
    updateModeGating();
  }

  async function loadDemo() {
    try {
      const res = await fetch(DEMO_FILE, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      loadHtml(await res.text(), DEMO_FILE);
    } catch (err) { $("empty-state").hidden = false; }
  }

  // ---------------- config / status ----------------

  function updateConnStatus() {
    const el = $("conn-status");
    const mock = $("mock-toggle").checked;
    if (mock) {
      el.className = "conn-status mock";
      el.textContent = "🧪 mock 모드 — LLM 호출 없이 결정론적 op 생성 (파이프라인 검증용)" +
        (ArchConfig.has("nvidia-key") ? " · 키가 있어도 mock이 우선됩니다" : "");
    } else if (ArchConfig.has("nvidia-key")) {
      el.className = "conn-status";
      el.textContent = "live — " + (ArchConfig.get("model") || ArchConfig.DEFAULT_MODEL) + " @ " + ArchConfig.get("proxy-url");
    } else {
      el.className = "conn-status mock";
      el.textContent = "키 없음 — live 호출 불가. 키를 입력하거나 mock을 유지하세요.";
    }
  }
  function onConfigChange(field) {
    if (field === "nvidia-key") $("mock-toggle").checked = !ArchConfig.has("nvidia-key");
    updateConnStatus();
  }

  // ---------------- wiring ----------------

  function init() {
    ArchConfig.wire(onConfigChange);
    updateConnStatus();

    window.addEventListener("message", (e) => {
      const f = $("diagram-frame");
      if (!f || e.source !== f.contentWindow) return;
      const d = e.data;
      if (!d || typeof d !== "object") return;

      if (d.type === "arch-undo") {          // D17b: iframe에서 온 Cmd/Ctrl+Z
        if (!busy) undo();
        return;
      }
      if (d.type === "arch-redo") {          // D21: iframe에서 온 Shift+Cmd/Ctrl+Z (같은 D17b 경로)
        if (!busy) redo();
        return;
      }
      if (d.type === "arch-escape") {        // iframe이 삼키던 Escape — 선택 집합 해제
        if (busy) return;
        closeAllSelPanels();
        closeArchEditForm();
        clearSelection();
        return;
      }
      // D27a/b: iframe이 삼키던 Delete/Ctrl+C/Ctrl+V — 부모가 모드·선택·클립보드를 보고 수행(직접조작).
      if (d.type === "arch-delete") { deleteSelection(); return; }
      if (d.type === "arch-copy") { copySelection(); return; }
      if (d.type === "arch-paste") { pasteClipboard(); return; }

      // 뷰(iframe) 클릭 = 툴바 드롭다운 기준으로는 "바깥 클릭". sandboxed iframe이 클릭을
      // 삼켜 부모 document 핸들러가 안 도는 구간을 이 메시지가 메운다(실측으로 확인된 갭).
      if (d.type === "arch-viewclick") {
        const am = $("audit-menu");
        if (am && !am.hidden) { am.hidden = true; $("btn-audit").setAttribute("aria-expanded", "false"); }
        return;
      }

      if (d.type === "arch-ready") {
        viewReady = true;
        postMode();
        if (pendingFlash) { postToView({ type: "arch-flash", ...pendingFlash }); pendingFlash = null; }
        // D28(A): 줄→줄 전환 커밋이 재렌더를 유발했으면, 새 뷰에서 전환 대상 인라인 세션을 다시 연다.
        //   이 재오픈이 (커밋된 줄의) 재선택을 대체한다.
        if (pendingInlineOpen) {
          const o = pendingInlineOpen; pendingInlineOpen = null; pendingReselect = null;
          if (mode === "edit") postToView({ type: "arch-open-inline", eid: o.eid, kind: o.kind, line: o.line });
        } else if (pendingReselect) {
          const eid = pendingReselect; pendingReselect = null;
          if (mode === "edit") postToView({ type: "arch-edit-select", eid });
        }
        // D22: 배치 편집 후 선택 집합 복원(재렌더로 오버레이가 날아간 뒤 다시 그린다).
        if (pendingReselectSet) {
          const s = pendingReselectSet; pendingReselectSet = null;
          postToView({ type: "arch-select-set", eids: s.eids, primary: s.primary });
        }
      } else if (d.type === "arch-boxes") {
        const req = boxReqs.get(d.reqId);
        if (req) { clearTimeout(req.timer); boxReqs.delete(d.reqId); req.resolve(d.boxes || []); }
      } else if (d.type === "arch-hit") {
        if (busy) return;
        if (provenance === "archify") { handleArchHit(d); return; }
        if (mode !== "select") return;
        if (d.additive) {
          // D22: Cmd/Ctrl+클릭 = 집합 토글. AI 팝오버는 단일 대상 전용이라 닫는다(§아래 주석).
          selectToggle(d);
          if (isMulti() || !selected) closePopover();
          else openPopover();
          return;
        }
        selectOne(d);
        openPopover();
      } else if (d.type === "arch-edit-hit") {
        if (mode !== "edit") return;
        if (d.additive) {
          selectToggle(d);
          // 다중 선택에서는 단일 요소 패널(줄 편집·정점 등)이 의미를 잃는다 → 접고 서식 툴바로 몬다.
          if (isMulti()) { closeDetailPanels(); return; }
          if (!selected) { closeDetailPanels(); return; }
          postToView({ type: "arch-edit-select", eid: selected.eid });
          return;
        }
        // ★ 팝업 폐지: 선택만 하면 툴바(updateFmtBar)가 종류별로 반영한다 — 열 상세 팝업이 없다.
        selectOne(d);
      } else if (d.type === "arch-geom") {
        if (mode !== "edit" || busy) return;
        applyGeom(d.eid, d.props);
      } else if (d.type === "arch-group-move") {
        if (mode !== "edit" || busy) return;
        applyGroupMove(d.moves);   // D41: 다중 선택 그룹 이동(단일 undo)
      } else if (d.type === "arch-inline-start") {
        // D26: OFF 인라인 편집 세션 시작 — 부모에 미러(텍스트 서식 게이트가 이걸 본다). 도형 선택과 무관.
        if (mode !== "edit" || busy) return;
        inlineSession = {
          eid: d.eid, kind: d.kind, line: (d.line != null ? d.line : null), origText: d.text || "",
          pendingSvg: {}, pendingDom: {}, pendingGap: null, previewCss: {},
        };
        // D28(A): 이 세션 시작이 재렌더 진행 중(viewReady=false)에 도착했다면, 그건 방금 커밋(텍스트 변경)이
        //   재렌더를 유발한 줄→줄 전환이다 — 새로 로드될 뷰엔 이 오버레이가 없으므로, arch-ready 뒤 다시 열도록 기억.
        if (!viewReady) pendingInlineOpen = { eid: d.eid, kind: d.kind, line: (d.line != null ? d.line : null) };
        updateFmtBar();
      } else if (d.type === "arch-inline-cancel") {
        // D26: Escape/폐기 — pending 서식까지 버리고 세션 종료(무커밋). 커밋 후 자체 종료면 여기 안 옴.
        if (inlineSession && (!d.eid || inlineSession.eid === d.eid)) { inlineSession = null; updateFmtBar(); }
      } else if (d.type === "arch-inline-blur") {
        // D26: 오버레이 <input>이 iframe 밖으로 포커스를 잃었다 — 어디로 갔는지는 **부모만** 안다.
        //   서식 툴바(#fmt-bar) 안이면 hold(세션 유지, 버튼이면 오버레이로 포커스 복귀), 아니면 진짜
        //   바깥 클릭이니 커밋. (iframe은 부모 activeElement를 못 보므로 이 판단은 부모가 권위를 가진다.)
        const ae = document.activeElement;
        const inBar = ae && ae.closest && ae.closest("#fmt-bar");
        if (inBar) postToView({ type: "arch-inline-hold", refocus: ae.tagName === "BUTTON" });
        else postToView({ type: "arch-inline-docommit" });
      } else if (d.type === "arch-text") {
        if (mode !== "edit" || busy) return;
        applyText(d.eid, d.text, d.changed);
      } else if (d.type === "arch-inline-commit") {
        // D26: OFF 인라인 커밋(SVG 박스 줄 / 자유 텍스트) — setText(+line) + pending 서식을 한 배치로.
        if (mode !== "edit" || busy) return;
        applyInlineCommit(d.eid, d.kind, d.line, d.text, d.changed);
      } else if (d.type === "arch-svg-move") {
        if (mode !== "edit" || busy) return;
        applySvgMove(d.eid, d.x, d.y);
      } else if (d.type === "arch-svg-resize") {
        if (mode !== "edit" || busy) return;
        applySvgResize(d.eid, { width: d.width, height: d.height, x: d.x, y: d.y });
      } else if (d.type === "arch-svgtext-move") {
        if (mode !== "edit" || busy) return;
        applySvgTextMove(d.eid, d.x, d.y);
      } else if (d.type === "arch-svgedge-flip") {
        // 기능 A: 더블클릭 방향 뒤집기 — 패널 버튼과 같은 flipEdge op.
        if (mode !== "edit" || busy) return;
        applyEdgeGeom(d.eid, { op: "flipEdge" }, "방향 뒤집기");
      } else if (d.type === "arch-svgedge-vertex") {
        // 기능 B-1: 정점 드래그 이동(agent가 실측 user 좌표를 보냄).
        if (mode !== "edit" || busy) return;
        applyEdgeGeom(d.eid, { op: "moveVertex", index: d.index, x: d.x, y: d.y }, "꼭짓점 이동");
      } else if (d.type === "arch-svgedge-addvertex") {
        // 기능 B-2: 중간점 드래그 = 꼭짓점 추가(<line>이면 등가 <path>로 승격).
        if (mode !== "edit" || busy) return;
        applyEdgeGeom(d.eid, { op: "addVertex", afterIndex: d.afterIndex, x: d.x, y: d.y }, "꼭짓점 추가");
      } else if (d.type === "arch-svgedge-delvertex") {
        if (mode !== "edit" || busy) return;
        applyEdgeGeom(d.eid, { op: "deleteVertex", index: d.index }, "꼭짓점 삭제");
      } else if (d.type === "arch-draw-at") {
        if (mode !== "draw") return;
        onDrawAt(d.x, d.y, d.kind);
      } else if (d.type === "arch-svg-hit") {
        showToast("이 svg 영역은 편집 불가 — 배경·시작/종료 원 등. 박스·텍스트·화살표를 클릭하세요.");
      } else if (d.type === "arch-miss") {
        if (provenance === "archify") {
          if (mode === "select") { closePopover(); selection = []; selected = null; updateFmtBar(); }
          else if (mode === "edit") { closeArchEditForm(); }
        } else {
          // 빈 캔버스 클릭 = 선택 집합 전체 해제(D22).
          if (mode === "select") { closePopover(); selection = []; selected = null; updateFmtBar(); }
          else if (mode === "edit") { closeDetailPanels(); selection = []; selected = null; updateFmtBar(); }
        }
      }
    });

    // 툴바 모드 버튼
    [...document.querySelectorAll(".mode[data-mode]")].forEach((btn) => {
      const m = btn.getAttribute("data-mode");
      if (m === "audit") { btn.addEventListener("click", toggleAuditMenu); return; }
      if (m === "edit") {
        // D24: 다시 **평범한 모드 버튼**. 누르면 편집 모드로 들어가고, 그 결과로 상단 서식
        // 툴바가 열린다(그 안에 옛 드롭다운의 두 항목이 버튼으로 들어 있다).
        // 이미 편집 모드인데 또 누른 경우엔 접힌 툴바를 펴 준다(버튼이 죽은 것처럼 보이지 않게).
        btn.addEventListener("click", () => {
          if (mode !== "edit") { setMode("edit"); return; }
          if (fmtCollapsed) fmtCollapse(false);
        });
        return;
      }
      btn.addEventListener("click", () => setMode(m));
    });
    // D25a: "요소 편집" = ON/OFF 토글(구 단발 액션 아님). 편집 모드가 아니면 먼저 진입(그때 기본 ON),
    //   이미 편집 모드면 ON↔OFF를 뒤집는다.
    [...document.querySelectorAll('#edit-menu [data-editsub="element"]')].forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        if (mode !== "edit") { setMode("edit"); return; }   // 진입 = setMode가 기본 ON으로 리셋
        setElementEditOn(!elementEditOn);
      });
    });
    // D25c: 3-way focus 도구(전체/노드/화살표)
    [...document.querySelectorAll("#edit-focus [data-focus]")].forEach((btn) => {
      btn.addEventListener("click", () => { if (mode !== "edit") setMode("edit"); setEditFocus(btn.dataset.focus); });
    });
    // D25d: 3행 '전체 적용'(화살촉 일괄) — 구 1행 globalhead 버튼의 이전. 확인 게이트 그대로.
    $("fmt-head-all").addEventListener("click", () => { if (!$("fmt-head-all").disabled) runGlobalHeadFromRow(); });
    [...document.querySelectorAll("#audit-menu [data-audit]")].forEach((btn) => {
      btn.addEventListener("click", () => {
        $("audit-menu").hidden = true;
        const k = parseInt(btn.dataset.audit, 10);
        (provenance === "archify" ? runArchAudit : runAudit)(k);
      });
    });
    [...document.querySelectorAll("#draw-palette [data-draw]")].forEach((btn) => {
      btn.addEventListener("click", () => {
        // D35: 이미지 팔레트 버튼은 아직 파일이 없으면 파일선택으로 라우팅한다(change 핸들러가 drawKind=image까지 이어받음).
        if (btn.dataset.draw === "image" && !pendingImage) { $("image-input").click(); return; }
        // D40: 표 팔레트 버튼은 행/열 다이얼로그를 먼저 경유한다(확인 시 표 그리기 진입).
        if (btn.dataset.draw === "table") { openTableDialog(); return; }
        drawKind = btn.dataset.draw;
        [...document.querySelectorAll("#draw-palette [data-draw]")].forEach((b) => b.classList.toggle("active", b === btn));
        postMode();
      });
    });

    // ★ 팝업 폐지(2026-07-21): 상세 팝업 4종(#edit/#svgbox/#svgtext/#svgedge-panel)의 배선을 전부 삭제.
    //   그 기능은 툴바가 담당한다 — 채움/테두리/글자색/글꼴/크기/정렬(fmt-* 배선), 방향/화살촉(row3),
    //   박스 줄 추가·삭제·크기(fmt-line-add/del·fmt-size-apply), 줄 텍스트(요소 편집 OFF 인라인).

    // 광역 바 — provenance에 따라 class-a/class-b 경로로 분기
    const wdRun = () => {
      const v = $("wd-input").value.trim();
      if (provenance === "archify") { mode === "layout" ? runArchLayout(v) : runArchPolish(v); }
      else { mode === "layout" ? runLayout(v) : runPolish(v); }
    };
    $("wd-run").addEventListener("click", wdRun);
    $("wd-input").addEventListener("keydown", (e) => { if (e.key === "Enter") wdRun(); });
    $("wd-cancel").addEventListener("click", () => setMode("select"));
    // 확인 다이얼로그는 광역 모드 3종이 공유한다 — 화살촉 일괄이 대기 중이면 그쪽이 우선.
    $("wd-confirm-apply").addEventListener("click", () => {
      if (pendingGlobalHead) { applyGlobalHead(); return; }
      provenance === "archify" ? applyArchLayout() : applyLayout();
    });
    $("wd-confirm-cancel").addEventListener("click", () => { $("wd-confirm").hidden = true; pendingLayoutOps = null; pendingArchLayout = null; pendingGlobalHead = null; });

    // ---------------- D40: 표 삽입 다이얼로그(행/열) ----------------
    //   WHY: 표를 고를 때 캔버스 클릭 전에 행/열을 먼저 정한다 — 확인하면 pendingTable 확정 + 표 그리기 진입,
    //     취소하면 그리기 모드로 들어가지 않는다(요소 스코프 불변식과 무관한 순수 UI 게이트).
    //   COST: 표 삽입에 한 단계 추가. EXIT: 다른 kind에도 사전-옵션이 필요해지면 kind→다이얼로그 매핑으로 일반화.
    const TBL_MIN = 1, TBL_MAX = 20;
    const tblClampVal = (v) => Math.max(TBL_MIN, Math.min(TBL_MAX, Math.round(Number(v)) || TBL_MIN));
    function openTableDialog() {
      if (provenance === "archify") { showToast("archify 다이어그램은 그리기 모드에서 노드를 추가하세요."); return; }
      $("tbl-rows").value = pendingTable.rows;
      $("tbl-cols").value = pendingTable.cols;
      $("tbl-dialog").hidden = false;
      try { $("tbl-rows").focus(); $("tbl-rows").select(); } catch (e) {}
    }
    function closeTableDialog() { $("tbl-dialog").hidden = true; }
    function enterTableDraw() {   // 확인 후에만 호출 — 표 그리기 모드 진입
      setMode("draw");
      drawKind = "table";
      [...document.querySelectorAll("#draw-palette [data-draw]")].forEach((b) => b.classList.toggle("active", b.dataset.draw === "table"));
      postMode();
      showToast("그리기 모드 — 다이어그램의 빈 곳을 클릭해 " + pendingTable.rows + "×" + pendingTable.cols + " 표를 놓으세요.");
    }
    const tblStep = (id, delta) => { const el = $(id); el.value = tblClampVal(Number(el.value) + delta); };
    $("tbl-rows-dec").addEventListener("click", () => tblStep("tbl-rows", -1));
    $("tbl-rows-inc").addEventListener("click", () => tblStep("tbl-rows", +1));
    $("tbl-cols-dec").addEventListener("click", () => tblStep("tbl-cols", -1));
    $("tbl-cols-inc").addEventListener("click", () => tblStep("tbl-cols", +1));
    $("tbl-rows").addEventListener("change", (e) => { e.target.value = tblClampVal(e.target.value); });
    $("tbl-cols").addEventListener("change", (e) => { e.target.value = tblClampVal(e.target.value); });
    $("tbl-cancel").addEventListener("click", closeTableDialog);   // 취소 → 그리기 진입 안 함
    $("tbl-ok").addEventListener("click", () => {
      pendingTable = { rows: tblClampVal($("tbl-rows").value), cols: tblClampVal($("tbl-cols").value) };
      closeTableDialog();
      enterTableDraw();
    });
    $("tbl-dialog").addEventListener("keydown", (e) => {   // Enter=확인 · Escape=취소
      if (e.key === "Enter") { e.preventDefault(); $("tbl-ok").click(); }
      else if (e.key === "Escape") { e.preventDefault(); closeTableDialog(); }
    });

    // 화살촉 크기 일괄 조절 바 (편집 ▾ 하위)
    $("gh-size").addEventListener("input", (e) => { $("gh-sizeval").textContent = parseFloat(e.target.value).toFixed(1) + "×"; });
    $("gh-apply").addEventListener("click", runGlobalHead);
    $("gh-cancel").addEventListener("click", closeGlobalHeadBar);

    // 편집 폼(class a)
    $("af-apply").addEventListener("click", applyArchEditForm);
    $("af-close").addEventListener("click", () => { closeArchEditForm(); clearSelection(); });

    // 그리기 패널(class a): 노드/엣지 하위모드 + 노드 추가
    [...document.querySelectorAll("#arch-draw-panel [data-adsub]")].forEach((b) => b.addEventListener("click", () => setArchDrawSub(b.dataset.adsub)));
    $("ad-add").addEventListener("click", submitArchAddNode);

    // 다듬기 패널
    $("pp-apply").addEventListener("click", () => { provenance === "archify" ? applyArchPolish() : applyPolish(); });
    $("pp-cancel").addEventListener("click", () => { closePolish(); openWdBar("polish"); });
    $("pp-close").addEventListener("click", () => setMode("select"));
    $("pp-selectall").addEventListener("change", (e) => { [...document.querySelectorAll("#pp-list input[type=checkbox]")].forEach((c) => { c.checked = e.target.checked; }); });

    // findings 패널
    $("fp-close").addEventListener("click", () => setMode("select"));

    // ── D21 서식 툴바 ──
    // 도형 항목(fill/stroke/head/flip)은 commitFormat(scope-gate→sanitize→applyOps→bleed-diff→단일 undo)로,
    // 텍스트 항목(B/I/U/S·정렬·크기·글꼴·자간·줄간격·글자색)은 D26 인라인 세션의 pending으로 수렴한다.
    // ★ D26: 텍스트 버튼은 mousedown preventDefault로 오버레이 <input>의 포커스를 안 뺏는다(타이핑 유지).
    ["fmt-bold", "fmt-italic", "fmt-underline", "fmt-strike", "fmt-align-start", "fmt-align-middle", "fmt-align-end", "fmt-size-inc", "fmt-size-dec"]
      .forEach((id) => { const el = $(id); if (el) el.addEventListener("mousedown", (e) => e.preventDefault()); });
    $("fmt-undo").addEventListener("click", undo);
    $("fmt-redo").addEventListener("click", redo);
    $("fmt-bold").addEventListener("click", fmtApplyBold);
    $("fmt-italic").addEventListener("click", fmtApplyItalic);
    $("fmt-underline").addEventListener("click", () => fmtApplyDecor("u"));
    $("fmt-strike").addEventListener("click", () => fmtApplyDecor("s"));
    // D37: 링크 — 즉시 토글이 아니라 URL 값이 필요하므로 prompt로 입력받아 fmtApplyLink(검증+스테이징)로 넘긴다.
    $("fmt-link").addEventListener("click", () => {
      if (!inlineSession) { showToast(FMT_TEXT_GATE_WHY, { ms: 4000 }); return; }
      const url = window.prompt("링크 URL을 입력하세요 (http/https/mailto)", "https://");
      if (url == null) return;   // 취소
      fmtApplyLink(url.trim());
    });
    ["start", "middle", "end"].forEach((a) => $("fmt-align-" + a).addEventListener("click", () => fmtApplyAlign(a)));
    $("fmt-font").addEventListener("change", (e) => fmtApplyFont(e.target.value));
    $("fmt-preset").addEventListener("change", (e) => fmtApplyPreset(e.target.value));
    $("fmt-size").addEventListener("change", (e) => fmtApplySize(e.target.value));
    $("fmt-size").addEventListener("keydown", (e) => { if (e.key === "Enter") fmtApplySize(e.target.value); });
    $("fmt-size-inc").addEventListener("click", () => fmtNudgeSize(1));
    $("fmt-size-dec").addEventListener("click", () => fmtNudgeSize(-1));
    $("fmt-linegap").addEventListener("change", (e) => fmtApplyGap(e.target.value));
    $("fmt-track").addEventListener("change", (e) => fmtApplyTrack(e.target.value));
    $("fmt-head").addEventListener("change", (e) => fmtApplyHead(e.target.value));
    $("fmt-flip").addEventListener("click", fmtApplyFlip);   // D24: CAD 방향 뒤집기(패널의 se-flip과 같은 op)
    $("fmt-front").addEventListener("click", () => { if (!$("fmt-front").disabled) fmtApplyZorder("front"); });   // D34: 앞으로 가져오기
    $("fmt-back").addEventListener("click", () => { if (!$("fmt-back").disabled) fmtApplyZorder("back"); });      // D34: 뒤로 보내기
    $("fmt-textcolor").addEventListener("change", (e) => fmtApplyTextColor(e.target.value));
    $("fmt-fill").addEventListener("change", (e) => fmtApplyFill(e.target.value));
    $("fmt-stroke").addEventListener("change", (e) => fmtApplyStroke(e.target.value));
    // ★ 팝업(#svgbox-panel) 이전: 박스 줄 추가/삭제 + 크기 — 같은 커밋 헬퍼로 수렴.
    $("fmt-line-add").addEventListener("click", () => { if (!$("fmt-line-add").disabled) applyAddLine(); });
    $("fmt-line-del").addEventListener("click", () => {
      if (busy || !selected) return;
      let n = 0;
      if (selected.svgbox) n = (SvgAdapter.styleSnapshot(sourceDoc, selected.eid).lines || []).length;
      else if (unitKind(selected) === "obj") { const info = DomAdapter.objLineInfo(sourceDoc, selected.eid); if (!info.clean) return; n = info.lines; }
      else return;
      if (!n) return;
      let idx = parseInt($("fmt-line-idx").value, 10);
      if (!Number.isInteger(idx) || idx < 1 || idx > n) idx = n;   // 기본 = 마지막 줄
      applyRemoveLine(idx - 1);
    });
    const fmtSizeApply = () => {
      if (busy || !selected || !selected.svgbox) return;
      const w = parseFloat($("fmt-w").value), h = parseFloat($("fmt-h").value);
      if (!(w > 0) || !(h > 0)) { showToast("W/H에 양수를 입력하세요."); return; }
      applySvgResize(selected.eid, { width: w, height: h });
    };
    $("fmt-size-apply").addEventListener("click", fmtSizeApply);
    $("fmt-w").addEventListener("keydown", (e) => { if (e.key === "Enter") fmtSizeApply(); });
    $("fmt-h").addEventListener("keydown", (e) => { if (e.key === "Enter") fmtSizeApply(); });
    // 텍스트 상자 추가 = 기존 그리기 경로로 라우팅(새 삽입 로직을 만들지 않는다).
    $("fmt-textbox").addEventListener("click", () => {
      if (provenance === "archify") { showToast("archify 다이어그램은 그리기 모드에서 노드를 추가하세요."); return; }
      setMode("draw");
      drawKind = "textbox";
      [...document.querySelectorAll("#draw-palette [data-draw]")].forEach((b) => b.classList.toggle("active", b.dataset.draw === "textbox"));
      postMode();
      showToast("그리기 모드 — 다이어그램의 빈 곳을 클릭해 텍스트 상자를 놓으세요.");
    });
    // D36/D40: 표 추가 = 행/열 다이얼로그를 먼저 띄운다(확인 시 그리기 경로 진입 → 캔버스 클릭 즉시 배치).
    $("fmt-table").addEventListener("click", () => { openTableDialog(); });
    // D35: 이미지 추가 — 먼저 파일선택→data URI+실측 크기 계산, 성공하면 그리기 모드(drawKind=image)로 전환.
    //   기존 file-input은 "슬라이드 HTML 열기" 전용이라 재사용하지 않고 별도 hidden input(image-input)을 쓴다.
    $("fmt-image").addEventListener("click", () => {
      if (provenance === "archify") { showToast("archify 다이어그램은 그리기 모드에서 노드를 추가하세요."); return; }
      $("image-input").click();   // change 핸들러가 로드→측정→drawKind=image를 이어받는다
    });
    $("image-input").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";           // 같은 파일 재선택도 change가 다시 뜨도록 초기화
      if (!file) return;             // 파일선택 취소 → 그리기 모드 진입하지 않음
      const reader = new FileReader();
      reader.onload = () => {
        const dataUri = reader.result;
        const probe = new Image();
        probe.onload = () => {
          // 종횡비를 유지하며 최대 변 320px로 스케일한 기본 배치 크기(고정폭이 아니라 실제 비율).
          const MAXDIM = 320;
          const nw = probe.naturalWidth || 1, nh = probe.naturalHeight || 1;
          const s = Math.min(1, MAXDIM / Math.max(nw, nh));
          pendingImage = { src: dataUri, width: Math.max(1, Math.round(nw * s)), height: Math.max(1, Math.round(nh * s)) };
          setMode("draw");
          drawKind = "image";
          [...document.querySelectorAll("#draw-palette [data-draw]")].forEach((b) => b.classList.toggle("active", b.dataset.draw === "image"));
          postMode();
          showToast("그리기 모드 — 다이어그램의 빈 곳을 클릭해 이미지를 놓으세요.");
        };
        probe.onerror = () => { pendingImage = null; showToast("이미지를 읽지 못했습니다 — 다른 파일을 선택하세요.", { ms: 5000 }); };
        probe.src = dataUri;
      };
      reader.onerror = () => { pendingImage = null; showToast("파일을 읽지 못했습니다.", { ms: 5000 }); };
      reader.readAsDataURL(file);
    });
    $("fmt-inspect").addEventListener("click", toggleInspect);
    $("fmt-collapse").addEventListener("click", () => fmtCollapse(true));
    $("fmt-expand").addEventListener("click", () => fmtCollapse(false));

    // 액션 버튼
    $("btn-undo").addEventListener("click", undo);
    $("btn-redo").addEventListener("click", redo);
    $("btn-ink-compare").addEventListener("click", openInkCompare);
    $("ink-close").addEventListener("click", () => { $("ink-panel").hidden = true; });
    $("btn-download").addEventListener("click", download);
    $("btn-open").addEventListener("click", () => $("file-input").click());
    $("file-input").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      loadHtml(await file.text(), file.name);
      e.target.value = "";
    });
    $("btn-settings").addEventListener("click", () => {
      const p = $("settings-panel");
      p.hidden = !p.hidden;
      $("btn-settings").setAttribute("aria-expanded", String(!p.hidden));
      layout();
    });
    $("mock-toggle").addEventListener("change", updateConnStatus);

    // 선택 모드 popover
    $("fi-cancel").addEventListener("click", () => { closePopover(); clearSelection(); });
    $("fi-run").addEventListener("click", () => runEdit($("fi-text").value.trim()));
    $("fi-text").addEventListener("keydown", (e) => { if (e.key === "Enter") runEdit($("fi-text").value.trim()); });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !busy) {
        if (!$("wd-confirm").hidden) { $("wd-confirm").hidden = true; pendingLayoutOps = null; pendingGlobalHead = null; return; }
        // D24: 화살촉 일괄 바가 떠 있으면 그것부터 닫는다(예전엔 드롭다운이 이 자리였다).
        if (!$("gh-bar").hidden) { closeGlobalHeadBar(); updateEditToolsUI(); return; }
        closePopover(); closeDetailPanels(); clearSelection();
        return;
      }
      // D17: Cmd+Z / Ctrl+Z = 되돌리기 단축키 (버튼과 같은 undo() 재사용)
      //   WHY: 편집이 반복 시행착오라 툴바 버튼까지 마우스를 옮기는 왕복이 흐름을 끊는다.
      //        undo()·undoStack은 이미 있으니 키 배선만 하면 되고, 스냅샷 기반이라
      //        class-a/b/c(박스·자유텍스트·div) 어느 편집이든 동일하게 되돌아간다.
      //   COST: 입력 중 텍스트 되돌리기(브라우저 기본 undo)와 충돌할 수 있어 편집 가능한
      //        필드에 포커스가 있으면 우리 핸들러는 양보한다 — 그 경우 다이어그램 undo는
      //        필드 밖을 클릭한 뒤 눌러야 한다. Redo(Shift+Cmd+Z)는 스택이 단방향이라 미지원.
      //   EXIT: redo가 필요해지면 undoStack을 커서형(양방향)으로 바꾸고 여기에 분기 추가.
      //   ★ D21에서 EXIT 실행: 스택을 커서형(양방향)으로 바꾸고 ⇧⌘Z(다시 실행)를 여기 배선했다.
      const undoKey = (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "z" || e.key === "Z");
      if (undoKey) {
        const t = e.target;
        const inField = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
        if (inField || busy) return;          // 입력창 포커스 중엔 브라우저 기본 undo에 양보
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      // D27a/b: Delete/Backspace=삭제, Ctrl/Cmd+C/V=복사/붙여넣기 (부모 포커스 경로 — iframe 경로는 agent.js).
      //   실제로 할 일이 있을 때만 preventDefault(선택/클립보드 없으면 네이티브 동작 양보).
      const kt = e.target;
      const kInField = kt && (kt.tagName === "INPUT" || kt.tagName === "TEXTAREA" || kt.isContentEditable);
      if (!kInField && !busy && mode === "edit" && elementEditOn && provenance !== "archify") {
        const cv = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
        if ((e.key === "Delete" || e.key === "Backspace") && selection.length) { e.preventDefault(); deleteSelection(); return; }
        if (cv && (e.key === "c" || e.key === "C") && selection.length) { e.preventDefault(); copySelection(); return; }
        if (cv && (e.key === "v" || e.key === "V") && clipboard && clipboard.items.length) { e.preventDefault(); pasteClipboard(); return; }
      }
    });
    // 드롭다운 바깥 클릭 닫기 — 이제 검증 ▾ 하나만 남았다(편집 ▾는 D24에서 툴바로 접혀 사라짐).
    document.addEventListener("click", (e) => {
      const dd = e.target.closest(".mode-dd");
      const am = $("audit-menu");
      if (!am.hidden && (!dd || !dd.contains(am))) { am.hidden = true; $("btn-audit").setAttribute("aria-expanded", "false"); }
    });

    window.addEventListener("resize", () => {
      layout();
      if (!busy) { closePopover(); closeDetailPanels(); }
    });

    updateModeUI();
    layout();
    loadDemo();
  }

  // ---------------- test hooks ----------------

  window.__archTest = {
    get ready() { return viewReady && (!!sourceDoc || !!archModel); },
    getSource: () => (sourceDoc ? DomAdapter.serializeRaw(sourceDoc) : null),
    // D33: 잉크 비교 — 결정론적 검증용 직접 훅(다른 fmt* 훅들과 같은 패턴).
    getLastInkCompare: () => lastInkCompare,
    // canvas는 Playwright 경계를 못 건너므로 ink 숫자만 반환(테스트 전용 얇은 래퍼).
    rasterizeUnitTest: async (html, eid) => { const r = await rasterizeUnit(html, eid); return r ? { ink: r.ink } : null; },
    inkBtnDisabled: () => { const b = $("btn-ink-compare"); return b ? b.disabled : null; },
    openInkCompare,
    getClean: () => (sourceDoc ? DomAdapter.serializeClean(sourceDoc) : null),
    getSelected: () => selected,
    undoDepth: () => undoStack.length,
    // ── D27a/b: 삭제 · 복사/붙여넣기 (직접조작 — 실제 경로는 키보드, 이 훅은 결정론적 검증용) ──
    deleteSelection: () => deleteSelection(),
    copySelection: () => copySelection(),
    pasteClipboard: () => pasteClipboard(),
    getClipboard: () => (clipboard ? { count: clipboard.items.length, kinds: clipboard.items.map((i) => i.kind), from: clipboard.from } : null),
    clearClipboard: () => { clipboard = null; },
    // ── D27c: obj 줄 정보(정밀 클릭·추가/삭제·폴백 검증용) ──
    objLineInfo: (eid) => (sourceDoc ? DomAdapter.objLineInfo(sourceDoc, eid) : null),
    objLineCount: (eid) => { const el = sourceDoc && DomAdapter.getByEid(sourceDoc, eid); const l = el ? DomAdapter.objLineDivs(el) : null; return l ? l.length : null; },
    // D28(B): <br> 서브라인까지 센 평탄화 줄 수 + 특정 서브라인 텍스트 읽기(검증용).
    objLineTargetCount: (eid) => { const el = sourceDoc && DomAdapter.getByEid(sourceDoc, eid); const t = el ? DomAdapter.objLineTargets(el) : null; return t ? t.length : null; },
    objLineTextAt: (eid, line) => { const el = sourceDoc && DomAdapter.getByEid(sourceDoc, eid); return el ? DomAdapter.objLineText(el, line) : null; },
    // ── stage 11 (D21 서식 툴바 · D22 다중 선택) ──
    redoDepth: () => redoStack.length,
    redo,
    undo,
    getSelection: () => selection.map((u) => ({ eid: u.eid, kind: u.kind, svgbox: !!u.svgbox, svgtext: !!u.svgtext, svgedge: !!u.svgedge, shape: u.shape || null })),
    // 뷰 클릭 없이 집합을 구성(결정론적 검증용) — 실제 Cmd+클릭과 같은 selectToggle 경로를 탄다.
    selectByEid: (eid, additive) => {
      if (!sourceDoc) return null;
      const el = sourceDoc.querySelector('[data-arch-eid="' + eid + '"]');
      if (!el) return null;
      const isBox = el.getAttribute("data-svgbox") === "1";
      const isTxt = el.getAttribute("data-svgtext") === "1";
      const isEdge = el.getAttribute("data-svgedge") === "1";
      const d = {
        eid, kind: isBox ? "svgbox" : isTxt ? "svgtext" : isEdge ? "svgedge" : (el.getAttribute("data-object-type") || "element"),
        rect: { x: 40, y: 40, w: 120, h: 60 },
        svgbox: isBox, svgtext: isTxt, svgedge: isEdge, shape: el.getAttribute("data-svgbox-shape") || null,
      };
      if (additive) selectToggle(d); else selectOne(d);
      return selection.map((u) => u.eid);
    },
    fmtBarShown: () => { const b = $("fmt-bar"); return b ? !b.hidden : false; },
    fmtCollapsed: () => fmtCollapsed,
    fmtCap: (ctrl) => fmtCap(ctrl),
    fmtCaps: () => {
      const out = {};
      Object.keys(FMT_CTRL_LABEL).forEach((c) => { const r = fmtCap(c); out[c] = { ok: r.ok, why: r.why || null }; });
      return out;
    },
    fmtValues: () => fmtValues(),
    fmtCtrlDisabled: (id) => { const el = $(id); return el ? !!el.disabled : null; },
    // ── D26: 인라인 편집 세션(텍스트 서식 게이트의 출처) ──
    inlineState: () => inlineSession ? { eid: inlineSession.eid, kind: inlineSession.kind, line: inlineSession.line, pendingSvg: { ...inlineSession.pendingSvg }, pendingDom: { ...inlineSession.pendingDom }, pendingGap: inlineSession.pendingGap, pendingHref: inlineSession.pendingHref || null } : null,
    // 세션을 부모 측에서 직접 세팅/해제(게이팅 단위테스트용 — s15는 실제 클릭 경로로 e2e 검증).
    simInlineStart: (eid, kind, line, text) => { if (mode === "edit") { inlineSession = { eid, kind, line: (line != null ? line : null), origText: text || "", pendingSvg: {}, pendingDom: {}, pendingGap: null, previewCss: {} }; updateFmtBar(); } },
    simInlineCancel: () => { inlineSession = null; updateFmtBar(); },
    // 커밋을 실제 경로로 라우팅(obj→applyText / svg→applyInlineCommit) — 메시지 핸들러와 같은 분기.
    simInlineCommit: (text, changed) => { if (!inlineSession) return; const s = inlineSession; if (s.kind === "obj") applyText(s.eid, text, changed); else applyInlineCommit(s.eid, s.kind, s.line, text, changed); },
    fmtSelLabel: () => $("fmt-sel").textContent,
    typeScale: () => (sourceDoc ? SvgAdapter.typeScale(sourceDoc) : null),
    // 툴바 버튼과 같은 커밋 경로(집합 scope-gate → sanitize → bleed-diff → 단일 undo)
    fmtBold: fmtApplyBold,
    fmtItalic: fmtApplyItalic,
    fmtDecor: fmtApplyDecor,
    fmtLink: fmtApplyLink,          // D37: 링크(prompt 우회 — 테스트가 URL을 직접 넘겨 검증)
    fmtAlign: fmtApplyAlign,
    fmtFont: fmtApplyFont,
    fmtSize: fmtApplySize,
    fmtPreset: fmtApplyPreset,
    fmtTrack: fmtApplyTrack,
    fmtGap: fmtApplyGap,
    fmtTextColor: fmtApplyTextColor,
    fmtFill: fmtApplyFill,
    fmtStroke: fmtApplyStroke,
    fmtHead: fmtApplyHead,
    fmtFlip: fmtApplyFlip,          // D24: 툴바 방향 뒤집기(집합 경로)
    // ── D34: 겹침 순서(z-order) ──
    fmtZorder: (dir) => fmtApplyZorder(dir),
    zorderCap: () => zorderCap(),
    zorderBtn: (which) => { const el = $(which === "front" ? "fmt-front" : "fmt-back"); return el ? { disabled: !!el.disabled, why: el.getAttribute("data-why"), title: el.title, text: (el.textContent || "").replace(/\s+/g, " ").trim(), inFmtBar: !!el.closest("#fmt-bar") } : null; },
    objZIndex: (eid) => (sourceDoc ? DomAdapter.objZIndex(sourceDoc, eid) : null),
    // class-c 유닛의 형제(element) 순서 인덱스 — 클수록 뒤 형제 = 위에 그려짐(paint 순서 검증용).
    svgSiblingIndex: (eid) => {
      if (!sourceDoc) return null;
      const el = sourceDoc.querySelector('[data-arch-eid="' + eid + '"]');
      if (!el || !el.parentNode) return null;
      let i = 0, n = el.parentNode.firstElementChild;
      while (n) { if (n === el) return i; i++; n = n.nextElementSibling; }
      return -1;
    },
    // 겹침 구성용(테스트): 실제 이동 op(applySvgMove→commitSvgOps: scope/bleed/undo 정규 경로)으로
    //   유닛을 지정 SVG 좌표로 옮겨 겹침을 만든다. 뷰 드래그 없이 결정론적 — selectByEid와 같은 취지.
    simSvgMove: (eid, x, y) => { if (sourceDoc) applySvgMove(eid, x, y); },
    svgTranslate: (eid) => {
      if (!sourceDoc) return null;
      const g = sourceDoc.querySelector('[data-arch-eid="' + eid + '"]');
      const m = g && /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(g.getAttribute("transform") || "");
      return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
    },
    fmtCollapse,
    // D24: 툴바가 지금 보이는가 / 화살표 행이 무엇을 말하고 있는가
    fmtBarVisible: () => fmtBarVisible(),
    fmtEdgeHint: () => { const h = $("fmt-edge-hint"); return h ? h.textContent : null; },
    fmtSelEmpty: () => { const b = $("fmt-sel"); return b ? b.classList.contains("empty") : null; },
    editToolButtons: () => [...document.querySelectorAll("#edit-menu [data-editsub]")].map((b) => ({
      sub: b.dataset.editsub, disabled: !!b.disabled, on: b.classList.contains("on"),
      text: (b.textContent || "").replace(/\s+/g, " ").trim(),
      tag: (() => { const t = b.querySelector(".dd-tag"); return t ? t.className : null; })(),
      inFmtBar: !!b.closest("#fmt-bar"),
    })),
    // ── D25a/c: 요소 편집 토글 · 노드/화살표 focus ──
    getElementEditOn: () => elementEditOn,
    setElementEditOn: (on) => setElementEditOn(on),
    getEditFocus: () => editFocus,
    setEditFocus: (f) => setEditFocus(f),
    isFocusGroupVisible: () => { const s = $("edit-focus"); return s ? !s.hidden : false; },
    focusButtons: () => [...document.querySelectorAll("#edit-focus [data-focus]")].map((b) => ({
      focus: b.dataset.focus, on: b.classList.contains("on"),
      text: (b.textContent || "").replace(/\s+/g, " ").trim(),
      inFmtBar: !!b.closest("#fmt-bar"),
    })),
    // D25d: '전체 적용'(화살촉 일괄) 3행 컨트롤의 위치·가시성·게이팅
    headAllBtn: () => { const b = $("fmt-head-all"); return b ? { visible: !b.hidden, disabled: !!b.disabled, inArrowRow: !!b.closest("#fmt-arrow-row"), inFmtBar: !!b.closest("#fmt-bar"), text: (b.textContent || "").replace(/\s+/g, " ").trim() } : null; },
    runGlobalHeadFromRow,
    // D25b: 인라인 커밋을 직접 호출(뷰 입력 없이 결정론적 검증). 실제 경로는 뷰의 오버레이 <input>.
    applyInlineCommit: (eid, kind, line, text, changed) => applyInlineCommit(eid, kind, line, text, changed),
    // ── 팝업 폐지 + 박스 툴바 컨트롤(2026-07-21) ──
    // 선택해도 플로팅 상세 팝업이 안 뜬다(툴바가 유일 표면).
    // ★ 팝업 DOM을 삭제했으므로 null-safe: 요소가 없으면 "안 열림"(false).
    detailPanelsOpen: () => {
      const open = (id) => { const el = $(id); return el ? !el.hidden : false; };
      return { svgbox: open("svgbox-panel"), svgtext: open("svgtext-panel"), svgedge: open("svgedge-panel"), edit: open("edit-panel") };
    },
    anyDetailPanelOpen: () => ["svgbox-panel", "svgtext-panel", "svgedge-panel", "edit-panel"].some((id) => { const el = $(id); return el ? !el.hidden : false; }),
    boxTools: () => ({
      lineboxVisible: !$("fmt-linebox").hidden, sizeboxVisible: !$("fmt-sizebox").hidden,
      lineAddDisabled: !!$("fmt-line-add").disabled, lineDelDisabled: !!$("fmt-line-del").disabled,
      sizeApplyDisabled: !!$("fmt-size-apply").disabled,
      w: $("fmt-w").value, h: $("fmt-h").value, lineIdx: $("fmt-line-idx").value,
      inFmtBar: !!$("fmt-linebox").closest("#fmt-bar"), inArrowRow: !!$("fmt-linebox").closest("#fmt-arrow-row"),
    }),
    fmtAddLine: () => $("fmt-line-add").click(),
    fmtRemoveLine: (idx1) => { if (idx1 != null) $("fmt-line-idx").value = String(idx1); $("fmt-line-del").click(); },
    fmtResize: (w, h) => { $("fmt-w").value = String(w); $("fmt-h").value = String(h); $("fmt-size-apply").click(); },
    // 배치 커밋을 직접 호출(집합 밖 eid를 넣어 ScopeViolation을 확인하는 용도)
    commitFormatRaw: (ops, label) => {
      try { return commitFormat(ops, label || "테스트"); }
      catch (e) { return { ok: false, error: e.message, name: e.name }; }
    },
    sanitizeBatchRaw: (ops, eids) => {
      try { return { ok: true, ...sanitizeBatch(ops, new Set(eids)) }; }
      catch (e) { return { ok: false, name: e.name, error: e.message }; }
    },
    batchSchema: (eids) => SvgAdapter.buildToolSchema(new Set(eids), (e) => (sourceDoc ? SvgAdapter.shapeOf(sourceDoc, e) : null)),
    isMock: () => $("mock-toggle").checked,
    getScale: () => scale,
    // ── class c (SVG 박스) ──
    getSvgBoxes: () => (sourceDoc ? [...sourceDoc.querySelectorAll('[data-svgbox="1"]')].map((g) => ({ eid: g.getAttribute("data-arch-eid"), shape: g.getAttribute("data-svgbox-shape") })) : []),
    // D16(b): 자유 <text> 단위 목록(svgtext:N)
    getSvgTexts: () => (sourceDoc ? [...sourceDoc.querySelectorAll('[data-svgtext="1"]')].map((t) => ({ eid: t.getAttribute("data-arch-eid"), text: (t.textContent || "").replace(/\s+/g, " ").trim() })) : []),
    // D18: 화살표 단위 목록(svgedge:N) — 정점열·화살촉 배율·marker 참조 포함
    getSvgEdges: () => (sourceDoc ? [...sourceDoc.querySelectorAll('[data-svgedge="1"]')].map((e) => {
      const eid = e.getAttribute("data-arch-eid");
      const s = SvgAdapter.edgeSnapshot(sourceDoc, eid);
      return { eid, tag: s.tag, points: s.points, vertexCount: s.vertexCount, editable: s.editable, markerEnd: s.markerEnd, headScale: s.headScale };
    }) : []),
    svgEdgeSnapshot: (eid) => (sourceDoc ? SvgAdapter.edgeSnapshot(sourceDoc, eid) : null),
    // marker 인벤토리(공유 marker 불변 + 클론 증식 없음 검증용)
    getSvgMarkers: () => (sourceDoc ? [...sourceDoc.querySelectorAll("marker")].map((m) => ({
      id: m.getAttribute("id"), clone: m.getAttribute("data-arch-edge-clone") || null,
      markerWidth: m.getAttribute("markerWidth"), markerHeight: m.getAttribute("markerHeight"),
      refX: m.getAttribute("refX"), refY: m.getAttribute("refY"), outerHTML: m.outerHTML,
    })) : []),
    svgSnapshot: (eid) => (sourceDoc ? SvgAdapter.styleSnapshot(sourceDoc, eid) : null),
    // ── stage 10: 줄 추가/삭제 (패널 버튼과 같은 커밋 경로) ──
    addSvgLine: (eid, text, afterIndex) => {
      const op = { op: "addTextLine", eid };
      if (text != null) op.text = text;
      if (afterIndex != null) op.afterIndex = afterIndex;
      return commitSvgOps([op], eid, { reselectEid: eid });
    },
    removeSvgLine: (eid, line) => commitSvgOps([{ op: "removeTextLine", eid, line }], eid, { reselectEid: eid }),
    svgShapeBox: (eid) => (sourceDoc ? SvgAdapter.shapeBoxOf(SvgAdapter.getBox(sourceDoc, eid)) : null),
    // ── stage 10: 화살촉 크기 일괄 조절 (문서 전체) ──
    markerInventory: () => (sourceDoc ? SvgAdapter.markerInventory(sourceDoc) : null),
    openGlobalHeadBar,
    runGlobalHead: (scale) => { if (scale != null) $("gh-size").value = String(scale); runGlobalHead(); },
    applyGlobalHead,
    getPendingGlobalHead: () => (pendingGlobalHead ? { ...pendingGlobalHead } : null),
    // D24: "편집 메뉴가 열렸다"의 의미가 바뀌었다 — 드롭다운이 없어졌으므로
    // **편집 도구 그룹이 (상단 툴바 안에서) 보이는가**로 재정의한다. 계약의 뜻
    // ("편집을 누르면 하위 도구가 보인다")은 그대로고, 그것이 실현되는 표면만 바뀌었다.
    isEditMenuOpen: () => isEditToolsOpen(),
    isEditToolsOpen: () => isEditToolsOpen(),
    isAuditMenuOpen: () => !$("audit-menu").hidden,
    isGlobalHeadBarOpen: () => !$("gh-bar").hidden,
    svgSanitize: (raw, eid) => SvgAdapter.sanitizeOps(raw, eid, sourceDoc ? SvgAdapter.shapeOf(sourceDoc, eid) : "rect"),
    svgSchema: (eid) => SvgAdapter.buildToolSchema(eid, sourceDoc ? SvgAdapter.shapeOf(sourceDoc, eid) : "rect"),
    // 결정론적 전체 파이프라인(sanitize→apply→bleed-diff→commit) — 드래그 없이 op으로 검증.
    applySvgManual: (rawOps, eid) => { const r = commitSvgOps(rawOps, eid, { reselectEid: eid }); if (r.ok) { pendingFlash = { eid }; } return r; },
    // stage 4 (class a 통합):
    getProvenance: () => provenance,
    getServeAvailable: () => serveAvailable,
    getArchHtml: () => (archModel ? archModel.html : null),
    getArchModel: () => (archModel ? { type: archModel.type, source: archModel.source } : null),
    load: (html, name) => loadHtml(html, name || "loaded.html"),
    isModeDisabled: (m) => { const b = document.querySelector('.mode[data-mode="' + m + '"]'); return b ? b.disabled : null; },
    bannerShown: () => { const el = $("serve-banner"); return el ? !el.hidden : false; },
    probeServe,
    archMockOps,
    // stage 3:
    getMode: () => mode,
    setMode,
    setDrawKind: (k) => { drawKind = k; [...document.querySelectorAll("#draw-palette [data-draw]")].forEach((b) => b.classList.toggle("active", b.dataset.draw === k)); postMode(); },
    getFindings: () => findings.slice(),
    runAudit,
    collectBoxes,
    mechanicalAudit,
    getPendingLayout: () => (pendingLayoutOps ? { count: pendingLayoutOps.allowed.length, eids: pendingLayoutOps.allowed.slice() } : null),
    getPolishRows: () => (pendingPolish ? pendingPolish.rows.map((r) => ({ eid: r.eid, before: r.before, after: r.after })) : null),
    // 필드 잠금 단위 검사용
    sanitizeLayout: (raw, eids) => DomAdapter.sanitizeLayoutOps(raw, eids),
    sanitizePolish: (raw, eids) => DomAdapter.sanitizePolishOps(raw, eids),
    // ── stage 5 (class-a 5모드) ──
    setArchDrawSub,
    getArchDrawSub: () => archDrawSub,
    getArchEdgeSource: () => archEdgeSource,
    // 편집: 폼 UI를 거치지 않고 같은 커밋 코어로 필드 변경(결정론적 검증용)
    archManualEdit: async (id, kind, fields) => {
      if (!archModel) return { ok: false, error: "no model" };
      const ref = ArchifyJsonAdapter.resolveHit(archModel, { id, kind });
      if (!ref) return { ok: false, error: "no ref for " + id };
      const res = await archEditCommit(ref, fields);
      if (res.ok) { pendingFlash = { id: ref.id }; render(); }
      return res;
    },
    openArchEditFormById: (id, kind) => {
      const ref = ArchifyJsonAdapter.resolveHit(archModel, { id, kind });
      if (!ref) return false;
      openArchEditForm({ id: ref.id, kind: ref.kind, part: null, rect: { x: 120, y: 120, w: 140, h: 60 } });
      return true;
    },
    getArchEditRef: () => (archEditRef ? { id: archEditRef.id, kind: archEditRef.kind } : null),
    // 그리기
    archAddNode: (spec) => runArchAddNode(spec),
    archAddEdge: (from, to) => runArchAddEdge(from, to),
    // 검증
    runArchAudit,
    fixArchFinding: (f) => fixArchFinding(f, null),
    // 레이아웃 / 다듬기: 크래프트된 ops로 전체 파이프라인(sanitize→apply→render→verify→commit)
    archLayoutOps: async (rawOps) => {
      if (!archModel) return { ok: false, error: "no model" };
      const raw = Array.isArray(rawOps) ? { ops: rawOps } : rawOps;
      const inv = ArchifyJsonAdapter.layoutInventory(archModel);
      const ids = [...inv.nodes.map((n) => n.id), ...inv.edges.map((e) => e.id)];
      const { ops, notes } = ArchifyJsonAdapter.sanitizeLayoutOps(raw, ids);
      if (!ops.length) return { ok: false, error: "no ops after field-lock", notes };
      const r = await archApplyFieldOps(ops, "layout"); return { ...r, notes };
    },
    archPolishOps: async (rawOps) => {
      if (!archModel) return { ok: false, error: "no model" };
      const raw = Array.isArray(rawOps) ? { ops: rawOps } : rawOps;
      const inv = ArchifyJsonAdapter.textInventory(archModel);
      const ids = inv.map((e) => e.arch_id);
      const { ops, notes } = ArchifyJsonAdapter.sanitizePolishOps(raw, ids);
      if (!ops.length) return { ok: false, error: "no ops after field-lock", notes };
      const r = await archApplyFieldOps(ops, "polish"); return { ...r, notes };
    },
    sanitizeArchLayout: (raw, ids) => ArchifyJsonAdapter.sanitizeLayoutOps(raw, ids),
    sanitizeArchPolish: (raw, ids) => ArchifyJsonAdapter.sanitizePolishOps(raw, ids),
    archTextInventory: () => (archModel ? ArchifyJsonAdapter.textInventory(archModel) : null),
    archLayoutInventory: () => (archModel ? ArchifyJsonAdapter.layoutInventory(archModel) : null),
    getPendingArchLayout: () => (pendingArchLayout ? { count: pendingArchLayout.allowed.length, ids: pendingArchLayout.allowed.slice() } : null),
    getArchPolishRows: () => (pendingArchPolish ? pendingArchPolish.rows.map((r) => ({ eid: r.eid, before: r.before, after: r.after })) : null),
    getArchSource: () => (archModel ? JSON.stringify(archModel.source) : null),
  };

  document.addEventListener("DOMContentLoaded", init);
  return { undo, download };
})();
