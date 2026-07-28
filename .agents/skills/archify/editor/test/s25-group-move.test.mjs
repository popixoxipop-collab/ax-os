// archify 요소 편집기 — s25: D41 다중 선택 그룹 이동.
//   2개 이상 선택된 상태에서 그 중 하나를 드래그하면 선택된 전부가 상대위치를 유지한 채 함께 이동한다.
//
// 검증 축(mock/키 불필요 — 직접조작):
//  · obj 2개 그룹 이동: 둘 다 동일 델타만큼 이동 + bleed 청결(그 2개 밖 바이트 동일) + undo로 둘 다 원위치
//  · obj+svgbox 혼합(서로 다른 좌표계) 그룹 이동: obj는 left/top(px), svgbox는 transform translate — 같은 화면 델타
//  · obj 3개 그룹 이동
//  · 회귀: 단일 선택은 그룹 경로를 타지 않는다(선택 1개면 그룹 이동 없음 — 기존 단일 드래그 불변)
// ★ 드래그는 선택된 그 요소 위에 실제 MouseEvent(mousedown→document mousemove→mouseup)를 디스패치해
//   앱의 진짜 드래그 핸들러(startGroupDrag→onDragMoveGroup→finishGroupDrag)를 그대로 태운다.
// ★ bleed-diff는 앱 어댑터를 재사용하지 않고 테스트가 독립 구현으로 대조한다(순환 검증 방지).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8625;
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
const src = () => page.evaluate(() => window.__archTest.getSource());
const getMode = () => page.evaluate(() => window.__archTest.getMode());
const depth = () => page.evaluate(() => window.__archTest.undoDepth());
const selectByEid = (eid, additive) => page.evaluate(([e, a]) => window.__archTest.selectByEid(e, a), [eid, additive]);
const getSelEids = () => page.evaluate(() => window.__archTest.getSelection().map((u) => u.eid));

// 독립 bleed 검증: 변경된 [data-arch-eid] 집합. allowed의 "조상"(class-c에서 svgbox가 svg 컨테이너 obj의
//   후손이라, 박스가 바뀌면 컨테이너 outerHTML도 같이 바뀜)은 제외 — 앱 bleedDiff의 조상-skip과 동일 의미.
const diffChanged = (a, b, allowed = []) => page.evaluate(([ha, hb, allow]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  const docA = P(ha), docB = P(hb);
  const M = (d) => { const m = {}; d.querySelectorAll("[data-arch-eid]").forEach((el) => { m[el.getAttribute("data-arch-eid")] = el.outerHTML; }); return m; };
  const ma = M(docA), mb = M(docB);
  const allowSet = new Set(allow);
  const allowedEls = allow.map((e) => docB.querySelector('[data-arch-eid="' + e + '"]')).filter(Boolean);
  const keys = new Set([...Object.keys(ma), ...Object.keys(mb)]);
  return [...keys].filter((k) => {
    if (ma[k] === mb[k]) return false;
    if (allowSet.has(k)) return true;                              // 허용 자신은 변경 기대
    const el = docB.querySelector('[data-arch-eid="' + k + '"]');
    if (el && allowedEls.some((ae) => ae !== el && el.contains(ae))) return false;  // 허용 후손 때문에 바뀐 조상 제외
    return true;                                                    // 그 외 = 진짜 집합 밖 변경(bleed)
  }).sort();
}, [a, b, allowed]);
// obj left/top(px) 추출
const objPos = (h, eid) => page.evaluate(([html, e]) => {
  const el = new DOMParser().parseFromString(html, "text/html").querySelector('[data-arch-eid="' + e + '"]');
  if (!el) return null;
  const s = el.getAttribute("style") || "";
  const L = /(?:^|;)\s*left:\s*(-?\d+(?:\.\d+)?)(?:px)?/.exec(s), T = /(?:^|;)\s*top:\s*(-?\d+(?:\.\d+)?)(?:px)?/.exec(s);
  return (L && T) ? { left: parseFloat(L[1]), top: parseFloat(T[1]) } : null;
}, [h, eid]);
// svgbox/svgtext transform translate(x,y) 추출
const svgXY = (h, eid) => page.evaluate(([html, e]) => {
  const el = new DOMParser().parseFromString(html, "text/html").querySelector('[data-arch-eid="' + e + '"]');
  if (!el) return null;
  const m = /translate\(\s*(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)/.exec(el.getAttribute("transform") || "");
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
}, [h, eid]);
// 왼쪽/위 좌표를 가진 obj eid들
const objsWithPos = (h) => page.evaluate((html) => {
  const doc = new DOMParser().parseFromString(html, "text/html"), out = [];
  doc.querySelectorAll('[data-arch-eid^="obj:"]').forEach((el) => {
    const s = el.getAttribute("style") || "";
    if (/(?:^|;)\s*left:\s*-?\d/.test(s) && /(?:^|;)\s*top:\s*-?\d/.test(s)) out.push(el.getAttribute("data-arch-eid"));
  });
  return out;
}, h);
const eidsOf = (h, prefix) => page.evaluate(([html, p]) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll('[data-arch-eid^="' + p + '"]')].map((el) => el.getAttribute("data-arch-eid"));
}, [h, prefix]);

