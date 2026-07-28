// Stage 14 (D25a–D25d) — 블록 편집 / 텍스트 편집 이분화 + 노드·화살표 전용 도구 (mock, 키 불필요).
//
// 검증 대상:
//   (A) D25a 요소 편집 = ON/OFF 토글. 편집 진입 시 기본 ON(오늘 동작 보존). OFF로 끄면 클릭이
//       드래그·리사이즈·패널을 arm하지 않는다(소스 무변형). 다시 ON → 오늘 동작 정확히 복원.
//   (B) D25b OFF에서 텍스트 단일클릭 인라인 편집. svgbox는 **클릭한 줄**(줄 단위 hit-test)만,
//       svgtext는 그 자체, obj(class-b)는 contenteditable 승격. 커밋 = 그 대상만(bleed 청결) + undo 복원.
//       Escape는 무커밋 취소. 인라인 편집기 위치 ≈ 그 줄의 렌더 bbox.
//   (C) D25c 노드/화살표 focus. 노드 focus: 박스 위를 지나는 화살표를 절대 안 잡고 그 아래 노드를 잡는다.
//       화살표 focus: **오늘 baseline이 놓치는 클릭점**(선에서 14px)을 실제로 잡는다(측정된 개선).
//   (D) D25d 화살촉 일괄('전체 적용')이 3행(화살표 도구 행)으로 이전. 1행 #edit-menu엔 없음.
//       확인 게이트·개별 클론 통일·단일 undo(D19) 전부 그대로.
//   (E) 다중 선택은 블록 개념 → OFF에선 Cmd+클릭 무시(단일 인라인 편집만).
//   (F) 무회귀 슬라이스: 기본 ON에서 박스 패널·화살표 선택이 오늘처럼 동작.
//
// bleed-diff는 앱 로직을 재사용하지 않고 테스트가 독립 DOMParser 비교로 실증한다(순환 방지).
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
const P01_HTML = fs.readFileSync(path.join(APP_DIR, "p01_report_snapshot.html"), "utf8");

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
const ctx = await browser.newContext({ viewport: { width: 2120, height: 1420 }, acceptDownloads: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));

const frame = () => page.frameLocator("#diagram-frame");
const vf = () => page.frames().find((f) => f !== page.mainFrame());
const src = () => page.evaluate(() => window.__archTest.getSource());
const depth = () => page.evaluate(() => window.__archTest.undoDepth());
const sel = () => page.evaluate(() => window.__archTest.getSelected());
async function stageBox() { return await page.locator("#stage").boundingBox(); }

// 독립 bleed-diff: 선택 eid 하나(+그 조상)만 바뀌고 나머지 [data-arch-eid]는 outerHTML 동일.
const bleedClean = (a, b, eid) => page.evaluate(([ha, hb, e]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  const A = P(ha), B = P(hb);
  const unitA = A.querySelector('[data-arch-eid="' + e + '"]');
  const offenders = [];
  A.querySelectorAll("[data-arch-eid]").forEach((el) => {
    const k = el.getAttribute("data-arch-eid");
    if (k === e) return;
    if (unitA && el.contains(unitA)) return;              // 조상(바깥 svg) — 마스크가 커버
    const elB = B.querySelector('[data-arch-eid="' + k + '"]');
    if (!elB || el.outerHTML !== elB.outerHTML) offenders.push(k);
  });
  const mask = (doc) => { const el = doc.querySelector('[data-arch-eid="' + e + '"]'); if (el) el.replaceWith(doc.createElement("m-mask")); return doc.documentElement.outerHTML; };
  const maskedEqual = mask(A) === mask(B);
  return { ok: maskedEqual && !offenders.length, maskedEqual, offenders };
}, [a, b, eid]);

// 박스 <g>의 줄(<text> 직속) 텍스트 배열을 소스에서 직접 읽기(앱 코드 미사용).
const boxLines = (html, eid) => page.evaluate(([h, e]) => {
  const g = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]');
  if (!g) return null;
  return [...g.children].filter((c) => c.tagName.toLowerCase() === "text").map((t) => (t.textContent || "").replace(/\s+/g, " ").trim());
}, [html, eid]);

