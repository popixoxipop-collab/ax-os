// archify 요소 편집기 — s26: D42/D44 화살표 끝점 스냅.
//   화살표 CAD 편집(D18) 중 끝점을 드래그하면 스냅 반경(EDGE_HIT_PX_FOCUS=22px, D25c 재사용) 이내의
//   D42) 다른 요소 bbox 꼭짓점(4모서리)/그 요소 자신의 두 꼭짓점 정중앙(변 중점·중심), 그리고
//   D44) 서로 다른 두 요소의 마주보는 꼭짓점 사이 정중앙(두 요소 사이 허공일 수 있음)에 정확히 달라붙는다.
//
// 검증(mock/키 불필요):
//  · (D42-A) 끝점을 어떤 박스의 꼭짓점 근처(반경 이내)로 드래그 → 커밋 좌표가 정확히 그 꼭짓점과 일치(릴리스 지점 아님)
//  · (D42-B) 그 요소 자신의 두 꼭짓점 정중앙(변 중점) 스냅 1케이스
//  · (D44) 서로 다른 두 요소(eid 상이)의 꼭짓점 사이 정중앙으로 드래그 → 그 중점에 정확히 스냅(D44 이전엔 후보에 없던 점)
//  · (C) 반경 밖(9앵커·D44중점 모두에서 먼 지점)으로 드래그하면 스냅 안 됨(자유 이동)
// ★ 결정론: "고립된"(주변 후보 없음) 스냅점만 골라 그 점+8px(반경 이내)로 끈다. D44는 릴리스 지점서 앱 스냅을
//   시뮬레이션(interElementMidpoints 독립 복제)해 반경 22px 안 유일 후보인 두요소중점만 골라 결정론 확보.
// ★ s9 검증 패턴 재사용: 실 클릭으로 엣지 선택 → 정점 핸들(vhandle) 실제 드래그(page.mouse), sb=stage 오프셋.
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

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "  — " + extra : "")); }
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: APP_DIR, stdio: "ignore" });
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { const r = await fetch(BASE + "/index.html"); up = r.ok; } catch {} if (!up) await settle(200); }
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
async function stageBox() { return await page.locator("#stage").boundingBox(); }
async function setMode(m) { await page.evaluate((mm) => window.__archTest.setMode(mm), m); await settle(250); }

