// Stage 7 (class c / D16) — SVG 텍스트 편집 고도화 그라운딩 테스트 (mock, 키 불필요).
//
// 검증 대상:
//   (A) 로드/stamp: 박스 밖 자유 <text>가 svgtext:N으로 STAMP되고, 개수 = "박스 <g> 밖 + defs 밖"
//       자유 텍스트 수와 정확히 일치. 박스는 여전히 svgbox 단위(내부 <text>는 미stamp).
//   (B) 박스 다층 텍스트(D16 a): 다이아 4.1(3줄)을 편집 모드 선택 → 패널에 3개 텍스트 필드.
//       2줄("category =")만 편집 → 그 <text>만 바뀌고 "4.1"·"cognition-isolation?" + 다른 박스는
//       바이트 동일(bleed-diff 청결), undo 복원. 박스 0.1의 STEP 줄 편집 → 주 라벨 보존.
//   (C) 자유 텍스트(D16 b): "1.1 finding-code 연결?" 라벨이 svgtext stamp됨 → 클릭 시 그 텍스트가
//       선택(박스 아님·전체 svg 아님) → 텍스트/색 편집·드래그 이동, 각각 bleed-diff 청결.
//   (D) hit-test 우선순위: 박스 내부 <text> 클릭은 svgbox(박스 <g>) 우선, 자유 텍스트는 자기 자신.
//   (E) 다운로드: svgtext stamp 유지 + 편집 반영, 스크립트/오버레이 없음.
//
// bleed-diff는 앱 로직을 재사용하지 않고 테스트가 독립 DOMParser 비교로 실증한다(순환 방지).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8619;
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

// 독립 bleed-diff (중첩 대응, s6과 동일): 편집 단위를 마스크한 문서 전체가 before==after +
// 그 단위의 조상이 아닌 다른 data-arch-eid는 전부 outerHTML 동일. svgtext(자유 <text>)도
// 바깥 svg(obj:N)의 후손이라 boxes와 같은 경로로 "단위 밖 바이트 동일"이 실증된다.
const bleedClean = (a, b, eid) => page.evaluate(([ha, hb, e]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  const mask = (doc) => { const el = doc.querySelector('[data-arch-eid="' + e + '"]'); if (el) el.replaceWith(doc.createElement("arch-mask-test")); return doc.documentElement.outerHTML; };
  const maskedEqual = mask(P(ha)) === mask(P(hb));
  const A = P(ha), B = P(hb);
  const unitA = A.querySelector('[data-arch-eid="' + e + '"]');
  const offenders = [];
  A.querySelectorAll("[data-arch-eid]").forEach((el) => {
    const k = el.getAttribute("data-arch-eid");
    if (k === e) return;
    if (unitA && el.contains(unitA)) return;         // 조상(바깥 svg) — 마스크 검사가 커버
    const elB = B.querySelector('[data-arch-eid="' + k + '"]');
    if (!elB || el.outerHTML !== elB.outerHTML) offenders.push(k);
  });
  return { ok: maskedEqual && offenders.length === 0, maskedEqual, offenders };
}, [a, b, eid]);

// 박스 <g>의 직속 <text> 줄 텍스트(문서순).
const boxLines = (html, eid) => page.evaluate(([h, e]) => {
  const g = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]');
  if (!g) return null;
  return [...g.children].filter((c) => c.tagName.toLowerCase() === "text").map((t) => (t.textContent || "").trim());
}, [html, eid]);

// 자유 <text> 단위의 속성.
const textAttrs = (html, eid) => page.evaluate(([h, e]) => {
  const t = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]');
  if (!t) return null;
  return { tag: t.tagName.toLowerCase(), text: (t.textContent || "").trim(), fill: t.getAttribute("fill"), x: parseFloat(t.getAttribute("x")), y: parseFloat(t.getAttribute("y")) };
}, [html, eid]);

