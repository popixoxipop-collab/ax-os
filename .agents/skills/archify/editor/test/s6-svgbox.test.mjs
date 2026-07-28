// Stage 6 (class c) — 인라인 <svg> 슬라이드의 박스 단위 편집 그라운딩 테스트 (mock, 키 불필요).
//
// 검증 대상:
//   (a) 로드: <svg data-object> 안의 박스 <g transform="translate">가 svgbox:N으로 STAMP,
//       클릭 시 바깥 svg가 아니라 그 박스가 선택되고 오버레이가 박스만 감싼다.
//   (b) 편집: 드래그=<g transform> 이동(화면px→SVG user, CTM), 코너=<rect w/h> 리사이즈,
//       패널 fill/stroke=<rect fill/stroke>(CSS 아님), 텍스트=대표 <text> — 각각 bleed-diff 청결.
//   (c) 선택(mock): "파란색으로" → setFill op(핀된 eid만), bleed-diff 청결.
//   (d) 스코프: 다른 eid op = ScopeViolation, url()/스크립트 색 토큰 거부.
//   (e) 다운로드: svgbox stamp 유지 + 편집 반영, 스크립트/오버레이 없음.
//
// bleed-diff는 앱 로직을 재사용하지 않고 테스트가 독립 DOMParser 비교로 실증한다(순환 방지).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8617;
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

// 독립 bleed-diff: 선택 eid 외 모든 [data-arch-eid] outerHTML 바이트 동일 검증.
const diffChanged = (a, b) => page.evaluate(([ha, hb]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  const M = (d) => { const m = {}; d.querySelectorAll("[data-arch-eid]").forEach((el) => { m[el.getAttribute("data-arch-eid")] = el.outerHTML; }); return m; };
  const ma = M(P(ha)), mb = M(P(hb));
  const keys = new Set([...Object.keys(ma), ...Object.keys(mb)]);
  return [...keys].filter((k) => ma[k] !== mb[k]).sort();
}, [a, b]);

// 독립 bleed-diff (중첩 대응): SVG 박스는 바깥 svg(obj:N)의 후손이라, 박스를 편집하면 조상 svg의
// outerHTML은 필연적으로 바뀐다(=진짜 bleed 아님). 앱 로직을 재사용하지 않고 테스트가 직접:
//   (1) 편집 박스를 마스크로 치환한 뒤 문서 전체 직렬화가 before==after (박스 밖 어떤 노드도 불변)
//   (2) 편집 박스의 조상이 아닌 다른 [data-arch-eid]는 전부 outerHTML 동일
// 둘 다 통과해야 "그 박스만 변경"으로 인정. (1)은 svg 내부 화살표·이웃 박스 변조까지 잡는다.
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

// 직렬화된 소스에서 svgbox <g>의 transform/rect/텍스트를 독립 파싱.
const boxAttrs = (html, eid) => page.evaluate(([h, e]) => {
  const g = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]');
  if (!g) return null;
  const t = g.getAttribute("transform") || "";
  const m = /translate\(\s*(-?[\d.]+)(?:[ ,]+(-?[\d.]+))?\s*\)/.exec(t);
  const rect = g.querySelector("rect");
  const shape = g.querySelector("rect,polygon,path,ellipse,circle");
  const texts = [...g.querySelectorAll("text")];
  let main = texts[0], best = -1;
  for (const tx of texts) { const fs = parseFloat(tx.getAttribute("font-size")) || 0; if (fs >= best) { best = fs; main = tx; } }
  return {
    tx: m ? parseFloat(m[1]) : null, ty: m && m[2] != null ? parseFloat(m[2]) : null,
    fill: shape ? shape.getAttribute("fill") : null,
    stroke: shape ? shape.getAttribute("stroke") : null,
    w: rect ? rect.getAttribute("width") : null,
    h: rect ? rect.getAttribute("height") : null,
    text: main ? (main.textContent || "").trim() : null,
    tag: shape ? shape.tagName.toLowerCase() : null,
  };
}, [html, eid]);

