// Stage 20 (D31-실행) — 비-rect svgbox 정렬 오버플로 수정 (mock, 키 불필요).
//
// 버그(스크린샷으로 확정, 계획 §13 감사 4번): 다이아몬드(polygon)·게이트(path) svgbox에서 정렬을 적용하면
//   x 재계산이 도형 외곽 bbox 폭(=중앙 최대폭) 기준이라, 텍스트 줄의 y위치에서 실제 도형 폭이 훨씬 좁은데도
//   x를 x1-pad로 밀어 글자가 뾰족한 모서리를 뚫고 나간다. bbox(글자 bbox ⊆ 도형 bbox) 판정으론 못 잡힌다 —
//   실제 렌더 글자 bbox를 도형의 진짜 points에 point-in-polygon으로 대조해야 잡힌다.
// 수정(disable-with-reason, resize가 rect 전용인 것과 동형):
//   ① editor.js fmtCap("align") — 비-rect svgbox 인라인 편집 중엔 정렬 비활성 + 사유.
//   ② editor.js fmtApplyAlign — 프로그램/테스트 경로도 같은 사유로 no-op(버튼은 이미 disabled).
//   ③ svg-adapter.js applyTextStyleTo — ownerBox.kind==="rect"에서만 x 재계산(비-rect는 원 위치 유지).
// 불변식: rect svgbox 정렬(정상)·obj 정렬(CSS)·svgtext 정렬 미지원(설계)·줄 스코프(D26)는 모두 무변경.
//
// bleed-diff는 앱 로직을 재사용하지 않고 테스트가 독립 DOMParser 비교로 실증한다(순환 방지).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8641;
const BASE = `http://127.0.0.1:${PORT}`;
const ART = path.join(APP_DIR, "test", "artifacts");
fs.mkdirSync(ART, { recursive: true });
const SVG_HTML = fs.readFileSync(path.join(APP_DIR, "demo_svg_slide.html"), "utf8");
const P01_HTML = fs.readFileSync(path.join(APP_DIR, "p01_report_snapshot.html"), "utf8");
const REASON_KEY = "사각형";   // 사유 문구의 핵심 키워드(FMT_ALIGN_NONRECT_WHY)

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
const page = await browser.newPage({ viewport: { width: 2200, height: 1500 } });
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));

const frame = () => page.frameLocator("#diagram-frame");
const vf = () => page.frames().find((f) => f !== page.mainFrame());
const src = () => page.evaluate(() => window.__archTest.getSource());
const depth = () => page.evaluate(() => window.__archTest.undoDepth());
const settle = (ms) => page.waitForTimeout(ms == null ? 350 : ms);
async function stageBox() { return await page.locator("#stage").boundingBox(); }
const capOk = (ctrl) => page.evaluate((c) => window.__archTest.fmtCap(c).ok, ctrl);
const capFull = (ctrl) => page.evaluate((c) => window.__archTest.fmtCap(c), ctrl);
const loadSvg = async () => { await page.evaluate(async (h) => { await window.__archTest.load(h, "svg.html"); }, SVG_HTML); await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 }); await settle(300); };