// 소스에서 svgtext eid 찾기(텍스트 부분일치).
const findSvgText = (html, needle) => page.evaluate(([h, n]) => {
  const doc = new DOMParser().parseFromString(h, "text/html");
  const t = [...doc.querySelectorAll('[data-svgtext="1"]')].find((t) => (t.textContent || "").indexOf(n) >= 0);
  return t ? t.getAttribute("data-arch-eid") : null;
}, [html, needle]);
const findSvgBox = (html, needle) => page.evaluate(([h, n]) => {
  const doc = new DOMParser().parseFromString(h, "text/html");
  const g = [...doc.querySelectorAll('[data-svgbox="1"]')].find((g) => (g.textContent || "").indexOf(n) >= 0);
  return g ? g.getAttribute("data-arch-eid") : null;
}, [html, needle]);

async function loadSvg() {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await page.evaluate(async (h) => { await window.__archTest.load(h, "svg.html"); }, SVG_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
  await page.waitForTimeout(250);
  return await page.evaluate(() => window.__archTest.getSource());
}

try {
  // ============ (A) 로드 + svgtext stamp ============
  let A0 = await loadSvg();
  const scale = await page.evaluate(() => window.__archTest.getScale());
  check("(A0) scale=1 (좌표 단순화)", scale === 1, "scale=" + scale);

  const svgTexts = await page.evaluate(() => window.__archTest.getSvgTexts());
  // 기대치: <svg data-object> 안의 <text> 중 data-svgbox 후손도 아니고 defs 안도 아닌 것.
  const expectedFree = await page.evaluate((h) => {
    const svg = new DOMParser().parseFromString(h, "text/html").querySelector("svg[data-object]");
    let n = 0;
    svg.querySelectorAll("text").forEach((t) => { if (t.closest('[data-svgbox="1"]')) return; if (t.closest("defs")) return; n++; });
    return n;
  }, A0);
  check("(A1) svgtext stamp 개수 = 자유 텍스트 수(박스·defs 밖)", svgTexts.length === expectedFree, `stamped=${svgTexts.length} expected=${expectedFree}`);
  check("(A1b) 자유 텍스트 29개(실측 고정)", svgTexts.length === 29, "count=" + svgTexts.length);
  const uniq = new Set(svgTexts.map((t) => t.eid)).size;
  check("(A1c) svgtext eid 전부 고유 + svgtext: 접두", uniq === svgTexts.length && svgTexts.every((t) => /^svgtext:/.test(t.eid)));
  // 박스는 여전히 32개, 박스 내부 <text>는 svgtext로 stamp되지 않음
  const boxes = await page.evaluate(() => window.__archTest.getSvgBoxes());
  check("(A2) 박스 svgbox는 여전히 32개(불변)", boxes.length === 32, "count=" + boxes.length);
  const boxTextNotStamped = await page.evaluate((h) => {
    const doc = new DOMParser().parseFromString(h, "text/html");
    return [...doc.querySelectorAll('[data-svgbox="1"] text')].every((t) => !t.hasAttribute("data-svgtext"));
  }, A0);
  check("(A2b) 박스 내부 <text>는 svgtext stamp 없음(박스 선택 보존)", boxTextNotStamped);
  // 하단 evidence 표/헤더 div의 텍스트는 svgtext 아님(svg 밖)
  const evidenceClean = await page.evaluate(() => window.__archTest.getSvgTexts().every((t) => /^svgtext:/.test(t.eid)));
  check("(A3) evidence 표·헤더는 svgtext 아님(svg 밖 자연 제외)", evidenceClean);

  // ============ (B) 박스 다층 텍스트 — 다이아 4.1 (3줄) ============
  const diamondEid = await findSvgBox(A0, "cognition-isolation");
  check("(B0) 다이아 4.1 박스 발견", !!diamondEid, "eid=" + diamondEid);
  const linesBefore = await boxLines(A0, diamondEid);
  check("(B0b) 다이아 4.1은 3줄 <text>", linesBefore && linesBefore.length === 3, JSON.stringify(linesBefore));

  await page.evaluate(() => window.__archTest.setMode("edit"));
  await frame().locator('[data-arch-eid="' + diamondEid + '"]').click();
  // popup removed 2026-07-21 → 선택 확인은 getSelected(패널 대신), 줄 편집은 요소 편집 OFF 인라인/applyInlineCommit
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, diamondEid, { timeout: 5000 });
  const nLineFields = await page.evaluate((e) => window.__archTest.svgSnapshot(e).lines.length, diamondEid);
  check("(B1) 박스가 3줄 편집 단위를 노출(스냅샷 lines · 구 패널 필드)", nLineFields === 3, "lines=" + nLineFields);
  // 각 줄 내용(문서순) = 원본 줄
  const fieldVals = await page.evaluate((e) => window.__archTest.svgSnapshot(e).lines.map((l) => l.text), diamondEid);
  check("(B1b) 줄 내용=원본(문서순)", JSON.stringify(fieldVals) === JSON.stringify(linesBefore), JSON.stringify({ fieldVals, linesBefore }));
  await page.screenshot({ path: path.join(ART, "s7_box_multiline.png") });

  // 2줄(index 1, "category =")만 편집 — popup removed → OFF 인라인 커밋 경로
  await page.evaluate((e) => window.__archTest.applyInlineCommit(e, "svgbox", 1, "분류 ="), diamondEid);
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  let S = await page.evaluate(() => window.__archTest.getSource());
  const linesAfter = await boxLines(S, diamondEid);
  check("(B2) 2줄만 교체 · 1·3줄 보존", linesAfter[0] === linesBefore[0] && linesAfter[1] === "분류 =" && linesAfter[2] === linesBefore[2], JSON.stringify(linesAfter));
  check("(B2b) bleed-diff: 그 박스만 변경(다른 박스·자유텍스트 바이트 동일)", (await bleedClean(A0, S, diamondEid)).ok, JSON.stringify(await bleedClean(A0, S, diamondEid)));
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });
  check("(B2c) undo 바이트 동일 복원", (await page.evaluate(() => window.__archTest.getSource())) === A0);

  // 박스 0.1 STEP 줄(index 0) 편집 → 주 라벨("P02 finding 선택") 보존
  const box01 = await findSvgBox(A0, "STEP 0.1");
  const l01Before = await boxLines(A0, box01);
  await frame().locator('[data-arch-eid="' + box01 + '"]').click();
  // popup removed 2026-07-21 → 선택 확인 + 줄0 편집은 applyInlineCommit
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, box01, { timeout: 5000 });
  await page.evaluate((e) => window.__archTest.applyInlineCommit(e, "svgbox", 0, "단계 0.1"), box01);
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  S = await page.evaluate(() => window.__archTest.getSource());
  const l01After = await boxLines(S, box01);
  const mainIdx = l01Before.findIndex((t) => t === "P02 finding 선택");
  check("(B3) STEP 줄(0)만 교체 · 주 라벨 보존", l01After[0] === "단계 0.1" && l01After[mainIdx] === "P02 finding 선택", JSON.stringify(l01After));
  check("(B3b) bleed-diff: box01만 변경", (await bleedClean(A0, S, box01)).ok);
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });

  // ============ (D) hit-test 우선순위: 박스 내부 텍스트 클릭 → svgbox ============
  await page.evaluate(() => window.__archTest.setMode("select"));
  await frame().locator('[data-arch-eid="' + diamondEid + '"] text').first().click();
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 });
  const boxSel = await page.evaluate(() => window.__archTest.getSelected());
  check("(D1) 박스 내부 <text> 클릭 → svgbox(박스 <g>) 선택(svgtext 아님)", boxSel && boxSel.eid === diamondEid && boxSel.svgbox === true && !boxSel.svgtext, JSON.stringify(boxSel));
  await page.keyboard.press("Escape");

  // ============ (C) 자유 텍스트 — 선택 ============
  const labelEid = await findSvgText(A0, "finding-code");
  check("(C0) '1.1 finding-code 연결?' 라벨이 svgtext stamp됨", !!labelEid, "eid=" + labelEid);
  await frame().locator('[data-arch-eid="' + labelEid + '"]').click();
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 });
  const tSel = await page.evaluate(() => window.__archTest.getSelected());
  check("(C1) 자유 텍스트 클릭 → 그 텍스트 선택(박스 아님·전체 svg 아님)", tSel && tSel.eid === labelEid && tSel.svgtext === true && !tSel.svgbox && !/^obj:/.test(tSel.eid), JSON.stringify(tSel));
  await page.screenshot({ path: path.join(ART, "s7_svgtext_select.png") });
  await page.keyboard.press("Escape");

  // ============ (C) 자유 텍스트 — 편집 모드: 텍스트/색/드래그 ============
  await page.evaluate(() => window.__archTest.setMode("edit"));
  const tBefore = await textAttrs(A0, labelEid);
  check("(C1b) 자유 텍스트는 <text> · x/y 보유", tBefore.tag === "text" && Number.isFinite(tBefore.x) && Number.isFinite(tBefore.y), JSON.stringify(tBefore));
  await frame().locator('[data-arch-eid="' + labelEid + '"]').click();
  // popup removed 2026-07-21 → 선택 확인은 getSelected(패널 대신). 편집 크롬(이동 오버레이)은 그대로.
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, labelEid, { timeout: 5000 });
  // 편집 크롬: 이동 오버레이 표시, 리사이즈 핸들 숨김(텍스트는 크기 없음)
  const moveDisp = await frame().locator('[data-arch-overlay="move"]').evaluate((el) => getComputedStyle(el).display);
  const handleDisp = await frame().locator('[data-arch-overlay="handle"]').first().evaluate((el) => getComputedStyle(el).display);
  check("(C2) 자유 텍스트 편집 → 이동 오버레이 O · 리사이즈 핸들 X", moveDisp === "block" && handleDisp === "none", `move=${moveDisp} handle=${handleDisp}`);
  await page.screenshot({ path: path.join(ART, "s7_svgtext_panel.png") });

  // 텍스트 편집 — popup #stx-text 제거 → 요소 편집 OFF 인라인 커밋 경로
  await page.evaluate((e) => window.__archTest.applyInlineCommit(e, "svgtext", null, "1.1 코드 연결 확인?"), labelEid);
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  S = await page.evaluate(() => window.__archTest.getSource());
  const tAfterText = await textAttrs(S, labelEid);
  check("(C3) 자유 텍스트 내용 교체", tAfterText.text === "1.1 코드 연결 확인?" && tBefore.text !== tAfterText.text, `${tBefore.text}→${tAfterText.text}`);
  check("(C3b) bleed-diff: 그 텍스트만 변경(박스·다른 라벨 바이트 동일)", (await bleedClean(A0, S, labelEid)).ok, JSON.stringify(await bleedClean(A0, S, labelEid)));
  check("(C3c) 위치·색 보존(내용만)", tAfterText.x === tBefore.x && tAfterText.y === tBefore.y && tAfterText.fill === tBefore.fill);
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });

  // 색(fill) 편집 — popup #stx-fill 제거 → 결정론적 setFill 훅(툴바 글자색이 UI 경로를 담당)
  await frame().locator('[data-arch-eid="' + labelEid + '"]').click();
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, labelEid, { timeout: 5000 });
  await page.evaluate((e) => window.__archTest.applySvgManual([{ op: "setFill", eid: e, color: "#b91c1c" }], e), labelEid);
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  S = await page.evaluate(() => window.__archTest.getSource());
  const tAfterFill = await textAttrs(S, labelEid);
  check("(C4) 자유 텍스트 글자색(fill) 변경(#b91c1c)", tAfterFill.fill === "#b91c1c" && tBefore.fill !== "#b91c1c", `${tBefore.fill}→${tAfterFill.fill}`);
  check("(C4b) bleed-diff: 그 텍스트만 변경", (await bleedClean(A0, S, labelEid)).ok);
  check("(C4c) 내용·위치 보존(색만)", tAfterFill.text === tBefore.text && tAfterFill.x === tBefore.x);
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });

  // 드래그 이동 (화면px 델타 == SVG user 델타, viewBox 1:1 · scale 1). popup 제거로 가릴 팝업도 없다.
  await frame().locator('[data-arch-eid="' + labelEid + '"]').click();
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, labelEid, { timeout: 5000 });
  const dsel = await page.evaluate(() => window.__archTest.getSelected());
  const sb = await stageBox();
  const dcx = sb.x + dsel.rect.x + dsel.rect.w / 2;
  const dcy = sb.y + dsel.rect.y + dsel.rect.h / 2;
  const DX = -70, DY = -45;
  await page.mouse.move(dcx, dcy);
  await page.mouse.down();
  await page.mouse.move(dcx + DX, dcy + DY, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  S = await page.evaluate(() => window.__archTest.getSource());
  const tAfterMove = await textAttrs(S, labelEid);
  const dxOk = Math.abs((tAfterMove.x - tBefore.x) - DX) < 8;
  const dyOk = Math.abs((tAfterMove.y - tBefore.y) - DY) < 8;
  check("(C5) 드래그가 <text> x/y를 화면px→user 정확 변환", dxOk && dyOk, `Δ=(${(tAfterMove.x - tBefore.x).toFixed(1)},${(tAfterMove.y - tBefore.y).toFixed(1)}) expect≈(${DX},${DY})`);
  check("(C5b) 이동은 내용·색 보존", tAfterMove.text === tBefore.text && tAfterMove.fill === tBefore.fill);
  check("(C5c) bleed-diff: 그 텍스트만 변경", (await bleedClean(A0, S, labelEid)).ok, JSON.stringify(await bleedClean(A0, S, labelEid)));
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });

  // ============ (C6) 선택 모드 mock: 자유 텍스트 "라벨을 '…'로" → setText (핀 eid만) ============
  await page.evaluate(() => window.__archTest.setMode("select"));
  await frame().locator('[data-arch-eid="' + labelEid + '"]').click();
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 });
  await page.fill("#fi-text", "이 라벨을 '코드 연결?'로 바꿔줘");
  await page.click("#fi-run");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 8000 });
  S = await page.evaluate(() => window.__archTest.getSource());
  check("(C6) 선택 mock setText → 자유 텍스트 내용 교체", (await textAttrs(S, labelEid)).text === "코드 연결?");
  check("(C6b) bleed-diff: 선택 텍스트 하나만 변경", (await bleedClean(A0, S, labelEid)).ok);
  // 스코프: 다른 eid op = ScopeViolation
  const scopeErr = await page.evaluate((e) => {
    const other = e === "svgtext:0" ? "svgtext:1" : "svgtext:0";  // op이 핀(e)과 다른 eid를 노림
    try { window.__archTest.svgSanitize({ ops: [{ op: "setText", eid: other, text: "x" }] }, e); return "no-throw"; }
    catch (err) { return err.name; }
  }, labelEid);
  check("(C6c) 다른 eid op = ScopeViolation(자유 텍스트도 핀)", scopeErr === "ScopeViolation", scopeErr);
  const badColor = await page.evaluate((e) => window.__archTest.svgSanitize({ ops: [{ op: "setFill", eid: e, color: "url(#x)" }] }, e), labelEid);
  check("(C6d) url() 색 토큰 거부(자유 텍스트)", badColor.ops.length === 0 && badColor.notes.length > 0);
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });

  // ============ (E) 다운로드: svgtext stamp 유지 + 편집 반영 ============
  A0 = await loadSvg();
  const dlLabel = await findSvgText(A0, "finding-code");
  await page.evaluate((e) => window.__archTest.applySvgManual([{ op: "setFill", eid: e, color: "#22c55e" }], e), dlLabel);
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 10000 }),
    page.click("#btn-download"),
  ]);
  const dl = fs.readFileSync(await download.path(), "utf8");
  check("(E1) 다운로드에 <script 전무", !dl.includes("<script"));
  check("(E2) 다운로드에 오버레이 전무", !dl.includes("data-arch-overlay"));
  check("(E3) svgtext stamp 유지(Q6) + fill 편집 반영", dl.includes('data-arch-eid="svgtext:') && /fill="#22c55e"/.test(dl));

  // 라운드트립: 재열기 → svgtext 핀 보존(신규 stamp 0)
  await page.evaluate(async (h) => { await window.__archTest.load(h, "reopened.html"); }, dl);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
  await page.waitForTimeout(200);
  const reTexts = await page.evaluate(() => window.__archTest.getSvgTexts());
  check("(E4) 재열기: svgtext 핀 보존(재사용/중복 없음)", reTexts.length === 29 && new Set(reTexts.map((t) => t.eid)).size === 29, "count=" + reTexts.length);
  await frame().locator('[data-arch-eid="' + dlLabel + '"]').click();
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 });
  const reSel = await page.evaluate(() => window.__archTest.getSelected());
  check("(E5) 재열기 후에도 자유 텍스트 개별 선택 가능", reSel && reSel.eid === dlLabel && reSel.svgtext === true, JSON.stringify(reSel));

  check("(z) 페이지 콘솔 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 6).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s7_failure.png") }); } catch {}
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
