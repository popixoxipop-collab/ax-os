// Stage 30 (D47) — Shift 정점 드래그: 서로 다른 이웃에서 x/y를 각각 따올 때 두 축을 동시에 스냅.
//
// 배경: D18의 orthoSnap은 원래 "더 가까운 축 하나만" 스냅했다(agent.js:808-819, 개정 전).
//   사용자 재현: "shift 입력 시 수직/수평 동기화가 하나만 되는 것 같다" — 중간 정점(양옆 이웃 둘 다
//   있음)이 이전 정점과는 x가, 다음 정점과는 y가 맞아떨어지는 "코너" 배치에서도 둘 중 하나만
//   맞춰지고 나머지 축은 커서를 따라갔다. D47이 두 이웃이 서로 다른 축을 대표할 때 x·y를 동시에
//   스냅하도록 개정했다 — 단 같은 이웃이 두 축 다 이기면(끝쪽 정점처럼 이웃이 하나뿐인 경우 포함)
//   기존 단일축 방식을 유지해, 안 그러면 정점이 그 이웃 위에 완전히 포개져 세그먼트 길이가 0이 되는
//   퇴화를 막는다.
//
// 검증(mock/키 불필요, demo_svg_slide.html의 기존 6정점 직교 라우팅 M228,196…L105,470 재사용 —
//   idx1=(228,210)의 이웃은 idx0=(228,196)·idx2=(14,210), 이미 idx0.x와 idx2.y가 원래 코너를
//   이루므로 "다른 이웃에서 온 값을 합치면 무엇이 나오는지"를 좌표로 명확히 실증할 수 있다):
//  (A1) Shift 없이 드래그 → 스냅 전무(원시 커서 좌표 그대로, 인테리어 정점은 D42/D44 대상도 아님) —
//       아래 스냅 테스트들의 델타가 실제로 유의미한 이동임을 먼저 확증.
//  (A2) 같은 델타를 Shift 누른 채 드래그 → 목표(200,250)가 idx0에 x로, idx2에 y로 가장 가까움
//       (서로 다른 소스) → 두 축 동시 스냅 → 정확히 idx0.x, idx2.y로 귀결.
//  (B)  목표를 idx0 쪽으로 바짝 붙여(220,196) 드래그 → idx0가 x·y 둘 다 이김(같은 소스) → 기존
//       단일축 폴백 유지 확인: y만 idx0로 스냅되고 x는 커서 그대로(=idx0 좌표로 완전히 포개지는
//       퇴화가 일어나지 않음을 실증 — 이게 없으면 세그먼트 길이 0의 회귀).
//  (C)  세 케이스 전부 bleed-diff: 그 정점(그 화살표) 외 다른 data-arch-eid는 바이트 동일.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8660;
const BASE = `http://127.0.0.1:${PORT}`;
const ART = path.join(APP_DIR, "test", "artifacts");
fs.mkdirSync(ART, { recursive: true });
const SVG_HTML = fs.readFileSync(path.join(APP_DIR, "demo_svg_slide.html"), "utf8");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "  — " + extra : "")); }
}
const eq = (a, b) => Math.abs(a - b) < 0.02;

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
async function stageBox() { return await page.locator("#stage").boundingBox(); }
const src = () => page.evaluate(() => window.__archTest.getSource());
const depth = () => page.evaluate(() => window.__archTest.undoDepth());
// 뷰 프레임에서 화살표 정점을 "iframe 클라이언트 좌표"로 투영(스케일·viewBox 가정 없이 실측 — s9/s26과 동일).
const edgeClient = (eid) => vf().evaluate((e) => {
  const el = document.querySelector('[data-arch-eid="' + e + '"]');
  if (!el) return null;
  const svg = el.ownerSVGElement, ctm = el.getScreenCTM(), tag = el.tagName.toLowerCase();
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
async function setMode(m) { await page.evaluate((mm) => window.__archTest.setMode(mm), m); await page.waitForTimeout(250); }
async function selectEdgeAt(eid, pt) {
  await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return !!(s && s.eid === e && s.svgedge); }, eid, { timeout: 6000 });
  const n = await page.evaluate((e) => window.__archTest.svgEdgeSnapshot(e).vertexCount, eid);
  for (let i = 0; i < 40; i++) {
    if ((await frame().locator('[data-arch-overlay="vhandle"]:visible').count()) === n) return n;
    await page.waitForTimeout(100);
  }
  return await frame().locator('[data-arch-overlay="vhandle"]:visible').count();
}
async function undoAll() { while ((await depth()) > 0) { await page.click("#btn-undo"); await page.waitForTimeout(120); } }
async function edgePoints(eid) { return (await page.evaluate(() => window.__archTest.getSvgEdges())).find((e) => e.eid === eid).points; }

// 독립 bleed-diff: dom-adapter.js의 maskedSerialize와 같은 원리(앱 로직 자체는 재사용 안 함, 순환 방지) —
//   대상 eid를 통째로 <arch-mask>로 치환한 뒤 문서 전체를 비교한다. 대상이 obj(class-c svg 래퍼) 안에
//   중첩된 svgedge라 그 조상(obj:N)의 outerHTML도 자식 변화로 자연히 달라지는데, 단순 "eid별 outerHTML
//   비교(대상 자기 자신만 제외)"는 이 조상까지 오탐한다 — 마스킹 방식은 대상 서브트리를 통째로 들어내
//   비교하므로 조상 문제가 애초에 발생하지 않는다.
const bleedMasked = (a, b, eid) => page.evaluate(([ha, hb, e]) => {
  const mask = (h) => {
    const d = new DOMParser().parseFromString(h, "text/html");
    const el = d.querySelector('[data-arch-eid="' + e + '"]');
    if (el) el.replaceWith(d.createElement("arch-mask"));
    return d.documentElement.outerHTML;
  };
  return mask(ha) === mask(hb);
}, [a, b, eid]);

