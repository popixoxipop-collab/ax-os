// s13 — 두 가지 UI 다듬기 회귀 테스트 (mock 경로, 키 불필요)
//
//  Issue 1 — 서식 툴바가 **구조적으로 뜰 수 없는** 4모드(그리기·검증·레이아웃·다듬기)에서
//    죽은 예약 공간(≈123px)을 없앤다. 측정:
//      · draw/audit/layout/polish → #fmt-bar 렌더 높이 0(display:none), 스테이지가 위로 붙음
//      · edit·select → 예약 유지, ★select↔edit 스테이지 픽셀 무이동(s9가 딛고 선 불변식)
//  Issue 2 — 화살표(svgedge) 상세 패널(#svgedge-panel)이 화살표 자신의 정점/중간점 핸들을
//    덮지 않는다. bbox 바깥 여백에 배치되므로, 어떤 스네이킹 화살표든 핸들과 무교차.
//    옛 full-bbox 배치와 비교해 실제 개선임을 실측으로 보인다(우연 아님).
//
// bleed/undo/scope는 이 테스트의 관심사가 아니다 — 순수 레이아웃/렌더링 위치만 본다.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8631;
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
async function stageBox() { return await page.locator("#stage").boundingBox(); }
const src = () => page.evaluate(() => window.__archTest.getSource());

async function loadSvg() {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await page.evaluate(async (h) => { await window.__archTest.load(h, "svg.html"); }, SVG_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
  await page.waitForTimeout(250);
  return await src();
}
async function setMode(m) {
  await page.evaluate((mm) => window.__archTest.setMode(mm), m);
  await page.waitForTimeout(260);
}
// #fmt-bar 예약 높이 + 스테이지 스크린 박스 한 번에.
async function measure() {
  return await page.evaluate(() => {
    const bar = document.getElementById("fmt-bar");
    const st = document.getElementById("stage");
    const sw = document.getElementById("stage-wrap");
    const br = bar.getBoundingClientRect(), sr = st.getBoundingClientRect();
    return {
      mode: window.__archTest.getMode(),
      barHidden: bar.hidden,
      barShown: window.__archTest.fmtBarShown(),
      barH: Math.round(br.height),
      stage: { x: Math.round(sr.x), y: Math.round(sr.y), w: Math.round(sr.width), h: Math.round(sr.height) },
      wrapTop: Math.round(sw.getBoundingClientRect().top),   // 다이어그램 뷰포트 컨테이너 상단(죽은 밴드 회수 측정)
      scale: window.__archTest.getScale(),
      inert: document.body.classList.contains("fmt-inert"),
    };
  });
}
// 뷰 프레임에서 화살표 정점을 iframe 클라이언트 좌표로 투영(스케일·viewBox 가정 없이 실측).
const vf = () => page.frames().find((f) => f !== page.mainFrame());
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
async function selectEdgeAt(eid, pt) {
  await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return !!(s && s.eid === e && s.svgedge); }, eid, { timeout: 6000 });
  // popup removed 2026-07-21 → 상세 패널을 더는 안 연다. 선택 확정은 getSelected로, 핸들은 아래에서 대기.
  const n = await page.evaluate((e) => window.__archTest.svgEdgeSnapshot(e).vertexCount, eid);
  for (let i = 0; i < 40; i++) {
    if ((await frame().locator('[data-arch-overlay="vhandle"]:visible').count()) === n) break;
    await page.waitForTimeout(100);
  }
}
// 두 스크린 사각형이 겹치는가(경계 접촉은 비겹침). margin>0이면 a를 팽창시켜 검사.
function intersects(a, b, margin = 0) {
  if (!a || !b) return false;
  return a.x - margin < b.x + b.width && a.x + a.width + margin > b.x
      && a.y - margin < b.y + b.height && a.y + a.height + margin > b.y;
}
// 옛 배치(positionFloating, full-bbox) 재현 — 개선 실증용.
function oldFloating(rectSlide, stage, scale, popW, popH, vw, vh) {
  const x = stage.x + rectSlide.x * scale;
  const y = stage.y + rectSlide.y * scale;
  const h = rectSlide.h * scale;
  const left = Math.min(Math.max(8, x), vw - popW - 8);
  let top = y + h + 10;
  if (top + popH > vh - 8) top = Math.max(8, y - popH - 10);
  return { x: left, y: top, width: popW, height: popH };
}
// 패널↔핸들 최소 간극(px). 음수면 겹침.
function minGap(panel, handles) {
  let g = Infinity;
  for (const h of handles) {
    const dx = Math.max(h.x - (panel.x + panel.width), panel.x - (h.x + h.width), 0);
    const dy = Math.max(h.y - (panel.y + panel.height), panel.y - (h.y + h.height), 0);
    g = Math.min(g, Math.hypot(dx, dy));
  }
  return g === Infinity ? null : Math.round(g);
}

