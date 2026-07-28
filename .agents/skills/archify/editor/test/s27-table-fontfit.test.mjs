// archify 요소 편집기 — s27: D43 표 세로축소 시 클립 대신 폰트/패딩 자동축소.
//   표 div를 표의 자연(intrinsic) 높이보다 작게 리사이즈하면, 클립(overflow:hidden) 대신 셀 font-size를
//   줄여 내용이 박스 안에 들어맞게 한다. 셀 패딩은 em(0.25em/0.5em)이라 div의 font-size 한 값만 줄여도
//   글자+패딩이 함께 비례 축소된다(단일 setStyle target:box로 커밋). 폰트 하한=12px(dom-adapter
//   OBJ_LINE_MIN_PX 재사용). 하한까지 줄여도 안 맞으면 그 이상은 바깥 div overflow:hidden 안전망이 클립.
//
// 검증(mock/키 불필요, 실제 draw+drag 경로):
//  · (regression) 새 2×2 표는 기본 16px로 자연 렌더(안 줄인 상태) — 회귀 없음
//  · (A) 표를 자연높이보다 조금 작게 → 폰트가 16 미만·하한 이상으로 줄고 intrinsic ≤ 박스높이(클립 없이 맞음)
//  · (A2) 축소된 font-size가 소스(div style)에 영속 + em 패딩이 폰트에 비례 축소
//  · (A-bleed) 리사이즈 커밋이 그 표 eid만 바꿈(그 밖 바이트 동일)
//  · (D grow-back) 다시 크게 리사이즈 → 폰트가 16px로 복귀
//  · (B floor+safetynet) 4×2를 100×50으로 → 폰트=하한 12px에서 멈추고 intrinsic > 박스높이(안전망 클립)
//  · (C extreme) 20×20 극단 축소 → 폰트가 하한 12px 밑으로 안 내려감
//  · (scope) 표가 아닌 obj(도형)를 작게 리사이즈해도 font-size가 붙지 않음(D43은 표 전용)
//  · (undo) 리사이즈 undo가 이전 소스로 바이트 복원
// ★ s24 삽입/드래그 패턴 재사용: 표 다이얼로그 → 캔버스 클릭 배치 → 좌표클릭 선택 → SE 핸들(nth 3) 실드래그.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8627;
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
const depth = () => page.evaluate(() => window.__archTest.undoDepth());
const getScale = () => page.evaluate(() => window.__archTest.getScale());
const clickId = (id) => page.evaluate((i) => document.getElementById(i).click(), id);
async function stageBox() { return await page.locator("#stage").boundingBox(); }
const newEidOf = (h) => page.evaluate((x) => { const e = new DOMParser().parseFromString(x, "text/html").querySelectorAll('[data-arch-eid^="new:"]'); return e.length ? e[e.length - 1].getAttribute("data-arch-eid") : null; }, h);

// 커밋된 소스에서 div font-size(축소 결과의 영속 지점) + layout w/h + overflow 읽기
const tableState = (eid) => page.evaluate((e) => {
  const doc = new DOMParser().parseFromString(window.__archTest.getSource(), "text/html");
  const el = doc.querySelector('[data-arch-eid="' + e + '"]');
  if (!el) return null;
  const fs = el.style.fontSize || "";
  return { fontPx: fs ? parseFloat(fs) : null, fontRaw: fs || "(none)", width: parseFloat(el.style.width), height: parseFloat(el.style.height),
           overflowHidden: /overflow:\s*hidden/.test(el.getAttribute("style") || ""),
           tdEmPad: /padding:\s*0\.25em\s+0\.5em/.test(el.innerHTML) };
}, eid);
// 뷰의 실측 intrinsic(폰트/패딩 그대로일 때 표 자연높이) vs div 안쪽 높이 + 셀 실효 폰트/패딩
const liveFit = (eid) => frame().locator(`[data-arch-eid="${eid}"]`).evaluate((div) => {
  const t = div.querySelector("table");
  const prev = t.style.height; t.style.height = "auto"; const intrinsic = t.getBoundingClientRect().height; t.style.height = prev || "100%";
  const td = t.querySelector("td");
  return { clientH: div.clientHeight, intrinsic: Math.round(intrinsic), cellFont: parseFloat(getComputedStyle(td).fontSize), cellPadTop: parseFloat(getComputedStyle(td).paddingTop) };
});