try {
  const A0 = await loadSvg();
  const edges = await page.evaluate(() => window.__archTest.getSvgEdges());
  const eqp = (p, x, y) => Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01;
  const multiEid = (edges.find((e) => e.points && eqp(e.points[0], 228, 196)) || {}).eid;
  check("(0) 6정점 직교 라우팅(M228,196…L105,470) 확보", !!multiEid, JSON.stringify(multiEid));

  const sb = await stageBox();
  await setMode("edit");
  const mPts = await edgeClient(multiEid);
  const seg0 = { x: (mPts[0].x + mPts[1].x) / 2, y: (mPts[0].y + mPts[1].y) / 2 };   // 첫 세그먼트 중간(s9와 동일 선택 패턴)
  await selectEdgeAt(multiEid, { x: sb.x + seg0.x, y: sb.y + seg0.y });

  // idx1 핸들이 실제로 (228,210) 투영 위치 위에 있는지 먼저 확증(순서 가정 검증, s9와 동일 원칙).
  const h1 = await frame().locator('[data-arch-overlay="vhandle"]:visible').nth(1).boundingBox();
  check("(0b) vhandle[1]이 실제 idx1 정점(228,210) 위에 있음",
    Math.abs((h1.x + h1.width / 2) - (sb.x + mPts[1].x)) < 2 && Math.abs((h1.y + h1.height / 2) - (sb.y + mPts[1].y)) < 2,
    `handle=(${(h1.x + h1.width / 2).toFixed(1)},${(h1.y + h1.height / 2).toFixed(1)}) pt=(${(sb.x + mPts[1].x).toFixed(1)},${(sb.y + mPts[1].y).toFixed(1)})`);

  async function dragHandle(idx, dx, dy, { shift } = {}) {
    const hb = await frame().locator('[data-arch-overlay="vhandle"]:visible').nth(idx).boundingBox();
    const cx = hb.x + hb.width / 2, cy = hb.y + hb.height / 2;
    if (shift) await page.keyboard.down("Shift");
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps: 12 });
    await page.mouse.up();
    if (shift) await page.keyboard.up("Shift");
  }

  // ==================== (A1) Shift 없이: 스냅 전무(델타가 유의미함을 먼저 확증) ====================
  await dragHandle(1, -28, 40);   // 화면=user 델타(scale=1 기 확인된 슬라이드) → 목표 user(200,250)
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  let pts = await edgePoints(multiEid);
  check("(A1) Shift 없는 드래그는 스냅 없이 원시 좌표(200,250)로 이동(±8px, s9와 동일 드래그 정밀도 허용)",
    Math.abs(pts[1].x - 200) < 8 && Math.abs(pts[1].y - 250) < 8, JSON.stringify(pts[1]));
  let bl = await bleedMasked(A0, await src(), multiEid);
  check("(A1b) bleed: 대상 정점(그 화살표) 외 문서 전체 바이트 동일", bl);
  await undoAll();
  check("(A1c) undo 후 원상복귀", eqp((await edgePoints(multiEid))[1], 228, 210));

  // ==================== (A2) 같은 델타를 Shift 누른 채: 서로 다른 이웃에서 x/y 동시 스냅 ====================
  await selectEdgeAt(multiEid, { x: sb.x + seg0.x, y: sb.y + seg0.y });
  await dragHandle(1, -28, 40, { shift: true });   // 커서 목표 user(200,250): idx0(228,196)에 x로, idx2(14,210)에 y로 최근접
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  pts = await edgePoints(multiEid);
  check("(A2) 서로 다른 이웃의 x(idx0=228)·y(idx2=210)가 동시에 스냅", eq(pts[1].x, 228) && eq(pts[1].y, 210), JSON.stringify(pts[1]));
  check("(A2b) 이웃 정점 자체는 불변(idx0·idx2)", eqp(pts[0], 228, 196) && eqp(pts[2], 14, 210), JSON.stringify([pts[0], pts[2]]));
  bl = await bleedMasked(A0, await src(), multiEid);
  check("(A2c) bleed: 대상 정점(그 화살표) 외 문서 전체 바이트 동일", bl);
  await page.screenshot({ path: path.join(ART, "s30_dual_axis_snap.png"), clip: { x: sb.x + 0, y: sb.y + 130, width: 300, height: 200 } });
  await undoAll();

  // ==================== (B) 같은 이웃이 두 축 다 이김 → 단일축 폴백 유지(포갬 퇴화 방지) ====================
  await selectEdgeAt(multiEid, { x: sb.x + seg0.x, y: sb.y + seg0.y });
  await dragHandle(1, -8, -14, { shift: true });   // 커서 목표 user(220,196): idx0가 x·y 둘 다 최근접(같은 소스)
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  pts = await edgePoints(multiEid);
  check("(B1) 같은 이웃이 두 축 다 이기면 y만 스냅(idx0=196, 정확), x는 커서 그대로(220, ±8px)",
    Math.abs(pts[1].x - 220) < 8 && eq(pts[1].y, 196), JSON.stringify(pts[1]));
  check("(B2) idx0 좌표(228,196)로 완전히 포개지지 않음(세그먼트 길이 0 회귀 방지)", !eqp(pts[1], 228, 196), JSON.stringify(pts[1]));
  bl = await bleedMasked(A0, await src(), multiEid);
  check("(B3) bleed: 대상 정점(그 화살표) 외 문서 전체 바이트 동일", bl);
  await undoAll();

  check("(z) 페이지 콘솔 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 6).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s30_failure.png") }); } catch (_) {}
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
