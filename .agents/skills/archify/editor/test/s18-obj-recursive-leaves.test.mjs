// s18 — D29: obj(class-b) 줄 감지를 "직속 자식" → "재귀적 리프"로 일반화.
// 실브라우저 그라운딩(Playwright, mock 경로·키 불필요). 정적 단언이 아니라 실제 클릭·타이핑·재렌더로 검증.
//
// 핵심 픽스처 = P01 "실행 전제" 노드박스(obj:26). 구조:
//   <div data-object textbox>
//     <div flex>            ← 자기 텍스트 없음, 자식이 한 겹 더 안 → D27c에선 컨테이너 전체 폴백
//       <div>SECURITY</div>
//       <div>AND</div>
//     </div>
//     <div>실행 전제</div>            ← 리프
//     <div>PDF ∧ key ∧ proxy</div>    ← 리프
//   </div>
// D27c/D28에선 flex 형제 하나가 탈락시켜 "실행 전제"(최대폰트) 한 줄만 도달 가능했다.
// D29는 재귀 리프로 4줄(SECURITY/AND/실행 전제/PDF ∧ key ∧ proxy) 전부 독립 편집 가능.
//   · 상위호환 증명: FRONTEND 3-div(D27c) · LANE 02 <br> 5줄(D28)이 동일 결과를 유지(무회귀).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8622;
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
const ceCount = () => frame().locator('[contenteditable="true"]').count();
const ceText = async () => (await frame().locator('[contenteditable="true"]').first().textContent().catch(() => null));
const inlineState = () => page.evaluate(() => window.__archTest.inlineState());
const src = () => page.evaluate(() => window.__archTest.getSource());
const depth = () => page.evaluate(() => window.__archTest.undoDepth());
const setOffEdit = async () => { await page.evaluate(() => window.__archTest.setMode("edit")); await page.evaluate(() => window.__archTest.setElementEditOn(false)); };
const tgtCount = (eid) => page.evaluate((e) => window.__archTest.objLineTargetCount(e), eid);
const leafText = (eid, i) => page.evaluate(([e, l]) => window.__archTest.objLineTextAt(e, l), [eid, i]);
const loadFixture = async (html, name) => {
  await page.evaluate(async ([h, n]) => { await window.__archTest.load(h, n); }, [html, name]);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
};

// 박스 안에서 정확 텍스트를 가진 (중첩 포함) 리프를 클릭.
async function clickLeaf(eid, text) {
  await frame().locator(`[data-arch-eid="${eid}"]`).getByText(text, { exact: true }).first().click();
}
// 박스 eid 하나만 변경됐는지(선택 eid 외 모든 [data-arch-eid] outerHTML 바이트 동일) — 앱 bleedDiff 미사용(독립 검증).
const diffOthers = (a, b) => page.evaluate(([ha, hb]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  const M = (d) => { const m = {}; d.querySelectorAll("[data-arch-eid]").forEach((el) => { m[el.getAttribute("data-arch-eid")] = el.outerHTML; }); return m; };
  const ma = M(P(ha)), mb = M(P(hb));
  const keys = new Set([...Object.keys(ma), ...Object.keys(mb)]);
  return [...keys].filter((k) => ma[k] !== mb[k]).sort();
}, [a, b]);

const BOX = "obj:26";                                    // "실행 전제" 노드박스
const LEAVES = ["SECURITY", "AND", "실행 전제", "PDF ∧ key ∧ proxy"];

