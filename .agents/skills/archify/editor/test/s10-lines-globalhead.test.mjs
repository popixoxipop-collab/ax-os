// Stage 10 — (1) 편집 ▾ 드롭다운 + 화살촉 크기 **일괄(문서 전체)** 조절, (2) SVG 박스 줄 추가/삭제.
//
// 검증 대상:
//   (A) 드롭다운: 편집 버튼이 콘텐츠 검증 ▾와 같은 패턴의 메뉴를 열고, **누르면 요소 편집 모드에도
//       그대로 진입**(근육 기억 보존). 바깥 클릭으로 닫히고, 검증 드롭다운은 무회귀.
//   (B) 전역 화살촉: 확인 게이트 → 적용. 공유 marker가 실제로 커지는지를 **렌더 잉크로 실측**한다
//       (속성만 키우면 화살촉은 안 커진다는 D18 실측을 대조군으로 재현). 개별 클론을 가진 화살표도
//       같은 크기로 수렴하고, 옛 크기로 남은 화살표가 하나도 없음을 전수 확인. Cmd+Z 한 번에 전량 복원.
//   (C) 줄 추가: 3줄 박스 → 4줄. 새 <text>가 이웃 줄의 font-size/weight/fill/anchor/x를 상속하고,
//       네 줄 전부 도형 세로 범위 **안**에 들어오며 블록이 중앙에 놓인다. bleed-diff 청결·undo 복원.
//   (D) 줄 삭제: 지목한 줄만 사라지고 나머지가 재배분·도형 안 유지. bleed 청결·undo 복원. 0줄까지 허용.
//   (E) 비-rect(다이아 polygon · 게이트 path): 추가/삭제가 크래시 없이 동작하고 줄이 도형 안에 남는다.
//   (F) 넘침 정책(자라지 않고 거절) + 스코프/스키마 보증(eid pin · ScopeViolation · 잡값 제거).
//
// 원칙(s6/s9와 동일): bleed-diff·기하 판정은 앱 로직을 재사용하지 않고 테스트가 독립 DOMParser로
// 재구현한다(순환 방지). "렌더됐다"는 주장도 속성이 아니라 캔버스 래스터화 잉크로 실증한다.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8623;
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
const ctx = await browser.newContext({ viewport: { width: 2120, height: 1420 }, acceptDownloads: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));

const frame = () => page.frameLocator("#diagram-frame");
const vf = () => page.frames().find((f) => f !== page.mainFrame());
const src = () => page.evaluate(() => window.__archTest.getSource());
const depth = () => page.evaluate(() => window.__archTest.undoDepth());
async function stageBox() { return await page.locator("#stage").boundingBox(); }

// ── 독립 bleed-diff (s6와 동일: 중첩 대응) ──
// (1) 선택 박스를 마스크로 치환한 문서 전체가 before==after, (2) 그 박스의 조상이 아닌 다른
// data-arch-eid는 전부 outerHTML 동일. 둘 다 통과해야 "그 박스만 변경"으로 인정.
const bleedClean = (a, b, eid) => page.evaluate(([ha, hb, e]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  const mask = (doc) => { const el = doc.querySelector('[data-arch-eid="' + e + '"]'); if (el) el.replaceWith(doc.createElement("arch-mask-test")); return doc.documentElement.outerHTML; };
  const maskedEqual = mask(P(ha)) === mask(P(hb));
  const A = P(ha), B = P(hb);
  const unitA = A.querySelector('[data-arch-eid="' + e + '"]');
  const offenders = [];
  A.querySelectorAll("[data-arch-eid]").forEach((el) => {
    const k = el.getAttribute("data-arch-eid");
    if (k === e) return;
    if (unitA && el.contains(unitA)) return;              // 조상 — 마스크 검사가 커버
    const elB = B.querySelector('[data-arch-eid="' + k + '"]');
    if (!elB || el.outerHTML !== elB.outerHTML) offenders.push(k);
  });
  return { ok: maskedEqual && offenders.length === 0, maskedEqual, offenders };
}, [a, b, eid]);

// 소스 HTML에서 박스의 줄 목록·도형 경계를 앱 코드 없이 독립 파싱.
const boxLines = (html, eid) => page.evaluate(([h, e]) => {
  const g = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]');
  if (!g) return null;
  const kids = [...g.children];
  const texts = kids.filter((c) => c.tagName.toLowerCase() === "text");
  const shape = kids.find((c) => ["rect", "polygon", "path", "ellipse", "circle"].includes(c.tagName.toLowerCase()));
  let box = null;
  if (shape) {
    const tag = shape.tagName.toLowerCase();
    if (tag === "rect") {
      box = { y0: parseFloat(shape.getAttribute("y") || 0), y1: parseFloat(shape.getAttribute("y") || 0) + parseFloat(shape.getAttribute("height")),
              x0: parseFloat(shape.getAttribute("x") || 0), x1: parseFloat(shape.getAttribute("x") || 0) + parseFloat(shape.getAttribute("width")) };
    } else {
      const src2 = tag === "polygon" ? (shape.getAttribute("points") || "") : (shape.getAttribute("d") || "");
      const n = (src2.match(/-?\d*\.?\d+/g) || []).map(Number);
      const xs = [], ys = [];
      for (let i = 0; i + 1 < n.length; i += 2) { xs.push(n[i]); ys.push(n[i + 1]); }
      if (xs.length) box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    }
  }
  return {
    shape: shape ? shape.tagName.toLowerCase() : null, box,
    lines: texts.map((t, i) => ({
      i, text: (t.textContent || "").trim(),
      y: parseFloat(t.getAttribute("y")), x: parseFloat(t.getAttribute("x")),
      fs: parseFloat(t.getAttribute("font-size")),
      weight: t.getAttribute("font-weight"), fill: t.getAttribute("fill"),
      anchor: t.getAttribute("text-anchor"), ls: t.getAttribute("letter-spacing"),
      attrs: [...t.attributes].map((a) => a.name).sort().join(","),
    })),
  };
}, [html, eid]);

