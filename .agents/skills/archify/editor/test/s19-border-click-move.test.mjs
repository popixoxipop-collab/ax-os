// s19 — D30: OFF(텍스트편집) 모드에서 유닛 "테두리 클릭 = 상자 전체 이동", "내부 클릭 = 인라인 텍스트편집".
// 실제 브라우저 그라운딩(mock 경로, 키 불필요). demo_svg_slide.html(svgbox/svgtext) + p01(obj).
//
// 검증 축:
//  (A) svgbox: 내부 클릭 → 인라인 편집(회귀 가드) / 테두리 드래그 → <g transform> 이동 + bleed 청결 + undo
//  (B) svgtext: 내부 클릭 → 인라인 편집 / 바깥 테두리 드래그 → x/y 이동(작은 유닛은 바깥 링이 신뢰 grab)
//  (C) obj: 내부(리프) 클릭 → contenteditable / 테두리 드래그 → CSS left/top 이동
//  (D) hover 어포던스: 테두리 hover → 보라 이동 큐 + move 커서 / 내부·바깥 → 큐 없음
//  (E) 경계 결정론: 정확히 M 지점 분류가 반복 안정(flaky 아님) + 문서화된 포함식 규약
//  (F) 다중줄 obj: 테두리 클릭이 리프가 아니라 컨테이너 전체를 이동 + 이동 후에도 리프 정밀(D29) 유지
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

const P01 = fs.readFileSync(path.join(APP_DIR, "p01_report_snapshot.html"), "utf8");
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
const ctx = await browser.newContext({ viewport: { width: 2120, height: 1420 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));

const frame = () => page.frameLocator("#diagram-frame");
const src = () => page.evaluate(() => window.__archTest.getSource());
const depth = () => page.evaluate(() => window.__archTest.undoDepth());
const inlineState = () => page.evaluate(() => window.__archTest.inlineState());
const ceCount = () => frame().locator('[contenteditable="true"]').count();
const ceText = async () => (await frame().locator('[contenteditable="true"]').first().textContent().catch(() => null));
const moveCueDisp = () => frame().locator('[data-arch-overlay="movehover"]').evaluate((el) => getComputedStyle(el).display).catch(() => "none");
const bodyCursor = () => frame().locator("body").evaluate((el) => getComputedStyle(el).cursor).catch(() => "");
const setOffEdit = async () => { await page.evaluate(() => window.__archTest.setMode("edit")); await page.evaluate(() => window.__archTest.setElementEditOn(false)); };
const loadFixture = async (html, name) => {
  await page.evaluate(async ([h, n]) => { await window.__archTest.load(h, n); }, [html, name]);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
};
const listEids = (sel) => page.evaluate((s) => {
  const d = new DOMParser().parseFromString(window.__archTest.getSource(), "text/html");
  return [...d.querySelectorAll(s)].map((e) => e.getAttribute("data-arch-eid"));
}, sel);

// 독립 bleed-diff (중첩 대응, s6와 동일 로직). svgbox/svgtext는 바깥 <svg data-object>(obj:N)의
//   후손이라 자식을 이동하면 조상 svg의 outerHTML은 필연적으로 바뀐다(=진짜 bleed 아님). 그래서:
//   (1) 이동 유닛을 마스크로 치환한 뒤 문서 전체 직렬화가 before==after(유닛 밖 어떤 노드도 불변)
//   (2) 이동 유닛의 조상이 아닌 다른 [data-arch-eid]는 전부 outerHTML 동일
//   둘 다 통과해야 "그 유닛만 변경". (1)이 svg 내부 이웃·화살표 변조까지 잡는다.
const bleedClean = (a, b, eid) => page.evaluate(([ha, hb, e]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  const mask = (doc) => { const el = doc.querySelector('[data-arch-eid="' + e + '"]'); if (el) el.replaceWith(doc.createElement("arch-mask-test")); return doc.documentElement.outerHTML; };
  const maskedEqual = mask(P(ha)) === mask(P(hb));
  const A = P(ha), B = P(hb);
  const boxA = A.querySelector('[data-arch-eid="' + e + '"]');
  const offenders = [];
  A.querySelectorAll("[data-arch-eid]").forEach((el) => {
    const k = el.getAttribute("data-arch-eid");
    if (k === e) return;
    if (boxA && el.contains(boxA)) return;           // 조상 — (1)이 커버
    const elB = B.querySelector('[data-arch-eid="' + k + '"]');
    if (!elB || el.outerHTML !== elB.outerHTML) offenders.push(k);
  });
  return { ok: maskedEqual && offenders.length === 0, maskedEqual, offenders };
}, [a, b, eid]);

// eid 하나의 기하 속성(종류 무관 통합 판독): svgbox=<g transform>+rect, svgtext=x/y, obj=style.left/top.
const attrsOf = (html, eid) => page.evaluate(([h, e]) => {
  const el = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]');
  if (!el) return null;
  const tr = el.getAttribute("transform") || "";
  const m = /translate\(\s*(-?[\d.]+)(?:[ ,]+(-?[\d.]+))?\s*\)/.exec(tr);
  const rect = el.querySelector ? el.querySelector("rect") : null;
  return {
    tx: m ? parseFloat(m[1]) : null, ty: m ? (m[2] != null ? parseFloat(m[2]) : 0) : null,
    w: rect ? rect.getAttribute("width") : null, h: rect ? rect.getAttribute("height") : null,
    x: el.getAttribute("x"), y: el.getAttribute("y"),
    left: el.style ? el.style.left : null, top: el.style ? el.style.top : null,
    text: (el.textContent || "").replace(/\s+/g, " ").trim(),
  };
}, [html, eid]);

