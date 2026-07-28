// archify 요소 편집기 — s22: D35(이미지) + D36(표) 요소 단위 삽입.
//
// 검증 축(요청 사양 그대로, mock 경로·키 불필요 — 전부 직접조작이라 LLM 호출 없음):
//  · 버튼 클릭 → 그리기 모드 진입(drawKind 세팅) · 캔버스 클릭 → 실제 새 obj eid 생성
//  · bleed-diff 청결(추가분만 diff, 나머지 [data-arch-eid] 바이트 동일) · undo 바이트 동일 복원
//  · 표: <td> 셀이 D29 재귀 리프로 인식돼 클릭 한 번에 인라인 편집(새 텍스트편집 경로 없이) — ★최우선 검증
//  · 이미지: 실측 종횡비로 배치(최대 변 320px 스케일) + 공통 리사이즈 핸들이 그대로 먹음
//
// ★ bleed-diff는 앱 어댑터를 재사용하지 않고 테스트가 독립 구현으로 대조한다(순환 검증 방지).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import zlib from "node:zlib";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8623;
const BASE = `http://127.0.0.1:${PORT}`;
const ART = path.join(APP_DIR, "test", "artifacts");
fs.mkdirSync(ART, { recursive: true });

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "  — " + extra : "")); }
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 테스트용 PNG 생성(외부 자산 의존 없이 실측 종횡비를 만든다) ----
//   RGB solid, 800×400 → 최대 변 800 > 320 이라 스케일 0.4 → 배치 320×160(2:1 유지)을 검증한다.
function crc32(buf) {
  let c = ~0 >>> 0;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return (~c) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function makePNG(w, h, rgb = [210, 70, 70]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;  // 8bit RGB
  const rowPix = Buffer.concat(Array.from({ length: w }, () => Buffer.from(rgb)));
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), rowPix])));
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}
const PNG = makePNG(800, 400);

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
const getMode = () => page.evaluate(() => window.__archTest.getMode());
const eidCount = (h) => page.evaluate((x) => new DOMParser().parseFromString(x, "text/html").querySelectorAll("[data-arch-eid]").length, h);
const tgtCount = (eid) => page.evaluate((e) => window.__archTest.objLineTargetCount(e), eid);
const leafText = (eid, i) => page.evaluate(([e, l]) => window.__archTest.objLineTextAt(e, l), [eid, i]);
const ceText = async () => (await frame().locator('[contenteditable="true"]').first().textContent().catch(() => null));
const ceCount = () => frame().locator('[contenteditable="true"]').count();
const inlineState = () => page.evaluate(() => window.__archTest.inlineState());
async function stageBox() { return await page.locator("#stage").boundingBox(); }
async function reset() {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await settle(150);
  return await src();
}
// 앱 bleedDiff 미사용(독립 검증): 변경된 [data-arch-eid] 집합.
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
const objInfo = (h, eid) => page.evaluate(([x, e]) => {
  const el = new DOMParser().parseFromString(x, "text/html").querySelector('[data-arch-eid="' + e + '"]');
  if (!el) return null;
  const s = el.getAttribute("style") || "";
  const g = (k) => { const m = new RegExp("(?:^|;)\\s*" + k + "\\s*:\\s*([^;]+)").exec(s); return m ? m[1].trim() : null; };
  const img = el.querySelector("img");
  const tds = el.querySelectorAll("td");
  return {
    type: el.getAttribute("data-object-type"),
    width: g("width"), height: g("height"),
    hasTable: !!el.querySelector("table"), tdCount: tds.length,
    imgSrc: img ? (img.getAttribute("src") || "").slice(0, 24) : null,
    imgFit: img ? /object-fit:\s*fill/.test(img.getAttribute("style") || "") : null,   // D39: contain→fill
  };
}, [h, eid]);
const num = (v) => (v == null ? null : parseFloat(v));
async function drawAtEmpty() {   // 스테이지의 빈 우하단 영역을 클릭해 배치
  const s = await stageBox();
  await page.mouse.click(s.x + 900, s.y + 700);
}

