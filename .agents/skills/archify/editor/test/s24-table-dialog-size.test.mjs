// archify 요소 편집기 — s24: D40(표 삽입 행/열 다이얼로그) + D38(표 크기버그: table-layout:fixed).
//   둘은 같은 코드경로(표 삽입/렌더)라 한 파일에서 검증한다. mock/키 불필요 — 전부 직접조작.
//
// 검증 축:
//  · D40: ▦표 버튼 → 행/열 다이얼로그 선행 → 스테퍼(−/+)·확인/취소 → 확인 시 N×M 그리드, 취소 시 그리기 진입 안 함
//  · D38: 표를 100×50으로 축소 → 바깥 div 렌더 크기 == <table> 렌더 크기(초과분 삐져나옴 없음)
//         + 소스에 table-layout:fixed / td overflow:hidden 존재
// ★ bleed-diff는 앱 어댑터를 재사용하지 않고 테스트가 독립 구현으로 대조한다(순환 검증 방지).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8624;
const BASE = `http://127.0.0.1:${PORT}`;
const ART = path.join(APP_DIR, "test", "artifacts");
fs.mkdirSync(ART, { recursive: true });

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
const eidCount = (h) => page.evaluate((x) => new DOMParser().parseFromString(x, "text/html").querySelectorAll("[data-arch-eid]").length, h);
async function stageBox() { return await page.locator("#stage").boundingBox(); }
const val = (id) => page.evaluate((i) => document.getElementById(i).value, id);
const clickId = (id) => page.evaluate((i) => document.getElementById(i).click(), id);

// 독립 bleed 검증: 변경된 [data-arch-eid] 집합
const diffChanged = (a, b) => page.evaluate(([ha, hb]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  const M = (d) => { const m = {}; d.querySelectorAll("[data-arch-eid]").forEach((el) => { m[el.getAttribute("data-arch-eid")] = el.outerHTML; }); return m; };
  const ma = M(P(ha)), mb = M(P(hb));
  const keys = new Set([...Object.keys(ma), ...Object.keys(mb)]);
  return [...keys].filter((k) => ma[k] !== mb[k]).sort();
}, [a, b]);
const newEidOf = (h) => page.evaluate((x) => {
  const els = new DOMParser().parseFromString(x, "text/html").querySelectorAll('[data-arch-eid^="new:"]');
  return els.length ? els[els.length - 1].getAttribute("data-arch-eid") : null;
}, h);
// 표 구조(행 수 · 행별 셀 수 · td 총수 · type)
const tableShape = (h, eid) => page.evaluate(([x, e]) => {
  const el = new DOMParser().parseFromString(x, "text/html").querySelector('[data-arch-eid="' + e + '"]');
  if (!el) return null;
  const trs = [...el.querySelectorAll("tr")];
  return { rows: trs.length, cellsPerRow: trs.map((tr) => tr.querySelectorAll("td").length),
           tdCount: el.querySelectorAll("td").length, type: el.getAttribute("data-object-type") };
}, [h, eid]);

async function drawAtEmpty() { const s = await stageBox(); await page.mouse.click(s.x + 900, s.y + 700); }
async function openDialogViaFmt() {
  await clickId("fmt-table");
  await page.waitForSelector("#tbl-dialog:not([hidden])", { timeout: 5000 });
}