// 줄 블록이 도형 안에 있는지 + 중앙인지 (독립 계산: ascent 0.8em / descent 0.2em 가정)
function blockFit(info) {
  const L = info.lines;
  if (!L.length || !info.box) return null;
  const top = Math.min(...L.map((l) => l.y - l.fs * 0.8));
  const bot = Math.max(...L.map((l) => l.y + l.fs * 0.2));
  const shapeMid = (info.box.y0 + info.box.y1) / 2;
  return {
    top, bot, inside: top >= info.box.y0 - 0.01 && bot <= info.box.y1 + 0.01,
    baselinesInside: L.every((l) => l.y > info.box.y0 && l.y < info.box.y1),
    centerOffset: Math.abs((top + bot) / 2 - shapeMid),
    ordered: L.every((l, i) => i === 0 || l.y > L[i - 1].y),
  };
}

// ── ★ 렌더 실측: "화살촉이 실제로 칠한 픽셀 수"를 차분으로 잰다 ──
// 속성(markerWidth 등)을 읽는 게 아니라 브라우저 SVG 엔진이 그린 결과를 재므로, D18의 함정
// ("크기 속성만 키우면 화살촉은 안 커진다")이 여기를 통과할 수 없다.
// 방법: 그 화살표와 조상(=transform 보존)·<defs>만 남긴 사본을 두 번 래스터화한다 —
//   (1) 원본 그대로, (2) marker-end만 제거. 두 잉크 픽셀 수의 **차이 = 화살촉의 렌더 면적**.
// 선 자체·경로 모양·이웃 도형에 전혀 오염되지 않고, 면적이라 배율 s에 대해 s²로 자란다.
const headInk = (html, eid) => page.evaluate(async ([h, e]) => {
  const raster = async (stripMarker) => {
    const d = new DOMParser().parseFromString(h, "text/html");
    const svg = d.querySelector("svg[data-object]").cloneNode(true);
    const target = svg.querySelector('[data-arch-eid="' + e + '"]');
    if (!target) return null;
    [...svg.querySelectorAll("*")].forEach((el) => {
      if (el === target || el.contains(target) || el.closest("defs")) return;
      el.remove();
    });
    if (stripMarker) target.removeAttribute("marker-end");
    const vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
    svg.setAttribute("width", String(vb[2])); svg.setAttribute("height", String(vb[3]));
    svg.removeAttribute("style");
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("raster fail")); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.outerHTML); });
    const c = document.createElement("canvas"); c.width = vb[2]; c.height = vb[3];
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] >= 60) ink++;
    return ink;
  };
  const withM = await raster(false), noM = await raster(true);
  if (withM == null || noM == null) return { error: "no target" };
  return { head: withM - noM, line: noM, total: withM };
}, [html, eid]);

