// archify 요소 편집기 — s21: 겹침 순서(z-order) 앞으로/뒤로 (D34a/b/c)
//
// 검증 축(요청 사양 그대로):
//  · 겹치는 obj 2개: elementFromPoint로 현재 top 확인 → 둘 선택(primary=마지막 클릭) →
//    "뒤로 보내기" → 반대쪽이 top으로 뒤바뀜(시각 증명) · z-index 정확 · bleed-diff 청결(primary만) ·
//    undo 바이트 동일. 그다음 반대 유닛을 primary로 재선택 → "앞으로" 로 되뒤집음(양방향 증명).
//  · 겹치는 class-c 2개(같은 부모): 같은 flip-and-verify + DOM 순서 실제 변경 +
//    reorder bleed-diff(내용 불변·집합 밖 위치/내용 불변·같은 부모)를 독립 구현으로 실증.
//  · 다른 부모 class-c 쌍: 비활성+사유가 실제로 성립(무동작)을 시각/상태로 확인.
//  · 혼합 obj+class-c: 두 버튼 비활성+사유.
//  · 동종 3개 이상: primary가 "다른 선택 전부보다 위/아래" 규칙 성립.
//  · Cmd+Z가 각 경우 바이트 동일 복원.
//  · 스크린샷 before/after(겹침 영역 크롭)로 시각 스택 변경 자체를 보인다.
//
// ★ bleed-diff는 앱 어댑터를 재사용하지 않고 테스트가 독립 구현으로 대조한다(순환 검증 방지).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8621;
const BASE = `http://127.0.0.1:${PORT}`;
const ART = path.join(APP_DIR, "test", "artifacts");
fs.mkdirSync(ART, { recursive: true });

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "  — " + extra : "")); }
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: APP_DIR, stdio: "ignore" });
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { const r = await fetch(BASE + "/index.html"); up = r.ok; } catch {}
  if (!up) await settle(200);
}
if (!up) { console.error("http.server가 뜨지 않음"); server.kill(); process.exit(1); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 2120, height: 1420 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));