try {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await settle(150);
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await settle(120);
  const A0 = await src();
  check("(0) 로드 + 초기 그린(obj 존재)", A0.includes('data-arch-eid="obj:'));

  // ══════════════════════ D40 다이얼로그 ══════════════════════
  // (D40-a) ▦표 버튼 → '표 삽입' 다이얼로그 선행(그리기 모드로 즉시 진입하지 않음) + 기본 2×2
  await openDialogViaFmt();
  const dlgTitle = (await page.evaluate(() => (document.getElementById("tbl-dialog-title").textContent || "").trim()));
  const defR = await val("tbl-rows"), defC = await val("tbl-cols"), modeAtOpen = await getMode();
  check("(D40-a) 표 버튼 → '표 삽입' 다이얼로그 열림 + 기본 2×2 + 아직 draw 아님",
    dlgTitle === "표 삽입" && defR === "2" && defC === "2" && modeAtOpen !== "draw",
    `title=${dlgTitle} r=${defR} c=${defC} mode=${modeAtOpen}`);

  // (D40-b) 스테퍼 −/+: 행 +2(→4), 열 하한 클램프(−5 눌러도 1), 다시 +1(→2) — 4×2 의도
  await clickId("tbl-rows-inc"); await clickId("tbl-rows-inc");
  const rAfterInc = await val("tbl-rows");
  for (let i = 0; i < 5; i++) await clickId("tbl-cols-dec");
  const cClamped = await val("tbl-cols");
  await clickId("tbl-cols-inc");
  const cBack = await val("tbl-cols");
  check("(D40-b) 스테퍼: 행 +2→4 · 열 하한 클램프 1 · +1→2",
    rAfterInc === "4" && cClamped === "1" && cBack === "2", `r=${rAfterInc} cClamp=${cClamped} cBack=${cBack}`);

  // (D40-c) 확인 → 그리기 모드 + 표 팔레트 active
  const beforeN = await eidCount(await src());
  await clickId("tbl-ok");
  await page.waitForSelector("#tbl-dialog", { state: "hidden", timeout: 5000 });
  await page.waitForSelector("#draw-palette:not([hidden])", { timeout: 5000 });
  const tActive = await page.evaluate(() => { const b = document.querySelector('#draw-palette [data-draw="table"]'); return b ? b.classList.contains("active") : null; });
  check("(D40-c) 확인 → 그리기 모드 + 표 팔레트 active", (await getMode()) === "draw" && tActive === true, `mode=${await getMode()} active=${tActive}`);

  // (D40-d) 캔버스 클릭 → 실제 4×2 = 8셀 <td> 생성 + 편집 모드 자동 진입
  await drawAtEmpty();
  await page.waitForFunction((n) => window.__archTest.getSource() && new DOMParser().parseFromString(window.__archTest.getSource(), "text/html").querySelectorAll("[data-arch-eid]").length === n + 1, beforeN, { timeout: 6000 });
  const S1 = await src();
  const tabEid = await newEidOf(S1);
  const shape = await tableShape(S1, tabEid);
  check("(D40-d) 4×2 표: 4행 × 각행 2셀 = 8 <td> · type=table · 편집 모드",
    !!tabEid && shape && shape.type === "table" && shape.rows === 4 && shape.cellsPerRow.every((n) => n === 2) && shape.tdCount === 8 && (await getMode()) === "edit",
    `eid=${tabEid} ${JSON.stringify(shape)} mode=${await getMode()}`);

  // (D40-e) bleed-diff: 새 eid 하나만 추가, 그 밖 바이트 동일
  const dif = await diffChanged(A0, S1);
  check("(D40-e) bleed-diff: 추가된 eid 하나만 변경(그 밖 바이트 동일)", dif.length === 1 && dif[0] === tabEid, JSON.stringify(dif));

  // ══════════════════════ D40 취소 경로 ══════════════════════
  // (D40-f) 표 버튼 → 다이얼로그 → 취소 → 그리기 진입 안 함 + 요소 수 불변
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await settle(80);
  const nBefore = await eidCount(await src());
  await openDialogViaFmt();
  await clickId("tbl-cancel");
  await page.waitForSelector("#tbl-dialog", { state: "hidden", timeout: 5000 });
  const modeAfterCancel = await getMode(), nAfter = await eidCount(await src());
  check("(D40-f) 취소 → draw 모드 진입 안 함 + 요소 수 불변",
    modeAfterCancel !== "draw" && nAfter === nBefore, `mode=${modeAfterCancel} n ${nBefore}→${nAfter}`);

  // (D40-g) draw-palette의 ▦표 버튼도 다이얼로그 경유(두 번째 진입점) — 텍스트상자 그리기로 팔레트를 띄운 뒤 클릭
  await clickId("fmt-textbox");
  await page.waitForSelector("#draw-palette:not([hidden])", { timeout: 5000 });
  await page.evaluate(() => document.querySelector('#draw-palette [data-draw="table"]').click());
  const paletteOpensDlg = await page.waitForSelector("#tbl-dialog:not([hidden])", { timeout: 5000 }).then(() => true).catch(() => false);
  await clickId("tbl-cancel");
  check("(D40-g) draw-palette ▦표 버튼도 행/열 다이얼로그 경유", paletteOpensDlg === true);

  // ══════════════════════ D38 표 크기버그 ══════════════════════
  // (D38-a) 소스 레벨 3중 레시피: <table> table-layout:fixed + <td> overflow:hidden;min-width:0 + 바깥 div overflow:hidden
  check("(D38-a) 소스: table-layout:fixed + td overflow:hidden;min-width:0 + 표 div overflow:hidden",
    /<table[^>]*table-layout:\s*fixed/.test(S1) && /<td[^>]*overflow:\s*hidden[^>]*min-width:\s*0/.test(S1) && /overflow:hidden;\s*z-index:20/.test(S1),
    (S1.match(/<table[^>]*>/) || [""])[0] + " | " + (S1.match(/<div[^>]*data-object-type="table"[^>]*>/) || [""])[0]);

  // (D38-b~e) 렌더 레벨: 위 4×2 표(4행 → min-content 높이 > 50)를 SE 핸들로 100×50으로 축소.
  //   ★ 가로: table-layout:fixed로 table width == div width(초과 없음). 세로: 표 행은 콘텐츠 밑으로 안 줄어드나
  //     바깥 div overflow:hidden이 박스 안에서 클립 → 선택 핸들 밖으로 삐져나오지 않는다.
  //   셀 인라인편집을 피하려 element-edit ON 좌표클릭으로 obj 선택 → SE 핸들(nth=3) 드래그.
  await page.evaluate(() => window.__archTest.setMode("edit"));   // element-edit ON(기본) → obj 블록 선택(핸들 크롬)
  await settle(120);
  const tbClick = await frame().locator(`[data-arch-eid="${tabEid}"]`).boundingBox();   // 좌표 클릭(actionability 대기 회피)
  await page.mouse.click(tbClick.x + tbClick.width / 2, tbClick.y + tbClick.height / 2);
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, tabEid, { timeout: 6000 });
  await settle(180);
  await frame().locator('[data-arch-overlay="handle"]').nth(3).waitFor({ state: "visible", timeout: 6000 });
  const divBox0 = await frame().locator(`[data-arch-eid="${tabEid}"]`).boundingBox();
  const scale = divBox0.width / 320;   // onDrawAt 표 기본 배치 = 320×140 → 렌더/레이아웃 비율
  const seBox = await frame().locator('[data-arch-overlay="handle"]').nth(3).boundingBox();
  const dx = (100 - 320) * scale, dy = (50 - 140) * scale;   // 목표 layout 100×50
  const d0 = await depth();
  await page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(seBox.x + seBox.width / 2 + dx, seBox.y + seBox.height / 2 + dy, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction((d) => window.__archTest.undoDepth() === d + 1, d0, { timeout: 6000 });
  await settle(150);
  const divBox = await frame().locator(`[data-arch-eid="${tabEid}"]`).boundingBox();
  const tblBox = await frame().locator(`[data-arch-eid="${tabEid}"] table`).boundingBox();
  const clip = await frame().locator(`[data-arch-eid="${tabEid}"]`).evaluate((div) => {
    const t = div.querySelector("table");
    return { divOverflow: getComputedStyle(div).overflowX + "/" + getComputedStyle(div).overflowY,
             divClientH: div.clientHeight, divClientW: div.clientWidth, tableOffsetH: t.offsetHeight, tableOffsetW: t.offsetWidth };
  });
  const wLayout = divBox.width / scale, hLayout = divBox.height / scale;
  await page.screenshot({ path: path.join(ART, "s24_table_resized.png") });
  // (D38-b) 가로 초과 제거: <table> 렌더 width == 바깥 div 렌더 width (table-layout:fixed → 열 폭이 min-content로 안 벌어짐)
  check("(D38-b) 가로: <table> 렌더 width == div 렌더 width (핸들 밖 가로 삐져나옴 없음)",
    Math.abs(divBox.width - tblBox.width) < 1.5,
    `div w ${divBox.width.toFixed(1)} vs table w ${tblBox.width.toFixed(1)}`);
  // (D38-c) 축소 후 div가 핸들이 정한 100×50을 유지 + div가 overflow:hidden으로 세로 초과분을 박스 안에 가둠
  check("(D38-c) div ≈ 100×50 유지 + overflow:hidden(세로 초과분 클립 → 핸들 밖 삐져나옴 차단)",
    wLayout > 88 && wLayout < 116 && hLayout > 35 && hLayout < 62 && /hidden/.test(clip.divOverflow),
    `layout ${wLayout.toFixed(1)}×${hLayout.toFixed(1)} overflow=${clip.divOverflow}`);
  // (D38-d) 클립이 실제로 일할 것: 표 고유 높이(4행 min-content) > div 안쪽 높이 → 이 시나리오가 바로 "div가 표보다 작음"
  check("(D38-d) 시나리오 실증: 표 고유 높이 > div 안쪽 높이(그래서 클립이 필요)",
    clip.tableOffsetH > clip.divClientH + 15,
    `tableOffsetH=${clip.tableOffsetH} divClientH=${clip.divClientH}`);

  check("(Z) 전체 시퀀스 동안 콘솔/페이지 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 4).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 6).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s24_failure.png") }); } catch {}
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n=== s24 (D40 표 다이얼로그 + D38 표 크기) : ${pass} pass / ${fail} fail ===`);
process.exit(fail ? 1 : 0);