// 엣지 정점을 iframe 클라이언트 좌표로 투영(스케일·viewBox 가정 없이 실측 — s9와 동일)
const edgeClient = (eid) => vf().evaluate((e) => {
  const el = document.querySelector('[data-arch-eid="' + e + '"]');
  if (!el) return null;
  const svg = el.ownerSVGElement, ctm = el.getScreenCTM(), tag = el.tagName.toLowerCase();
  let pts;
  if (tag === "line") pts = [{ x: +el.getAttribute("x1"), y: +el.getAttribute("y1") }, { x: +el.getAttribute("x2"), y: +el.getAttribute("y2") }];
  else pts = [...el.getAttribute("d").matchAll(/[ML]\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
  return pts.map((p) => { const q = svg.createSVGPoint(); q.x = p.x; q.y = p.y; const r = q.matrixTransform(ctm); return { x: r.x, y: r.y }; });
}, eid);

// 앱 collectSnapTargets를 독립 복제: 엣지 제외 모든 요소의 4모서리+변중점+중심(iframe 좌표)
const snapTargets = (exEid) => vf().evaluate((ex) => {
  const out = [];
  document.querySelectorAll("[data-arch-eid]").forEach((el) => {
    const eid = el.getAttribute("data-arch-eid") || "";
    if (eid === ex || eid.indexOf("svgedge:") === 0 || el.getAttribute("data-svgedge") === "1") return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return;
    const L = r.left, T = r.top, R = r.right, B = r.bottom, MX = (L + R) / 2, MY = (T + B) / 2;
    out.push({ x: L, y: T, kind: "corner" }, { x: R, y: T, kind: "corner" }, { x: L, y: B, kind: "corner" }, { x: R, y: B, kind: "corner" },
             { x: MX, y: T, kind: "mid" }, { x: MX, y: B, kind: "mid" }, { x: L, y: MY, kind: "mid" }, { x: R, y: MY, kind: "mid" },
             { x: MX, y: MY, kind: "center" });
  });
  return out;
}, exEid);

// D44 독립 오라클: 엣지 제외 모든 요소의 4꼭짓점(iframe 좌표) — "두 요소 사이 중점" 후보 산출용.
const snapBoxes = (exEid) => vf().evaluate((ex) => {
  const out = [];
  document.querySelectorAll("[data-arch-eid]").forEach((el) => {
    const eid = el.getAttribute("data-arch-eid") || "";
    if (eid === ex || eid.indexOf("svgedge:") === 0 || el.getAttribute("data-svgedge") === "1") return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return;
    out.push({ eid, c: [{ x: r.left, y: r.top }, { x: r.right, y: r.top }, { x: r.left, y: r.bottom }, { x: r.right, y: r.bottom }] });
  });
  return out;
}, exEid);

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// 앱 interElementMidpoints를 JS측에서 독립 복제(같은 상수·같은 상호최근접 규칙): 점 p 근방 요소쌍의 마주보는 꼭짓점 중점.
const SNAP_PAIR_FOCUS_R = 22 * 8, SNAP_NEAR_CAP = 8;   // 앱 SNAP_PAIR_FOCUS_R(176)·SNAP_NEAR_CAP(8) 미러
function d44MidsAt(boxes, p, R = SNAP_PAIR_FOCUS_R, cap = SNAP_NEAR_CAP) {
  const near = [];
  for (const b of boxes) { let dm = Infinity; for (const cc of b.c) { const d = dist(p, cc); if (d < dm) dm = d; } if (dm <= R) near.push({ b, d: dm }); }
  if (near.length < 2) return [];
  near.sort((a, z) => a.d - z.d); if (near.length > cap) near.length = cap;
  const res = [];
  for (let a = 0; a < near.length; a++) for (let z = a + 1; z < near.length; z++) {
    const A = near[a].b.c, B = near[z].b.c;
    for (let ci = 0; ci < 4; ci++) {
      const ca = A[ci]; let cb = null, cbd = Infinity;
      for (let cj = 0; cj < 4; cj++) { const dd = dist(ca, B[cj]); if (dd < cbd) { cbd = dd; cb = B[cj]; } }
      let back = null, bd = Infinity;
      for (let ck = 0; ck < 4; ck++) { const dd2 = dist(cb, A[ck]); if (dd2 < bd) { bd = dd2; back = A[ck]; } }
      if (back === ca) res.push({ x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2, kind: "d44mid", ea: near[a].b.eid, eb: near[z].b.eid });
    }
  }
  return res;
}
// 주변 minClear 안에 다른 후보(9앵커 + D44 두요소중점)가 없고, 화면 중앙부이며 fromPt에서 충분히 먼 고립 후보.
//   ★ D44 이후: 릴리스 지점(≈t) 근방에서 앱이 만들 D44 중점도 회피해야 그 9앵커로의 스냅이 여전히 유일해진다.
function pickIsolated(targets, boxes, kind, fromPt, minClear = 26) {
  let bestT = null, bestFar = 0;
  for (const t of targets) {
    if (t.kind !== kind) continue;
    if (t.x < 120 || t.y < 120 || t.x > 1800 || t.y > 960) continue;   // 뷰포트 안쪽만(핸들 가시)
    let clear = true;
    for (const o of targets) { if (o === t) continue; if (dist(o, t) < minClear) { clear = false; break; } }
    if (clear) for (const m of d44MidsAt(boxes, t)) { if (dist(m, t) < minClear) { clear = false; break; } }
    if (!clear) continue;
    const far = dist(t, fromPt);
    if (far > 140 && far > bestFar) { bestFar = far; bestT = t; }   // 끝점 원위치에서 충분히 떨어진 것
  }
  return bestT;
}
// 화면 격자에서 모든 후보(9앵커+D44중점)로부터의 최소거리를 최대화하는 "가장 빈" 지점(반경 밖 자유이동 검증용).
function pickFreest(targets, boxes, fromPt) {
  let best = null, bestClr = -1;
  for (let gx = 200; gx <= 1720; gx += 40) for (let gy = 180; gy <= 940; gy += 40) {
    const p = { x: gx, y: gy };
    if (dist(p, fromPt) < 160) continue;
    let clr = Infinity;
    for (const t of targets) { const d = dist(t, p); if (d < clr) clr = d; }
    if (clr > bestClr) { for (const m of d44MidsAt(boxes, p)) { const d = dist(m, p); if (d < clr) clr = d; } }
    if (clr > bestClr) { bestClr = clr; best = p; }
  }
  return { p: best, clr: bestClr };
}
// D44 피처 검증용: "릴리스 지점(imid+off)에서 앱의 스냅을 시뮬레이션"해서, 그 지점 반경 22px 안에 오직 그 중점만
//   들어오는(→ 앱이 반드시 그 중점으로 스냅) 두 요소 사이 중점을 고른다. off=테스트가 실제 끌 오프셋과 동일.
//   ★ 앱의 near-cap(8)이 릴리스 지점 기준으로 달라지므로, 반드시 릴리스 지점에서 d44MidsAt를 재평가해야 한다.
function pickIsolatedMid(targets, boxes, fromPt, off, minClr = 30) {
  const seeds = d44AllPairs(boxes);
  let best = null, bestClr = 0;
  for (const s of seeds) {
    if (s.x < 200 || s.y < 200 || s.x > 1720 || s.y > 900) continue;
    if (dist(s, fromPt) < 160) continue;
    const rp = { x: s.x + off.x, y: s.y + off.y };            // 테스트가 실제로 끌 릴리스 지점
    const app = d44MidsAt(boxes, rp);                          // ★ 릴리스 지점에서 앱이 산출하는 중점들
    const producedAtRp = app.some((m) => dist(m, s) < 1.5);   // 그중에 s(우리 중점)가 실제로 있는가
    if (!producedAtRp) continue;
    // 릴리스 지점 반경 22px 안 후보(9앵커+D44중점) 전수 — s만 유일해야 앱이 s로 스냅
    let inRadius = 0, sInRadius = false, secondClr = Infinity;
    const all = targets.concat(app);
    for (const c of all) {
      const d = dist(c, rp);
      if (d <= 22) { inRadius++; if (dist(c, s) < 1.5) sInRadius = true; }
      if (dist(c, s) >= 1.5) { const ds = dist(c, s); if (ds < secondClr) secondClr = ds; }   // s 제외 최근접(고립도)
    }
    if (!sInRadius || inRadius !== 1) continue;                // 반경 안에 s 하나만
    if (secondClr >= minClr && secondClr > bestClr) { bestClr = secondClr; best = { x: s.x, y: s.y, ea: s.ea, eb: s.eb, clr: secondClr }; }
  }
  return best;
}
// 전 요소쌍 상호최근접 중점(고립 씨앗 탐색용, 캡 없음)
function d44AllPairs(boxes) {
  const res = [];
  for (let a = 0; a < boxes.length; a++) for (let z = a + 1; z < boxes.length; z++) {
    const A = boxes[a].c, B = boxes[z].c;
    for (let ci = 0; ci < 4; ci++) {
      const ca = A[ci]; let cb = null, cbd = Infinity;
      for (let cj = 0; cj < 4; cj++) { const dd = dist(ca, B[cj]); if (dd < cbd) { cbd = dd; cb = B[cj]; } }
      let back = null, bd = Infinity;
      for (let ck = 0; ck < 4; ck++) { const dd2 = dist(cb, A[ck]); if (dd2 < bd) { bd = dd2; back = A[ck]; } }
      if (back === ca) res.push({ x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2, ea: boxes[a].eid, eb: boxes[z].eid });
    }
  }
  return res;
}

async function selectEdge(eid, segMid, sb) {
  await page.mouse.click(sb.x + segMid.x, sb.y + segMid.y);
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return !!(s && s.eid === e && s.svgedge); }, eid, { timeout: 6000 });
  for (let i = 0; i < 40; i++) { if ((await frame().locator('[data-arch-overlay="vhandle"]:visible').count()) > 0) break; await settle(80); }
}
// 끝점(vhandle nth 0)을 dest(iframe 좌표)로 실제 드래그
async function dragEndpointTo(destIframe, sb) {
  const hb = await frame().locator('[data-arch-overlay="vhandle"]:visible').first().boundingBox();
  const d0 = await depth();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + destIframe.x, sb.y + destIframe.y, { steps: 16 });
  await page.mouse.up();
  await page.waitForFunction((d) => window.__archTest.undoDepth() === d + 1, d0, { timeout: 6000 }).catch(() => {});
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(150);
}

