// Stage 29 (D46) — 다이어그램 콘텐츠 굵은 한글 폰트 폴백.
//
// 배경: D32(§19)는 "굵게 눌렀을 때 한글이 합성 굵기로 보이는" 문제를 고쳤다고 기록됐지만, 라이브
//   재검증 결과 실제로 고쳐진 건 에디터 자체 UI(툴바/다이얼로그)뿐이었다 — styles.css의
//   @font-face("Pretendard")는 부모 페이지에만 있고, 다이어그램이 실제로 렌더되는 srcdoc
//   iframe(#diagram-frame)에는 전혀 없었다(별개 document라 상속되지 않음 — 브라우저 표준 동작).
//   D46은 문서 로드 시 자기 폰트가 없으면 Regular/Bold woff2를 base64로 읽어 <head>에 self-contained
//   @font-face로 주입하고, 기존 굵은 한글을 소급 수정 + 이후 굵게 op에도 같은 처리를 적용한다.
//
// 검증:
//   (A) 폴백 필요 문서(자기 폰트 없음, 인라인 픽스처 — demo_svg_slide.html의 한글 <text> 41개는
//       실측 결과 전부 font-weight>=600이라 "아직 안 굵은 한글 줄" 토글 대상이 없음, 그래서 이
//       테스트 전용 픽스처를 s28 방식대로 구성):
//     - 소스에 arch-bold-fallback 스타일 주입 + 400·700 900 두 얼굴 모두 + base64 self-contained.
//     - iframe document.fonts에서 Pretendard 400/700 둘 다 실제로 loaded.
//     - 로드만으로(편집 없이) 기존 굵은 한글(SVG <text>·obj 인라인 style 양쪽)이 소급 수정됨.
//     - 굵지 않은 한글 줄을 실제 UI 흐름(OFF/edit 모드 인라인 세션 + fmt-bold)으로 굵게 토글하면
//       font-weight 상승 + font-family가 Pretendard로 시작 + 스크린샷 잉크(픽셀) 실측 증가.
//   (B) 자기 폰트 있는 문서(p01_report_snapshot.html, Google Fonts @import) — 폴백 미주입,
//       iframe에 Pretendard 자체가 없음(fetch 자체가 안 일어남), 굵게 토글해도 family byte-identical.
//   (C) 다운로드 + 무서버(file://) 재로드 — 다운로드 파일에 폴백+base64 포함, 새 컨텍스트로
//       서버 없이 파일을 직접 열어도 Pretendard가 loaded(진짜 self-contained 실증).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8629;
const BASE = `http://127.0.0.1:${PORT}`;
const ART = path.join(APP_DIR, "test", "artifacts");
fs.mkdirSync(ART, { recursive: true });
const P01_HTML = fs.readFileSync(path.join(APP_DIR, "p01_report_snapshot.html"), "utf8");