async function enterOff() {
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await settle(180);
  await page.evaluate(() => window.__archTest.setElementEditOn(false));
  await settle(200);
}
// 소스에서 박스 줄의 x/anchor/y 읽기
const lineAttrs = (html, eid) => page.evaluate(([h, e]) => {
  const g = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]');
  if (!g) return null;
  return [...g.children].filter((c) => c.tagName.toLowerCase() === "text").map((t) => ({
    x: parseFloat(t.getAttribute("x")), anchor: t.getAttribute("text-anchor") || "start", txt: (t.textContent || "").trim(),
  }));
}, [html, eid]);
// 화면좌표(iframe bbox + stage offset)로 박스 줄 중심
async function lineClientOfBox(eid, i) {
  return await vf().evaluate(([e, k]) => {
    const g = document.querySelector('[data-arch-eid="' + e + '"]');
    const ts = [...g.children].filter((c) => c.tagName.toLowerCase() === "text");
    const r = ts[k].getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, left: r.left, top: r.top, w: r.width, h: r.height };
  }, [eid, i]);
}
const inlineInput = () => vf().evaluate(() => { const i = document.querySelector('[data-arch-overlay="inline"]'); return i ? { present: true } : null; });
// 조상-안전 bleed-diff(s15와 동일): 대상 eid를 마스크로 치환해 전체 문서 비교 + 형제 offender 목록.
//   대상의 조상(바깥 svg 컨테이너 등)은 대상을 포함하므로 outerHTML이 필연적으로 바뀐다 → mask가 커버.
const bleedClean = (a, b, eid) => page.evaluate(([ha, hb, e]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  const A = P(ha), B = P(hb);
  const unitA = A.querySelector('[data-arch-eid="' + e + '"]');
  const offenders = [];
  A.querySelectorAll("[data-arch-eid]").forEach((el) => {
    const k = el.getAttribute("data-arch-eid");
    if (k === e) return;
    if (unitA && el.contains(unitA)) return;              // 조상 — mask가 커버
    const elB = B.querySelector('[data-arch-eid="' + k + '"]');
    if (!elB || el.outerHTML !== elB.outerHTML) offenders.push(k);
  });
  const mask = (doc) => { const el = doc.querySelector('[data-arch-eid="' + e + '"]'); if (el) el.replaceWith(doc.createElement("m-mask")); return doc.documentElement.outerHTML; };
  return { ok: mask(A) === mask(B) && !offenders.length, offenders };
}, [a, b, eid]);
// ★ 실제 렌더 글자 bbox(로컬 user 좌표) vs 도형 실제 points의 point-in-polygon (이 버그를 잡는 유일한 방법)
const glyphVsShape = (eid, i) => vf().evaluate(([e, k]) => {
  const g = document.querySelector('[data-arch-eid="' + e + '"]');
  const ts = [...g.children].filter((c) => c.tagName.toLowerCase() === "text");
  const t = ts[k];
  const bb = t.getBBox();   // 로컬 user 좌표 — polygon points와 같은 공간(같은 <g> 자식)
  const poly = g.querySelector("polygon");
  const pts = (poly.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number);
  const P = []; for (let j = 0; j + 1 < pts.length; j += 2) P.push([pts[j], pts[j + 1]]);
  const inPoly = (x, y) => { let inside = false; for (let a = 0, b = P.length - 1; a < P.length; b = a++) { const [xi, yi] = P[a], [xj, yj] = P[b]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside; } return inside; };
  const corners = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height / 2]];
  const outside = corners.filter(([x, y]) => !inPoly(x, y));
  return { bb: { x: bb.x, y: bb.y, w: bb.width, h: bb.height }, rightEdge: bb.x + bb.width, outside, allInside: outside.length === 0 };
}, [eid, i]);
// 다이아 화면 영역 클립(패딩)
async function boxClip(eid, pad = 60) {
  const sb = await stageBox();
  const r = await vf().evaluate((e) => { const el = document.querySelector('[data-arch-eid="' + e + '"]'); const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, w: b.width, h: b.height }; }, eid);
  return { x: Math.max(0, sb.x + r.left - pad), y: Math.max(0, sb.y + r.top - pad), width: r.w + pad * 2, height: r.h + pad * 2 };
}