try {
  await loadSvg();
  check("(0) 로드 + scale=1", (await page.evaluate(() => window.__archTest.getScale())) === 1);
  check("(0b) 초기 모드 = select", (await page.evaluate(() => window.__archTest.getMode())) === "select");

  // ══════════════ Issue 1 — 죽은 예약 공간 붕괴 ══════════════
  await setMode("select");
  const mSel = await measure();
  check("(I1) select: fmt-bar가 공간 예약(≈123px, hidden)", mSel.barH > 100 && mSel.barHidden === true && mSel.inert === false, JSON.stringify(mSel));
  await page.screenshot({ path: path.join(ART, "s13_deadspace_select.png"), clip: { x: 0, y: 0, width: 2120, height: 430 } });

  await setMode("edit");
  const mEdit = await measure();
  check("(I2) edit: fmt-bar 실제로 뜸(barShown) + 예약 높이 select와 동일", mEdit.barShown === true && Math.abs(mEdit.barH - mSel.barH) <= 1 && mEdit.inert === false, JSON.stringify(mEdit));
  check("(I2b) ★select↔edit 스테이지 픽셀 완전 무이동(s9 불변식)",
    mEdit.stage.x === mSel.stage.x && mEdit.stage.y === mSel.stage.y && mEdit.stage.w === mSel.stage.w && mEdit.stage.h === mSel.stage.h,
    "sel=" + JSON.stringify(mSel.stage) + " edit=" + JSON.stringify(mEdit.stage));
  await page.screenshot({ path: path.join(ART, "s13_deadspace_edit.png"), clip: { x: 0, y: 0, width: 2120, height: 430 } });

  await setMode("select");
  const mSel2 = await measure();
  check("(I2c) edit→select 복귀도 픽셀 동일(양방향 불변)",
    mSel2.stage.x === mSel.stage.x && mSel2.stage.y === mSel.stage.y && mSel2.stage.h === mSel.stage.h, JSON.stringify({ a: mSel.stage, b: mSel2.stage }));

  // ★ select 모드에서 요소를 골랐다 뗐다 해도 높이 불변(예약 유지) — 좌표 안정성.
  const boxes = await page.evaluate(() => window.__archTest.getSvgBoxes());
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), boxes[2].eid);
  await page.waitForTimeout(200);
  const mSelPick = await measure();
  check("(I2d) select+선택: 예약 높이 그대로 → 스테이지 무이동(선택 종속 리플로우 없음)",
    mSelPick.stage.y === mSel.stage.y && mSelPick.barH === mSel.barH, JSON.stringify({ base: mSel.stage.y, pick: mSelPick.stage.y, barH: mSelPick.barH }));
  await page.evaluate(() => window.__archTest.setMode("select"));  // 선택 해제
  await page.waitForTimeout(150);

  // 뜰 수 없는 4모드: 예약 높이 0 + 스테이지가 select보다 위
  for (const m of ["draw", "audit", "layout", "polish"]) {
    await setMode(m);
    const mm = await measure();
    check(`(I3·${m}) fmt-bar 예약 높이 0(display:none)`, mm.barH === 0 && mm.inert === true && mm.barShown === false, JSON.stringify(mm));
    check(`(I4·${m}) 스테이지가 select보다 위로 붙음(죽은 여백 제거)`, mm.stage.y < mSel.stage.y, `${m} stageTop=${mm.stage.y} vs select=${mSel.stage.y}`);
    // ★ 다이어그램 뷰포트 컨테이너(stage-wrap)가 죽은 fmt-bar 밴드를 실제로 회수했는가(센터링에 가려지지 않는 직접 신호).
    check(`(I4b·${m}) stage-wrap이 죽은 밴드를 회수(wrapTop ${mm.wrapTop} < select ${mSel.wrapTop})`, mm.wrapTop < mSel.wrapTop - 40, `${m} wrapTop=${mm.wrapTop} vs select=${mSel.wrapTop}`);
    check(`(I5·${m}) scale 불변(=1)`, mm.scale === 1, String(mm.scale));
    await page.screenshot({ path: path.join(ART, `s13_deadspace_${m}.png`), clip: { x: 0, y: 0, width: 2120, height: 430 } });
  }

  // fmtBarShown() 계약 무회귀: 4모드에서 여전히 false, edit/select+선택에서 true
  await setMode("polish");
  check("(I6) fmtBarShown() 계약 불변: 광역 모드에서 false", (await page.evaluate(() => window.__archTest.fmtBarShown())) === false);
  await setMode("edit");
  check("(I6b) fmtBarShown() 계약 불변: edit에서 true", (await page.evaluate(() => window.__archTest.fmtBarShown())) === true);

  // ══════════════ Issue 2 — ★ popup removed 2026-07-21 → 화살표 상세 패널 자체를 없앰 ══════════════
  // 원래 Issue 2는 "화살표 패널이 자기 정점/중간점 핸들을 덮지 않도록 배치되는가"였다. 이제 그 플로팅
  // 상세 패널(#svgedge-panel)이 아예 안 뜨므로(툴바 row3가 방향/화살촉/전체적용을 담당) — 중첩 문제의
  // 원인 자체가 제거됐다. 같은 화살표들을 실선택해 (a) 핸들은 그대로 뜨고 (b) 어떤 플로팅 상세 팝업도
  // 안 떠 다이어그램/핸들을 가리지 않음을 실측한다(검사 수·구조 보존).
  await setMode("edit");
  const edges = await page.evaluate(() => window.__archTest.getSvgEdges());
  const withBox = edges.filter((e) => e.editable && e.points && e.points.length >= 2).map((e) => {
    const xs = e.points.map((p) => p.x), ys = e.points.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    return { eid: e.eid, verts: e.vertexCount, area: w * h, w, h };
  }).sort((a, b) => b.area - a.area);
  check("(P0) 편집 가능한 다정점 화살표 확보", withBox.length >= 1 && withBox[0].verts >= 2, JSON.stringify(withBox.slice(0, 3)));

  const cases = withBox.slice(0, 5);
  const diag = [];
  for (let i = 0; i < cases.length; i++) {
    const eid = cases[i].eid;
    const sb = await stageBox();
    const cp = await edgeClient(eid);
    // 첫 세그먼트 중점을 실제로 클릭(선 위 — 실제 사용자 경로).
    const seg = { x: sb.x + (cp[0].x + cp[1].x) / 2, y: sb.y + (cp[0].y + cp[1].y) / 2 };
    await selectEdgeAt(eid, seg);
    // 이 화살표의 모든 정점/중간점 핸들(iframe, 스크린 좌표) — 여전히 뜬다(무회귀).
    const vh_boxes = await frame().locator('[data-arch-overlay="vhandle"]:visible').all();
    const mh_boxes = await frame().locator('[data-arch-overlay="midhandle"]:visible').all();
    const handles = [];
    for (const hb of [...vh_boxes, ...mh_boxes]) { const b = await hb.boundingBox(); if (b) handles.push(b); }
    const panelsOpen = await page.evaluate(() => window.__archTest.detailPanelsOpen());
    const anyOpen = await page.evaluate(() => window.__archTest.anyDetailPanelOpen());
    diag.push({ eid, handles: handles.length, svgedgeOpen: panelsOpen.svgedge, anyOpen });
    console.log(`  [diag ${eid}] handles=${handles.length} | svgedgePanelOpen=${panelsOpen.svgedge} anyPanelOpen=${anyOpen}`);
    // popup removed 2026-07-21 → toolbar row3: 핸들은 그대로, 화살표 상세 팝업은 안 뜬다.
    check(`(P1·${eid}) 화살표 선택 시 정점/중간점 핸들은 그대로 뜨고(핸들 ${handles.length}개) 상세 팝업은 안 뜬다`,
      handles.length > 0 && panelsOpen.svgedge === false, `handles=${handles.length} svgedgeOpen=${panelsOpen.svgedge}`);
    // popup removed 2026-07-21 → Issue2 resolved by removal: 떠서 가릴 플로팅 패널이 아예 없다.
    check(`(P1b·${eid}) 어떤 플로팅 상세 팝업도 안 떠 다이어그램/핸들을 가리지 않음(중첩 원천 소멸)`, anyOpen === false, JSON.stringify(panelsOpen));
    if (i === 0) await page.screenshot({ path: path.join(ART, "s13_arrow_panel_clear.png"), clip: { x: 0, y: 0, width: 2120, height: 900 } });
    if (eid === "svgedge:4") await page.screenshot({ path: path.join(ART, "s13_arrow_svgedge4_clear.png"), clip: { x: 0, y: 0, width: 2120, height: 900 } });
    await page.evaluate(() => window.__archTest.setMode("edit"));
    await page.waitForTimeout(180);
  }
  // ── 중첩 원인 제거의 총괄 실증(우연 아님) ──
  // popup removed 2026-07-21 → Issue2 resolved by removal: 화살표 상세 팝업이 구조적으로 사라졌으므로
  // (a) 어떤 테스트 화살표를 골라도 팝업이 안 뜨고, (b) 그래서 핸들이 무엇에도 가려질 수 없다.
  check("(P2) ★옛 겹침 원인(플로팅 상세 패널)이 구조적으로 제거됨 — 모든 케이스에서 svgedge 팝업 미개방",
    diag.length >= 1 && diag.every((d) => d.svgedgeOpen === false), JSON.stringify(diag.map((d) => [d.eid, d.svgedgeOpen])));
  check("(P3) ★따라서 핸들이 무엇에도 안 가려짐 — 덮을 플로팅 패널이 없음(모든 케이스 anyPanelOpen=false + 핸들 존재)",
    diag.length >= 1 && diag.every((d) => d.anyOpen === false && d.handles > 0), JSON.stringify(diag.map((d) => [d.eid, d.anyOpen, d.handles])));
  check("(P4) 모든 테스트 화살표: 상세 팝업 미개방 + 핸들 정상 노출(요구사항 총괄 — 중첩 원천 소멸)",
    diag.length >= 3 && diag.every((d) => d.svgedgeOpen === false && d.anyOpen === false && d.handles > 0), JSON.stringify(diag.map((d) => [d.eid, d.svgedgeOpen, d.handles])));

  check("(z) 페이지 콘솔 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 4).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 6).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s13_failure.png") }); } catch {}
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n=== s13 (Issue1 죽은여백 · Issue2 화살표패널) : ${pass} pass / ${fail} fail ===`);
process.exit(fail ? 1 : 0);
