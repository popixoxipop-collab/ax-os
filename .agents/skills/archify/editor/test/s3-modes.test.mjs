// archify 요소 편집기 — stage 3: 5개 모드 end-to-end (mock 경로, 키 불필요)
//  편집(드래그 이동+핸들) · 그리기(요소 추가) · 콘텐츠 검증 ④기계겹침/①AI+고치기
//  · 레이아웃 수정(geometry lock) · 콘텐츠 다듬기(text lock) · 선택 회귀
// bleed-diff는 앱 코드를 재사용하지 않고 테스트가 독립 구현으로 비교(순환 검증 방지).
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

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "  — " + extra : "")); }
}

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: APP_DIR, stdio: "ignore" });
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { const r = await fetch(BASE + "/index.html"); up = r.ok; } catch {}
  if (!up) await new Promise((r) => setTimeout(r, 200));
}
if (!up) { console.error("http.server가 뜨지 않음"); server.kill(); process.exit(1); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 2120, height: 1420 }, acceptDownloads: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));

const frame = () => page.frameLocator("#diagram-frame");

// ---- 공용 헬퍼 ----
async function reset() {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await page.waitForTimeout(150);
  return await page.evaluate(() => window.__archTest.getSource());
}
const diffChanged = (a, b) => page.evaluate(([ha, hb]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  const M = (d) => { const m = {}; d.querySelectorAll("[data-arch-eid]").forEach((el) => { m[el.getAttribute("data-arch-eid")] = el.outerHTML; }); return m; };
  const ma = M(P(ha)), mb = M(P(hb));
  const keys = new Set([...Object.keys(ma), ...Object.keys(mb)]);
  return [...keys].filter((k) => ma[k] !== mb[k]).sort();
}, [a, b]);
const eidCount = (h) => page.evaluate((x) => new DOMParser().parseFromString(x, "text/html").querySelectorAll("[data-arch-eid]").length, h);
const styleOf = (html, eid) => page.evaluate(([h, e]) => {
  const el = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]');
  if (!el) return null;
  const s = el.getAttribute("style") || "";
  const g = (k) => { const m = new RegExp("(?:^|;)\\s*" + k + "\\s*:\\s*([^;]+)").exec(s); return m ? m[1].trim() : null; };
  return { left: g("left"), top: g("top"), width: g("width"), height: g("height"), text: (el.textContent || "").replace(/\s+/g, " ").trim() };
}, [html, eid]);
const num = (v) => (v == null ? null : parseFloat(v));
async function stageBox() { return await page.locator("#stage").boundingBox(); }