async function insertTable(rows, cols, atX, atY) {
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await settle(80);
  await clickId("fmt-table");
  await page.waitForSelector("#tbl-dialog:not([hidden])", { timeout: 5000 });
  for (let i = 0; i < rows - 2; i++) await clickId("tbl-rows-inc");   // 다이얼로그 기본 2×2
  for (let i = 0; i < cols - 2; i++) await clickId("tbl-cols-inc");
  await clickId("tbl-ok");
  await page.waitForSelector("#draw-palette:not([hidden])", { timeout: 5000 });
  const s = await stageBox();
  await page.mouse.click(s.x + atX, s.y + atY);
  await page.waitForFunction(() => window.__archTest.getSource() && /data-arch-eid="new:/.test(window.__archTest.getSource()), null, { timeout: 6000 });
  await settle(150);
  return await newEidOf(await src());
}

// 좌표클릭 선택 → SE 핸들(nth 3)을 목표 layout 크기까지 실드래그. 반환: 드래그 전 소스(undo 검증용)
async function resizeTo(eid, targetW, targetH) {
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await settle(100);
  const box = await frame().locator(`[data-arch-eid="${eid}"]`).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, eid, { timeout: 6000 });
  await frame().locator('[data-arch-overlay="handle"]').nth(3).waitFor({ state: "visible", timeout: 6000 });
  const before = await src();
  const st = await tableState(eid);
  const curW = st ? st.width : parseFloat((await frame().locator(`[data-arch-eid="${eid}"]`).evaluate((d) => d.style.width)));
  const curH = st ? st.height : parseFloat((await frame().locator(`[data-arch-eid="${eid}"]`).evaluate((d) => d.style.height)));
  const scale = await getScale();
  const seBox = await frame().locator('[data-arch-overlay="handle"]').nth(3).boundingBox();
  const dx = (targetW - curW) * scale, dy = (targetH - curH) * scale;
  const d0 = await depth();
  await page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(seBox.x + seBox.width / 2 + dx, seBox.y + seBox.height / 2 + dy, { steps: 14 });
  await page.mouse.up();
  await page.waitForFunction((d) => window.__archTest.undoDepth() === d + 1, d0, { timeout: 6000 }).catch(() => {});
  await settle(200);
  return before;
}

// 독립 bleed: 두 소스에서 달라진 [data-arch-eid] 집합
const diffChanged = (a, b) => page.evaluate(([ha, hb]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  const M = (d) => { const m = {}; d.querySelectorAll("[data-arch-eid]").forEach((el) => { m[el.getAttribute("data-arch-eid")] = el.outerHTML; }); return m; };
  const ma = M(P(ha)), mb = M(P(hb));
  const keys = new Set([...Object.keys(ma), ...Object.keys(mb)]);
  return [...keys].filter((k) => ma[k] !== mb[k]).sort();
}, [a, b]);

const FLOOR = 12, BASE_FONT = 16;