async function loadSvg() {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await page.evaluate(async (h) => { await window.__archTest.load(h, "svg.html"); }, SVG_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
  await page.waitForTimeout(250);
  return await page.evaluate(() => window.__archTest.getSource());
}

try {
  // ============ (a) 로드 + 스탬프 ============
  let A0 = await loadSvg();
  const scale = await page.evaluate(() => window.__archTest.getScale());
  check("(a0) provenance = dom (class b/c)", (await page.evaluate(() => window.__archTest.getProvenance())) === "dom");
  check("(a0b) scale=1 (좌표 단순화)", scale === 1, "scale=" + scale);

  const boxes = await page.evaluate(() => window.__archTest.getSvgBoxes());
  const rectBoxes = boxes.filter((b) => b.shape === "rect");
  const nonRect = boxes.filter((b) => b.shape !== "rect");
  check("(a1) svg 박스 <g>가 32개 stamp됨", boxes.length === 32, "count=" + boxes.length);
  check("(a1b) 그중 rect 박스 22개(전 op 지원)", rectBoxes.length === 22, "rect=" + rectBoxes.length);
  check("(a1c) 나머지 10개는 게이트/다이아(path·polygon)", nonRect.length === 10, JSON.stringify(nonRect.reduce((a, b) => { a[b.shape] = (a[b.shape] || 0) + 1; return a; }, {})));
  check("(a2) 소스에 data-arch-eid=svgbox: 주소 부여", A0.includes('data-arch-eid="svgbox:'));
  const eidsUnique = await page.evaluate(() => { const s = new Set(window.__archTest.getSvgBoxes().map((b) => b.eid)); return s.size; });
  check("(a2b) 32개 eid 전부 고유", eidsUnique === 32, "unique=" + eidsUnique);

  // 바깥 svg는 여전히 obj:N 컨테이너로 존재(박스와 별개)
  const hasOuterSvgObj = await page.evaluate((h) => {
    const svg = new DOMParser().parseFromString(h, "text/html").querySelector('svg[data-object]');
    return svg && /^obj:/.test(svg.getAttribute("data-arch-eid") || "");
  }, A0);
  check("(a3) 바깥 <svg>는 obj:N 컨테이너로 유지(박스는 그 후손)", hasOuterSvgObj);

  // ============ (a') 클릭 = 박스 선택(전체 svg 아님) + 오버레이 ============
  const rectEid = rectBoxes[0].eid;
  await frame().locator('[data-arch-eid="' + rectEid + '"]').click();
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 });
  const sel = await page.evaluate(() => window.__archTest.getSelected());
  check("(a4) 박스 클릭 → 그 박스가 선택(전체 svg 아님)", sel && sel.eid === rectEid && sel.svgbox === true && sel.kind === "svgbox", JSON.stringify(sel));
  check("(a4b) 선택 eid가 obj:(전체 svg) 아님", !/^obj:/.test(sel.eid), sel && sel.eid);

  // 오버레이 rect가 박스 화면 rect와 일치(±3px, getBoundingClientRect 유래)
  const ov = await frame().locator('[data-arch-overlay="sel"]').evaluate((el) => ({ disp: getComputedStyle(el).display, l: parseFloat(el.style.left), t: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) }));
  const okOverlay = ov.disp === "block" && Math.abs(ov.w - (sel.rect.w + 4)) < 3 && Math.abs(ov.h - (sel.rect.h + 4)) < 3 && Math.abs(ov.l - (sel.rect.x - 2)) < 3;
  check("(a5) 빨간 오버레이가 박스만 감쌈(화면 rect 일치)", okOverlay, JSON.stringify({ ov, rect: sel.rect }));
  await page.screenshot({ path: path.join(ART, "s6_select.png") });

  // ============ (a'') 헤더 div는 여전히 class-b로 선택됨(혼합 슬라이드) ============
  await page.evaluate(() => window.__archTest.setMode("select"));
  await frame().locator('div[data-arch-eid]').filter({ hasText: "P03 소크라틱 검증 세션 서비스 플로우" }).first().click();
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 });
  const hdrSel = await page.evaluate(() => window.__archTest.getSelected());
  check("(a6) 헤더 div는 class-b(obj:N)로 선택 — svgbox 아님", hdrSel && /^obj:/.test(hdrSel.eid) && !hdrSel.svgbox, JSON.stringify(hdrSel));
  await page.keyboard.press("Escape");

  // ============ (b) 편집 모드: 드래그 이동 ============
  A0 = await loadSvg();
  await page.evaluate(() => window.__archTest.setMode("edit"));
  const moveEid = "svgbox:0";
  const before0 = await boxAttrs(A0, moveEid);
  await frame().locator('[data-arch-eid="' + moveEid + '"]').click();
  await page.waitForFunction(() => window.__archTest.getSelected() != null, null, { timeout: 5000 });  // popup removed 2026-07-21 → 선택 확정은 getSelected(툴바가 표면)
  const selForMove = await page.evaluate(() => window.__archTest.getSelected());
  const moveDisp = await frame().locator('[data-arch-overlay="move"]').evaluate((el) => getComputedStyle(el).display);
  const handleDisp = await frame().locator('[data-arch-overlay="handle"]').first().evaluate((el) => getComputedStyle(el).display);
  check("(b0) rect 박스 편집 선택 → 이동 오버레이 + 리사이즈 핸들 표시", moveDisp === "block" && handleDisp === "block", `move=${moveDisp} handle=${handleDisp}`);
  await page.screenshot({ path: path.join(ART, "s6_edit_handles.png") });

  // 좌상단으로 드래그(패널을 피해 iframe 위 경로 유지). 화면px 델타 == SVG user 델타(viewBox 1:1, scale 1)
  const sb = await stageBox();
  const cx = sb.x + selForMove.rect.x + selForMove.rect.w / 2;
  const cy = sb.y + selForMove.rect.y + selForMove.rect.h / 2;
  const DX = -150, DY = -100;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + DX, cy + DY, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  let S = await page.evaluate(() => window.__archTest.getSource());
  const after0 = await boxAttrs(S, moveEid);
  const dxOk = Math.abs((after0.tx - before0.tx) - DX) < 8;
  const dyOk = Math.abs((after0.ty - before0.ty) - DY) < 8;
  check("(b1) 드래그가 <g transform> translate를 화면px→user 정확 변환", dxOk && dyOk,
    `Δtranslate=(${(after0.tx - before0.tx).toFixed(1)},${(after0.ty - before0.ty).toFixed(1)}) expect≈(${DX},${DY})`);
  check("(b1b) 이동은 텍스트·크기 보존", after0.text === before0.text && after0.w === before0.w && after0.h === before0.h, JSON.stringify({ b: before0, a: after0 }));
  const moveBleed = await bleedClean(A0, S, moveEid);
  check("(b1c) bleed-diff: 이동이 그 박스만 변경(조상 svg 마스킹 후 문서 동일)", moveBleed.ok, JSON.stringify(moveBleed));
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });
  check("(b1d) undo 바이트 동일 복원", (await page.evaluate(() => window.__archTest.getSource())) === A0);

  // ============ (b2) 편집 모드: fill 변경(패널) = <rect fill> (CSS 아님) ============
  await frame().locator('[data-arch-eid="' + moveEid + '"]').click();
  await page.waitForFunction(() => window.__archTest.getSelected() != null, null, { timeout: 5000 });  // popup removed 2026-07-21 → 선택 확정은 getSelected(툴바가 표면)
  const beforeFill = (await boxAttrs(A0, moveEid)).fill;
  await page.evaluate(() => window.__archTest.fmtFill("#3b82f6"));   // popup removed → 툴바 채움(fmt-fill)
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  S = await page.evaluate(() => window.__archTest.getSource());
  const afterFill = await boxAttrs(S, moveEid);
  check("(b2) 패널 fill → <rect fill> 변경(#3b82f6)", afterFill.fill === "#3b82f6" && beforeFill !== "#3b82f6", `${beforeFill}→${afterFill.fill}`);
  check("(b2b) CSS background 아님 — <g>에 style/background 미주입", !/background/i.test(S.slice(S.indexOf('data-arch-eid="' + moveEid), S.indexOf('data-arch-eid="' + moveEid) + 400)));
  const fillBleed = await bleedClean(A0, S, moveEid);
  check("(b2c) bleed-diff: fill이 그 박스만 변경", fillBleed.ok, JSON.stringify(fillBleed));
  check("(b2d) iframe 재렌더 반영", (await frame().locator('[data-arch-eid="' + moveEid + '"] rect').first().getAttribute("fill")) === "#3b82f6");
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });

  // ============ (b3) 편집 모드: stroke 변경(패널) = <rect stroke> ============
  await frame().locator('[data-arch-eid="' + moveEid + '"]').click();
  await page.waitForFunction(() => window.__archTest.getSelected() != null, null, { timeout: 5000 });  // popup removed 2026-07-21 → 선택 확정은 getSelected(툴바가 표면)
  await page.evaluate(() => window.__archTest.fmtStroke("#b91c1c"));   // popup removed → 툴바 테두리(fmt-stroke)
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  S = await page.evaluate(() => window.__archTest.getSource());
  check("(b3) 패널 stroke → <rect stroke> 변경(#b91c1c)", (await boxAttrs(S, moveEid)).stroke === "#b91c1c");
  check("(b3b) bleed-diff: stroke가 그 박스만 변경", (await bleedClean(A0, S, moveEid)).ok);
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });

  // ============ (b4) 편집 모드: 크기(패널 W/H) = <rect width/height> + 텍스트 재중앙 ============
  await frame().locator('[data-arch-eid="' + moveEid + '"]').click();
  await page.waitForFunction(() => window.__archTest.getSelected() != null, null, { timeout: 5000 });  // popup removed 2026-07-21 → 선택 확정은 getSelected(툴바가 표면)
  const beforeSize = await boxAttrs(A0, moveEid);
  await page.evaluate(() => window.__archTest.fmtResize(200, 90));   // popup removed → 툴바 크기(fmt-w/h/size-apply)
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  S = await page.evaluate(() => window.__archTest.getSource());
  const afterSize = await boxAttrs(S, moveEid);
  check("(b4) 패널 크기 → <rect width/height> 변경(200×90)", afterSize.w === "200" && afterSize.h === "90", `${beforeSize.w}×${beforeSize.h}→${afterSize.w}×${afterSize.h}`);
  const recentered = await page.evaluate(([h, e]) => {
    const g = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]');
    return [...g.querySelectorAll('text[text-anchor="middle"]')].every((t) => parseFloat(t.getAttribute("x")) === 100);
  }, [S, moveEid]);
  check("(b4b) text-anchor=middle 텍스트가 새 폭 중앙(x=100)으로 재정렬", recentered);
  check("(b4c) bleed-diff: 리사이즈가 그 박스만 변경", (await bleedClean(A0, S, moveEid)).ok);
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });

  // ============ (b5) 편집 모드: 텍스트(패널) = 대표 <text> 줄 ============
  await frame().locator('[data-arch-eid="' + moveEid + '"]').click();
  await page.waitForFunction(() => window.__archTest.getSelected() != null, null, { timeout: 5000 });  // popup removed 2026-07-21 → 선택 확정은 getSelected(툴바가 표면)
  // popup removed 2026-07-21 → 대표 줄 텍스트 편집은 요소 편집 OFF 인라인의 커밋 경로(applyInlineCommit)로.
  const mainLine = await page.evaluate((e) => window.__archTest.svgSnapshot(e).mainLine, moveEid);
  await page.evaluate(([e, l]) => window.__archTest.applyInlineCommit(e, "svgbox", l, "새 라벨 텍스트"), [moveEid, mainLine]);
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  S = await page.evaluate(() => window.__archTest.getSource());
  const afterText = await boxAttrs(S, moveEid);
  check("(b5) 패널 텍스트 → 대표 <text> 줄 교체", afterText.text === "새 라벨 텍스트", afterText.text);
  check("(b5b) STEP 소라벨은 보존", S.includes("STEP 0.1"));
  check("(b5c) bleed-diff: 텍스트가 그 박스만 변경", (await bleedClean(A0, S, moveEid)).ok);
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });

  // ============ (b6) 비-rect 박스(게이트/다이아): 선택·이동 가능, 크기 유보 ============
  const gateEid = nonRect[0].eid;
  await frame().locator('[data-arch-eid="' + gateEid + '"]').click();
  await page.waitForFunction(() => window.__archTest.getSelected() != null, null, { timeout: 5000 });  // popup removed 2026-07-21 → 선택 확정은 getSelected(툴바가 표면)
  const gateSel = await page.evaluate(() => window.__archTest.getSelected());
  const gateHandleDisp = await frame().locator('[data-arch-overlay="handle"]').first().evaluate((el) => getComputedStyle(el).display);
  // popup removed 2026-07-21 → 크기 유보는 툴바 크기 컨트롤 비활성(boxTools().sizeApplyDisabled)으로 확인(동일 의미).
  const sizeDisabled = await page.evaluate(() => window.__archTest.boxTools().sizeApplyDisabled);
  check("(b6) 비-rect 박스도 개별 선택됨", gateSel && gateSel.eid === gateEid && gateSel.shape !== "rect", JSON.stringify(gateSel));
  check("(b6b) 비-rect 박스는 리사이즈 핸들·툴바 크기 비활성(크기 유보)", gateHandleDisp === "none" && sizeDisabled === true, `handle=${gateHandleDisp} sizeDisabled=${sizeDisabled}`);
  // 비-rect 박스 이동은 됨(fill/텍스트도)
  const gBefore = await boxAttrs(A0, gateEid);
  const gr = await page.evaluate((e) => { const s = window.__archTest.getSelected(); return s.rect; }, gateEid);
  const gcx = sb.x + gr.x + gr.w / 2, gcy = sb.y + gr.y + gr.h / 2;
  await page.mouse.move(gcx, gcy);
  await page.mouse.down();
  await page.mouse.move(gcx - 80, gcy - 70, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  S = await page.evaluate(() => window.__archTest.getSource());
  const gAfter = await boxAttrs(S, gateEid);
  const gBleed = await bleedClean(A0, S, gateEid);
  check("(b6c) 비-rect 박스 이동(<g transform>) 동작 + bleed-diff 청결", Math.abs((gAfter.tx - gBefore.tx) - (-80)) < 8 && gBleed.ok,
    `Δtx=${(gAfter.tx - gBefore.tx).toFixed(1)} bleed=${JSON.stringify(gBleed)}`);
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });

  // ============ (c) 선택 모드 mock: "파란색으로" → setFill (핀 eid만) ============
  await page.evaluate(() => window.__archTest.setMode("select"));
  const cEid = "svgbox:2";
  const cBefore = await boxAttrs(A0, cEid);
  await frame().locator('[data-arch-eid="' + cEid + '"]').click();
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 });
  check("(c0) 키 없음 → mock 자동", await page.evaluate(() => window.__archTest.isMock()));
  await page.fill("#fi-text", "이 박스를 파란색으로 바꿔줘");
  await page.click("#fi-run");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 8000 });
  S = await page.evaluate(() => window.__archTest.getSource());
  const cAfter = await boxAttrs(S, cEid);
  check("(c1) mock '파란색' → setFill(#3b82f6)", cAfter.fill === "#3b82f6" && cBefore.fill !== "#3b82f6", `${cBefore.fill}→${cAfter.fill}`);
  const cBleed = await bleedClean(A0, S, cEid);
  check("(c2) bleed-diff: 선택 박스 하나만 변경", cBleed.ok, JSON.stringify(cBleed));
  check("(c3) 텍스트·크기·위치 보존(색만)", cAfter.text === cBefore.text && cAfter.w === cBefore.w && cAfter.tx === cBefore.tx);
  await page.screenshot({ path: path.join(ART, "s6_recolor.png") });

  // ============ (d) 스코프/색 토큰 sanitize (단위) ============
  const scopeErr = await page.evaluate(() => {
    try { window.__archTest.svgSanitize({ ops: [{ op: "setFill", eid: "svgbox:9", color: "#fff" }] }, "svgbox:2"); return "no-throw"; }
    catch (e) { return e.name; }
  });
  check("(d1) 다른 eid op = ScopeViolation", scopeErr === "ScopeViolation", scopeErr);
  const badColor = await page.evaluate(() => window.__archTest.svgSanitize({ ops: [{ op: "setFill", eid: "svgbox:2", color: "url(#x)" }] }, "svgbox:2"));
  check("(d2) url() 색 토큰 거부(op 제거)", badColor.ops.length === 0 && badColor.notes.length > 0, JSON.stringify(badColor));
  const scriptColor = await page.evaluate(() => window.__archTest.svgSanitize({ ops: [{ op: "setStroke", eid: "svgbox:2", color: "javascript:alert(1)" }] }, "svgbox:2"));
  check("(d2b) javascript: 색 토큰 거부", scriptColor.ops.length === 0);
  const goodColor = await page.evaluate(() => window.__archTest.svgSanitize({ ops: [{ op: "setFill", eid: "svgbox:2", color: "rgb(10, 20, 30)" }] }, "svgbox:2"));
  check("(d2c) 유효 rgb() 토큰 통과", goodColor.ops.length === 1 && goodColor.ops[0].color === "rgb(10, 20, 30)");
  const resizeLock = await page.evaluate(() => { const nr = window.__archTest.getSvgBoxes().find((b) => b.shape !== "rect"); return window.__archTest.svgSanitize({ ops: [{ op: "resize", eid: nr.eid, width: 50, height: 50 }] }, nr.eid); });
  check("(d3) 비-rect 박스 resize op = 도형 잠금(제거)", resizeLock.ops.length === 0 && resizeLock.notes.length > 0, JSON.stringify(resizeLock.notes));

  // ============ (e) 다운로드: stamp 유지 + 편집 반영, 스크립트/오버레이 없음 ============
  A0 = await loadSvg();
  // 결정론적 편집 하나 반영 후 다운로드
  await page.evaluate(() => window.__archTest.applySvgManual([{ op: "setFill", eid: "svgbox:1", color: "#22c55e" }], "svgbox:1"));
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 10000 }),
    page.click("#btn-download"),
  ]);
  const dl = fs.readFileSync(await download.path(), "utf8");
  check("(e1) 다운로드에 <script 전무", !dl.includes("<script"));
  check("(e2) 다운로드에 오버레이 전무", !dl.includes("data-arch-overlay"));
  check("(e3) 다운로드에 svgbox stamp 유지(Q6) + fill 편집 반영", dl.includes('data-arch-eid="svgbox:') && /fill="#22c55e"/.test(dl));
  check("(e4) standalone doctype HTML", dl.trimStart().toLowerCase().startsWith("<!doctype html"));

  // 라운드트립: 편집본을 재열기 → 기존 svgbox 핀 보존(신규 stamp 0), 32개 여전히 주소·선택 가능
  await page.evaluate(async (h) => { await window.__archTest.load(h, "reopened.html"); }, dl);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
  await page.waitForTimeout(200);
  const reboxes = await page.evaluate(() => window.__archTest.getSvgBoxes());
  check("(e5) 재열기: 32개 svgbox 핀 보존(재사용/중복 없음)", reboxes.length === 32 && new Set(reboxes.map((b) => b.eid)).size === 32, "count=" + reboxes.length);
  await frame().locator('[data-arch-eid="svgbox:1"]').click();
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 });
  const reSel = await page.evaluate(() => window.__archTest.getSelected());
  check("(e6) 재열기 후에도 박스 개별 선택 가능", reSel && reSel.eid === "svgbox:1" && reSel.svgbox === true, JSON.stringify(reSel));

  check("(z) 페이지 콘솔 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 6).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s6_failure.png") }); } catch {}
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
