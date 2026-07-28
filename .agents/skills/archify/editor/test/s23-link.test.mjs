// archify 요소 편집기 — s23: D37(링크) 인라인 텍스트 서식.
//
// ★ 링크는 "새 요소 삽입"이 아니라 "편집 중인 줄에 적용하는 인라인 서식"이다 — 굵게/기울임과 완전히
//   같은 경로(인라인 세션 게이트 → pendInline/inlinePendingOps → 커밋 헬퍼 → bleed-diff replace).
//
// 검증 축(요청 사양 그대로, mock 경로·키 불필요):
//  · (a) 인라인 세션 없을 때 버튼 비활성 · (a2) 실 클릭으로 세션 열면 활성
//  · (b) 정상 URL 적용 → <a href> 생성 + bleed-diff 청결(그 요소만) · (d) undo 바이트 동일
//  · (c) 위험 스킴(javascript: 등) 거부 → DOM 불변(<a> 미생성, 바이트 동일)
//  · (e) 실 버튼+prompt 경로(dialog 수락)도 같은 결과
//
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
const P01 = fs.readFileSync(path.join(APP_DIR, "p01_report_snapshot.html"), "utf8");
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
const depth = () => page.evaluate(() => window.__archTest.undoDepth());
const inlineState = () => page.evaluate(() => window.__archTest.inlineState());
const ceText = async () => (await frame().locator('[contenteditable="true"]').first().textContent().catch(() => null));
const linkDisabled = () => page.evaluate(() => window.__archTest.fmtCtrlDisabled("fmt-link"));
const boxHTML = (eid) => page.evaluate((e) => {
  const d = new DOMParser().parseFromString(window.__archTest.getSource(), "text/html");
  const el = d.querySelector(`[data-arch-eid="${e}"]`);
  return el ? el.innerHTML.replace(/\s+/g, " ").trim() : null;
}, eid);
const loadFixture = async (html, name) => {
  await page.evaluate(async ([h, n]) => { await window.__archTest.load(h, n); }, [html, name]);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
};
const setOffEdit = async () => { await page.evaluate(() => window.__archTest.setMode("edit")); await page.evaluate(() => window.__archTest.setElementEditOn(false)); await settle(120); };
const simStart = (eid, line, text) => page.evaluate(([e, l, t]) => window.__archTest.simInlineStart(e, "obj", l, t), [eid, line, text]);
const fmtLink = (url) => page.evaluate((u) => window.__archTest.fmtLink(u), url);
const simCommit = (text, changed) => page.evaluate(([t, c]) => window.__archTest.simInlineCommit(t, c), [text, changed]);
async function clickLeaf(eid, text) { await frame().locator(`[data-arch-eid="${eid}"]`).getByText(text, { exact: true }).first().click(); }
const diffOthers = (a, b) => page.evaluate(([ha, hb]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  const M = (d) => { const m = {}; d.querySelectorAll("[data-arch-eid]").forEach((el) => { m[el.getAttribute("data-arch-eid")] = el.outerHTML; }); return m; };
  const ma = M(P(ha)), mb = M(P(hb));
  const keys = new Set([...Object.keys(ma), ...Object.keys(mb)]);
  return [...keys].filter((k) => ma[k] !== mb[k]).sort();
}, [a, b]);

const BOX = "obj:22";          // P01 FRONTEND 타이틀블록(3-리프: FRONTEND / PDF 업로드 / key/proxy 설정)
const LEAF0 = "FRONTEND";
const GOOD = "https://example.com/frontend";