try {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await loadFixture(P01, "p01.html");
  await setOffEdit();

  // ============================================================
  // (P0) 4-리프 탐지 — "실행 전제" 노드박스가 정확히 4줄을 노출
  // ============================================================
  const cnt = await tgtCount(BOX);
  check("(P0a) 실행 전제(obj:26) 평탄화 줄 수 = 4 (SECURITY/AND/실행 전제/PDF∧key∧proxy)", cnt === 4, `count=${cnt}`);
  const texts = [];
  for (let i = 0; i < 4; i++) texts.push(await leafText(BOX, i));
  check("(P0b) 4개 리프 텍스트가 정확히 일치(순서 포함)", JSON.stringify(texts) === JSON.stringify(LEAVES), JSON.stringify(texts));

  // ============================================================
  // (P1) 각 리프 클릭 → 인라인 편집기가 딱 그 리프 텍스트만 (더도 덜도 아님)
  // ============================================================
  let p1ok = true, p1log = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Escape"); await page.waitForTimeout(80);
    await clickLeaf(BOX, LEAVES[i]);
    await page.waitForTimeout(160);
    const t = await ceText(), st = await inlineState();
    const ok = (await ceCount()) === 1 && t === LEAVES[i] && st && st.kind === "obj" && st.line === i && st.eid === BOX;
    if (!ok) p1ok = false;
    p1log.push(`${LEAVES[i]}=>t:${JSON.stringify(t)} line:${st && st.line}`);
    if (i === 0) await page.screenshot({ path: path.join(ART, "s18_P1_SECURITY_selected.png"), clip: await frame().locator(`[data-arch-eid="${BOX}"]`).boundingBox().then((b) => ({ x: b.x - 12, y: b.y - 12, width: b.width + 24, height: b.height + 24 })) });
    if (i === 1) await page.screenshot({ path: path.join(ART, "s18_P1_AND_selected.png"), clip: await frame().locator(`[data-arch-eid="${BOX}"]`).boundingBox().then((b) => ({ x: b.x - 12, y: b.y - 12, width: b.width + 24, height: b.height + 24 })) });
  }
  check("(P1) 4개 리프 각각 클릭 → 인라인 편집기 내용 = 그 리프뿐(line 인덱스 정합)", p1ok, p1log.join(" | "));
  // 툴바 배지 상태(리프 인라인 세션 중) 스크린샷
  await page.screenshot({ path: path.join(ART, "s18_P1_toolbar_leaf_open.png"), clip: { x: 0, y: 0, width: 2120, height: 150 } });

  // ============================================================
  // (P2) "AND" 리프만 편집 → bleed-diff(타 유닛+형제 리프) 청결 + undo 바이트 동일
  // ============================================================
  await page.keyboard.press("Escape"); await page.waitForTimeout(100);
  const P2base = await src(), p2d0 = await depth();
  await clickLeaf(BOX, "AND");
  await page.waitForTimeout(150);
  check("(P2a) 'AND' 리프 편집 진입(그 리프만 편집기에)", (await ceText()) === "AND", JSON.stringify(await ceText()));
  await page.keyboard.type("XOR");             // 전체선택 상태라 교체
  await page.keyboard.press("Enter");          // 커밋
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await page.waitForTimeout(250);
  const P2after = await src(), p2d1 = await depth();
  const leavesAfter = [];
  for (let i = 0; i < 4; i++) leavesAfter.push(await leafText(BOX, i));
  check("(P2b) 편집한 리프만 변경: [SECURITY, XOR, 실행 전제, PDF ∧ key ∧ proxy]",
    JSON.stringify(leavesAfter) === JSON.stringify(["SECURITY", "XOR", "실행 전제", "PDF ∧ key ∧ proxy"]) && p2d1 === p2d0 + 1,
    `${JSON.stringify(leavesAfter)} depth ${p2d0}->${p2d1}`);
  const p2diff = await diffOthers(P2base, P2after);
  check("(P2c) bleed-diff: obj:26 하나만 변경(문서 내 다른 모든 유닛 바이트 동일)", p2diff.length === 1 && p2diff[0] === BOX, JSON.stringify(p2diff));
  // flex wrapper 구조·형제 리프 보존(SECURITY와 XOR 둘 다 여전히 같은 flex div 안)
  const box26after = await page.evaluate((e) => { const d = new DOMParser().parseFromString(window.__archTest.getSource(), "text/html"); return d.querySelector(`[data-arch-eid="${e}"]`).innerHTML.replace(/\s+/g, " ").trim(); }, BOX);
  check("(P2d) flex 헤더 구조 보존(SECURITY·XOR 같은 flex 안) + 나머지 리프 불변",
    /display:flex[\s\S]*SECURITY[\s\S]*XOR/.test(box26after) && /실행 전제/.test(box26after) && /PDF ∧ key ∧ proxy/.test(box26after) && !/>AND</.test(box26after),
    box26after.slice(0, 160));
  await page.evaluate(() => window.__archTest.undo());
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await page.waitForTimeout(200);
  const P2undo = await src();
  check("(P2e) undo가 소스를 바이트 동일 복원(flex/중첩 구조 포함)", P2undo === P2base, `equal=${P2undo === P2base}`);

  // ============================================================
  // (P3) 깊은 중첩에서의 한 클릭 전환(D28) — SECURITY 열고 Escape 없이 AND 클릭
  // ============================================================
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  await clickLeaf(BOX, "SECURITY");
  await page.waitForTimeout(150);
  const p3pre = (await ceText()) === "SECURITY";
  await clickLeaf(BOX, "AND");                  // Escape 없이 형제(깊은 중첩) 리프로 전환
  await page.waitForTimeout(220);
  const p3t = await ceText(), p3st = await inlineState();
  check("(P3) ★한 클릭 깊은-중첩 전환 SECURITY→AND (0 아님, stale 아님, line=1)",
    p3pre && (await ceCount()) === 1 && p3t === "AND" && p3st && p3st.line === 1, `pre=${p3pre} t=${JSON.stringify(p3t)} line=${p3st && p3st.line}`);
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);

  // ============================================================
  // (P4) D26 4-상태 게이팅이 중첩 리프에서도 성립
  // ============================================================
  await page.keyboard.press("Escape"); await page.waitForTimeout(100);
  const gateNone = await page.evaluate(() => window.__archTest.fmtCtrlDisabled("fmt-bold"));
  check("(P4a) 세션/선택 없음 → 텍스트 컨트롤 비활성", gateNone === true, `disabled=${gateNone}`);
  await clickLeaf(BOX, "SECURITY");             // OFF + 중첩 리프 인라인 열림
  await page.waitForTimeout(150);
  const gateLeaf = await page.evaluate(() => window.__archTest.fmtCtrlDisabled("fmt-bold"));
  const stLeaf = await inlineState();
  check("(P4b) ★OFF+중첩 리프 인라인 편집 중 → 텍스트 컨트롤 활성(kind=obj line=0)",
    gateLeaf === false && stLeaf && stLeaf.kind === "obj" && stLeaf.line === 0, `disabled=${gateLeaf} state=${JSON.stringify(stLeaf)}`);
  await page.keyboard.press("Escape"); await page.waitForTimeout(100);
  // ON + 도형(박스) 선택 → 텍스트 컨트롤 비활성
  await page.evaluate(() => window.__archTest.setElementEditOn(true));
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), BOX);
  await page.waitForTimeout(120);
  const gateOn = await page.evaluate(() => window.__archTest.fmtCtrlDisabled("fmt-bold"));
  check("(P4c) ON+도형 선택(인라인 세션 없음) → 텍스트 컨트롤 비활성", gateOn === true, `disabled=${gateOn}`);
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  await setOffEdit();

  // ============================================================
  // (S) 오버핏 아님 — 다른 노드박스도 4-리프(청크 분석 obj:28을 실제 클릭·편집)
  // ============================================================
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  const SPOT = "obj:28";                        // "청크 분석" 노드박스(SECURITY · LOOP / AND / 청크 분석 / 선택 ∧ 재시도 ∧ fan-in)
  const spotCnt = await tgtCount(SPOT);
  const spotTexts = [];
  for (let i = 0; i < 4; i++) spotTexts.push(await leafText(SPOT, i));
  check("(S1) 청크 분석(obj:28)도 4-리프 (오버핏 아님)",
    spotCnt === 4 && JSON.stringify(spotTexts) === JSON.stringify(["SECURITY · LOOP", "AND", "청크 분석", "선택 ∧ 재시도 ∧ fan-in"]),
    `cnt=${spotCnt} ${JSON.stringify(spotTexts)}`);
  const S2base = await src();
  await clickLeaf(SPOT, "청크 분석");            // 최대폰트 리프(과거 유일 도달 지점) — 여전히 개별 편집됨
  await page.waitForTimeout(150);
  const sSt = await inlineState();
  check("(S2) 청크 분석 최대폰트 리프 클릭 → line=2 (이제 형제와 독립)", (await ceText()) === "청크 분석" && sSt && sSt.line === 2, `t=${JSON.stringify(await ceText())} line=${sSt && sSt.line}`);
  // "SECURITY · LOOP"(중첩 리프)만 편집 → 그 유닛만, 형제 불변
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  await clickLeaf(SPOT, "SECURITY · LOOP");
  await page.waitForTimeout(150);
  await page.keyboard.type("보안 · 루프"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await page.waitForTimeout(200);
  const S2after = await src();
  const spotAfter = [];
  for (let i = 0; i < 4; i++) spotAfter.push(await leafText(SPOT, i));
  const sDiff = await diffOthers(S2base, S2after);
  check("(S3) 청크 분석 중첩 리프 편집 → 그 리프만 변경 + bleed 청결(obj:28 하나)",
    JSON.stringify(spotAfter) === JSON.stringify(["보안 · 루프", "AND", "청크 분석", "선택 ∧ 재시도 ∧ fan-in"]) && sDiff.length === 1 && sDiff[0] === SPOT,
    `${JSON.stringify(spotAfter)} diff=${JSON.stringify(sDiff)}`);
  await page.evaluate(() => window.__archTest.undo());
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await page.waitForTimeout(150);

  // ============================================================
  // (R) 상위호환(strict superset) 회귀 — D27c 3-줄 + D28 <br> 5-줄이 그대로
  // ============================================================
  // R1: P01 FRONTEND 박스(obj:22) — D27c 평평 3-div → 여전히 3-리프, 텍스트 동일.
  const R1cnt = await tgtCount("obj:22");
  const R1t = [];
  for (let i = 0; i < 3; i++) R1t.push(await leafText("obj:22", i));
  check("(R1) D27c 3-줄 타이틀블록(FRONTEND obj:22) 무회귀: 3-리프 + 동일 텍스트",
    R1cnt === 3 && JSON.stringify(R1t) === JSON.stringify(["FRONTEND", "PDF 업로드", "key/proxy 설정"]), `cnt=${R1cnt} ${JSON.stringify(R1t)}`);
  // R1b: 그 리프를 실제 클릭·편집해도 D27c 동작(개별 편집) 유지
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  await clickLeaf("obj:22", "PDF 업로드");
  await page.waitForTimeout(150);
  const r1st = await inlineState();
  check("(R1b) FRONTEND 중간 줄 클릭 → line=1 개별 편집(D27c 동작 유지)", (await ceText()) === "PDF 업로드" && r1st && r1st.line === 1, `t=${JSON.stringify(await ceText())} line=${r1st && r1st.line}`);
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);

  // R2: demo_svg_slide LANE 02(obj:21) — D28 <br> 5-줄이 그대로(재귀 리프의 특수 케이스).
  await loadFixture(SVG_HTML, "svg.html");
  await setOffEdit();
  const R2cnt = await tgtCount("obj:21");
  const R2t = [];
  for (let i = 0; i < 5; i++) R2t.push(await leafText("obj:21", i));
  check("(R2) D28 <br> 5-줄(LANE 02 obj:21) 무회귀: 5-리프 + 동일 서브라인 텍스트",
    R2cnt === 5 && JSON.stringify(R2t) === JSON.stringify(["LANE 02", "브라우저", "클라이언트", "JS 엔진 · Pyodide 분류기", "4턴 게이트 판정"]),
    `cnt=${R2cnt} ${JSON.stringify(R2t)}`);
  // R2b: <br> 반쪽 클릭도 그대로(좌표 기반)
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  const box21 = await frame().locator(`[data-arch-eid="obj:21"] > div`).nth(1).boundingBox();
  await page.mouse.click(box21.x + box21.width / 2, box21.y + box21.height * 0.78);   // "클라이언트" 반쪽
  await page.waitForTimeout(180);
  check("(R2b) D28 <br> 반쪽 클릭 무회귀: '클라이언트' 편집 진입", (await ceText()) === "클라이언트", JSON.stringify(await ceText()));
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);

  check("(Z) 전체 시퀀스 동안 콘솔/페이지 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 4).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 6).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s18_failure.png") }); } catch {}
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