// ★ 그룹 이동: 선택된 요소 위에 실제 MouseEvent를 디스패치(앱의 mousedown/mousemove/mouseup 핸들러를 그대로 탐)
async function groupDragBy(grabEid, dx, dy) {
  await frame().locator(`[data-arch-eid="${grabEid}"]`).evaluate((el, d) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const mk = (t, x, y) => new MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window });
    el.dispatchEvent(mk("mousedown", cx, cy));
    document.dispatchEvent(mk("mousemove", cx + d[0], cy + d[1]));   // 이동 트리거(>2px)
    document.dispatchEvent(mk("mouseup", cx + d[0], cy + d[1]));
  }, [dx, dy]);
}
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

try {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await settle(150);
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await settle(120);
  const A0 = await src();
  const objs = await objsWithPos(A0);
  check("(0) 로드 + 편집 모드 + 좌표 있는 obj ≥ 3개", objs.length >= 3 && (await getMode()) === "edit", `objs=${objs.length}`);

  // ══════════════════════ Case A: obj 2개 그룹 이동 ══════════════════════
  const [a, b] = [objs[0], objs[1]];
  const aPos0 = await objPos(A0, a), bPos0 = await objPos(A0, b);
  await selectByEid(a, false);
  await selectByEid(b, true);
  await settle(120);
  const selAB = await getSelEids();
  check("(A-0) obj 2개 다중 선택됨", selAB.length === 2 && selAB.includes(a) && selAB.includes(b), JSON.stringify(selAB));

  const DX = 140, DY = 90;
  const d0 = await depth();
  await groupDragBy(a, DX, DY);   // a를 잡고 드래그 → a,b 둘 다 이동해야
  await page.waitForFunction((d) => window.__archTest.undoDepth() === d + 1, d0, { timeout: 6000 });
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(150);
  const S1 = await src();
  const aPos1 = await objPos(S1, a), bPos1 = await objPos(S1, b);
  await page.screenshot({ path: path.join(ART, "s25_group2_moved.png") });
  check("(A-1) 잡은 obj(a)가 (DX,DY)만큼 이동",
    near(aPos1.left, aPos0.left + DX) && near(aPos1.top, aPos0.top + DY),
    `a ${aPos0.left},${aPos0.top} → ${aPos1.left},${aPos1.top}`);
  check("(A-2) ★함께 선택된 obj(b)도 동일 델타만큼 이동(상대위치 유지)",
    near(bPos1.left, bPos0.left + DX) && near(bPos1.top, bPos0.top + DY),
    `b ${bPos0.left},${bPos0.top} → ${bPos1.left},${bPos1.top}`);
  const difAB = await diffChanged(A0, S1, [a, b]);
  check("(A-3) bleed-diff: 그 2개만 변경(집합 밖 바이트 동일)",
    difAB.length === 2 && difAB.includes(a) && difAB.includes(b), JSON.stringify(difAB));

  // (A-4) undo — 한 번에 둘 다 원위치(단일 스냅샷)
  await page.evaluate(() => window.__archTest.undo());
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(150);
  const S2 = await src();
  const aU = await objPos(S2, a), bU = await objPos(S2, b);
  check("(A-4) ★단일 undo로 둘 다 원래 자리 복귀",
    near(aU.left, aPos0.left) && near(aU.top, aPos0.top) && near(bU.left, bPos0.left) && near(bU.top, bPos0.top),
    `a ${aU.left},${aU.top} b ${bU.left},${bU.top}`);
  check("(A-5) undo 후 소스가 A0와 바이트 동일", S2 === A0);

  // ══════════════════════ Case B: obj 3개 그룹 이동 ══════════════════════
  const [c1, c2, c3] = [objs[0], objs[1], objs[2]];
  const p0 = { [c1]: await objPos(A0, c1), [c2]: await objPos(A0, c2), [c3]: await objPos(A0, c3) };
  await selectByEid(c1, false); await selectByEid(c2, true); await selectByEid(c3, true);
  await settle(120);
  const sel3 = await getSelEids();
  const dB = await depth();
  await groupDragBy(c2, -110, 60);   // 가운데 것을 잡고 드래그
  await page.waitForFunction((d) => window.__archTest.undoDepth() === d + 1, dB, { timeout: 6000 });
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(150);
  const S3 = await src();
  const p1 = { [c1]: await objPos(S3, c1), [c2]: await objPos(S3, c2), [c3]: await objPos(S3, c3) };
  const all3 = [c1, c2, c3].every((e) => near(p1[e].left, p0[e].left - 110) && near(p1[e].top, p0[e].top + 60));
  const dif3 = await diffChanged(A0, S3, [c1, c2, c3]);
  check("(B-1) 3개 선택 → 셋 다 동일 델타(-110,+60) 이동 + bleed 청결(그 3개만)",
    sel3.length === 3 && all3 && dif3.length === 3 && [c1, c2, c3].every((e) => dif3.includes(e)),
    `sel=${sel3.length} all3=${all3} dif=${JSON.stringify(dif3)}`);
  await page.evaluate(() => window.__archTest.undo());
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(120);
  check("(B-2) undo로 3개 원복(A0 바이트 동일)", (await src()) === A0);

  // ══════════════════════ Case C: obj + svgbox 혼합(서로 다른 좌표계) ══════════════════════
  await page.evaluate(async (h) => { await window.__archTest.load(h, "svg_mix.html"); }, SVG_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 12000 });
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await settle(150);
  const C0 = await src();
  const svgObjs = await objsWithPos(C0);
  const boxes = await eidsOf(C0, "svgbox:");
  check("(C-0) SVG 데모 로드: obj + svgbox 공존", svgObjs.length >= 1 && boxes.length >= 1, `obj=${svgObjs.length} svgbox=${boxes.length}`);
  const ob = svgObjs[0], bx = boxes[0];
  const obPos0 = await objPos(C0, ob), bxPos0 = await svgXY(C0, bx);
  await selectByEid(ob, false); await selectByEid(bx, true);
  await settle(120);
  const selMix = await getSelEids();
  const dC = await depth();
  await groupDragBy(ob, 100, 70);   // obj를 잡고 드래그 → obj와 svgbox 둘 다 이동
  await page.waitForFunction((d) => window.__archTest.undoDepth() === d + 1, dC, { timeout: 6000 });
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(150);
  const C1 = await src();
  const obPos1 = await objPos(C1, ob), bxPos1 = await svgXY(C1, bx);
  await page.screenshot({ path: path.join(ART, "s25_mix_moved.png") });
  check("(C-0b) obj+svgbox 다중 선택", selMix.length === 2 && selMix.includes(ob) && selMix.includes(bx), JSON.stringify(selMix));
  check("(C-1) obj(left/top)가 (100,70) 이동",
    near(obPos1.left, obPos0.left + 100) && near(obPos1.top, obPos0.top + 70),
    `obj ${obPos0.left},${obPos0.top} → ${obPos1.left},${obPos1.top}`);
  check("(C-2) ★svgbox(transform translate)도 같은 화면 델타(≈100,70) 이동 — 좌표계 달라도 동일 델타",
    bxPos1 && near(bxPos1.x, bxPos0.x + 100, 3) && near(bxPos1.y, bxPos0.y + 70, 3),
    `svgbox ${bxPos0 && bxPos0.x},${bxPos0 && bxPos0.y} → ${bxPos1 && bxPos1.x},${bxPos1 && bxPos1.y}`);
  const difMix = await diffChanged(C0, C1, [ob, bx]);
  check("(C-3) bleed-diff: obj+svgbox 그 2개만 변경(집합 밖 바이트 동일)",
    difMix.length === 2 && difMix.includes(ob) && difMix.includes(bx), JSON.stringify(difMix));
  await page.evaluate(() => window.__archTest.undo());
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(150);
  check("(C-4) undo로 obj+svgbox 둘 다 원복(C0 바이트 동일)", (await src()) === C0);

  // ══════════════════════ 회귀: 단일 선택은 그룹 경로를 타지 않음 ══════════════════════
  //   단일 선택 상태에서 요소 위 mousedown+move는 그룹 mousedown 가드(selSet<2)에 걸려 그룹 이동을 시작하지 않는다.
  //   (단일 이동은 moveOverlay 경로 — s3에서 검증됨. 여기선 "그룹 경로가 단일에서 안 켜짐"만 확인.)
  const S_before = await src();
  await selectByEid(svgObjs[0], false);   // 단일 선택
  await settle(100);
  const dSingle = await depth();
  await groupDragBy(svgObjs[0], 50, 50);   // 그룹 mousedown은 selSet<2라 무시 → 커밋 없음
  await settle(300);
  check("(R-1) 단일 선택에서는 그룹 이동이 시작되지 않음(undo 스택 불변·소스 불변)",
    (await depth()) === dSingle && (await src()) === S_before,
    `depth ${dSingle}→${await depth()} srcChanged=${(await src()) !== S_before}`);

  check("(Z) 전체 시퀀스 동안 콘솔/페이지 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 4).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 6).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s25_failure.png") }); } catch {}
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n=== s25 (D41 그룹 이동) : ${pass} pass / ${fail} fail ===`);
process.exit(fail ? 1 : 0);