try {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await settle(150);
  const scale = await getScale();
  check("(0) 로드 + scale=1(좌표 단순화)", scale === 1, `scale=${scale}`);

  // ══════════ regression: 새 2×2 표는 자연 렌더(16px, 안 줄임) ══════════
  const eA = await insertTable(2, 2, 500, 400);
  const s0 = await tableState(eA);
  const f0 = await liveFit(eA);
  check("(R-1) 새 2×2 표: font-size 미설정(자연 16px) + td em 패딩(0.25em 0.5em)",
    !!s0 && s0.fontPx === null && s0.tdEmPad === true, `${JSON.stringify(s0)}`);
  check("(R-2) 자연 상태: 셀 실효 폰트 16px · intrinsic ≤ 박스높이(안 줄여도 맞음 → 클립/축소 불필요)",
    f0.cellFont === BASE_FONT && f0.intrinsic <= f0.clientH, `${JSON.stringify(f0)}`);

  // ══════════ D43-A: 자연높이보다 작게 → 폰트 축소로 클립 없이 맞춤 ══════════
  const A_before = await resizeTo(eA, 200, 56);   // 2×2 자연 intrinsic≈67 > 56 → 폰트 축소 유발
  await page.screenshot({ path: path.join(ART, "s27_A_shrink_fit.png") });
  const sA = await tableState(eA);
  const fA = await liveFit(eA);
  check("(A-1) ★폰트가 16 미만·하한 이상으로 축소(클립 대신 폰트 축소)",
    sA.fontPx !== null && sA.fontPx < BASE_FONT && sA.fontPx >= FLOOR, `fontPx=${sA.fontPx}`);
  check("(A-2) ★축소 후 intrinsic ≤ 박스 안쪽높이(+2px 허용) — 클립 없이 내용이 박스에 들어맞음",
    fA.intrinsic <= fA.clientH + 2, `intrinsic=${fA.intrinsic} clientH=${fA.clientH} font=${fA.cellFont}`);
  check("(A-3) 셀 실효 폰트 == 커밋된 div font-size(상속) + em 패딩이 폰트에 비례 축소(< 4px)",
    fA.cellFont === sA.fontPx && fA.cellPadTop < 4 && fA.cellPadTop > 0, `cellFont=${fA.cellFont} pad=${fA.cellPadTop}`);
  check("(A-4) 축소 font-size가 소스에 영속 + overflow:hidden 안전망 유지",
    sA.fontPx !== null && sA.overflowHidden === true, `${JSON.stringify(sA)}`);
  const difA = await diffChanged(A_before, await src());
  check("(A-5) bleed: 리사이즈가 그 표 eid만 변경(그 밖 바이트 동일)", difA.length === 1 && difA[0] === eA, JSON.stringify(difA));

  // ══════════ D43-A undo: 이전 소스로 바이트 복원 ══════════
  await page.evaluate(() => window.__archTest.undo());
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(150);
  check("(A-6) undo → 리사이즈 직전 소스로 바이트 동일 복원", (await src()) === A_before);

  // ══════════ D43-D: 다시 크게 → 폰트 16px 복귀(grow-back) ══════════
  await resizeTo(eA, 200, 56);   // 다시 축소
  await resizeTo(eA, 420, 320);  // 크게 → 자연높이가 박스 안에 들어와 폰트 복귀
  const sD = await tableState(eA);
  const fD = await liveFit(eA);
  check("(D-1) ★크게 리사이즈 → 폰트가 기본 16px로 복귀(축소분 원복)",
    sD.fontPx === BASE_FONT && fD.cellFont === BASE_FONT, `fontPx=${sD.fontPx} cellFont=${fD.cellFont}`);
  check("(D-2) 복귀 후 intrinsic ≤ 박스높이(자연 렌더)", fD.intrinsic <= fD.clientH, `${JSON.stringify(fD)}`);

  // ══════════ D43-B: 4×2 → 100×50, 폰트 하한 + 안전망 클립 ══════════
  const eB = await insertTable(4, 2, 900, 750);
  await resizeTo(eB, 100, 50);
  await page.screenshot({ path: path.join(ART, "s27_B_floor_clip.png") });
  const sB = await tableState(eB);
  const fB = await liveFit(eB);
  check("(B-1) ★4행이 50px에 다 안 들어감 → 폰트가 하한 12px에서 멈춤",
    sB.fontPx === FLOOR && fB.cellFont === FLOOR, `fontPx=${sB.fontPx} cellFont=${fB.cellFont}`);
  check("(B-2) ★하한에서도 안 맞음 → intrinsic > 박스높이(overflow:hidden 안전망이 초과분 클립)",
    fB.intrinsic > fB.clientH && sB.overflowHidden === true, `intrinsic=${fB.intrinsic} clientH=${fB.clientH}`);

  // ══════════ D43-C: 극단(20×20) → 폰트 하한 밑으로 안 내려감 ══════════
  await resizeTo(eB, 20, 20);
  const sC = await tableState(eB);
  check("(C-1) ★극단 축소(20×20)에서도 폰트가 하한 12px 밑으로 안 내려감",
    sC.fontPx === FLOOR, `fontPx=${sC.fontPx}`);

  // ══════════ scope: 표가 아닌 obj(도형)는 font-size 미부착(D43은 표 전용) ══════════
  // 도형 삽입 = 그리기 팔레트 shape 경로. fmt-textbox로 팔레트를 띄운 뒤 shape 선택 → 캔버스 클릭.
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await settle(80);
  await clickId("fmt-textbox");
  await page.waitForSelector("#draw-palette:not([hidden])", { timeout: 5000 });
  const hasShapeBtn = await page.evaluate(() => !!document.querySelector('#draw-palette [data-draw="shape"]'));
  let shapeEid = null;
  if (hasShapeBtn) {
    await page.evaluate(() => document.querySelector('#draw-palette [data-draw="shape"]').click());
    const s = await stageBox();
    const nBefore = (await src()).match(/data-arch-eid="new:/g);
    await page.mouse.click(s.x + 1300, s.y + 500);
    await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 6000 });
    await settle(150);
    shapeEid = await newEidOf(await src());
  }
  if (shapeEid) {
    await resizeTo(shapeEid, 40, 30);   // 작게 리사이즈
    const shSt = await page.evaluate((e) => {
      const el = new DOMParser().parseFromString(window.__archTest.getSource(), "text/html").querySelector('[data-arch-eid="' + e + '"]');
      return el ? { type: el.getAttribute("data-object-type"), fontPx: el.style.fontSize ? parseFloat(el.style.fontSize) : null } : null;
    }, shapeEid);
    check("(S-1) 표가 아닌 obj(도형)를 작게 리사이즈해도 font-size 미부착(D43 표 전용 스코프)",
      !!shSt && shSt.type === "shape" && shSt.fontPx === null, `${JSON.stringify(shSt)}`);
  } else {
    check("(S-1) [skip] 도형 그리기 팔레트 미제공 — 스코프 검증 생략", true, "no shape palette");
  }

  check("(Z) 전체 시퀀스 동안 콘솔/페이지 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 4).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 6).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s27_failure.png") }); } catch {}
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n=== s27 (D43 표 세로축소 폰트/패딩 자동축소) : ${pass} pass / ${fail} fail ===`);
process.exit(fail ? 1 : 0);