async function loadSvg() {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await page.evaluate(async (h) => { await window.__archTest.load(h, "svg.html"); }, SVG_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
  await page.waitForTimeout(250);
  return await src();
}
async function loadP01() {
  await page.evaluate(async (h) => { await window.__archTest.load(h, "p01.html"); }, P01_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
  await page.waitForTimeout(250);
  return await src();
}
async function enterEdit() { await page.evaluate(() => window.__archTest.setMode("edit")); await page.waitForTimeout(200); }
async function setOn(v) { await page.evaluate((x) => window.__archTest.setElementEditOn(x), v); await page.waitForTimeout(220); }
async function setFocus(f) { await page.evaluate((x) => window.__archTest.setEditFocus(x), f); await page.waitForTimeout(220); }
async function undoAll() { while ((await depth()) > 0) { await page.click("#btn-undo"); await page.waitForTimeout(120); } }
// 화면좌표: 박스/줄/화살표의 iframe bbox + stage offset
async function lineClientOfBox(eid, lineIdx) {
  return await vf().evaluate(([e, i]) => {
    const g = document.querySelector('[data-arch-eid="' + e + '"]');
    const ts = [...g.children].filter((c) => c.tagName.toLowerCase() === "text");
    const r = ts[i].getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, left: r.left, top: r.top, w: r.width, h: r.height };
  }, [eid, lineIdx]);
}
const inlineInputBox = () => vf().evaluate(() => { const i = document.querySelector('[data-arch-overlay="inline"]'); if (!i) return null; const r = i.getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height, val: i.value }; });

