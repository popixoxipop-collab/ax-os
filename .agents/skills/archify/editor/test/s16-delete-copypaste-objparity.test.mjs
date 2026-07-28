// Stage 16 (D27a/b/c) — 삭제(Delete) · 복사/붙여넣기(Ctrl+C/V) · class-b(obj) 기능 등가화 (mock, 키 불필요).
//
// D27a 삭제: 요소 전체 삭제 op(svgbox/svgtext/svgedge/obj) + bleed-diff 일반화(mode:"remove" — 개수 정확히
//   -|S|, 사라진 게 정확히 S, 그 밖은 바이트 동일). 다중 선택 배치 삭제 = 단일 undo. 타이핑 중 Delete는
//   글자 삭제(요소 삭제 아님). 박스 삭제 후 화살표는 그대로 붕 뜸(예상된 동작 — 노드↔엣지 그래프 모델 없음).
// D27b 복사/붙여넣기: 앱 내부 JS 변수 클립보드. 새 eid(프리픽스별 max+1) + 좌표 오프셋(+20,+20) + 붙인 게
//   곧 선택. 다중 복붙은 균일 오프셋으로 상대 배치 보존. 두 번 붙이면 서로 다른 eid.
// D27c obj 등가화: (a) 줄 단위 정밀 클릭(직속 자식 div=줄) (b) 전체 서식 어휘(CSS 매핑) (c) 줄 추가/삭제
//   (d) 비-줄 구조는 우아하게 폴백(largestFontLine 읽기 + 줄±비활성+사유).
//
// 독립 검증: 앱의 bleedDiff/adapter를 재사용하지 않고 테스트가 DOMParser로 직접 대조한다(순환 검증 방지).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8639;
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
const page = await browser.newPage({ viewport: { width: 2200, height: 1500 } });   // 넓게 → stage scale=1(좌표 1:1)
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));

const frame = () => page.frameLocator("#diagram-frame");
const vf = () => page.frames().find((f) => f !== page.mainFrame());
const src = () => page.evaluate(() => window.__archTest.getSource());
const depth = () => page.evaluate(() => window.__archTest.undoDepth());
const settle = (ms) => page.waitForTimeout(ms == null ? 320 : ms);
async function stageBox() { return await page.locator("#stage").boundingBox(); }
async function loadSvg() { await page.evaluate(async (h) => { await window.__archTest.load(h, "svg.html"); }, SVG_HTML); await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 }); await settle(250); }
async function loadP01() { await page.evaluate(async (h) => { await window.__archTest.load(h, "p01.html"); }, P01_HTML); await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 }); await settle(250); }
async function enterOn() { await page.evaluate(() => window.__archTest.setMode("edit")); await settle(180); await page.evaluate(() => window.__archTest.setElementEditOn(true)); await settle(180); }
async function enterOff() { await page.evaluate(() => window.__archTest.setMode("edit")); await settle(180); await page.evaluate(() => window.__archTest.setElementEditOn(false)); await settle(200); }

const eids = (html) => page.evaluate((h) => [...new DOMParser().parseFromString(h, "text/html").querySelectorAll("[data-arch-eid]")].map((e) => e.getAttribute("data-arch-eid")).sort(), html);

// 독립 삭제 검증: after == before − delSet, 생존자 바이트 동일(삭제된 것의 조상은 정당 변경), 새 eid 없음, 개수 −|S|.
const deleteClean = (b, a, dels) => page.evaluate(([bh, ah, dd]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  const M = (d) => { const m = {}; d.querySelectorAll("[data-arch-eid]").forEach((el) => { m[el.getAttribute("data-arch-eid")] = el.outerHTML; }); return m; };
  const mb = M(P(bh)), ma = M(P(ah)), del = new Set(dd), off = [];
  for (const e of dd) if (ma[e] != null) off.push("still: " + e);
  for (const k of Object.keys(mb)) {
    if (del.has(k)) continue;
    if (ma[k] == null) { off.push("lost: " + k); continue; }
    const isAncestor = dd.some((e) => mb[k].includes('data-arch-eid="' + e + '"'));   // 삭제된 것을 품던 조상 = 정당 변경
    if (isAncestor) continue;
    if (mb[k] !== ma[k]) off.push("changed: " + k);
  }
  for (const k of Object.keys(ma)) if (mb[k] == null) off.push("new: " + k);
  const cok = Object.keys(ma).length === Object.keys(mb).length - dd.length;
  return { ok: off.length === 0 && cok, off, before: Object.keys(mb).length, after: Object.keys(ma).length };
}, [b, a, dels]);

