// Stage 12 — D24 툴바 재편: (1) 편집 ▾ 드롭다운을 서식 툴바 아이콘 버튼으로 접기,
// (2) 서식 툴바를 "선택하면 뜨는 하단 플로팅" → "편집을 누르면 뜨는 상단 부착"으로,
// (3) ★화살표 CAD 도구(방향 뒤집기·꼭짓점 어포던스)를 툴바에 노출 — 발견성 회귀 수정.
//
// 회귀의 정체(이 세션에서 실측 재현): D21 이후 화살표를 고르면 큰 서식 바가 뜨는데 거기
// 노출된 화살표 항목은 **화살촉 하나뿐**이었다. 방향 뒤집기와 직접조작 어포던스는
// #svgedge-panel(다이어그램 위에 겹쳐 뜨는 작은 카드)에만 남아 사용자가 보는 자리에서
// 사라졌다. 기능은 죽지 않았다(s9 75checks 그대로 통과) — **발견성만** 죽었다.
// 따라서 이 스테이지는 "기능이 있는가"가 아니라 "**사용자가 보는 표면에 있는가**"를 잰다.
//
// 검증 대상:
//   (A) 툴바 생명주기·배치: 편집 클릭 → 선택 없이도 뜬다. 상단 부착. **높이 불변**(리플로우 0,
//       scale=1 유지 — s9/s10의 좌표 전제를 깨지 않는다는 것이 계약).
//   (B) 편집 도구 = 구 드롭다운 두 항목. 아이콘 버튼이 되었고 "전체" 스코프 예고가 살아 있다.
//       확인 게이트 → 문서 전체 적용(개별 클론 포함) → **Cmd+Z 한 번** 복원.
//   (C) 화살표: 실제 클릭 선택 → 툴바에 뒤집기 버튼 + 어포던스 힌트, 선 위엔 꼭짓점·중간점
//       핸들. 뒤집기가 **기하를 실제로 반전**시키고 화살촉이 반대 끝으로 간다.
//   (D) 무회귀 도달성: 세 패널(box/text/edge)은 여전히 열리고 고유 기능도 그대로다
//       ("툴바로 옮겼으니 패널은 없앤다"가 아니다 — 사용자의 신고가 바로 그 상실이었다).
//
// 원칙(s6/s9/s10/s11과 동일): bleed-diff는 앱 로직을 재사용하지 않고 테스트가 독립
// DOMParser로 재구현한다. "됐다"는 주장은 속성만이 아니라 렌더/좌표 실측으로 뒷받침한다.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8626;
const BASE = `http://127.0.0.1:${PORT}`;
const ART = path.join(APP_DIR, "test", "artifacts");
fs.mkdirSync(ART, { recursive: true });
const SVG_HTML = fs.readFileSync(path.join(APP_DIR, "demo_svg_slide.html"), "utf8");
const DOM_HTML = fs.readFileSync(path.join(APP_DIR, "p01_report_snapshot.html"), "utf8");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "  — " + extra : "")); }
}

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: APP_DIR, stdio: "ignore" });
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { const r = await fetch(BASE + "/index.html"); up = r.ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 200)); }
if (!up) { console.error("http.server가 뜨지 않음"); server.kill(); process.exit(1); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 2120, height: 1420 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));

const frame = () => page.frameLocator("#diagram-frame");
const vf = () => page.frames().find((f) => f !== page.mainFrame());
const src = () => page.evaluate(() => window.__archTest.getSource());
const depth = () => page.evaluate(() => window.__archTest.undoDepth());
const settle = (ms) => page.waitForTimeout(ms == null ? 380 : ms);
const eq = (p, x, y) => Math.abs(p.x - x) < 0.6 && Math.abs(p.y - y) < 0.6;

