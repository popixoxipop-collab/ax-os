// Stage 11 — (1) D21 서식 툴바 + 다시 실행(redo), (2) D22 Cmd+클릭 다중 선택 + 일괄 수정.
//
// 검증 대상:
//   (A) 툴바 생명주기: 선택하면 뜨고 해제하면 사라진다. 접기/펼치기. 모드 전환 시 정리.
//   (B) 가용성(gating): 단위 종류별로 켜지는 항목이 다르고, **혼합 선택은 교집합**이다.
//       불가 항목은 사유가 붙는다. 의도적 제외(이미지·표·링크)는 비활성 + 사유.
//   (C) 각 항목이 **렌더 결과를 실제로 바꾸는가** — 속성만이 아니라 그려진 잉크/폭/좌표로 실증.
//       (굵게는 라틴/숫자 줄로 잰다: 한글 폴백 폰트는 800 실물 웨이트가 없어 합성되므로
//        폭 변화가 신뢰할 신호가 아니다 — 이 세션에서 실측으로 확인한 함정.)
//   (D) redo: 편집→undo→redo가 **바이트 동일** 복귀. 새 편집이 redo 가지를 자른다.
//       ⇧⌘Z가 **포커스가 iframe 안일 때** 동작(D17b 경로 — 부모 리스너만으론 원리적으로 불가).
//   (E) 다중 선택: Cmd+클릭으로 집합 3개 구성 → 색 한 번 = 3개 변경 + **undo 1회**.
//       ★ 불변식 일반화: 집합 S 밖의 모든 요소가 바이트 동일임을 테스트가 독립 재구현한 diff로 실증.
//       집합 밖 eid를 노린 op은 ScopeViolation. 단일 선택은 예전과 **똑같이** 엄격(스키마 const pin).
//   (F) class-b(p01 div 슬라이드) 무회귀 — 화이트리스트 밖 항목은 사유와 함께 비활성.
//
// 원칙(s6/s9/s10과 동일): bleed-diff는 앱 로직을 재사용하지 않고 테스트가 독립 DOMParser로
// 재구현한다(순환 방지). "됐다"는 주장은 속성이 아니라 렌더 실측으로 뒷받침한다.
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
const SVG_HTML = fs.readFileSync(path.join(APP_DIR, "demo_svg_slide.html"), "utf8");
const DOM_HTML = fs.readFileSync(path.join(APP_DIR, "p01_report_snapshot.html"), "utf8");

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
const vf = () => page.frames().find((f) => f !== page.mainFrame());
const src = () => page.evaluate(() => window.__archTest.getSource());
const depth = () => page.evaluate(() => window.__archTest.undoDepth());
const rdepth = () => page.evaluate(() => window.__archTest.redoDepth());
const caps = () => page.evaluate(() => window.__archTest.fmtCaps());
const selEids = () => page.evaluate(() => window.__archTest.getSelection().map((s) => s.eid));
const settle = (ms) => page.waitForTimeout(ms == null ? 420 : ms);

// ── 독립 bleed-diff (집합 축) ──
// (1) 집합 S의 모든 원소를 마스크로 치환한 문서 전체가 before==after,
// (2) S 밖의 모든 data-arch-eid 요소가 outerHTML 바이트 동일(S 원소의 조상은 (1)이 커버).
// 이게 D22가 요구한 "S 밖은 바이트 동일"의 기계적 정의다.
const bleedCleanSet = (a, b, eids) => page.evaluate(([ha, hb, es]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  const mask = (doc) => {
    es.forEach((e) => { const el = doc.querySelector('[data-arch-eid="' + e + '"]'); if (el) el.replaceWith(doc.createElement("arch-mask-test")); });
    return doc.documentElement.outerHTML;
  };
  const maskedEqual = mask(P(ha)) === mask(P(hb));
  const A = P(ha), B = P(hb);
  const units = es.map((e) => A.querySelector('[data-arch-eid="' + e + '"]')).filter(Boolean);
  const offenders = [];
  A.querySelectorAll("[data-arch-eid]").forEach((el) => {
    const k = el.getAttribute("data-arch-eid");
    if (es.includes(k)) return;
    if (units.some((u) => el.contains(u))) return;             // 조상 — 마스크 검사가 커버
    const elB = B.querySelector('[data-arch-eid="' + k + '"]');
    if (!elB || el.outerHTML !== elB.outerHTML) offenders.push(k);
  });
  return { ok: maskedEqual && offenders.length === 0, maskedEqual, offenders };
}, [a, b, eids]);

// 소스 HTML에서 박스의 줄 속성을 앱 코드 없이 독립 파싱.
// 자유 <text> 단위(svgtext:N)는 요소 자신이 곧 한 줄이다 — 박스처럼 자식을 훑으면 빈 배열이 나온다.
const lineAttrs = (html, eid) => page.evaluate(([h, e]) => {
  const g = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]');
  if (!g) return null;
  const rd = (t) => ({
    text: (t.textContent || "").trim(),
    size: t.getAttribute("font-size"), weight: t.getAttribute("font-weight"),
    style: t.getAttribute("font-style"), decor: t.getAttribute("text-decoration"),
    family: t.getAttribute("font-family"), track: t.getAttribute("letter-spacing"),
    anchor: t.getAttribute("text-anchor"), fill: t.getAttribute("fill"),
    x: parseFloat(t.getAttribute("x")), y: parseFloat(t.getAttribute("y")),
  });
  if (g.tagName.toLowerCase() === "text") return { shape: null, lines: [rd(g)] };
  const kids = [...g.children];
  const shape = kids.find((c) => ["rect", "polygon", "path", "ellipse", "circle"].includes(c.tagName.toLowerCase()));
  return {
    shape: shape ? { tag: shape.tagName.toLowerCase(), fill: shape.getAttribute("fill"), stroke: shape.getAttribute("stroke"), x: +(shape.getAttribute("x") || 0), y: +(shape.getAttribute("y") || 0), w: +(shape.getAttribute("width") || 0), h: +(shape.getAttribute("height") || 0) } : null,
    lines: kids.filter((c) => c.tagName.toLowerCase() === "text").map((t) => ({
      text: (t.textContent || "").trim(),
      size: t.getAttribute("font-size"), weight: t.getAttribute("font-weight"),
      style: t.getAttribute("font-style"), decor: t.getAttribute("text-decoration"),
      family: t.getAttribute("font-family"), track: t.getAttribute("letter-spacing"),
      anchor: t.getAttribute("text-anchor"), fill: t.getAttribute("fill"),
      x: parseFloat(t.getAttribute("x")), y: parseFloat(t.getAttribute("y")),
    })),
  };
}, [html, eid]);