// 독립 붙여넣기 검증: before의 모든 eid가 after에 바이트 동일(조상=새 eid를 받은 컨테이너만 변경 허용), 새 eid가 정확히 newSet, 개수 +|S|.
const pasteClean = (b, a, news) => page.evaluate(([bh, ah, nn]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  const M = (d) => { const m = {}; d.querySelectorAll("[data-arch-eid]").forEach((el) => { m[el.getAttribute("data-arch-eid")] = el.outerHTML; }); return m; };
  const mb = M(P(bh)), ma = M(P(ah)), off = [];
  for (const k of Object.keys(mb)) {
    if (ma[k] == null) { off.push("lost: " + k); continue; }
    if (mb[k] === ma[k]) continue;
    const gained = nn.some((e) => ma[k].includes('data-arch-eid="' + e + '"') && !mb[k].includes('data-arch-eid="' + e + '"'));
    if (gained) continue;               // 붙여넣기를 받은 컨테이너(바깥 svg 등) — 정당 변경
    off.push("changed: " + k);
  }
  const added = Object.keys(ma).filter((k) => mb[k] == null).sort();
  const exp = [...nn].sort();
  if (JSON.stringify(added) !== JSON.stringify(exp)) off.push("added " + JSON.stringify(added) + " != " + JSON.stringify(exp));
  const cok = Object.keys(ma).length === Object.keys(mb).length + nn.length;
  return { ok: off.length === 0 && cok, off, added };
}, [b, a, news]);

