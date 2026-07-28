// 보강 검증 — scope 3중 보증의 부정 경로(negative path)와 연결설정 UI.
//  N1 scope-gate: 다른 eid를 노린 op → ScopeViolation throw
//  N2 bleed-diff: 선택 밖 요소를 고의로 변형한 문서 → ok:false + 정확한 offender 식별
//  N3 schema pin: buildToolSchema의 모든 op 분기 eid가 {"const": 선택 eid}
//  N4 sanitize: 비허용 스타일 키/url() 값/금지 속성 제거
//  N5 연결설정 패널: 기본값(프록시 URL·모델) + mock 자동 체크 + 스크린샷
//  N6 mock 해제 + 키 없음 → 명확한 에러 표출(크래시 없음)
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8614;
const BASE = `http://127.0.0.1:${PORT}`;
const ART = path.join(APP_DIR, "test", "artifacts");
fs.mkdirSync(ART, { recursive: true });

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "  — " + extra : "")); }
};

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: APP_DIR, stdio: "ignore" });
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { const r = await fetch(BASE + "/index.html"); up = r.ok; } catch {}
  if (!up) await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: { width: 2120, height: 1420 } }).then((c) => c.newPage());

try {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });

  // N1: scope-gate — 스키마를 우회했다고 가정한 악성 ops
  const n1 = await page.evaluate(() => {
    try {
      DomAdapter.sanitizeOps({ ops: [{ op: "setText", eid: "obj:3", text: "탈취" }] }, "obj:24");
      return { threw: false };
    } catch (e) { return { threw: true, name: e.name, msg: e.message }; }
  });
  check("N1 scope-gate: 타 eid op → ScopeViolation", n1.threw && n1.name === "ScopeViolation", JSON.stringify(n1));

  // N2: bleed-diff — 선택(obj:24) 밖 obj:3을 고의 변형
  const n2 = await page.evaluate(() => {
    const before = DomAdapter.parse(window.__archTest.getSource());
    const after = before.cloneNode(true);
    const victim = after.querySelector('[data-arch-eid="obj:3"]');
    victim.style.background = "#FF0000"; // 범위 밖 오염 시뮬레이션
    const r = DomAdapter.bleedDiff(before, after, "obj:24");
    return { ok: r.ok, offenders: r.offenders };
  });
  check("N2 bleed-diff: 범위 밖 변형 검출 + offender 식별", n2.ok === false && n2.offenders.includes("obj:3"), JSON.stringify(n2));

  // N3: schema pin — 모든 비-reject 분기의 eid가 const로 고정
  const n3 = await page.evaluate(() => {
    const s = DomAdapter.buildToolSchema("obj:24");
    const branches = s.properties.ops.items.anyOf;
    const opBranches = branches.filter((b) => !b.properties.op.const || b.properties.op.const !== "reject");
    const pinned = branches
      .filter((b) => b.properties.eid)
      .every((b) => b.properties.eid.const === "obj:24");
    const rejectHasNoEid = branches.some((b) => b.properties.op.const === "reject" && !b.properties.eid);
    return { count: branches.length, pinned, rejectHasNoEid, opCount: opBranches.length };
  });
  check("N3 schema pin: eid={\"const\":선택eid} 전 분기 적용", n3.count === 4 && n3.pinned && n3.rejectHasNoEid, JSON.stringify(n3));

  // N4: sanitize — 비허용 키·url() 값·금지 속성
  const n4 = await page.evaluate(() => {
    const { ops, notes } = DomAdapter.sanitizeOps({
      ops: [
        { op: "setStyle", eid: "obj:24", style: { background: "url(http://evil)", color: "#111", position: "fixed" } },
        { op: "setAttr", eid: "obj:24", name: "data-arch-eid", value: "obj:0" },
        { op: "setAttr", eid: "obj:24", name: "onclick", value: "alert(1)" },
      ],
    }, "obj:24");
    return { ops, notes };
  });
  const onlyColorSurvived = n4.ops.length === 1 && n4.ops[0].op === "setStyle" &&
    Object.keys(n4.ops[0].style).join(",") === "color";
  check("N4 sanitize: url()/비허용 키/금지 속성 전부 제거", onlyColorSurvived, JSON.stringify(n4));

  // N5: 연결설정 패널
  await page.click("#btn-settings");
  const proxyVal = await page.inputValue("#proxy-url");
  const modelVal = await page.inputValue("#model");
  const mockOn = await page.isChecked("#mock-toggle");
  check("N5 연결설정: 프록시 기본값+모델 기본값+mock 자동", proxyVal === "https://nvidia-proxy.popixoxipop.workers.dev" && modelVal === "stepfun-ai/step-3.5-flash" && mockOn, `${proxyVal} / ${modelVal} / mock=${mockOn}`);
  await page.screenshot({ path: path.join(ART, "mvp_settings_panel.png") });

  // N6: mock 해제 + 키 없음 → 에러 표출
  await page.setChecked("#mock-toggle", false);
  const frame = page.frameLocator("#diagram-frame");
  await frame.locator("div[data-arch-eid]").filter({ hasText: "질문 / 그래프" }).first().click();
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 });
  await page.fill("#fi-text", "제목을 '테스트'로 바꿔줘");
  await page.click("#fi-run");
  await page.waitForSelector("#fi-error:not([hidden])", { timeout: 5000 });
  const errText = await page.textContent("#fi-error");
  check("N6 키 없음+mock 해제 → 명확한 에러", (errText || "").includes("NVIDIA 키가 없습니다"), errText);
  const depth = await page.evaluate(() => window.__archTest.undoDepth());
  check("N6b 실패 시 소스 무변형(undo 스택 0)", depth === 0, "depth=" + depth);
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 4).join("\n") : err));
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