try {
  let A0 = await reset();
  const scale = await page.evaluate(() => window.__archTest.getScale());
  check("(0) 로드 + scale=1 (좌표 단순화)", scale === 1, "scale=" + scale);
  check("(0b) 초기 모드 = 선택", (await page.evaluate(() => window.__archTest.getMode())) === "select");

  // ============ 선택 모드 회귀 (mock setText) ============
  await frame().locator("div[data-arch-eid]").filter({ hasText: "질문 / 그래프" }).first().click();
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 });
  const selEid = await page.evaluate(() => window.__archTest.getSelected().eid);
  await page.fill("#fi-text", "제목을 '회귀확인'로 바꿔줘");
  await page.click("#fi-run");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 8000 });
  let S = await page.evaluate(() => window.__archTest.getSource());
  const selDiff = await diffChanged(A0, S);
  check("(선택) mock setText가 선택 요소 하나만 변경", selDiff.length === 1 && selDiff[0] === selEid, JSON.stringify(selDiff));
  check("(선택) iframe 반영", await frame().locator("text=회귀확인").first().isVisible());
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });
  check("(선택) undo 바이트 동일 복원", (await page.evaluate(() => window.__archTest.getSource())) === A0);

  // ============ 편집 모드: 드래그 이동 + 리사이즈 핸들 ============
  await page.click('.mode[data-mode="edit"]');
  check("(편집) 모드 전환", (await page.evaluate(() => window.__archTest.getMode())) === "edit");
  await frame().locator('[data-arch-eid="obj:24"]').click();
  await page.waitForFunction(() => { const s = window.__archTest.getSelected(); return s && s.eid === "obj:24"; }, null, { timeout: 5000 });
  // ★ 팝업 폐지(2026-07-21): 상세 팝업(#edit-panel)은 더는 안 뜬다 — 선택은 위 getSelected 대기로 확인.
  //   블록 편집(이동/리사이즈)은 아래 오버레이·핸들로 그대로 검증한다(동작 불변).
  const moveDisp = await frame().locator('[data-arch-overlay="move"]').evaluate((el) => getComputedStyle(el).display);
  const handleDisp = await frame().locator('[data-arch-overlay="handle"]').first().evaluate((el) => getComputedStyle(el).display);
  check("(편집) 선택 시 이동 오버레이 + 리사이즈 핸들 표시", moveDisp === "block" && handleDisp === "block", `move=${moveDisp} handle=${handleDisp}`);
  await page.screenshot({ path: path.join(ART, "s3_edit_handles.png") });

  // 드래그(패널을 피해 좌상단으로) — arch-geom → applyGeom(setStyle top/left)
  const before24 = await styleOf(A0, "obj:24");
  const sb = await stageBox();
  const selRect = await page.evaluate(() => window.__archTest.getSelected().rect);
  const cx = sb.x + selRect.x + selRect.w / 2;
  const cy = sb.y + selRect.y + selRect.h / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 200, cy - 140, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  S = await page.evaluate(() => window.__archTest.getSource());
  const after24 = await styleOf(S, "obj:24");
  const movedLeft = num(after24.left), movedTop = num(after24.top);
  check("(편집) 드래그로 left/top 변경", movedLeft != null && movedLeft < num(before24.left) - 100 && movedTop < num(before24.top) - 60,
    `left ${before24.left}→${after24.left}, top ${before24.top}→${after24.top}`);
  const dragDiff = await diffChanged(A0, S);
  check("(편집) bleed-diff: 드래그가 그 요소만 변경", dragDiff.length === 1 && dragDiff[0] === "obj:24", JSON.stringify(dragDiff));
  check("(편집) 드래그가 텍스트는 보존", after24.text === before24.text, `"${before24.text}" vs "${after24.text}"`);
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });
  check("(편집) undo 바이트 동일 복원", (await page.evaluate(() => window.__archTest.getSource())) === A0);

  // ============ 그리기 모드: 요소 추가 ============
  await page.click('.mode[data-mode="draw"]');
  await page.waitForSelector("#draw-palette:not([hidden])", { timeout: 4000 });
  const beforeCount = await eidCount(A0);
  {
    const s2 = await stageBox();
    await page.mouse.click(s2.x + 900, s2.y + 700); // 빈 곳(빈 lane 영역)
  }
  await page.waitForFunction((n) => window.__archTest.getSource() && new DOMParser().parseFromString(window.__archTest.getSource(), "text/html").querySelectorAll("[data-arch-eid]").length === n + 1, beforeCount, { timeout: 6000 });
  const Sdraw = await page.evaluate(() => window.__archTest.getSource());
  const afterCount = await eidCount(Sdraw);
  check("(그리기) 새 요소 1개 추가", afterCount === beforeCount + 1, `${beforeCount}→${afterCount}`);
  const newEids = await page.evaluate((h) => { const els = new DOMParser().parseFromString(h, "text/html").querySelectorAll("[data-arch-eid]"); return [...els].map((e) => e.getAttribute("data-arch-eid")).filter((x) => x.startsWith("new:")); }, Sdraw);
  check("(그리기) 새 eid가 new: 네임스페이스로 부여", newEids.length === 1, JSON.stringify(newEids));
  const drawDiff = await diffChanged(A0, Sdraw);
  check("(그리기) 기존 요소는 전부 그대로(추가분만 diff)", drawDiff.length === 1 && drawDiff[0] === newEids[0], JSON.stringify(drawDiff));
  check("(그리기) 추가 후 자동으로 편집 모드", (await page.evaluate(() => window.__archTest.getMode())) === "edit");
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });

  // ============ 콘텐츠 검증 ④: 기계적 겹침/오버플로 (단위) ============
  const mech = await page.evaluate(() => window.__archTest.mechanicalAudit([
    { eid: "A", type: "shape", x: 100, y: 100, w: 200, h: 100, sw: 200, sh: 100, cw: 200, ch: 100, hasH: true },
    { eid: "B", type: "shape", x: 250, y: 100, w: 200, h: 100, sw: 200, sh: 100, cw: 200, ch: 100, hasH: true }, // A와 x 50 겹침 → frac .25
    { eid: "C", type: "shape", x: 1500, y: 900, w: 60, h: 60, sw: 60, sh: 60, cw: 60, ch: 60, hasH: true },      // 고립
    { eid: "OF", type: "textbox", x: 500, y: 500, w: 100, h: 40, sw: 300, sh: 90, cw: 100, ch: 40, hasH: true }, // 오버플로
    { eid: "BG", type: "shape", x: 0, y: 0, w: 1920, h: 1080, sw: 1920, sh: 1080, cw: 1920, ch: 1080, hasH: true }, // 배경(제외)
  ]));
  const overlaps = mech.filter((f) => f.kind === "overlap");
  const overflows = mech.filter((f) => f.kind === "overflow");
  check("(검증④ 단위) 부분 겹침 1건, 작은 요소에 핀", overlaps.length === 1 && overlaps[0].eid === "A" && overlaps[0].other === "B", JSON.stringify(overlaps));
  check("(검증④ 단위) 오버플로 1건, 해당 eid에 핀", overflows.length === 1 && overflows[0].eid === "OF", JSON.stringify(overflows));
  check("(검증④ 단위) 배경(면적>10%)·고립 요소는 미검출", mech.length === 2, JSON.stringify(mech.map((f) => f.eid)));

  // ============ 콘텐츠 검증 ④: 통합 — 겹치는 도형 2개 그려 실제 검출 ============
  A0 = await reset();
  await page.click('.mode[data-mode="draw"]');
  await page.waitForSelector("#draw-palette:not([hidden])", { timeout: 4000 });
  await page.click('#draw-palette [data-draw="shape"]');
  {
    const s3 = await stageBox();
    await page.mouse.click(s3.x + 760, s3.y + 705); // 예외 lane 내부
  }
  await page.waitForFunction(() => window.__archTest.getMode() === "edit", null, { timeout: 6000 });
  await page.click('.mode[data-mode="draw"]');
  await page.click('#draw-palette [data-draw="shape"]');
  {
    const s3 = await stageBox();
    await page.mouse.click(s3.x + 900, s3.y + 705); // 첫 도형과 x 부분 겹침
  }
  await page.waitForFunction(() => { const s = window.__archTest.getSource(); return new DOMParser().parseFromString(s, "text/html").querySelectorAll('[data-arch-eid^="new:"]').length === 2; }, null, { timeout: 6000 });
  await page.click("#btn-audit");
  await page.click('#audit-menu [data-audit="4"]');
  await page.waitForFunction(() => { const el = document.getElementById("fp-status"); return el && /완료/.test(el.textContent); }, null, { timeout: 8000 });
  const f4 = await page.evaluate(() => window.__archTest.getFindings());
  const drawnEids = await page.evaluate(() => { const s = window.__archTest.getSource(); return [...new DOMParser().parseFromString(s, "text/html").querySelectorAll('[data-arch-eid^="new:"]')].map((e) => e.getAttribute("data-arch-eid")); });
  const ov = f4.filter((f) => f.kind === "overlap" && drawnEids.includes(f.eid) && drawnEids.includes(f.other));
  check("(검증④ 통합) 그린 두 도형 겹침이 findings에 정확 eid로 핀", ov.length >= 1, JSON.stringify(f4.map((f) => [f.kind, f.eid, f.other])));
  check("(검증④ 통합) findings 패널 표시", !(await page.locator("#findings-panel").getAttribute("hidden")));
  await page.screenshot({ path: path.join(ART, "s3_findings_panel.png") });

  // ============ 콘텐츠 검증 ① (mock AI) + "AI로 고치기" 단일 요소 수정 ============
  A0 = await reset();
  await page.click("#btn-audit");
  await page.click('#audit-menu [data-audit="1"]');
  await page.waitForFunction(() => { const el = document.getElementById("fp-status"); return el && /완료/.test(el.textContent); }, null, { timeout: 8000 });
  const f1 = await page.evaluate(() => window.__archTest.getFindings());
  check("(검증① mock) AI finding ≥1건 생성", f1.length >= 1, JSON.stringify(f1.slice(0, 2)));
  const fixEid = f1[0] && f1[0].eid;
  await page.locator(".finding").first().locator(".finding-fix").click();
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 8000 });
  const Sfix = await page.evaluate(() => window.__archTest.getSource());
  const fixDiff = await diffChanged(A0, Sfix);
  check('(검증① 고치기) "AI로 고치기"가 그 요소 하나만 수정', fixDiff.length === 1 && fixDiff[0] === fixEid, JSON.stringify(fixDiff) + " eid=" + fixEid);
  const fixedText = (await styleOf(Sfix, fixEid)).text;
  check("(검증① 고치기) 대표 텍스트가 제안대로 교체(검증본)", /검증본/.test(fixedText), fixedText);

  // ============ 레이아웃 수정: geometry만 (텍스트는 필드 잠금) ============
  A0 = await reset();
  // 필드 잠금 단위: setText 제거 + setStyle의 비-geometry 키(color) 제거
  const lock = await page.evaluate(() => window.__archTest.sanitizeLayout(
    { ops: [{ op: "setText", eid: "obj:2", text: "탈취" }, { op: "setStyle", eid: "obj:2", style: { left: "10px", color: "#111" } }] }, ["obj:2"]));
  const lockOk = lock.ops.length === 1 && lock.ops[0].op === "setStyle" && Object.keys(lock.ops[0].style).join(",") === "left";
  check("(레이아웃 잠금) setText 거부 + 비-geometry 키(color) 제거, left만 통과", lockOk, JSON.stringify(lock.ops));

  await page.click('.mode[data-mode="layout"]');
  await page.waitForSelector("#wd-bar:not([hidden])", { timeout: 4000 });
  await page.fill("#wd-input", "모든 노드를 오른쪽으로 40px 이동");
  await page.click("#wd-run");
  await page.waitForSelector("#wd-confirm:not([hidden])", { timeout: 8000 });
  const confirmTxt = await page.textContent("#wd-confirm-text");
  check("(레이아웃) 다중 요소 확인 다이얼로그 'N개' 표시", /2개/.test(confirmTxt || ""), confirmTxt);
  const pend = await page.evaluate(() => window.__archTest.getPendingLayout());
  await page.click("#wd-confirm-apply");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  const Slay = await page.evaluate(() => window.__archTest.getSource());
  const layDiff = await diffChanged(A0, Slay);
  const b0 = await styleOf(A0, pend.eids[0]), a0e = await styleOf(Slay, pend.eids[0]);
  check("(레이아웃) 변경집합 ⊆ 허용집합(확인된 eid만)", layDiff.length === pend.eids.length && layDiff.every((k) => pend.eids.includes(k)), JSON.stringify(layDiff) + " vs " + JSON.stringify(pend.eids));
  check("(레이아웃) left가 +40 이동(geometry 적용)", num(a0e.left) === num(b0.left) + 40, `${b0.left}→${a0e.left}`);
  check("(레이아웃) 텍스트는 전부 불변", a0e.text === b0.text);
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });

  // 레이아웃 UI: 텍스트 지시 → 필드 잠금으로 거부(변경 0)
  await page.fill("#wd-input", "제목 텍스트를 바꿔줘");
  await page.click("#wd-run");
  await page.waitForSelector("#wd-error:not([hidden])", { timeout: 8000 });
  const layErr = await page.textContent("#wd-error");
  check("(레이아웃 UI) 텍스트 지시는 필드 잠금으로 반려", /없습니다|잠금/.test(layErr || "") && (await page.evaluate(() => window.__archTest.undoDepth())) === 0, layErr);

  // ============ 콘텐츠 다듬기: 텍스트만 (geometry는 필드 잠금) ============
  A0 = await reset();
  const plock = await page.evaluate(() => window.__archTest.sanitizePolish(
    { ops: [{ op: "setStyle", eid: "obj:2", style: { left: "9px" } }, { op: "setText", eid: "obj:2", text: "다듬음" }] }, ["obj:2"]));
  check("(다듬기 잠금) setStyle 거부 + setText만 통과", plock.ops.length === 1 && plock.ops[0].op === "setText", JSON.stringify(plock.ops));

  await page.click('.mode[data-mode="polish"]');
  await page.waitForSelector("#wd-bar:not([hidden])", { timeout: 4000 });
  await page.fill("#wd-input", "문어체로 통일하고 군더더기를 줄여줘");
  await page.click("#wd-run");
  await page.waitForSelector("#polish-panel:not([hidden])", { timeout: 8000 });
  const rows = await page.evaluate(() => window.__archTest.getPolishRows());
  check("(다듬기) 요소별 before→after diff 리스트 생성", rows.length >= 1 && rows.every((r) => r.after !== r.before), JSON.stringify(rows.slice(0, 2)));
  const rowEids = rows.map((r) => r.eid).sort();
  await page.click("#pp-apply");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  const Spol = await page.evaluate(() => window.__archTest.getSource());
  const polDiff = await diffChanged(A0, Spol);
  check("(다듬기) 변경집합 ⊆ 승인한 텍스트 요소들", polDiff.length === rowEids.length && polDiff.join(",") === rowEids.join(","), JSON.stringify(polDiff) + " vs " + JSON.stringify(rowEids));
  const geomSame = await page.evaluate(([a, b, eids]) => {
    const P = (h) => new DOMParser().parseFromString(h, "text/html");
    const ma = P(a), mb = P(b);
    return eids.every((e) => {
      const ea = ma.querySelector('[data-arch-eid="' + e + '"]'), eb = mb.querySelector('[data-arch-eid="' + e + '"]');
      const g = (el, k) => { const m = new RegExp("(?:^|;)\\s*" + k + "\\s*:\\s*([^;]+)").exec(el.getAttribute("style") || ""); return m ? m[1].trim() : null; };
      return ["left", "top", "width", "height"].every((k) => g(ea, k) === g(eb, k));
    });
  }, [A0, Spol, rowEids]);
  check("(다듬기) 텍스트만 바뀌고 geometry(위치·크기)는 불변", geomSame);
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });
  check("(다듬기) undo가 batch 전체 복원", (await page.evaluate(() => window.__archTest.getSource())) === A0);

  // 다듬기 UI: geometry 지시 → 필드 잠금으로 거부
  await page.click('.mode[data-mode="polish"]');
  await page.fill("#wd-input", "위치를 왼쪽으로 옮겨줘");
  await page.click("#wd-run");
  await page.waitForSelector("#wd-error:not([hidden])", { timeout: 8000 });
  const polErr = await page.textContent("#wd-error");
  check("(다듬기 UI) geometry 지시는 필드 잠금으로 반려", /없습니다|잠금/.test(polErr || ""), polErr);

  check("(z) 페이지 콘솔 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 4).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s3_failure.png") }); } catch {}
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