async function boxClient(eid) {
  return await vf().evaluate((e) => { const el = document.querySelector('[data-arch-eid="' + e + '"]'); const r = el.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, left: r.left, top: r.top, w: r.width, h: r.height }; }, eid);
}
async function objLineClient(eid, i) {
  return await vf().evaluate(([e, idx]) => { const el = document.querySelector('[data-arch-eid="' + e + '"]'); const k = [...el.children]; const r = k[idx].getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, text: (k[idx].textContent || "").trim().slice(0, 24) }; }, [eid, i]);
}
const inlineState = () => page.evaluate(() => window.__archTest.inlineState());
const objEditing = () => vf().evaluate(() => { const e = document.querySelector('[contenteditable="true"]'); return e ? { present: true, text: (e.textContent || "").trim().slice(0, 30) } : null; });
// obj 특정 줄 div의 인라인 style 문자열
const objLineStyle = (html, eid, i) => page.evaluate(([h, e, idx]) => { const el = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]'); if (!el) return null; const c = [...el.children][idx]; return c ? (c.getAttribute("style") || "") : null; }, [html, eid, i]);
const svgTranslate = (html, eid) => page.evaluate(([h, e]) => { const g = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]'); const t = g && (g.getAttribute("transform") || ""); const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(t || ""); return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null; }, [html, eid]);

try {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });

  // ════════════════ (A) 삭제 — svgbox/svgtext/svgedge/obj + 다중 + 타이핑 가드 ════════════════
  await loadSvg();
  const A0 = await src();
  const boxes0 = await page.evaluate(() => window.__archTest.getSvgBoxes().map((b) => b.eid));
  const texts0 = await page.evaluate(() => window.__archTest.getSvgTexts().map((t) => t.eid));
  const edges0 = await page.evaluate(() => window.__archTest.getSvgEdges().map((e) => e.eid));
  check("(A0) svg 슬라이드: 박스·자유텍스트·화살표 확보", boxes0.length >= 3 && texts0.length >= 1 && edges0.length >= 1, `box=${boxes0.length} txt=${texts0.length} edge=${edges0.length}`);

  // ── svgbox 삭제(실제 클릭 → 실제 Delete 키 = iframe→부모 배선) ──
  await enterOn();
  const bc = await boxClient(boxes0[0]);
  let sb = await stageBox();
  await page.mouse.click(sb.x + bc.cx, sb.y + bc.cy);
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, boxes0[0], { timeout: 6000 });
  await page.screenshot({ path: path.join(ART, "s16_delete_before.png"), clip: { x: sb.x, y: sb.y, width: Math.min(1100, sb.width), height: Math.min(700, sb.height) } });
  await page.keyboard.press("Delete");
  await page.waitForFunction((n) => window.__archTest.undoDepth() === n, 1, { timeout: 6000 });
  const B1 = await src();
  const dc1 = await deleteClean(A0, B1, [boxes0[0]]);
  check("(A1) svgbox Delete: 소스에서 사라짐 + bleed 청결(정확히 −1, 그 eid만, 나머지 바이트 동일)", dc1.ok && !(await eids(B1)).includes(boxes0[0]), JSON.stringify(dc1));
  await page.screenshot({ path: path.join(ART, "s16_delete_after.png"), clip: { x: sb.x, y: sb.y, width: Math.min(1100, sb.width), height: Math.min(700, sb.height) } });
  await page.keyboard.press("Meta+z");
  await page.waitForFunction((n) => window.__archTest.undoDepth() === n, 0, { timeout: 6000 });
  check("(A2) svgbox 삭제 undo: 바이트 동일 복원(개수 원복)", (await src()) === A0);

  // ── svgtext 삭제(선택 훅 + 실제 Delete = 부모 배선) ──
  await enterOn();
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), texts0[0]);
  await settle(200);
  const beforeTxt = await src();
  await page.keyboard.press("Delete");
  await page.waitForFunction((n) => window.__archTest.undoDepth() >= n, 1, { timeout: 6000 });
  check("(A3) svgtext Delete: bleed 청결(−1, 그 eid만)", (await deleteClean(beforeTxt, await src(), [texts0[0]])).ok && !(await eids(await src())).includes(texts0[0]));
  await page.evaluate(() => window.__archTest.undo());
  await settle(300);
  check("(A4) svgtext 삭제 undo 복원", (await src()) === beforeTxt);

  // ── svgedge 삭제 ──
  await enterOn();
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), edges0[0]);
  await settle(200);
  const beforeEdge = await src();
  await page.keyboard.press("Delete");
  await page.waitForFunction((n) => window.__archTest.undoDepth() >= n, 1, { timeout: 6000 });
  check("(A5) svgedge Delete: bleed 청결(−1, 그 eid만)", (await deleteClean(beforeEdge, await src(), [edges0[0]])).ok && !(await eids(await src())).includes(edges0[0]));
  await page.evaluate(() => window.__archTest.undo());
  await settle(300);
  check("(A6) svgedge 삭제 undo 복원", (await src()) === beforeEdge);

  // ── 박스 삭제 후 화살표는 그대로 붕 뜸(예상된 동작, 버그 아님) ──
  await enterOn();
  const arrowBefore = await page.evaluate(([e]) => { const g = new DOMParser().parseFromString(window.__archTest.getSource(), "text/html").querySelector('[data-arch-eid="' + e + '"]'); return g ? g.outerHTML : null; }, [edges0[0]]);
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), boxes0[1]);
  await settle(180);
  await page.evaluate(() => window.__archTest.deleteSelection());
  await settle(350);
  const arrowAfter = await page.evaluate(([e]) => { const g = new DOMParser().parseFromString(window.__archTest.getSource(), "text/html").querySelector('[data-arch-eid="' + e + '"]'); return g ? g.outerHTML : null; }, [edges0[0]]);
  check("(A7) 박스 삭제 후 화살표는 삭제·재라우팅되지 않고 그대로 남는다(예상된 dangling)", arrowAfter != null && arrowAfter === arrowBefore);
  await page.evaluate(() => window.__archTest.undo());
  await settle(300);

  // ── 다중 선택 3개 삭제 = 단일 undo ──
  await enterOn();
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), boxes0[0]);
  await page.evaluate((e) => window.__archTest.selectByEid(e, true), boxes0[1]);
  await page.evaluate((e) => window.__archTest.selectByEid(e, true), texts0[0]);
  await settle(200);
  const preMulti = await src(), dPre = await depth();
  const selCount = await page.evaluate(() => window.__archTest.getSelection().length);
  await page.keyboard.press("Delete");
  await page.waitForFunction((n) => window.__archTest.undoDepth() === n, dPre + 1, { timeout: 6000 });
  const afterMulti = await src();
  const gone = await eids(afterMulti);
  check("(A8) 다중선택 3개 Delete: 셋 다 사라짐", selCount === 3 && !gone.includes(boxes0[0]) && !gone.includes(boxes0[1]) && !gone.includes(texts0[0]));
  check("(A9) 다중 삭제 bleed 청결(정확히 −3, 그 3개만)", (await deleteClean(preMulti, afterMulti, [boxes0[0], boxes0[1], texts0[0]])).ok);
  check("(A10) 다중 삭제는 undo 1회(단일 스냅샷)", (await depth()) === dPre + 1, `depth ${dPre}→${await depth()}`);
  await page.evaluate(() => window.__archTest.undo());
  await settle(300);
  check("(A11) 다중 삭제 undo 한 번에 셋 다 복원(바이트 동일)", (await src()) === preMulti);

  // ── 타이핑 중 Delete는 요소 삭제 아님(회귀 가드) ── (obj p01 인라인)
  await loadP01();
  const P0typ = await src();
  const obj3 = await page.evaluate(() => { const es = [...new DOMParser().parseFromString(window.__archTest.getSource(), "text/html").querySelectorAll('[data-object-type="textbox"]')]; for (const e of es) { const eid = e.getAttribute("data-arch-eid"); if (window.__archTest.objLineCount(eid) === 3) return eid; } return null; });
  await enterOff();
  let oc = await objLineClient(obj3, 1);
  sb = await stageBox();
  await page.mouse.click(sb.x + oc.cx, sb.y + oc.cy);
  await settle(320);
  const editingNow = await objEditing();
  const dBeforeType = await depth();
  await page.keyboard.press("Delete");           // contenteditable 안 → 글자 삭제(요소 삭제 아님)
  await settle(250);
  const stillThere = (await eids(await src())).includes(obj3);
  check("(A12) ★ 타이핑(인라인 편집) 중 Delete는 요소를 삭제하지 않는다(글자 편집으로 양보)", !!editingNow && stillThere && (await depth()) === dBeforeType, `editing=${JSON.stringify(editingNow)} still=${stillThere} depth ${dBeforeType}→${await depth()}`);
  await frame().locator('[contenteditable="true"]').press("Escape");
  await settle(250);

  // ════════════════ (B) 복사/붙여넣기 ════════════════
  await loadSvg();
  const C0 = await src();
  const cbBoxes = await page.evaluate(() => window.__archTest.getSvgBoxes().map((b) => b.eid));
  // ── svgbox 복사 → 붙여넣기 ──
  await enterOn();
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), cbBoxes[0]);
  await settle(150);
  await page.evaluate(() => window.__archTest.copySelection());
  const clip = await page.evaluate(() => window.__archTest.getClipboard());
  check("(B0) 복사: 클립보드에 1개 svgbox", clip && clip.count === 1 && clip.kinds[0] === "svgbox", JSON.stringify(clip));
  const origTr = await svgTranslate(C0, cbBoxes[0]);
  const boxesBeforePaste = await page.evaluate(() => window.__archTest.getSvgBoxes().map((b) => b.eid));
  await page.evaluate(() => window.__archTest.pasteClipboard());
  await settle(400);
  const C1 = await src();
  const boxesAfterPaste = await page.evaluate(() => window.__archTest.getSvgBoxes().map((b) => b.eid));
  const newBox = boxesAfterPaste.find((e) => !boxesBeforePaste.includes(e));
  check("(B1) 붙여넣기: 새 eid 채번(기존과 미충돌)", !!newBox && !boxesBeforePaste.includes(newBox), `new=${newBox}`);
  check("(B2) 붙여넣기 bleed 청결(정확히 +1, 나머지 바이트 동일)", (await pasteClean(C0, C1, [newBox])).ok, JSON.stringify(await pasteClean(C0, C1, [newBox])));
  const newTr = await svgTranslate(C1, newBox);
  check("(B3) 붙여넣기 좌표 오프셋 +20,+20", newTr && origTr && Math.round(newTr.x - origTr.x) === 20 && Math.round(newTr.y - origTr.y) === 20, JSON.stringify({ origTr, newTr }));
  // 내용 동일성: eid·transform 제외한 도형/텍스트가 원본과 같음(대표: rect fill + text 내용)
  const sameContent = await page.evaluate(([h, oa, ob]) => {
    const d = new DOMParser().parseFromString(h, "text/html");
    const norm = (eid) => { const g = d.querySelector('[data-arch-eid="' + eid + '"]').cloneNode(true); g.removeAttribute("data-arch-eid"); g.setAttribute("transform", ""); return g.innerHTML; };
    return norm(oa) === norm(ob);
  }, [C1, cbBoxes[0], newBox]);
  check("(B4) 붙여넣기 내용은 원본과 동일(eid·transform 제외 innerHTML 일치)", sameContent);
  const selNow = await page.evaluate(() => window.__archTest.getSelection().map((u) => u.eid));
  check("(B5) 붙여넣은 요소가 곧 선택 상태", selNow.length === 1 && selNow[0] === newBox, JSON.stringify(selNow));
  await page.screenshot({ path: path.join(ART, "s16_paste_offset.png"), clip: { x: sb.x, y: sb.y, width: Math.min(1100, sb.width), height: Math.min(700, sb.height) } });
  await page.evaluate(() => window.__archTest.undo());
  await settle(300);
  check("(B6) 붙여넣기 undo: 새 요소 제거 + 바이트 동일 복원", (await src()) === C0);

  // ── 두 번 붙여넣기 → 서로 다른 eid, 충돌 없음 ──
  await enterOn();
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), cbBoxes[0]);
  await page.evaluate(() => window.__archTest.copySelection());
  await settle(120);
  await page.evaluate(() => window.__archTest.pasteClipboard());
  await settle(300);
  const afterPaste1 = await page.evaluate(() => window.__archTest.getSvgBoxes().map((b) => b.eid));
  await page.evaluate(() => window.__archTest.pasteClipboard());
  await settle(300);
  const afterPaste2 = await page.evaluate(() => window.__archTest.getSvgBoxes().map((b) => b.eid));
  const p1 = afterPaste1.find((e) => !boxesBeforePaste.includes(e));
  const p2 = afterPaste2.find((e) => !afterPaste1.includes(e));
  check("(B7) 두 번 붙여넣기 → 서로 다른 새 eid 2개(충돌 없음)", p1 && p2 && p1 !== p2, `p1=${p1} p2=${p2}`);
  await page.evaluate(() => { window.__archTest.undo(); });
  await settle(200);
  await page.evaluate(() => { window.__archTest.undo(); });
  await settle(250);
  check("(B8) 두 붙여넣기 undo 2회로 원복", (await src()) === C0);

  // ── 다중 복사/붙여넣기: 상대 배치 보존(균일 오프셋) ──
  await enterOn();
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), cbBoxes[0]);
  await page.evaluate((e) => window.__archTest.selectByEid(e, true), cbBoxes[1]);
  await settle(150);
  const trA = await svgTranslate(C0, cbBoxes[0]), trB = await svgTranslate(C0, cbBoxes[1]);
  await page.evaluate(() => window.__archTest.copySelection());
  const before2 = await page.evaluate(() => window.__archTest.getSvgBoxes().map((b) => b.eid));
  await page.evaluate(() => window.__archTest.pasteClipboard());
  await settle(400);
  const D1 = await src();
  const after2 = await page.evaluate(() => window.__archTest.getSvgBoxes().map((b) => b.eid));
  const newTwo = after2.filter((e) => !before2.includes(e));
  check("(B9) 다중 붙여넣기: 새 박스 2개", newTwo.length === 2, JSON.stringify(newTwo));
  check("(B10) 다중 붙여넣기 bleed 청결(+2)", (await pasteClean(C0, D1, newTwo)).ok);
  const nTrs = await Promise.all(newTwo.map((e) => svgTranslate(D1, e)));
  // 상대 배치 보존: 두 새 박스의 상대 델타 == 원본 두 박스의 상대 델타(균일 +20,+20 이동이라 보존).
  const relOrig = { x: trB.x - trA.x, y: trB.y - trA.y };
  const relNew = { x: nTrs[1].x - nTrs[0].x, y: nTrs[1].y - nTrs[0].y };
  check("(B11) 다중 붙여넣기: 항목 간 상대 배치 보존", Math.abs(relNew.x - relOrig.x) < 0.6 && Math.abs(relNew.y - relOrig.y) < 0.6, JSON.stringify({ relOrig, relNew }));
  await page.evaluate(() => window.__archTest.undo());
  await settle(300);

  // ── obj 복사/붙여넣기(class-b) ──
  await loadP01();
  const OB0 = await src();
  const objAll = await page.evaluate(() => [...new DOMParser().parseFromString(window.__archTest.getSource(), "text/html").querySelectorAll('[data-object-type="textbox"]')].map((e) => e.getAttribute("data-arch-eid")));
  await enterOn();
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), objAll[1]);
  await settle(150);
  await page.evaluate(() => window.__archTest.copySelection());
  await page.evaluate(() => window.__archTest.pasteClipboard());
  await settle(350);
  const OB1 = await src();
  const eidsBeforeObj = new Set(await eids(OB0));
  const newObjEid = (await eids(OB1)).find((e) => !eidsBeforeObj.has(e));
  check("(B12) obj 복사/붙여넣기: 새 obj eid + bleed 청결(+1)", !!newObjEid && (await pasteClean(OB0, OB1, [newObjEid])).ok, `new=${newObjEid}`);
  await page.evaluate(() => window.__archTest.undo());
  await settle(300);
  check("(B13) obj 붙여넣기 undo 복원", (await src()) === OB0);

  // ════════════════ (C) obj 줄 단위 정밀 클릭 + 편집 스코프 ════════════════
  await loadP01();
  const P1 = await src();
  const obj3b = await page.evaluate(() => { const es = [...new DOMParser().parseFromString(window.__archTest.getSource(), "text/html").querySelectorAll('[data-object-type="textbox"]')]; for (const e of es) { const eid = e.getAttribute("data-arch-eid"); if (window.__archTest.objLineCount(eid) === 3) return eid; } return null; });
  check("(C0) 3줄 obj 텍스트 상자 확보(직속 자식 div 3개)", !!obj3b && (await page.evaluate((e) => window.__archTest.objLineCount(e), obj3b)) === 3, `eid=${obj3b}`);

  // 줄 0/1/2를 각각 클릭 → 인라인 세션이 그 줄에 열림(항상 같은 줄이 아니라 클릭한 줄).
  for (const li of [0, 2, 1]) {
    await enterOff();
    const lc = await objLineClient(obj3b, li);
    sb = await stageBox();
    await page.mouse.click(sb.x + lc.cx, sb.y + lc.cy);
    await settle(320);
    const st = await inlineState();
    check(`(C1.${li}) obj 줄 ${li} 클릭 → 인라인 세션이 정확히 그 줄에 열림(line=${li})`, st && st.eid === obj3b && st.line === li, JSON.stringify(st));
    if (li === 0) await page.screenshot({ path: path.join(ART, "s16_obj_line0.png"), clip: { x: Math.max(0, sb.x + lc.cx - 260), y: Math.max(0, sb.y + lc.cy - 60), width: 520, height: 140 } });
    if (li === 2) await page.screenshot({ path: path.join(ART, "s16_obj_line2.png"), clip: { x: Math.max(0, sb.x + lc.cx - 260), y: Math.max(0, sb.y + lc.cy - 60), width: 520, height: 140 } });
    await frame().locator('[contenteditable="true"]').press("Escape");
    await settle(200);
  }

  // 줄 1만 텍스트 편집 → 그 줄만 바뀌고 다른 줄·단위 바이트 동일.
  await enterOff();
  const before1line = await objLineClient(obj3b, 1);
  sb = await stageBox();
  await page.mouse.click(sb.x + before1line.cx, sb.y + before1line.cy);
  await settle(320);
  const P1src = await src();
  const line0text = await objLineStyle(P1src, obj3b, 0);   // 스타일 스냅(줄0 불변 확인용)
  await page.keyboard.type("줄2-정밀편집");
  await frame().locator('[contenteditable="true"]').press("Enter");
  await page.waitForFunction((n) => window.__archTest.undoDepth() >= n, 1, { timeout: 6000 });
  await settle(250);
  const P2 = await src();
  const l1now = await page.evaluate(([h, e]) => { const el = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]'); return [...el.children].map((c) => (c.textContent || "").trim()); }, [P2, obj3b]);
  const l1was = await page.evaluate(([h, e]) => { const el = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]'); return [...el.children].map((c) => (c.textContent || "").trim()); }, [P1, obj3b]);
  check("(C2) obj 줄 1만 텍스트 변경(줄 0·2 불변) — 줄 스코프 정밀도", l1now[1].includes("줄2-정밀편집") && l1now[0] === l1was[0] && l1now[2] === l1was[2], JSON.stringify({ was: l1was, now: l1now }));
  const otherObjsClean = await page.evaluate(([b, a, e]) => { const P = (h) => new DOMParser().parseFromString(h, "text/html"); const A = P(b), B = P(a); let ok = true; A.querySelectorAll("[data-arch-eid]").forEach((el) => { const k = el.getAttribute("data-arch-eid"); if (k === e) return; const o = B.querySelector('[data-arch-eid="' + k + '"]'); if (!o || o.outerHTML !== el.outerHTML) ok = false; }); return ok; }, [P1, P2, obj3b]);
  check("(C3) obj 줄 편집 bleed: 다른 모든 단위 바이트 동일", otherObjsClean);
  await page.evaluate(() => window.__archTest.undo());
  await settle(300);
  check("(C4) obj 줄 편집 undo 복원", (await src()) === P1);

  // ════════════════ (D) obj 전체 서식 어휘 → CSS 프로퍼티가 그 줄 div에 ════════════════
  await enterOff();
  const dlc = await objLineClient(obj3b, 1);
  sb = await stageBox();
  await page.mouse.click(sb.x + dlc.cx, sb.y + dlc.cy);
  await settle(320);
  await page.evaluate(() => {
    window.__archTest.fmtItalic();
    window.__archTest.fmtDecor("u");
    window.__archTest.fmtAlign("end");
    window.__archTest.fmtFont("serif");
    window.__archTest.fmtTrack(2);
    window.__archTest.fmtGap(1.8);
  });
  await settle(200);
  await page.locator("#fmt-bar").screenshot({ path: path.join(ART, "s16_obj_fmt_toolbar.png") });
  const curText = (await objEditing()).text;
  await page.evaluate((t) => window.__archTest.simInlineCommit ? window.__archTest.simInlineCommit(t, false) : null, curText);
  // simInlineCommit(false) = 서식만(텍스트 무변경). 없으면 위 hooks가 pending에 쌓였다가 Enter 커밋으로.
  await settle(300);
  let P3 = await src();
  if (P3 === P1) {   // simInlineCommit 경로가 비었으면 실제 Enter로 커밋
    await frame().locator('[contenteditable="true"]').press("Enter");
    await page.waitForFunction((n) => window.__archTest.undoDepth() >= n, 1, { timeout: 6000 });
    await settle(250);
    P3 = await src();
  }
  const st1 = (await objLineStyle(P3, obj3b, 1)).replace(/\s+/g, "");
  check("(D1) obj 서식: italic → font-style", /font-style:italic/.test(st1), st1);
  check("(D2) obj 서식: underline → text-decoration", /text-decoration:.*underline/.test(st1), st1);
  check("(D3) obj 서식: align end → text-align:right", /text-align:right/.test(st1), st1);
  check("(D4) obj 서식: family → font-family(serif)", /font-family:serif/.test(st1), st1);
  check("(D5) obj 서식: track → letter-spacing(2px)", /letter-spacing:2px/.test(st1), st1);
  check("(D6) obj 서식: gap → line-height(1.8)", /line-height:1\.8/.test(st1), st1);
  const st0 = (await objLineStyle(P3, obj3b, 0)).replace(/\s+/g, "");
  check("(D7) obj 서식 스코프: 줄 0에는 안 묻음(italic/serif 없음)", !/font-style:italic/.test(st0) && !/font-family:serif/.test(st0), st0);
  const dOtherClean = await page.evaluate(([b, a, e]) => { const P = (h) => new DOMParser().parseFromString(h, "text/html"); const A = P(b), B = P(a); let ok = true; A.querySelectorAll("[data-arch-eid]").forEach((el) => { const k = el.getAttribute("data-arch-eid"); if (k === e) return; const o = B.querySelector('[data-arch-eid="' + k + '"]'); if (!o || o.outerHTML !== el.outerHTML) ok = false; }); return ok; }, [P1, P3, obj3b]);
  check("(D8) obj 서식 bleed: 다른 단위 바이트 동일", dOtherClean);
  await page.evaluate(() => window.__archTest.undo());
  await settle(300);
  check("(D9) obj 서식 undo 복원", (await src()) === P1);

  // ════════════════ (E) obj 줄 추가/삭제 + 그레이스풀 폴백 ════════════════
  await enterOn();
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), obj3b);
  await settle(200);
  const info3 = await page.evaluate((e) => window.__archTest.objLineInfo(e), obj3b);
  check("(E0) 3줄 obj: objLineInfo clean + lines=3", info3 && info3.clean === true && info3.lines === 3, JSON.stringify(info3));
  const eLineDisabled = await page.evaluate(() => window.__archTest.boxTools());
  check("(E1) 3줄 obj 선택: 줄 추가/삭제 컨트롤 활성", eLineDisabled.lineboxVisible && !eLineDisabled.lineAddDisabled && !eLineDisabled.lineDelDisabled, JSON.stringify(eLineDisabled));
  const before4 = await src();
  await page.evaluate(() => window.__archTest.fmtAddLine());
  await settle(300);
  const P4 = await src();
  const cnt4 = await page.evaluate((e) => window.__archTest.objLineCount(e), obj3b);
  check("(E2) obj 줄 추가 → 4줄", cnt4 === 4, `count=${cnt4}`);
  // 4번째 줄이 컨테이너(자동 높이) 안에 정상 배치(음수 top/폭0 아님) — 새 줄 bbox가 유효.
  const newLineOk = await vf().evaluate((e) => { const el = document.querySelector('[data-arch-eid="' + e + '"]'); const k = [...el.children]; const last = k[k.length - 1].getBoundingClientRect(); const box = el.getBoundingClientRect(); return last.height > 0 && last.top >= box.top - 1 && last.bottom <= box.bottom + 40; }, obj3b);
  check("(E3) 추가된 줄이 컨테이너 안에 배치(bbox 유효·범위 내)", newLineOk);
  check("(E4) obj 줄 추가 bleed: 개수 불변(새 줄 div엔 eid 없음) · 그 obj만 변경", (await page.evaluate(([b, a, e]) => { const P = (h) => new DOMParser().parseFromString(h, "text/html"); const A = P(b), B = P(a); if (A.querySelectorAll("[data-arch-eid]").length !== B.querySelectorAll("[data-arch-eid]").length) return false; let ok = true; A.querySelectorAll("[data-arch-eid]").forEach((el) => { const k = el.getAttribute("data-arch-eid"); if (k === e) return; const o = B.querySelector('[data-arch-eid="' + k + '"]'); if (!o || o.outerHTML !== el.outerHTML) ok = false; }); return ok; }, [before4, P4, obj3b])));
  await page.evaluate(() => window.__archTest.undo());
  await settle(300);
  check("(E5) obj 줄 추가 undo 복원(3줄로)", (await src()) === before4 && (await page.evaluate((e) => window.__archTest.objLineCount(e), obj3b)) === 3);
  // 줄 삭제
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), obj3b);
  await settle(150);
  const before5 = await src();
  await page.evaluate(() => window.__archTest.fmtRemoveLine(3));   // 3번째 줄 삭제
  await settle(300);
  check("(E6) obj 줄 삭제 → 2줄", (await page.evaluate((e) => window.__archTest.objLineCount(e), obj3b)) === 2);
  await page.evaluate(() => window.__archTest.undo());
  await settle(300);
  check("(E7) obj 줄 삭제 undo 복원(3줄로)", (await src()) === before5);

  // ── 그레이스풀 폴백: 비-줄 구조(중첩 span/플렉스) obj ──
  const dirtyObj = await page.evaluate(() => { const es = [...new DOMParser().parseFromString(window.__archTest.getSource(), "text/html").querySelectorAll('[data-object-type="textbox"]')]; for (const e of es) { const eid = e.getAttribute("data-arch-eid"); const info = window.__archTest.objLineInfo(eid); if (info && info.clean === false) return eid; } return null; });
  check("(E8) 비-줄 구조 obj 확보(중첩 span/플렉스 등)", !!dirtyObj, `eid=${dirtyObj}`);
  const infoDirty = await page.evaluate((e) => window.__archTest.objLineInfo(e), dirtyObj);
  check("(E9) 폴백: objLineInfo clean=false + 사유 있음", infoDirty && infoDirty.clean === false && !!infoDirty.why, JSON.stringify(infoDirty));
  await enterOn();
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), dirtyObj);
  await settle(250);
  const dirtyTools = await page.evaluate(() => window.__archTest.boxTools());
  check("(E10) 폴백: 비-줄 obj 선택 시 줄 추가/삭제 비활성(+사유)", dirtyTools.lineboxVisible && dirtyTools.lineAddDisabled && dirtyTools.lineDelDisabled, JSON.stringify(dirtyTools));
  const dirtyBefore = await src();
  await page.evaluate(() => window.__archTest.fmtAddLine());   // 비활성이라 무동작
  await settle(250);
  check("(E11) 폴백: 비활성 상태에서 줄 추가 시도해도 내용 무손상(무동작)", (await src()) === dirtyBefore);
  // 폴백 읽기: 비-줄 obj를 OFF 클릭 → line=null(largestFontLine 폴백)로 여전히 편집 가능(크래시 없음)
  await enterOff();
  const dc2 = await boxClient(dirtyObj);
  sb = await stageBox();
  await page.mouse.click(sb.x + dc2.cx, sb.y + dc2.cy);
  await settle(320);
  const dirtyState = await inlineState();
  check("(E12) 폴백: 비-줄 obj OFF 클릭 → 전체 단위 편집(line=null), 크래시 없음", dirtyState && dirtyState.eid === dirtyObj && dirtyState.line == null, JSON.stringify(dirtyState));
  await frame().locator('[contenteditable="true"]').press("Escape").catch(() => {});
  await settle(200);

  // ════════════════ (F) D26 4-상태 게이팅 무회귀 (svgbox + obj) ════════════════
  await loadSvg();
  const box3f = await page.evaluate(() => { const d = new DOMParser().parseFromString(window.__archTest.getSource(), "text/html"); for (const g of d.querySelectorAll('[data-svgbox="1"]')) if ([...g.children].filter((c) => c.tagName.toLowerCase() === "text").length === 3) return g.getAttribute("data-arch-eid"); return null; });
  // ON + 도형선택 → 텍스트 비활성, 도형 활성
  await enterOn();
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), box3f);
  await settle(220);
  const gOnBox = await page.evaluate(() => ({ weight: window.__archTest.fmtCap("weight").ok, italic: window.__archTest.fmtCap("italic").ok, fill: window.__archTest.fmtCap("fill").ok }));
  check("(F1) svgbox ON+선택: 텍스트 비활성 / 도형 활성", gOnBox.weight === false && gOnBox.italic === false && gOnBox.fill === true, JSON.stringify(gOnBox));
  // OFF + 인라인 → 텍스트 활성, 도형 비활성
  await enterOff();
  const lcf = await vf().evaluate((e) => { const ts = [...document.querySelector('[data-arch-eid="' + e + '"]').children].filter((c) => c.tagName.toLowerCase() === "text"); const r = ts[1].getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, box3f);
  sb = await stageBox();
  await page.mouse.click(sb.x + lcf.cx, sb.y + lcf.cy);
  await settle(320);
  const gOffBox = await page.evaluate(() => ({ weight: window.__archTest.fmtCap("weight").ok, italic: window.__archTest.fmtCap("italic").ok, fill: window.__archTest.fmtCap("fill").ok }));
  check("(F2) svgbox OFF+인라인: 텍스트 활성 / 도형 비활성", gOffBox.weight === true && gOffBox.italic === true && gOffBox.fill === false, JSON.stringify(gOffBox));
  await frame().locator('[data-arch-overlay="inline"]').press("Escape");
  await settle(200);

  await loadP01();
  const objF = await page.evaluate(() => { const es = [...new DOMParser().parseFromString(window.__archTest.getSource(), "text/html").querySelectorAll('[data-object-type="textbox"]')]; for (const e of es) { const eid = e.getAttribute("data-arch-eid"); if (window.__archTest.objLineCount(eid) === 3) return eid; } return null; });
  await enterOn();
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), objF);
  await settle(220);
  const gOnObj = await page.evaluate(() => ({ weight: window.__archTest.fmtCap("weight").ok, italic: window.__archTest.fmtCap("italic").ok, fill: window.__archTest.fmtCap("fill").ok }));
  check("(F3) obj ON+선택: 텍스트 비활성 / 채움 활성(도형 서브그룹 그대로)", gOnObj.weight === false && gOnObj.italic === false && gOnObj.fill === true, JSON.stringify(gOnObj));
  await enterOff();
  const ocf = await objLineClient(objF, 1);
  sb = await stageBox();
  await page.mouse.click(sb.x + ocf.cx, sb.y + ocf.cy);
  await settle(320);
  const gOffObj = await page.evaluate(() => ({ weight: window.__archTest.fmtCap("weight").ok, italic: window.__archTest.fmtCap("italic").ok, fill: window.__archTest.fmtCap("fill").ok }));
  check("(F4) obj OFF+인라인: 텍스트 어휘 활성(italic 포함) / 채움 비활성", gOffObj.weight === true && gOffObj.italic === true && gOffObj.fill === false, JSON.stringify(gOffObj));

  check("(Z) 페이지 콘솔 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 4).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s16_failure.png") }); } catch {}
} finally {
  await browser.close();
  server.kill();
}
console.log(`\n=== s16 (D27 삭제·복사/붙여넣기·obj 등가화) : ${pass} pass / ${fail} fail ===`);
process.exit(fail ? 1 : 0);