// 실측 확인(2026-08-04): demo_svg_slide.html의 한글 <text> 41개 전수 조사 결과 전부 font-weight>=600
// (아직 안 굵은 한글 토글 대상 없음). 그래서 이 테스트 전용 최소 픽스처를 둔다 — 자기 폰트 없음,
// svgbox 안에 이미 굵은 한글 줄(이미굵은한글) + 아직 안 굵은 한글 줄(아직안굵은한글, 토글 대상),
// obj(HTML) 굵은 한글도 하나(retrofit의 두 축 다 실측하기 위함).
const FIXTURE_HTML = `<title>Bold Hangul Fallback Fixture</title>
<style>
  html, body { margin:0; padding:0; background:#e8eaef; }
  .slide-container { position:relative; width:960px; height:400px; background:#ffffff; }
</style>
<div class="slide-container" data-screen-label="fixture">
  <svg data-object="true" data-object-type="shape" xmlns="http://www.w3.org/2000/svg"
       style="position:absolute; left:40px; top:40px; width:300px; height:120px;"
       viewBox="0 0 300 120">
    <g transform="translate(20 20)">
      <rect width="240" height="80" fill="#eef2f8" stroke="#2f3b4a" stroke-width="2"/>
      <text x="120" y="30" text-anchor="middle" font-size="18" font-weight="800" fill="#1a1f2b">이미굵은한글</text>
      <text x="120" y="65" text-anchor="middle" font-size="18" fill="#1a1f2b">아직안굵은한글</text>
    </g>
  </svg>
  <div data-object="true" data-object-type="textbox" style="position:absolute; left:40px; top:220px; width:400px; font-size:20px; font-weight:900; color:#111111;">
    이미굵은OBJ한글텍스트
  </div>
</div>`;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "  — " + extra : "")); }
}
// 독립 재구현(앱 함수를 그대로 재사용하지 않음 — 순환 검증 방지, run-test.mjs 관례와 동일).
function isBoldWeightIndep(w) {
  const n = parseInt(w, 10);
  if (Number.isFinite(n)) return n >= 600;
  return String(w || "").trim() === "bold";
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

async function loadHtml(html, name) {
  await page.evaluate(async ([h, n]) => { await window.__archTest.load(h, n); }, [html, name]);
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
  await page.waitForTimeout(250);
  return await page.evaluate(() => window.__archTest.getSource());
}
async function goto() {
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
}
const frame = () => page.frameLocator("#diagram-frame");

// iframe(진짜 다이어그램 document) 안에서 document.fonts를 직접 찍는다 — frameLocator.evaluate는
// 그 요소가 속한 프레임의 JS 컨텍스트에서 실행되므로 부모 페이지가 아니라 iframe 자신의 fonts다.
async function iframeFontStatus(loadWeights) {
  return frame().locator("body").evaluate(async (_el, weights) => {
    if (weights && weights.length) {
      await Promise.all(weights.map((w) => document.fonts.load(w + ' "Pretendard"').catch(() => null)));
    }
    await document.fonts.ready.catch(() => {});
    return [...document.fonts]
      .filter((f) => f.family.replace(/^"|"$/g, "") === "Pretendard")
      .map((f) => ({ weight: f.weight, style: f.style, status: f.status }));
  }, loadWeights);
}

// 직렬화된 HTML 문자열을 다시 파싱해 실제 DOM API로 읽는다(속성값의 " 이스케이프 등 문자열
// 레벨 파싱 함정을 피한다 — run-test.mjs/s28의 firstEidWhere·diffOthers와 동일 원칙).
async function svgboxLineAttrs(html, eid, matchText) {
  return page.evaluate(([h, e, m]) => {
    const d = new DOMParser().parseFromString(h, "text/html");
    const g = d.querySelector('[data-arch-eid="' + e + '"]');
    if (!g) return null;
    const t = [...g.children].find((c) => c.tagName.toLowerCase() === "text" && c.textContent.includes(m));
    if (!t) return null;
    return { fontWeight: t.getAttribute("font-weight"), fontFamily: t.getAttribute("font-family"), text: t.textContent };
  }, [html, eid, matchText]);
}
async function objAttrsByText(html, matchText) {
  return page.evaluate(([h, m]) => {
    const d = new DOMParser().parseFromString(h, "text/html");
    const el = [...d.querySelectorAll('[data-object="true"]')].find((x) => (x.textContent || "").includes(m));
    if (!el) return null;
    return { fontWeight: el.style.fontWeight, fontFamily: el.style.fontFamily, text: el.textContent.trim(), eid: el.getAttribute("data-arch-eid") };
  }, [html, matchText]);
}

// 스크린샷 바이트를 canvas로 디코드해 배경색과 다른 픽셀(=잉크) 수를 센다 — rasterizeUnit이
// SVG data URI에서 alpha 채널로 하던 것과 같은 원리를, 완전불투명한 PNG 스크린샷에 맞게
// "배경색과의 색거리"로 적용(스크린샷엔 투명 알파가 없어 alpha>=60 기준을 그대로 못 씀).
async function screenshotInk(locator, bgHex) {
  const buf = await locator.screenshot();
  const dataUrl = "data:image/png;base64," + buf.toString("base64");
  return page.evaluate(async ({ dataUrl, bg }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("이미지 디코드 실패")); img.src = dataUrl; });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    const br = parseInt(bg.slice(1, 3), 16), bgg = parseInt(bg.slice(3, 5), 16), bb = parseInt(bg.slice(5, 7), 16);
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      const dr = data[i] - br, dgc = data[i + 1] - bgg, db = data[i + 2] - bb;
      if (Math.sqrt(dr * dr + dgc * dgc + db * db) > 45) ink++;
    }
    return { ink, w: c.width, h: c.height };
  }, { dataUrl, bg: bgHex });
}