// ---- helpers ----
function theFrame() {
  return page.frames().find((f) => f !== page.mainFrame());
}
async function waitReady() {
  await page.waitForFunction(() => window.__archTest && window.__archTest.ready === true, null, { timeout: 20000 });
}
async function afterCommit(depth) {
  if (depth != null) await page.waitForFunction((d) => window.__archTest.undoDepth() === d, depth, { timeout: 10000 });
  await waitReady();
  await settle(160);
}
async function enterOnEdit() {
  await page.evaluate(() => window.__archTest.setMode("edit"));
  await settle(120);
  await page.evaluate(() => window.__archTest.setElementEditOn(true));
  await settle(160);
}
// primary = 두 번째로 고른 eid(= 마지막 클릭). selectByEid는 실제 selectOne/selectToggle 경로.
async function selectPair(first, primary) {
  return await page.evaluate(([a, b]) => {
    window.__archTest.selectByEid(a, false);
    window.__archTest.selectByEid(b, true);
    const sel = window.__archTest.getSelection();
    return { eids: sel.map((s) => s.eid), primary: sel[sel.length - 1].eid };
  }, [first, primary]);
}
async function selectMany(eids) {
  return await page.evaluate((list) => {
    window.__archTest.selectByEid(list[0], false);
    for (let i = 1; i < list.length; i++) window.__archTest.selectByEid(list[i], true);
    const sel = window.__archTest.getSelection();
    return { eids: sel.map((s) => s.eid), primary: sel[sel.length - 1].eid };
  }, eids);
}
// 프레임 안에서 "그 지점에서 가장 위에 그려진, 해당 종류의 유닛" — elementsFromPoint(위→아래 paint
//   순서)를 훑어 첫 매칭 유닛을 반환한다. 편집-ON 모드의 드래그 오버레이 div(eid 없음)·컨테이너·바깥
//   <svg obj:N> 컨테이너는 자연히 건너뛰고, 실제 유닛의 paint 순서만 본다. 재배치/z-index로 top이
//   실제로 뒤바뀌면 이 값이 뒤바뀐다(순수 시각 스택 증명 — 속성 diff 아님).
async function topUnitAt(cx, cy, kind) {
  const frame = theFrame();
  return await frame.evaluate(([x, y, k]) => {
    for (const el of document.elementsFromPoint(x, y)) {
      const c = el.closest && el.closest("[data-arch-eid]");
      if (!c) continue;
      const eid = c.getAttribute("data-arch-eid");
      if (k === "obj" && /^obj:/.test(eid) && c.tagName.toLowerCase() !== "svg") return eid;
      if (k === "svgc" && /^(svgbox|svgtext|svgedge):/.test(eid)) return eid;
    }
    return null;
  }, [cx, cy, kind]);
}
// 프레임 안에서 종류별 겹침 쌍 후보(면적 큰 배경 제외 옵션) 탐색.
async function findOverlap(kind, { excludeLargest = true } = {}) {
  const frame = theFrame();
  return await frame.evaluate(([kf, exLg]) => {
    const list = [...document.querySelectorAll("[data-arch-eid]")].filter((el) => {
      const e = el.getAttribute("data-arch-eid");
      if (kf === "obj") return /^obj:/.test(e) && el.tagName.toLowerCase() !== "svg";
      if (kf === "svgbox") return /^svgbox:/.test(e);
      return false;
    });
    let rects = list.map((el) => { const r = el.getBoundingClientRect(); return { eid: el.getAttribute("data-arch-eid"), x: r.left, y: r.top, r: r.right, b: r.bottom, area: r.width * r.height, bg: !!(el.style && el.style.background) }; });
    if (exLg && rects.length > 2) { rects = rects.slice().sort((a, b) => b.area - a.area); rects = rects.slice(1); } // 최대(배경) 제외
    const out = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const ox = Math.min(a.r, b.r) - Math.max(a.x, b.x);
      const oy = Math.min(a.b, b.b) - Math.max(a.y, b.y);
      if (ox > 10 && oy > 10) {
        const cx = (Math.max(a.x, b.x) + Math.min(a.r, b.r)) / 2;
        const cy = (Math.max(a.y, b.y) + Math.min(a.b, b.b)) / 2;
        // 종류-인지 top: 오버레이 div/컨테이너를 건너뛰고 첫 매칭 유닛(paint 순서 위→아래).
        let topEid = null;
        for (const el of document.elementsFromPoint(cx, cy)) {
          const c = el.closest && el.closest("[data-arch-eid]");
          if (!c) continue;
          const e = c.getAttribute("data-arch-eid");
          if (kf === "obj" && /^obj:/.test(e) && c.tagName.toLowerCase() !== "svg") { topEid = e; break; }
          if (kf === "svgbox" && /^(svgbox|svgtext|svgedge):/.test(e)) { topEid = e; break; }
        }
        if (topEid === a.eid || topEid === b.eid) out.push({ a: a.eid, b: b.eid, cx: Math.round(cx), cy: Math.round(cy), topEid, bg: a.bg && b.bg });
      }
    }
    out.sort((p, q) => (q.bg ? 1 : 0) - (p.bg ? 1 : 0));  // 배경색 둘 다 있는 쌍 우선(시각 대비)
    return out;
  }, [kind, excludeLargest]);
}
// 겹침 영역 크롭 스크린샷(프레임 좌표 → 페이지 좌표: 프레임 요소 오프셋 + 프레임 로컬).
async function shotClip(name, cx, cy, w = 320, h = 220) {
  const fb = await page.locator("#diagram-frame").boundingBox();
  const clip = { x: Math.max(0, fb.x + cx - w / 2), y: Math.max(0, fb.y + cy - h / 2), width: w, height: h };
  await page.screenshot({ path: path.join(ART, name), clip });
}
// 독립 bleed-diff: eid→outerHTML 맵 비교로 "바뀐 eid 집합"을 구한다(앱 로직 미사용).
async function changedEids(beforeHtml, afterHtml) {
  return await page.evaluate(([ha, hb]) => {
    const P = (h) => new DOMParser().parseFromString(h, "text/html");
    const M = (d) => { const m = {}; d.querySelectorAll("[data-arch-eid]").forEach((el) => { m[el.getAttribute("data-arch-eid")] = el.outerHTML; }); return m; };
    const ma = M(P(ha)), mb = M(P(hb));
    const keys = new Set([...Object.keys(ma), ...Object.keys(mb)]);
    return [...keys].filter((k) => ma[k] !== mb[k]).sort();
  }, [beforeHtml, afterHtml]);
}
// 독립 reorder 검증: (1) primary outerHTML 불변, (2) primary 제거 시 문서 바이트 동일,
//   (3) primary 부모(minus primary) 서명 불변(같은 부모). 앱 로직과 무관하게 재구현.
async function reorderProof(beforeHtml, afterHtml, primaryEid) {
  return await page.evaluate(([ha, hb, pid]) => {
    const P = (h) => new DOMParser().parseFromString(h, "text/html");
    const da = P(ha), db = P(hb);
    const pa = da.querySelector('[data-arch-eid="' + pid + '"]');
    const pb = db.querySelector('[data-arch-eid="' + pid + '"]');
    if (!pa || !pb) return { ok: false, why: "primary 소실" };
    const contentSame = pa.outerHTML === pb.outerHTML;
    // 부모 서명(primary 제거)
    const parSig = (el) => { const p = el.parentNode; if (!p || p.nodeType !== 1) return "#root"; const c = p.cloneNode(true); const x = c.querySelector('[data-arch-eid="' + pid + '"]'); if (x) x.remove(); return (c.tagName || "") + "|" + c.outerHTML; };
    const sameParent = parSig(pa) === parSig(pb);
    // 문서 minus primary 바이트 동일
    const rm = (d) => { const c = d.cloneNode(true); const x = c.querySelector('[data-arch-eid="' + pid + '"]'); if (x) x.remove(); return c.documentElement.outerHTML; };
    const restSame = rm(da) === rm(db);
    // 두 문서가 전체로는 달라야(재배치가 실제 일어남)
    const actuallyMoved = da.documentElement.outerHTML !== db.documentElement.outerHTML;
    return { ok: contentSame && sameParent && restSame && actuallyMoved, contentSame, sameParent, restSame, actuallyMoved };
  }, [beforeHtml, afterHtml, primaryEid]);
}

