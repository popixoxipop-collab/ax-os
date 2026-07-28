// s17 — D28: (A) 인라인 세션 열린 채 다른 줄/단위로의 "한 클릭 전환" + (B) obj <br> 서브라인 인식/편집.
// 실브라우저 그라운딩(Playwright, mock 경로·키 불필요). 정적 단언이 아니라 실제 클릭·타이핑·재렌더로 검증.
//   Bug A는 종류 무관(공유 클릭 인프라)이므로 obj·svgbox·svgtext·교차종류 전부 증명한다.
//   Bug B는 obj 한정 — LANE 02(obj:21)의 <br> 반쪽 5줄을 각각 클릭/편집, <br> 보존·형제 불변·bleed·undo.
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
const ctx = await browser.newContext({ viewport: { width: 2120, height: 1420 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));

const frame = () => page.frameLocator("#diagram-frame");
const ceCount = () => frame().locator('[contenteditable="true"]').count();
const ceText = async () => (await frame().locator('[contenteditable="true"]').first().textContent().catch(() => null));
const ovCount = () => frame().locator('input[data-arch-overlay="inline"]').count();
const ovVal = async () => (await frame().locator('input[data-arch-overlay="inline"]').first().inputValue().catch(() => null));
const inlineState = () => page.evaluate(() => window.__archTest.inlineState());
const src = () => page.evaluate(() => window.__archTest.getSource());
const depth = () => page.evaluate(() => window.__archTest.undoDepth());
const setOffEdit = async () => { await page.evaluate(() => window.__archTest.setMode("edit")); await page.evaluate(() => window.__archTest.setElementEditOn(false)); };

// obj <br>-반쪽 좌표 클릭: [eid] > div nth(di)의 상/하 반쪽
async function clickObjDivHalf(eid, di, frac) {
  const box = await frame().locator(`[data-arch-eid="${eid}"] > div`).nth(di).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * frac);
}
// 요소 중앙 좌표 클릭(SVG text/그 외)
async function clickRectCenter(loc) { const b = await loc.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }

// 다른 [data-arch-eid] 요소들이 바이트 동일한지(선택 eid 외) — 앱 bleedDiff 미사용(독립 검증).
const diffOthers = (a, b) => page.evaluate(([ha, hb]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  const M = (d) => { const m = {}; d.querySelectorAll("[data-arch-eid]").forEach((el) => { m[el.getAttribute("data-arch-eid")] = el.outerHTML; }); return m; };
  const ma = M(P(ha)), mb = M(P(hb));
  const keys = new Set([...Object.keys(ma), ...Object.keys(mb)]);
  return [...keys].filter((k) => ma[k] !== mb[k]).sort();
}, [a, b]);

