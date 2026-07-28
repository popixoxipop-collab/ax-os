// archify 요소 편집기 — stage 5: class-a(archify-JSON) 5모드 전 기능 패리티.
//  편집(수동 property form/set_fields) · 그리기(add_node/add_edge) · 콘텐츠 검증(①LLM+AI고치기 / ④native /validate)
//  · 레이아웃 수정(geometry field-lock) · 콘텐츠 다듬기(text field-lock)
// 모두 실제 archify serve(/render·/validate·/check)에 대해 구동 — 렌더/검증은 목킹 없음. LLM만 mock.
// bleed-diff는 앱 코드를 재사용하지 않고 테스트가 독립 구현으로 <g data-arch-id> 클러스터를 비교(순환 검증 방지).
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
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

// ---- render a class-a workflow once (same code path as `archify render`) ----
const WF_PATH = path.join(os.tmpdir(), "s5-wf.html");
const r = spawnSync(process.execPath,
  [path.join(SKILL_ROOT, "bin/archify.mjs"), "render", "workflow",
   path.join(SKILL_ROOT, "examples/agent-tool-call.workflow.json"), WF_PATH],
  { encoding: "utf8" });
if (r.status !== 0) { console.error("render failed:", r.stderr || r.stdout); process.exit(1); }
const WF_HTML = fs.readFileSync(WF_PATH, "utf8");
const WF_SOURCE = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, "examples/agent-tool-call.workflow.json"), "utf8"));

// ---- independent <g data-arch-id> cluster diff (does NOT reuse the adapter) ----
async function clusterOffenders(page, before, after, allowedIds, whitelist = ["legend"]) {
  return page.evaluate(([b, a, allow, wl]) => {
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
      if (allow.includes(id) || wl.includes(id)) continue;
      if (mb.get(k) !== ma.get(k)) out.push(k);
    }
    return out;
  }, [before, after, allowedIds, whitelist]);
}
async function newClusters(page, before, after) {
  return page.evaluate(([b, a]) => {
    const clusters = (html) => {
      const re = /<g data-arch-id="([^"]*)" data-arch-kind="([^"]*)" data-arch-part="([^"]*)">/g;
      const s = new Set(); let m;
      while ((m = re.exec(html)) !== null) s.add(m[1] + " " + m[2]);
      return s;
    };
    const sb = clusters(b), sa = clusters(a);
    return [...sa].filter((k) => !sb.has(k));
  }, [before, after]);
}

const started = await startServer({ port: 0, dir: APP_DIR });
const SERVE_URL = started.url;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 2200, height: 1480 }, acceptDownloads: true });
const page = await ctx.newPage();
const pageErrors = [];
let expected400s = 0;
// 부정 경로 테스트(2e 잘못된 add_node 배치 · 5e 잘못된 레이아웃 이동)는 serve /render가
// 의도적으로 400을 반환하고 앱이 이를 정상 처리한다(ok:false/자동 되돌림). Chromium은 400
// 응답을 무조건 콘솔에 남기므로, 이 예상된 400만 걸러내고 그 외 콘솔 에러·JS 예외는 전부 잡는다.
page.on("console", (m) => {
  const t = m.text();
  if (m.type() !== "error") return;
  if (/status of 400/.test(t)) { expected400s++; return; }
  pageErrors.push(t);
});
page.on("pageerror", (e) => pageErrors.push(String(e)));
const frame = () => page.frameLocator("#diagram-frame");
async function waitReady() {
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
}
async function reload() {
  await page.evaluate(async (h) => { await window.__archTest.load(h, "wf.html"); }, WF_HTML);
  await waitReady();
  await page.waitForFunction(() => window.__archTest.getServeAvailable() === true, null, { timeout: 15000 });
}

