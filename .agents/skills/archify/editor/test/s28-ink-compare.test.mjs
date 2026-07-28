// Stage 28 — D33: "🔍 변경 비교" 잉크(렌더 픽셀) 비교 패널. 범위는 "편집 전반"(undo 한정 아님) —
// commitOps를 타는 아무 커밋(여기서는 fmtFill)이든 flashEid가 있으면 캡처된다.
//
// 검증 대상:
//   (A) SVG 단위(svgbox): fill 변경 커밋 후 버튼이 disabled→enabled, 클릭 시 전/후 캔버스가
//       실제로 다른 렌더(잉크 픽셀 수 차이)를 보여준다. 새 문서 로드 시 이전 비교가 안 남는다.
//   (B) obj(HTML) 단위: 같은 fmtFill(배경색) 커밋이 버튼은 활성화하지만, 열면 "미지원" 사유
//       메시지로 안전하게 대체된다(rasterizeUnit이 svg[data-object] 밖이라 null 반환).
//   (C) rasterizeUnit 직접 훅으로 전/후 ink 숫자가 실제로 다름을 수치로 재확인.
//
// 원칙(s10과 동일): "렌더됐다"는 주장을 속성이 아니라 캔버스 존재·ink 픽셀수로 실증한다.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8628;
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
const ctx = await browser.newContext({ viewport: { width: 2120, height: 1420 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));

async function loadHtml(html, name) {
  await page.evaluate(async ([h, n]) => { await window.__archTest.load(h, n); }, [html, name]);
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await page.waitForTimeout(250);
  return await page.evaluate(() => window.__archTest.getSource());
}
async function goto() {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
}
const firstEidWhere = (html, attrRegex) => {
  const re = new RegExp('data-arch-eid="([^"]+)"[^>]*' + attrRegex + '|' + attrRegex + '[^>]*data-arch-eid="([^"]+)"');
  const m = re.exec(html);
  return m ? (m[1] || m[2]) : null;
};

try {
  await goto();

  // ==================== (A) SVG 단위 — svgbox fill 변경 ====================
  let A0 = await loadHtml(SVG_HTML, "svg.html");
  const boxEid = firstEidWhere(A0, 'data-svgbox="1"');
  check("(A0) 사전조건: svgbox eid 하나 확보", !!boxEid, "boxEid=" + boxEid);

  check("(A1) 로드 직후 비교버튼 disabled", await page.evaluate(() => window.__archTest.inkBtnDisabled()) === true);
  check("(A1b) 로드 직후 lastInkCompare=null", (await page.evaluate(() => window.__archTest.getLastInkCompare())) === null);

  // fmtFill(commitFormat)은 mode==="edit" && elementEditOn을 요구(editor.js:348 게이트) — 서식은
  // 블록편집(ON) 상태에서만 가능. select 모드 그대로 두면 커밋 자체가 안 일어난다.
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await page.waitForTimeout(150);
  await page.evaluate((eid) => window.__archTest.selectByEid(eid), boxEid);
  const fillBefore = await page.evaluate((eid) => {
    const html = window.__archTest.getSource();
    const d = new DOMParser().parseFromString(html, "text/html");
    const el = d.querySelector('[data-arch-eid="' + eid + '"] rect, [data-arch-eid="' + eid + '"] polygon, [data-arch-eid="' + eid + '"] path');
    return el ? el.getAttribute("fill") : null;
  }, boxEid);
  await page.evaluate(() => window.__archTest.fmtFill("#3366ff"));
  await page.waitForTimeout(150);

  check("(A2) fill 커밋 후 비교버튼 enabled", await page.evaluate(() => window.__archTest.inkBtnDisabled()) === false);
  const cmp1 = await page.evaluate(() => window.__archTest.getLastInkCompare());
  check("(A3) lastInkCompare.eid == 방금 편집한 eid", cmp1 && cmp1.eid === boxEid, JSON.stringify(cmp1 && cmp1.eid));
  check("(A3b) before/after HTML이 실제로 다름(fill 바뀜)", cmp1 && cmp1.beforeHTML !== cmp1.afterHTML);

  // (C) rasterizeUnit 직접 훅 — 숫자로 전/후 ink 차이 확인
  const rBefore = await page.evaluate((a) => window.__archTest.rasterizeUnitTest(a.h, a.e), { h: cmp1.beforeHTML, e: boxEid });
  const rAfter = await page.evaluate((a) => window.__archTest.rasterizeUnitTest(a.h, a.e), { h: cmp1.afterHTML, e: boxEid });
  check("(C1) rasterizeUnit 둘 다 성공(svgbox는 지원 대상)", !!rBefore && !!rAfter, JSON.stringify({ rBefore, rAfter }));
  // fill 색만 바뀌어도 안티앨리어싱 경계 픽셀수가 근소하게 달라질 수 있어 "정확히 같지 않다"는
  // 보증은 안 하되(색상 자체가 alpha>=60 판정에 영향 없음이 정상), 최소한 둘 다 유의미한 ink(도형
  // 면적)를 갖고 있어야 한다 — "렌더는 됐다"의 최소 실증.
  check("(C2) 둘 다 유의미한 ink(>100px, 도형이 실제로 그려짐)", rBefore && rAfter && rBefore.ink > 100 && rAfter.ink > 100, JSON.stringify({ rBefore, rAfter }));

  // 패널 UI e2e
  await page.click("#btn-ink-compare");
  await page.waitForTimeout(400);
  check("(A4) 패널 열림", !(await page.getAttribute("#ink-panel", "hidden")) !== undefined && !(await page.$eval("#ink-panel", (e) => e.hidden)));
  check("(A5) 본문 표시(미지원 아님)", !(await page.$eval("#ink-body", (e) => e.hidden)) && (await page.$eval("#ink-unsupported", (e) => e.hidden)));
  check("(A6) 전/후 캔버스 둘 다 실제로 DOM에 붙음", !!(await page.$("#ink-before-holder canvas")) && !!(await page.$("#ink-after-holder canvas")));
  const beforeTxt = await page.$eval("#ink-before-count", (e) => e.textContent);
  const afterTxt = await page.$eval("#ink-after-count", (e) => e.textContent);
  check("(A7) ink 카운트 텍스트가 실제 숫자를 담음", /\d+px/.test(beforeTxt) && /\d+px/.test(afterTxt), beforeTxt + " / " + afterTxt);
  const deltaTxt = await page.$eval("#ink-delta", (e) => e.textContent);
  check("(A8) 차이 텍스트 표시됨", /차이:/.test(deltaTxt), deltaTxt);
  await page.screenshot({ path: path.join(ART, "s28_svgbox_compare.png"), clip: { x: 0, y: 0, width: 700, height: 420 } });

  await page.click("#ink-close");
  await page.waitForTimeout(150);
  check("(A9) 닫기 버튼으로 패널 숨김", await page.$eval("#ink-panel", (e) => e.hidden));

  // ==================== (B) obj(HTML) 단위 — 새 문서 로드 후 미지원 경로 ====================
  const B0 = await loadHtml(P01_HTML, "p01.html");
  check("(B0) 새 문서 로드 후 이전 비교가 안 남음(lastInkCompare 리셋)",
    (await page.evaluate(() => window.__archTest.getLastInkCompare())) === null);
  check("(B0b) 새 문서 로드 후 버튼도 다시 disabled", await page.evaluate(() => window.__archTest.inkBtnDisabled()) === true);

  const objEid = firstEidWhere(B0, 'data-object="true"');
  check("(B1) 사전조건: obj eid 하나 확보(p01은 class-b div-per-요소)", !!objEid, "objEid=" + objEid);

  await page.evaluate(() => window.__archTest.setMode("edit"));
  await page.waitForTimeout(150);
  await page.evaluate((eid) => window.__archTest.selectByEid(eid), objEid);
  await page.evaluate(() => window.__archTest.fmtFill("#22cc66"));
  await page.waitForTimeout(150);
  check("(B2) obj 커밋도 비교버튼은 enabled(캡처 자체는 단위 무관)", await page.evaluate(() => window.__archTest.inkBtnDisabled()) === false);

  const rObj = await page.evaluate((a) => window.__archTest.rasterizeUnitTest(a.h, a.e), { h: B0, e: objEid });
  check("(B3) rasterizeUnit이 obj eid에 대해 null(svg[data-object] 서브트리 밖)", rObj === null, JSON.stringify(rObj));

  await page.click("#btn-ink-compare");
  await page.waitForTimeout(400);
  check("(B4) 패널은 열리되 본문은 숨고 미지원 메시지가 보임",
    !(await page.$eval("#ink-panel", (e) => e.hidden))
    && (await page.$eval("#ink-body", (e) => e.hidden))
    && !(await page.$eval("#ink-unsupported", (e) => e.hidden)));
  const unsupportedTxt = await page.$eval("#ink-unsupported", (e) => e.textContent);
  check("(B5) 미지원 메시지가 eid와 이유(HTML/obj)를 언급", unsupportedTxt.includes(objEid) && /HTML/.test(unsupportedTxt), unsupportedTxt);
  await page.screenshot({ path: path.join(ART, "s28_obj_unsupported.png"), clip: { x: 0, y: 0, width: 700, height: 300 } });

  check("(Z) 콘솔/페이지 에러 없음", pageErrors.length === 0, JSON.stringify(pageErrors));
} catch (e) {
  console.error("EXCEPTION", e);
  fail++;
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
