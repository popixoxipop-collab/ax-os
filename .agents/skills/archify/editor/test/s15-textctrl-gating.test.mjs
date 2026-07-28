// Stage 15 (D26) — 텍스트 서식 컨트롤 게이팅 반전 (mock, 키 불필요).
//
// 버그(실측 재현): 서식 툴바의 **텍스트 관련** 컨트롤(B/I/U/S·크기·글자색·정렬·줄간격·자간·글꼴·프리셋)이
//   fmtCap()을 통해 ON모드 선택(selection.length)에 게이트돼 있었다 → 도형만 선택(타이핑 안 함)해도 활성,
//   정작 OFF모드 인라인 텍스트 편집 중(실제 타이핑 중)엔 비활성. 정확히 반대.
// 수정(D26): 텍스트 서브그룹만 게이트를 **"인라인 편집 세션이 열려 있는가"**로 전환. 도형 서브그룹
//   (채움/테두리/화살촉/방향)은 그대로 ON+selection. 4-상태 표:
//     ON+도형선택      → 텍스트 비활성 / 도형 활성
//     OFF+인라인편집중  → 텍스트 활성   / 도형 비활성
//     그 외            → 둘 다 비활성
// 정밀도: 여러 줄 박스에서 인라인 편집 중 서식은 **그 줄 <text>에만** 적용(bleed-diff로 실증).
// 라이브 프리뷰: 서식 클릭 시 오버레이 <input> 자체가 즉시 재도장(commit 전에 눈으로 보임), 실제 소스
//   반영·undo는 Enter 커밋 때 setText와 한 배치로(단일 undo). Escape는 미커밋 폐기.
//
// bleed-diff는 앱 로직을 재사용하지 않고 테스트가 독립 DOMParser 비교로 실증한다(순환 방지).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8637;
const BASE = `http://127.0.0.1:${PORT}`;
const ART = path.join(APP_DIR, "test", "artifacts");
fs.mkdirSync(ART, { recursive: true });
const SVG_HTML = fs.readFileSync(path.join(APP_DIR, "demo_svg_slide.html"), "utf8");
const P01_HTML = fs.readFileSync(path.join(APP_DIR, "p01_report_snapshot.html"), "utf8");

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
const page = await browser.newPage({ viewport: { width: 2200, height: 1500 } });
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));

const frame = () => page.frameLocator("#diagram-frame");
const vf = () => page.frames().find((f) => f !== page.mainFrame());
const src = () => page.evaluate(() => window.__archTest.getSource());
const depth = () => page.evaluate(() => window.__archTest.undoDepth());
const settle = (ms) => page.waitForTimeout(ms == null ? 350 : ms);
async function stageBox() { return await page.locator("#stage").boundingBox(); }

// 텍스트/도형 컨트롤 DOM disabled 상태(실측)
const TEXT_CTRL_IDS = ["fmt-bold", "fmt-italic", "fmt-underline", "fmt-strike", "fmt-size", "fmt-textcolor", "fmt-linegap", "fmt-track", "fmt-font", "fmt-preset", "fmt-align-start"];
const SHAPE_CTRL_IDS = ["fmt-fill", "fmt-stroke"];
const domDisabled = (ids) => page.evaluate((xs) => xs.map((id) => { const el = document.getElementById(id); return { id, disabled: el ? !!el.disabled : null }; }), ids);
const capOk = (ctrl) => page.evaluate((c) => window.__archTest.fmtCap(c).ok, ctrl);

// 독립 bleed-diff: eid 하나(+조상)만 변하고 나머지 [data-arch-eid]는 outerHTML 동일.
const bleedClean = (a, b, eid) => page.evaluate(([ha, hb, e]) => {
  const P = (h) => new DOMParser().parseFromString(h, "text/html");
  const A = P(ha), B = P(hb);
  const unitA = A.querySelector('[data-arch-eid="' + e + '"]');
  const offenders = [];
  A.querySelectorAll("[data-arch-eid]").forEach((el) => {
    const k = el.getAttribute("data-arch-eid");
    if (k === e) return;
    if (unitA && el.contains(unitA)) return;              // 조상(바깥 svg) — 마스크가 커버
    const elB = B.querySelector('[data-arch-eid="' + k + '"]');
    if (!elB || el.outerHTML !== elB.outerHTML) offenders.push(k);
  });
  const mask = (doc) => { const el = doc.querySelector('[data-arch-eid="' + e + '"]'); if (el) el.replaceWith(doc.createElement("m-mask")); return doc.documentElement.outerHTML; };
  return { ok: mask(A) === mask(B) && !offenders.length, offenders };
}, [a, b, eid]);