let scale = 1;
try {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  scale = await page.evaluate(() => (window.__archTest.getScale ? window.__archTest.getScale() : 1));
  console.log("      [info] stage scale =", scale);
  const M = 8, FRAC = 0.33;                // 구현과 동일 상수(BORDER_M, BORDER_MAX_FRAC)
  const inPx = (n) => n * scale;           // iframe-내부 px → 화면(top-level) px
  // 유닛 안쪽 테두리 링에서 "텍스트 없는 grab 지점"을 찾는다(코너·엣지 중점을 훑어 이동 큐가 뜨는 첫 점).
  //   ★ text-wins 규약: 테두리라도 텍스트 위면 이동이 arm 안 됨 → 이동 테스트는 여백/코너를 눌러야 한다.
  //   hover 큐(block)=그 점에서 borderUnitAt가 이 유닛의 이동을 arm한다는 뜻(hover·mousedown 동일 경로).
  const findGrabPoint = async (bb) => {
    const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    const cands = [
      [bb.x + inPx(3), bb.y + inPx(3)], [bb.x + bb.width - inPx(3), bb.y + inPx(3)],
      [bb.x + inPx(3), bb.y + bb.height - inPx(3)], [bb.x + bb.width - inPx(3), bb.y + bb.height - inPx(3)],
      [cx, bb.y + inPx(2)], [cx, bb.y + bb.height - inPx(2)],
      [bb.x + inPx(2), cy], [bb.x + bb.width - inPx(2), cy],
    ];
    for (const [x, y] of cands) {
      await page.mouse.move(6, 6); await page.waitForTimeout(20);
      await page.mouse.move(x, y); await page.waitForTimeout(45);
      if ((await moveCueDisp()) === "block") return { x, y };
    }
    return null;
  };

  // ═══════════════ (A) svgbox — demo_svg_slide.html ═══════════════
  await loadFixture(SVG_HTML, "svg.html");
  await setOffEdit();
  const sboxEids = await listEids('[data-svgbox="1"][data-svgbox-shape="rect"]');
  let SBOX = null, sbb = null;
  for (const eid of sboxEids) {
    const bb = await frame().locator(`[data-arch-eid="${eid}"] rect`).first().boundingBox().catch(() => null);
    if (bb && bb.height >= 30 && bb.width >= 60) { SBOX = eid; sbb = bb; break; }
  }
  check("(A0) demo에 rect svgbox 존재 + 화면 박스 확보", Boolean(SBOX && sbb), `SBOX=${SBOX}`);

  // (A1) 내부 클릭(주 텍스트 줄 중앙, 경계에서 M 이상) → 인라인 텍스트편집 열림(오늘 동작 회귀 가드)
  let mainC = null;
  {
    const texts = frame().locator(`[data-arch-eid="${SBOX}"] text`);
    const n = await texts.count();
    let best = null;
    for (let i = 0; i < n; i++) { const bb = await texts.nth(i).boundingBox().catch(() => null); if (bb && (!best || bb.height > best.h)) best = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2, h: bb.height }; }
    mainC = best;
  }
  await page.mouse.click(mainC.x, mainC.y);
  await page.waitForTimeout(150);
  const A1s = await inlineState();
  check("(A1) svgbox 내부 클릭 → 인라인 편집 열림(같은 svgbox, 회귀 가드)", A1s && A1s.eid === SBOX && A1s.kind === "svgbox", JSON.stringify(A1s));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);

  // (A2) 테두리 클릭(내부 상단 경계, M 미만) → 드래그 이동. 인라인 편집 안 열림 + <g transform> 정확 이동 + bleed + undo
  const A0svg = await src();
  const beforeSB = await attrsOf(A0svg, SBOX);
  const bTop = { x: sbb.x + sbb.width / 2, y: sbb.y + inPx(3) };   // 상단 경계 안쪽 3px(iframe) = 테두리
  const DX = -130, DY = -80;
  await page.mouse.move(bTop.x, bTop.y);
  await page.mouse.down();
  const midCue = await moveCueDisp();
  await page.mouse.move(bTop.x + DX, bTop.y + DY, { steps: 14 });
  await page.screenshot({ path: path.join(ART, "s19_A_svgbox_middrag.png") });
  await page.mouse.up();
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 }).catch(() => {});
  const A2s = await inlineState();
  const Ssvg = await src();
  const afterSB = await attrsOf(Ssvg, SBOX);
  const dxOk = Math.abs((afterSB.tx - beforeSB.tx) - DX / scale) < 8;
  const dyOk = Math.abs((afterSB.ty - beforeSB.ty) - DY / scale) < 8;
  check("(A2) svgbox 테두리 클릭 → 인라인 편집 안 열림(이동만)", A2s === null, JSON.stringify(A2s));
  check("(A2b) 테두리 드래그가 <g transform>를 화면px→user 정확 이동", dxOk && dyOk,
    `Δ=(${(afterSB.tx - beforeSB.tx).toFixed(1)},${(afterSB.ty - beforeSB.ty).toFixed(1)}) expect≈(${(DX / scale).toFixed(0)},${(DY / scale).toFixed(0)})`);
  check("(A2c) 이동은 텍스트·크기 보존", afterSB.text === beforeSB.text && afterSB.w === beforeSB.w && afterSB.h === beforeSB.h);
  const A2bleed = await bleedClean(A0svg, Ssvg, SBOX);
  check("(A2d) bleed-diff: 이동이 그 svgbox만 변경(조상 svg 마스킹 후 문서 동일)", A2bleed.ok, JSON.stringify(A2bleed));
  await page.screenshot({ path: path.join(ART, "s19_A_svgbox_afterdrag.png") });
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });
  check("(A2e) undo가 바이트 동일 복원", (await src()) === A0svg);

  // (A3) 테두리 클릭(드래그 없음) → 무동작(이동도 인라인편집도 없음)
  await page.mouse.click(bTop.x, bTop.y);
  await page.waitForTimeout(150);
  check("(A3) 테두리 단순 클릭(무드래그) → 인라인 편집 안 열림 + 무커밋", (await inlineState()) === null && (await depth()) === 0);

  // ═══════════════ (D) hover 어포던스 (svgbox 기준) ═══════════════
  await page.mouse.move(bTop.x, bTop.y);          // 테두리 hover
  await page.waitForTimeout(80);
  const hoverBorderCue = await moveCueDisp();
  const hoverBorderCur = await bodyCursor();
  const clip = { x: Math.max(0, sbb.x - 50), y: Math.max(0, sbb.y - 50), width: sbb.width + 100, height: sbb.height + 100 };
  await page.screenshot({ path: path.join(ART, "s19_D_hover_border_cue.png"), clip });
  check("(D1) 테두리 hover → 이동 큐(보라 점선) 표시 + move 커서", hoverBorderCue === "block" && hoverBorderCur === "move", `disp=${hoverBorderCue} cur=${hoverBorderCur}`);
  await page.mouse.move(mainC.x, mainC.y);        // 내부 hover
  await page.waitForTimeout(80);
  const hoverInsideCue = await moveCueDisp();
  const hoverInsideCur = await bodyCursor();
  check("(D2) 내부 hover → 이동 큐 없음 + 텍스트 커서(인라인 편집 어포던스와 구분)", hoverInsideCue === "none" && hoverInsideCur === "text", `disp=${hoverInsideCue} cur=${hoverInsideCur}`);
  await page.mouse.move(5, 5);                     // 유닛 밖(빈 영역) hover
  await page.waitForTimeout(80);
  const hoverOutCue = await moveCueDisp();
  check("(D3) 유닛 밖 hover → 이동 큐 사라짐", hoverOutCue === "none", `disp=${hoverOutCue}`);

  // ═══════════════ (E) 경계 결정론: 내부/테두리 전이는 상단에서 정확히 M(=8px)에서 일어난다 ═══════════════
  //   구현은 포함식(>=)이라 "경계에서 정확히 M 안쪽"은 내부지만, 화면좌표는 서브픽셀이므로 그 단일
  //   픽셀 대신 (E1) 그 지점의 반복 결정론 + (E2/E3) 양쪽 브래킷으로 규약을 실증한다(flaky 아님).
  const myIframe = Math.min(M, (sbb.height / scale) * FRAC);   // 축별 유효 마진(iframe px, 여기선 8)
  const cx = sbb.x + sbb.width / 2;
  const atY = async (y) => { await page.mouse.move(5, 5); await page.waitForTimeout(30); await page.mouse.move(cx, y); await page.waitForTimeout(55); return moveCueDisp(); };
  const results = [];
  for (let i = 0; i < 3; i++) { await page.mouse.move(20 + i, 30 + i); await page.waitForTimeout(35); await page.mouse.move(cx, sbb.y + inPx(myIframe)); await page.waitForTimeout(55); results.push(await moveCueDisp()); }
  check("(E1) 정확히 M 경계점 분류가 3회 반복 안정(결정론적·flaky 아님)", results.every((r) => r === results[0]), JSON.stringify(results));
  check("(E2) 경계에서 M 이상 안쪽(M+4px)은 내부 — 이동 큐 없음", (await atY(sbb.y + inPx(myIframe + 4))) === "none");
  check("(E3) 경계에서 M 미만(M−4px, 테두리 쪽)은 이동 큐 표시", (await atY(sbb.y + inPx(Math.max(1, myIframe - 4)))) === "block");

  // ═══════════════ (B) svgtext — demo_svg_slide.html ═══════════════
  const stextEids = await listEids('[data-svgtext="1"]');
  let STEXT = null, tbb = null;
  for (const eid of stextEids) {
    const bb = await frame().locator(`[data-arch-eid="${eid}"]`).boundingBox().catch(() => null);
    if (bb && bb.width >= 18 && bb.height >= 8) {
      // 위쪽 3px가 비어 있어야(다른 유닛과 안 겹침) 바깥 링 grab이 그 텍스트를 고른다.
      STEXT = eid; tbb = bb; break;
    }
  }
  check("(B0) demo에 svgtext(자유 텍스트) 존재", Boolean(STEXT && tbb), `STEXT=${STEXT}`);
  // (B1) 내부 클릭 → 인라인 편집(svgtext)
  await page.mouse.click(tbb.x + tbb.width / 2, tbb.y + tbb.height / 2);
  await page.waitForTimeout(150);
  const B1s = await inlineState();
  check("(B1) svgtext 내부 클릭 → 인라인 편집 열림(svgtext)", B1s && B1s.eid === STEXT && B1s.kind === "svgtext", JSON.stringify(B1s));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  // (B2) 바깥 테두리 드래그(텍스트 바로 위 3px 밖 = 바깥 링) → x/y 이동
  const A0t = await src();
  const beforeST = await attrsOf(A0t, STEXT);
  const tB = { x: tbb.x + tbb.width / 2, y: tbb.y - inPx(3) };   // 위쪽 바깥 3px = 바깥 테두리 링
  const cueAtOut = await (async () => { await page.mouse.move(tB.x, tB.y); await page.waitForTimeout(70); return moveCueDisp(); })();
  const TDX = -60, TDY = -40;
  await page.mouse.move(tB.x, tB.y);
  await page.mouse.down();
  await page.mouse.move(tB.x + TDX, tB.y + TDY, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 }).catch(() => {});
  const St = await src();
  const afterST = await attrsOf(St, STEXT);
  const tdxOk = beforeST.x != null && Math.abs((parseFloat(afterST.x) - parseFloat(beforeST.x)) - TDX / scale) < 10;
  const tdyOk = beforeST.y != null && Math.abs((parseFloat(afterST.y) - parseFloat(beforeST.y)) - TDY / scale) < 10;
  check("(B2) svgtext 바깥 테두리 hover → 이동 큐(작은 유닛 grab 경로)", cueAtOut === "block", `disp=${cueAtOut}`);
  check("(B2b) svgtext 테두리 드래그 → x/y 이동 + 인라인 편집 안 열림", tdxOk && tdyOk && (await inlineState()) === null,
    `Δxy=(${beforeST.x}->${afterST.x}, ${beforeST.y}->${afterST.y}) expect≈(${(TDX / scale).toFixed(0)},${(TDY / scale).toFixed(0)})`);
  const B2bleed = await bleedClean(A0t, St, STEXT);
  check("(B2c) bleed-diff: 이동이 그 svgtext만 변경(조상 svg 마스킹 후 문서 동일)", B2bleed.ok, JSON.stringify(B2bleed));
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });
  check("(B2d) undo 바이트 동일 복원", (await src()) === A0t);

  // ═══════════════ (C) obj — p01_report_snapshot.html ═══════════════
  await loadFixture(P01, "p01.html");
  await setOffEdit();
  // 툴바와 안 겹치는 textbox obj 중, 내부에 텍스트가 있고(C1 인라인) 테두리 여백에 텍스트 없는
  //   grab 지점이 있는(C2 이동) 것을 고른다. text-wins 규약상 이동은 여백/코너에서만 arm된다.
  const objEids = await listEids('[data-object-type="textbox"][data-arch-eid]');
  let OBJ = null, obb = null, oGrab = null;
  for (const eid of objEids) {
    const bb = await frame().locator(`[data-arch-eid="${eid}"]`).boundingBox().catch(() => null);
    if (!bb || bb.y <= 220 || bb.height < 40 || bb.height > 260 || bb.width < 80 || bb.width > 520) continue;
    const g = await findGrabPoint(bb);
    if (g) { OBJ = eid; obb = bb; oGrab = g; break; }
  }
  check("(C0) p01에 textbox obj 확보(내부 텍스트 + 테두리 여백 grab 지점)", Boolean(OBJ && obb && oGrab), `OBJ=${OBJ} grab=${oGrab && "y"}`);
  // (C1) 내부(리프) 클릭 → contenteditable 인라인 편집
  await page.mouse.click(obb.x + obb.width / 2, obb.y + obb.height / 2);
  await page.waitForTimeout(200);
  const C1s = await inlineState();
  check("(C1) obj 내부 클릭 → contenteditable 인라인 편집(obj)", (await ceCount()) > 0 && C1s && C1s.eid === OBJ && C1s.kind === "obj", JSON.stringify(C1s));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  // (C2) 테두리 여백(grab 지점) 드래그 → CSS left/top 이동
  const A0o = await src();
  const beforeO = await attrsOf(A0o, OBJ);
  const oB = oGrab;
  const ODX = -100, ODY = -60;
  await page.mouse.move(oB.x, oB.y);
  await page.mouse.down();
  await page.mouse.move(oB.x + ODX, oB.y + ODY, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 }).catch(() => {});
  const So = await src();
  const afterO = await attrsOf(So, OBJ);
  const oLeftOk = Math.abs((parseFloat(afterO.left) - parseFloat(beforeO.left)) - ODX / scale) < 10;
  const oTopOk = Math.abs((parseFloat(afterO.top) - parseFloat(beforeO.top)) - ODY / scale) < 10;
  check("(C2) obj 테두리 드래그 → CSS left/top 이동 + 인라인 편집 안 열림", oLeftOk && oTopOk && (await inlineState()) === null,
    `Δlt=(${beforeO.left}->${afterO.left}, ${beforeO.top}->${afterO.top})`);
  const C2bleed = await bleedClean(A0o, So, OBJ);
  check("(C2b) bleed-diff: 이동이 그 obj만 변경", C2bleed.ok, JSON.stringify(C2bleed));
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });
  check("(C2c) undo 바이트 동일 복원", (await src()) === A0o);

  // ═══════════════ (F) 다중줄 obj: 테두리=컨테이너 이동, 내부=리프 정밀(D29 이동 후 유지) ═══════════════
  const MOBJ = "obj:26";                          // "실행 전제" 노드박스(SECURITY/AND/실행 전제/PDF ∧ key ∧ proxy)
  const mbb = await frame().locator(`[data-arch-eid="${MOBJ}"]`).boundingBox().catch(() => null);
  check("(F0) 다중줄 obj(obj:26) 화면 박스 확보", Boolean(mbb), `mbb=${JSON.stringify(mbb)}`);
  const A0m = await src();
  const leavesBefore = await page.evaluate((e) => window.__archTest.objLineTargetCount(e), MOBJ);
  const beforeM = await attrsOf(A0m, MOBJ);
  const mB = (await findGrabPoint(mbb)) || { x: mbb.x + inPx(3), y: mbb.y + inPx(3) };   // 텍스트 없는 테두리 여백
  await page.mouse.move(mB.x, mB.y);
  await page.mouse.down();
  await page.mouse.move(mB.x - 90, mB.y - 50, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 }).catch(() => {});
  const Sm = await src();
  const afterM = await attrsOf(Sm, MOBJ);
  const leavesAfter = await page.evaluate((e) => window.__archTest.objLineTargetCount(e), MOBJ);
  const movedWhole = Math.abs((parseFloat(afterM.left) - parseFloat(beforeM.left)) - (-90) / scale) < 12;
  const Fbleed = await bleedClean(A0m, Sm, MOBJ);
  check("(F1) 다중줄 obj 테두리 클릭 → 리프 아닌 컨테이너 전체 이동", movedWhole && (await inlineState()) === null, `Δleft=${beforeM.left}->${afterM.left}`);
  check("(F1b) 이동이 모든 리프 보존(줄 수 불변) + bleed 청결", leavesAfter === leavesBefore && Fbleed.ok, `leaves ${leavesBefore}->${leavesAfter} bleed=${JSON.stringify(Fbleed)}`);
  // 이동 후, 특정 리프("AND") 내부 클릭 → 그 리프만 정확히 열림(D29 정밀 유지)
  await frame().locator(`[data-arch-eid="${MOBJ}"]`).getByText("AND", { exact: true }).first().click();
  await page.waitForTimeout(200);
  const leafOpen = await ceText();
  const Fls = await inlineState();
  check("(F2) 이동 후에도 내부 리프 클릭이 정확한 리프('AND')를 연다(D29 불변)", (leafOpen || "").trim() === "AND" && Fls && Fls.eid === MOBJ, `leafOpen=${JSON.stringify(leafOpen)} state=${JSON.stringify(Fls)}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 }).catch(() => {});

  // ═══════════════ 콘솔 청결 ═══════════════
  check("(Z) 페이지 콘솔 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 4).join(" | "));
  console.log("      [info] mid-drag 이동 큐(참고) =", midCue);
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s19_failure.png") }); } catch {}
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