try {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await page.evaluate(async (h) => { await window.__archTest.load(h, "svg.html"); }, SVG_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
  await setOffEdit();

  // 종류별 대상 탐색: 다줄 svgbox 2개(≥2 직속 <text>), 자유 svgtext 2개, LANE 라벨.
  const svgboxes = await page.evaluate(() => {
    const d = new DOMParser().parseFromString(window.__archTest.getSource(), "text/html");
    const out = [];
    for (const g of d.querySelectorAll('[data-svgbox="1"]')) {
      const texts = [...g.children].filter((c) => c.tagName && c.tagName.toLowerCase() === "text");
      if (texts.length >= 2) out.push({ eid: g.getAttribute("data-arch-eid"), lines: texts.map((t) => (t.textContent || "").replace(/\s+/g, " ").trim()) });
    }
    return out;
  });
  const svgtexts = await page.evaluate(() => window.__archTest.getSvgTexts());
  check("(S0) 대상 확보: 다줄 svgbox≥1 + 자유 svgtext≥2", svgboxes.length >= 1 && svgtexts.length >= 2, `boxes=${svgboxes.length} texts=${svgtexts.length}`);
  const BOX = svgboxes[0];

  // ============================================================
  // BUG A — 한 클릭 전환 (종류 무관, 공유 인프라)
  // ============================================================

  // ---- (A1) obj 줄→줄 (LANE 01, <br> 없는 깨끗 3 div) ----
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  await frame().getByText("LANE 01", { exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[contenteditable="true"]') != null || true, null, { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(150);
  check("(A1a) obj 줄1 인라인 열림", (await ceCount()) === 1 && (await ceText()) === "LANE 01", `ce=${await ceCount()} t=${JSON.stringify(await ceText())}`);
  await frame().getByText("사용자", { exact: true }).click();   // 다른 줄, Escape 없음
  await page.waitForTimeout(200);
  check("(A1b) ★한 클릭으로 줄2 인라인 열림(0 아님, stale 아님)", (await ceCount()) === 1 && (await ceText()) === "사용자", `ce=${await ceCount()} t=${JSON.stringify(await ceText())}`);
  await page.screenshot({ path: path.join(ART, "s17_A1_obj_line_switch.png") });

  // ---- (A2) svgbox 줄→줄 ----
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  await clickRectCenter(frame().locator(`[data-arch-eid="${BOX.eid}"] > text`).nth(0));
  await page.waitForTimeout(180);
  const a2a = await ovVal();
  check("(A2a) svgbox 줄0 오버레이 열림", (await ovCount()) === 1 && a2a === BOX.lines[0], `ov=${await ovCount()} v=${JSON.stringify(a2a)} want=${JSON.stringify(BOX.lines[0])}`);
  await clickRectCenter(frame().locator(`[data-arch-eid="${BOX.eid}"] > text`).nth(1));   // 다른 줄
  await page.waitForTimeout(200);
  const a2b = await ovVal();
  check("(A2b) ★한 클릭으로 svgbox 줄1 오버레이(내용 = 줄1)", (await ovCount()) === 1 && a2b === BOX.lines[1], `ov=${await ovCount()} v=${JSON.stringify(a2b)} want=${JSON.stringify(BOX.lines[1])}`);

  // ---- (A3) svgtext→svgtext ----
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  await clickRectCenter(frame().locator(`[data-arch-eid="${svgtexts[0].eid}"]`));
  await page.waitForTimeout(180);
  const a3a = await ovVal();
  check("(A3a) svgtext A 오버레이 열림", (await ovCount()) === 1 && a3a === svgtexts[0].text, `v=${JSON.stringify(a3a)} want=${JSON.stringify(svgtexts[0].text)}`);
  await clickRectCenter(frame().locator(`[data-arch-eid="${svgtexts[1].eid}"]`));
  await page.waitForTimeout(200);
  const a3b = await ovVal(), a3state = await inlineState();
  check("(A3b) ★한 클릭으로 svgtext B 오버레이(내용 = B)", (await ovCount()) === 1 && a3b === svgtexts[1].text && a3state && a3state.eid === svgtexts[1].eid, `v=${JSON.stringify(a3b)} eid=${a3state && a3state.eid}`);

  // ---- (A4) 교차종류: svgbox 줄 → 자유 svgtext ----
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  await clickRectCenter(frame().locator(`[data-arch-eid="${BOX.eid}"] > text`).nth(0));
  await page.waitForTimeout(180);
  const a4pre = await inlineState();
  await clickRectCenter(frame().locator(`[data-arch-eid="${svgtexts[0].eid}"]`));   // 교차종류 전환
  await page.waitForTimeout(200);
  const a4state = await inlineState(), a4val = await ovVal();
  check("(A4) ★한 클릭 교차종류 전환 svgbox→svgtext", a4pre && a4pre.kind === "svgbox" && a4state && a4state.kind === "svgtext" && a4state.eid === svgtexts[0].eid && a4val === svgtexts[0].text,
    `pre=${a4pre && a4pre.kind} post=${a4state && a4state.kind}/${a4state && a4state.eid} v=${JSON.stringify(a4val)}`);

  // ---- (A5) 미커밋 내용: 줄1에 타이핑 후 줄2 클릭 → 커밋됨(선택) + 줄2 열림 ----
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  const A5base = await src(), d0 = await depth();
  await frame().getByText("LANE 01", { exact: true }).click();
  await page.waitForTimeout(150);
  // contenteditable 전체 선택 상태이므로 타이핑이 교체
  await page.keyboard.type("레인일");
  await page.waitForTimeout(80);
  await frame().getByText("사용자", { exact: true }).click();   // 미커밋 상태로 전환
  // 변경 커밋은 재렌더를 유발 → pendingInlineOpen이 줄2를 재오픈. 안정 상태 대기.
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await page.waitForTimeout(300);
  const A5after = await src(), d1 = await depth();
  const committed = A5after.includes("레인일") && d1 === d0 + 1;
  check("(A5a) 미커밋 내용은 전환 시 커밋됨(소실 아님)", committed, `changedInSrc=${A5after.includes("레인일")} depth ${d0}->${d1}`);
  check("(A5b) 커밋 후 줄2가 열려 있음(정합 상태)", (await ceCount()) === 1 && (await ceText()) === "사용자", `ce=${await ceCount()} t=${JSON.stringify(await ceText())}`);
  const a5diff = await diffOthers(A5base, A5after);
  check("(A5c) 미커밋 커밋도 그 줄 컨테이너 1개만 변경(bleed clean)", a5diff.length === 1, JSON.stringify(a5diff));
  await page.evaluate(() => window.__archTest.undo());   // A5 원복
  await page.waitForTimeout(200);

  // ---- (A6) svgbox 미커밋 전환(재렌더 경로): 줄0 타이핑 후 줄1 클릭 → 커밋 + pendingInlineOpen 재오픈 ----
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  const A6base = await src(), a6d0 = await depth();
  await clickRectCenter(frame().locator(`[data-arch-eid="${BOX.eid}"] > text`).nth(0));
  await page.waitForTimeout(180);
  await frame().locator('input[data-arch-overlay="inline"]').first().fill("svgbox새값");
  await page.waitForTimeout(80);
  await clickRectCenter(frame().locator(`[data-arch-eid="${BOX.eid}"] > text`).nth(1));   // 미커밋 상태로 줄1 전환
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await page.waitForTimeout(300);
  const A6after = await src(), a6d1 = await depth(), a6val = await ovVal(), a6state = await inlineState();
  check("(A6a) svgbox 미커밋 전환: 줄0 변경 커밋됨(소실 아님)", A6after.includes("svgbox새값") && a6d1 === a6d0 + 1, `inSrc=${A6after.includes("svgbox새값")} depth ${a6d0}->${a6d1}`);
  check("(A6b) ★재렌더 후 pendingInlineOpen이 svgbox 줄1 오버레이를 다시 연다(내용=줄1)", (await ovCount()) === 1 && (a6val || "").trim() === BOX.lines[1] && a6state && a6state.line === 1, `ov=${await ovCount()} v=${JSON.stringify(a6val)} line=${a6state && a6state.line}`);
  await page.evaluate(() => window.__archTest.undo()); await page.waitForTimeout(200);

  // ---- (A7) 교차종류 obj→svgtext (내 핵심 obj editing-branch 수정이 비-obj 타깃으로 핸드오프) ----
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  await frame().getByText("LANE 01", { exact: true }).click();   // obj 줄 편집(editing 경로)
  await page.waitForTimeout(150);
  const a7pre = (await ceCount()) === 1;
  await clickRectCenter(frame().locator(`[data-arch-eid="${svgtexts[0].eid}"]`));   // → 자유 svgtext(교차종류)
  await page.waitForTimeout(200);
  const a7state = await inlineState(), a7val = await ovVal();
  check("(A7) ★한 클릭 교차종류 obj→svgtext (contenteditable→오버레이)", a7pre && (await ceCount()) === 0 && (await ovCount()) === 1 && a7state && a7state.kind === "svgtext" && a7val === svgtexts[0].text,
    `pre=${a7pre} ce=${await ceCount()} ov=${await ovCount()} kind=${a7state && a7state.kind}`);
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);

  // ============================================================
  // BUG B — obj <br> 서브라인
  // ============================================================
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  const LANE02 = "obj:21";
  const flat = await page.evaluate((e) => window.__archTest.objLineTargetCount(e), LANE02);
  check("(B1) LANE 02(obj:21) 평탄화 줄 수 = 5 (직속 div 3 + <br> 2)", flat === 5, `count=${flat}`);
  const WANT = ["LANE 02", "브라우저", "클라이언트", "JS 엔진 · Pyodide 분류기", "4턴 게이트 판정"];
  const texts = [];
  for (let i = 0; i < 5; i++) texts.push(await page.evaluate(([e, l]) => window.__archTest.objLineTextAt(e, l), [LANE02, i]));
  check("(B2a) 5개 서브라인 텍스트가 시각 줄과 정확히 일치", JSON.stringify(texts) === JSON.stringify(WANT), JSON.stringify(texts));

  // 각 <br>-반쪽을 좌표로 클릭 → 인라인 편집기가 그 반쪽 텍스트만 보여준다(독립 클릭성).
  // div0="LANE 02"(단일), div1="브라우저"/"클라이언트", div2="JS..."/"4턴..."
  const clickPlan = [
    { di: 0, frac: 0.5, want: "LANE 02" },
    { di: 1, frac: 0.25, want: "브라우저" },
    { di: 1, frac: 0.78, want: "클라이언트" },
    { di: 2, frac: 0.25, want: "JS 엔진 · Pyodide 분류기" },
    { di: 2, frac: 0.78, want: "4턴 게이트 판정" },
  ];
  let b2ok = true, b2log = [];
  for (const p of clickPlan) {
    await page.keyboard.press("Escape"); await page.waitForTimeout(70);
    await clickObjDivHalf(LANE02, p.di, p.frac);
    await page.waitForTimeout(150);
    const t = await ceText();
    b2log.push(`${p.want}=>${JSON.stringify(t)}`);
    if (t !== p.want) b2ok = false;
  }
  check("(B2b) ★5개 <br>-반쪽 각각 클릭 → 편집기 내용이 그 반쪽과 정확히 일치(독립)", b2ok, b2log.join(" | "));
  await page.screenshot({ path: path.join(ART, "s17_B_5lines_before.png") });

  // ---- (B-D26) 4-상태 텍스트 컨트롤 게이팅이 <br>-서브라인 인라인 편집에서도 성립(무회귀) ----
  await page.keyboard.press("Escape"); await page.waitForTimeout(100);
  const gateNo = await page.evaluate(() => window.__archTest.fmtCtrlDisabled("fmt-bold"));
  check("(B4) D26 게이팅: 인라인 세션 없을 때 텍스트 컨트롤 비활성", gateNo === true, `disabled=${gateNo}`);
  await clickObjDivHalf(LANE02, 2, 0.78);   // "4턴 게이트 판정" <br>-반쪽 편집 진입
  await page.waitForTimeout(150);
  const stD26 = await inlineState();
  const gateOn = await page.evaluate(() => window.__archTest.fmtCtrlDisabled("fmt-bold"));
  check("(B5) ★D26 게이팅: <br>-서브라인 인라인 편집 중 텍스트 컨트롤 활성 + obj 세션(line=4)", gateOn === false && stD26 && stD26.kind === "obj" && stD26.line === 4, `disabled=${gateOn} state=${JSON.stringify(stD26)}`);
  await page.keyboard.press("Escape"); await page.waitForTimeout(100);

  // ---- (B3) 한 <br>-반쪽만 편집: "클라이언트" → "테스트완료" ----
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  const B3base = await src(), db0 = await depth();
  const before21 = await page.evaluate((e) => { const d = new DOMParser().parseFromString(window.__archTest.getSource(), "text/html"); return d.querySelector(`[data-arch-eid="${e}"]`).innerHTML.replace(/\s+/g, " ").trim(); }, LANE02);
  await clickObjDivHalf(LANE02, 1, 0.78);   // "클라이언트" 반쪽
  await page.waitForTimeout(150);
  check("(B3a) '클라이언트' 반쪽 편집 진입(그 반쪽만 편집기에)", (await ceText()) === "클라이언트", JSON.stringify(await ceText()));
  await page.keyboard.type("테스트완료");    // 전체선택 상태라 교체
  await page.keyboard.press("Enter");         // 커밋
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await page.waitForTimeout(250);
  const B3after = await src(), db1 = await depth();
  const after21 = await page.evaluate((e) => { const d = new DOMParser().parseFromString(window.__archTest.getSource(), "text/html"); return d.querySelector(`[data-arch-eid="${e}"]`).innerHTML.replace(/\s+/g, " ").trim(); }, LANE02);
  const editedDiv = after21.split("</div>")[1] || "";   // 두 번째 div(브라우저<br>...)
  check("(B3b) ★편집한 반쪽만 변경 + <br> 보존 + 형제('브라우저') 불변",
    /브라우저<br>테스트완료/.test(after21) && !/클라이언트/.test(after21) && db1 === db0 + 1,
    `after2ndDiv=${JSON.stringify(editedDiv)}`);
  const b3diff = await diffOthers(B3base, B3after);
  check("(B3c) bleed-diff: obj:21 하나만 변경(다른 모든 단위 바이트 동일)", b3diff.length === 1 && b3diff[0] === LANE02, JSON.stringify(b3diff));
  // div0("LANE 02")·div2("JS..."/"4턴...")도 그대로인지(같은 컨테이너 내부 형제 세그먼트 불변)
  check("(B3d) 같은 컨테이너의 다른 서브라인 불변(LANE 02·JS·4턴 그대로)",
    /LANE 02/.test(after21) && /JS 엔진 · Pyodide 분류기<br>4턴 게이트 판정/.test(after21), after21.slice(0, 120));
  await page.screenshot({ path: path.join(ART, "s17_B_edited_half.png") });

  // ---- (B3 undo) 바이트 동일 복원 ----
  await page.evaluate(() => window.__archTest.undo());
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await page.waitForTimeout(200);
  const B3undo = await src();
  check("(B3e) undo가 소스를 바이트 동일 복원(<br> 구조 포함)", B3undo === B3base, `equal=${B3undo === B3base}`);
  const after21undo = await page.evaluate((e) => { const d = new DOMParser().parseFromString(window.__archTest.getSource(), "text/html"); return d.querySelector(`[data-arch-eid="${e}"]`).innerHTML.replace(/\s+/g, " ").trim(); }, LANE02);
  check("(B3f) undo 후 원본 <br> 구조 복원", after21undo === before21, `restored=${after21undo === before21}`);

  // ============================================================
  // 콘솔 에러(“응답에 ops 배열이 없습니다” 회귀 가드 포함)
  // ============================================================
  check("(Z) 전체 시퀀스 동안 콘솔/페이지 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 4).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s17_failure.png") }); } catch {}
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