// 렌더 실측: 뷰 프레임에서 실제로 그려진 텍스트 폭/바운딩박스를 읽는다.
const rendered = (eid) => vf().evaluate((e) => {
  const g = document.querySelector('[data-arch-eid="' + e + '"]');
  if (!g) return null;
  const isText = g.tagName.toLowerCase() === "text";
  const ts = isText ? [g] : [...g.children].filter((c) => c.tagName.toLowerCase() === "text");
  const r = g.querySelector ? g.querySelector("rect") : null;
  return {
    rect: r ? { x: +(r.getAttribute("x") || 0), w: +(r.getAttribute("width") || 0) } : null,
    lines: ts.map((t) => {
      const bb = t.getBBox();
      return {
        txt: (t.textContent || "").trim(),
        len: t.getComputedTextLength ? t.getComputedTextLength() : null,
        bx: bb.x, by: bb.y, bw: bb.width, bh: bb.height,
        weight: t.getAttribute("font-weight"), anchor: t.getAttribute("text-anchor"),
      };
    }),
  };
}, eid);

const clickBox = async (eid, mods) => {
  const opts = mods ? { modifiers: mods, force: true } : { force: true };
  await frame().locator('[data-arch-eid="' + eid + '"]').click(opts);
  await settle();
};

// ── D26: 텍스트 서식은 **인라인 편집 세션에서만** 적용된다(도형 선택이 아니라 편집 중인 글자에) ──
//   그래서 (C) 서식-적용 검증은 인라인 세션을 열고(simInlineStart) → 서식 클릭(pending 누적)
//   → 커밋(applyInlineCommit changed=false: 텍스트 무변경, pending만 flush)해 소스에 반영한다.
//   svgbox는 line 스코프라 그 줄만 바뀐다(이게 D26의 정밀도 개선). 실제 클릭 e2e는 s15가 검증.
const tfmt = async (eid, kind, line, applyEval) => {
  await page.evaluate(([e, k, l]) => window.__archTest.simInlineStart(e, k, l == null ? null : l, ""), [eid, kind, line]);
  await applyEval();
  await page.evaluate(() => window.__archTest.simInlineCommit(undefined, false));   // changed=false: pending 서식만 flush
  await settle(600);
};
// 인라인 세션이 열린 상태에서의 caps(그 kind의 텍스트 서브그룹이 어떻게 열리는지 = 능력 매트릭스).
const capsInline = async (eid, kind, line) => {
  await page.evaluate(([e, k, l]) => window.__archTest.simInlineStart(e, k, l == null ? null : l, ""), [eid, kind, line]);
  const c = await page.evaluate(() => window.__archTest.fmtCaps());
  await page.evaluate(() => window.__archTest.simInlineCancel());
  return c;
};

