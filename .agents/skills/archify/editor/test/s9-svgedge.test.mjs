// Stage 9 (class c / D18) — SVG 화살표(엣지) 편집 그라운딩 테스트 (mock, 키 불필요).
//
// 검증 대상:
//   (A) stamp: marker-end를 가진 <line>/<path>가 svgedge:N으로 STAMP되고, 개수 = 실제 marker-end
//       개수(defs·박스 소유 제외)와 정확히 일치. 박스(svgbox)·자유텍스트(svgtext) 단위는 불변.
//   (B) 기하 hit-test: 2px 얇은 선에서 몇 px 떨어진 클릭도 그 화살표를 선택. 빈 캔버스는 미선택.
//       박스 내부 클릭은 여전히 svgbox 우선(hit 우선순위 무회귀).
//   (C) 기능 A — 더블클릭 방향 뒤집기: 정점 순서 반전 + 화살촉이 반대 끝으로. bleed 청결·Cmd+Z 복원.
//   (D) 기능 B-1 — 정점 드래그: 그 정점만 기대 user 델타만큼 이동, 나머지 정점 불변, bleed 청결.
//   (E) 기능 B-2 — 중간점 드래그 = 꼭짓점 추가: 정점 수 +1(올바른 인덱스), <line>은 <path>로 승격하며
//       stroke/marker 속성 보존.
//   (F) 기능 C — 화살촉 크기: ★그 화살표 전용 marker 클론(markerWidth/Height 스케일 + refX 비례).
//       공유 #ah는 바이트 동일, #ah를 쓰는 다른 화살표도 바이트 동일, 반복 조절 시 클론 재사용(증식 없음).
//   (G) 다운로드 라운드트립: stamp+편집+클론 defs 유지, 재열기 시 재채번 없음.
//   (H) Cmd+Z가 신규 op 4종(flip/moveVertex/addVertex/setHeadSize)을 전부 되돌림.
//
// bleed-diff는 앱 로직을 재사용하지 않고 테스트가 독립 DOMParser 비교로 실증한다(순환 방지).
// marker 클론 화이트리스트도 테스트가 독립적으로 재구현해 "그 예외 하나만" 통과함을 보인다.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8621;
const BASE = `http://127.0.0.1:${PORT}`;
const ART = path.join(APP_DIR, "test", "artifacts");
fs.mkdirSync(ART, { recursive: true });
const SVG_HTML = fs.readFileSync(path.join(APP_DIR, "demo_svg_slide.html"), "utf8");

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
const vf = () => page.frames().find((f) => f !== page.mainFrame());   // srcdoc 뷰 프레임(기하 계산용)
async function stageBox() { return await page.locator("#stage").boundingBox(); }
const src = () => page.evaluate(() => window.__archTest.getSource());
const depth = () => page.evaluate(() => window.__archTest.undoDepth());

// ── 독립 bleed-diff (화살촉 marker 클론 화이트리스트 포함) ──
// (1) 선택 단위를 마스크한 문서 전체가 before==after, (2) 그 단위의 조상이 아닌 다른 data-arch-eid는
// 전부 outerHTML 동일. 단 화살촉 크기 조절이 만든 "그 eid 파생 marker 1개 추가"만 정당한 예외로
// 인정하고(id가 <before에 있던 base>--<eid slug> 꼴 + data-arch-edge-clone===eid), 비교 전에 제거한다.
const bleedClean = (a, b, eid) => page.evaluate(([ha, hb, e]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  const A = P(ha), B = P(hb);
  const mk = (doc) => new Map([...doc.querySelectorAll("marker")].map((m) => [m.getAttribute("id"), m]));
  const mA = mk(A), mB = mk(B);
  const suf = "--" + e.replace(/:/g, "-");
  // 정당한 예외 = "선택 화살표가 소유한 클론"의 추가/수정/제거뿐. base가 before에 있던 공유
  // marker이고 data-arch-edge-clone이 그 eid여야 한다(공유 marker·타 화살표 클론은 불가).
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
  const markerOffenders = [...changed].filter((id) => !owned.has(id)).map((id) => "허용 밖 marker 변경: " + id);
  owned.forEach((id) => { if (mA.get(id)) mA.get(id).remove(); if (mB.get(id)) mB.get(id).remove(); });
  const unitA = A.querySelector('[data-arch-eid="' + e + '"]');
  const offenders = [];
  A.querySelectorAll("[data-arch-eid]").forEach((el) => {
    const k = el.getAttribute("data-arch-eid");
    if (k === e) return;
    if (unitA && el.contains(unitA)) return;              // 조상(바깥 svg) — 마스크 검사가 커버
    const elB = B.querySelector('[data-arch-eid="' + k + '"]');
    if (!elB || el.outerHTML !== elB.outerHTML) offenders.push(k);
  });
  const mask = (doc) => { const el = doc.querySelector('[data-arch-eid="' + e + '"]'); if (el) el.replaceWith(doc.createElement("arch-mask-test")); return doc.documentElement.outerHTML; };
  const maskedEqual = mask(A) === mask(B);
  return { ok: maskedEqual && !offenders.length && !markerOffenders.length, maskedEqual, offenders, markerOffenders, addedMarkers: added };
}, [a, b, eid]);