try {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await page.evaluate(async (h) => { await window.__archTest.load(h, "svg.html"); }, SVG_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
  await settle(200);
  await setMode("edit");
  const sb = await stageBox();
  const scale = await page.evaluate(() => window.__archTest.getScale());
  check("(0) 로드 + 편집 모드 + scale=1(좌표 단순화)", scale === 1);

  const edges = await page.evaluate(() => window.__archTest.getSvgEdges());
  check("(0b) 편집 가능한 화살표 ≥ 1", edges.length >= 1 && edges.some((e) => e.editable), `edges=${edges.length}`);

  // 첫 편집 가능한 엣지 선택(정점 ≥2)
  const edge = edges.find((e) => e.editable && e.vertexCount >= 2);
  const A0 = await src();
  let vpts = await edgeClient(edge.eid);
  const segMid = { x: (vpts[0].x + vpts[1].x) / 2, y: (vpts[0].y + vpts[1].y) / 2 };
  await selectEdge(edge.eid, segMid, sb);
  const vc = await frame().locator('[data-arch-overlay="vhandle"]:visible').count();
  check("(1) 엣지 선택 → 정점 핸들 표시", vc >= 2, `vhandles=${vc}`);

  const targets = await snapTargets(edge.eid);
  const boxes = await snapBoxes(edge.eid);       // D44: 요소별 4꼭짓점(두 요소 사이 중점 오라클)
  const ep0 = (await edgeClient(edge.eid))[0];   // 끌 끝점(정점 0)의 현재 위치

  // ══════════ D42-A: 박스 꼭짓점 스냅 ══════════
  const corner = pickIsolated(targets, boxes, "corner", ep0, 26);
  check("(A-0) 고립된 박스 꼭짓점 후보 확보", !!corner, corner ? `${corner.x.toFixed(0)},${corner.y.toFixed(0)}` : "none");
  const OFF = 8;   // 스냅 반경(22) 이내
  await dragEndpointTo({ x: corner.x + OFF, y: corner.y + OFF }, sb);
  await page.screenshot({ path: path.join(ART, "s26_corner_snap.png") });
  let epAfter = (await edgeClient(edge.eid))[0];
  const dToCorner = dist(epAfter, corner), dToRelease = dist(epAfter, { x: corner.x + OFF, y: corner.y + OFF });
  check("(A-1) ★끝점이 릴리스 지점이 아니라 박스 꼭짓점에 정확히 스냅(±2px)",
    dToCorner < 2, `→꼭짓점 ${dToCorner.toFixed(2)}px / →릴리스 ${dToRelease.toFixed(2)}px`);
  check("(A-2) 스냅으로 릴리스 지점(꼭짓점+8,8)에서 확실히 벗어남(≈오프셋만큼)", dToRelease > OFF * 1.0, `${dToRelease.toFixed(2)}px`);
  // undo로 원복
  await page.evaluate(() => window.__archTest.undo());
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(150);
  check("(A-3) undo로 엣지 원복(A0 바이트 동일)", (await src()) === A0);

  // ══════════ D42-B: 두 꼭짓점의 정중앙(변 중점) 스냅 ══════════
  await selectEdge(edge.eid, segMid, sb);
  const ep0b = (await edgeClient(edge.eid))[0];
  const mid = pickIsolated(targets, boxes, "mid", ep0b, 26);
  check("(B-0) 고립된 변 중점(두 꼭짓점의 정중앙) 후보 확보", !!mid, mid ? `${mid.x.toFixed(0)},${mid.y.toFixed(0)}` : "none");
  await dragEndpointTo({ x: mid.x - OFF, y: mid.y + OFF }, sb);
  await page.screenshot({ path: path.join(ART, "s26_mid_snap.png") });
  epAfter = (await edgeClient(edge.eid))[0];
  const dToMid = dist(epAfter, mid);
  check("(B-1) ★끝점이 두 꼭짓점의 정중앙(변 중점)에 정확히 스냅(±2px)", dToMid < 2, `→중점 ${dToMid.toFixed(2)}px`);
  await page.evaluate(() => window.__archTest.undo());
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(150);
  check("(B-2) undo로 원복(A0 바이트 동일)", (await src()) === A0);

  // ══════════ D44: 서로 다른 두 요소의 꼭짓점 사이 정중앙 스냅 ══════════
  //   D42 이전엔 이 점이 후보에 없어 스냅 안 됐음 — D44로 스냅되는지 명확히 확인.
  await selectEdge(edge.eid, segMid, sb);
  const ep0d = (await edgeClient(edge.eid))[0];
  const imid = pickIsolatedMid(targets, boxes, ep0d, { x: -OFF, y: OFF }, 30);   // 릴리스 지점서 앱 스냅 시뮬 → 유일 후보인 두요소중점
  check("(D44-0) 서로 다른 두 요소 사이의 고립된 중점 후보 확보(두 요소 eid 상이)",
    !!imid && imid.ea !== imid.eb, imid ? `${imid.x.toFixed(0)},${imid.y.toFixed(0)} ${imid.ea}×${imid.eb} clr=${imid.clr.toFixed(0)}` : "none");
  // 이 중점이 어느 단일 요소의 9앵커도 아님(진짜 "두 요소 사이" 점)을 재확인
  const nearestAnchor = Math.min(...targets.map((t) => dist(t, imid)));
  check("(D44-1) 이 중점은 단일 요소의 9앵커가 아님(두 요소 사이 허공/경계)", nearestAnchor > 20, `nearestAnchor=${nearestAnchor.toFixed(1)}px`);
  await dragEndpointTo({ x: imid.x - OFF, y: imid.y + OFF }, sb);   // 반경 이내로 끌기
  await page.screenshot({ path: path.join(ART, "s26_d44_interelem_mid.png") });
  epAfter = (await edgeClient(edge.eid))[0];
  const dToImid = dist(epAfter, imid), dToImidRel = dist(epAfter, { x: imid.x - OFF, y: imid.y + OFF });
  check("(D44-2) ★끝점이 두 요소 사이 중점에 정확히 스냅(±2px) — D44 이전엔 후보에 없어 안 붙던 점",
    dToImid < 2, `→중점 ${dToImid.toFixed(2)}px / →릴리스 ${dToImidRel.toFixed(2)}px`);
  check("(D44-3) 스냅으로 릴리스 지점에서 확실히 벗어남(≈오프셋만큼)", dToImidRel > OFF * 1.0, `${dToImidRel.toFixed(2)}px`);
  await page.evaluate(() => window.__archTest.undo());
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(150);
  check("(D44-4) undo로 원복(A0 바이트 동일)", (await src()) === A0);

  // ══════════ D42-C: 반경 밖 → 스냅 안 됨(자유 이동) — 이제 9앵커 + D44중점 모두에서 먼 지점 ══════════
  await selectEdge(edge.eid, segMid, sb);
  const ep0c = (await edgeClient(edge.eid))[0];
  // 모든 후보(9앵커 + D44 두요소중점)로부터 최소거리를 최대화하는 가장 빈 지점(반경 22 밖 확실)
  const free = pickFreest(targets, boxes, ep0c);
  const freePt = free.p;
  check("(C-0) 모든 후보(9앵커+D44중점)서 먼 빈 지점 확보(여유 > 30px)", !!freePt && free.clr > 30, freePt ? `${freePt.x},${freePt.y} clr=${free.clr.toFixed(0)}` : "none");
  await dragEndpointTo(freePt, sb);
  epAfter = (await edgeClient(edge.eid))[0];
  const dToFree = dist(epAfter, freePt);
  const snappedAnchor = targets.some((t) => dist(epAfter, t) < 2);
  const snappedMid = d44MidsAt(boxes, freePt).some((m) => dist(epAfter, m) < 2);
  check("(C-1) 반경 밖 드래그 → 스냅 안 됨(자유 배치, 9앵커·D44중점 어디에도 안 붙음)",
    dToFree < 4 && !snappedAnchor && !snappedMid, `→릴리스 ${dToFree.toFixed(2)}px anchor=${snappedAnchor} mid=${snappedMid}`);
  await page.evaluate(() => window.__archTest.undo());
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(150);

  check("(Z) 전체 시퀀스 동안 콘솔/페이지 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 4).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 6).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s26_failure.png") }); } catch {}
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n=== s26 (D42/D44 화살표 끝점 스냅) : ${pass} pass / ${fail} fail ===`);
process.exit(fail ? 1 : 0);