async function loadSvg() {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await page.evaluate(async (h) => { await window.__archTest.load(h, "svg.html"); }, SVG_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
  await settle(280);
  return await src();
}
async function setMode(m) {
  await page.evaluate((mm) => window.__archTest.setMode(mm), m);
  await settle(280);
}

// 툴바 상태 한 번에 — 화면에 무엇이 보이고 무엇이 켜져 있는가.
const barState = () => page.evaluate(() => {
  const bar = document.getElementById("fmt-bar");
  const dis = (id) => { const e = document.getElementById(id); return e ? !!e.disabled : null; };
  return {
    visible: bar ? !bar.hidden : null,
    height: bar && !bar.hidden ? Math.round(bar.getBoundingClientRect().height) : 0,
    top: bar && !bar.hidden ? Math.round(bar.getBoundingClientRect().top) : null,
    bottom: bar && !bar.hidden ? Math.round(bar.getBoundingClientRect().bottom) : null,
    scale: window.__archTest.getScale(),
    mode: window.__archTest.getMode(),
    selLabel: window.__archTest.fmtSelLabel(),
    selEmpty: window.__archTest.fmtSelEmpty(),
    editToolsOpen: window.__archTest.isEditMenuOpen(),
    ariaExpanded: document.getElementById("btn-edit").getAttribute("aria-expanded"),
    edgeHint: window.__archTest.fmtEdgeHint(),
    d: { flip: dis("fmt-flip"), head: dis("fmt-head"), bold: dis("fmt-bold"), size: dis("fmt-size"), textcolor: dis("fmt-textcolor"), fill: dis("fmt-fill"), undo: dis("fmt-undo") },
    tools: window.__archTest.editToolButtons(),
  };
});

// ── 독립 bleed-diff (화살촉 marker 클론 화이트리스트 포함) — s9와 동일 정의를 재구현 ──
const bleedClean = (a, b, eid) => page.evaluate(([ha, hb, e]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  const A = P(ha), B = P(hb);
  const mk = (doc) => new Map([...doc.querySelectorAll("marker")].map((m) => [m.getAttribute("id"), m]));
  const mA = mk(A), mB = mk(B);
  const suf = "--" + e.replace(/:/g, "-");
  const owned = new Set();
  [...mA, ...mB].forEach(([id, el]) => {
    if (id.length <= suf.length || id.slice(-suf.length) !== suf) return;
    if (!mA.has(id.slice(0, -suf.length))) return;
    if (el.getAttribute("data-arch-edge-clone") !== e) return;
    owned.add(id);
  });
  const added = [...mB.keys()].filter((k) => !mA.has(k));
  const changed = new Set(added);
  mA.forEach((el, id) => { const o = mB.get(id); if (!o || o.outerHTML !== el.outerHTML) changed.add(id); });
  const markerOffenders = [...changed].filter((id) => !owned.has(id));
  owned.forEach((id) => { if (mA.get(id)) mA.get(id).remove(); if (mB.get(id)) mB.get(id).remove(); });
  const unitA = A.querySelector('[data-arch-eid="' + e + '"]');
  const offenders = [];
  A.querySelectorAll("[data-arch-eid]").forEach((el) => {
    const k = el.getAttribute("data-arch-eid");
    if (k === e) return;
    if (unitA && el.contains(unitA)) return;
    const elB = B.querySelector('[data-arch-eid="' + k + '"]');
    if (!elB || el.outerHTML !== elB.outerHTML) offenders.push(k);
  });
  const mask = (doc) => { const el = doc.querySelector('[data-arch-eid="' + e + '"]'); if (el) el.replaceWith(doc.createElement("arch-mask-test")); return doc.documentElement.outerHTML; };
  const maskedEqual = mask(A) === mask(B);
  return { ok: maskedEqual && !offenders.length && !markerOffenders.length, maskedEqual, offenders, markerOffenders, addedMarkers: added };
}, [a, b, eid]);

const edgeRaw = (html, eid) => page.evaluate(([h, e]) => {
  const el = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]');
  if (!el) return null;
  const at = {};
  [...el.attributes].forEach((a) => { at[a.name] = a.value; });
  return { tag: el.tagName.toLowerCase(), attrs: at };
}, [html, eid]);