try {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready, { timeout: 20000 });
  await page.evaluate(async (h) => { await window.__archTest.load(h, "svg.html"); }, SVG_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, { timeout: 20000 });
  const A0 = await src();

  // ══════════ (A) 툴바 생명주기 ══════════
  check("(A1) 선택 전에는 서식 툴바가 숨김", !(await page.evaluate(() => window.__archTest.fmtBarShown())));
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await clickBox("svgbox:2");
  check("(A2) 요소를 선택하면 서식 툴바가 뜬다", await page.evaluate(() => window.__archTest.fmtBarShown()));
  check("(A3) 대상 배지가 선택 eid를 가리킴", (await page.evaluate(() => window.__archTest.fmtSelLabel())) === "svgbox:2");
  check("(A4) 모드 툴바는 그대로 살아 있다(서식은 별도 행)",
    (await page.locator("#mode-pill .mode").count()) === 6 && (await page.locator("#topbar").isVisible()));
  await page.screenshot({ path: path.join(ART, "s11_toolbar_single.png"), clip: { x: 300, y: 1120, width: 1520, height: 300 } });

  await page.evaluate(() => window.__archTest.fmtCollapse(true));
  await settle(200);
  const collapsed = await page.evaluate(() => ({ bar: window.__archTest.fmtBarShown(), c: window.__archTest.fmtCollapsed(), rows: document.getElementById("fmt-rows").hidden }));
  check("(A5) 접기: 바는 남고 두 줄은 접힘", collapsed.bar && collapsed.c && collapsed.rows, JSON.stringify(collapsed));
  await page.evaluate(() => window.__archTest.fmtCollapse(false));
  await settle(200);
  check("(A6) 펼치기 복귀", !(await page.evaluate(() => document.getElementById("fmt-rows").hidden)));

  await page.evaluate(() => window.__archTest.setMode("layout"));
  await settle(250);
  check("(A7) 광역 모드로 가면 서식 툴바가 사라진다", !(await page.evaluate(() => window.__archTest.fmtBarShown())));
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await settle(250);

  // ══════════ (B) 가용성(gating) ══════════
  // D26: 도형 선택(ON)에선 도형 컨트롤만 활성, 텍스트 컨트롤은 비활성. 텍스트 능력 매트릭스는 인라인에서 확인.
  await clickBox("svgbox:2");
  const capBox = await caps();
  check("(B1) SVG 박스 선택(ON): 도형 컨트롤(채움·테두리) 활성 · 텍스트 컨트롤은 비활성(D26: 인라인 편집에서만)",
    capBox.fill.ok && capBox.stroke.ok && !capBox.weight.ok && !capBox.align.ok && !capBox.gap.ok && !capBox.textcolor.ok
    && /편집 중인 글자|텍스트/.test(capBox.weight.why || ""),
    JSON.stringify({ fill: capBox.fill.ok, weight: capBox.weight.ok, align: capBox.align.ok, why: capBox.weight.why }));
  check("(B2) SVG 박스: 화살촉 크기는 불가 + 사유", !capBox.head.ok && /화살표/.test(capBox.head.why || ""), capBox.head.why);
  const capBoxInline = await capsInline("svgbox:2", "svgbox", 1);
  check("(B1i) 박스 인라인 편집 중: 정렬·줄간격·굵기·글자색이 전부 활성(그 줄에 적용)",
    capBoxInline.align.ok && capBoxInline.gap.ok && capBoxInline.weight.ok && capBoxInline.textcolor.ok,
    JSON.stringify(["align", "gap", "weight", "textcolor"].filter((k) => !capBoxInline[k].ok)));

  const txtEid = (await page.evaluate(() => window.__archTest.getSvgTexts().map((t) => t.eid)))[0];
  await clickBox(txtEid);
  const capTxt = await caps();
  check("(B3) 자유 텍스트 선택(ON): 도형 컨트롤 없음 + 텍스트 컨트롤은 인라인에서만 → 전부 비활성",
    !capTxt.textcolor.ok && !capTxt.weight.ok && !capTxt.align.ok && !capTxt.fill.ok
    && /편집 중인 글자|텍스트/.test(capTxt.textcolor.why || ""), capTxt.textcolor.why);
  const capTxtInline = await capsInline(txtEid, "svgtext", null);
  check("(B3i) 자유 텍스트 인라인 편집 중: 글자색·굵기 가능 · 정렬·줄간격은 기준 도형이 없어 불가 + 사유",
    capTxtInline.textcolor.ok && capTxtInline.weight.ok && !capTxtInline.align.ok && !capTxtInline.gap.ok
    && /기준 도형/.test(capTxtInline.align.why || ""), capTxtInline.align.why);

  const edgeEid = (await page.evaluate(() => window.__archTest.getSvgEdges().map((e) => e.eid)))[0];
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), edgeEid);
  await settle(250);
  const capEdge = await caps();
  check("(B4) 화살표: 화살촉 크기만 가능, 글자·색 계열 전부 불가",
    capEdge.head.ok && !capEdge.textcolor.ok && !capEdge.weight.ok && !capEdge.fill.ok, JSON.stringify({ head: capEdge.head.ok, tc: capEdge.textcolor.ok }));

  // 혼합 선택 = 교집합
  await clickBox("svgbox:2");
  await page.evaluate((e) => window.__archTest.selectByEid(e, true), edgeEid);
  await settle(250);
  const capMix = await caps();
  check("(B5) 혼합(박스+화살표): 공통 항목이 없어 서식 전부 비활성",
    !capMix.textcolor.ok && !capMix.fill.ok && !capMix.head.ok && !capMix.weight.ok,
    JSON.stringify({ tc: capMix.textcolor.ok, head: capMix.head.ok }));
  // D26: textcolor는 텍스트 서브그룹이라 인라인 게이트 사유가 먼저다. 혼합의 "종류 지목" 사유는
  //   selection 게이트를 그대로 쓰는 도형 컨트롤(fill)에서 확인한다(화살표는 채움이 없음).
  check("(B6) 혼합(박스+화살표): 도형 컨트롤 비활성 사유가 화살표를 지목", /화살표/.test(capMix.fill.why || ""), capMix.fill.why);
  const domDisabled = await page.evaluate(() => ({
    color: document.getElementById("fmt-textcolor").disabled,
    head: document.getElementById("fmt-head").disabled,
    bold: document.getElementById("fmt-bold").disabled,
    boldOn: document.getElementById("fmt-bold").classList.contains("on"),
  }));
  check("(B7) DOM 상태도 실제로 disabled (켜짐 표시도 지워짐)",
    domDisabled.color && domDisabled.head && domDisabled.bold && !domDisabled.boldOn, JSON.stringify(domDisabled));
  await page.evaluate(() => document.getElementById("fmt-inspect").click());
  await settle(250);
  await page.screenshot({ path: path.join(ART, "s11_toolbar_mixed_disabled.png"), clip: { x: 300, y: 1020, width: 1520, height: 400 } });
  const inspectTxt = await page.locator("#fmt-inspect-panel").innerText();
  check("(B8) ⓘ 선택 정보에 비활성 사유·줄 단위 한계가 적혀 있다",
    /비활성/.test(inspectTxt) && /줄/.test(inspectTxt) && inspectTxt.includes(edgeEid), inspectTxt.slice(0, 120));
  await page.evaluate(() => document.getElementById("fmt-inspect").click());

  // D35/D36/D37: 이미지·표·링크는 이제 실동작 버튼이다(D21의 '의도적 제외' 해제). 제외 버튼(.excluded)은
  //   0개여야 하고, 이미지·표는 즉시 클릭 가능(그리기 진입), 링크는 존재한다(활성화는 인라인 세션에 게이트).
  const activated = await page.evaluate(() => {
    const excludedCount = document.querySelectorAll("#fmt-bar .fmt-btn.excluded").length;
    const pick = (id) => { const b = document.getElementById(id); return b ? { id, excluded: b.classList.contains("excluded"), disabled: b.disabled } : null; };
    return { excludedCount, image: pick("fmt-image"), table: pick("fmt-table"), link: pick("fmt-link") };
  });
  check("(B9) 이미지·표·링크가 활성 버튼으로 전환됨(.excluded 0개, 이미지·표 즉시 클릭 가능)",
    activated.excludedCount === 0 &&
    activated.image && !activated.image.excluded && activated.image.disabled === false &&
    activated.table && !activated.table.excluded && activated.table.disabled === false &&
    activated.link && !activated.link.excluded, JSON.stringify(activated));

  // ══════════ (C) 서식이 실제 렌더를 바꾸는가 (D26: 인라인 세션에서 그 줄에 적용) ══════════
  //   OLD: 도형을 선택하고 서식을 눌러 박스 전체 줄에 적용. NEW(D26): 텍스트 서식은 인라인 편집
  //   세션에서만 → **편집 중인 그 줄**에만 적용된다(정밀도↑). 그래서 tfmt(줄 인덱스)로 검증한다.
  await clickBox("svgbox:2");
  const attr0 = await lineAttrs(await src(), "svgbox:2");
  const rend0 = await rendered("svgbox:2");
  const Tf = rend0.lines.findIndex((l) => /[A-Za-z0-9]/.test(l.txt));   // 라틴/숫자 줄(폭 변화가 뚜렷)
  const T = Tf >= 0 ? Tf : 0;
  const M = attr0.lines.reduce((mi, l, i, a) => (parseFloat(l.size) > parseFloat(a[mi].size) ? i : mi), 0);  // 주 라벨(최대 폰트) 줄
  const other = attr0.lines.length > 1 ? (T === 0 ? 1 : 0) : 0;    // T가 아닌 다른 줄(굵기 정밀도 대조)
  const otherM = attr0.lines.length > 1 ? (M === 0 ? 1 : 0) : 0;   // M(주 라벨)이 아닌 다른 줄(크기 정밀도 대조)

  // 굵게 — 그 줄의 font-weight + 렌더 폭
  const beforeBold = rend0;
  await tfmt("svgbox:2", "svgbox", T, () => page.evaluate(() => window.__archTest.fmtBold()));   // 800 → 400
  const afterNormal = await rendered("svgbox:2");
  let attrN = await lineAttrs(await src(), "svgbox:2");
  check("(C1) 굵게 해제: 그 줄 font-weight가 400", attrN.lines[T].weight === "400", attrN.lines[T].weight);
  check("(C1b) 굵게 해제: 그 줄의 **렌더 폭이 실제로 줄어든다**",
    afterNormal.lines[T].len < beforeBold.lines[T].len, `len ${beforeBold.lines[T].len} → ${afterNormal.lines[T].len}`);
  check("(C1c) ★ 다른 줄은 굵기 불변(줄 스코프 정밀도)",
    attr0.lines.length < 2 || attrN.lines[other].weight === attr0.lines[other].weight,
    `other ${attr0.lines[other] && attr0.lines[other].weight} → ${attrN.lines[other] && attrN.lines[other].weight}`);
  await tfmt("svgbox:2", "svgbox", T, () => page.evaluate(() => window.__archTest.fmtBold()));   // 400 → 문서 유래(800)
  const afterBold = await rendered("svgbox:2");
  let attrB = await lineAttrs(await src(), "svgbox:2");
  check("(C2) 다시 굵게: 문서에서 유도한 굵기(800) 복귀 + 렌더 폭 회복",
    attrB.lines[T].weight === "800" && afterBold.lines[T].len > afterNormal.lines[T].len,
    `w=${attrB.lines[T].weight} len ${afterNormal.lines[T].len} → ${afterBold.lines[T].len}`);

  // 기울임 / 밑줄 / 취소선 (그 줄)
  await tfmt("svgbox:2", "svgbox", T, () => page.evaluate(() => window.__archTest.fmtItalic()));
  let at = await lineAttrs(await src(), "svgbox:2");
  check("(C3) 기울임: 그 줄 font-style=italic", at.lines[T].style === "italic", at.lines[T].style);
  await tfmt("svgbox:2", "svgbox", T, () => page.evaluate(() => window.__archTest.fmtDecor("u")));
  at = await lineAttrs(await src(), "svgbox:2");
  check("(C4) 밑줄: 그 줄 text-decoration=underline", at.lines[T].decor === "underline", at.lines[T].decor);
  await tfmt("svgbox:2", "svgbox", T, () => page.evaluate(() => window.__archTest.fmtDecor("s")));
  at = await lineAttrs(await src(), "svgbox:2");
  check("(C5) 취소선 추가: 밑줄과 **공존**(underline line-through)", at.lines[T].decor === "underline line-through", at.lines[T].decor);
  await tfmt("svgbox:2", "svgbox", T, () => page.evaluate(() => window.__archTest.fmtDecor("u")));
  at = await lineAttrs(await src(), "svgbox:2");
  check("(C6) 밑줄만 해제: line-through는 남는다", at.lines[T].decor === "line-through", at.lines[T].decor);

  // 정렬 — 그 줄 text-anchor + x 재계산, 도형 안 유지
  const preAlign = await lineAttrs(await src(), "svgbox:2");
  const box = preAlign.shape;
  await tfmt("svgbox:2", "svgbox", T, () => page.evaluate(() => window.__archTest.fmtAlign("start")));
  const aStart = await lineAttrs(await src(), "svgbox:2");
  const rStart = await rendered("svgbox:2");
  check("(C7) 정렬(왼쪽): 그 줄 text-anchor=start + x가 도형 안쪽으로 재계산",
    aStart.lines[T].anchor === "start" && aStart.lines[T].x > box.x && aStart.lines[T].x < box.x + box.w && aStart.lines[T].x !== preAlign.lines[T].x,
    `x ${preAlign.lines[T].x} → ${aStart.lines[T].x} (rect ${box.x}..${box.x + box.w})`);
  check("(C7b) 정렬(왼쪽) 후에도 **그 줄의 그려진 글자가 도형 안**",
    rStart.lines[T].bx >= box.x - 0.5 && rStart.lines[T].bx + rStart.lines[T].bw <= box.x + box.w + 0.5,
    JSON.stringify([Math.round(rStart.lines[T].bx), Math.round(rStart.lines[T].bx + rStart.lines[T].bw)]) + " in " + box.x + ".." + (box.x + box.w));
  await tfmt("svgbox:2", "svgbox", T, () => page.evaluate(() => window.__archTest.fmtAlign("end")));
  const aEnd = await lineAttrs(await src(), "svgbox:2");
  const rEnd = await rendered("svgbox:2");
  check("(C8) 정렬(오른쪽): 그 줄 anchor=end + x가 오른쪽 안쪽",
    aEnd.lines[T].anchor === "end" && aEnd.lines[T].x > aStart.lines[T].x, `x ${aStart.lines[T].x} → ${aEnd.lines[T].x}`);
  check("(C8b) 정렬(오른쪽) 후에도 그 줄의 그려진 글자가 도형 안",
    rEnd.lines[T].bx >= box.x - 0.5 && rEnd.lines[T].bx + rEnd.lines[T].bw <= box.x + box.w + 0.5,
    JSON.stringify([Math.round(rEnd.lines[T].bx), Math.round(rEnd.lines[T].bx + rEnd.lines[T].bw)]));
  check("(C8c) 정렬만 바꿔도 앵커 이동으로 그 줄 x가 실제로 이동", Math.abs(aEnd.lines[T].x - aStart.lines[T].x) > 1);
  await tfmt("svgbox:2", "svgbox", T, () => page.evaluate(() => window.__archTest.fmtAlign("middle")));

  // 글자 크기 — 그 줄(주 라벨)만 절대값(D26 줄 스코프: 비율 전파 대신 그 줄만) + 다른 줄 불변
  const preSize = await lineAttrs(await src(), "svgbox:2");
  const preSizeR = await rendered("svgbox:2");
  await tfmt("svgbox:2", "svgbox", M, () => page.evaluate(() => window.__archTest.fmtSize(22)));
  const postSize = await lineAttrs(await src(), "svgbox:2");
  const postSizeR = await rendered("svgbox:2");
  check("(C9) 글자 크기: 그 줄(주 라벨)이 요청 값(22)", parseFloat(postSize.lines[M].size) === 22, JSON.stringify(postSize.lines.map((l) => l.size)));
  check("(C9b) ★ 다른 줄 크기는 불변(줄 스코프 — 비율 전파 없이 그 줄만)",
    preSize.lines.length < 2 || parseFloat(postSize.lines[otherM].size) === parseFloat(preSize.lines[otherM].size),
    `otherM ${preSize.lines[otherM] && preSize.lines[otherM].size} → ${postSize.lines[otherM] && postSize.lines[otherM].size}`);
  check("(C9c) 그 줄 렌더 폭이 실제로 커진다", postSizeR.lines[M].len > preSizeR.lines[M].len * 1.3,
    `len ${preSizeR.lines[M].len.toFixed(1)} → ${postSizeR.lines[M].len.toFixed(1)}`);
  await tfmt("svgbox:2", "svgbox", M, () => page.evaluate(() => window.__archTest.fmtSize(14)));

  // 자간 — 그 줄 속성 + 렌더 폭 증가
  const preTrackR = await rendered("svgbox:2");
  await tfmt("svgbox:2", "svgbox", T, () => page.evaluate(() => window.__archTest.fmtTrack(3)));
  const trackAttr = await lineAttrs(await src(), "svgbox:2");
  const postTrackR = await rendered("svgbox:2");
  check("(C10) 자간: 그 줄 letter-spacing 속성 기록", trackAttr.lines[T].track === "3", trackAttr.lines[T].track);
  check("(C10b) 자간: 그 줄 렌더 폭이 실제로 늘어난다", postTrackR.lines[T].len > preTrackR.lines[T].len + 3,
    `len ${preTrackR.lines[T].len.toFixed(1)} → ${postTrackR.lines[T].len.toFixed(1)}`);
  await tfmt("svgbox:2", "svgbox", T, () => page.evaluate(() => window.__archTest.fmtTrack(0)));

  // 줄간격 — 박스 레벨(그 줄 세션이라도 setLineSpacing은 박스 전체). 축소 적용 + 넘침 확대 거절.
  const preGap = await lineAttrs(await src(), "svgbox:2");
  const gap0 = preGap.lines[1].y - preGap.lines[0].y;
  await tfmt("svgbox:2", "svgbox", T, () => page.evaluate(() => window.__archTest.fmtGap(1.05)));
  const tightGap = await lineAttrs(await src(), "svgbox:2");
  const gap1 = tightGap.lines[1].y - tightGap.lines[0].y;
  check("(C11) 줄간격: 축소가 baseline 간격에 실제로 반영된다", gap1 < gap0 - 1, `gap ${gap0.toFixed(1)} → ${gap1.toFixed(1)}`);
  const srcBeforeOver = await src();
  await tfmt("svgbox:2", "svgbox", T, () => page.evaluate(() => window.__archTest.fmtGap(2.2)));
  const overMsg = await page.evaluate(() => { const t = document.querySelector("#toast, .toast, [data-toast]"); return t ? t.textContent.trim() : ""; });
  check("(C11b) 도형에 안 들어가는 확대는 거절 + 사유 표시(조용한 무시 아님)",
    /들어가지 않|높이|거절/.test(overMsg) && (await src()) === srcBeforeOver, overMsg);
  const inShape = tightGap.lines.every((l) => l.y > tightGap.shape.y && l.y < tightGap.shape.y + tightGap.shape.h);
  check("(C11c) 줄간격 변경 후에도 모든 줄이 도형 세로 범위 안", inShape, JSON.stringify(tightGap.lines.map((l) => l.y)) + " in " + tightGap.shape.y + ".." + (tightGap.shape.y + tightGap.shape.h));

  // 글자색(그 줄) / 도형 채움·테두리(도형 컨트롤 — D26에서 selection 게이트 그대로)
  await tfmt("svgbox:2", "svgbox", T, () => page.evaluate(() => window.__archTest.fmtTextColor("#e11d48")));
  at = await lineAttrs(await src(), "svgbox:2");
  check("(C12) 글자색: 그 줄의 text fill 변경", at.lines[T].fill === "#e11d48", at.lines[T].fill);
  await clickBox("svgbox:2");   // 도형 컨트롤은 선택 기반 — 다시 선택
  await page.evaluate(() => window.__archTest.fmtFill("#fef3c7"));
  await settle(550);
  at = await lineAttrs(await src(), "svgbox:2");
  check("(C13) 도형 채움: rect fill 변경(도형 컨트롤·선택 기반, 글자 fill과 별개 축)", at.shape.fill === "#fef3c7" && at.lines[T].fill === "#e11d48", at.shape.fill);
  await page.evaluate(() => window.__archTest.fmtStroke("#7c3aed"));
  await settle(550);
  at = await lineAttrs(await src(), "svgbox:2");
  check("(C14) 테두리: rect stroke 변경(도형 컨트롤)", at.shape.stroke === "#7c3aed", at.shape.stroke);

  // 글꼴 — 그 줄(제네릭 monospace로 렌더 폭 변화까지)
  const preFontR = await rendered("svgbox:2");
  await tfmt("svgbox:2", "svgbox", T, () => page.evaluate(() => window.__archTest.fmtFont("monospace")));
  at = await lineAttrs(await src(), "svgbox:2");
  const postFontR = await rendered("svgbox:2");
  check("(C15) 글꼴: 그 줄 font-family 속성 기록", at.lines[T].family === "monospace", at.lines[T].family);
  check("(C15b) 글꼴 변경이 그 줄 렌더 폭에도 반영",
    Math.abs(postFontR.lines[T].len - preFontR.lines[T].len) > 0.5,
    `len ${preFontR.lines[T].len.toFixed(2)} → ${postFontR.lines[T].len.toFixed(2)}`);

  // 프리셋 — 문서에서 유도한 값(그 줄에 적용)
  const ts = await page.evaluate(() => window.__archTest.typeScale());
  check("(C16) 텍스트 프리셋이 **문서의 실제 글자 크기 분포**에서 유도됨(임의 상수 아님)",
    ts && ts.n > 20 && ts.presets.length === 3 && ts.presets[0].fontSize >= ts.presets[1].fontSize && ts.presets[1].fontSize >= ts.presets[2].fontSize,
    JSON.stringify(ts && ts.presets));
  await tfmt("svgbox:2", "svgbox", M, () => page.evaluate(() => window.__archTest.fmtPreset("caption")));
  at = await lineAttrs(await src(), "svgbox:2");
  check("(C17) 프리셋(캡션) 적용: 그 줄(주 라벨) 크기가 프리셋 값", parseFloat(at.lines[M].size) === ts.presets[2].fontSize,
    at.lines[M].size + " vs " + ts.presets[2].fontSize);

  // 화살촉 크기 (화살표 전용)
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), edgeEid);
  await settle(300);
  await page.evaluate(() => window.__archTest.fmtHead(2.5));
  await settle(650);
  const headSnap = await page.evaluate((e) => window.__archTest.svgEdgeSnapshot(e), edgeEid);
  check("(C18) 화살촉 크기: 그 화살표 전용 marker 클론으로 배율 적용",
    Math.abs(headSnap.headScale - 2.5) < 0.01 && /--svgedge-/.test(headSnap.markerEnd || ""),
    JSON.stringify({ s: headSnap.headScale, m: headSnap.markerEnd }));

  // 텍스트 상자 추가 → 기존 그리기 경로
  await page.evaluate(() => document.getElementById("fmt-textbox").click());
  await settle(350);
  const drawState = await page.evaluate(() => ({ mode: window.__archTest.getMode(), palette: !document.getElementById("draw-palette").hidden }));
  check("(C19) 텍스트 상자 추가 = 기존 그리기 모드로 라우팅(중복 삽입 로직 없음)",
    drawState.mode === "draw" && drawState.palette, JSON.stringify(drawState));
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await settle(300);

  // ══════════ (D) 다시 실행(redo) ══════════
  await page.evaluate(async (h) => { await window.__archTest.load(h, "svg.html"); }, SVG_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, { timeout: 20000 });
  const D0 = await src();
  check("(D0) 재로드로 기준 상태 복귀 + 스택 비움", D0 === A0 && (await depth()) === 0 && (await rdepth()) === 0);

  await page.evaluate(() => window.__archTest.setMode("edit"));
  await clickBox("svgbox:5");
  await page.evaluate(() => window.__archTest.fmtFill("#22c55e"));
  await settle(650);
  const D1 = await src();
  check("(D1) 편집 1회 → undo 1 / redo 0", D1 !== D0 && (await depth()) === 1 && (await rdepth()) === 0);
  await page.evaluate(() => window.__archTest.undo());
  await settle(550);
  check("(D2) undo: 바이트 동일 복원 + redo 가지 1", (await src()) === D0 && (await depth()) === 0 && (await rdepth()) === 1,
    `u=${await depth()} r=${await rdepth()}`);
  await page.evaluate(() => window.__archTest.redo());
  await settle(550);
  check("(D3) redo: **편집 결과가 바이트 동일하게 재적용**", (await src()) === D1 && (await depth()) === 1 && (await rdepth()) === 0,
    `u=${await depth()} r=${await rdepth()}`);

  // 새 편집이 redo 가지를 자른다
  await page.evaluate(() => window.__archTest.undo());
  await settle(500);
  check("(D4) undo 후 redo 대기 1건", (await rdepth()) === 1);
  await clickBox("svgbox:6");
  await page.evaluate(() => window.__archTest.fmtFill("#3b82f6"));
  await settle(650);
  check("(D5) 새 편집이 들어오면 **redo 가지가 잘린다**", (await rdepth()) === 0 && (await depth()) === 1, `r=${await rdepth()} u=${await depth()}`);
  const redoBtnState = await page.evaluate(() => ({ top: document.getElementById("btn-redo").disabled, bar: document.getElementById("fmt-redo").disabled }));
  check("(D6) redo 버튼이 비활성으로 동기화", redoBtnState.top && redoBtnState.bar, JSON.stringify(redoBtnState));

  // ★ D17b 경로: 포커스가 iframe 안일 때의 ⌘Z / ⇧⌘Z
  await clickBox("svgbox:7");
  await page.evaluate(() => window.__archTest.fmtFill("#f59e0b"));
  await settle(650);
  const K1 = await src(); const ku1 = await depth();
  await clickBox("svgbox:8");                       // 뷰 안을 클릭 → 포커스가 iframe으로
  await page.keyboard.press("Escape");
  await settle(300);
  const focusIn = await page.evaluate(() => (document.activeElement && document.activeElement.id) || "");
  check("(D7) 뷰 클릭 후 포커스가 iframe에 있다(부모 keydown이 안 오는 조건 재현)", focusIn === "diagram-frame", "activeElement=" + focusIn);
  // ★ 경합 방지: undo/redo는 iframe 재렌더를 유발하고, 재렌더 중(ready=false)에는 단축키가
  // 무시된다. 고정 sleep으로는 드물게 앞질러 눌러 flaky해지므로(실측: u=1 r=1로 간헐 실패),
  // 매 키 입력 전에 "재렌더 완료(ready=true)"를 조건 대기한다. 대기 실패도 삼키지 않는다.
  const idle = () => page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 8000 });
  await idle();
  await page.keyboard.press("Meta+z");
  await page.waitForFunction((d) => window.__archTest.undoDepth() === d - 1, ku1, { timeout: 8000 });
  await idle();
  const afterKeyUndo = await src();
  check("(D8) ⌘Z가 iframe 포커스에서도 동작(기존 D17b 경로 무회귀)", afterKeyUndo !== K1 && (await depth()) === ku1 - 1, `u=${await depth()}`);
  await page.keyboard.press("Meta+Shift+z");
  await page.waitForFunction((d) => window.__archTest.undoDepth() === d, ku1, { timeout: 8000 });
  await idle();
  check("(D9) ★⇧⌘Z(다시 실행)가 **iframe 포커스에서** 동작 — 바이트 동일 재적용",
    (await src()) === K1 && (await depth()) === ku1 && (await rdepth()) === 0, `u=${await depth()} r=${await rdepth()}`);
  const stillFocused = await page.evaluate(() => (document.activeElement && document.activeElement.id) || "");
  check("(D9b) 그 동안 포커스는 계속 iframe (부모 리스너만으론 불가능한 경로였음)", stillFocused === "diagram-frame", stillFocused);

  // 입력창 포커스 중에는 양보(기존 규칙이 redo에도 동일 적용)
  // ★ 팝업 폐지(2026-07-21): 구 패널 입력(#sp-text) 대신 툴바 입력(#fmt-textcolor)에 포커스 —
  //   부모 keydown의 inField(INPUT) 양보 규칙은 동일하게 적용된다.
  await clickBox("svgbox:2");
  await page.waitForFunction(() => { const s = window.__archTest.getSelected(); return s && s.eid === "svgbox:2"; }, null, { timeout: 5000 }).catch(() => {});
  const beforeYield = await src(); const duY = await depth();
  await page.focus("#fmt-textcolor").catch(() => {});
  await page.keyboard.press("Meta+Shift+z");
  await settle(450);
  check("(D10) 입력창 포커스 중엔 ⇧⌘Z도 브라우저에 양보", (await src()) === beforeYield && (await depth()) === duY);
  await page.keyboard.press("Escape");
  await settle(250);

  // ══════════ (E) 다중 선택 + 일괄 수정 + 불변식 일반화 ══════════
  await page.evaluate(async (h) => { await window.__archTest.load(h, "svg.html"); }, SVG_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, { timeout: 20000 });
  const E0 = await src();
  await page.evaluate(() => window.__archTest.setMode("select"));
  await settle(250);

  await clickBox("svgbox:2");
  check("(E1) 평범한 클릭 = 단일 선택(기존 동작)", (await selEids()).length === 1);
  await clickBox("svgbox:3", ["Meta"]);
  check("(E2) Cmd+클릭으로 두 번째 요소 추가", JSON.stringify(await selEids()) === JSON.stringify(["svgbox:2", "svgbox:3"]), JSON.stringify(await selEids()));
  const freeText = (await page.evaluate(() => window.__archTest.getSvgTexts().map((t) => t.eid)))[0];
  await clickBox(freeText, ["Meta"]);
  const S3 = await selEids();
  check("(E3) 박스 2 + 자유 텍스트 1 = 집합 3개", S3.length === 3 && S3[2] === freeText, JSON.stringify(S3));
  check("(E4) 배지가 혼합 구성을 표기", /3개 선택/.test(await page.evaluate(() => window.__archTest.fmtSelLabel())), await page.evaluate(() => window.__archTest.fmtSelLabel()));

  // 오버레이가 세 개 다 보이는가 (주 선택 1 + msel 2)
  const overlays = await page.evaluate(() => {
    const f = document.getElementById("diagram-frame");
    return null; // (아래 프레임 조회로 대체)
  });
  const ovCount = await vf().evaluate(() => {
    const vis = (el) => getComputedStyle(el).display !== "none";
    return {
      sel: [...document.querySelectorAll('[data-arch-overlay="sel"]')].filter(vis).length,
      msel: [...document.querySelectorAll('[data-arch-overlay="msel"]')].filter(vis).length,
    };
  });
  check("(E5) 선택 오버레이가 집합 전체를 그린다(주 1 + 나머지 2)", ovCount.sel + ovCount.msel === 3, JSON.stringify(ovCount));

  await page.screenshot({ path: path.join(ART, "s11_multiselect_before.png"), clip: { x: 0, y: 120, width: 2120, height: 900 } });

  // ★ D26: 텍스트 서식(글자색)은 인라인 단일 대상 전용 → 다중-배치 대상이 아니다. 배치 불변식
  //   "한 번의 조작 = N개 변경 + undo 1회"는 도형 컨트롤(채움 fill, selection 게이트 유지)로 검증한다.
  const dBefore = await depth();
  const beforeBatch = await src();
  await page.evaluate(() => window.__archTest.fmtFill("#fde68a"));
  await settle(800);
  const afterBatch = await src();
  const batchBoxes = S3.filter((e) => /^svgbox:/.test(e));
  const changed = [];
  for (const e of batchBoxes) {
    const a = await lineAttrs(beforeBatch, e), b = await lineAttrs(afterBatch, e);
    changed.push({ eid: e, before: a.shape.fill, after: b.shape.fill });
  }
  check("(E6) ★ 한 번의 도형 채움 변경이 **선택된 SVG 박스 모두**에 적용(배치)",
    batchBoxes.length >= 2 && changed.every((c) => c.after === "#fde68a") && changed.every((c) => c.before !== c.after),
    JSON.stringify(changed));
  check("(E7) ★ 배치 전체가 **undo 1회**로 묶임", (await depth()) === dBefore + 1, `depth ${dBefore} → ${await depth()}`);
  await page.screenshot({ path: path.join(ART, "s11_multiselect_after.png"), clip: { x: 0, y: 120, width: 2120, height: 900 } });

  // ★ 불변식 일반화: 집합 밖 전부 바이트 동일
  const bleed = await bleedCleanSet(beforeBatch, afterBatch, S3);
  check("(E8) ★★ bleed-diff(집합): S 밖의 모든 요소가 바이트 동일",
    bleed.ok, JSON.stringify(bleed).slice(0, 220));

  // undo 1회로 3개 전부 복구
  await page.evaluate(() => window.__archTest.undo());
  await settle(600);
  check("(E9) undo 한 번으로 3개가 통째로 복구(바이트 동일)", (await src()) === beforeBatch, "");
  await page.evaluate(() => window.__archTest.redo());
  await settle(600);
  check("(E10) redo 한 번으로 배치 재적용(바이트 동일)", (await src()) === afterBatch, "");

  // 토글로 빼기
  await page.evaluate(() => window.__archTest.setMode("select"));
  await settle(250);
  await clickBox("svgbox:2");
  await clickBox("svgbox:3", ["Meta"]);
  await clickBox("svgbox:3", ["Meta"]);
  check("(E11) 같은 요소 Cmd+클릭 = 집합에서 제거(토글)", JSON.stringify(await selEids()) === JSON.stringify(["svgbox:2"]), JSON.stringify(await selEids()));
  await clickBox("svgbox:3", ["Meta"]);
  await page.keyboard.press("Escape");
  await settle(400);
  check("(E12) Escape로 집합 전체 해제 + 툴바 숨김",
    (await selEids()).length === 0 && !(await page.evaluate(() => window.__archTest.fmtBarShown())), JSON.stringify(await selEids()));

  // 빈 캔버스 클릭도 해제
  await clickBox("svgbox:2");
  await clickBox("svgbox:3", ["Meta"]);
  const stage = await page.locator("#stage").boundingBox();
  await page.mouse.click(stage.x + 12, stage.y + stage.height - 12);
  await settle(450);
  check("(E13) 빈 캔버스 클릭으로도 집합 해제", (await selEids()).length === 0, JSON.stringify(await selEids()));

  // ══════════ (G) 스코프/스키마 보증 (단일=집합 크기 1) ══════════
  await page.evaluate(() => window.__archTest.setMode("select"));
  await clickBox("svgbox:2");
  await clickBox("svgbox:3", ["Meta"]);
  const setNow = await selEids();
  const outside = await page.evaluate(([s], ) => {
    const all = window.__archTest.getSvgBoxes().map((b) => b.eid);
    return all.find((e) => !s.includes(e));
  }, [setNow]);
  const scopeRes = await page.evaluate(([e]) => window.__archTest.sanitizeBatchRaw([{ op: "setFill", eid: e, color: "#000000" }], window.__archTest.getSelection().map((s) => s.eid)), [outside]);
  check("(G1) ★ 집합 밖 eid를 노린 op = ScopeViolation", scopeRes.ok === false && scopeRes.name === "ScopeViolation", JSON.stringify(scopeRes));
  const commitRes = await page.evaluate(([e]) => window.__archTest.commitFormatRaw([{ op: "setFill", eid: e, color: "#000000" }], "위반 시도"), [outside]);
  check("(G2) 커밋 경로도 같은 게이트로 차단(적용 안 됨)", commitRes.ok === false && commitRes.name === "ScopeViolation", JSON.stringify(commitRes));
  const okRes = await page.evaluate(() => window.__archTest.sanitizeBatchRaw(
    window.__archTest.getSelection().map((s) => ({ op: "setFill", eid: s.eid, color: "#0ea5e9" })),
    window.__archTest.getSelection().map((s) => s.eid)));
  check("(G3) 집합 안 op은 전부 통과", okRes.ok && okRes.ops.length === 2, JSON.stringify(okRes).slice(0, 160));

  // 스키마 pin: 단일=const(예전 그대로), 다중=enum(집합 밖은 표현 불가)
  const schema1 = await page.evaluate(() => window.__archTest.batchSchema(["svgbox:2"]));
  const pinsSingle = schema1.properties.ops.items.anyOf.filter((v) => v.properties.eid);
  check("(G4) ★ 단일 선택 스키마는 예전과 동일하게 {const: eid}",
    pinsSingle.length > 0 && pinsSingle.every((v) => v.properties.eid.const === "svgbox:2"),
    JSON.stringify(pinsSingle.map((v) => v.properties.eid)).slice(0, 140));
  const schema3 = await page.evaluate((s) => window.__archTest.batchSchema(s), setNow.concat([freeText]));
  const tsVariant = schema3.properties.ops.items.anyOf.find((v) => v.properties.op.const === "setTextStyle");
  check("(G5) ★ 다중 선택 스키마의 id pin이 {enum: S}로 일반화",
    tsVariant && Array.isArray(tsVariant.properties.eid.enum) && tsVariant.properties.eid.enum.length === 3,
    JSON.stringify(tsVariant && tsVariant.properties.eid));
  const allPinned = schema3.properties.ops.items.anyOf.filter((v) => v.properties.eid)
    .every((v) => {
      const p = v.properties.eid;
      const list = p.enum || [p.const];
      return list.every((e) => setNow.concat([freeText]).includes(e));
    });
  check("(G6) ★ 스키마의 어떤 분기도 집합 밖 eid를 표현할 수 없다", allPinned);
  const headVariant = schema3.properties.ops.items.anyOf.find((v) => v.properties.op.const === "setHeadSize");
  check("(G7) 화살표가 없는 집합에서는 setHeadSize 분기 자체가 없다(더 정밀해짐)", !headVariant);

  // ══════════ (F) class-b (p01 div 슬라이드) 무회귀 ══════════
  await page.evaluate(async (h) => { await window.__archTest.load(h, "p01.html"); }, DOM_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, { timeout: 20000 });
  const F0 = await src();
  await page.evaluate(() => window.__archTest.setMode("edit"));   // D26: 인라인 세션(simInlineStart/tfmt)은 편집 모드에서만
  await settle(300);
  const objEids = await page.evaluate(() => [...new DOMParser().parseFromString(window.__archTest.getSource(), "text/html").querySelectorAll('[data-object-type="textbox"]')].slice(0, 3).map((e) => e.getAttribute("data-arch-eid")));
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), objEids[0]);
  await settle(300);
  check("(F1) class-b 요소 선택 시에도 서식 툴바가 뜬다", await page.evaluate(() => window.__archTest.fmtBarShown()));
  const capObj = await caps();
  check("(F2) class-b 선택(ON): 배경(채움)은 도형 컨트롤이라 활성 · 글자색·크기·굵기는 텍스트라 인라인에서만",
    capObj.fill.ok && !capObj.textcolor.ok && !capObj.size.ok && !capObj.weight.ok
    && /편집 중인 글자|텍스트/.test(capObj.weight.why || ""), JSON.stringify({ fill: capObj.fill.ok, tc: capObj.textcolor.ok }));
  const capObjInline = await capsInline(objEids[0], "obj", null);
  // ★ D27c(b) 업데이트(의도적): obj의 서식 어휘를 svgbox 수준으로 올렸다(family→font-family·italic→font-style·
  //   align→text-align·track→letter-spacing 등 CSS 등가물 매핑). 이전 계약("obj는 글자색·크기·굵기만")은
  //   D27c로 대체됨 — 이제 인라인 편집 중 obj도 전체 텍스트 어휘가 활성(stroke만 제외).
  check("(F3) class-b 인라인 편집 중: 전체 텍스트 어휘 활성(D27c — 글자색·크기·굵기·글꼴·기울임·정렬·자간까지 svgbox 수준)",
    capObjInline.textcolor.ok && capObjInline.size.ok && capObjInline.weight.ok
    && capObjInline.family.ok && capObjInline.italic.ok && capObjInline.align.ok && capObjInline.track.ok,
    JSON.stringify({ tc: capObjInline.textcolor.ok, family: capObjInline.family.ok, italic: capObjInline.italic.ok, align: capObjInline.align.ok, track: capObjInline.track.ok }));
  // D26: class-b 글자색도 인라인 세션에서(obj 커밋 = applyText + pending setStyle). 선택만으론 적용 안 됨.
  const fBefore = await src();
  await tfmt(objEids[0], "obj", null, () => page.evaluate(() => window.__archTest.fmtTextColor("#b91c1c")));
  const fAfter = await src();
  // 브라우저는 인라인 style의 hex를 rgb()로 정규화하므로 "b91c1c" 문자열 검사는 적용됐어도 실패한다.
  // 실제 계약 = "선택한 요소(또는 그 안의 대표 텍스트 줄)의 color가 그 색이 됐는가".
  const objColor = await page.evaluate(([h, e]) => {
    const el = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]');
    if (!el) return { found: false };
    const hit = [el, ...el.querySelectorAll("*")].find((n) => {
      const c = (n.getAttribute("style") || "").replace(/\s+/g, "");
      return /color:(#b91c1c|rgb\(185,28,28\))/i.test(c);
    });
    return { found: !!hit, owner: hit ? (hit === el ? "self" : "descendant") : null };
  }, [fAfter, objEids[0]]);
  check("(F4) class-b 글자색 변경이 인라인 커밋으로 실제 적용(hex→rgb 정규화 포함)",
    objColor.found && fAfter !== fBefore, JSON.stringify(objColor));
  const fBleed = await bleedCleanSet(fBefore, fAfter, [objEids[0]]);
  check("(F5) class-b 단일 인라인 커밋도 bleed 청결(예전 보증 그대로)", fBleed.ok, JSON.stringify(fBleed).slice(0, 180));

  // class-b 다중 선택 배치
  await page.evaluate((e) => window.__archTest.selectByEid(e, true), objEids[1]);
  await page.evaluate((e) => window.__archTest.selectByEid(e, true), objEids[2]);
  await settle(300);
  const gBefore = await src(); const gDepth = await depth();
  await page.evaluate(() => window.__archTest.fmtFill("#fef08a"));
  await settle(700);
  const gAfter = await src();
  const bgAll = await page.evaluate(([h, es]) => es.map((e) => {
    const el = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]');
    return el ? /fef08a|254,\s*240,\s*138/.test(el.getAttribute("style") || "") : false;
  }), [gAfter, objEids]);
  check("(F6) class-b 배치: 3개 요소 배경이 한 번에 변경", bgAll.every(Boolean), JSON.stringify(bgAll));
  check("(F7) class-b 배치도 undo 1회", (await depth()) === gDepth + 1, `${gDepth} → ${await depth()}`);
  const gBleed = await bleedCleanSet(gBefore, gAfter, objEids);
  check("(F8) ★ class-b 배치도 S 밖 바이트 동일", gBleed.ok, JSON.stringify(gBleed).slice(0, 200));
  await page.evaluate(() => window.__archTest.undo());
  await settle(600);
  check("(F9) class-b 배치 undo 1회로 3개 전부 복구", (await src()) === gBefore);

  // 다운로드 청결(툴바가 저장물을 오염시키지 않는가)
  const dl = await page.evaluate(() => window.__archTest.getClean());
  check("(F10) 다운로드본에 에디터 스크립트·오버레이 없음",
    !dl.includes("data-arch-editor-agent") && !dl.includes("data-arch-overlay") && !dl.includes("arch-mask"));

  check("(Z) 콘솔/페이지 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 4).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : err));
  console.log("pageErrors:", pageErrors.slice(0, 6).join(" | "));
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