try {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await loadSvg();
  const A0 = await src();

  // 도형 분포 확인 — 6 polygon + 4 path = 10 non-rect (계획/probe와 일치)
  const boxes = await page.evaluate(() => window.__archTest.getSvgBoxes());
  const hist = boxes.reduce((a, b) => { a[b.shape] = (a[b.shape] || 0) + 1; return a; }, {});
  const nonRect = boxes.filter((b) => b.shape !== "rect");
  check("(S0) svgbox 분포: rect 22 + polygon 6 + path 4 (non-rect 10)", hist.rect === 22 && hist.polygon === 6 && hist.path === 4 && nonRect.length === 10, JSON.stringify(hist));

  // ══════════ (A) 회귀 가드 — rect svgbox 정렬은 이전 그대로 동작(먼저 증명) ══════════
  const RECT = "svgbox:0";   // 2줄 rect "STEP 0.1 | P02 finding 선택" (계획 §13 실측 대상)
  const rectBox = await page.evaluate((e) => window.__archTest.svgShapeBox(e), RECT);
  check("(A0) svgbox:0은 rect", (await page.evaluate((e) => window.__archTest.getSvgBoxes().find((b) => b.eid === e).shape, RECT)) === "rect");
  await enterOff();
  let sb = await stageBox(); let lb = await lineClientOfBox(RECT, 1);   // 줄 2(index 1)
  await page.mouse.click(sb.x + lb.cx, sb.y + lb.cy);
  await settle(320);
  check("(A1) rect 줄 클릭 → 인라인 세션", !!(await inlineInput()));
  check("(A2) rect 인라인 편집 중 정렬 cap = 활성(회귀 없음)", (await capOk("align")) === true);
  const rectPre = (await lineAttrs(A0, RECT))[1];
  await page.click("#fmt-align-end");
  await settle(200);
  await frame().locator('[data-arch-overlay="inline"]').press("Enter");
  await page.waitForFunction(() => window.__archTest.undoDepth() >= 1, null, { timeout: 6000 });
  await settle(300);
  const S_A = await src();
  const rectPost = (await lineAttrs(S_A, RECT))[1];
  const rectInBounds = rectPost.anchor === "end" && rectPost.x > rectPre.x && rectPost.x <= rectBox.x1 && rectPost.x >= rectBox.x0;
  check("(A3) ★ rect 우측정렬: anchor=end + x가 오른쪽으로 이동하되 도형 안쪽([x0,x1])", rectInBounds,
    JSON.stringify({ pre: rectPre.x, post: rectPost.x, box: { x0: rectBox.x0, x1: rectBox.x1 } }));
  // 렌더 글자 bbox 우측 끝 ≤ rect 우측 경계(shapeBox의 x1, x-default-0 정확 처리) — 실측 in-bounds
  const rectGlyphRight = await vf().evaluate((e) => { const g = document.querySelector('[data-arch-eid="' + e + '"]'); const ts = [...g.children].filter((c) => c.tagName.toLowerCase() === "text"); const bb = ts[1].getBBox(); return bb.x + bb.width; }, RECT);
  check("(A4) ★ rect 렌더 글자 우측 끝 ≤ 도형 우측 경계(오버플로 없음)", rectGlyphRight <= rectBox.x1 + 0.5, JSON.stringify({ right: rectGlyphRight, x1: rectBox.x1 }));
  await page.screenshot({ path: path.join(ART, "s20_rect_align_ok.png"), clip: await boxClip(RECT, 40) });
  await page.keyboard.press("Meta+z"); await settle(400);
  check("(A5) rect 정렬 undo 바이트 동일 복원", (await src()) === A0);

  // ══════════ (B) 다이아 svgbox:12 — 정렬 비활성 + 사유(disable-with-reason) ══════════
  const DIA = "svgbox:12";   // "3.2 | traffic ≥ 30?" polygon 50,0 100,30 50,60 0,30
  await page.evaluate(() => window.__archTest.setElementEditOn(true));   // OFF 아님 상태로 렌더 스샷(오버레이 없음)
  await settle(200);
  const diaBaseline = await glyphVsShape(DIA, 0);
  check("(B0) ★ 기준선: 다이아 '3.2' 렌더 글자가 도형 실제 polygon 안(point-in-polygon)", diaBaseline.allInside, JSON.stringify(diaBaseline));
  await page.screenshot({ path: path.join(ART, "s20_diamond_before.png"), clip: await boxClip(DIA, 70) });
  // 인라인 편집 진입 → 정렬 비활성 확인
  await enterOff();
  sb = await stageBox(); lb = await lineClientOfBox(DIA, 0);   // "3.2" 줄
  await page.mouse.click(sb.x + lb.cx, sb.y + lb.cy);
  await settle(320);
  check("(B1) 다이아 '3.2' 줄 클릭 → 인라인 세션", !!(await inlineInput()));
  const diaCap = await capFull("align");
  check("(B2) ★ 다이아 인라인 편집 중 정렬 cap = 비활성", diaCap.ok === false, JSON.stringify(diaCap));
  check("(B3) ★ 비활성 사유가 '사각형' 안내를 담음", typeof diaCap.why === "string" && diaCap.why.includes(REASON_KEY), diaCap.why);
  const alignDom = await page.evaluate(() => ["start", "middle", "end"].map((a) => { const el = document.getElementById("fmt-align-" + a); return { a, disabled: !!el.disabled, title: el.title }; }));
  check("(B4) ★ 정렬 버튼 3개 DOM disabled + title=사유", alignDom.every((x) => x.disabled === true && x.title.includes(REASON_KEY)), JSON.stringify(alignDom));
  await page.locator("#fmt-bar").screenshot({ path: path.join(ART, "s20_diamond_inline_align_disabled.png") });
  // 프로그램 경로(fmtApplyAlign)도 no-op — 소스 무변경
  const preNoop = await src();
  await page.evaluate(() => window.__archTest.fmtAlign("end"));
  await settle(250);
  check("(B5) ★ fmtAlign('end') 프로그램 호출도 no-op(소스 무변경 — pending도 안 쌓임)", (await src()) === preNoop);
  await frame().locator('[data-arch-overlay="inline"]').press("Escape").catch(() => {});
  await settle(250);

  // ══════════ (C) 어댑터 방어선(edit ③) — 강제 raw op이 와도 x가 안 밀림 + 오버플로 없음 ══════════
  //   UI는 이미 막았지만 LLM op·다줄 일괄 등 프로그램 경로가 setTextStyle{textAnchor}를 보낼 수 있다 →
  //   applyTextStyleTo가 rect에서만 x를 옮기므로 다이아는 x 유지(구버전이면 x가 50→~94로 튀어 오버플로).
  await loadSvg();
  const C0 = await src();
  const diaPreX = (await lineAttrs(C0, DIA))[0].x;
  const rr = await page.evaluate((e) => window.__archTest.applySvgManual([{ op: "setTextStyle", eid: e, line: 0, style: { textAnchor: "end" } }], e), DIA);
  await settle(300);
  const C1 = await src();
  const diaPost = (await lineAttrs(C1, DIA))[0];
  check("(C1) 강제 setTextStyle 커밋 성공(bleed 청결)", rr && rr.ok === true, JSON.stringify(rr));
  check("(C2) ★ 다이아 anchor는 end로 바뀌되 x는 원위치 유지(구버전 버그면 x가 크게 튐)", diaPost.anchor === "end" && Math.abs(diaPost.x - diaPreX) < 0.01,
    JSON.stringify({ preX: diaPreX, postX: diaPost.x, anchor: diaPost.anchor }));
  await page.evaluate(() => window.__archTest.setElementEditOn(true)); await settle(200);
  const diaForced = await glyphVsShape(DIA, 0);
  check("(C3) ★★ 강제 정렬 후에도 '3.2' 렌더 글자가 도형 polygon 안(point-in-polygon) — 오버플로 없음", diaForced.allInside, JSON.stringify(diaForced));
  await page.screenshot({ path: path.join(ART, "s20_diamond_after_noop.png"), clip: await boxClip(DIA, 70) });
  await page.evaluate(() => window.__archTest.undo()); await settle(350);
  check("(C4) 강제 op undo 복원", (await src()) === C0);

  // ══════════ (D) 전 비-rect 도형(6 polygon + 4 path) 균일 비활성 감사 ══════════
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await settle(150);
  const audit = [];
  for (const b of nonRect) {
    await page.evaluate(([e, k]) => window.__archTest.simInlineStart(e, k, 0, ""), [b.eid, "svgbox"]);
    const c = await capFull("align");
    audit.push({ eid: b.eid, shape: b.shape, ok: c.ok, whyOk: typeof c.why === "string" && c.why.includes(REASON_KEY) });
    await page.evaluate(() => window.__archTest.simInlineCancel());
  }
  const allDisabled = audit.every((a) => a.ok === false && a.whyOk);
  check("(D1) ★ 비-rect 10개 전부(6 polygon + 4 path) 정렬 비활성 + 동일 사유", allDisabled, JSON.stringify(audit.filter((a) => !(a.ok === false && a.whyOk))));
  check("(D2) 감사 대상이 정확히 10개(6 polygon + 4 path)", audit.filter((a) => a.shape === "polygon").length === 6 && audit.filter((a) => a.shape === "path").length === 4, JSON.stringify(audit.map((a) => a.shape)));
  // rect 대조군: 무작위 rect 3개는 여전히 활성
  await page.evaluate(() => window.__archTest.simInlineCancel());
  const rectSample = boxes.filter((b) => b.shape === "rect").slice(0, 3);
  const rectCaps = [];
  for (const b of rectSample) {
    await page.evaluate(([e]) => window.__archTest.simInlineStart(e, "svgbox", 0, ""), [b.eid]);
    rectCaps.push({ eid: b.eid, ok: await capOk("align") });
    await page.evaluate(() => window.__archTest.simInlineCancel());
  }
  check("(D3) 대조군 rect 3개는 정렬 여전히 활성(과잉 차단 아님)", rectCaps.every((r) => r.ok === true), JSON.stringify(rectCaps));

  // ══════════ (E) 여러 줄 rect — 정렬은 편집 중인 그 줄에만(D26 스코프 회귀 가드) ══════════
  await loadSvg();
  const E0 = await src();
  const M3 = "svgbox:4";   // 3줄 rect "STEP 0.2 | P02 결과 finding | + files 확보"
  await enterOff();
  sb = await stageBox(); lb = await lineClientOfBox(M3, 1);   // 줄 2(index 1)만
  await page.mouse.click(sb.x + lb.cx, sb.y + lb.cy);
  await settle(320);
  check("(E1) 3줄 rect 줄 2 인라인 세션 + 정렬 활성", !!(await inlineInput()) && (await capOk("align")) === true);
  const e3pre = await lineAttrs(E0, M3);
  await page.click("#fmt-align-start");
  await settle(180);
  await frame().locator('[data-arch-overlay="inline"]').press("Enter");
  await page.waitForFunction(() => window.__archTest.undoDepth() >= 1, null, { timeout: 6000 });
  await settle(300);
  const S_E = await src();
  const e3post = await lineAttrs(S_E, M3);
  check("(E2) ★ 줄 2만 anchor=start로 바뀌고 줄 1·3은 무변화(줄 스코프)",
    e3post[1].anchor === "start" && e3post[0].anchor === e3pre[0].anchor && e3post[2].anchor === e3pre[2].anchor && e3post[1].x !== e3pre[1].x,
    JSON.stringify({ pre: e3pre.map((l) => l.anchor + "@" + l.x), post: e3post.map((l) => l.anchor + "@" + l.x) }));
  // bleed: svgbox:4(+조상 svg 컨테이너)만 변하고 형제 단위는 바이트 동일 — 조상-안전 masked 비교
  const e3bleed = await bleedClean(E0, S_E, M3);
  check("(E3) ★ 3줄 rect 정렬 bleed 청결(형제 단위 바이트 동일, 조상 컨테이너는 mask가 커버)", e3bleed.ok, JSON.stringify(e3bleed.offenders));
  await page.keyboard.press("Meta+z"); await settle(400);
  check("(E4) 복원", (await src()) === E0);

  // ══════════ (F) obj(class-b) 정렬 — 여전히 활성 + 편집 리프에만(회귀 가드) ══════════
  await page.evaluate(async (h) => { await window.__archTest.load(h, "p01.html"); }, P01_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
  await settle(300);
  const F0 = await src();
  const objEid = await page.evaluate(() => { const d = new DOMParser().parseFromString(window.__archTest.getSource(), "text/html"); const e = d.querySelector('[data-object-type="textbox"]'); return e && e.getAttribute("data-arch-eid"); });
  await enterOff();
  const oc = await vf().evaluate((e) => { const el = document.querySelector('[data-arch-eid="' + e + '"]'); const r = el.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, objEid);
  sb = await stageBox();
  await page.mouse.click(sb.x + oc.cx, sb.y + oc.cy);
  await settle(320);
  check("(F1) ★ obj 인라인 편집 중 정렬 cap = 활성(비-rect 게이트가 obj엔 안 걸림)", (await capOk("align")) === true);
  await page.evaluate(() => window.__archTest.fmtAlign("end"));
  await settle(150);
  const objText = await vf().evaluate(() => { const e = document.querySelector('[contenteditable="true"]'); return e ? e.textContent : null; });
  await page.evaluate((t) => window.__archTest.simInlineCommit ? window.__archTest.simInlineCommit(t, false) : null, objText);
  await settle(250);
  let F1 = await src();
  if (F1 === F0) { await frame().locator('[contenteditable="true"]').press("Enter").catch(() => {}); await page.waitForFunction(() => window.__archTest.undoDepth() >= 1, null, { timeout: 6000 }).catch(() => {}); await settle(250); F1 = await src(); }
  const objChanged = await page.evaluate(([b, a, e]) => {
    const P = (h) => new DOMParser().parseFromString(h, "text/html");
    const A = P(b), B = P(a);
    const ua = A.querySelector('[data-arch-eid="' + e + '"]'), ub = B.querySelector('[data-arch-eid="' + e + '"]');
    // 편집 리프에 text-align 반영됐는지 + 형제 [data-arch-eid] 바이트 동일
    const hasAlign = ub && /text-align\s*:\s*(right|end)/i.test(ub.outerHTML);
    let siblingsClean = true; const off = [];
    A.querySelectorAll("[data-arch-eid]").forEach((el) => { const k = el.getAttribute("data-arch-eid"); if (k === e) return; if (ua && (el.contains(ua) || ua.contains(el))) return; const o = B.querySelector('[data-arch-eid="' + k + '"]'); if (!o || o.outerHTML !== el.outerHTML) { siblingsClean = false; off.push(k); } });
    return { hasAlign, siblingsClean, off };
  }, [F0, F1, objEid]);
  check("(F2) ★ obj 정렬: 편집 요소에 text-align 반영 + 다른 요소 바이트 동일(리프 스코프)", objChanged.hasAlign && objChanged.siblingsClean && F1 !== F0, JSON.stringify(objChanged));

  // ── 콘솔 에러(참고용, 이 수정과 무관한 기존 노이즈는 hard-fail 안 함) ──
  if (pageErrors.length) console.log("NOTE  pageErrors(" + pageErrors.length + "): " + JSON.stringify(pageErrors.slice(0, 5)));

} catch (e) {
  console.error("EXC ", e && e.stack || e);
  fail++;
} finally {
  console.log(`\n== s20 결과: ${pass} pass / ${fail} fail ==`);
  await browser.close();
  server.kill();
  process.exit(fail ? 1 : 0);
}