try {
  const A0 = await loadSvg();
  check("(setup) scale=1 · provenance=dom", (await page.evaluate(() => window.__archTest.getScale())) === 1
    && (await page.evaluate(() => window.__archTest.getProvenance())) === "dom");

  // ============================================================
  // (A) D25a — 요소 편집 ON/OFF 토글
  // ============================================================
  await enterEdit();
  check("(A1) 편집 모드 진입 → 요소 편집 기본 ON", (await page.evaluate(() => window.__archTest.getElementEditOn())) === true);
  check("(A1b) ON에서 3-way focus 그룹 노출 + 요소편집 버튼 켜짐",
    (await page.evaluate(() => window.__archTest.isFocusGroupVisible())) === true
    && (await page.evaluate(() => window.__archTest.editToolButtons()[0].on)) === true);
  check("(A1c) focus 기본값 = 전체(all)", (await page.evaluate(() => window.__archTest.getEditFocus())) === "all"
    && (await page.evaluate(() => window.__archTest.focusButtons().find((b) => b.focus === "all").on)) === true);

  const boxes = await page.evaluate(() => window.__archTest.getSvgBoxes());
  const rectEid = boxes.find((b) => b.shape === "rect").eid;

  // ON: 박스 클릭 → 선택 + moveOverlay (오늘 동작) · ★팝업 폐지(2026-07-21) → 플로팅 패널은 안 뜨고 툴바가 반영
  await frame().locator('[data-arch-eid="' + rectEid + '"]').click();
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, rectEid, { timeout: 5000 });
  check("(A2 ON) 박스 클릭 → 선택됨 + 상세 팝업 안 뜸(툴바가 표면)", (await sel()).eid === rectEid && !(await page.evaluate(() => window.__archTest.anyDetailPanelOpen())));
  check("(A2b ON) 이동 오버레이(블록 크롬)가 뜬다", (await frame().locator('[data-arch-overlay="move"]:visible').count()) === 1);
  check("(A2c ON) 박스 선택 시 툴바에 줄·크기 컨트롤 노출(팝업 이전)", await page.evaluate(() => { const b = window.__archTest.boxTools(); return b.lineboxVisible && b.sizeboxVisible && b.inFmtBar; }));
  await page.evaluate(() => window.__archTest.setMode("edit"));   // 선택 해제(구 #sp-done 대체)
  await page.waitForTimeout(150);

  // OFF: 클릭이 드래그·리사이즈·패널을 arm하지 않는다
  const beforeOff = await src();
  await setOn(false);
  check("(A3) OFF 전환 → getElementEditOn=false · focus 그룹 숨김",
    (await page.evaluate(() => window.__archTest.getElementEditOn())) === false
    && (await page.evaluate(() => window.__archTest.isFocusGroupVisible())) === false);
  check("(A3b) OFF 전환은 소스 무변형", (await src()) === beforeOff);
  // 박스의 rect 여백(텍스트 아닌 곳)을 클릭 → 패널/크롬/선택이 전부 없어야 한다
  const padPt = await vf().evaluate((e) => { const r = document.querySelector('[data-arch-eid="' + e + '"]').getBoundingClientRect(); return { x: r.left + 6, y: r.top + 5 }; }, rectEid);
  let sbA = await stageBox();
  await page.mouse.click(sbA.x + padPt.x, sbA.y + padPt.y);
  await page.waitForTimeout(300);
  check("(A4 OFF) 박스 여백 클릭 → 패널 안 열림", await page.isHidden("#svgbox-panel"));
  check("(A4b OFF) 이동 오버레이/핸들 안 뜸", (await frame().locator('[data-arch-overlay="move"]:visible').count()) === 0
    && (await frame().locator('[data-arch-overlay="handle"]:visible').count()) === 0);
  check("(A4c OFF) 선택 없음(블록 선택 arm 안 됨)", !(await sel()));
  check("(A4d OFF) 여백 클릭은 소스 무변형(no-op)", (await src()) === beforeOff);

  // 다시 ON → 오늘 동작 정확히 복원 (팝업은 여전히 안 뜨고 툴바가 표면)
  await setOn(true);
  await frame().locator('[data-arch-eid="' + rectEid + '"]').click();
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, rectEid, { timeout: 5000 });
  check("(A5 ON복원) 박스 클릭 → 선택 재개 + moveOverlay + 팝업 없음",
    (await sel()).eid === rectEid && (await frame().locator('[data-arch-overlay="move"]:visible').count()) === 1 && !(await page.evaluate(() => window.__archTest.anyDetailPanelOpen())));
  await page.evaluate(() => window.__archTest.setMode("edit"));

  // ============================================================
  // (B) D25b — OFF 인라인 텍스트 편집
  // ============================================================
  await loadSvg();
  await enterEdit();
  await setOn(false);

  // 3줄 박스 찾기
  const box3 = await page.evaluate((h) => {
    const d = new DOMParser().parseFromString(h, "text/html");
    for (const g of d.querySelectorAll('[data-svgbox="1"]')) {
      const ts = [...g.children].filter((c) => c.tagName.toLowerCase() === "text");
      if (ts.length === 3) return g.getAttribute("data-arch-eid");
    }
    return null;
  }, A0);
  check("(B0) 3줄 svgbox 확보", !!box3, "eid=" + box3);
  const B0src = await src();
  const linesBefore = await boxLines(B0src, box3);

  // 2번째 줄(index 1) 클릭 → 인라인 입력 등장
  let sb = await stageBox();
  let lb = await lineClientOfBox(box3, 1);
  await page.mouse.click(sb.x + lb.cx, sb.y + lb.cy);
  await page.waitForTimeout(300);
  const inp = await inlineInputBox();
  check("(B1) 줄 2 클릭 → 인라인 입력 등장 + 그 줄 텍스트를 담음", !!inp && inp.val === linesBefore[1], JSON.stringify(inp));
  // 위치 ≈ 그 줄의 렌더 bbox (±8px)
  check("(B1b) 인라인 입력 위치 ≈ 그 줄의 렌더 bbox", inp && Math.abs(inp.left - lb.left) <= 8 && Math.abs(inp.top - lb.top) <= 8,
    inp ? `dx=${(inp.left - lb.left).toFixed(1)} dy=${(inp.top - lb.top).toFixed(1)}` : "no input");
  await page.screenshot({ path: path.join(ART, "s14_inline_open_line2.png"), clip: { x: sb.x + lb.left - 80, y: sb.y + lb.top - 60, width: 420, height: 160 } });

  // 타이핑 + Enter 커밋
  await frame().locator('[data-arch-overlay="inline"]').fill("둘째줄 새 내용");
  await frame().locator('[data-arch-overlay="inline"]').press("Enter");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  await page.waitForTimeout(200);
  const B1src = await src();
  const linesAfter = await boxLines(B1src, box3);
  check("(B2) 커밋: 줄 2만 바뀜(줄 1·3 불변)",
    linesAfter[0] === linesBefore[0] && linesAfter[1] === "둘째줄 새 내용" && linesAfter[2] === linesBefore[2], JSON.stringify(linesAfter));
  const bd1 = await bleedClean(B0src, B1src, box3);
  check("(B2b) bleed-diff 청결: 그 박스 외 모든 단위 바이트 동일", bd1.ok, JSON.stringify(bd1.offenders));
  check("(B2c) 반영: iframe에 새 텍스트 노출", await frame().locator("text=둘째줄 새 내용").first().isVisible());
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });
  check("(B3) undo가 소스를 바이트 동일 복원", (await src()) === B0src);

  // Escape는 무커밋 취소
  sb = await stageBox(); lb = await lineClientOfBox(box3, 0);
  await page.mouse.click(sb.x + lb.cx, sb.y + lb.cy);
  await page.waitForTimeout(250);
  await frame().locator('[data-arch-overlay="inline"]').fill("버려질 편집");
  await frame().locator('[data-arch-overlay="inline"]').press("Escape");
  await page.waitForTimeout(250);
  check("(B4 Escape) 무커밋 취소: undo 스택 0 + 소스 무변형",
    (await depth()) === 0 && (await src()) === B0src);
  check("(B4b Escape) 인라인 입력 제거됨", (await frame().locator('[data-arch-overlay="inline"]').count()) === 0);

  // svgtext(자유 텍스트) 단일클릭 인라인 편집
  const txtEid = await page.evaluate(() => (window.__archTest.getSvgTexts()[0] || {}).eid);
  const txtSrc0 = await src();
  const tbox = await vf().evaluate((e) => { const t = document.querySelector('[data-arch-eid="' + e + '"]'); const r = t.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, txtEid);
  sb = await stageBox();
  await page.mouse.click(sb.x + tbox.cx, sb.y + tbox.cy);
  await page.waitForTimeout(300);
  check("(B5 svgtext) 자유 텍스트 클릭 → 인라인 입력 등장", (await frame().locator('[data-arch-overlay="inline"]').count()) === 1);
  await frame().locator('[data-arch-overlay="inline"]').fill("자유텍스트-수정");
  await frame().locator('[data-arch-overlay="inline"]').press("Enter");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  await page.waitForTimeout(150);
  const txtSrc1 = await src();
  const bdT = await bleedClean(txtSrc0, txtSrc1, txtEid);
  check("(B5b svgtext) 그 텍스트만 변경 + bleed 청결", txtSrc1.includes("자유텍스트-수정") && bdT.ok, JSON.stringify(bdT.offenders));
  await undoAll();

  // 비-텍스트(빈 도형 여백) 클릭 = no-op
  const emptySrc = await src();
  const padPt2 = await vf().evaluate((e) => { const r = document.querySelector('[data-arch-eid="' + e + '"]').getBoundingClientRect(); return { x: r.left + 5, y: r.top + 4 }; }, rectEid);
  sb = await stageBox();
  await page.mouse.click(sb.x + padPt2.x, sb.y + padPt2.y);
  await page.waitForTimeout(250);
  check("(B6 no-op) 텍스트 아닌 곳 클릭 → 입력 없음 + 소스 무변형",
    (await frame().locator('[data-arch-overlay="inline"]').count()) === 0 && (await src()) === emptySrc && (await depth()) === 0);

  // obj(class-b div) — dblclick→단일클릭 승격 (p01)
  const P0 = await loadP01();
  await enterEdit();
  await setOn(false);
  const objTarget = frame().locator("div[data-arch-eid]").filter({ hasText: "질문 / 그래프" }).first();
  const objId = await objTarget.getAttribute("data-arch-eid");
  const objBox = await objTarget.boundingBox();
  await page.mouse.click(objBox.x + objBox.width / 2, objBox.y + objBox.height / 2);
  await page.waitForTimeout(300);
  const ceCount = await frame().locator('[contenteditable="true"]').count();
  check("(B7 obj) class-b div 단일클릭 → contenteditable 승격(더블클릭 아님)", ceCount >= 1, "ce=" + ceCount);
  await page.keyboard.press("Control+A");
  await page.keyboard.type("결과 확인-편집");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 }).catch(() => {});
  const P1 = await src();
  const bdObj = await bleedClean(P0, P1, objId);
  check("(B7b obj) 커밋 + 그 obj만 변경(bleed 청결)", P1.includes("결과 확인-편집") && bdObj.ok, JSON.stringify(bdObj.offenders));
  await undoAll();
  check("(B7c obj) undo 복원", (await src()) === P0);

  // ============================================================
  // (C) D25c — 노드 / 화살표 focus
  // ============================================================
  const C0 = await loadSvg();
  await enterEdit();
  sb = await stageBox();
  const edges = await page.evaluate(() => window.__archTest.getSvgEdges());
  const lineEid = (edges.find((e) => e.points && Math.abs(e.points[0].x - 170) < 0.5 && Math.abs(e.points[0].y - 160) < 0.5) || {}).eid;
  check("(C0) 테스트용 얇은 <line> 화살표 확보", !!lineEid, lineEid);
  const linePts = await vf().evaluate((e) => {
    const el = document.querySelector('[data-arch-eid="' + e + '"]'); const svg = el.ownerSVGElement, ctm = el.getScreenCTM();
    const p = [{ x: +el.getAttribute("x1"), y: +el.getAttribute("y1") }, { x: +el.getAttribute("x2"), y: +el.getAttribute("y2") }];
    return p.map((q) => { const s = svg.createSVGPoint(); s.x = q.x; s.y = q.y; const r = s.matrixTransform(ctm); return { x: r.x, y: r.y }; });
  }, lineEid);
  const midX = (linePts[0].x + linePts[1].x) / 2, midY = (linePts[0].y + linePts[1].y) / 2;

  // ── 화살표 focus: baseline이 놓치는 14px 클릭을 잡는다(측정된 개선) ──
  const OFFSET = 14;   // baseline 8px 밖, focus 22px 안 — "선 클릭이 잘 안 됨"의 실증 지점
  await setFocus("all"); await enterEdit(); await setFocus("all");
  await page.mouse.click(sb.x + midX, sb.y + midY + OFFSET); await page.waitForTimeout(300);
  const selAllTol = await sel();
  const elAt = await vf().evaluate(([x, y]) => (document.elementFromPoint(x, y) || {}).tagName, [midX, midY + OFFSET]);
  check("(C1 baseline) 전체 focus: 선에서 14px 떨어진 클릭은 화살표를 못 잡는다",
    !(selAllTol && selAllTol.svgedge), JSON.stringify(selAllTol && { eid: selAllTol.eid, svgedge: selAllTol.svgedge }));
  check("(C1b) 그 지점 elementFromPoint는 선이 아님(=거리 판정이 실제 관건)", String(elAt).toLowerCase() !== "line", "el=" + elAt);
  await setFocus("arrow"); await enterEdit(); await setFocus("arrow");
  await page.mouse.click(sb.x + midX, sb.y + midY + OFFSET); await page.waitForTimeout(300);
  const selArrowTol = await sel();
  check("(C2 ★fix) 화살표 focus: 같은 14px 클릭이 그 화살표를 잡는다(측정된 개선)",
    selArrowTol && selArrowTol.eid === lineEid && selArrowTol.svgedge === true, JSON.stringify(selArrowTol));
  await page.screenshot({ path: path.join(ART, "s14_arrow_focus_grab.png"), clip: { x: sb.x + midX - 140, y: sb.y + midY - 90, width: 340, height: 220 } });

  // ── 노드 focus: 박스 위를 지나는 화살표를 절대 안 잡고 그 아래 박스를 잡는다 ──
  const cross = await vf().evaluate(() => {
    const edges = [...document.querySelectorAll('[data-svgedge="1"]')];
    function segPts(el) { const svg = el.ownerSVGElement, ctm = el.getScreenCTM(); const t = el.tagName.toLowerCase(); let p; if (t === "line") p = [{ x: +el.getAttribute("x1"), y: +el.getAttribute("y1") }, { x: +el.getAttribute("x2"), y: +el.getAttribute("y2") }]; else p = [...el.getAttribute("d").matchAll(/[ML]\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] })); return p.map((q) => { const s = svg.createSVGPoint(); s.x = q.x; s.y = q.y; const r = s.matrixTransform(ctm); return { x: r.x, y: r.y }; }); }
    for (const ed of edges) { const sp = segPts(ed);
      for (let k = 0; k + 1 < sp.length; k++) { const L = Math.hypot(sp[k + 1].x - sp[k].x, sp[k + 1].y - sp[k].y); const steps = Math.max(2, Math.floor(L / 3));
        for (let i = 1; i < steps; i++) { const t = i / steps; const x = sp[k].x + (sp[k + 1].x - sp[k].x) * t, y = sp[k].y + (sp[k + 1].y - sp[k].y) * t;
          const stack = document.elementsFromPoint(x, y); let ei = -1, bi = -1, be = null;
          for (let s = 0; s < stack.length; s++) { const el = stack[s]; if (!el.getAttribute) continue; if (ei < 0 && el.getAttribute("data-svgedge") === "1") ei = s; const bx = el.closest ? el.closest('[data-svgbox="1"]') : null; if (bx && bi < 0) { bi = s; be = bx.getAttribute("data-arch-eid"); } }
          if (ei >= 0 && bi >= 0 && ei < bi) return { edgeEid: ed.getAttribute("data-arch-eid"), boxEid: be, x, y };
        } } }
    return null;
  });
  check("(C3 setup) 박스 위를 지나는 화살표 지점 확보", !!cross, JSON.stringify(cross));
  await setFocus("all"); await enterEdit(); await setFocus("all");
  await page.mouse.click(sb.x + cross.x, sb.y + cross.y); await page.waitForTimeout(300);
  const sAllCross = await sel();
  check("(C4 baseline) 전체 focus: 박스 위 화살표 지점 클릭 → 화살표가 잡힌다", sAllCross && sAllCross.svgedge === true, JSON.stringify(sAllCross && { eid: sAllCross.eid, svgedge: sAllCross.svgedge }));
  await setFocus("node"); await enterEdit(); await setFocus("node");
  await page.mouse.click(sb.x + cross.x, sb.y + cross.y); await page.waitForTimeout(300);
  const sNodeCross = await sel();
  check("(C5 ★node) 노드 focus: 같은 지점 클릭이 화살표 대신 그 아래 박스를 잡는다(배경 선에 안 걸림)",
    sNodeCross && sNodeCross.eid === cross.boxEid && sNodeCross.svgbox === true && !sNodeCross.svgedge, JSON.stringify(sNodeCross));
  await page.screenshot({ path: path.join(ART, "s14_node_focus_box.png"), clip: { x: sb.x + cross.x - 140, y: sb.y + cross.y - 90, width: 340, height: 220 } });

  // focus 그룹은 OFF에서 숨는다(C6)
  await setOn(false);
  check("(C6) OFF로 끄면 3-way focus 그룹이 숨는다", (await page.evaluate(() => window.__archTest.isFocusGroupVisible())) === false);
  await setOn(true);

  // ============================================================
  // (D) D25d — 화살촉 일괄('전체 적용') 3행 이전
  // ============================================================
  // 1행 #edit-menu엔 globalhead 없음(요소 편집만)
  const editMenuSubs = await page.$$eval("#edit-menu [data-editsub]", (bs) => bs.map((b) => b.dataset.editsub));
  check("(D1) 1행 #edit-menu엔 요소 편집 토글만(화살촉 일괄 없음)", editMenuSubs.length === 1 && editMenuSubs[0] === "element", JSON.stringify(editMenuSubs));
  // '전체 적용'은 화살표 focus에서 3행(#fmt-arrow-row)에 뜬다
  await setFocus("arrow"); await page.waitForTimeout(150);
  const ha = await page.evaluate(() => window.__archTest.headAllBtn());
  check("(D2) '전체 적용'이 화살표 도구 행(#fmt-arrow-row)에 노출 + 서식 툴바 안", ha && ha.visible && ha.inArrowRow && ha.inFmtBar && /전체 적용/.test(ha.text), JSON.stringify(ha));
  check("(D2b) '전체' 태그로 스코프 예고(D19 안전장치)", (await page.$eval("#fmt-head-all .dd-tag", (e) => e.className)).includes("all"));
  // 노드/전체 focus에선 숨는다
  await setFocus("node"); await page.waitForTimeout(120);
  check("(D3) 노드 focus에선 '전체 적용' 숨김", !(await page.evaluate(() => window.__archTest.headAllBtn().visible)));
  await setFocus("arrow"); await page.waitForTimeout(120);

  // 개별 조정된 화살표 클론 1개를 만들어 두고(통일 검사용), 일괄 적용 → 확인 게이트 → 단일 undo
  const D0 = await src();
  const probeEdge = edges.find((e) => e.editable).eid;
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), probeEdge);
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__archTest.fmtHead(2.5));
  await page.waitForTimeout(400);
  const withClone = await src();
  const clonesBefore = await page.evaluate(() => window.__archTest.getSvgMarkers().filter((m) => m.clone).length);
  check("(D4) 준비: 개별 조정으로 전용 marker 클론 1개 생성", clonesBefore === 1, "clones=" + clonesBefore);
  const depthBefore = await depth();

  // 3행 '전체 적용' 클릭 → D19 바(#gh-bar) 오픈(순수 이전) → 슬라이더 3× → 적용 → 확인 게이트
  await setFocus("arrow"); await page.waitForTimeout(150);
  await page.click("#fmt-head-all");
  await page.waitForTimeout(250);
  check("(D5) 3행 '전체 적용' → D19 일괄 바(#gh-bar) 오픈(구 1행 버튼과 같은 바)", await page.evaluate(() => window.__archTest.isGlobalHeadBarOpen()));
  await page.evaluate(() => { const el = document.getElementById("gh-size"); el.value = "3"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.click("#gh-apply");
  await page.waitForSelector("#wd-confirm:not([hidden])", { timeout: 5000 });
  const pend = await page.evaluate(() => window.__archTest.getPendingGlobalHead());
  check("(D5b 확인게이트) 적용 전엔 소스 무변형(D19 그대로)", pend && pend.scale === 3 && (await src()) === withClone && (await depth()) === depthBefore, JSON.stringify(pend));
  check("(D5c) 확인 문구가 문서 전체·개별 덮어쓰기를 고지",
    await page.evaluate(() => { const t = document.getElementById("wd-confirm-text").textContent; return /문서 전체/.test(t) && /개별/.test(t); }));
  await page.screenshot({ path: path.join(ART, "s14_headall_row3_confirm.png"), clip: { x: 0, y: 0, width: 2120, height: 900 } });
  await page.click("#wd-confirm-apply");
  await page.waitForFunction((d) => window.__archTest.undoDepth() === d + 1, depthBefore, { timeout: 6000 });
  await page.waitForTimeout(300);
  const scales = await page.evaluate(() => window.__archTest.getSvgMarkers().map((m) => ({ clone: !!m.clone, mw: +m.markerWidth })));
  // 3× → markerWidth 10*3=30 (공유·클론 전부)
  check("(D6 ★일괄) 문서 전체 공유 marker가 3.0×(markerWidth=30)로 통일", scales.filter((m) => !m.clone).every((m) => Math.abs(m.mw - 30) < 0.5), JSON.stringify(scales.filter((m) => !m.clone)));
  check("(D6b ★클론 통일) 개별 조정 클론(2.5×였던)도 같은 3.0×로 덮어씀", scales.filter((m) => m.clone).every((m) => Math.abs(m.mw - 30) < 0.5), JSON.stringify(scales.filter((m) => m.clone)));
  check("(D7 단일 undo) 일괄 적용은 undo 스냅샷 딱 1개", (await depth()) === depthBefore + 1, "depth=" + (await depth()));
  await page.click("#btn-undo");
  await page.waitForTimeout(300);
  check("(D7b) undo 한 번으로 개별 클론 상태(withClone)로 복원", (await src()) === withClone);

  // ============================================================
  // (E) 다중 선택은 블록 개념 → OFF에선 Cmd+클릭 무시(단일 인라인만)
  // ============================================================
  await loadSvg();
  await enterEdit();
  await setOn(false);
  sb = await stageBox();
  const eLb = await lineClientOfBox(box3, 0);
  // Cmd+클릭(additive)로 시도 — OFF에선 집합이 만들어지지 않고 인라인만
  await page.keyboard.down("Meta");
  await page.mouse.click(sb.x + eLb.cx, sb.y + eLb.cy);
  await page.keyboard.up("Meta");
  await page.waitForTimeout(250);
  const selCount = await page.evaluate(() => window.__archTest.getSelection().length);
  check("(E1) OFF에서 Cmd+클릭 → 선택 집합 안 만들어짐(다중선택은 블록 개념)", selCount === 0, "selCount=" + selCount);
  check("(E1b) OFF에서 Cmd+클릭도 단일 인라인 편집만 연다", (await frame().locator('[data-arch-overlay="inline"]').count()) === 1);
  await frame().locator('[data-arch-overlay="inline"]').press("Escape");

  // ============================================================
  // (F) 무회귀 슬라이스 — 기본 ON에서 오늘 동작
  // ============================================================
  await loadSvg();
  await enterEdit();   // 기본 ON
  // (F1) 박스 선택 무회귀 — ★팝업 폐지 → 패널 대신 선택 + 툴바 반영
  await frame().locator('[data-arch-eid="' + rectEid + '"]').click();
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, rectEid, { timeout: 5000 });
  check("(F1 무회귀) 기본 ON에서 박스 클릭 → svgbox 선택 + 팝업 없음", (await sel()).eid === rectEid && (await sel()).svgbox === true && !(await page.evaluate(() => window.__archTest.anyDetailPanelOpen())));
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await enterEdit();
  // (F2) 화살표 선택 무회귀(전체 focus 기본, 선 위 클릭)
  sb = await stageBox();
  await page.mouse.click(sb.x + midX, sb.y + midY);
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, lineEid, { timeout: 5000 }).catch(() => {});
  const fEdge = await sel();
  check("(F2 무회귀) 기본 ON·전체 focus에서 선 위 클릭 → 화살표 선택", fEdge && fEdge.eid === lineEid && fEdge.svgedge === true, JSON.stringify(fEdge));

  await page.screenshot({ path: path.join(ART, "s14_final.png") });
  check("(Z) 페이지 콘솔 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s14_failure.png") }); } catch {}
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n=== s14 (D25 블록/텍스트 이분화 + 노드/화살표 도구) : ${pass} pass / ${fail} fail ===`);
process.exit(fail ? 1 : 0);