// 뷰 프레임에서 화살표 정점을 iframe 클라이언트 좌표로 투영(실측 — 스케일 가정 없음).
const edgeClient = (eid) => vf().evaluate((e) => {
  const el = document.querySelector('[data-arch-eid="' + e + '"]');
  if (!el) return null;
  const svg = el.ownerSVGElement, ctm = el.getScreenCTM();
  const tag = el.tagName.toLowerCase();
  let pts;
  if (tag === "line") pts = [{ x: +el.getAttribute("x1"), y: +el.getAttribute("y1") }, { x: +el.getAttribute("x2"), y: +el.getAttribute("y2") }];
  else pts = [...el.getAttribute("d").matchAll(/[ML]\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
  return pts.map((p) => { const q = svg.createSVGPoint(); q.x = p.x; q.y = p.y; const r = q.matrixTransform(ctm); return { x: r.x, y: r.y }; });
}, eid);

// 문서 전체 화살촉 크기의 독립 측정 — marker 자식 <g transform="scale(s)">의 s를 직접 읽는다
// (D18의 실패 교훈: markerWidth만 보면 "촉이 커졌다"를 오판한다 — 내용 스케일이 진짜 신호).
const markerScales = (html) => page.evaluate((h) => {
  const d = new DOMParser().parseFromString(h, "text/html");
  return [...d.querySelectorAll("marker")].map((m) => {
    const g = m.querySelector("g[transform]");
    const mt = g && /scale\(\s*([\d.]+)/.exec(g.getAttribute("transform") || "");
    return { id: m.getAttribute("id"), clone: m.getAttribute("data-arch-edge-clone") || null, scale: mt ? +mt[1] : 1 };
  });
}, html);

try {
  // ══════════════ (A) 툴바 생명주기 · 상단 부착 · 높이 불변 ══════════════
  let A0 = await loadSvg();
  const s0 = await barState();
  check("(A1) 초기(선택 모드·선택 없음)에는 툴바가 숨김 — 기존 계약 무회귀", s0.visible === false, JSON.stringify(s0));
  check("(A1b) 그때 편집 버튼 aria-expanded=false", s0.ariaExpanded === "false", s0.ariaExpanded);

  // ★ 요청 2의 핵심: 선택 없이 편집만 눌러도 툴바가 나온다.
  await page.click("#btn-edit");
  await settle(450);
  const s1 = await barState();
  check("(A2) ★편집 클릭 → 선택이 없어도 서식 툴바가 뜬다", s1.visible === true, JSON.stringify(s1));
  check("(A3) 편집 클릭이 요소 편집 모드에도 그대로 진입(근육 기억 보존)", s1.mode === "edit", s1.mode);
  check("(A3b) 편집 버튼 aria-expanded=true", s1.ariaExpanded === "true", s1.ariaExpanded);
  check("(A4) 선택 없음 상태를 배지가 명시한다('요소를 선택하세요')",
    s1.selEmpty === true && /요소를 선택하세요/.test(s1.selLabel), JSON.stringify({ e: s1.selEmpty, l: s1.selLabel }));
  check("(A5) 선택 없음 → 서식 항목이 전부 비활성",
    s1.d.bold && s1.d.size && s1.d.textcolor && s1.d.fill && s1.d.head && s1.d.flip, JSON.stringify(s1.d));
  check("(A5b) 그래도 실행취소·편집도구는 선택과 무관하게 살아 있다(문서 레벨 동작)",
    s1.tools.every((t) => !t.disabled), JSON.stringify(s1.tools.map((t) => [t.sub, t.disabled])));
  await page.screenshot({ path: path.join(ART, "s12_toolbar_no_selection.png"), clip: { x: 0, y: 0, width: 2120, height: 210 } });

  // 상단 부착 — 모드 툴바 아래, 스테이지 위.
  const geo = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
    const t = r("#topbar"), b = r("#fmt-bar"), st = r("#stage-wrap");
    return { topbarBottom: Math.round(t.bottom), barTop: Math.round(b.top), barBottom: Math.round(b.bottom), stageTop: Math.round(st.top) };
  });
  check("(A6) ★상단 부착: 툴바가 모드 툴바 바로 아래에 붙어 있다",
    Math.abs(geo.barTop - geo.topbarBottom) <= 2, JSON.stringify(geo));
  check("(A6b) 스테이지를 덮지 않고 밀어낸다(부착 = normal flow)",
    geo.stageTop >= geo.barBottom - 1, JSON.stringify(geo));

  // 옛 드롭다운이 실제로 없어졌는가 — 존재/형태/표기 3중 확인.
  const gone = await page.evaluate(() => {
    const em = document.getElementById("edit-menu"), be = document.getElementById("btn-edit");
    return {
      ddMenus: [...document.querySelectorAll(".dd-menu")].map((e) => e.id),
      editMenuIsDropdown: em ? em.classList.contains("dd-menu") : null,
      editMenuInFmtBar: em ? !!em.closest("#fmt-bar") : null,
      btnEditInModeDd: be ? !!be.closest(".mode-dd") : null,
      btnEditHasPopup: be ? be.getAttribute("aria-haspopup") : null,
      btnEditText: be ? be.textContent.trim() : null,
    };
  });
  check("(A7) ★편집 ▾ 드롭다운이 사라졌다(남은 .dd-menu는 콘텐츠 검증 하나뿐)",
    gone.ddMenus.length === 1 && gone.ddMenus[0] === "audit-menu", JSON.stringify(gone.ddMenus));
  check("(A7b) 편집 도구 그룹은 이제 서식 툴바 안에 있고 드롭다운이 아니다",
    gone.editMenuInFmtBar === true && gone.editMenuIsDropdown === false, JSON.stringify(gone));
  check("(A7c) 편집 버튼은 평범한 모드 버튼(팝업 아님 · '▾' 표기 없음)",
    gone.btnEditInModeDd === false && !gone.btnEditHasPopup && !/▾/.test(gone.btnEditText), JSON.stringify(gone));

  // ★ 높이 불변 — 선택 종류가 바뀌어도 리플로우가 없어야 한다(클릭 좌표·scale 전제).
  const boxes = await page.evaluate(() => window.__archTest.getSvgBoxes());
  const texts = await page.evaluate(() => window.__archTest.getSvgTexts());
  const edgesAll = await page.evaluate(() => window.__archTest.getSvgEdges());
  const heights = [];
  for (const eid of [boxes[2].eid, texts[0].eid, edgesAll[0].eid]) {
    await page.evaluate((e) => window.__archTest.selectByEid(e, false), eid);
    await settle(220);
    const st = await barState();
    heights.push({ eid, h: st.height, scale: st.scale });
  }
  await page.evaluate(([a, b]) => { window.__archTest.selectByEid(a, false); window.__archTest.selectByEid(b, true); }, [boxes[2].eid, boxes[3].eid]);
  await settle(220);
  const multiSt = await barState();
  heights.push({ eid: "multi", h: multiSt.height, scale: multiSt.scale });
  check("(A8) ★툴바 높이가 선택 종류·개수와 무관하게 불변(리플로우 0)",
    new Set(heights.map((x) => x.h)).size === 1 && heights[0].h > 0, JSON.stringify(heights));
  check("(A8b) ★scale=1 유지 — 상단 부착이 기존 좌표 전제를 깨지 않는다",
    heights.every((x) => x.scale === 1) && s1.scale === 1, JSON.stringify(heights.map((x) => x.scale)));

  // 접기/펼치기 · 광역 모드 정리 — 기존 계약 무회귀
  await page.evaluate(() => window.__archTest.fmtCollapse(true));
  await settle(200);
  const col = await page.evaluate(() => ({ bar: window.__archTest.fmtBarShown(), c: window.__archTest.fmtCollapsed(), rows: document.getElementById("fmt-rows").hidden }));
  check("(A9) 접기: 바는 남고 행은 접힘(무회귀)", col.bar && col.c && col.rows, JSON.stringify(col));
  await page.evaluate(() => window.__archTest.fmtCollapse(false));
  await settle(200);
  check("(A9b) 펼치기 복귀", !(await page.evaluate(() => document.getElementById("fmt-rows").hidden)));
  await setMode("layout");
  check("(A10) 광역 모드로 가면 툴바가 사라진다(무회귀)", (await barState()).visible === false);
  await setMode("select");
  check("(A10b) 선택 모드 · 선택 없음 → 다시 숨김(선택 모드 계약은 그대로)", (await barState()).visible === false);

  // ══════════════ (B) 편집 도구 = 구 드롭다운 두 항목 ══════════════
  A0 = await loadSvg();
  await page.click("#btn-edit");
  await settle(420);
  const tools = (await barState()).tools;
  // ★ D25a/d 계약 변경: 1행 #edit-menu엔 '요소 편집'(D25a ON/OFF 토글)만 남는다 — 화살촉 일괄(globalhead)은
  //   D25d로 3행 '전체 적용'(#fmt-head-all)으로 이전됐다. 아래는 그 새 구조를 반영한다(구: 2항목 → 신: 1항목).
  check("(B1) ★1행 편집 도구 = 요소 편집 토글 하나(화살촉 일괄은 3행 이전)",
    tools.length === 1 && tools[0].sub === "element" && /요소 편집/.test(tools[0].text), JSON.stringify(tools));
  check("(B1b) 요소 편집 항목이 서식 툴바 안에 있다", tools.every((t) => t.inFmtBar), JSON.stringify(tools.map((t) => t.inFmtBar)));
  const icons = await page.evaluate(() => [...document.querySelectorAll("#edit-menu [data-editsub]")].map((b) => !!b.querySelector("svg")));
  check("(B2) ★요소 편집 항목이 아이콘 버튼(인라인 svg 보유)", icons.length === 1 && icons.every(Boolean), JSON.stringify(icons));
  // ★ '전체' 태그(스코프 예고, D19 안전장치)는 화살촉 일괄과 함께 3행 #fmt-head-all로 옮겨갔다 — 거기서 검사.
  check("(B3) ★3행 '전체 적용'이 '전체' 태그로 스코프를 예고(D19의 안전장치 보존)",
    /\ball\b/.test(await page.$eval("#fmt-head-all .dd-tag", (e) => e.className)));
  check("(B3b) 요소 편집 항목은 '기본' 태그", /\bmech\b/.test(tools[0].tag || ""), tools[0].tag);
  check("(B3c) 3행 '전체 적용' title이 '문서 전체'와 '실행 취소'를 명시",
    await page.evaluate(() => { const t = document.getElementById("fmt-head-all").title; return /전체/.test(t) && /실행 취소/.test(t); }));

  // (a) 화살촉 일괄 트리거는 3행 '전체 적용'(#fmt-head-all) — ★ D25d로 이전. 화살표 편집 focus에서만.
  await page.evaluate(() => window.__archTest.setEditFocus("arrow"));
  await settle(250);
  await page.click("#fmt-head-all");
  await settle(300);
  check("(B4) 3행 '전체 적용' → 일괄 조절 바 표시 + 화살표 focus 활성",
    (await page.evaluate(() => window.__archTest.isGlobalHeadBarOpen()))
    && (await page.evaluate(() => window.__archTest.getEditFocus())) === "arrow");
  // ★ D25c: 화살표 도구를 벗어나면(전체 focus) 문맥 이탈로 일괄 바가 닫힌다. 요소 편집(D25a 토글)은 계속 ON.
  await page.evaluate(() => window.__archTest.setEditFocus("all"));
  await settle(300);
  const afterEl = await barState();
  check("(B5) 전체 focus 복귀 → 일괄 바 닫힘 · 요소 편집 기본 항목 켜짐(ON)",
    afterEl.mode === "edit" && !(await page.evaluate(() => window.__archTest.isGlobalHeadBarOpen()))
    && afterEl.tools[0].on === true, JSON.stringify({ m: afterEl.mode, on: afterEl.tools.map((t) => t.on) }));
  // 요소 편집이 실제로 되는지(무회귀)
  const rectEid = boxes.find((b) => b.shape === "rect").eid;
  await frame().locator('[data-arch-eid="' + rectEid + '"]').click();
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, rectEid, { timeout: 5000 });
  // ★ 팝업 폐지(2026-07-21): 박스 선택 시 상세 팝업은 안 뜨고 툴바(줄/크기/색)가 반영한다.
  check("(B5b) 기본 경로에서 박스 선택 + 툴바 반영(상세 팝업 없음)",
    (await page.evaluate(() => window.__archTest.getSelected())).eid === rectEid
    && (await page.evaluate(() => window.__archTest.boxTools().lineboxVisible)) === true
    && !(await page.evaluate(() => window.__archTest.anyDetailPanelOpen())));
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await settle(250);

  // (b) 화살촉 일괄 — 확인 게이트 → 문서 전체 → 단일 undo
  // 먼저 화살표 하나에 개별 조정을 걸어 "클론까지 통일되는가"를 검사 가능한 상태로 만든다(D19).
  const probeEdge = edgesAll.find((e) => e.editable).eid;
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), probeEdge);
  await settle(220);
  await page.evaluate(() => window.__archTest.fmtHead(2.5));
  await settle(500);
  const withClone = await src();
  const clonesBefore = (await markerScales(withClone)).filter((m) => m.clone);
  check("(B6) 준비: 개별 조정으로 전용 marker 클론이 1개 생겼다",
    clonesBefore.length === 1 && Math.abs(clonesBefore[0].scale - 2.5) < 0.01, JSON.stringify(clonesBefore));
  const depthBeforeGH = await depth();

  // ★ D25d: 화살촉 일괄 트리거는 3행 '전체 적용'(#fmt-head-all). 화살표 focus에서 클릭 → 같은 D19 바.
  await page.evaluate(() => window.__archTest.setEditFocus("arrow"));
  await settle(200);
  await page.click("#fmt-head-all");
  await settle(300);
  await page.evaluate(() => { const el = document.getElementById("gh-size"); el.value = "3"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  check("(B7) 슬라이더 라벨 동기화", (await page.textContent("#gh-sizeval")) === "3.0×");
  await page.click("#gh-apply");
  await page.waitForSelector("#wd-confirm:not([hidden])", { timeout: 5000 });
  check("(B8) ★확인 게이트 — 적용 전엔 소스 무변형",
    (await src()) === withClone && (await depth()) === depthBeforeGH);
  check("(B8b) 확인 문구가 '문서 전체'와 개별 덮어쓰기를 고지",
    await page.evaluate(() => { const t = document.getElementById("wd-confirm-text").textContent; return /문서 전체/.test(t) && /개별/.test(t); }));
  await page.click("#wd-confirm-apply");
  await settle(700);
  const afterGH = await src();
  const scalesAfter = await markerScales(afterGH);
  check("(B9) ★문서 전체의 모든 화살촉이 3.0×로 통일(공유 marker)",
    scalesAfter.filter((m) => !m.clone).every((m) => Math.abs(m.scale - 3) < 0.01), JSON.stringify(scalesAfter.filter((m) => !m.clone)));
  check("(B9b) ★개별 조정된 클론(2.5×)도 같은 3.0×로 덮어쓴다(D19의 '일괄'의 뜻)",
    scalesAfter.filter((m) => m.clone).every((m) => Math.abs(m.scale - 3) < 0.01), JSON.stringify(scalesAfter.filter((m) => m.clone)));
  check("(B10) ★일괄 적용은 undo 스냅샷을 딱 1개만 쌓는다", (await depth()) === depthBeforeGH + 1, "depth=" + (await depth()));
  await page.keyboard.press("Meta+z");
  await settle(650);
  check("(B11) ★Cmd+Z 한 번으로 전체 복원(바이트 동일)", (await src()) === withClone, "depth=" + (await depth()));

  // ══════════════ (C) ★화살표 CAD 도구가 툴바에 노출되는가(회귀 수정 본체) ══════════════
  A0 = await loadSvg();
  await setMode("edit");
  // 실제 사용자 경로로 선택한다 — 선 위를 마우스로 클릭(테스트 훅 우회 금지).
  const multi = (await page.evaluate(() => window.__archTest.getSvgEdges()))
    .filter((e) => e.editable && e.points && e.points.length >= 3)[0];
  const fb = await page.locator("#diagram-frame").boundingBox();
  const cpts = await edgeClient(multi.eid);
  const seg0 = { x: fb.x + (cpts[0].x + cpts[1].x) / 2, y: fb.y + (cpts[0].y + cpts[1].y) / 2 };
  await page.mouse.click(seg0.x, seg0.y);
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return !!(s && s.eid === e && s.svgedge); }, multi.eid, { timeout: 6000 });
  await settle(500);
  const arrowSt = await barState();
  check("(C1) ★화살표를 선 위 클릭으로 선택 → 툴바 '방향 뒤집기'가 활성",
    arrowSt.d.flip === false, JSON.stringify(arrowSt.d));
  check("(C1b) 화살촉 크기도 같은 행에서 활성", arrowSt.d.head === false, String(arrowSt.d.head));
  check("(C1c) 글자 계열은 화살표에 없으므로 비활성(교집합 규칙 무회귀)",
    arrowSt.d.bold === true && arrowSt.d.textcolor === true, JSON.stringify(arrowSt.d));
  const flipVis = await page.evaluate(() => {
    const b = document.getElementById("fmt-flip");
    const r = b.getBoundingClientRect();
    return { visible: r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== "hidden", text: b.textContent.trim(), top: Math.round(r.top) };
  });
  check("(C2) ★뒤집기 버튼이 화면에 실제로 보인다(라벨 포함)",
    flipVis.visible && /방향 뒤집기/.test(flipVis.text), JSON.stringify(flipVis));
  check("(C3) ★직접조작 어포던스가 툴바에 전부 적혀 있다(드래그·중간점·Shift·Alt(Option)+클릭·더블클릭)",
    ["드래그", "중간점", "Shift", "Alt(Option)+클릭", "더블클릭"].every((k) => (arrowSt.edgeHint || "").includes(k)), arrowSt.edgeHint);
  check("(C3b) 힌트가 실제 꼭짓점 수를 보고한다",
    (arrowSt.edgeHint || "").includes("꼭짓점 " + multi.vertexCount + "개"), arrowSt.edgeHint);

  // 핸들은 s9의 계약 그대로 선 위에 남아 있어야 한다.
  let vh = 0, mh = 0;
  for (let i = 0; i < 40; i++) {
    vh = await frame().locator('[data-arch-overlay="vhandle"]:visible').count();
    mh = await frame().locator('[data-arch-overlay="midhandle"]:visible').count();
    if (vh === multi.vertexCount) break;
    await settle(100);
  }
  check("(C4) ★꼭짓점 핸들이 선 위에 그대로 보인다(s9 계약 유지)", vh === multi.vertexCount, "vh=" + vh + " expect=" + multi.vertexCount);
  check("(C4b) ★중간점 핸들도 보인다(꼭짓점 추가 어포던스)", mh === multi.vertexCount - 1, "mh=" + mh);
  // ★ 팝업 폐지(2026-07-21): #svgedge-panel은 더는 안 뜬다(방향/화살촉은 툴바 row3로 통합).
  //   중요한 건 어포던스가 사라지지 않았다는 것 — 꼭짓점 핸들(위 C4)과 툴바 도구가 그대로 살아 있다.
  check("(C5) ★#svgedge-panel은 안 뜨고(팝업 폐지) 꼭짓점 핸들·툴바 도구는 그대로",
    (await page.evaluate(() => window.__archTest.detailPanelsOpen().svgedge)) === false
    && (await page.evaluate(() => window.__archTest.anyDetailPanelOpen())) === false);
  await page.screenshot({ path: path.join(ART, "s12_arrow_selected_full.png") });

  // ── 뒤집기: 기하가 실제로 반전되고 화살촉이 반대 끝으로 ──
  const before = (await page.evaluate(() => window.__archTest.getSvgEdges())).find((e) => e.eid === multi.eid);
  const rawBefore = await edgeRaw(A0, multi.eid);
  const d0 = await depth();
  await page.click("#fmt-flip");
  await page.waitForFunction((n) => window.__archTest.undoDepth() === n, d0 + 1, { timeout: 6000 });
  await settle(450);
  const S1 = await src();
  const after = (await page.evaluate(() => window.__archTest.getSvgEdges())).find((e) => e.eid === multi.eid);
  check("(C6) ★툴바 뒤집기 → 정점 순서가 실제로 반전",
    JSON.stringify(after.points) === JSON.stringify(before.points.slice().reverse()),
    JSON.stringify({ before: before.points, after: after.points }));
  const rawAfter = await edgeRaw(S1, multi.eid);
  check("(C7) ★화살촉이 반대 끝으로(끝점 = 원래 시작점, marker-end 속성은 불변)",
    eq(after.points[after.points.length - 1], before.points[0].x, before.points[0].y)
    && rawAfter.attrs["marker-end"] === rawBefore.attrs["marker-end"],
    JSON.stringify({ end: after.points[after.points.length - 1], was: before.points[0], marker: rawAfter.attrs["marker-end"] }));
  check("(C7b) 선 속성(stroke/stroke-width) 보존",
    rawAfter.attrs.stroke === rawBefore.attrs.stroke && rawAfter.attrs["stroke-width"] === rawBefore.attrs["stroke-width"]);
  const bl = await bleedClean(A0, S1, multi.eid);
  check("(C8) ★bleed-diff: 그 화살표만 변경(집합 밖 바이트 동일 · marker 추가 0)",
    bl.ok && bl.addedMarkers.length === 0, JSON.stringify(bl));
  await page.screenshot({ path: path.join(ART, "s12_arrow_after_flip.png") });
  await page.keyboard.press("Meta+z");
  await settle(650);
  check("(C9) ★Cmd+Z가 툴바 뒤집기를 바이트 동일 복원", (await src()) === A0, "depth=" + (await depth()));

  // 툴바 화살촉 크기 — 같은 행에서 실제로 먹는가
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), multi.eid);
  await settle(250);
  await page.evaluate(() => window.__archTest.fmtHead(2.2));
  await settle(600);
  const headAfter = (await page.evaluate(() => window.__archTest.getSvgEdges())).find((e) => e.eid === multi.eid);
  check("(C10) ★툴바 화살촉 크기가 실제로 적용(2.2×)", Math.abs(headAfter.headScale - 2.2) < 0.01, String(headAfter.headScale));
  const clones = (await markerScales(await src())).filter((m) => m.clone === multi.eid);
  check("(C10b) 그 화살표 전용 marker 클론으로만 반영(공유 marker 불변)",
    clones.length === 1 && Math.abs(clones[0].scale - 2.2) < 0.01, JSON.stringify(clones));
  await page.keyboard.press("Meta+z");
  await settle(600);

  // 화살표가 아닐 때 — 비활성 + 사유
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), boxes[2].eid);
  await settle(280);
  const boxSt = await barState();
  const flipWhy = await page.evaluate(() => window.__archTest.fmtCap("flip"));
  check("(C11) 박스 선택 시 뒤집기는 비활성", boxSt.d.flip === true, String(boxSt.d.flip));
  check("(C11b) 비활성 사유가 '어디에 쓰는 항목인지'를 지목(D23 규칙)",
    !flipWhy.ok && /화살표/.test(flipWhy.why || ""), flipWhy.why);
  check("(C11c) 힌트가 화살표를 고르라고 안내한다", /화살표/.test(boxSt.edgeHint || ""), boxSt.edgeHint);
  const insp = await page.evaluate(() => { document.getElementById("fmt-inspect").click(); return document.getElementById("fmt-inspect-panel").innerText; });
  check("(C11d) ⓘ 선택 정보에도 뒤집기 비활성 사유가 실린다", /방향 뒤집기/.test(insp), insp.slice(0, 140));
  await page.evaluate(() => document.getElementById("fmt-inspect").click());
  await page.screenshot({ path: path.join(ART, "s12_box_selected.png"), clip: { x: 0, y: 0, width: 2120, height: 210 } });

  // 다중 화살표 일괄 뒤집기 — D22 집합 불변식이 새 버튼에도 성립하는가
  A0 = await loadSvg();
  await setMode("edit");
  const e2 = (await page.evaluate(() => window.__archTest.getSvgEdges())).filter((e) => e.editable).slice(0, 2);
  await page.evaluate(([a, b]) => { window.__archTest.selectByEid(a, false); window.__archTest.selectByEid(b, true); }, [e2[0].eid, e2[1].eid]);
  await settle(280);
  const d1 = await depth();
  await page.click("#fmt-flip");
  await settle(700);
  const after2 = await page.evaluate(() => window.__archTest.getSvgEdges());
  check("(C12) 화살표 2개 동시 선택 → 한 번에 둘 다 뒤집힘",
    e2.every((e) => { const a = after2.find((x) => x.eid === e.eid); return JSON.stringify(a.points) === JSON.stringify(e.points.slice().reverse()); }),
    JSON.stringify(e2.map((e) => e.eid)));
  check("(C12b) 그 배치가 undo 스냅샷을 1개만 쌓는다(집합 단위 단일 undo)", (await depth()) === d1 + 1, "depth=" + (await depth()));
  await page.keyboard.press("Meta+z");
  await settle(650);
  check("(C12c) Cmd+Z 한 번으로 둘 다 복원(바이트 동일)", (await src()) === A0);

  // ══════════════ (D) ★계약 뒤집힘(2026-07-21): 팝업 폐지 → 기능이 전부 툴바로 이전됐다 ══════════════
  // ★ 사용자 요청: "위에 툴바가 있는데 팝업이 왜 필요함 — 팝업 기능 이전 후 팝업 없애".
  //   구 (D)는 "세 패널이 여전히 열린다(툴바와 공존)"를 증명했지만, 이제 계약이 반대다:
  //   선택해도 플로팅 상세 팝업은 안 뜨고, 그 기능(박스 줄·크기 · 자유텍스트 색 · 화살표 방향/화살촉)이
  //   전부 툴바로 이전됐음을 증명한다. 검사 수(D1~D4)는 유지하되 의미를 새 계약으로 재작성.
  A0 = await loadSvg();
  await setMode("edit");
  await frame().locator('[data-arch-eid="' + rectEid + '"]').click();
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, rectEid, { timeout: 5000 });
  const boxTools = await page.evaluate(() => window.__archTest.boxTools());
  check("(D1) 박스 선택: 팝업 없이 툴바에 줄 추가/삭제·크기(W/H)가 있다",
    !(await page.evaluate(() => window.__archTest.anyDetailPanelOpen()))
    && boxTools.lineboxVisible && boxTools.sizeboxVisible && boxTools.inFmtBar, JSON.stringify(boxTools));
  await page.evaluate(() => window.__archTest.setMode("edit")); await settle(250);

  await frame().locator('[data-arch-eid="' + texts[0].eid + '"]').click();
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, texts[0].eid, { timeout: 5000 });
  // D26: 글자색은 툴바에 있지만 텍스트 서브그룹이라 **선택만으론 비활성**(인라인 편집 세션에서만 활성).
  const d2sel = await page.evaluate(() => window.__archTest.fmtCap("textcolor").ok);
  const d2inline = await page.evaluate((e) => { window.__archTest.simInlineStart(e, "svgtext", null, ""); const ok = window.__archTest.fmtCap("textcolor").ok; window.__archTest.simInlineCancel(); return ok; }, texts[0].eid);
  check("(D2) 자유 텍스트: 팝업 없이 글자색이 툴바에 있다(선택만으론 인라인 게이트로 비활성, 인라인 편집 중 활성)",
    !(await page.evaluate(() => window.__archTest.anyDetailPanelOpen())) && d2sel === false && d2inline === true,
    `sel=${d2sel} inline=${d2inline}`);
  await page.evaluate(() => window.__archTest.setMode("edit")); await settle(250);

  const fb2 = await page.locator("#diagram-frame").boundingBox();
  const cp2 = await edgeClient(multi.eid);
  await page.mouse.click(fb2.x + (cp2[0].x + cp2[1].x) / 2, fb2.y + (cp2[0].y + cp2[1].y) / 2);
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e && s.svgedge; }, multi.eid, { timeout: 6000 });
  check("(D3) ★화살표 선택: 팝업 없이 방향 뒤집기·화살촉이 툴바(row3)에 살아 있다",
    !(await page.evaluate(() => window.__archTest.anyDetailPanelOpen()))
    && (await page.evaluate(() => window.__archTest.fmtCap("flip").ok)) === true
    && (await page.evaluate(() => window.__archTest.fmtCap("head").ok)) === true);
  // 툴바 뒤집기가 실제로 기하를 반전 — 팝업 없이도 같은 op으로 동작한다.
  const beforeP = (await page.evaluate(() => window.__archTest.getSvgEdges())).find((e) => e.eid === multi.eid);
  await page.evaluate(() => window.__archTest.fmtFlip());
  await settle(600);
  const afterP = (await page.evaluate(() => window.__archTest.getSvgEdges())).find((e) => e.eid === multi.eid);
  check("(D4) 툴바 방향 뒤집기가 기하를 반전(팝업 없이 같은 op으로 수렴)",
    JSON.stringify(afterP.points) === JSON.stringify(beforeP.points.slice().reverse()));
  await page.keyboard.press("Meta+z");
  await settle(600);

  // class-b(div 슬라이드) 무회귀 — 툴바가 여기서도 편집 모드에 뜬다
  await page.evaluate(async (h) => { await window.__archTest.load(h, "p01.html"); }, DOM_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
  await settle(400);
  await setMode("edit");
  const bState = await barState();
  check("(D5) class-b(div 슬라이드)에서도 편집 모드에 툴바가 뜬다", bState.visible === true, JSON.stringify(bState));
  check("(D5b) class-b에서 화살표 항목은 비활성(SVG 화살표가 없다)", bState.d.flip === true && bState.d.head === true);

  check("(E1) 콘솔 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (e) {
  fail++;
  console.log("FAIL  (예외) " + (e && e.stack ? e.stack : e));
}

console.log("\n=== s12 (D24 툴바 재편) : " + pass + " pass / " + fail + " fail ===");
await browser.close();
server.kill();
process.exit(fail ? 1 : 0);
