// archify 요소 편집기 — stage 4: 두 어댑터(class a archify-JSON + class b DOM)를 한 에디터로 통합.
//  · provenance 자동 판별(임베디드 소스 유무 → archify vs dom)
//  · 모드 게이팅(class a는 선택만, class b는 6모드 전부)
//  · class a select 편집 (mock): resolveHit→apply→serve /render→verify→bleed→undo
//  · serve 없음: 배너 표시 + 편집 게이트 + 무크래시
//
// bleed-diff는 앱 코드를 재사용하지 않고 테스트가 독립 구현으로 <g data-arch-id> 클러스터를 비교.
// class a 라이브 경로(serve /render|/validate|/check)는 실제 spawn — 목킹 없음. LLM만 mock.
import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { startServer } from "../server.mjs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_ROOT = path.resolve(APP_DIR, "..");
const ART = path.join(APP_DIR, "test", "artifacts");
fs.mkdirSync(ART, { recursive: true });

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "  — " + extra : "")); }
}

// ---- render a class-a diagram once (same code path as `archify render`) ----
const WF_PATH = path.join(os.tmpdir(), "s4-wf.html");
const r = spawnSync(process.execPath,
  [path.join(SKILL_ROOT, "bin/archify.mjs"), "render", "workflow",
   path.join(SKILL_ROOT, "examples/agent-tool-call.workflow.json"), WF_PATH],
  { encoding: "utf8" });
if (r.status !== 0) { console.error("render failed:", r.stderr || r.stdout); process.exit(1); }
const WF_HTML = fs.readFileSync(WF_PATH, "utf8");

// ---- independent <g data-arch-id> cluster diff (does NOT reuse the adapter) ----
async function clusterOffenders(page, before, after, selId, whitelist = ["legend"]) {
  return page.evaluate(([b, a, sid, wl]) => {
    const clusters = (html) => {
      const re = /<g data-arch-id="([^"]*)" data-arch-kind="([^"]*)" data-arch-part="([^"]*)">[\s\S]*?<\/g>/g;
      const map = new Map();
      let m;
      while ((m = re.exec(html)) !== null) map.set(m[1] + " " + m[2] + " " + m[3], m[0]);
      return map;
    };
    const mb = clusters(b), ma = clusters(a);
    const keys = new Set([...mb.keys(), ...ma.keys()]);
    const out = [];
    for (const k of keys) {
      const id = k.split(" ")[0];
      if (id === sid || wl.includes(id)) continue;
      if (mb.get(k) !== ma.get(k)) out.push(k);
    }
    return out;
  }, [before, after, selId, whitelist]);
}

// ---- start archify serve (class-a render backend) ----
const started = await startServer({ port: 0, dir: APP_DIR });
const SERVE_URL = started.url;

// ---- start a plain python http.server (no /render) for the serve-down case ----
const PY_PORT = 8619;
const py = spawn("python3", ["-m", "http.server", String(PY_PORT), "--bind", "127.0.0.1"], { cwd: APP_DIR, stdio: "ignore" });
const PY_URL = `http://127.0.0.1:${PY_PORT}`;
for (let i = 0; i < 60; i++) { try { const x = await fetch(PY_URL + "/index.html"); if (x.ok) break; } catch {} await new Promise((r) => setTimeout(r, 150)); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 2120, height: 1420 }, acceptDownloads: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));
const frame = () => page.frameLocator("#diagram-frame");

async function waitReady() {
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
}