async function loadSvg() {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await page.evaluate(async (h) => { await window.__archTest.load(h, "svg.html"); }, SVG_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
  await page.waitForTimeout(250);
  return await src();
}
async function setMode(m) { await page.evaluate((mm) => window.__archTest.setMode(mm), m); await page.waitForTimeout(250); }
async function undoAll() { while ((await depth()) > 0) { await page.click("#btn-undo"); await page.waitForTimeout(120); } }

try {
  let A0 = await loadSvg();
  check("(A0) scale=1 · provenance=dom", (await page.evaluate(() => window.__archTest.getScale())) === 1
    && (await page.evaluate(() => window.__archTest.getProvenance())) === "dom");

  // ==================== (A) 편집 ▾ 드롭다운 ====================
  check("(A1) 초기엔 편집 메뉴 닫힘", !(await page.evaluate(() => window.__archTest.isEditMenuOpen())));
  await page.click("#btn-edit");
  await page.waitForTimeout(200);
  check("(A2) 편집 클릭 → 메뉴 열림", await page.evaluate(() => window.__archTest.isEditMenuOpen()));
  check("(A3) ★편집 클릭이 요소 편집 모드에도 그대로 진입(근육 기억 보존)",
    (await page.evaluate(() => window.__archTest.getMode())) === "edit", "mode=" + (await page.evaluate(() => window.__archTest.getMode())));
  const items = await page.$$eval("#edit-menu [data-editsub]", (bs) => bs.map((b) => ({ sub: b.dataset.editsub, txt: b.textContent.replace(/\s+/g, " ").trim(), dis: b.disabled })));
  // ★ D25d 계약 변경: '화살촉 크기 일괄 조절'(globalhead)은 상단 독립 버튼에서 3행(#fmt-head-all)으로
  //   이전됐다 → 1행 #edit-menu엔 '요소 편집'(D25a 토글) 하나만 남는다(구: 2항목).
  check("(A4) 하위 항목 1개: 요소 편집 토글(화살촉 일괄은 D25d로 3행 이전)", items.length === 1
    && items[0].sub === "element" && /요소 편집/.test(items[0].txt), JSON.stringify(items));
  check("(A4b) 요소 편집 항목 활성(class-b 슬라이드)", items.every((i) => !i.dis), JSON.stringify(items));
  check("(A4c) aria-expanded=true", (await page.getAttribute("#btn-edit", "aria-expanded")) === "true");
  // ★ D25d: '전체' 태그(스코프 예고, D19 안전장치)는 화살촉 일괄과 함께 3행 #fmt-head-all로 옮겨갔다.
  check("(A4d) 전역 항목이 '전체' 태그로 스코프를 예고(3행으로 이전됨)", (await page.$eval('#fmt-head-all .dd-tag', (e) => e.className)).includes("all"));
  await page.screenshot({ path: path.join(ART, "s10_edit_menu.png"), clip: { x: 0, y: 0, width: 2120, height: 300 } });

  // ★ D24로 계약이 뒤집힌 지점: 편집 도구는 이제 **드롭다운이 아니라 상단 툴바의 버튼 그룹**이다.
  //   드롭다운 시절엔 "바깥을 클릭하면 닫힌다"가 옳았지만, 툴바는 바깥을 눌러도(=다이어그램에서
  //   요소를 고르는 바로 그 동작) 사라지면 안 된다 — 툴바를 쓰려면 먼저 바깥을 클릭해야 하므로
  //   닫히는 순간 도구가 영원히 도달 불가가 된다. 그래서 같은 조작에 대해 **반대**를 검사한다.
  await page.mouse.click(120, 400);
  await page.waitForTimeout(200);
  check("(A5) ★바깥(다이어그램) 클릭에도 편집 도구는 그대로 — 툴바는 드롭다운이 아니다",
    await page.evaluate(() => window.__archTest.isEditMenuOpen()));

  // 검증 드롭다운 무회귀 + 서로를 닫는다
  await page.click("#btn-audit");
  await page.waitForTimeout(150);
  check("(A6) 콘텐츠 검증 ▾ 드롭다운 무회귀(열림)", await page.evaluate(() => window.__archTest.isAuditMenuOpen()));
  check("(A6b) 검증 항목 5개 유지", (await page.$$("#audit-menu [data-audit]")).length === 5);
  await page.click("#btn-edit");
  await page.waitForTimeout(200);
  check("(A7) 편집 메뉴를 열면 검증 메뉴는 닫힌다", (await page.evaluate(() => window.__archTest.isEditMenuOpen()))
    && !(await page.evaluate(() => window.__archTest.isAuditMenuOpen())));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  // ★ D24: Escape는 선택·패널을 정리하는 키지 모드를 나가는 키가 아니다. 편집 모드에 머무르는 한
  //   도구도 남아야 한다(Escape 한 번에 도구가 사라지면 방금 고친 발견성 회귀가 그대로 재발한다).
  check("(A8) ★Escape로 선택은 풀리지만 편집 도구는 남는다(편집 모드 유지)",
    (await page.evaluate(() => window.__archTest.isEditMenuOpen()))
    && (await page.evaluate(() => window.__archTest.getMode())) === "edit");

  // 하위 항목 (a) 요소 편집 = 기본 동작 유지
  // ★ D25a 계약 변경: '요소 편집'은 이제 ON/OFF 토글이다(구 단발 액션 아님). 편집 모드 진입 = 기본 ON이라
  //   버튼을 누르지 않아도 요소 편집이 켜져 있고 박스 클릭이 패널을 연다(오늘 동작 보존). 버튼을 누르면
  //   ON↔OFF가 뒤집힌다 — 그 토글 자체는 s14가 검증한다. 여기선 '진입=기본 ON' 계약만 확인한다.
  await page.click("#btn-edit"); await page.waitForTimeout(200);   // 이미 편집 모드면 접힌 툴바만 펴진다(리셋 아님)
  check("(A9) ★편집 모드 = 요소 편집 기본 ON · 도구 유지 · 그 항목 켜짐 · 일괄 바 없음",
    (await page.evaluate(() => window.__archTest.getMode())) === "edit"
    && (await page.evaluate(() => window.__archTest.isEditMenuOpen()))
    && (await page.evaluate(() => window.__archTest.getElementEditOn())) === true
    && (await page.evaluate(() => window.__archTest.editToolButtons()[0].on)) === true
    && !(await page.evaluate(() => window.__archTest.isGlobalHeadBarOpen())));
  // 요소 편집이 실제로 되는지(무회귀): 박스 클릭 → 패널
  const boxes = await page.evaluate(() => window.__archTest.getSvgBoxes());
  const rectEid = boxes.find((b) => b.shape === "rect").eid;
  await frame().locator('[data-arch-eid="' + rectEid + '"]').click();
  // popup removed 2026-07-21 → toolbar: 팝업은 안 뜨고, 선택 확인은 getSelected로. 툴바가 유일 표면.
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, rectEid, { timeout: 5000 });
  check("(A9b) 기본 경로에서 박스 선택 → 툴바가 대상으로 반영 + 팝업 없음",
    (await page.evaluate(() => window.__archTest.getSelected())).eid === rectEid
    && (await page.evaluate(() => window.__archTest.anyDetailPanelOpen())) === false);

  // ==================== (B) 화살촉 크기 일괄(문서 전체) 조절 ====================
  A0 = await loadSvg();
  const edges0 = await page.evaluate(() => window.__archTest.getSvgEdges());
  // 수평 화살표를 골라 화살촉 렌더를 잰다(세로 확산 = 화살촉 밑변 폭).
  const horiz = edges0.filter((e) => e.editable && e.points.length >= 2
    && e.points[e.points.length - 1].y === e.points[e.points.length - 2].y
    && Math.abs(e.points[e.points.length - 1].x - e.points[e.points.length - 2].x) > 20);
  check("(B0) 수평 화살표 확보(렌더 실측용)", horiz.length >= 2, "n=" + horiz.length);
  const probe = horiz[0], probe2 = horiz[1];
  const tipOf = (e) => e.points[e.points.length - 1];

  const inkBefore = await headInk(A0, probe.eid);
  // 기하상 삼각형은 10×8/2=40u²지만 marker의 markerUnits 기본값이 strokeWidth라 stroke-width=2인
  // 이 화살표들에서는 2배(면적 4배)로 그려진다 → 실측 ~130px. 절대값이 아니라 **배율 변화**가
  // 아래 검사들의 실제 판정 기준이다(여기선 "측정이 성립함"만 확인).
  check("(B0b) 기준 렌더 측정 성립(1배 화살촉이 유의미한 면적을 칠함)",
    inkBefore.head >= 60 && inkBefore.head <= 300 && inkBefore.line > 0, JSON.stringify(inkBefore));
  // 대조군: 콘텐츠는 그대로 두고 markerWidth/Height/refX만 3배로 — D18이 반증한 "안 되는 방법".
  const attrOnly = await page.evaluate((h) => {
    const d = new DOMParser().parseFromString(h, "text/html");
    d.querySelectorAll("marker").forEach((m) => {
      m.setAttribute("markerWidth", "30"); m.setAttribute("markerHeight", "24");
      m.setAttribute("refX", "27"); m.setAttribute("refY", "12");
    });
    return d.documentElement.outerHTML;
  }, A0);
  const inkAttrOnly = await headInk(attrOnly, probe.eid);

  // 일괄 3배 적용 — ★ D25d 계약 변경: 화살촉 일괄 트리거가 상단 버튼에서 3행 '전체 적용'(#fmt-head-all)으로
  //   이전됐다. 화살표 편집 focus에서만 뜨므로 focus 설정 후 클릭한다. 여는 바(#gh-bar)·슬라이더·확인 게이트는 그대로.
  await page.click("#btn-edit"); await page.waitForTimeout(150);
  await page.evaluate(() => window.__archTest.setEditFocus("arrow")); await page.waitForTimeout(200);
  await page.click("#fmt-head-all");
  await page.waitForTimeout(250);
  check("(B1) 3행 '전체 적용' → 일괄 조절 바 표시(구 1행 버튼과 같은 D19 바)", await page.evaluate(() => window.__archTest.isGlobalHeadBarOpen()));
  check("(B1b) 바에 '개별 조정도 덮어씁니다' 고지가 있음", /개별 조정도 덮어씁니다/.test(await page.textContent("#gh-bar")));
  await page.evaluate(() => { const el = document.getElementById("gh-size"); el.value = "3"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  check("(B1c) 슬라이더 라벨 동기화", (await page.textContent("#gh-sizeval")) === "3.0×");
  await page.click("#gh-apply");
  await page.waitForSelector("#wd-confirm:not([hidden])", { timeout: 5000 });
  const pend = await page.evaluate(() => window.__archTest.getPendingGlobalHead());
  check("(B2) ★확인 게이트 — 적용 전엔 소스 무변형(undo 0)", pend && pend.scale === 3 && (await depth()) === 0 && (await src()) === A0, JSON.stringify(pend));
  check("(B2b) 확인 문구가 영향 범위(화살표 42개 · 문서 전체)를 명시",
    /42개/.test(await page.textContent("#wd-confirm-text")) && /문서 전체/.test(await page.textContent("#wd-confirm-text")),
    await page.textContent("#wd-confirm-text"));
  await page.screenshot({ path: path.join(ART, "s10_globalhead_confirm.png"), clip: { x: 0, y: 0, width: 2120, height: 900 } });
  // 시각 대조용 before: 확인 다이얼로그를 잠시 닫고 다이어그램만 찍는다(적용 전 상태).
  await page.click("#wd-confirm-cancel"); await page.waitForTimeout(200);
  const sbShot = await stageBox();
  const DIAG_CLIP = { x: sbShot.x + 230, y: sbShot.y + 228, width: 1640, height: 520 };
  await page.screenshot({ path: path.join(ART, "s10_globalhead_before.png"), clip: DIAG_CLIP });
  await page.click("#gh-apply"); await page.waitForSelector("#wd-confirm:not([hidden])", { timeout: 5000 });
  check("(B2c) 취소 → 변경 없음(위 before 촬영 시 취소를 거쳤다)", (await depth()) === 0 && (await src()) === A0);
  await page.click("#wd-confirm-apply");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  await page.waitForTimeout(300);
  let S = await src();

  const mk3 = await page.evaluate(() => window.__archTest.getSvgMarkers());
  check("(B3) 공유 marker 3개가 전부 3배(10→30 · refX 9→27 비율 0.9 유지)",
    mk3.length === 3 && mk3.every((m) => +m.markerWidth === 30 && +m.markerHeight === 24 && +m.refX === 27 && +m.refY === 12), JSON.stringify(mk3.map((m) => [m.id, m.markerWidth, m.refX])));
  await page.screenshot({ path: path.join(ART, "s10_globalhead_after.png"), clip: DIAG_CLIP });
  const inkAfter = await headInk(S, probe.eid);
  check("(B4) ★렌더 실측: 화살촉이 칠한 면적이 실제로 ~9배(=3배²)로 커짐 — 속성이 아니라 그려진 픽셀",
    inkAfter.head >= inkBefore.head * 6,
    `head px ${inkBefore.head}→${inkAfter.head} (ratio ${(inkAfter.head / inkBefore.head).toFixed(1)})`);
  check("(B4b) ★대조군 반증: 크기 속성(markerWidth/Height/refX)만 키우면 렌더는 안 커진다(D18 함정 재현)",
    inkAttrOnly.head < inkBefore.head * 1.5,
    `attr-only=${inkAttrOnly.head} vs base ${inkBefore.head} vs real ${inkAfter.head}`);
  const ink2Before = await headInk(A0, probe2.eid);
  const ink2 = await headInk(S, probe2.eid);
  check("(B4c) 다른 화살표의 화살촉도 같이 커짐(전역이라는 뜻)", ink2.head >= ink2Before.head * 6,
    `head px ${ink2Before.head}→${ink2.head}`);

  // 전수: 옛 크기로 남은 화살표가 하나도 없어야 한다 — marker 배율 + 화살표 기록 둘 다.
  const uniformity = await page.evaluate((h) => {
    const d = new DOMParser().parseFromString(h, "text/html");
    const scaleOf = (m) => parseFloat(m.getAttribute("data-arch-head-scale") || "1");
    const markers = new Map([...d.querySelectorAll("marker")].map((m) => [m.getAttribute("id"), scaleOf(m)]));
    const edges = [...d.querySelectorAll('[data-svgedge="1"]')];
    const effective = edges.map((e) => {
      const ref = /url\(\s*#([^)\s]+)\s*\)/.exec(e.getAttribute("marker-end") || "");
      return ref && markers.has(ref[1]) ? markers.get(ref[1]) : null;
    });
    return {
      edges: edges.length, distinct: [...new Set(effective)],
      recorded: [...new Set(edges.map((e) => e.getAttribute("data-svgedge-head")))],
      unresolved: effective.filter((v) => v == null).length,
    };
  }, S);
  check("(B5) ★옛 크기로 남은 화살표 0 — 42개 전부 유효 배율 3", uniformity.unresolved === 0
    && uniformity.distinct.length === 1 && uniformity.distinct[0] === 3 && uniformity.edges === 42, JSON.stringify(uniformity));
  check("(B5b) 화살표에 기록된 배율도 전부 3(패널 슬라이더가 실제와 일치)",
    uniformity.recorded.length === 1 && uniformity.recorded[0] === "3", JSON.stringify(uniformity.recorded));

  // Cmd+Z 한 번에 전량 복원 (단일 스냅샷)
  await page.keyboard.press("Meta+z");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 0, null, { timeout: 6000 });
  check("(B6) ★Cmd+Z 한 번에 전역 변경 전체가 바이트 동일 복원", (await src()) === A0);
  check("(B6b) marker도 원래 3개·원래 크기", JSON.stringify((await page.evaluate(() => window.__archTest.getSvgMarkers())).map((m) => [m.id, m.markerWidth, m.refX]))
    === JSON.stringify([["ah", "10", "9"], ["ah-muted", "10", "9"], ["ah-red", "10", "9"]]));

  // ── ★ 개별 클론이 있어도 일괄이 그것까지 균일하게 만든다 ──
  const cloneEid = probe.eid;
  await page.evaluate((e) => window.__archTest.applySvgManual([{ op: "setHeadSize", eid: e, scale: 0.5 }], e), cloneEid);
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  const mkC = await page.evaluate(() => window.__archTest.getSvgMarkers());
  check("(B7) 사전조건: 그 화살표에 개별 클론(0.5×)이 생김", mkC.length === 4 && mkC.some((m) => m.clone === cloneEid && +m.markerWidth === 5), JSON.stringify(mkC.map((m) => [m.id, m.markerWidth])));
  const inkSmall = await headInk(await src(), probe.eid);
  check("(B7c) 렌더 실측: 그 화살촉이 실제로 작아져 있음(0.5× → 면적 1/4)",
    inkSmall.head < inkBefore.head * 0.6, `head px ${inkBefore.head}→${inkSmall.head}`);
  await page.evaluate(() => window.__archTest.openGlobalHeadBar());
  await page.evaluate(() => window.__archTest.runGlobalHead(3));
  await page.waitForSelector("#wd-confirm:not([hidden])", { timeout: 5000 });
  check("(B7b) 확인 문구가 '개별 조정 1개도 덮어씀'을 고지", /개별 조정된 화살표 1개/.test(await page.textContent("#wd-confirm-text")), await page.textContent("#wd-confirm-text"));
  await page.click("#wd-confirm-apply");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 2, null, { timeout: 6000 });
  await page.waitForTimeout(300);
  S = await src();
  const mkC2 = await page.evaluate(() => window.__archTest.getSvgMarkers());
  check("(B8) ★개별 클론도 같은 3배로 수렴(클론 유지·재생성 없음)", mkC2.length === 4
    && mkC2.every((m) => +m.markerWidth === 30 && +m.markerHeight === 24 && +m.refX === 27), JSON.stringify(mkC2.map((m) => [m.id, m.markerWidth])));
  const inkCloneAfter = await headInk(S, probe.eid);
  const inkOtherAfter = await headInk(S, probe2.eid);
  const uniformRatio = inkCloneAfter.head / inkOtherAfter.head;
  check("(B8b) ★렌더 실측: 축소돼 있던 그 화살촉이 공유 marker 화살표와 같은 면적으로 커짐(±15%)",
    inkCloneAfter.head >= inkSmall.head * 4 && Math.abs(uniformRatio - 1) <= 0.15,
    `clone head px ${inkSmall.head}→${inkCloneAfter.head} · 공유 marker 화살표 ${inkOtherAfter.head} (ratio ${uniformRatio.toFixed(2)})`);
  const uni2 = await page.evaluate((h) => {
    const d = new DOMParser().parseFromString(h, "text/html");
    const markers = new Map([...d.querySelectorAll("marker")].map((m) => [m.getAttribute("id"), parseFloat(m.getAttribute("data-arch-head-scale") || "1")]));
    const eff = [...d.querySelectorAll('[data-svgedge="1"]')].map((e) => {
      const r = /url\(\s*#([^)\s]+)\s*\)/.exec(e.getAttribute("marker-end") || "");
      return r ? markers.get(r[1]) : null;
    });
    return [...new Set(eff)];
  }, S);
  check("(B8c) 클론 포함 전 화살표의 유효 배율이 단일값 3", uni2.length === 1 && uni2[0] === 3, JSON.stringify(uni2));
  await page.screenshot({ path: path.join(ART, "s10_globalhead_clone_uniform.png"), clip: DIAG_CLIP });
  await undoAll();
  check("(B9) undo 전량 후 원본 복원(클론까지 소멸)", (await src()) === A0
    && (await page.evaluate(() => window.__archTest.getSvgMarkers())).length === 3);

  // ==================== (C) 줄 추가 ====================
  A0 = await loadSvg();
  await setMode("edit");
  const snaps = await page.evaluate((es) => es.map((e) => ({ eid: e.eid, shape: e.shape, n: window.__archTest.svgSnapshot(e.eid).lines.length })), boxes);
  const box3 = snaps.find((s) => s.shape === "rect" && s.n === 3).eid;
  const before3 = await boxLines(A0, box3);
  check("(C0) 대상: 3줄 rect 박스", before3.lines.length === 3 && before3.shape === "rect", box3 + " " + JSON.stringify(before3.lines.map((l) => l.text)));
  const fitBefore = blockFit(before3);
  check("(C0b) 원본도 도형 안(기준선 전부 내부)", fitBefore.baselinesInside, JSON.stringify(fitBefore));

  // 패널 클릭 경로로 추가 (＋ 줄 추가)
  await frame().locator('[data-arch-eid="' + box3 + '"]').click();
  // popup removed 2026-07-21 → toolbar row2: 줄 편집 UI(＋/−·크기)가 박스 선택 시 툴바에 뜬다(팝업 없음)
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, box3, { timeout: 5000 });
  check("(C0c) 3줄 박스 선택 → 툴바에 줄 컨트롤(＋/−)·크기 노출 + 팝업 없음",
    (await page.evaluate(() => window.__archTest.boxTools().lineboxVisible)) === true
    && (await page.evaluate(() => window.__archTest.boxTools().sizeboxVisible)) === true
    && (await page.evaluate((e) => window.__archTest.svgSnapshot(e).lines.length, box3)) === 3
    && (await page.evaluate(() => window.__archTest.anyDetailPanelOpen())) === false);
  await page.screenshot({ path: path.join(ART, "s10_toolbar_lines.png"), clip: { x: 0, y: 60, width: 1500, height: 130 } });
  // 박스 확대 before (선택 오버레이를 치우고 도형만)
  const boxRect = await frame().locator('[data-arch-eid="' + box3 + '"]').boundingBox();
  const BOX_CLIP = { x: boxRect.x - 26, y: boxRect.y - 26, width: boxRect.width + 52, height: boxRect.height + 52 };
  await page.evaluate(() => window.__archTest.setMode("edit")); await page.waitForTimeout(300);   // 선택 해제(팝업 없음 → 오버레이만 정리)
  await page.screenshot({ path: path.join(ART, "s10_box_before_3lines.png"), clip: BOX_CLIP });
  await frame().locator('[data-arch-eid="' + box3 + '"]').click();
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, box3, { timeout: 5000 });
  await page.evaluate(() => window.__archTest.fmtAddLine());   // popup removed → toolbar ＋ 줄 추가
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  await page.waitForTimeout(300);
  S = await src();
  const after4 = await boxLines(S, box3);

  check("(C1) 3줄 → 4줄", after4.lines.length === 4, JSON.stringify(after4.lines.map((l) => l.text)));
  const donor = before3.lines[2], added = after4.lines[3];
  check("(C2) ★새 <text>가 이웃 줄의 스타일을 상속(font-size/weight/fill/anchor/x)",
    added.fs === donor.fs && added.weight === donor.weight && added.fill === donor.fill
    && added.anchor === donor.anchor && added.x === donor.x,
    JSON.stringify({ donor, added }));
  check("(C2b) 기본 스타일이 아님(속성 집합이 이웃과 동일)", added.attrs === donor.attrs, `${added.attrs} vs ${donor.attrs}`);
  check("(C2c) 기존 3줄의 텍스트·크기는 그대로(순서 보존)",
    after4.lines.slice(0, 3).every((l, i) => l.text === before3.lines[i].text && l.fs === before3.lines[i].fs));
  const fitAfter = blockFit(after4);
  check("(C3) ★네 줄 전부 도형 세로 범위 안(베이스라인 + 글자 상·하단까지)",
    fitAfter.inside && fitAfter.baselinesInside,
    JSON.stringify({ box: after4.box, ys: after4.lines.map((l) => l.y), top: fitAfter.top, bot: fitAfter.bot }));
  check("(C3b) ★텍스트 블록이 도형 세로 중앙(오차 ≤0.5u)", fitAfter.centerOffset <= 0.5, "offset=" + fitAfter.centerOffset.toFixed(2));
  check("(C3c) 줄 순서가 위→아래로 유지", fitAfter.ordered, JSON.stringify(after4.lines.map((l) => l.y)));
  check("(C3d) 단순 이어붙이기가 아님(기존 줄도 재배분됨)",
    after4.lines.slice(0, 3).some((l, i) => l.y !== before3.lines[i].y), JSON.stringify(after4.lines.map((l) => l.y)));
  const blC = await bleedClean(A0, S, box3);
  check("(C4) ★bleed-diff: 줄 추가가 그 박스만 변경(다른 단위 전부 바이트 동일)", blC.ok, JSON.stringify(blC));
  check("(C4b) 스냅샷이 4줄로 갱신됨(툴바 줄 컨트롤 반영)", (await page.evaluate((e) => window.__archTest.svgSnapshot(e).lines.length, box3)) === 4);   // popup removed 2026-07-21 → toolbar
  await page.screenshot({ path: path.join(ART, "s10_addline_toolbar.png"), clip: { x: 0, y: 60, width: 1500, height: 130 } });
  await page.evaluate(() => window.__archTest.setMode("edit")); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ART, "s10_box_after_4lines.png"), clip: BOX_CLIP });
  await page.keyboard.press("Meta+z").catch(() => {});
  await page.waitForTimeout(200);
  if ((await depth()) !== 0) { await page.click("#btn-undo"); await page.waitForTimeout(200); }
  check("(C5) undo 바이트 동일 복원", (await src()) === A0, "depth=" + (await depth()));

  // ==================== (D) 줄 삭제 ====================
  const rm = await page.evaluate((e) => window.__archTest.removeSvgLine(e, 1), box3);
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 6000 });
  await page.waitForTimeout(250);
  S = await src();
  const after2 = await boxLines(S, box3);
  check("(D1) 지목한 줄(2줄)만 사라짐 — 나머지 순서 유지", rm.ok && after2.lines.length === 2
    && after2.lines[0].text === before3.lines[0].text && after2.lines[1].text === before3.lines[2].text,
    JSON.stringify(after2.lines.map((l) => l.text)));
  const fitRm = blockFit(after2);
  check("(D2) 남은 줄이 재배분되어 도형 안 + 중앙", fitRm.inside && fitRm.centerOffset <= 0.5, JSON.stringify({ ys: after2.lines.map((l) => l.y), off: fitRm.centerOffset }));
  check("(D2b) 삭제도 단순 유지가 아니라 재배분", after2.lines[0].y !== before3.lines[0].y, JSON.stringify(after2.lines.map((l) => l.y)));
  const blD = await bleedClean(A0, S, box3);
  check("(D3) ★bleed-diff: 줄 삭제가 그 박스만 변경", blD.ok, JSON.stringify(blD));
  await page.click("#btn-undo");
  await page.waitForTimeout(250);
  check("(D4) undo 바이트 동일 복원", (await src()) === A0);

  // 0줄까지 삭제 허용 — 텍스트 없는 도형은 정당한 상태이고 패널·재선택이 살아 있어야 한다
  for (let i = 0; i < 3; i++) { await page.evaluate((e) => window.__archTest.removeSvgLine(e, 0), box3); await page.waitForTimeout(180); }
  const zero = await boxLines(await src(), box3);
  check("(D5) 마지막 한 줄까지 삭제 가능(0줄 허용)", zero.lines.length === 0, JSON.stringify(zero.lines));
  const zeroSnap = await page.evaluate((e) => window.__archTest.svgSnapshot(e), box3);
  check("(D5b) 0줄에서도 스냅샷이 살아 있음(주 라벨 없음 · text=\"\" · mainLine=-1)",
    zeroSnap.text === "" && zeroSnap.mainLine === -1 && zeroSnap.canAddLine === true, JSON.stringify({ t: zeroSnap.text, m: zeroSnap.mainLine }));
  await frame().locator('[data-arch-eid="' + box3 + '"]').click();
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, box3, { timeout: 5000 });
  // popup removed 2026-07-21 → toolbar: 0줄 박스도 선택되고 툴바 줄 컨트롤이 남아 '＋'가 활성(추가 가능)
  check("(D5c) 0줄 박스도 선택·툴바 줄 컨트롤 동작 — 줄 0개, '＋ 줄 추가' 활성",
    (await page.evaluate((e) => window.__archTest.svgSnapshot(e).lines.length, box3)) === 0
    && (await page.evaluate(() => window.__archTest.boxTools().lineboxVisible)) === true
    && (await page.evaluate(() => window.__archTest.boxTools().lineAddDisabled)) === false,
    "tools=" + JSON.stringify(await page.evaluate(() => window.__archTest.boxTools())));
  await page.evaluate(() => window.__archTest.fmtAddLine());   // popup removed → toolbar ＋
  await page.waitForTimeout(400);
  const reborn = await boxLines(await src(), box3);
  const fitReborn = blockFit(reborn);
  check("(D6) 0줄 박스에 다시 추가 → 도형에서 유도한 기본 스타일(가운데·읽을 수 있는 크기)",
    reborn.lines.length === 1 && reborn.lines[0].anchor === "middle"
    && reborn.lines[0].fs >= 10 && reborn.lines[0].fs <= 18
    && Math.abs(reborn.lines[0].x - (reborn.box.x0 + reborn.box.x1) / 2) < 0.6,
    JSON.stringify(reborn.lines));
  check("(D6b) 그 줄도 도형 중앙", fitReborn.inside && fitReborn.centerOffset <= 0.5, JSON.stringify(fitReborn));
  await undoAll();
  check("(D7) 전량 undo 후 원본 복원", (await src()) === A0);

  // ==================== (E) 비-rect 도형(다이아 polygon · 게이트 path) ====================
  const diaEid = snaps.find((s) => s.shape === "polygon" && s.n === 2).eid;
  const diaBefore = await boxLines(A0, diaEid);
  const addDia = await page.evaluate((e) => window.__archTest.addSvgLine(e, "추가 줄"), diaEid);
  await page.waitForTimeout(300);
  const diaAfter = await boxLines(await src(), diaEid);
  const fitDia = blockFit(diaAfter);
  check("(E1) 다이아(polygon)에 줄 추가 성공(크래시 없음)", addDia.ok && diaAfter.lines.length === diaBefore.lines.length + 1, JSON.stringify(addDia));
  check("(E1b) 다이아에서도 줄이 도형 bbox 안 + 중앙", fitDia.inside && fitDia.centerOffset <= 0.5,
    JSON.stringify({ box: diaAfter.box, ys: diaAfter.lines.map((l) => l.y) }));
  check("(E1c) bleed-diff 청결", (await bleedClean(A0, await src(), diaEid)).ok);
  await page.evaluate((e) => window.__archTest.removeSvgLine(e, 2), diaEid);
  await page.waitForTimeout(250);
  check("(E1d) 다이아에서 줄 삭제 → 원래 줄 수 · 도형 안 유지",
    (await boxLines(await src(), diaEid)).lines.length === diaBefore.lines.length
    && blockFit(await boxLines(await src(), diaEid)).inside);
  await undoAll();

  const gateEid = snaps.find((s) => s.shape === "path" && s.n === 1).eid;
  const gateBefore = await boxLines(A0, gateEid);
  const addGate = await page.evaluate((e) => window.__archTest.addSvgLine(e, "둘째"), gateEid);
  await page.waitForTimeout(300);
  const gateAfter = await boxLines(await src(), gateEid);
  check("(E2) 게이트(path)에 줄 추가 성공", addGate.ok && gateAfter.lines.length === gateBefore.lines.length + 1, JSON.stringify(addGate));
  check("(E2b) path 도형에서도 줄이 좌표 bbox 안", blockFit(gateAfter).inside,
    JSON.stringify({ box: gateAfter.box, ys: gateAfter.lines.map((l) => l.y) }));
  check("(E2c) bleed-diff 청결", (await bleedClean(A0, await src(), gateEid)).ok);
  await undoAll();
  check("(E3) 비-rect 편집 전량 undo 후 원본", (await src()) === A0);

  // ==================== (F) 넘침 정책 · 스코프 · 스키마 ====================
  const cap = await page.evaluate(async (e) => {
    const out = [];
    for (let i = 0; i < 3; i++) out.push(window.__archTest.addSvgLine(e, "줄" + i));
    return out;
  }, box3);
  check("(F1) ★넘침 정책 = 자라지 않고 거절 — 4줄까지 되고 5줄째는 이유와 함께 거부",
    cap[0].ok && !cap[1].ok && /가독 한계|높이/.test(cap[1].error || ""), JSON.stringify(cap.map((r) => [r.ok, (r.error || "").slice(0, 40)])));
  const capState = await boxLines(await src(), box3);
  check("(F1b) 거절 후에도 문서는 온전(4줄 유지 · 배치 정상)", capState.lines.length === 4 && blockFit(capState).inside);
  const rectAfterCap = await page.evaluate((e) => window.__archTest.svgShapeBox(e), box3);
  check("(F1c) ★거절 정책이라 도형 높이는 몰래 커지지 않음", rectAfterCap.y1 - rectAfterCap.y0 === (await boxLines(A0, box3)).box.y1, JSON.stringify(rectAfterCap));
  const canAdd = await page.evaluate((e) => window.__archTest.svgSnapshot(e).canAddLine, box3);
  check("(F1d) 툴바 '+' 버튼도 미리 잠김(canAddLine=false)", canAdd === false);
  await frame().locator('[data-arch-eid="' + box3 + '"]').click();
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, box3, { timeout: 5000 });
  // popup removed 2026-07-21 → toolbar: 꽉 찬 박스는 툴바 '＋' 버튼이 disabled + 높이 부족 사유를 title로
  check("(F1e) UI에도 반영: 툴바 '＋' disabled + 높이 부족 사유 표시",
    (await page.evaluate(() => window.__archTest.boxTools().lineAddDisabled)) === true
    && /높이|가독/.test(await page.getAttribute("#fmt-line-add", "title")),
    await page.getAttribute("#fmt-line-add", "title"));
  await undoAll();
  check("(F1f) 전량 undo 복원", (await src()) === A0);

  // 스코프: 다른 eid를 겨냥한 줄 op은 ScopeViolation
  const scopeErr = await page.evaluate((e) => {
    try { window.__archTest.svgSanitize({ ops: [{ op: "addTextLine", eid: "svgbox:99" }] }, e); return "no-throw"; }
    catch (err) { return err.name; }
  }, box3);
  check("(F2) 다른 eid의 줄 op = ScopeViolation", scopeErr === "ScopeViolation", scopeErr);
  const schemaPinned = await page.evaluate((e) => {
    const s = window.__archTest.svgSchema(e);
    const v = s.properties.ops.items.anyOf;
    const add = v.find((x) => x.properties.op.const === "addTextLine");
    const del = v.find((x) => x.properties.op.const === "removeTextLine");
    return { has: !!add && !!del, pinned: !!add && add.properties.eid.const === e && del.properties.eid.const === e,
             addReq: add && add.required.join(","), delReq: del && del.required.join(",") };
  }, box3);
  check("(F3) 스키마에 두 op 존재 + eid가 {const:eid}로 pin", schemaPinned.has && schemaPinned.pinned, JSON.stringify(schemaPinned));
  const sane = await page.evaluate((e) => window.__archTest.svgSanitize({ ops: [
    { op: "removeTextLine", eid: e, line: -3 },
    { op: "removeTextLine", eid: e, line: 1.5 },
    { op: "addTextLine", eid: e, afterIndex: -1 },
  ] }, e), box3);
  check("(F4) 잡값 제거: 음수·소수 줄 인덱스는 버리고, 잘못된 afterIndex는 맨 끝 추가로 강등",
    sane.ops.length === 1 && sane.ops[0].op === "addTextLine" && sane.ops[0].afterIndex === undefined && sane.notes.length === 3,
    JSON.stringify(sane));
  const oob = await page.evaluate((e) => window.__archTest.applySvgManual([{ op: "removeTextLine", eid: e, line: 99 }], e), box3);
  check("(F5) 범위 초과 삭제는 적용 실패 + 소스 무변형", !oob.ok && (await depth()) === 0 && (await src()) === A0, JSON.stringify(oob));

  // 선택 모드 mock(자연어) → 줄 op
  await setMode("select");
  await frame().locator('[data-arch-eid="' + box3 + '"]').click();
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 });
  await page.fill("#fi-text", "줄 하나 추가해줘");
  await page.click("#fi-run");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 8000 });
  check("(F6) 선택 mock: '줄 하나 추가해줘' → addTextLine 적용", (await boxLines(await src(), box3)).lines.length === 4);
  await undoAll();
  await frame().locator('[data-arch-eid="' + box3 + '"]').click();
  await page.waitForSelector("#floating-input:not([hidden])", { timeout: 5000 });
  await page.fill("#fi-text", "2줄 삭제해줘");
  await page.click("#fi-run");
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 8000 });
  const mockRm = await boxLines(await src(), box3);
  check("(F6b) 선택 mock: '2줄 삭제해줘' → 2번째 줄만 제거", mockRm.lines.length === 2
    && mockRm.lines[1].text === before3.lines[2].text, JSON.stringify(mockRm.lines.map((l) => l.text)));
  await undoAll();

  // ==================== (G) 다운로드 라운드트립 ====================
  await setMode("edit");
  await page.evaluate((e) => window.__archTest.addSvgLine(e, "라운드트립 줄"), box3);
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__archTest.openGlobalHeadBar());
  await page.evaluate(() => window.__archTest.runGlobalHead(2));
  await page.waitForSelector("#wd-confirm:not([hidden])", { timeout: 5000 });
  await page.click("#wd-confirm-apply");
  await page.waitForTimeout(400);
  const dl = await page.evaluate(() => window.__archTest.getClean());
  check("(G1) 다운로드본에 스크립트·오버레이 없음", !dl.includes("<script") && !dl.includes("data-arch-overlay"));
  check("(G1b) 줄 추가 + 전역 화살촉이 다운로드본에 반영", dl.includes("라운드트립 줄") && /markerWidth="20"/.test(dl) && /data-arch-head-scale="2"/.test(dl));
  await page.evaluate(async (h) => { await window.__archTest.load(h, "round.html"); }, dl);
  await page.waitForTimeout(500);
  const re = await boxLines(await src(), box3);
  const reMk = await page.evaluate(() => window.__archTest.getSvgMarkers());
  check("(G2) 재열기: 줄 4개 유지 + 도형 안", re.lines.length === 4 && blockFit(re).inside, JSON.stringify(re.lines.map((l) => l.y)));
  check("(G2b) 재열기: marker 3개가 2배 그대로(재스탬프·중복 없음)", reMk.length === 3 && reMk.every((m) => +m.markerWidth === 20));
  check("(G2c) 재열기 후 박스·화살표 stamp 개수 무회귀(32 / 42)",
    (await page.evaluate(() => window.__archTest.getSvgBoxes())).length === 32
    && (await page.evaluate(() => window.__archTest.getSvgEdges())).length === 42);
  const reScale = await page.evaluate(() => window.__archTest.markerInventory());
  check("(G2d) 재열기 후 전역 재조절이 누적되지 않음(배율 축이 원본 기준 절대값 2)",
    reScale.scales.length === 1 && reScale.scales[0] === 2, JSON.stringify(reScale));

  check("(z) 페이지 콘솔 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  예외: " + (err && err.stack ? err.stack : String(err)));
} finally {
  await browser.close();
  server.kill();
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}