const SYN_CROSS = `<!doctype html><html lang="ko"><head><meta charset="utf-8"></head>
<body><div class="slide-container" style="position:relative;width:1920px;height:1080px;background:#fff;">
<svg data-object="true" data-object-type="shape" xmlns="http://www.w3.org/2000/svg"
  style="position:absolute;left:0;top:0;width:1920px;height:1080px;z-index:5;" viewBox="0 0 1920 1080">
  <g transform="translate(0 0)" opacity="1" data-lane="A">
    <g transform="translate(300 260)"><rect width="360" height="220" fill="#cfe3ff" stroke="#334" stroke-width="3"/><text x="180" y="115" text-anchor="middle" font-size="34" font-weight="800" fill="#123">BOX A</text></g>
  </g>
  <g transform="translate(0 0)" opacity="0.85" data-lane="B">
    <g transform="translate(480 360)"><rect width="360" height="220" fill="#ffd7d7" stroke="#334" stroke-width="3"/><text x="180" y="115" text-anchor="middle" font-size="34" font-weight="800" fill="#311">BOX B</text></g>
  </g>
</svg></div></body></html>`;

try {
  await page.goto(BASE + "/index.html");
  await waitReady();

  // ═════════ (A) 버튼 존재 + 게이팅 기본 ═════════
  const fb = await page.evaluate(() => window.__archTest.zorderBtn("front"));
  const bb = await page.evaluate(() => window.__archTest.zorderBtn("back"));
  check("(A1) 앞으로/뒤로 버튼이 서식 툴바에 존재", fb && bb && fb.inFmtBar && bb.inFmtBar, JSON.stringify({ fb, bb }));
  await enterOnEdit();
  const capNone = await page.evaluate(() => window.__archTest.zorderCap());
  check("(A2) 선택 0개 → 비활성 + '2개 이상' 사유", capNone.ok === false && /2개 이상/.test(capNone.why || ""), JSON.stringify(capNone));

  // ═════════ (B) OBJ 쌍 flip (p01) ═════════
  const objPairs = await findOverlap("obj");
  check("(B0) p01에서 겹치는 obj 쌍 발견", objPairs.length > 0, JSON.stringify(objPairs.slice(0, 3)));
  const OP = objPairs[0];
  const top0 = OP.topEid;                            // 현재 위에 그려진 쪽
  const other0 = OP.a === top0 ? OP.b : OP.a;
  // 단일 선택 게이팅: 하나만 고르면 비활성
  await page.evaluate((e) => window.__archTest.selectByEid(e, false), top0);
  await settle(80);
  const capSingle = await page.evaluate(() => window.__archTest.zorderCap());
  check("(B1) 단일 선택 → 비활성", capSingle.ok === false, JSON.stringify(capSingle));

  // top0을 primary로(반대쪽 먼저, top0을 나중에 클릭)
  const selB = await selectPair(other0, top0);
  const capObj = await page.evaluate(() => window.__archTest.zorderCap());
  check("(B2) obj 2개 선택 → 활성 · kind=obj · primary=현재 top", capObj.ok === true && capObj.kind === "obj" && selB.primary === top0, JSON.stringify({ capObj, selB, top0 }));
  const btnEnB = await page.evaluate(() => [window.__archTest.zorderBtn("front").disabled, window.__archTest.zorderBtn("back").disabled]);
  check("(B3) 활성 상태에서 두 버튼 모두 enabled", btnEnB[0] === false && btnEnB[1] === false, JSON.stringify(btnEnB));

  const srcB0 = await page.evaluate(() => window.__archTest.getSource());
  const z0 = await page.evaluate(([a, b]) => ({ [a]: window.__archTest.objZIndex(a), [b]: window.__archTest.objZIndex(b) }), [top0, other0]);
  await shotClip("s21_obj_before.png", OP.cx, OP.cy);
  const topBefore = await topUnitAt(OP.cx, OP.cy, "obj");
  check("(B4) 시각: 겹침점 top = " + top0 + " (초기)", topBefore === top0, "measured=" + topBefore);

  // "뒤로 보내기" — primary(top0)을 뒤로
  const d0 = await page.evaluate(() => window.__archTest.undoDepth());
  await page.evaluate(() => window.__archTest.fmtZorder("back"));
  await afterCommit(d0 + 1);
  const topAfter = await topUnitAt(OP.cx, OP.cy, "obj");
  check("(B5) 시각 flip: '뒤로' 후 겹침점 top = " + other0, topAfter === other0, "measured=" + topAfter);
  await shotClip("s21_obj_after.png", OP.cx, OP.cy);
  const zAfter = await page.evaluate(([a, b]) => ({ [a]: window.__archTest.objZIndex(a), [b]: window.__archTest.objZIndex(b) }), [top0, other0]);
  check("(B6) z-index: primary(" + top0 + ")가 상대보다 낮음(min-1)", zAfter[top0] < zAfter[other0] && zAfter[top0] === z0[other0] - 1, JSON.stringify({ z0, zAfter }));
  const srcB1 = await page.evaluate(() => window.__archTest.getSource());
  const chB = await changedEids(srcB0, srcB1);
  check("(B7) bleed-diff: 바뀐 요소가 primary 하나뿐", chB.length === 1 && chB[0] === top0, JSON.stringify(chB));

  // undo 바이트 동일
  await page.evaluate(() => window.__archTest.undo());
  await afterCommit(d0);
  const srcB2 = await page.evaluate(() => window.__archTest.getSource());
  check("(B8) undo 바이트 동일 복원", srcB2 === srcB0);
  const topRestored = await topUnitAt(OP.cx, OP.cy, "obj");
  check("(B9) undo 후 시각 복원(top=" + top0 + ")", topRestored === top0, "measured=" + topRestored);

  // 양방향: 이번엔 other0을 primary로 재선택 → "앞으로" 로 other0을 위로
  const selB2 = await selectPair(top0, other0);
  check("(B10) 반대 유닛 재선택 → primary=" + other0, selB2.primary === other0, JSON.stringify(selB2));
  const d1 = await page.evaluate(() => window.__archTest.undoDepth());
  await page.evaluate(() => window.__archTest.fmtZorder("front"));
  await afterCommit(d1 + 1);
  const topBi = await topUnitAt(OP.cx, OP.cy, "obj");
  check("(B11) 양방향: other 재선택+'앞으로' → top = " + other0, topBi === other0, "measured=" + topBi);
  await page.evaluate(() => window.__archTest.undo());
  await afterCommit(d1);

  // ═════════ (F) 동종 3개 이상 (p01 obj) ═════════
  // primary가 겹침점에서 다른 2개를 모두 덮는 삼중 겹침을 찾는다.
  const tri = await theFrame().evaluate(() => {
    const els = [...document.querySelectorAll("[data-arch-eid]")].filter((el) => /^obj:/.test(el.getAttribute("data-arch-eid")) && el.tagName.toLowerCase() !== "svg");
    const rs = els.map((el) => { const r = el.getBoundingClientRect(); return { eid: el.getAttribute("data-arch-eid"), x: r.left, y: r.top, r: r.right, b: r.bottom, area: r.width * r.height }; });
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) for (let k = j + 1; k < rs.length; k++) {
      const a = rs[i], b = rs[j], c = rs[k];
      const x0 = Math.max(a.x, b.x, c.x), x1 = Math.min(a.r, b.r, c.r);
      const y0 = Math.max(a.y, b.y, c.y), y1 = Math.min(a.b, b.b, c.b);
      if (x1 - x0 > 8 && y1 - y0 > 8) return { eids: [a.eid, b.eid, c.eid], cx: Math.round((x0 + x1) / 2), cy: Math.round((y0 + y1) / 2) };
    }
    return null;
  });
  if (tri) {
    // primary = 초기 z가 가장 낮은 유닛(그래야 '앞으로'가 반드시 변경을 만들고, 규칙대로 '전부 위'가 검증됨).
    const z0Tri = await page.evaluate((eids) => Object.fromEntries(eids.map((e) => [e, window.__archTest.objZIndex(e)])), tri.eids);
    const primaryPick = tri.eids.slice().sort((a, b) => z0Tri[a] - z0Tri[b])[0];
    const order = [...tri.eids.filter((e) => e !== primaryPick), primaryPick];  // primary 마지막
    const selF = await selectMany(order);
    const capF = await page.evaluate(() => window.__archTest.zorderCap());
    const dF = await page.evaluate(() => window.__archTest.undoDepth());
    await page.evaluate(() => window.__archTest.fmtZorder("front"));
    await afterCommit(dF + 1);
    const zF = await page.evaluate((eids) => Object.fromEntries(eids.map((e) => [e, window.__archTest.objZIndex(e)])), tri.eids);
    const pz = zF[selF.primary];
    const others = tri.eids.filter((e) => e !== selF.primary);
    const aboveAll = others.every((e) => pz > zF[e]);   // 규칙: primary가 다른 선택 전부보다 위
    const topTri = await topUnitAt(tri.cx, tri.cy, "obj");
    check("(F1) 3개 동종: '앞으로' → primary(z=" + pz + ")가 다른 선택 전부보다 위(z-rule)",
      capF.kind === "obj" && selF.primary === primaryPick && aboveAll, JSON.stringify({ z0Tri, zF, primary: selF.primary }));
    check("(F2) 3개 동종: 시각도 primary가 삼중 겹침점에서 top", topTri === selF.primary, "measured=" + topTri);
    await page.evaluate(() => window.__archTest.undo());
    await afterCommit(dF);
  } else {
    check("(F1) 3개 동종 겹침 케이스 구성", false, "삼중 겹침 obj 없음");
  }

  // ═════════ (C) class-c 쌍 flip (demo_svg_slide, 겹침 구성) ═════════
  const svgHtml = await (await fetch(BASE + "/demo_svg_slide.html")).text();
  await page.evaluate((h) => window.__archTest.load(h, "demo_svg_slide.html"), svgHtml);
  await afterCommit(null);
  await enterOnEdit();
  // 같은 부모(<svg>)인 svgbox 두 개를 골라 하나를 다른 하나 위로 이동해 겹침 구성.
  const boxIds = await page.evaluate(() => {
    const src = new DOMParser().parseFromString(window.__archTest.getSource(), "text/html");
    return [...src.querySelectorAll('[data-arch-eid^="svgbox:"]')].map((el) => el.getAttribute("data-arch-eid")).slice(0, 8);
  });
  const A = boxIds[0], Bb = boxIds[1];
  const tB = await page.evaluate((e) => window.__archTest.svgTranslate(e), Bb);
  await page.evaluate(([e, t]) => window.__archTest.simSvgMove(e, t.x + 40, t.y + 26), [A, tB]);
  await afterCommit(1);   // simSvgMove = 1 undo
  const cPairs = await findOverlap("svgbox", { excludeLargest: false });
  const CP = cPairs.find((p) => (p.a === A && p.b === Bb) || (p.a === Bb && p.b === A)) || cPairs[0];
  check("(C0) class-c 겹침 구성 성공(같은 부모)", !!CP, JSON.stringify(cPairs.slice(0, 3)));
  const cTop0 = CP.topEid;
  const cOther0 = CP.a === cTop0 ? CP.b : CP.a;
  const capParent = await page.evaluate(([a, b]) => { window.__archTest.selectByEid(a, false); window.__archTest.selectByEid(b, true); return window.__archTest.zorderCap(); }, [cOther0, cTop0]);
  check("(C1) 같은 부모 class-c 2개 → 활성 · kind=svgc", capParent.ok === true && capParent.kind === "svgc", JSON.stringify(capParent));

  const idxBefore = await page.evaluate(([a, b]) => ({ [a]: window.__archTest.svgSiblingIndex(a), [b]: window.__archTest.svgSiblingIndex(b) }), [cTop0, cOther0]);
  const srcC0 = await page.evaluate(() => window.__archTest.getSource());
  await shotClip("s21_svgc_before.png", CP.cx, CP.cy);
  const cTopBefore = await topUnitAt(CP.cx, CP.cy, "svgc");
  check("(C2) 시각: 겹침점 top = " + cTop0 + " (초기)", cTopBefore === cTop0, "measured=" + cTopBefore);

  const dc0 = await page.evaluate(() => window.__archTest.undoDepth());
  await page.evaluate(() => window.__archTest.fmtZorder("back"));   // primary(cTop0)을 뒤로
  await afterCommit(dc0 + 1);
  const cTopAfter = await topUnitAt(CP.cx, CP.cy, "svgc");
  check("(C3) 시각 flip: '뒤로' 후 겹침점 top = " + cOther0, cTopAfter === cOther0, "measured=" + cTopAfter);
  await shotClip("s21_svgc_after.png", CP.cx, CP.cy);
  const idxAfter = await page.evaluate(([a, b]) => ({ [a]: window.__archTest.svgSiblingIndex(a), [b]: window.__archTest.svgSiblingIndex(b) }), [cTop0, cOther0]);
  check("(C4) DOM 형제 순서 실제 변경: primary가 상대보다 앞(작은 인덱스)로",
    idxAfter[cTop0] < idxAfter[cOther0] && idxBefore[cTop0] > idxBefore[cOther0], JSON.stringify({ idxBefore, idxAfter }));
  const srcC1 = await page.evaluate(() => window.__archTest.getSource());
  const proofC = await reorderProof(srcC0, srcC1, cTop0);
  check("(C5) reorder bleed-diff(독립): primary 내용불변·집합밖 위치/내용 불변·같은 부모·실제 이동",
    proofC.ok === true, JSON.stringify(proofC));
  const chC = await changedEids(srcC0, srcC1);
  check("(C6) eid별 outerHTML 관점: primary 자신 내용은 안 바뀜(재배치는 순서만)", !chC.includes(cTop0) || chC.length === 0, JSON.stringify(chC));

  await page.evaluate(() => window.__archTest.undo());
  await afterCommit(dc0);
  const srcC2 = await page.evaluate(() => window.__archTest.getSource());
  check("(C7) undo 바이트 동일 복원(재배치 원복)", srcC2 === srcC0);
  const cTopRestored = await topUnitAt(CP.cx, CP.cy, "svgc");
  check("(C8) undo 후 시각 복원(top=" + cTop0 + ")", cTopRestored === cTop0, "measured=" + cTopRestored);

  // 양방향: cOther0을 primary로 → "앞으로"
  await page.evaluate(([a, b]) => { window.__archTest.selectByEid(a, false); window.__archTest.selectByEid(b, true); }, [cTop0, cOther0]);
  const dc1 = await page.evaluate(() => window.__archTest.undoDepth());
  await page.evaluate(() => window.__archTest.fmtZorder("front"));
  await afterCommit(dc1 + 1);
  const cTopBi = await topUnitAt(CP.cx, CP.cy, "svgc");
  check("(C9) 양방향: other 재선택+'앞으로' → top = " + cOther0, cTopBi === cOther0, "measured=" + cTopBi);
  await page.evaluate(() => window.__archTest.undo());
  await afterCommit(dc1);

  // ═════════ (E) 혼합 obj + class-c (demo_svg_slide) ═════════
  const mixIds = await page.evaluate(() => {
    const src = new DOMParser().parseFromString(window.__archTest.getSource(), "text/html");
    const obj = [...src.querySelectorAll('[data-arch-eid^="obj:"]')].map((el) => el.getAttribute("data-arch-eid"))[0];
    const box = [...src.querySelectorAll('[data-arch-eid^="svgbox:"]')].map((el) => el.getAttribute("data-arch-eid"))[0];
    return { obj, box };
  });
  const capMix = await page.evaluate(([o, b]) => { window.__archTest.selectByEid(o, false); window.__archTest.selectByEid(b, true); return window.__archTest.zorderCap(); }, [mixIds.obj, mixIds.box]);
  const mixBtns = await page.evaluate(() => [window.__archTest.zorderBtn("front"), window.__archTest.zorderBtn("back")]);
  check("(E1) 혼합 obj+class-c → 비활성 + 사유", capMix.ok === false && /같은 종류|class-b|레이어/.test(capMix.why || ""), JSON.stringify(capMix));
  check("(E2) 혼합: 두 버튼 disabled + data-why 설정", mixBtns[0].disabled && mixBtns[1].disabled && mixBtns[0].why, JSON.stringify(mixBtns.map((b) => b.disabled)));
  // 비활성이 실제로 성립: fmtZorder 호출해도 무동작(undoDepth 불변)
  const dMix = await page.evaluate(() => window.__archTest.undoDepth());
  await page.evaluate(() => window.__archTest.fmtZorder("front"));
  await settle(200);
  const dMix2 = await page.evaluate(() => window.__archTest.undoDepth());
  check("(E3) 혼합: 버튼 무동작(커밋 없음)", dMix === dMix2, dMix + "→" + dMix2);

  // ═════════ (D) 다른 부모 class-c (합성 슬라이드) ═════════
  await page.evaluate((h) => window.__archTest.load(h, "synthetic_cross_parent.html"), SYN_CROSS);
  await afterCommit(null);
  await enterOnEdit();
  const crossBoxes = await page.evaluate(() => {
    const src = new DOMParser().parseFromString(window.__archTest.getSource(), "text/html");
    return [...src.querySelectorAll('[data-arch-eid^="svgbox:"]')].map((el) => el.getAttribute("data-arch-eid"));
  });
  check("(D0) 합성 슬라이드에서 svgbox 2개 stamp", crossBoxes.length >= 2, JSON.stringify(crossBoxes));
  // 겹침 확인(다른 부모지만 시각적으로는 겹침)
  const crossPair = await findOverlap("svgbox", { excludeLargest: false });
  const capCross = await page.evaluate(([a, b]) => { window.__archTest.selectByEid(a, false); window.__archTest.selectByEid(b, true); return window.__archTest.zorderCap(); }, [crossBoxes[0], crossBoxes[1]]);
  check("(D1) 다른 부모 class-c → 비활성 + 그룹 경계 사유", capCross.ok === false && /그룹|경계|<g>/.test(capCross.why || ""), JSON.stringify(capCross));
  const crossBtns = await page.evaluate(() => [window.__archTest.zorderBtn("front").disabled, window.__archTest.zorderBtn("back").disabled]);
  check("(D2) 다른 부모: 두 버튼 disabled", crossBtns[0] && crossBtns[1], JSON.stringify(crossBtns));
  // 무동작 확인: DOM 순서·소스 불변
  const idxCrossBefore = await page.evaluate((e) => window.__archTest.svgSiblingIndex(e), crossBoxes[0]);
  const srcCross0 = await page.evaluate(() => window.__archTest.getSource());
  const dCross = await page.evaluate(() => window.__archTest.undoDepth());
  await page.evaluate(() => window.__archTest.fmtZorder("back"));
  await settle(220);
  const srcCross1 = await page.evaluate(() => window.__archTest.getSource());
  const dCross2 = await page.evaluate(() => window.__archTest.undoDepth());
  const idxCrossAfter = await page.evaluate((e) => window.__archTest.svgSiblingIndex(e), crossBoxes[0]);
  check("(D3) 다른 부모: 버튼 무동작(소스·DOM 순서·undo 불변)", srcCross0 === srcCross1 && dCross === dCross2 && idxCrossBefore === idxCrossAfter, JSON.stringify({ eq: srcCross0 === srcCross1, d: dCross + "→" + dCross2 }));
  await shotClip("s21_crossparent_disabled.png", crossPair && crossPair[0] ? crossPair[0].cx : 700, crossPair && crossPair[0] ? crossPair[0].cy : 500, 480, 360);

  check("(z) 페이지 콘솔 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 4).join(" | "));
} catch (err) {
  fail++;
  console.log("FAIL  (예외) " + (err && err.stack ? err.stack.split("\n").slice(0, 6).join("\n") : err));
  try { await page.screenshot({ path: path.join(ART, "s21_failure.png") }); } catch {}
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