try {
  let A0 = await reset();
  check("(0) 로드 + 초기 그린", A0.includes('data-arch-eid="obj:'));

  // ══════════════════════ D36 표 ══════════════════════
  // (T-a) fmt-table 버튼 클릭 → D40 행/열 다이얼로그 → 3×3 확인 → 그리기 모드 진입 + drawKind=table(팔레트 active)
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await settle(120);
  await page.evaluate(() => document.getElementById("fmt-table").click());
  await page.waitForSelector("#tbl-dialog:not([hidden])", { timeout: 5000 });   // D40: 표는 다이얼로그가 선행
  await page.evaluate(() => { document.getElementById("tbl-rows").value = 3; document.getElementById("tbl-cols").value = 3; });
  await page.evaluate(() => document.getElementById("tbl-ok").click());
  await page.waitForSelector("#draw-palette:not([hidden])", { timeout: 5000 });
  const tActive = await page.evaluate(() => { const b = document.querySelector('#draw-palette [data-draw="table"]'); return b ? b.classList.contains("active") : null; });
  check("(T-a) ▦표 버튼 → 다이얼로그(3×3 확인) → 그리기 모드 + 표 팔레트 active", (await getMode()) === "draw" && tActive === true, `mode=${await getMode()} active=${tActive}`);

  // (T-b) 캔버스 클릭 → 새 obj(table) 생성 + <table> 3×3(9셀) + 편집 모드 자동 진입
  const beforeN = await eidCount(A0);
  await drawAtEmpty();
  await page.waitForFunction((n) => window.__archTest.getSource() && new DOMParser().parseFromString(window.__archTest.getSource(), "text/html").querySelectorAll("[data-arch-eid]").length === n + 1, beforeN, { timeout: 6000 });
  const Stab = await src();
  const tabEid = await newEidOf(Stab);
  const tinfo = await objInfo(Stab, tabEid);
  check("(T-b) 표 삽입: 새 obj(type=table) + <table> 9셀 · 편집 모드 자동 진입",
    tabEid && tinfo && tinfo.type === "table" && tinfo.hasTable && tinfo.tdCount === 9 && (await getMode()) === "edit",
    `eid=${tabEid} ${JSON.stringify(tinfo)} mode=${await getMode()}`);

  // (T-c) bleed-diff: 새 eid 하나만 추가되고 그 밖은 전부 바이트 동일
  const tdiff = await diffChanged(A0, Stab);
  check("(T-c) bleed-diff: 추가된 eid 하나만 변경(그 밖 바이트 동일)", tdiff.length === 1 && tdiff[0] === tabEid, JSON.stringify(tdiff));

  // (T-e) ★최우선: <td> 셀이 D29 재귀 리프로 인식돼 클릭 한 번에 인라인 편집(새 텍스트편집 경로 없이)
  const cellCnt = await tgtCount(tabEid);
  const cell0 = await leafText(tabEid, 0);
  check("(T-e1) <td> 9개가 그대로 addressable line(objLineTargets=9, 셀 텍스트='셀')", cellCnt === 9 && cell0 === "셀", `count=${cellCnt} cell0=${JSON.stringify(cell0)}`);
  // element-edit OFF + 첫 셀 클릭 → 그 셀만 인라인 편집기에(line 0)
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await page.evaluate(() => window.__archTest.setElementEditOn(false));
  await settle(120);
  await frame().locator(`[data-arch-eid="${tabEid}"]`).getByText("셀", { exact: true }).first().click();
  await settle(200);
  const tCe = await ceText(), tSt = await inlineState();
  check("(T-e2) ★셀 클릭 → 인라인 편집 진입(내용='셀', kind=obj, line=0) — D29 재사용",
    (await ceCount()) === 1 && tCe === "셀" && tSt && tSt.kind === "obj" && tSt.line === 0 && tSt.eid === tabEid,
    `ce=${JSON.stringify(tCe)} state=${JSON.stringify(tSt)}`);
  const beforeCellEdit = await src();
  await page.keyboard.type("머리글");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(200);
  const Scell = await src();
  const cell0after = await leafText(tabEid, 0);
  const cellDiff = await diffChanged(beforeCellEdit, Scell);
  check("(T-e3) 셀 편집 커밋: 첫 셀만 '머리글'로 + bleed 청결(그 표만 변경)",
    cell0after === "머리글" && cellDiff.length === 1 && cellDiff[0] === tabEid, `cell0=${JSON.stringify(cell0after)} diff=${JSON.stringify(cellDiff)}`);
  await page.screenshot({ path: path.join(ART, "s22_table_cell_edited.png") });

  // (T-d) undo — 셀 편집 되돌림, 그다음 표 삽입까지 되돌리면 A0 바이트 동일
  await page.evaluate(() => window.__archTest.undo());
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(150);
  check("(T-d1) undo가 셀 편집 복원", (await src()) === beforeCellEdit);
  await page.evaluate(() => window.__archTest.undo());
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(150);
  check("(T-d2) undo가 표 삽입까지 복원 → A0 바이트 동일", (await src()) === A0);

  // ══════════════════════ D35 이미지 ══════════════════════
  A0 = await reset();
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await settle(120);
  // (I-a) 🖼 이미지 버튼 클릭 → 파일선택 다이얼로그 → 파일 세팅 → 그리기 모드 진입(실측 종횡비 스케일)
  page.once("filechooser", async (fc) => { await fc.setFiles({ name: "swatch.png", mimeType: "image/png", buffer: PNG }); });
  await page.evaluate(() => document.getElementById("fmt-image").click());
  await page.waitForFunction(() => window.__archTest.getMode() === "draw", null, { timeout: 8000 });
  const iActive = await page.evaluate(() => { const b = document.querySelector('#draw-palette [data-draw="image"]'); return b ? b.classList.contains("active") : null; });
  check("(I-a) 🖼 버튼 → 파일선택 → 그리기 모드 + 이미지 팔레트 active", (await getMode()) === "draw" && iActive === true, `mode=${await getMode()} active=${iActive}`);

  // (I-b) 캔버스 클릭 → 새 obj(image) + <img src=data:image> + 실측 종횡비(800×400 → 320×160)
  const beforeNI = await eidCount(A0);
  await drawAtEmpty();
  await page.waitForFunction((n) => window.__archTest.getSource() && new DOMParser().parseFromString(window.__archTest.getSource(), "text/html").querySelectorAll("[data-arch-eid]").length === n + 1, beforeNI, { timeout: 6000 });
  const Simg = await src();
  const imgEid = await newEidOf(Simg);
  const iinfo = await objInfo(Simg, imgEid);
  check("(I-b) 이미지 삽입: 새 obj(type=image) + <img src=data:image> object-fit:fill (D39)",
    imgEid && iinfo && iinfo.type === "image" && /^data:image/.test(iinfo.imgSrc || "") && iinfo.imgFit === true,
    `eid=${imgEid} ${JSON.stringify(iinfo)}`);
  check("(I-b2) 종횡비 유지 스케일: 800×400 → 배치 320×160(최대 변 320px)",
    num(iinfo.width) === 320 && num(iinfo.height) === 160, `w=${iinfo.width} h=${iinfo.height}`);

  // (I-c) bleed-diff 청결
  const idiff = await diffChanged(A0, Simg);
  check("(I-c) bleed-diff: 추가된 이미지 eid 하나만 변경", idiff.length === 1 && idiff[0] === imgEid, JSON.stringify(idiff));
  await page.screenshot({ path: path.join(ART, "s22_image_placed.png") });

  // (I-e) 공통 리사이즈 핸들이 이미지 obj에도 그대로 먹는지 — 실 클릭으로 선택(핸들 크롬 표시) 후 SE 코너 드래그
  await page.evaluate(() => window.__archTest.setMode("edit"));   // element-edit ON(기본) → obj 블록 선택
  await settle(120);
  await frame().locator(`[data-arch-eid="${imgEid}"]`).click();
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, imgEid, { timeout: 5000 });
  await settle(180);
  const handleDisp = await frame().locator('[data-arch-overlay="handle"]').first().evaluate((el) => getComputedStyle(el).display).catch(() => "none");
  const seBox = await frame().locator('[data-arch-overlay="handle"]').nth(3).boundingBox();
  const beforeResize = await src();
  const iBefore = await objInfo(beforeResize, imgEid);
  await page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(seBox.x + seBox.width / 2 + 120, seBox.y + seBox.height / 2 + 80, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction((d) => window.__archTest.undoDepth() === d, (await depth()), { timeout: 6000 }).catch(() => {});
  await settle(250);
  const Sresize = await src();
  const iAfter = await objInfo(Sresize, imgEid);
  const resizeDiff = await diffChanged(beforeResize, Sresize);
  check("(I-e) 공통 리사이즈 핸들 표시 + 이미지 obj 리사이즈됨(W/H 증가) + bleed 청결",
    handleDisp === "block" && iAfter && num(iAfter.width) > num(iBefore.width) + 30 && num(iAfter.height) > num(iBefore.height) + 20 && resizeDiff.length === 1 && resizeDiff[0] === imgEid,
    `handle=${handleDisp} w ${iBefore.width}→${iAfter.width} h ${iBefore.height}→${iAfter.height} diff=${JSON.stringify(resizeDiff)}`);

  // (I-e2) D39 렌더 검증: object-fit:fill이라 <img>가 박스를 레터박스 없이 꽉 채운다(종횡비 무시하고 늘어남).
  //   박스(~440×240, ~1.83:1) vs 이미지(800×400=2:1)라 contain이면 세로에 여백이 생겨 dh가 벌어짐 — fill은 dh≈0.
  const fitInfo = await frame().locator(`[data-arch-eid="${imgEid}"]`).evaluate((box) => {
    const img = box.querySelector("img");
    const br = box.getBoundingClientRect(), ir = img.getBoundingClientRect();
    return { fit: getComputedStyle(img).objectFit, dw: Math.abs(br.width - ir.width), dh: Math.abs(br.height - ir.height),
             bw: br.width, bh: br.height, iw: ir.width, ih: ir.height };
  });
  await page.screenshot({ path: path.join(ART, "s22_image_fill.png") });
  check("(I-e2) D39 object-fit:fill — <img>가 박스를 레터박스 없이 꽉 채움(img rect == box rect)",
    fitInfo.fit === "fill" && fitInfo.dw < 1.5 && fitInfo.dh < 1.5,
    `fit=${fitInfo.fit} box ${fitInfo.bw.toFixed(1)}×${fitInfo.bh.toFixed(1)} img ${fitInfo.iw.toFixed(1)}×${fitInfo.ih.toFixed(1)}`);

  // (I-d) undo — 리사이즈 복원, 그다음 이미지 삽입까지 복원하면 A0 바이트 동일
  await page.evaluate(() => window.__archTest.undo());
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(150);
  check("(I-d1) undo가 리사이즈 복원", (await src()) === beforeResize);
  await page.evaluate(() => window.__archTest.undo());
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(150);
  check("(I-d2) undo가 이미지 삽입까지 복원 → A0 바이트 동일", (await src()) === A0);

  check("(Z) 전체 시퀀스 동안 콘솔/페이지 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 4).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 6).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s22_failure.png") }); } catch {}
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n=== s22 (D35 이미지 + D36 표) : ${pass} pass / ${fail} fail ===`);
process.exit(fail ? 1 : 0);