// 박스 줄별 font-weight(소스에서 직접)
const boxWeights = (html, eid) => page.evaluate(([h, e]) => {
  const g = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]');
  if (!g) return null;
  return [...g.children].filter((c) => c.tagName.toLowerCase() === "text").map((t) => t.getAttribute("font-weight"));
}, [html, eid]);

// 화면좌표(iframe bbox + stage offset)
async function lineClientOfBox(eid, lineIdx) {
  return await vf().evaluate(([e, i]) => {
    const g = document.querySelector('[data-arch-eid="' + e + '"]');
    const ts = [...g.children].filter((c) => c.tagName.toLowerCase() === "text");
    const r = ts[i].getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, left: r.left, top: r.top, w: r.width, h: r.height };
  }, [eid, lineIdx]);
}
async function textClient(eid) {
  return await vf().evaluate((e) => { const t = document.querySelector('[data-arch-eid="' + e + '"]'); const r = t.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, eid);
}
const inlineInput = () => vf().evaluate(() => { const i = document.querySelector('[data-arch-overlay="inline"]'); if (!i) return null; const cs = getComputedStyle(i); return { present: true, val: i.value, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle }; });
const objEditingStyle = () => vf().evaluate(() => { const e = document.querySelector('[contenteditable="true"]'); if (!e) return null; return { present: true, fontWeight: getComputedStyle(e).fontWeight }; });

async function enterOff() {
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await settle(200);
  await page.evaluate(() => window.__archTest.setElementEditOn(false));
  await settle(220);
}

try {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await page.evaluate(async (h) => { await window.__archTest.load(h, "svg.html"); }, SVG_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
  await settle(250);
  const A0 = await src();

  // 3줄 박스 + 자유 텍스트 확보
  const box3 = await page.evaluate((h) => {
    const d = new DOMParser().parseFromString(h, "text/html");
    for (const g of d.querySelectorAll('[data-svgbox="1"]')) {
      if ([...g.children].filter((c) => c.tagName.toLowerCase() === "text").length === 3) return g.getAttribute("data-arch-eid");
    }
    return null;
  }, A0);
  const txtEid = (await page.evaluate(() => window.__archTest.getSvgTexts().map((t) => t.eid)))[0];
  check("(S0) 3줄 svgbox + 자유 텍스트 확보", !!box3 && !!txtEid, `box3=${box3} txt=${txtEid}`);

  // ══════════ (A) 4-상태 게이팅 계약 — 버그 재현/회귀 가드 ══════════
  // ── A: ON + 도형선택 → 텍스트 컨트롤 **비활성**(수정 전엔 활성이었음), 도형 컨트롤 활성 ──
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await settle(200);
  await frame().locator('[data-arch-eid="' + box3 + '"]').click({ force: true });
  await page.waitForFunction((e) => { const s = window.__archTest.getSelected(); return s && s.eid === e; }, box3, { timeout: 6000 });
  const capOnText = { weight: await capOk("weight"), italic: await capOk("italic"), decor: await capOk("decor"), size: await capOk("size"), textcolor: await capOk("textcolor"), align: await capOk("align"), gap: await capOk("gap"), track: await capOk("track"), preset: await capOk("preset"), family: await capOk("family") };
  const capOnShape = { fill: await capOk("fill"), stroke: await capOk("stroke") };
  check("(A1) ON+도형선택: 텍스트 컨트롤 전부 비활성(수정 전엔 활성 — 버그)",
    Object.values(capOnText).every((v) => v === false), JSON.stringify(capOnText));
  check("(A2) ON+도형선택: 도형 컨트롤(채움·테두리)은 활성(그대로)",
    capOnShape.fill === true && capOnShape.stroke === true, JSON.stringify(capOnShape));
  const domOnText = await domDisabled(TEXT_CTRL_IDS);
  const domOnShape = await domDisabled(SHAPE_CTRL_IDS);
  check("(A3) ON+도형선택 DOM 실측: fmt-bold/size/italic/underline/strike/textcolor/linegap/track 전부 disabled=true",
    domOnText.every((x) => x.disabled === true), JSON.stringify(domOnText.filter((x) => !x.disabled)));
  check("(A4) ON+도형선택 DOM 실측: fmt-fill/stroke는 disabled=false", domOnShape.every((x) => x.disabled === false), JSON.stringify(domOnShape));
  await page.locator("#fmt-bar").screenshot({ path: path.join(ART, "s15_ON_shape_selected_text_disabled.png") });

  // ── B: OFF + 인라인 편집중 → 텍스트 컨트롤 **활성**(수정 전엔 비활성 — 버그), 도형 컨트롤 비활성 ──
  await enterOff();
  let sb = await stageBox(), lb = await lineClientOfBox(box3, 1);   // 줄 2(index 1) 클릭
  await page.mouse.click(sb.x + lb.cx, sb.y + lb.cy);
  await settle(320);
  const inpOpen = await inlineInput();
  check("(A5) OFF에서 줄 클릭 → 인라인 오버레이 <input> 등장", !!inpOpen && inpOpen.present, JSON.stringify(inpOpen));
  const capOffText = { weight: await capOk("weight"), italic: await capOk("italic"), decor: await capOk("decor"), size: await capOk("size"), textcolor: await capOk("textcolor"), align: await capOk("align"), gap: await capOk("gap"), track: await capOk("track") };
  const capOffShape = { fill: await capOk("fill"), stroke: await capOk("stroke") };
  check("(A6) OFF+인라인편집중: 텍스트 컨트롤 전부 활성(수정 전엔 비활성 — 정확히 반대였음)",
    Object.values(capOffText).every((v) => v === true), JSON.stringify(capOffText));
  check("(A7) OFF+인라인편집중: 도형 컨트롤은 비활성(선택 없음)", capOffShape.fill === false && capOffShape.stroke === false, JSON.stringify(capOffShape));
  const domOffText = await domDisabled(TEXT_CTRL_IDS.filter((x) => x !== "fmt-align-start" && x !== "fmt-font" && x !== "fmt-preset"));
  check("(A8) OFF+인라인편집중 DOM 실측: fmt-bold/italic/underline/strike/size/textcolor/linegap/track 전부 disabled=false",
    domOffText.every((x) => x.disabled === false), JSON.stringify(domOffText.filter((x) => x.disabled)));
  await page.locator("#fmt-bar").screenshot({ path: path.join(ART, "s15_OFF_inline_text_enabled.png") });

  // ══════════ (B) 라이브 프리뷰 + 정밀 커밋 + undo (3줄 박스 줄 2에 Bold) ══════════
  const wBefore = await boxWeights(A0, box3);
  const inpPreBold = await inlineInput();
  await page.click("#fmt-bold");   // 진짜 버튼 클릭(포커스가 iframe 밖으로 나가도 세션이 살아 있어야 함)
  await settle(300);
  const inpPostBold = await inlineInput();
  // 이 데모의 박스 텍스트는 기본이 굵음(800)이라 Bold 클릭 = 토글 해제(800→보통). 방향과 무관하게
  // "클릭 즉시 오버레이 <input> 자신의 computed font-weight가 바뀐다"가 라이브 프리뷰의 증거다.
  check("(B1) ★ 라이브 프리뷰: Bold 클릭 즉시 오버레이 <input> 자체의 computed font-weight가 토글된다(commit 전, 굵음→보통)",
    inpPostBold && inpPostBold.present && parseInt(inpPreBold.fontWeight, 10) >= 600 && parseInt(inpPostBold.fontWeight, 10) < 600,
    `pre=${inpPreBold && inpPreBold.fontWeight} → post=${inpPostBold && inpPostBold.fontWeight}`);
  await page.screenshot({ path: path.join(ART, "s15_OFF_inline_bold_livepreview.png"), clip: { x: Math.max(0, sb.x + lb.left - 120), y: Math.max(0, sb.y + lb.top - 90), width: 520, height: 220 } });
  check("(B2) ★ 커밋 전 소스는 무변경(pending — 재렌더가 오버레이/타이핑을 안 날림)", (await src()) === A0);

  // Enter 커밋 → pending 서식이 그 줄에만 반영
  await frame().locator('[data-arch-overlay="inline"]').press("Enter");
  await page.waitForFunction(() => window.__archTest.undoDepth() >= 1, null, { timeout: 6000 });
  await settle(250);
  const S1 = await src();
  const wAfter = await boxWeights(S1, box3);
  check("(B3) ★ 커밋 후: **줄 2만** font-weight 변경(줄 1·3 불변) — 줄 스코프 정밀도",
    wAfter[1] !== wBefore[1] && wAfter[0] === wBefore[0] && wAfter[2] === wBefore[2],
    JSON.stringify({ before: wBefore, after: wAfter }));
  const bd = await bleedClean(A0, S1, box3);
  check("(B4) ★ bleed-diff: 그 박스만 변경, 다른 모든 줄·단위 바이트 동일", bd.ok, JSON.stringify(bd.offenders));
  check("(B5) 커밋은 undo 1회(텍스트 무변경이라 서식만)", (await depth()) === 1, `depth=${await depth()}`);
  await page.keyboard.press("Meta+z");
  await settle(500);
  check("(B6) ★ Cmd+Z가 서식을 바이트 동일하게 되돌린다", (await src()) === A0, "restored != A0");

  // ══════════ (C) 자유 텍스트(svgtext) 인라인 서식 ══════════
  await enterOff();
  const tc = await textClient(txtEid);
  sb = await stageBox();
  await page.mouse.click(sb.x + tc.cx, sb.y + tc.cy);
  await settle(320);
  const tInp = await inlineInput();
  check("(C1) 자유 텍스트 클릭 → 인라인 입력 등장", !!tInp && tInp.present, JSON.stringify(tInp));
  const tWBefore = await page.evaluate(([h, e]) => { const t = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]'); return t && t.getAttribute("font-weight"); }, [A0, txtEid]);
  const tInpPre = await inlineInput();
  await page.click("#fmt-bold");
  await settle(250);
  const tInpBold = await inlineInput();
  check("(C2) 자유 텍스트 라이브 프리뷰: 입력 font-weight가 토글됨(즉시)", tInpBold && tInpPre && parseInt(tInpBold.fontWeight, 10) !== parseInt(tInpPre.fontWeight, 10), `${tInpPre && tInpPre.fontWeight} → ${tInpBold && tInpBold.fontWeight}`);
  await frame().locator('[data-arch-overlay="inline"]').press("Enter");
  await page.waitForFunction(() => window.__archTest.undoDepth() >= 1, null, { timeout: 6000 });
  await settle(250);
  const S2 = await src();
  const tWAfter = await page.evaluate(([h, e]) => { const t = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]'); return t && t.getAttribute("font-weight"); }, [S2, txtEid]);
  check("(C3) 자유 텍스트 커밋: 그 텍스트 font-weight 변경", tWAfter !== tWBefore, `${tWBefore} → ${tWAfter}`);
  check("(C4) 자유 텍스트 bleed 청결", (await bleedClean(A0, S2, txtEid)).ok, JSON.stringify(await bleedClean(A0, S2, txtEid)));
  await page.keyboard.press("Meta+z");
  await settle(450);
  check("(C5) 자유 텍스트 Cmd+Z 바이트 동일 복원", (await src()) === A0);

  // ══════════ (D) obj (class-b, p01 div) 인라인 서식 ══════════
  await page.evaluate(async (h) => { await window.__archTest.load(h, "p01.html"); }, P01_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
  await settle(300);
  const P0 = await src();
  const objEid = await page.evaluate(() => { const d = new DOMParser().parseFromString(window.__archTest.getSource(), "text/html"); const e = d.querySelector('[data-object-type="textbox"]'); return e && e.getAttribute("data-arch-eid"); });
  await enterOff();
  const oc = await vf().evaluate((e) => { const el = document.querySelector('[data-arch-eid="' + e + '"]'); const r = el.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, objEid);
  sb = await stageBox();
  await page.mouse.click(sb.x + oc.cx, sb.y + oc.cy);
  await settle(320);
  const objEd = await objEditingStyle();
  check("(D1) obj 클릭 → contenteditable 인라인 편집 진입", !!objEd && objEd.present, JSON.stringify(objEd));
  // ★ D27c(b) 업데이트(의도적): obj의 서식 어휘를 svgbox 수준으로 올렸다(family/italic/decor/align/gap/track를
  //   CSS 등가물로 매핑). 이전 계약("obj는 크기·굵기·글자색만, 기울임 비활성")은 D27c로 대체됨 — 이제 obj
  //   인라인 편집 중엔 전체 텍스트 어휘가 활성(stroke만 제외, div엔 SVG stroke가 없음).
  const capObjOff = {
    weight: await capOk("weight"), size: await capOk("size"), textcolor: await capOk("textcolor"),
    italic: await capOk("italic"), decor: await capOk("decor"), align: await capOk("align"),
    gap: await capOk("gap"), track: await capOk("track"), family: await capOk("family"), stroke: await capOk("stroke"),
  };
  check("(D2) obj 인라인편집중: 전체 텍스트 어휘 활성(D27c — 크기·굵기·글자색·기울임·밑줄/취소선·정렬·줄간격·자간·글꼴), stroke만 비활성",
    capObjOff.weight === true && capObjOff.size === true && capObjOff.textcolor === true && capObjOff.italic === true &&
    capObjOff.decor === true && capObjOff.align === true && capObjOff.gap === true && capObjOff.track === true &&
    capObjOff.family === true && capObjOff.stroke === false, JSON.stringify(capObjOff));
  await page.click("#fmt-bold");
  await settle(250);
  // obj 커밋: contenteditable에서 Enter → endTextEdit(true) → arch-text(changed) + pending setStyle 한 배치
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__archTest.undoDepth() >= 1, null, { timeout: 6000 });
  await settle(300);
  const P1 = await src();
  const objBold = await page.evaluate(([h, e]) => {
    const el = new DOMParser().parseFromString(h, "text/html").querySelector('[data-arch-eid="' + e + '"]');
    if (!el) return { found: false };
    const hit = [el, ...el.querySelectorAll("*")].find((n) => { const s = (n.getAttribute("style") || "").replace(/\s+/g, ""); return /font-weight:(bold|[6-9]\d\d)/i.test(s); });
    return { found: !!hit };
  }, [P1, objEid]);
  check("(D3) obj 커밋: 그 요소(또는 대표 텍스트 줄) font-weight가 굵게 반영", objBold.found && P1 !== P0, JSON.stringify(objBold));
  check("(D4) obj bleed 청결", (await bleedClean(P0, P1, objEid)).ok, JSON.stringify(await bleedClean(P0, P1, objEid)));
  await page.keyboard.press("Meta+z");
  await settle(450);
  check("(D5) obj Cmd+Z 바이트 동일 복원", (await src()) === P0);

  // ══════════ (E) Escape는 미커밋 폐기 — 서식·텍스트 모두 버리고 툴바 비활성 복귀 ══════════
  await page.evaluate(async (h) => { await window.__archTest.load(h, "svg.html"); }, SVG_HTML);
  await page.waitForFunction(() => window.__archTest.ready === true, null, { timeout: 20000 });
  await settle(250);
  const E0 = await src();
  const eDepth0 = await depth();
  await enterOff();
  sb = await stageBox(); lb = await lineClientOfBox(box3, 1);
  await page.mouse.click(sb.x + lb.cx, sb.y + lb.cy);
  await settle(320);
  await page.click("#fmt-bold");         // 세션 중 서식 적용(pending)
  await settle(220);
  const eInpBold = await inlineInput();
  check("(E1) Escape 전: 세션 중 Bold가 오버레이에 프리뷰됨(토글: 굵음→보통)", eInpBold && parseInt(eInpBold.fontWeight, 10) < 600, eInpBold && eInpBold.fontWeight);
  await frame().locator('[data-arch-overlay="inline"]').press("Escape");
  await settle(320);
  check("(E2) ★ Escape: 세션 중 서식이 커밋되지 않음 — 소스 바이트 동일", (await src()) === E0);
  check("(E3) Escape: undo 스택 무증가(무커밋)", (await depth()) === eDepth0, `depth ${eDepth0} → ${await depth()}`);
  check("(E4) Escape: 인라인 입력 제거됨", (await inlineInput()) === null);
  const capAfterEsc = { weight: await capOk("weight"), textcolor: await capOk("textcolor") };
  check("(E5) Escape 후: 텍스트 컨트롤이 다시 비활성(선택/편집 없음)", capAfterEsc.weight === false && capAfterEsc.textcolor === false, JSON.stringify(capAfterEsc));

  check("(Z) 페이지 콘솔 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 4).join("\n") : err));
} finally {
  await browser.close();
  server.kill();
}
console.log(`\n=== s15 (D26 텍스트 서식 게이팅 반전) : ${pass} pass / ${fail} fail ===`);
process.exit(fail ? 1 : 0);