try {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await loadFixture(P01, "p01.html");
  await setOffEdit();

  // ── (L-a) 인라인 세션 없음 → 링크 버튼 비활성 ──
  await page.keyboard.press("Escape"); await settle(100);
  check("(L-a) 인라인 세션 없음 → 🔗 링크 버튼 비활성(D26 게이팅)", (await linkDisabled()) === true, `disabled=${await linkDisabled()}`);

  // ── (L-a2) 실 클릭으로 리프 인라인 세션 열림 → 링크 버튼 활성 ──
  await clickLeaf(BOX, LEAF0); await settle(180);
  const stA2 = await inlineState();
  check("(L-a2) 리프 클릭 → obj 인라인 세션 + 🔗 링크 버튼 활성",
    (await ceText()) === LEAF0 && stA2 && stA2.kind === "obj" && stA2.line === 0 && (await linkDisabled()) === false,
    `ce=${await ceText()} state=${JSON.stringify(stA2)} disabled=${await linkDisabled()}`);
  await page.keyboard.press("Escape"); await settle(120);

  // ── (L-c) 위험 스킴 거부 → 커밋해도 DOM 불변(<a> 미생성, 바이트 동일) ──
  const baseC = await src();
  await simStart(BOX, 0, LEAF0);
  await fmtLink("javascript:alert(1)");
  const stC = await inlineState();
  check("(L-c1) javascript: 스킴 거부 → pendingHref 미스테이징", stC && stC.pendingHref === null, JSON.stringify(stC));
  await simCommit(LEAF0, false);
  await settle(150);
  const afterC = await src();
  check("(L-c2) 위험 스킴 커밋 시도 → 소스 바이트 동일(무커밋)", afterC === baseC, `equal=${afterC === baseC}`);
  check("(L-c3) obj:22에 <a> 미생성", !/<a[\s>]/.test(await boxHTML(BOX)), (await boxHTML(BOX)).slice(0, 80));

  // ── (L-b) 정상 URL → <a href> 생성 + bleed-diff 청결(그 요소만) ──
  const baseB = await src();
  await simStart(BOX, 0, LEAF0);
  await fmtLink(GOOD);
  const stB = await inlineState();
  check("(L-b1) 정상 URL → pendingHref 스테이징", stB && stB.pendingHref === GOOD, JSON.stringify(stB));
  await simCommit(LEAF0, false);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(200);
  const afterB = await src();
  const htmlB = await boxHTML(BOX);
  check("(L-b2) 첫 줄이 <a href=GOOD>FRONTEND</a>로 감싸짐",
    new RegExp('<a href="' + GOOD.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + '"[^>]*>FRONTEND</a>').test(htmlB), htmlB.slice(0, 140));
  const diffB = await diffOthers(baseB, afterB);
  check("(L-b3) bleed-diff: obj:22 하나만 변경(그 밖 바이트 동일)", diffB.length === 1 && diffB[0] === BOX, JSON.stringify(diffB));
  await page.screenshot({ path: path.join(ART, "s23_link_applied.png") });

  // ── (L-d) undo → 바이트 동일 복원 ──
  await page.evaluate(() => window.__archTest.undo());
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(150);
  check("(L-d) undo가 소스를 바이트 동일 복원(<a> 제거)", (await src()) === baseB, `equal=${(await src()) === baseB}`);

  // ── (L-e) 실 버튼 + prompt 경로(dialog 수락)도 같은 결과 ──
  const REAL = "https://real.example/x";
  await simStart(BOX, 0, LEAF0);
  page.once("dialog", async (d) => { await d.accept(REAL); });
  await page.evaluate(() => document.getElementById("fmt-link").click());
  await page.waitForFunction((u) => { const s = window.__archTest.inlineState(); return s && s.pendingHref === u; }, REAL, { timeout: 5000 });
  await simCommit(LEAF0, false);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(150);
  check("(L-e) 🔗 버튼→prompt(수락)→커밋 → <a href=REAL> 생성",
    new RegExp('<a href="' + REAL.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + '"[^>]*>FRONTEND</a>').test(await boxHTML(BOX)), (await boxHTML(BOX)).slice(0, 140));
  await page.evaluate(() => window.__archTest.undo());   // 정리
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await settle(120);

  // ── (L-f) SVG 텍스트 인라인 세션에서는 링크 비활성 + 사유(obj 전용 능력) ──
  await loadFixture(SVG_HTML, "svg.html");
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await settle(120);
  await page.evaluate(() => window.__archTest.simInlineStart("svgtext:0", "svgtext", null, ""));
  await settle(120);
  const stF = await inlineState();
  check("(L-f) svgtext 인라인 세션 → 🔗 링크 비활성(HTML 텍스트 전용)",
    stF && stF.kind === "svgtext" && (await linkDisabled()) === true, `state=${JSON.stringify(stF)} disabled=${await linkDisabled()}`);

  check("(Z) 전체 시퀀스 동안 콘솔/페이지 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 4).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 6).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s23_failure.png") }); } catch {}
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n=== s23 (D37 링크) : ${pass} pass / ${fail} fail ===`);
process.exit(fail ? 1 : 0);