try {
  await goto();

  // ==================== (A) 폴백 필요 문서 ====================
  const A0 = await loadHtml(FIXTURE_HTML, "fixture.html");
  check("(A0) 사전조건: svgbox:0 로드됨", A0.includes('data-arch-eid="svgbox:0"'), A0.slice(0, 200));

  check("(A1) 소스에 arch-bold-fallback 스타일 주입", A0.includes('id="arch-bold-fallback"'));
  check("(A1b) 주입된 스타일에 두 얼굴(400 · 700 900) 모두 포함",
    /font-weight:\s*400/.test(A0) && /font-weight:\s*700 900/.test(A0));
  check("(A1c) base64 self-contained(외부 fonts/ URL 아님)",
    A0.includes("base64,") && !/src:\s*url\(\s*fonts\//.test(A0));

  const fontsAfterLoad = await iframeFontStatus(["400 16px", "700 16px"]);
  const f400 = fontsAfterLoad.find((f) => f.weight === "400");
  const f700 = fontsAfterLoad.find((f) => /700/.test(String(f.weight)));
  check("(A2) iframe document.fonts에 Pretendard 400 loaded", !!f400 && f400.status === "loaded", JSON.stringify(fontsAfterLoad));
  check("(A2b) iframe document.fonts에 Pretendard 700/900 loaded", !!f700 && f700.status === "loaded", JSON.stringify(fontsAfterLoad));

  // ---- (A3) 로드만으로(편집 없이) 기존 굵은 한글이 소급 수정됐는가 — SVG + obj 두 축 ----
  const svgBoldLine = await svgboxLineAttrs(A0, "svgbox:0", "이미굵은한글");
  check("(A3) SVG 굵은 한글 소급수정: font-family가 Pretendard로 시작",
    !!svgBoldLine && /^"?Pretendard"?/.test(svgBoldLine.fontFamily || ""), JSON.stringify(svgBoldLine));
  check("(A3b) SVG 굵은 한글 소급수정: font-weight 자체는 그대로(800)", svgBoldLine && svgBoldLine.fontWeight === "800", JSON.stringify(svgBoldLine));

  const objBold = await objAttrsByText(A0, "이미굵은OBJ한글텍스트");
  check("(A3c) obj 굵은 한글 소급수정: font-family가 Pretendard로 시작",
    !!objBold && /^"?Pretendard"?/.test(objBold.fontFamily || ""), JSON.stringify(objBold));

  // ---- (A3d) 아직 안 굵은 줄은 로드 시점에 손대지 않음(소급수정이 굵은 줄에만 좁게 적용) ----
  const svgNotBoldPre = await svgboxLineAttrs(A0, "svgbox:0", "아직안굵은한글");
  check("(A3d) 아직 안 굵은 SVG 줄은 로드시점엔 font-family 미부여",
    !!svgNotBoldPre && !svgNotBoldPre.fontFamily, JSON.stringify(svgNotBoldPre));

  // ==================== (A4) 실제 UI 흐름으로 굵게 토글 ====================
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__archTest.simInlineStart("svgbox:0", "svgbox", 1, "아직안굵은한글"));
  await page.waitForTimeout(100);
  const boldBefore = await page.evaluate(() => window.__archTest.fmtValues().bold[0]);
  check("(A4pre) 토글 전 그 줄은 굵지 않음(인라인 세션 값 기준)", boldBefore === false, String(boldBefore));

  const preShot = await screenshotInk(frame().locator('[data-arch-eid="svgbox:0"]'), "#eef2f8");
  check("(A4pre-b) 토글 전 스크린샷이 실제로 픽셀을 담음(카메라가 작동함)", preShot.ink > 20, JSON.stringify(preShot));

  await page.evaluate(() => window.__archTest.fmtBold());
  await page.evaluate(() => window.__archTest.simInlineCommit("아직안굵은한글", false));
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 8000 });
  await page.waitForTimeout(250);

  const B = await page.evaluate(() => window.__archTest.getSource());
  const svgToggled = await svgboxLineAttrs(B, "svgbox:0", "아직안굵은한글");
  check("(A4) 굵게 토글 후 font-weight 상승(bold)", svgToggled && isBoldWeightIndep(svgToggled.fontWeight), JSON.stringify(svgToggled));
  check("(A4b) 굵게 토글 후 font-family가 Pretendard로 시작", svgToggled && /^"?Pretendard"?/.test(svgToggled.fontFamily || ""), JSON.stringify(svgToggled));
  // 대조군: 옆줄(원래부터 굵던 줄)은 이 편집으로 손대지 않음(줄 스코프 정밀도).
  const svgOtherLineAfter = await svgboxLineAttrs(B, "svgbox:0", "이미굵은한글");
  check("(A4c) 다른 줄(이미굵은한글)은 이번 편집으로 안 변함", svgOtherLineAfter && svgOtherLineAfter.fontWeight === "800" && svgOtherLineAfter.fontFamily === svgBoldLine.fontFamily,
    JSON.stringify({ before: svgBoldLine, after: svgOtherLineAfter }));

  const postShot = await screenshotInk(frame().locator('[data-arch-eid="svgbox:0"]'), "#eef2f8");
  check("(A5) 굵게 토글이 실제 렌더 잉크(픽셀)를 늘림(합성이든 실물이든 렌더 자체는 검증)",
    postShot.ink > preShot.ink, `ink ${preShot.ink} → ${postShot.ink}`);
  await page.screenshot({ path: path.join(ART, "s29_bold_toggle_full.png") });

  // ==================== (B) 자기 폰트 있는 문서(p01) — 폴백 미주입 ====================
  const B0 = await loadHtml(P01_HTML, "p01.html");
  check("(B0) p01: arch-bold-fallback 스타일 없음(자기 폰트가 있어 폴백 불필요)", !B0.includes("arch-bold-fallback"));
  check("(B0b) p01: base64 폰트 데이터가 아예 없음(fetch 자체가 안 일어남)", !B0.includes("data:font/woff2;base64,"));

  const p01Fonts = await iframeFontStatus([]);
  check("(B1) p01 iframe document.fonts에 Pretendard 항목 자체가 없음", p01Fonts.length === 0, JSON.stringify(p01Fonts));

  // p01의 굵은 한글 obj 하나를 골라 굵게 재토글해도 family가 바이트 동일한지(불필요한 개입 없음).
  //   ★ p01의 textbox obj는 전부 D27c "줄-div" 구조(외곽 컨테이너 자신은 직접 텍스트가 없고, 직속
  //   자식 div마다 한 줄) — 그래서 line=null(largestFontLine)로 커밋하면 컨테이너 자신이 아니라
  //   그 **내부 특정 줄 div**가 바뀐다. 컨테이너를 검증하면 애초에 안 건드려진 걸 보는 셈이라
  //   공허 통과가 난다(B2 최초 시도에서 실측 확인). 그래서 명시적 line 인덱스로 그 줄을 지정하고,
  //   검증도 el.children[line](그 줄 div) 자체를 읽는다.
  const p01Candidates = await page.evaluate((h) => {
    const d = new DOMParser().parseFromString(h, "text/html");
    const HANGUL = /[가-힣]/;
    const els = [...d.querySelectorAll('[data-object="true"][data-object-type="textbox"][data-arch-eid]')]
      .filter((el) => el.children.length > 0);
    for (const el of els) {
      const lines = [...el.children];
      const li = lines.findIndex((c) => HANGUL.test(c.textContent || ""));
      if (li >= 0) {
        return {
          eid: el.getAttribute("data-arch-eid"), line: li,
          text: lines[li].textContent.trim(),
          fontWeight: lines[li].style.fontWeight, fontFamily: lines[li].style.fontFamily,
        };
      }
    }
    return null;
  }, B0);
  check("(B2) 사전조건: p01에서 한글 줄을 가진 obj 요소 하나 확보", !!p01Candidates, JSON.stringify(p01Candidates));

  if (p01Candidates) {
    await page.evaluate(() => window.__archTest.setMode("edit"));
    await page.waitForTimeout(150);
    await page.evaluate(([eid, li, txt]) => window.__archTest.simInlineStart(eid, "obj", li, txt), [p01Candidates.eid, p01Candidates.line, p01Candidates.text]);
    await page.waitForTimeout(100);
    await page.evaluate(() => window.__archTest.fmtBold());
    await page.evaluate((txt) => window.__archTest.simInlineCommit(txt, false), p01Candidates.text);
    await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 8000 });
    await page.waitForTimeout(250);
    const B1 = await page.evaluate(() => window.__archTest.getSource());
    const p01After = await page.evaluate(([h, eid, li]) => {
      const d = new DOMParser().parseFromString(h, "text/html");
      const el = d.querySelector('[data-arch-eid="' + eid + '"]');
      const line = el ? el.children[li] : null;
      return line ? { fontWeight: line.style.fontWeight, fontFamily: line.style.fontFamily, text: line.textContent.trim() } : null;
    }, [B1, p01Candidates.eid, p01Candidates.line]);
    check("(B3) p01: 굵게 토글해도 font-family가 바이트 동일(불필요한 개입 없음)",
      p01After && p01After.fontFamily === p01Candidates.fontFamily, JSON.stringify({ before: p01Candidates.fontFamily, after: p01After && p01After.fontFamily }));
    // 방향 무관(고른 줄이 이미 굵었으면 토글은 끄는 방향) — fmtBold 메커니즘 자체가 여전히
    // 정상 작동하는지(무언가 실제로 바뀌는지)만 본다. family 불변이 이 서브테스트의 핵심.
    check("(B3b) p01: font-weight 자체는 토글로 실제 변화함(메커니즘은 그대로 작동)",
      p01After && p01After.fontWeight !== p01Candidates.fontWeight, JSON.stringify({ before: p01Candidates.fontWeight, after: p01After && p01After.fontWeight }));
  }

  // ==================== (C) 다운로드 + 무서버(file://) 재로드 ====================
  await loadHtml(FIXTURE_HTML, "fixture2.html");
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__archTest.simInlineStart("svgbox:0", "svgbox", 1, "아직안굵은한글"));
  await page.waitForTimeout(100);
  await page.evaluate(() => window.__archTest.fmtBold());
  await page.evaluate(() => window.__archTest.simInlineCommit("아직안굵은한글", false));
  await page.waitForFunction(() => window.__archTest.undoDepth() === 1, null, { timeout: 8000 });
  await page.waitForTimeout(250);

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 10000 }),
    page.click("#btn-download"),
  ]);
  const dlPath = await download.path();
  const dl = fs.readFileSync(dlPath, "utf8");
  check("(C1) 다운로드 파일에 arch-bold-fallback 포함", dl.includes('id="arch-bold-fallback"'));
  check("(C2) 다운로드 파일에 base64 폰트 데이터 포함", dl.includes("base64,"));
  check("(C3) 다운로드 파일에 굵게 토글한 줄의 Pretendard family도 포함(편집 결과 보존)",
    /아직안굵은한글/.test(dl) && (() => { const m = dl.match(/<text[^>]*>아직안굵은한글<\/text>/); return !!m && /Pretendard/.test(m[0]); })());
  // ★ download.path()는 Playwright 내부 임시 저장 경로(확장자 없는 UUID 파일명)라 브라우저가
  //   file://로 직접 열면 text/plain으로 취급해 <head>/<style>이 전혀 파싱되지 않는다(실측 확인 —
  //   headLen=47의 합성 head, styleTagCount=0, 2MB 본문이 그대로 body 텍스트로). .html 확장자를 가진
  //   경로로 복사한 뒤 그 경로를 여는 게 실제 "다운로드한 파일을 더블클릭해서 여는" 사용자 시나리오와도
  //   더 가깝다(다운로드는 항상 원래 파일명 확장자를 유지한다).
  const dlHtmlPath = path.join(ART, "s29_downloaded.edited.html");
  fs.copyFileSync(dlPath, dlHtmlPath);

  // 서버 완전 배제 — 새 컨텍스트로 file://(.html 확장자 경로) 직접 열기.
  const fileCtx = await browser.newContext();
  const filePage = await fileCtx.newPage();
  const fileErrors = [];
  filePage.on("pageerror", (e) => fileErrors.push(String(e)));
  await filePage.goto(pathToFileURL(dlHtmlPath).href);
  const fileFonts = await filePage.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 16px "Pretendard"').catch(() => null),
      document.fonts.load('700 16px "Pretendard"').catch(() => null),
    ]);
    await document.fonts.ready.catch(() => {});
    return [...document.fonts]
      .filter((f) => f.family.replace(/^"|"$/g, "") === "Pretendard")
      .map((f) => ({ weight: f.weight, status: f.status }));
  });
  const ff400 = fileFonts.find((f) => f.weight === "400");
  const ff700 = fileFonts.find((f) => /700/.test(String(f.weight)));
  check("(C4) file:// 무서버 재로드에서도 Pretendard 400 loaded", !!ff400 && ff400.status === "loaded", JSON.stringify(fileFonts));
  check("(C4b) file:// 무서버 재로드에서도 Pretendard 700/900 loaded", !!ff700 && ff700.status === "loaded", JSON.stringify(fileFonts));
  check("(C5) file:// 재로드 중 페이지 에러 없음(자기완결 확인)", fileErrors.length === 0, JSON.stringify(fileErrors));
  await fileCtx.close();

  check("(Z) 콘솔/페이지 에러 없음", pageErrors.length === 0, JSON.stringify(pageErrors));
} catch (e) {
  console.error("EXCEPTION", e);
  fail++;
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