// 소스 HTML에서 화살표 단위의 원시 속성 읽기(앱 코드 미사용).
const edgeRaw = (html, eid) => page.evaluate(([h, e]) => {
  const el = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]');
  if (!el) return null;
  const at = {};
  [...el.attributes].forEach((a) => { at[a.name] = a.value; });
  return { tag: el.tagName.toLowerCase(), attrs: at, outerHTML: el.outerHTML };
}, [html, eid]);

const markerRaw = (html, id) => page.evaluate(([h, i]) => {
  const m = new DOMParser().parseFromString(h, "text/html").querySelector('marker[id="' + i + '"]');
  return m ? m.outerHTML : null;
}, [html, id]);

// 뷰 프레임에서 화살표 정점을 "iframe 클라이언트 좌표"로 투영(스케일·viewBox 가정 없이 실측).
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

async function loadSvg() {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await page.evaluate(async (h) => { await window.__archTest.load(h, "svg.html"); }, SVG_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
  await page.waitForTimeout(250);
  return await src();
}
// setMode는 iframe에 postMessage로 전달되므로 즉시 반영되지 않는다 — 원시 마우스 클릭이
// 모드 전환을 앞질러 들어가면 뷰가 아직 이전 모드로 판정한다. 짧게 정착시킨다.
async function setMode(m) {
  await page.evaluate((mm) => window.__archTest.setMode(mm), m);
  await page.waitForTimeout(250);
}
async function selectEdgeAt(eid, pt) {
  await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction((e) => {
    const s = window.__archTest.getSelected();
    return !!(s && s.eid === e && s.svgedge);
  }, eid, { timeout: 6000 });
  // popup removed 2026-07-21 → toolbar row3: 상세 패널이 더는 안 뜬다. 선택 확인은 위 getSelected 대기로 충분.
  const n = (await page.evaluate((e) => window.__archTest.svgEdgeSnapshot(e).vertexCount, eid));
  await page.waitForFunction((k) => document.querySelector("#diagram-frame") && true, n, { timeout: 1000 }).catch(() => {});
  for (let i = 0; i < 40; i++) {
    if ((await frame().locator('[data-arch-overlay="vhandle"]:visible').count()) === n) return n;
    await page.waitForTimeout(100);
  }
  return await frame().locator('[data-arch-overlay="vhandle"]:visible').count();
}
async function undoAll() {
  while ((await depth()) > 0) { await page.click("#btn-undo"); await page.waitForTimeout(120); }
}

try {
  // ==================== (A) stamp ====================
  let A0 = await loadSvg();
  check("(A0) scale=1 (좌표 단순화)", (await page.evaluate(() => window.__archTest.getScale())) === 1);

  const edges = await page.evaluate(() => window.__archTest.getSvgEdges());
  // 기대치: <svg data-object> 안의 marker-end 보유 <line>/<path> 중 defs·박스 소유가 아닌 것 (동적 산출)
  const expectedEdges = await page.evaluate((h) => {
    const svg = new DOMParser().parseFromString(h, "text/html").querySelector("svg[data-object]");
    let n = 0;
    svg.querySelectorAll("[marker-end]").forEach((el) => {
      if (el.closest("defs")) return;
      if (el.closest('[data-svgbox="1"]')) return;
      const t = el.tagName.toLowerCase();
      if (t === "line" || t === "path") n++;
    });
    return n;
  }, A0);
  check("(A1) svgedge stamp 개수 = 실제 marker-end 화살표 수(동적)", edges.length === expectedEdges, `stamped=${edges.length} expected=${expectedEdges}`);
  check("(A1b) 화살표 42개(실측 고정: line 16 + path 26)", edges.length === 42, "count=" + edges.length);
  const tags = edges.reduce((m, e) => (m[e.tag] = (m[e.tag] || 0) + 1, m), {});
  check("(A1c) 태그 분포 line=16 / path=26", tags.line === 16 && tags.path === 26, JSON.stringify(tags));
  check("(A1d) eid 전부 고유 + svgedge: 접두", new Set(edges.map((e) => e.eid)).size === edges.length && edges.every((e) => /^svgedge:/.test(e.eid)));
  check("(A1e) 전부 M/L 기하 파싱 성공(정점 ≥2)", edges.every((e) => e.editable && e.vertexCount >= 2), JSON.stringify(edges.filter((e) => !e.editable).map((e) => e.eid)));
  // 무회귀: 박스 32 · 자유 텍스트 29 그대로
  check("(A2) 박스 svgbox 32개 불변", (await page.evaluate(() => window.__archTest.getSvgBoxes())).length === 32);
  check("(A2b) 자유 텍스트 svgtext 29개 불변", (await page.evaluate(() => window.__archTest.getSvgTexts())).length === 29);
  const noCross = await page.evaluate((h) => {
    const d = new DOMParser().parseFromString(h, "text/html");
    const e = [...d.querySelectorAll('[data-svgedge="1"]')];
    return e.every((x) => !x.hasAttribute("data-svgbox") && !x.hasAttribute("data-svgtext"))
      && [...d.querySelectorAll("defs [marker-end], defs marker path")].every((x) => !x.hasAttribute("data-arch-eid"));
  }, A0);
  check("(A3) 화살표는 box/text 단위와 겹치지 않고 defs 내부는 미stamp", noCross);
  const markers0 = await page.evaluate(() => window.__archTest.getSvgMarkers());
  check("(A4) 공유 marker 3개(ah/ah-muted/ah-red), 클론 0", markers0.length === 3 && markers0.every((m) => !m.clone), JSON.stringify(markers0.map((m) => m.id)));

  // 테스트에 쓸 화살표 고르기(기하로 특정)
  const eq = (p, x, y) => Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01;
  const byStart = (x, y) => (edges.find((e) => e.points && eq(e.points[0], x, y)) || {}).eid;
  const multiEid = byStart(228, 196);        // 6정점 직교 라우팅 (M228,196 … L105,470)
  const lineEid = byStart(170, 160);         // 2점 <line> (170,160)-(190,160)
  const neighborEid = byStart(262, 160);     // 같은 행 이웃 <line>, 같은 #ah 공유
  check("(A5) 테스트 대상 화살표 3종 확보(6정점 path · line · 이웃 line)", !!multiEid && !!lineEid && !!neighborEid, JSON.stringify({ multiEid, lineEid, neighborEid }));

  // ==================== (B) 기하 hit-test ====================
  let sb = await stageBox();
  const linePts = await edgeClient(lineEid);
  const midX = (linePts[0].x + linePts[1].x) / 2, midY = (linePts[0].y + linePts[1].y) / 2;
  // 선에서 4px 떨어진 지점 클릭(2px 선이라 elementFromPoint로는 못 잡히는 거리)
  await page.mouse.click(sb.x + midX, sb.y + midY + 4);
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 }).catch(() => {});
  let sel = await page.evaluate(() => window.__archTest.getSelected());
  check("(B1) 얇은 선에서 4px 떨어진 클릭 → 그 화살표 선택", sel && sel.eid === lineEid && sel.svgedge === true, JSON.stringify(sel));
  const offEl = await vf().evaluate(([x, y]) => (document.elementFromPoint(x, y) || {}).tagName, [midX, midY + 4]);
  check("(B1b) 그 지점의 elementFromPoint는 선이 아님(=기하 판정이 실제로 일한 것)", String(offEl).toLowerCase() === "svg", "el=" + offEl);
  await page.keyboard.press("Escape");

  // 빈 캔버스(어떤 도형도 없고 모든 화살표 bbox에서 20px 이상) → 미선택
  const empty = await vf().evaluate(() => {
    const svg = document.querySelector("svg[data-object]");
    const r = svg.getBoundingClientRect();
    const es = [...document.querySelectorAll('[data-svgedge="1"]')].map((e) => e.getBoundingClientRect());
    for (let y = r.top + 12; y < r.bottom - 12; y += 6) {
      for (let x = r.left + 12; x < r.right - 12; x += 6) {
        const el = document.elementFromPoint(x, y);
        if (!el || el.tagName.toLowerCase() !== "svg") continue;
        if (es.some((b) => x > b.left - 20 && x < b.right + 20 && y > b.top - 20 && y < b.bottom + 20)) continue;
        return { x, y };
      }
    }
    return null;
  });
  check("(B2a) 빈 지점 탐색 성공", !!empty, JSON.stringify(empty));
  await page.mouse.click(sb.x + empty.x, sb.y + empty.y);
  await page.waitForTimeout(300);
  check("(B2) 빈 캔버스 클릭 → 선택 없음(편집 불가 안내)", !(await page.evaluate(() => window.__archTest.getSelected())), JSON.stringify(await page.evaluate(() => window.__archTest.getSelected())));
  // 박스 우선순위 무회귀: 박스 내부 클릭은 svgbox
  const boxEid = await page.evaluate((h) => {
    const g = [...new DOMParser().parseFromString(h, "text/html").querySelectorAll('[data-svgbox="1"]')].find((g) => (g.textContent || "").indexOf("STEP 0.1") >= 0);
    return g ? g.getAttribute("data-arch-eid") : null;
  }, A0);
  // 박스 내부(라벨 <text>가 아닌 rect 여백)를 좌표로 정확히 클릭 — 화살표가 근처여도 박스가 이겨야 한다.
  const boxPt = await vf().evaluate((e) => {
    const r = document.querySelector('[data-arch-eid="' + e + '"]').getBoundingClientRect();
    return { x: r.left + 8, y: r.top + 6 };
  }, boxEid);
  await page.mouse.click(sb.x + boxPt.x, sb.y + boxPt.y);
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 });
  sel = await page.evaluate(() => window.__archTest.getSelected());
  check("(B3) 박스 클릭은 여전히 svgbox 우선(화살표가 근처여도)", sel && sel.eid === boxEid && sel.svgbox === true && !sel.svgedge, JSON.stringify(sel));
  await page.keyboard.press("Escape");
  // 자유 텍스트 무회귀
  const txtEid = await page.evaluate(() => (window.__archTest.getSvgTexts()[0] || {}).eid);
  await frame().locator('[data-arch-eid="' + txtEid + '"]').click();
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 });
  sel = await page.evaluate(() => window.__archTest.getSelected());
  check("(B4) 자유 텍스트도 여전히 자기 자신 선택", sel && sel.eid === txtEid && sel.svgtext === true && !sel.svgedge, JSON.stringify(sel));
  await page.keyboard.press("Escape");

  // ==================== 편집 모드 선택 + 핸들 ====================
  // 확대 클립: 화살촉이 어느 끝에 붙어 있는지 눈으로 확인 가능한 크기로(전체 슬라이드 샷은 너무 작다).
  // 선택 오버레이(정점 핸들)가 끝점을 가리면 비교가 안 되므로 before는 선택 전에 찍는다.
  const clipAround = async (eid, pad = 60) => {
    const ps = await edgeClient(eid);
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    return { x: sb.x + Math.min(...xs) - pad, y: sb.y + Math.min(...ys) - pad, width: (Math.max(...xs) - Math.min(...xs)) + pad * 2, height: (Math.max(...ys) - Math.min(...ys)) + pad * 2 };
  };
  await page.screenshot({ path: path.join(ART, "s9_edge_flip_before.png"), clip: await clipAround(multiEid) });
  await setMode("edit");
  const mPts = await edgeClient(multiEid);
  const seg0 = { x: (mPts[0].x + mPts[1].x) / 2, y: (mPts[0].y + mPts[1].y) / 2 };
  await selectEdgeAt(multiEid, { x: sb.x + seg0.x, y: sb.y + seg0.y });
  sel = await page.evaluate(() => window.__archTest.getSelected());
  // popup removed 2026-07-21 → toolbar row3: 화살표 선택은 그대로 되고 상세 팝업만 안 뜬다(패널 대신 getSelected로 확인).
  check("(C0) 편집 모드에서 화살표 선택됨(팝업 없이 툴바가 표면)", sel && sel.eid === multiEid && sel.svgedge === true
    && (await page.evaluate(() => window.__archTest.anyDetailPanelOpen())) === false, JSON.stringify(sel));
  const vCount = await frame().locator('[data-arch-overlay="vhandle"]:visible').count();
  const mCount = await frame().locator('[data-arch-overlay="midhandle"]:visible').count();
  check("(C0b) 정점 핸들 6개 + 중간점 핸들 5개", vCount === 6 && mCount === 5, `v=${vCount} m=${mCount}`);
  const boxHandles = await frame().locator('[data-arch-overlay="handle"]:visible').count();
  const moveDisp = await frame().locator('[data-arch-overlay="move"]').evaluate((el) => getComputedStyle(el).display);
  check("(C0c) 박스용 코너 핸들·이동 오버레이는 숨김(화살표는 정점 편집만)", boxHandles === 0 && moveDisp === "none", `corner=${boxHandles} move=${moveDisp}`);
  // 핸들이 실제 선 위에 있는가(기하 대조)
  const h0 = await frame().locator('[data-arch-overlay="vhandle"]:visible').first().boundingBox();
  check("(C0d) 첫 정점 핸들이 실제 정점 좌표 위에 있음(±2px)",
    Math.abs((h0.x + h0.width / 2) - (sb.x + mPts[0].x)) < 2 && Math.abs((h0.y + h0.height / 2) - (sb.y + mPts[0].y)) < 2,
    `handle=(${(h0.x + h0.width / 2).toFixed(1)},${(h0.y + h0.height / 2).toFixed(1)}) pt=(${(sb.x + mPts[0].x).toFixed(1)},${(sb.y + mPts[0].y).toFixed(1)})`);
  await page.screenshot({ path: path.join(ART, "s9_edge_select.png") });

  // ==================== (C) 기능 A: 더블클릭 방향 뒤집기 ====================
  const before = (await page.evaluate(() => window.__archTest.getSvgEdges())).find((e) => e.eid === multiEid);
  const rawBefore = await edgeRaw(A0, multiEid);
  await page.mouse.dblclick(sb.x + seg0.x, sb.y + seg0.y);
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  let S = await src();
  const after = (await page.evaluate(() => window.__archTest.getSvgEdges())).find((e) => e.eid === multiEid);
  const reversed = JSON.stringify(after.points) === JSON.stringify(before.points.slice().reverse());
  check("(C1) 더블클릭 → 정점 순서 반전", reversed, JSON.stringify({ before: before.points, after: after.points }));
  const rawAfter = await edgeRaw(S, multiEid);
  check("(C1b) 화살촉이 반대 끝으로(끝점=원래 시작점, marker-end 속성은 불변)",
    eq(after.points[after.points.length - 1], before.points[0].x, before.points[0].y)
    && rawAfter.attrs["marker-end"] === rawBefore.attrs["marker-end"],
    JSON.stringify({ end: after.points[after.points.length - 1], marker: rawAfter.attrs["marker-end"] }));
  check("(C1c) 선 속성(stroke/stroke-width/fill) 보존", rawAfter.attrs.stroke === rawBefore.attrs.stroke && rawAfter.attrs["stroke-width"] === rawBefore.attrs["stroke-width"] && rawAfter.attrs.fill === rawBefore.attrs.fill);
  let bl = await bleedClean(A0, S, multiEid);
  check("(C2) bleed-diff: 그 화살표만 변경(marker 추가 0)", bl.ok && bl.addedMarkers.length === 0, JSON.stringify(bl));
  await page.screenshot({ path: path.join(ART, "s9_edge_flip.png") });
  await page.evaluate(() => window.__archTest.setMode("edit"));  // popup removed 2026-07-21: 선택 오버레이 제거 → 화살촉만 비교(setMode가 선택 해제)
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(ART, "s9_edge_flip_after.png"), clip: await clipAround(multiEid) });
  // Cmd+Z 복원
  await page.waitForTimeout(150);
  await page.keyboard.press("Meta+z");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 6000 }).catch(() => {});
  check("(C3) Cmd+Z가 flip을 바이트 동일 복원", (await src()) === A0, "depth=" + (await depth()));

  // 패널 버튼으로도 같은 op
  await setMode("edit");
  await selectEdgeAt(multiEid, { x: sb.x + seg0.x, y: sb.y + seg0.y });
  await page.evaluate(() => window.__archTest.fmtFlip());   // popup removed 2026-07-21 → toolbar row3 '방향 뒤집기'(#fmt-flip)
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  const afterBtn = (await page.evaluate(() => window.__archTest.getSvgEdges())).find((e) => e.eid === multiEid);
  check("(C4) 툴바 '방향 뒤집기'(row3)도 동일 결과", JSON.stringify(afterBtn.points) === JSON.stringify(before.points.slice().reverse()));
  await undoAll();

  // ==================== (D) 기능 B-1: 정점 드래그 ====================
  await selectEdgeAt(multiEid, { x: sb.x + seg0.x, y: sb.y + seg0.y });
  const vIdx = 2;                                    // 중간 정점(L14,210) — 양옆이 있어 대조가 쉬움
  const hb = await frame().locator('[data-arch-overlay="vhandle"]:visible').nth(vIdx).boundingBox();
  const DX = 55, DY = -40;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + DX, hb.y + hb.height / 2 + DY, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  S = await src();
  const moved = (await page.evaluate(() => window.__archTest.getSvgEdges())).find((e) => e.eid === multiEid);
  const dOk = Math.abs((moved.points[vIdx].x - before.points[vIdx].x) - DX) < 8 && Math.abs((moved.points[vIdx].y - before.points[vIdx].y) - DY) < 8;
  check("(D1) 드래그가 그 정점만 화면px→user 정확 이동", dOk,
    `Δ=(${(moved.points[vIdx].x - before.points[vIdx].x).toFixed(1)},${(moved.points[vIdx].y - before.points[vIdx].y).toFixed(1)}) expect≈(${DX},${DY})`);
  const othersSame = moved.points.every((p, i) => i === vIdx || eq(p, before.points[i].x, before.points[i].y));
  check("(D1b) 나머지 정점 전부 불변", othersSame, JSON.stringify(moved.points));
  check("(D1c) 정점 수 불변(6)", moved.vertexCount === 6);
  bl = await bleedClean(A0, S, multiEid);
  check("(D2) bleed-diff: 그 화살표만 변경", bl.ok, JSON.stringify(bl));
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  await page.keyboard.press("Meta+z");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 6000 }).catch(() => {});
  check("(D3) Cmd+Z가 moveVertex를 바이트 동일 복원", (await src()) === A0);

  // ==================== (E) 기능 B-2: 중간점 드래그 = 꼭짓점 추가 + <line>→<path> 승격 ====================
  await setMode("edit");
  const lPts0 = await edgeClient(lineEid);
  const lineRawBefore = await edgeRaw(A0, lineEid);
  await selectEdgeAt(lineEid, { x: sb.x + (lPts0[0].x + lPts0[1].x) / 2, y: sb.y + (lPts0[0].y + lPts0[1].y) / 2 });
  sel = await page.evaluate(() => window.__archTest.getSelected());
  check("(E0) 2점 <line> 선택 · 중간점 핸들 1개", sel.eid === lineEid && (await frame().locator('[data-arch-overlay="midhandle"]:visible').count()) === 1);
  const mb0 = await frame().locator('[data-arch-overlay="midhandle"]:visible').first().boundingBox();
  const MDY = -46;
  await page.mouse.move(mb0.x + mb0.width / 2, mb0.y + mb0.height / 2);
  await page.mouse.down();
  await page.mouse.move(mb0.x + mb0.width / 2, mb0.y + mb0.height / 2 + MDY, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  S = await src();
  const promoted = (await page.evaluate(() => window.__archTest.getSvgEdges())).find((e) => e.eid === lineEid);
  const lineRawAfter = await edgeRaw(S, lineEid);
  const lineBeforePts = edges.find((e) => e.eid === lineEid).points;
  check("(E1) 정점 수 +1 (2 → 3)", promoted.vertexCount === 3, JSON.stringify(promoted.points));
  check("(E1b) 새 정점이 index 1(가운데) · 양 끝점 불변",
    eq(promoted.points[0], lineBeforePts[0].x, lineBeforePts[0].y) && eq(promoted.points[2], lineBeforePts[1].x, lineBeforePts[1].y),
    JSON.stringify(promoted.points));
  check("(E1c) 새 정점이 드래그한 만큼 이동(±8u)", Math.abs((promoted.points[1].y - (lineBeforePts[0].y + lineBeforePts[1].y) / 2) - MDY) < 8,
    `Δy=${(promoted.points[1].y - (lineBeforePts[0].y + lineBeforePts[1].y) / 2).toFixed(1)} expect≈${MDY}`);
  check("(E2) <line> → <path> 승격", lineRawBefore.tag === "line" && lineRawAfter.tag === "path", `${lineRawBefore.tag}→${lineRawAfter.tag}`);
  check("(E2b) stroke/stroke-width/marker-end/stamp 속성 보존 + fill=none 보강",
    lineRawAfter.attrs.stroke === lineRawBefore.attrs.stroke
    && lineRawAfter.attrs["stroke-width"] === lineRawBefore.attrs["stroke-width"]
    && lineRawAfter.attrs["marker-end"] === lineRawBefore.attrs["marker-end"]
    && lineRawAfter.attrs["data-arch-eid"] === lineEid && lineRawAfter.attrs["data-svgedge"] === "1"
    && lineRawAfter.attrs.fill === "none"
    && lineRawAfter.attrs.x1 === undefined && lineRawAfter.attrs.x2 === undefined,
    JSON.stringify(lineRawAfter.attrs));
  bl = await bleedClean(A0, S, lineEid);
  check("(E3) bleed-diff: 승격돼도 그 화살표만 변경", bl.ok, JSON.stringify(bl));
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  await page.keyboard.press("Meta+z");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 6000 }).catch(() => {});
  check("(E4) Cmd+Z가 addVertex(+승격)를 바이트 동일 복원", (await src()) === A0);

  // 꼭짓점 삭제(Alt+클릭) — 6정점 path에서 하나 제거
  await setMode("edit");
  await selectEdgeAt(multiEid, { x: sb.x + seg0.x, y: sb.y + seg0.y });
  const delHb = await frame().locator('[data-arch-overlay="vhandle"]:visible').nth(2).boundingBox();
  // ※ page.mouse.click에는 modifiers 옵션이 없다(locator.click 전용) — 실제 키 상태로 눌러야 한다.
  await page.keyboard.down("Alt");
  await page.mouse.click(delHb.x + delHb.width / 2, delHb.y + delHb.height / 2);
  await page.keyboard.up("Alt");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  const deleted = (await page.evaluate(() => window.__archTest.getSvgEdges())).find((e) => e.eid === multiEid);
  check("(E5) Alt+클릭 꼭짓점 삭제 (6 → 5, index 2 제거)",
    deleted.vertexCount === 5 && eq(deleted.points[2], before.points[3].x, before.points[3].y), JSON.stringify(deleted.points));
  check("(E5b) bleed-diff: 삭제도 그 화살표만", (await bleedClean(A0, await src(), multiEid)).ok);
  await undoAll();
  check("(E5c) undo 복원", (await src()) === A0);

  // ==================== (F) 기능 C: 화살촉 크기 — marker 클론 스코프 ====================
  const neighborBefore = await edgeRaw(A0, neighborEid);
  const ahBefore = await markerRaw(A0, "ah");
  // ★ 팝업 폐지(2026-07-21): 구 패널 슬라이더(#se-head) 제거 → 툴바 화살촉(row3) 훅으로 2.2배(같은 setHeadSize op).
  await setMode("edit");
  const nlPts = await edgeClient(lineEid);
  await selectEdgeAt(lineEid, { x: sb.x + (nlPts[0].x + nlPts[1].x) / 2, y: sb.y + (nlPts[0].y + nlPts[1].y) / 2 });
  await page.evaluate(() => window.__archTest.fmtHead(2.2));
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  S = await src();
  let mk = await page.evaluate(() => window.__archTest.getSvgMarkers());
  const clone = mk.find((m) => m.clone === lineEid);
  const edgeAfterHead = await edgeRaw(S, lineEid);
  check("(F1) 그 화살표 전용 marker 클론 생성(id=base--eid slug)", !!clone && clone.id === "ah--svgedge-" + lineEid.split(":")[1], JSON.stringify(clone && clone.id));
  check("(F1b) markerWidth/Height가 2.2배 (10→22, 8→17.6)", clone && +clone.markerWidth === 22 && +clone.markerHeight === 17.6, JSON.stringify(clone));
  check("(F1c) ★refX 비례 스케일 9→19.8 (비율 0.9 유지) · refY 중앙 4→8.8 (=17.6/2)",
    clone && +clone.refX === 19.8 && +clone.refY === 8.8 && Math.abs(+clone.refX / +clone.markerWidth - 0.9) < 1e-9, JSON.stringify(clone));
  const cloneScaled = await page.evaluate(([h, id]) => {
    const m = new DOMParser().parseFromString(h, "text/html").querySelector('marker[id="' + id + '"]');
    const g = m && m.querySelector("g");
    return { g: !!g, transform: g ? g.getAttribute("transform") : null, hasPath: !!(m && m.querySelector("path")) };
  }, [S, clone.id]);
  check("(F1d) ★콘텐츠도 실제 확대(viewBox 없는 marker라 scale(2.2) 래핑) — 크기만 키우면 안 커진다",
    cloneScaled.g && cloneScaled.transform === "scale(2.2)" && cloneScaled.hasPath, JSON.stringify(cloneScaled));
  check("(F2) 그 화살표의 marker-end만 클론으로 재지정", edgeAfterHead.attrs["marker-end"] === "url(#" + clone.id + ")" && edgeAfterHead.attrs["data-svgedge-head"] === "2.2");
  check("(F3) ★공유 #ah는 바이트 동일(다른 38개 화살표 렌더 불변)", (await markerRaw(S, "ah")) === ahBefore);
  check("(F3b) ★#ah를 쓰는 이웃 화살표 outerHTML 바이트 동일", (await edgeRaw(S, neighborEid)).outerHTML === neighborBefore.outerHTML);
  const otherPointersOk = await page.evaluate(([h, e]) => {
    const d = new DOMParser().parseFromString(h, "text/html");
    return [...d.querySelectorAll('[data-svgedge="1"]')].filter((x) => x.getAttribute("data-arch-eid") !== e)
      .every((x) => !/--svgedge-/.test(x.getAttribute("marker-end") || ""));
  }, [S, lineEid]);
  check("(F3c) 다른 모든 화살표의 marker-end는 여전히 공유 marker를 가리킴", otherPointersOk);
  bl = await bleedClean(A0, S, lineEid);
  check("(F4) bleed-diff: 그 화살표 + 파생 marker 1개만(그 외 바이트 동일)", bl.ok && bl.addedMarkers.length === 1 && bl.addedMarkers[0] === clone.id, JSON.stringify(bl));
  check("(F4b) marker 총계 3 → 4", mk.length === 4);

  // 반복 조절 → 클론 재사용(증식 없음), base 기준 절대 배율(누적 아님)
  await page.evaluate((e) => window.__archTest.applySvgManual([{ op: "setHeadSize", eid: e, scale: 3 }], e), lineEid);
  await page.waitForFunction(() => window.__archTest.undoDepth() === 2, null, { timeout: 6000 });
  await page.evaluate((e) => window.__archTest.applySvgManual([{ op: "setHeadSize", eid: e, scale: 1.5 }], e), lineEid);
  await page.waitForFunction(() => window.__archTest.undoDepth() === 3, null, { timeout: 6000 });
  mk = await page.evaluate(() => window.__archTest.getSvgMarkers());
  const clone2 = mk.find((m) => m.clone === lineEid);
  check("(F5) 반복 조절해도 클론 1개 재사용(defs 무한증식 없음)", mk.length === 4 && clone2.id === clone.id, JSON.stringify(mk.map((m) => m.id)));
  check("(F5b) 배율은 base 기준 절대값(누적 아님): 2.2→3→1.5 후 15 / 12", +clone2.markerWidth === 15 && +clone2.markerHeight === 12 && +clone2.refX === 13.5, JSON.stringify(clone2));
  check("(F5c) 공유 #ah 여전히 바이트 동일", (await markerRaw(await src(), "ah")) === ahBefore);
  check("(F5d) bleed-diff 여전히 청결", (await bleedClean(A0, await src(), lineEid)).ok);

  // 시각 대조 스크린샷: 확대된 화살촉 vs 손대지 않은 이웃(같은 #ah 공유).
  // 3배로 키우고 패널·선택 오버레이를 치운 뒤, 두 화살표가 함께 들어가는 넉넉한 영역을 클립한다.
  await page.evaluate((e) => window.__archTest.applySvgManual([{ op: "setHeadSize", eid: e, scale: 3 }], e), lineEid);
  await page.waitForFunction(() => window.__archTest.undoDepth() === 4, null, { timeout: 6000 });
  await page.evaluate(() => window.__archTest.setMode("edit"));  // popup removed 2026-07-21: 선택 오버레이 제거(setMode가 선택 해제)
  await page.waitForTimeout(400);
  {
    const p1 = await edgeClient(lineEid), p2 = await edgeClient(neighborEid);
    const xs = [...p1, ...p2].map((p) => p.x), ys = [...p1, ...p2].map((p) => p.y);
    const PAD = 95;
    await page.screenshot({
      path: path.join(ART, "s9_edge_head.png"),
      clip: { x: sb.x + Math.min(...xs) - PAD, y: sb.y + Math.min(...ys) - PAD, width: (Math.max(...xs) - Math.min(...xs)) + PAD * 2, height: (Math.max(...ys) - Math.min(...ys)) + PAD * 2 },
    });
  }
  const headBig = (await page.evaluate(() => window.__archTest.getSvgMarkers())).find((m) => m.clone === lineEid);
  check("(F5e) 3배 적용 시 markerWidth 30 / refX 27 (비율 0.9)", +headBig.markerWidth === 30 && +headBig.refX === 27, JSON.stringify(headBig));
  check("(F5f) 그래도 공유 #ah와 이웃 화살표는 바이트 동일", (await markerRaw(await src(), "ah")) === ahBefore && (await edgeRaw(await src(), neighborEid)).outerHTML === neighborBefore.outerHTML);
  await undoAll();
  check("(F6) undo 전량으로 화살촉 편집 전체가 바이트 동일 복원(클론 defs 포함)", (await src()) === A0);
  check("(F6b) marker 3개로 복귀", (await page.evaluate(() => window.__archTest.getSvgMarkers())).length === 3);

  // 스코프·클램프 (스키마 pin + sanitize 2중)
  const scopeErr = await page.evaluate((e) => {
    const other = e === "svgedge:0" ? "svgedge:1" : "svgedge:0";
    try { window.__archTest.svgSanitize({ ops: [{ op: "flipEdge", eid: other }] }, e); return "no-throw"; }
    catch (err) { return err.name; }
  }, lineEid);
  check("(F7) 다른 eid op = ScopeViolation(화살표도 핀)", scopeErr === "ScopeViolation", scopeErr);
  const pinned = await page.evaluate((e) => {
    const s = window.__archTest.svgSchema(e);
    return s.properties.ops.items.anyOf.filter((v) => v.properties.eid).every((v) => v.properties.eid.const === e);
  }, lineEid);
  check("(F7b) 스키마의 모든 op eid가 {const:eid}로 pin", pinned);
  const clamped = await page.evaluate((e) => window.__archTest.svgSanitize({ ops: [{ op: "setHeadSize", eid: e, scale: 99 }, { op: "setHeadSize", eid: e, scale: 0.01 }] }, e), lineEid);
  check("(F7c) 화살촉 배율 클램프(0.4~4)", clamped.ops.length === 2 && clamped.ops[0].scale === 4 && clamped.ops[1].scale === 0.4 && clamped.notes.length === 2, JSON.stringify(clamped));
  const badGeom = await page.evaluate((e) => window.__archTest.svgSanitize({ ops: [{ op: "moveVertex", eid: e, index: 0, x: Infinity, y: 3 }, { op: "moveVertex", eid: e, index: -2, x: 1, y: 2 }] }, e), lineEid);
  check("(F7d) 비유한 좌표·음수 인덱스 제거", badGeom.ops.length === 0 && badGeom.notes.length === 2, JSON.stringify(badGeom));
  const oob = await page.evaluate((e) => window.__archTest.applySvgManual([{ op: "moveVertex", eid: e, index: 9, x: 10, y: 10 }], e), lineEid);
  check("(F7e) 범위 초과 인덱스는 적용 실패(소스 무변형)", !oob.ok && (await depth()) === 0 && (await src()) === A0, JSON.stringify(oob));

  // ==================== (G) 선택 모드 mock + 다운로드 라운드트립 ====================
  await setMode("select");
  await page.mouse.click(sb.x + seg0.x, sb.y + seg0.y);
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 });
  await page.fill("#fi-text", "이 화살표 방향을 반대로 뒤집어줘");
  await page.click("#fi-run");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 8000 });
  const mockFlip = (await page.evaluate(() => window.__archTest.getSvgEdges())).find((e) => e.eid === multiEid);
  check("(G1) 선택 mock: '방향 반대로' → flipEdge 적용", JSON.stringify(mockFlip.points) === JSON.stringify(before.points.slice().reverse()));
  await undoAll();
  await setMode("select");
  await page.mouse.click(sb.x + seg0.x, sb.y + seg0.y);
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 });
  await page.fill("#fi-text", "화살촉을 2배로 키워줘");
  await page.click("#fi-run");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 8000 });
  const mkG = await page.evaluate(() => window.__archTest.getSvgMarkers());
  check("(G2) 선택 mock: '화살촉 2배' → setHeadSize + 전용 클론", mkG.length === 4 && +mkG.find((m) => m.clone === multiEid).markerWidth === 20);

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 10000 }),
    page.click("#btn-download"),
  ]);
  const dl = fs.readFileSync(await download.path(), "utf8");
  check("(G3) 다운로드에 <script / 오버레이 전무", !dl.includes("<script") && !dl.includes("data-arch-overlay"));
  check("(G3b) svgedge stamp + 클론 marker + 편집 유지", dl.includes('data-arch-eid="svgedge:') && dl.includes('data-arch-edge-clone="' + multiEid + '"') && /markerWidth="20"/.test(dl));
  await page.evaluate(async (h) => { await window.__archTest.load(h, "reopened.html"); }, dl);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
  await page.waitForTimeout(250);
  const reEdges = await page.evaluate(() => window.__archTest.getSvgEdges());
  check("(G4) 재열기: 화살표 핀 보존(재채번·중복 없음, 42개)", reEdges.length === 42 && new Set(reEdges.map((e) => e.eid)).size === 42, "count=" + reEdges.length);
  check("(G4b) 재열기 후에도 화살촉 클론이 그 화살표에 유지", (reEdges.find((e) => e.eid === multiEid) || {}).headScale === 2);
  check("(G4c) 재열기 후 marker 4개(클론 1) — 중복 생성 없음", (await page.evaluate(() => window.__archTest.getSvgMarkers())).length === 4);
  sb = await stageBox();
  const rePts = await edgeClient(multiEid);
  await page.mouse.click(sb.x + (rePts[0].x + rePts[1].x) / 2, sb.y + (rePts[0].y + rePts[1].y) / 2);
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 });
  sel = await page.evaluate(() => window.__archTest.getSelected());
  check("(G5) 재열기 후에도 화살표 개별 선택 가능", sel && sel.eid === multiEid && sel.svgedge === true, JSON.stringify(sel));

  check("(z) 페이지 콘솔 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 6).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s9_failure.png") }); } catch {}
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