try {
  await page.goto(SERVE_URL + "/index.html");
  await waitReady();
  await reload();
  check("(0) class-a 로드 + serve 도달", (await page.evaluate(() => window.__archTest.getProvenance())) === "archify" && (await page.evaluate(() => window.__archTest.getServeAvailable())) === true);
  const gate = await page.evaluate(() => ["draw", "edit", "audit", "layout", "polish"].map((m) => window.__archTest.isModeDisabled(m)));
  check("(0b) serve 도달 → 5모드 전부 un-gate(활성)", gate.every((d) => d === false), JSON.stringify(gate));

  // ========================================================================
  // 1. 편집 (수동 property form) — 노드 label 필드 변경 → 그 노드 클러스터만 변경
  // ========================================================================
  const H0 = await page.evaluate(() => window.__archTest.getArchHtml());
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await frame().locator('[data-arch-id="planner"]').first().click();
  await page.waitForSelector("#arch-edit-form:not([hidden])", { timeout: 6000 });
  const formEid = await page.textContent("#af-eid");
  check("(1) 편집 모드 노드 클릭 → property form 표시", /planner/.test(formEid || "") && /노드/.test(formEid || ""), formEid);
  const hasLabelField = await page.locator("#af-label").count();
  const hasTypeSelect = await page.locator("#af-type").count();
  const hasLaneSelect = await page.locator("#af-lane").count();
  check("(1b) 폼에 스키마 필드(label/type enum/lane) 존재", hasLabelField === 1 && hasTypeSelect === 1 && hasLaneSelect === 1);
  await page.screenshot({ path: path.join(ART, "s5_edit_form.png") });

  await page.fill("#af-label", "Gated Planner");
  await page.click("#af-apply");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 20000 });
  const modelE = await page.evaluate(() => window.__archTest.getArchModel());
  check("(1c) 소스 JSON planner.label 교체됨", modelE.source.nodes.find((n) => n.id === "planner").label === "Gated Planner");
  check("(1d) 다른 필드 보존(type/lane 불변)", modelE.source.nodes.find((n) => n.id === "planner").type === "backend" && modelE.source.nodes.find((n) => n.id === "planner").lane === "agent");
  const H1 = await page.evaluate(() => window.__archTest.getArchHtml());
  const off1 = await clusterOffenders(page, H0, H1, ["planner"]);
  check("(1e) 독립 bleed-diff: planner 클러스터 외 전부 바이트 동일", off1.length === 0, JSON.stringify(off1));
  check("(1f) iframe 재렌더 반영", await frame().locator("text=Gated Planner").first().isVisible());

  // 편집 scope: set_fields가 다른 id를 노리면 ScopeViolation (mechanical gate)
  const scopeThrew = await page.evaluate(() => {
    try { ArchifyJsonAdapter.apply(window.__archTest.getArchModel() && { type: "workflow", source: window.__archTest.getArchModel().source, html: "" },
      { ops: [{ op: "set_fields", id: "router", fields: { label: "X" } }] }, { ref: { id: "planner", kind: "node" }, mode: "edit" }); return false; }
    catch (e) { return e.name === "ScopeViolation"; }
  });
  check("(1g) 편집 scope-gate: 타 id set_fields → ScopeViolation", scopeThrew);

  // ========================================================================
  // 2. 그리기 — add_node(폼) → 새 클러스터 등장 + /validate 통과; add_edge(두 노드)
  // ========================================================================
  await reload();
  const H2a = await page.evaluate(() => window.__archTest.getArchHtml());
  await page.evaluate(() => window.__archTest.setMode("draw"));
  await page.waitForSelector("#arch-draw-panel:not([hidden])", { timeout: 5000 });
  check("(2) 그리기 모드 → class-a 그리기 패널 표시", !(await page.locator("#arch-draw-panel").getAttribute("hidden")));
  await page.screenshot({ path: path.join(ART, "s5_draw_panel.png") });
  // add_node via the panel form (into an empty exceptions cell)
  await page.selectOption("#ad-lane", "exceptions");
  await page.selectOption("#ad-type", "backend");
  await page.fill("#ad-col", "0");
  await page.fill("#ad-label", "New Step");
  await page.click("#ad-add");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 20000 });
  const H2b = await page.evaluate(() => window.__archTest.getArchHtml());
  const added2 = await newClusters(page, H2a, H2b);
  check("(2b) add_node → 정확히 1개 새 노드 클러스터 등장", added2.length === 1 && /node$/.test(added2[0]), JSON.stringify(added2));
  const modelD = await page.evaluate(() => window.__archTest.getArchModel());
  check("(2c) 소스에 새 노드 추가 + /validate 통과(커밋됨)", modelD.source.nodes.length === WF_SOURCE.nodes.length + 1);
  const off2 = await clusterOffenders(page, H2a, H2b, added2.map((k) => k.split(" ")[0]));
  check("(2d) add_node: 기존 클러스터 전부 바이트 동일(추가분만 diff)", off2.length === 0, JSON.stringify(off2));

  // add_node bad placement → /validate 반려 + 이유 표출 (occupied cell)
  const badAdd = await page.evaluate(async () => await window.__archTest.archAddNode({ id: "bad1", lane: "agent", col: 2, type: "backend", label: "Collide" }));
  check("(2e) add_node 잘못된 배치(점유 셀) → 렌더러 layout validation이 반려", badAdd.ok === false && /8px|crosses|overlap|validation|배치/i.test(badAdd.error || ""), JSON.stringify(badAdd).slice(0, 160));

  // add_edge between two existing nodes (edge-connect / D11)
  const H2c = await page.evaluate(() => window.__archTest.getArchHtml());
  const beforeEdges = (await page.evaluate(() => window.__archTest.getArchModel())).source.edges.length;
  const addE = await page.evaluate(async () => await window.__archTest.archAddEdge("store", "planner"));
  check("(2f) add_edge(store→planner) 커밋됨 + /validate 통과", addE.ok === true, JSON.stringify(addE).slice(0, 160));
  const H2d = await page.evaluate(() => window.__archTest.getArchHtml());
  const addedE = await newClusters(page, H2c, H2d);
  check("(2g) add_edge → 새 엣지 클러스터 등장, 엣지 수 +1", addedE.some((k) => /edge$/.test(k)) && (await page.evaluate(() => window.__archTest.getArchModel())).source.edges.length === beforeEdges + 1, JSON.stringify(addedE));

  // edge-connect UI state machine: click source node stores it (click-click)
  await reload();
  await page.evaluate(() => window.__archTest.setMode("draw"));
  await page.evaluate(() => window.__archTest.setArchDrawSub("edge"));
  await frame().locator('[data-arch-id="store"]').first().click();
  await page.waitForFunction(() => window.__archTest.getArchEdgeSource() === "store", null, { timeout: 5000 });
  check("(2h) 엣지 연결: 소스 노드 클릭 → 대기 소스로 기억(클릭-클릭)", (await page.evaluate(() => window.__archTest.getArchEdgeSource())) === "store");

  // ========================================================================
  // 3. 콘텐츠 검증 ④ (native /validate) — bad col로 겹침 유발 → id에 핀된 finding
  // ========================================================================
  await reload();
  // ④ on the (valid) loaded diagram → 0 findings, panel shows pass
  await page.evaluate(() => window.__archTest.runArchAudit(4));
  await page.waitForFunction(() => { const el = document.getElementById("fp-status"); return el && /(통과|건)/.test(el.textContent); }, null, { timeout: 15000 });
  const f4valid = await page.evaluate(() => window.__archTest.getFindings());
  check("(3) ④ 유효 다이어그램 → 구조 검증 통과(0건)", f4valid.length === 0, JSON.stringify(f4valid.slice(0, 2)));

  // introduce an overlap via a bad col, run the NATIVE validator, assert it pins to the id
  const nv = await page.evaluate(async (src) => {
    const bad = JSON.parse(JSON.stringify(src));
    bad.nodes.find((n) => n.id === "router").col = 2; // collides with planner in lane "agent"
    return await ArchifyJsonAdapter.nativeValidate({ type: "workflow", source: bad, html: "" }, { baseUrl: "" });
  }, WF_SOURCE);
  check("(3b) ④ bad col → /validate가 실패 보고", nv.ok === false && nv.findings.length >= 1);
  const pinnedIds = nv.findings.map((f) => f.arch_id).filter(Boolean);
  check("(3c) ④ finding이 실제 data-arch-id에 핀됨", pinnedIds.some((id) => id === "planner" || id === "router" || /^e:router->approval/.test(id)), JSON.stringify(nv.findings.map((f) => [f.arch_id, (f.issue || "").slice(0, 34)])));

  // ========================================================================
  // 4. 콘텐츠 검증 ① (mock LLM finding) → "AI로 고치기"가 그 노드 하나만 수정
  // ========================================================================
  await reload();
  const H4 = await page.evaluate(() => window.__archTest.getArchHtml());
  await page.click("#btn-audit");
  await page.click('#audit-menu [data-audit="1"]');
  await page.waitForFunction(() => { const el = document.getElementById("fp-status"); return el && /완료/.test(el.textContent); }, null, { timeout: 15000 });
  const f1 = await page.evaluate(() => window.__archTest.getFindings());
  check("(4) ① mock AI finding ≥1건, arch_id에 핀", f1.length >= 1 && f1[0].eid, JSON.stringify(f1.slice(0, 1)));
  check("(4b) findings 패널 표시(검증)", !(await page.locator("#findings-panel").getAttribute("hidden")));
  await page.screenshot({ path: path.join(ART, "s5_findings_panel.png") });
  const fixId = f1[0].eid;
  await page.locator(".finding").first().locator(".finding-fix").click();
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 25000 });
  const H4b = await page.evaluate(() => window.__archTest.getArchHtml());
  const off4 = await clusterOffenders(page, H4, H4b, [fixId]);
  check("(4c) AI로 고치기: 그 요소 하나만 수정(scoped)", off4.length === 0, JSON.stringify(off4) + " fixId=" + fixId);
  const fixedLabel = (await page.evaluate(() => window.__archTest.getArchModel())).source.nodes.find((n) => n.id === fixId);
  check("(4d) 대표 라벨이 제안대로 교체(검증본)", fixedLabel && /검증본/.test(fixedLabel.label), fixedLabel && fixedLabel.label);

  // ========================================================================
  // 5. 레이아웃 수정 — col 변경 재렌더+재검증; 텍스트 op은 field-lock으로 거부
  // ========================================================================
  await reload();
  // field-lock unit: layout mode strips text field, keeps geometry
  const layLock = await page.evaluate(() => window.__archTest.sanitizeArchLayout(
    { ops: [{ op: "set_fields", id: "blocked", fields: { col: 2, label: "hijack" } }] }, ["blocked"]));
  check("(5) 레이아웃 field-lock: label 제거 + col 통과", layLock.ops.length === 1 && Object.keys(layLock.ops[0].fields).join(",") === "col", JSON.stringify(layLock.ops));
  // col change re-renders and RE-VALIDATES (verify includes /validate) then commits
  const H5 = await page.evaluate(() => window.__archTest.getArchHtml());
  const layRes = await page.evaluate(async () => await window.__archTest.archLayoutOps([{ op: "set_fields", id: "blocked", kind: "node", fields: { col: 2 } }]));
  check("(5b) 레이아웃 col 변경 재렌더+재검증 통과(커밋)", layRes.ok === true, JSON.stringify(layRes).slice(0, 160));
  const modelL = await page.evaluate(() => window.__archTest.getArchModel());
  check("(5c) 소스 blocked.col=2 반영", modelL.source.nodes.find((n) => n.id === "blocked").col === 2);
  const H5b = await page.evaluate(() => window.__archTest.getArchHtml());
  // node + its incident edges may legitimately change (moving a node reroutes its edges)
  const layAllowed = await page.evaluate(() => window.__archTest.archLayoutInventory ? ["blocked", "e:approval->blocked:5", "e:blocked->retry:6"] : ["blocked"]);
  const off5 = await clusterOffenders(page, H5, H5b, layAllowed);
  check("(5d) 레이아웃 bleed: blocked + 인접 엣지만 변경(그 외 불변)", off5.length === 0, JSON.stringify(off5));
  // an invalid col move is caught by re-validation and auto-reverted (fresh state:
  // blocked is back at col4, so moving retry onto col4 collides in lane "exceptions")
  await reload();
  const layBad = await page.evaluate(async () => await window.__archTest.archLayoutOps([{ op: "set_fields", id: "retry", kind: "node", fields: { col: 4 } }]));
  check("(5e) 레이아웃 잘못된 배치 → /validate가 잡고 자동 되돌림", layBad.ok === false && layBad.reverted === true, JSON.stringify(layBad).slice(0, 140));

  // UI: layout mock text instruction → field-lock rejects (변경 0)
  await reload();
  await page.evaluate(() => window.__archTest.setMode("layout"));
  await page.waitForSelector("#wd-bar:not([hidden])", { timeout: 5000 });
  await page.fill("#wd-input", "제목 텍스트를 바꿔줘");
  await page.click("#wd-run");
  await page.waitForSelector("#wd-error:not([hidden])", { timeout: 15000 });
  const layErr = await page.textContent("#wd-error");
  check("(5f) 레이아웃 UI: 텍스트 지시는 field-lock으로 반려", /없습니다|잠금/.test(layErr || "") && (await page.evaluate(() => window.__archTest.undoDepth())) === 0, layErr);

  // ========================================================================
  // 6. 콘텐츠 다듬기 — label 텍스트 변경; geometry op은 field-lock으로 거부
  // ========================================================================
  await reload();
  const polLock = await page.evaluate(() => window.__archTest.sanitizeArchPolish(
    { ops: [{ op: "set_fields", id: "planner", fields: { label: "New", col: 3 } }] }, ["planner"]));
  check("(6) 다듬기 field-lock: col(geometry) 제거 + label 통과", polLock.ops.length === 1 && Object.keys(polLock.ops[0].fields).join(",") === "label", JSON.stringify(polLock.ops));
  const H6 = await page.evaluate(() => window.__archTest.getArchHtml());
  const polRes = await page.evaluate(async () => await window.__archTest.archPolishOps([{ op: "set_fields", id: "planner", kind: "node", fields: { label: "Planner" } }]));
  check("(6b) 다듬기 label 변경 재렌더+검증 통과(커밋)", polRes.ok === true, JSON.stringify(polRes).slice(0, 140));
  const modelP = await page.evaluate(() => window.__archTest.getArchModel());
  check("(6c) 소스 planner.label='Planner' 반영", modelP.source.nodes.find((n) => n.id === "planner").label === "Planner");
  const H6b = await page.evaluate(() => window.__archTest.getArchHtml());
  const off6 = await clusterOffenders(page, H6, H6b, ["planner"]);
  check("(6d) 다듬기 bleed: planner만 변경(geometry 불변)", off6.length === 0, JSON.stringify(off6));

  // UI: polish mock geometry instruction → field-lock rejects
  await reload();
  await page.evaluate(() => window.__archTest.setMode("polish"));
  await page.waitForSelector("#wd-bar:not([hidden])", { timeout: 5000 });
  await page.fill("#wd-input", "노드 위치를 왼쪽으로 옮겨줘");
  await page.click("#wd-run");
  await page.waitForSelector("#wd-error:not([hidden])", { timeout: 15000 });
  const polErr = await page.textContent("#wd-error");
  check("(6e) 다듬기 UI: geometry 지시는 field-lock으로 반려", /없습니다|잠금/.test(polErr || ""), polErr);

  // UI: polish mock (non-geometry) → before/after rows → apply → commit
  await reload();
  await page.evaluate(() => window.__archTest.setMode("polish"));
  await page.fill("#wd-input", "문어체로 통일하고 군더더기를 줄여줘");
  await page.click("#wd-run");
  await page.waitForSelector("#polish-panel:not([hidden])", { timeout: 15000 });
  const rows = await page.evaluate(() => window.__archTest.getArchPolishRows());
  check("(6f) 다듬기 UI: before→after diff 리스트 생성", rows && rows.length >= 1 && rows.every((r) => r.after !== r.before), JSON.stringify((rows || []).slice(0, 1)));
  await page.click("#pp-apply");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 20000 });
  check("(6g) 다듬기 UI: 승인 → 커밋(재검증 통과)", (await page.evaluate(() => window.__archTest.undoDepth())) === 1);

  // ========================================================================
  // 7. undo 무결성 + 다운로드 청결 (전 모드 공통)
  // ========================================================================
  await page.click("#btn-undo");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 8000 });
  check("(7) undo → 소스 모델 복원(undo 스택 0)", (await page.evaluate(() => window.__archTest.undoDepth())) === 0);

  check("(z) 콘솔 에러 없음(예상된 400 제외)", pageErrors.length === 0, pageErrors.slice(0, 4).join(" | "));
  console.log("      [info] 예상된 serve 400 응답 " + expected400s + "건(잘못된 배치 반려) — 앱이 정상 처리");
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 8).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s5_failure.png") }); } catch {}
} finally {
  await browser.close();
  started.server.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
