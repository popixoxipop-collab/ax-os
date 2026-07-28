// archify 요소 편집기 MVP — Playwright 그라운딩 테스트 (mock 경로, 키 불필요)
// (a) 로드→iframe 슬라이드 렌더  (b) 요소 클릭→플로팅 입력  (c) mock 편집→bleed-diff
// (d) undo 바이트 동일 복원  (e) 다운로드 청결(스크립트/오버레이 없음, eid 유지)
//
// bleed-diff 검증은 앱의 DomAdapter.bleedDiff를 재사용하지 않고 테스트가 자체 구현으로
// 독립 비교한다(순환 검증 방지).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8613;
const BASE = `http://127.0.0.1:${PORT}`;
const ART = path.join(APP_DIR, "test", "artifacts");
fs.mkdirSync(ART, { recursive: true });

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "  — " + extra : "")); }
}

// ---- serve the app dir ----
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: APP_DIR, stdio: "ignore",
});
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

try {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });

  const frame = page.frameLocator("#diagram-frame");

  // ---------- (a) 로드: iframe에 슬라이드 ----------
  const titleVisible = await frame.locator("text=P01 교안/커리큘럼 분석 서비스 플로우").first().isVisible();
  check("(a) iframe에 슬라이드 렌더(제목 노출)", titleVisible);

  const A0 = await page.evaluate(() => window.__archTest.getSource());
  check("(a2) 소스 Document에 data-arch-eid 부여", A0.includes('data-arch-eid="obj:'));
  const scale = await page.evaluate(() => window.__archTest.getScale());
  console.log("      [info] stage scale =", scale);

  // ---------- (b) '결과 확인' 박스 클릭 → 플로팅 입력 ----------
  const target = frame.locator("div[data-arch-eid]").filter({ hasText: "질문 / 그래프" }).first();
  await target.click();
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 });
  const selEid = await page.evaluate(() => window.__archTest.getSelected() && window.__archTest.getSelected().eid);
  const ph = await page.getAttribute("#fi-text", "placeholder");
  check("(b) 클릭 → 플로팅 입력 표시 + 요소 식별", Boolean(selEid) && /무엇을 변경해야 하나요\?$/.test(ph || ""), `eid=${selEid} ph=${ph}`);
  check("(b2) kind가 텍스트 상자로 인식", (ph || "").includes("텍스트 상자"), `ph=${ph}`);
  await page.screenshot({ path: path.join(ART, "mvp_selected_input.png") });

  // ---------- (c) mock 편집: setText + bleed-diff ----------
  check("(c0) 키 없음 → mock 자동 활성", await page.evaluate(() => window.__archTest.isMock()));
  await page.fill("#fi-text", "제목을 '최종 리포트'로 바꿔줘");
  await page.click("#fi-run");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 10000 });
  const B = await page.evaluate(() => window.__archTest.getSource());
  check("(c1) 선택 요소 텍스트 변경(setText)", B.includes("최종 리포트"));

  // 독립 bleed-diff: 선택 eid 외 모든 [data-arch-eid] outerHTML 바이트 동일 검증
  const diffOthers = (a, b) => page.evaluate(([ha, hb]) => {
    const P = (h) => new DOMParser().parseFromString(h, "text/html");
    const M = (d) => {
      const m = {};
      d.querySelectorAll("[data-arch-eid]").forEach((el) => { m[el.getAttribute("data-arch-eid")] = el.outerHTML; });
      return m;
    };
    const ma = M(P(ha)), mb = M(P(hb));
    const keys = new Set([...Object.keys(ma), ...Object.keys(mb)]);
    return [...keys].filter((k) => ma[k] !== mb[k]).sort();
  }, [a, b]);

  const d1 = await diffOthers(A0, B);
  check("(c2) bleed-diff: 변경된 요소가 선택 요소 하나뿐", d1.length === 1 && d1[0] === selEid, JSON.stringify(d1));
  const totalEids = await page.evaluate((h) => new DOMParser().parseFromString(h, "text/html").querySelectorAll("[data-arch-eid]").length, B);
  console.log(`      [info] 전체 ${totalEids}개 요소 중 변경 ${d1.length}개 (${d1.join(",")})`);
  check("(c3) iframe 재렌더에 반영", await frame.locator("text=최종 리포트").first().isVisible());

  // ---------- (d) undo ----------
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 5000 });
  const C = await page.evaluate(() => window.__archTest.getSource());
  check("(d) undo가 소스를 바이트 동일 복원", C === A0);
  check("(d2) iframe도 원문으로 복원", await frame.locator("text=결과 확인").first().isVisible());

  // ---------- (e) 2차 편집(setStyle) + 다운로드 청결 ----------
  await frame.locator("div[data-arch-eid]").filter({ hasText: "질문 / 그래프" }).first().click();
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 });
  await page.fill("#fi-text", "배경을 #FFF3D6 색으로 바꿔줘");
  await page.click("#fi-run");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 10000 });
  const D = await page.evaluate(() => window.__archTest.getSource());
  const d2 = await diffOthers(A0, D);
  // CSSOM은 hex를 rgb()로 정규화해 직렬화한다(#FFF3D6 → rgb(255, 243, 214)) — 둘 다 허용
  const bgApplied = (s) => s.includes("#FFF3D6") || /background:\s*rgb\(255,\s*243,\s*214\)/.test(s);
  check("(e0) setStyle 적용 + 격리 유지", bgApplied(D) && d2.length === 1 && d2[0] === selEid, JSON.stringify(d2));

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 10000 }),
    page.click("#btn-download"),
  ]);
  const dlPath = await download.path();
  const dl = fs.readFileSync(dlPath, "utf8");
  check("(e1) 다운로드에 <script 전무(에디터 에이전트 미포함)", !dl.includes("<script"));
  check("(e2) 다운로드에 오버레이 전무", !dl.includes("data-arch-overlay"));
  check("(e3) 다운로드에 eid 유지(Q6) + 편집 반영", dl.includes('data-arch-eid="obj:') && bgApplied(dl));
  check("(e4) standalone doctype HTML", dl.trimStart().toLowerCase().startsWith("<!doctype html"));
  fs.copyFileSync(dlPath, path.join(ART, "downloaded.edited.html"));

  await page.screenshot({ path: path.join(ART, "mvp_final.png") });

  check("(z) 페이지 콘솔 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 4).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "mvp_failure.png") }); } catch {}
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