try {
  // =========================================================================
  // PART 1 — served BY archify serve (class-a render reachable)
  // =========================================================================
  await page.goto(SERVE_URL + "/index.html");
  await waitReady();

  // (1) 기본 데모 p01 = class b → provenance dom, 6모드 전부 활성
  check("(1) 기본 로드 p01 → provenance=dom", (await page.evaluate(() => window.__archTest.getProvenance())) === "dom");
  const domGate = await page.evaluate(() => ["select", "draw", "edit", "audit", "layout", "polish"].map((m) => window.__archTest.isModeDisabled(m)));
  check("(1b) class b: 6모드 전부 활성(disabled 모두 false)", domGate.every((d) => d === false), JSON.stringify(domGate));

  // (2) class-a 다이어그램 로드 → provenance 자동 archify, serve 도달 → serveAvailable
  await page.evaluate(async (h) => { await window.__archTest.load(h, "wf.html"); }, WF_HTML);
  await waitReady();
  check("(2) 임베디드 소스 있는 HTML → provenance=archify", (await page.evaluate(() => window.__archTest.getProvenance())) === "archify");
  check("(2b) archify serve로 서빙 → serveAvailable=true", (await page.evaluate(() => window.__archTest.getServeAvailable())) === true);
  check("(2c) serve 도달 → 배너 숨김", (await page.evaluate(() => window.__archTest.bannerShown())) === false);
  check("(2d) iframe에 archify 노드 렌더(stamp 존재)", (await frame().locator('[data-arch-id="planner"]').count()) >= 1);

  // (3) 모드 게이팅(stage 5): serve 도달 시 class a도 6모드 전부 활성(un-gated).
  // 잠금은 serve 미도달 시에만 발생한다(PART 2에서 검증).
  const aGate = await page.evaluate(() => ({
    select: window.__archTest.isModeDisabled("select"),
    others: ["draw", "edit", "audit", "layout", "polish"].map((m) => window.__archTest.isModeDisabled(m)),
  }));
  check("(3) class a: 선택 모드 활성", aGate.select === false);
  check("(3b) stage 5 — serve 도달 시 class a 5모드 un-gate(활성)", aGate.others.every((d) => d === false), JSON.stringify(aGate.others));
  const tip = await page.getAttribute('.mode[data-mode="draw"]', "title");
  check("(3c) serve 도달 시 잠금 툴팁 없음(un-gated)", !tip || !/serve 연결 후/.test(tip), tip);

  // (4) class-a select 편집 (mock): 노드 클릭 → 플로팅 입력 → set_fields → serve 재렌더 → verify
  const H0 = await page.evaluate(() => window.__archTest.getArchHtml());
  await frame().locator('[data-arch-id="planner"]').first().click();
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 6000 });
  const selA = await page.evaluate(() => window.__archTest.getSelected());
  check("(4) 노드 클릭 → 플로팅 입력 + id/kind 식별", selA && selA.id === "planner" && selA.kind === "node", JSON.stringify(selA));
  const phA = await page.getAttribute("#fi-text", "placeholder");
  check("(4b) kind 라벨이 '노드'로 표시", /노드/.test(phA || ""), phA);
  await page.screenshot({ path: path.join(ART, "s4_archify_selected.png") });

  check("(4c) 키 없음 → mock 자동 활성", await page.evaluate(() => window.__archTest.isMock()));

  // (4c') select mock이 방출하는 op을 직접 검사 — 경량 set_fields(바뀐 필드만)여야 하고,
  // 전체 오브젝트를 재생성하는 replace_node/replace_edge/update_meta여서는 안 된다.
  const mockOp = await page.evaluate(() => window.__archTest.archMockOps("라벨을 'Zed'로 바꿔줘", { id: "planner", kind: "node" }).ops[0]);
  check("(4c') select mock → set_fields(바뀐 필드만, 전체 오브젝트 아님)",
    mockOp.op === "set_fields" && mockOp.id === "planner" && mockOp.fields && mockOp.fields.label === "Zed"
    && mockOp.node === undefined && mockOp.edge === undefined && mockOp.meta === undefined,
    JSON.stringify(mockOp));

  await page.fill("#fi-text", "제목을 'Gated Planner'로 바꿔줘");
  await page.click("#fi-run");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 30000 });

  const model1 = await page.evaluate(() => window.__archTest.getArchModel());
  const planner1 = model1.source.nodes.find((n) => n.id === "planner");
  check("(4d) 소스 JSON planner.label 교체됨", planner1.label === "Gated Planner", planner1.label);

  const H1 = await page.evaluate(() => window.__archTest.getArchHtml());
  const off1 = await clusterOffenders(page, H0, H1, "planner");
  check("(4e) 독립 bleed-diff: planner 클러스터 외 변경 없음", off1.length === 0, JSON.stringify(off1));
  check("(4f) iframe 재렌더에 반영(Gated Planner 노출)", await frame().locator("text=Gated Planner").first().isVisible());
  await page.screenshot({ path: path.join(ART, "s4_archify_edited.png") });

  // (4g) class-a 다운로드 청결성: 뷰 전용 에디터 에이전트/오버레이 없음 + 임베디드 소스 유지
  const [dlA] = await Promise.all([
    page.waitForEvent("download", { timeout: 10000 }),
    page.click("#btn-download"),
  ]);
  const dlText = fs.readFileSync(await dlA.path(), "utf8");
  check("(4g) class a 다운로드 청결(에디터 에이전트/오버레이 미포함)", !dlText.includes("data-arch-editor-agent") && !dlText.includes("data-arch-overlay"), "");
  check("(4h) class a 다운로드에 임베디드 소스 유지 + 편집 반영", /id="archify-source"/.test(dlText) && dlText.includes("Gated Planner"));

  // (5) undo → 소스 모델 복원 + 뷰 원복
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 8000 });
  const model0 = await page.evaluate(() => window.__archTest.getArchModel());
  check("(5) undo가 소스 모델 복원(Agent Planner)", model0.source.nodes.find((n) => n.id === "planner").label === "Agent Planner");
  check("(5b) undo 후 뷰도 원복", await frame().locator("text=Agent Planner").first().isVisible());

  // (6) class a → 다시 class b(p01) 로드 → provenance/게이팅 원복(회귀)
  const p01 = await (await fetch(SERVE_URL + "/p01_report_snapshot.html")).text();
  await page.evaluate(async (h) => { await window.__archTest.load(h, "p01.html"); }, p01);
  await waitReady();
  check("(6) class b 재로드 → provenance=dom 복귀", (await page.evaluate(() => window.__archTest.getProvenance())) === "dom");
  const backGate = await page.evaluate(() => ["draw", "edit", "audit", "layout", "polish"].map((m) => window.__archTest.isModeDisabled(m)));
  check("(6b) class b 재로드 → 5모드 재활성", backGate.every((d) => d === false), JSON.stringify(backGate));

  check("(z1) PART1 콘솔 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

  // =========================================================================
  // PART 2 — served BY python http.server (no /render): serve-down UX
  // =========================================================================
  const errBefore = pageErrors.length;
  await page.goto(PY_URL + "/index.html");
  await waitReady();
  await page.evaluate(async (h) => { await window.__archTest.load(h, "wf.html"); }, WF_HTML);
  await waitReady();
  check("(7) http.server 서빙 → serveAvailable=false", (await page.evaluate(() => window.__archTest.getServeAvailable())) === false);
  check("(7b) serve 없음 → 배너 표시", (await page.evaluate(() => window.__archTest.bannerShown())) === true);
  check("(7c) 배너 문구에 archify serve 안내", /archify serve/.test(await page.textContent("#serve-banner")));
  check("(7d) 다이어그램은 여전히 관람 가능(stamp 렌더)", (await frame().locator('[data-arch-id="planner"]').count()) >= 1);
  await page.screenshot({ path: path.join(ART, "s4_no_serve_banner.png") });

  // 노드 클릭 → 편집 게이트(팝오버 대신 토스트), 크래시 없음
  await frame().locator('[data-arch-id="planner"]').first().click();
  await page.waitForTimeout(600);
  const popHiddenNoServe = await page.getAttribute("#floating-input", "hidden");
  check("(7e) serve 없음 → 클릭해도 편집 팝오버 미표시(게이트)", popHiddenNoServe !== null);
  check("(7f) serve 없음에서 무크래시(콘솔 에러 없음)", pageErrors.length === errBefore, pageErrors.slice(errBefore, errBefore + 3).join(" | "));

} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 6).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s4_failure.png") }); } catch {}
} finally {
  await browser.close();
  started.server.close();
  py.kill();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
