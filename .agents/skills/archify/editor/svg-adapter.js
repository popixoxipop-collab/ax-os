// SvgObjectAdapter — 설계문서 §3.3 class (c): class-b DOM 어댑터의 SVG 확장.
//
// 문제: 수제 슬라이드(P02/P03 리포트)는 다이어그램 전체를 하나의 인라인
//   <svg data-object> 안에 그린다. 그 안의 각 박스는 data-object가 없는
//   <g transform="translate(x y)"><rect .../><text .../></g> 클러스터라
//   closest('[data-object]')가 전부 바깥 svg 하나로 수렴 → 박스 단위 선택 불가.
//
// 해결: 로드 시 각 박스 <g>에 data-arch-eid="svgbox:N"을 STAMP해서 hit-test·편집이
//   바깥 svg가 아니라 박스를 주소로 삼게 한다(class b의 obj:N stamp와 같은 원리).
//
// SVG 좌표계 편집(class b의 CSS 인라인 스타일과 근본적으로 다름):
//   position = <g transform="translate(x y)">   (SVG user units)
//   size     = <rect width height>              (SVG user units)
//   color    = <rect fill> / <rect stroke>      (SVG 속성, CSS background 무효)
//   text     = 대표 <text> 줄
//
// scope 3중 보증은 class b와 동일 축을 재사용한다:
//   1) buildToolSchema  — 모든 op의 eid를 {"const": eid}로 pin (생성 봉쇄)
//   2) sanitizeOps      — scope-gate(ScopeViolation) + 색 토큰/좌표 sanitize
//   3) bleed-diff       — DomAdapter.bleedDiff를 그대로 재사용(허용 eid 집합 축).
//      박스 <g>가 바깥 svg(obj:N)의 후손이므로, bleedDiff의 조상-skip + maskedSerialize
//      경로가 legend/중첩 케이스와 동일하게 "박스 밖 바이트 동일"을 실증한다.
const SvgAdapter = (() => {
  const SVGNS = "http://www.w3.org/2000/svg";

  // 채움/테두리 값 sanitize — 유효한 CSS/SVG 색 토큰만 허용. url()/스크립트/꺾쇠 차단.
  const NAMED_COLORS = new Set([
    "none", "transparent", "currentcolor", "black", "white", "red", "green", "blue",
    "yellow", "orange", "purple", "gray", "grey", "pink", "brown", "cyan", "magenta",
    "lime", "navy", "teal", "olive", "maroon", "silver", "gold", "indigo", "violet",
    "coral", "salmon", "khaki", "crimson", "tomato", "orchid", "plum", "beige", "ivory",
    "lightgray", "lightgrey", "darkgray", "darkgrey", "lightblue", "darkblue",
    "lightgreen", "darkgreen", "steelblue", "slategray", "slategrey", "dimgray",
  ]);
  const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  const RGB_RE = /^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)$/i;
  const HSL_RE = /^hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(,\s*[\d.]+%?\s*)?\)$/i;
  const BAD_COLOR = /url\s*\(|expression|javascript:|[<>]/i;

  function isColorToken(v) {
    if (typeof v !== "string") return false;
    const s = v.trim();
    if (!s || s.length > 64 || BAD_COLOR.test(s)) return false;
    if (HEX_RE.test(s)) return true;
    if (RGB_RE.test(s)) return true;
    if (HSL_RE.test(s)) return true;
    return NAMED_COLORS.has(s.toLowerCase());
  }
  function isFiniteNum(v) {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n);
  }
  function num(v, dflt) { const n = parseFloat(v); return Number.isFinite(n) ? n : dflt; }

  // ---------------- D21: 서식(text style) 어휘 ----------------
  // ★ 적용 단위는 **<text> 요소(=줄) 전체**다. 문자 단위(부분 굵게)가 아니다.
  //   WHY: SVG에는 rich text가 없다. 한 줄 안에서 일부만 굵게 하려면 <tspan>으로 런을 쪼개고
  //        문서 모델(줄=하나의 <text>)을 바꿔야 하는데, 그러면 setText/줄 인덱스/수직 재배분
  //        (D16·D20)이 전부 재정의된다. 지금 모델과 정합적이고 안전한 층위는 "줄"이다.
  //   COST: "이 단어만 굵게"는 불가 — UI가 이 한계를 명시한다(가짜 선택범위 어포던스 금지).
  const TEXT_STYLE_ATTR = {
    fontFamily: "font-family",
    fontSize: "font-size",
    fontWeight: "font-weight",
    fontStyle: "font-style",
    textDecoration: "text-decoration",
    letterSpacing: "letter-spacing",
    textAnchor: "text-anchor",
    fill: "fill",
  };
  const TEXT_STYLE_KEYS = Object.keys(TEXT_STYLE_ATTR);
  // 글꼴 이름은 한글 폰트("맑은 고딕")·따옴표·콤마를 허용하되 url()/인젝션 문자는 전면 차단.
  const BAD_FONT = /url\s*\(|expression|javascript:|[<>{};]/i;
  const WEIGHT_RE = /^(normal|bold|[1-9]00)$/;
  const STYLE_RE = /^(normal|italic|oblique)$/;
  const DECOR_RE = /^(none|underline|line-through|underline line-through)$/;
  const ANCHOR_RE = /^(start|middle|end)$/;
  const FONT_MIN = 4, FONT_MAX = 400;         // 렌더 가능한 범위(그 밖은 사실상 사라지거나 캔버스를 덮는다)
  const TRACK_MIN = -5, TRACK_MAX = 20;       // 자간(user units) — 음수 트래킹도 실제 디자인에서 쓰인다
  const SPACING_MIN = 1.0, SPACING_MAX = 3.0; // 줄간격(폰트 크기 배수)

  // 서식 값 sanitize — 통과하면 그대로 SVG 속성 값이 된다. 실패는 null(호출측이 note로 남김).
  function cleanTextStyleValue(key, v) {
    if (v == null) return null;
    if (key === "fill") return isColorToken(v) ? String(v).trim() : null;
    if (key === "fontFamily") {
      const s = String(v).trim();
      return s && s.length <= 120 && !BAD_FONT.test(s) ? s : null;
    }
    if (key === "fontSize") {
      const n = parseFloat(v);
      return Number.isFinite(n) && n >= FONT_MIN && n <= FONT_MAX ? fmt(n) : null;
    }
    if (key === "letterSpacing") {
      const n = parseFloat(v);
      return Number.isFinite(n) && n >= TRACK_MIN && n <= TRACK_MAX ? fmt(n) : null;
    }
    const s = String(v).trim();
    if (key === "fontWeight") return WEIGHT_RE.test(s) ? s : null;
    if (key === "fontStyle") return STYLE_RE.test(s) ? s : null;
    if (key === "textDecoration") return DECOR_RE.test(s) ? s : null;
    if (key === "textAnchor") return ANCHOR_RE.test(s) ? s : null;
    return null;
  }

  // ---------------- 선택 "집합" 정규화 (D22) ----------------
  // 단일 선택은 크기 1의 집합이다 — 이 한 줄이 D22 일반화의 전부다. 아래 모든 보증층
  // (스키마 pin · scope-gate · bleed-diff)이 같은 집합 S를 축으로 돈다.
  function toEidSet(spec) {
    if (spec instanceof Set) return spec;
    if (Array.isArray(spec)) return new Set(spec);
    return new Set([spec]);
  }
  // shape은 eid마다 다르다(rect / polygon / path) → 문자열·맵·함수 어느 형태로 와도 해석한다.
  function mkShapeResolver(spec) {
    if (typeof spec === "function") return spec;
    if (spec && typeof spec === "object") return (eid) => spec[eid];
    return () => spec;
  }
  // ★ 스키마 id pin의 일반화: |S|=1이면 {const}(기존과 **바이트 동일**), |S|>1이면 {enum}.
  //   어느 쪽이든 "집합 밖 eid는 생성 자체가 불가능"이라는 1차 보증의 강도는 같다.
  function pinFor(list) {
    const a = [...list];
    return a.length === 1 ? { const: a[0] } : { enum: a };
  }

  // ---------------- STAMP: 박스 <g> 주소 부여 ----------------

  // "박스" 판정: transform="translate(...)"를 가진 <g>로, 직접 자식에 도형(rect/polygon/
  // path/ellipse/circle/line) 하나 이상 + <text> 하나 이상을 가진 것. 주 도형이 rect면
  // resize 가능(data-svgbox-shape="rect"), 아니면(게이트 path·다이아 polygon) 이동·색·
  // 텍스트만 — resize는 유보(정직하게 보고). data-arch-eid는 문서 순서로 전역 채번.
  const SHAPE_PRIORITY = ["rect", "polygon", "path", "ellipse", "circle", "line"];

  function directChildren(el, tag) {
    const out = [];
    for (let i = 0; i < el.children.length; i++) {
      if (el.children[i].tagName.toLowerCase() === tag) out.push(el.children[i]);
    }
    return out;
  }
  function primaryShape(g) {
    for (const tag of SHAPE_PRIORITY) {
      const list = directChildren(g, tag);
      if (list.length) return list[0];
    }
    return null;
  }
  function parseTranslate(g) {
    const t = g.getAttribute("transform") || "";
    const m = /translate\(\s*(-?[\d.]+)(?:[ ,]+(-?[\d.]+))?\s*\)/.exec(t);
    if (!m) return null;
    return { x: parseFloat(m[1]), y: m[2] != null ? parseFloat(m[2]) : 0 };
  }

  // 문서 안 모든 <svg data-object> 아래 박스 <g>를 stamp. 이미 svgbox:N이 있으면 보존해
  // (Q6: 재열기 시 핀 안정) 새 채번은 기존 최댓값+1부터 잇는다. 반환 { count(총 박스), stamped(신규), rectCount(총 rect) }.
  function stampBoxes(doc) {
    // 기존 svgbox:N 최댓값 파악 → 새 stamp는 그 다음 번호부터(핀 충돌·재사용 방지).
    let next = 0;
    doc.querySelectorAll('[data-svgbox="1"]').forEach((g) => {
      const m = /svgbox:(\d+)/.exec(g.getAttribute("data-arch-eid") || "");
      if (m) next = Math.max(next, parseInt(m[1], 10) + 1);
    });
    let stamped = 0;
    const svgs = doc.querySelectorAll('svg[data-object="true"], svg[data-object]');
    svgs.forEach((svg) => {
      const gs = svg.querySelectorAll("g");
      gs.forEach((g) => {
        if (g.hasAttribute("data-arch-eid")) return;          // 이미 stamp됨(재로드 안전)
        if (!parseTranslate(g)) return;                        // translate 없는 <g> 제외
        const shape = primaryShape(g);
        if (!shape) return;                                    // 도형 없는 <g> 제외
        if (!directChildren(g, "text").length) return;         // 텍스트 없는 <g> 제외
        const tag = shape.tagName.toLowerCase();
        g.setAttribute("data-arch-eid", "svgbox:" + next);
        g.setAttribute("data-svgbox", "1");
        g.setAttribute("data-svgbox-shape", tag);
        stamped++; next++;
      });
    });
    const all = [...doc.querySelectorAll('[data-svgbox="1"]')];
    const rectCount = all.filter((g) => g.getAttribute("data-svgbox-shape") === "rect").length;
    return { count: all.length, stamped, rectCount };
  }

  // D16(b): 박스 <g> 밖의 "자유 <text>"(엣지 라벨·주석·YES/NO 등)를 신규 단위 svgtext:N으로 stamp.
  // ★ 반드시 stampBoxes 뒤에 실행 — data-svgbox가 찍혀 있어야 "박스 안 텍스트"를 제외할 수 있다.
  // 규칙: <svg data-object> 안의 <text> 중 (1) 이미 stamp된 것 제외, (2) data-svgbox 후손(박스가
  //   소유)은 제외, (3) <defs>/<marker> 내부는 제외. 나머지가 개별 선택·편집 단위가 된다.
  //   (하단 evidence <table>·헤더 div는 애초에 svg 밖이라 자연 제외된다.)
  function stampTexts(doc) {
    let next = 0;
    doc.querySelectorAll('[data-svgtext="1"]').forEach((t) => {
      const m = /svgtext:(\d+)/.exec(t.getAttribute("data-arch-eid") || "");
      if (m) next = Math.max(next, parseInt(m[1], 10) + 1);
    });
    let stamped = 0;
    const svgs = doc.querySelectorAll('svg[data-object="true"], svg[data-object]');
    svgs.forEach((svg) => {
      svg.querySelectorAll("text").forEach((t) => {
        if (t.hasAttribute("data-arch-eid")) return;    // 이미 stamp됨(재로드/svgbox 안전)
        if (t.closest('[data-svgbox="1"]')) return;      // 박스가 소유 — svgbox 선택이 잡는다
        if (t.closest("defs")) return;                   // defs/marker 내부는 그리기 자원(제외)
        t.setAttribute("data-arch-eid", "svgtext:" + next);
        t.setAttribute("data-svgtext", "1");
        stamped++; next++;
      });
    });
    const all = [...doc.querySelectorAll('[data-svgtext="1"]')];
    return { count: all.length, stamped };
  }

  // R7/D14 3차 확장: 화살표(엣지)를 신규 단위 svgedge:N으로 stamp.
  // ★ 반드시 stampBoxes/stampTexts 뒤에 실행 — data-svgbox가 찍혀 있어야 "박스가 소유한 화살표"를
  //   제외할 수 있다(현 슬라이드엔 없지만 규칙은 동일하게 둔다).
  // 규칙: <svg data-object> 안에서 marker-end를 가진 <line>/<path> 중 (1) 이미 stamp된 것 제외,
  //   (2) <defs> 내부(marker 자원의 화살촉 <path>)는 제외, (3) 박스 <g> 후손 제외.
  //   지원 도형은 <line>·<path>뿐 — 그 외 태그(polyline 등)에 marker-end가 붙어 있으면 정직하게
  //   건너뛰고(skipped) 보고한다(기하 편집 스키마가 2점/M·L 정점열 전제라서).
  function stampEdges(doc) {
    let next = 0;
    doc.querySelectorAll('[data-svgedge="1"]').forEach((el) => {
      const m = /svgedge:(\d+)/.exec(el.getAttribute("data-arch-eid") || "");
      if (m) next = Math.max(next, parseInt(m[1], 10) + 1);
    });
    let stamped = 0, skipped = 0;
    const svgs = doc.querySelectorAll('svg[data-object="true"], svg[data-object]');
    svgs.forEach((svg) => {
      svg.querySelectorAll("[marker-end]").forEach((el) => {
        if (el.hasAttribute("data-arch-eid")) return;     // 이미 stamp됨(재로드/박스 안전)
        if (el.closest("defs")) return;                    // marker 정의 내부 = 그리기 자원
        if (el.closest('[data-svgbox="1"]')) return;       // 박스가 소유 — svgbox 선택이 잡는다
        const tag = el.tagName.toLowerCase();
        if (tag !== "line" && tag !== "path") { skipped++; return; }
        el.setAttribute("data-arch-eid", "svgedge:" + next);
        el.setAttribute("data-svgedge", "1");
        stamped++; next++;
      });
    });
    const all = [...doc.querySelectorAll('[data-svgedge="1"]')];
    return { count: all.length, stamped, skipped };
  }

  function isSvgBoxEid(eid) { return typeof eid === "string" && eid.indexOf("svgbox:") === 0; }
  function isSvgTextEid(eid) { return typeof eid === "string" && eid.indexOf("svgtext:") === 0; }
  function isSvgEdgeEid(eid) { return typeof eid === "string" && eid.indexOf("svgedge:") === 0; }
  function isSvgEid(eid) { return isSvgBoxEid(eid) || isSvgTextEid(eid) || isSvgEdgeEid(eid); }
  function getEdge(doc, eid) { return isSvgEdgeEid(eid) ? doc.querySelector('[data-arch-eid="' + eid + '"]') : null; }

  // ---------------- 화살표 기하 (정점열) ----------------
  // <line>은 (x1,y1)-(x2,y2) 2점. <path>는 d의 M/L 절대 정점열(직교 라우팅이라 곡선이 없다).
  // 파서는 "전량 소비" 검증형이다: 모든 토큰이 [명령 + 수 + 수]로 정확히 소진되고 명령이 M,L,L…
  // 순서일 때만 정점을 돌려준다. 곡선(C/Q/A)·상대명령(m/l)·Z·암묵 lineto가 하나라도 섞이면 null
  // → 기하 편집(flip/vertex)은 정직하게 거부하고 화살촉 크기 조절만 허용한다.
  function parsePathPoints(d) {
    const s = String(d || "").trim();
    if (!s) return null;
    const toks = s.match(/[A-Za-z]|-?\d*\.?\d+(?:e[+-]?\d+)?/gi);
    if (!toks) return null;
    // 재조립 검증: 구분자(공백·쉼표)만 제거한 원문과 토큰 연결이 같아야 = 미해석 문자 0
    if (toks.join("") !== s.replace(/[\s,]/g, "")) return null;
    const pts = [];
    for (let i = 0; i < toks.length; i += 3) {
      const c = toks[i];
      if (!/^[A-Za-z]$/.test(c)) return null;
      if (pts.length === 0 ? c !== "M" : c !== "L") return null;
      const x = parseFloat(toks[i + 1]), y = parseFloat(toks[i + 2]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      pts.push({ x, y });
    }
    if (pts.length < 2) return null;
    return pts;
  }

  // 원문 스타일 그대로 재직렬화: "M145,80 L145,130" (쉼표=좌표쌍, 공백=명령 구분)
  function pointsToD(pts) {
    return pts.map((p, i) => (i === 0 ? "M" : " L") + fmt(p.x) + "," + fmt(p.y)).join("");
  }

  // 화살표 정점열 판독. 편집 불가 기하(곡선 등)면 points=null.
  function edgePoints(el) {
    if (!el) return null;
    const tag = el.tagName.toLowerCase();
    if (tag === "line") {
      const p = [
        { x: num(el.getAttribute("x1"), NaN), y: num(el.getAttribute("y1"), NaN) },
        { x: num(el.getAttribute("x2"), NaN), y: num(el.getAttribute("y2"), NaN) },
      ];
      return p.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)) ? p : null;
    }
    if (tag === "path") return parsePathPoints(el.getAttribute("d"));
    return null;
  }

  // 정점열 기록. <line>은 2점일 때만 유지, 3점 이상이면 호출측이 promoteLineToPath로 승격한 뒤 쓴다.
  function writeEdgePoints(el, pts) {
    const tag = el.tagName.toLowerCase();
    if (tag === "line") {
      el.setAttribute("x1", fmt(pts[0].x)); el.setAttribute("y1", fmt(pts[0].y));
      el.setAttribute("x2", fmt(pts[1].x)); el.setAttribute("y2", fmt(pts[1].y));
      return el;
    }
    el.setAttribute("d", pointsToD(pts));
    return el;
  }

  // <line>이 정점을 얻으면 등가 <path>로 승격한다. stroke/marker/stamp 속성은 그대로 옮기고
  // x1/y1/x2/y2만 d로 대체 + fill="none"(없을 때만) 보강 — 렌더 결과는 동일해야 한다.
  function promoteLineToPath(doc, el, pts) {
    const p = doc.createElementNS(SVGNS, "path");
    [...el.attributes].forEach((a) => {
      const n = a.name.toLowerCase();
      if (n === "x1" || n === "y1" || n === "x2" || n === "y2") return;
      p.setAttribute(a.name, a.value);
    });
    if (!p.hasAttribute("fill")) p.setAttribute("fill", "none");
    p.setAttribute("d", pointsToD(pts));
    el.replaceWith(p);
    return p;
  }

  // ---------------- 화살촉(marker) — ★ 공유 자원이라 "클론 후 지정" ----------------
  // #ah 하나를 39개 화살표가 공유한다. 원본을 키우면 39개가 전부 커져 요소 범위 보증이 깨진다
  // (bleed-diff가 전부 위반으로 잡음). 그래서 화살표별 전용 marker를 복제해 그 화살표의 marker-end만
  // 돌린다. 반복 조절 시 같은 클론을 갱신하므로 defs가 무한 증식하지 않는다.
  const HEAD_MIN = 0.4, HEAD_MAX = 4;
  function eidSlug(eid) { return String(eid).replace(/:/g, "-"); }
  function markerCloneId(baseId, eid) { return baseId + "--" + eidSlug(eid); }
  function markerRefOf(el) {
    const m = /url\(\s*#([^)\s]+)\s*\)/.exec((el && el.getAttribute("marker-end")) || "");
    return m ? m[1] : null;
  }
  // 현재 참조가 이 화살표 전용 클론이면 원본 base id를 되돌린다 → 배수가 누적되지 않고 항상 절대 배율.
  function baseMarkerIdFor(el, eid) {
    const cur = markerRefOf(el);
    if (!cur) return null;
    const suf = "--" + eidSlug(eid);
    return cur.length > suf.length && cur.slice(-suf.length) === suf ? cur.slice(0, -suf.length) : cur;
  }
  function findMarker(doc, id) {
    if (!id) return null;
    const el = doc.querySelector('marker[id="' + String(id).replace(/["\\]/g, "\\$&") + '"]');
    return el && el.tagName.toLowerCase() === "marker" ? el : null;
  }
  function headScaleOf(el) {
    const v = num(el && el.getAttribute("data-svgedge-head"), 1);
    return Number.isFinite(v) && v > 0 ? v : 1;
  }

  // ---------------- ★ 화살촉 배율의 단일 적용 지점 (개별·일괄 공용) ----------------
  // ★ refX/refY 비례 스케일 + 콘텐츠 실제 확대가 둘 다 필요하다.
  //   viewBox 없는 marker는 markerWidth/Height가 "클리핑 뷰포트 크기"일 뿐 콘텐츠를 스케일하지
  //   않는다 → 크기만 키우면 화살촉은 그대로고 refX만 밀려 선 끝에서 떨어져 보인다(D18 실측:
  //   속성만 키우면 렌더 잉크가 오히려 줄어든다). 그래서
  //   (a) 자식들을 <g transform="scale(s)">로 감싸 실제로 키우고 (b) refX·refY도 s배 한다
  //   (refX=9/markerWidth=10 비율 0.9 유지, refY=4=높이의 절반이라 s배해도 중앙 유지).
  //   원본에 viewBox가 있으면 콘텐츠는 뷰포트에 맞춰 자동 스케일되고 refX/refY는 viewBox 좌표계라
  //   그대로 둔다(그쪽이 정답).
  //
  // 반복 조절이 누적되지 않도록(항상 절대 배율) "원본 기하"를 data-arch-head-base에 최초 1회
  // 각인하고 이후 계산은 언제나 거기서 출발한다. 래퍼 <g>는 data-arch-head-wrap="1"로 표식해
  // 되돌리기(벗기기)가 모호하지 않다 — 이래야 일괄 조절이 개별 클론 위에 덧씌워도 3중 스케일이
  // 되지 않는다.
  const HEAD_BASE_ATTR = "data-arch-head-base";     // "mw,mh,refX,refY" (원본 기하)
  const HEAD_SCALE_ATTR = "data-arch-head-scale";   // 현재 적용 배율(절대)
  const HEAD_WRAP_ATTR = "data-arch-head-wrap";     // 콘텐츠 스케일 래퍼 <g> 표식

  // marker의 "원본" 기하 — 각인이 있으면 그것, 없으면 현재 속성(=아직 손대지 않은 원본).
  function headBaseGeom(m) {
    const raw = m.getAttribute(HEAD_BASE_ATTR);
    if (raw) {
      const p = String(raw).split(",").map((v) => parseFloat(v));
      if (p.length === 4 && p.every((v) => Number.isFinite(v))) return { mw: p[0], mh: p[1], rx: p[2], ry: p[3] };
    }
    return {
      mw: num(m.getAttribute("markerWidth"), 10), mh: num(m.getAttribute("markerHeight"), 8),
      rx: num(m.getAttribute("refX"), 0), ry: num(m.getAttribute("refY"), 0),
    };
  }
  // marker의 "원본" 자식(복제본) — 스케일 래퍼가 있으면 벗겨서 돌려준다.
  function headBaseChildren(m) {
    let wrap = null;
    for (let i = 0; i < m.children.length; i++) {
      if (m.children[i].getAttribute && m.children[i].getAttribute(HEAD_WRAP_ATTR) === "1") { wrap = m.children[i]; break; }
    }
    const src = wrap ? [...wrap.childNodes] : [...m.childNodes];
    return src.map((n) => n.cloneNode(true));
  }
  function markerHeadScale(m) {
    const v = num(m && m.getAttribute(HEAD_SCALE_ATTR), 1);
    return Number.isFinite(v) && v > 0 ? v : 1;
  }

  // marker 하나를 절대 배율 s로 만든다. 개별(클론)·일괄(공유 marker) 두 경로가 이 함수를 공유한다.
  function setMarkerHeadScale(doc, m, scale) {
    const s = Math.max(HEAD_MIN, Math.min(HEAD_MAX, scale));
    const base = headBaseGeom(m);
    if (!m.hasAttribute(HEAD_BASE_ATTR)) m.setAttribute(HEAD_BASE_ATTR, [base.mw, base.mh, base.rx, base.ry].map(fmt).join(","));
    const kids = headBaseChildren(m);
    while (m.firstChild) m.removeChild(m.firstChild);
    const hasVB = m.hasAttribute("viewBox");
    if (hasVB || s === 1) {
      kids.forEach((n) => m.appendChild(n));               // 등배는 래퍼 없이 원본 그대로
    } else {
      const g = doc.createElementNS(SVGNS, "g");
      g.setAttribute(HEAD_WRAP_ATTR, "1");
      g.setAttribute("transform", "scale(" + fmt(s) + ")");
      kids.forEach((n) => g.appendChild(n));
      m.appendChild(g);
    }
    m.setAttribute("markerWidth", fmt(base.mw * s));
    m.setAttribute("markerHeight", fmt(base.mh * s));
    if (!hasVB) { m.setAttribute("refX", fmt(base.rx * s)); m.setAttribute("refY", fmt(base.ry * s)); }
    m.setAttribute(HEAD_SCALE_ATTR, fmt(s));
    return s;
  }

  // 개별(요소 스코프) 경로 — 그 화살표 전용 클론을 만들고 setMarkerHeadScale로 크기를 준다.
  // 공유 marker는 읽기만 한다(바이트 불변) → bleed-diff가 "파생 marker 1개 추가"만 보게 된다.
  function applyHeadSize(doc, el, eid, scale) {
    const s = Math.max(HEAD_MIN, Math.min(HEAD_MAX, scale));
    const baseId = baseMarkerIdFor(el, eid);
    if (!baseId) return { ok: false, note: "marker-end가 없어 화살촉 크기를 바꿀 수 없습니다." };
    const base = findMarker(doc, baseId);
    if (!base) return { ok: false, note: "원본 marker(#" + baseId + ")를 찾을 수 없습니다." };
    const cloneId = markerCloneId(baseId, eid);
    let clone = findMarker(doc, cloneId);
    if (clone && clone.getAttribute("data-arch-edge-clone") !== eid) {
      return { ok: false, note: "marker id 충돌: " + cloneId };
    }
    if (!clone) {
      clone = doc.createElementNS(SVGNS, "marker");
      [...base.attributes].forEach((a) => { if (a.name.toLowerCase() !== "id") clone.setAttribute(a.name, a.value); });
      clone.setAttribute("id", cloneId);
      clone.setAttribute("data-arch-edge-clone", eid);
      // base가 일괄 조절로 이미 스케일돼 있어도, 원본 기하(각인)와 원본 자식(래퍼 벗김)에서
      // 출발하므로 클론 배율은 언제나 "원본 대비 절대값"이다(전역 위에 곱해지지 않는다).
      headBaseChildren(base).forEach((n) => clone.appendChild(n));
      base.parentNode.insertBefore(clone, base.nextSibling);
    }
    setMarkerHeadScale(doc, clone, s);
    el.setAttribute("marker-end", "url(#" + cloneId + ")");
    el.setAttribute("data-svgedge-head", fmt(s));
    return { ok: true, cloneId, baseId, scale: s };
  }

  // ---------------- 전역(문서 단위) 화살촉 크기 — D18 EXIT의 명시적 구현 ----------------
  // 개별 경로의 의도적 정반대: 공유 marker(#ah/#ah-muted/#ah-red)를 직접 스케일하므로 그
  // marker를 쓰는 모든 화살표가 한 번에 바뀐다. "일괄"의 뜻을 지키려고 **이전에 만들어진
  // 화살표 전용 클론까지 같은 배율**로 맞춘다 — 안 그러면 클론을 쓰는 화살표만 옛 크기로 남아
  // 사용자가 요청한 "전부 같은 크기"가 성립하지 않는다(=개별 조정 덮어쓰기, UI에 명시).
  // 요소 스코프가 아니므로 bleed-diff로 지킬 수 없다 → 확인 다이얼로그 + 단일 스냅샷 undo가
  // 안전망(설계 §4.3-5). 배율은 언제나 원본 기준 절대값이라 반복 적용이 누적되지 않는다.
  function markerInventory(doc) {
    const all = [...doc.querySelectorAll("marker")];
    const scales = all.map((m) => markerHeadScale(m));
    return {
      total: all.length,
      shared: all.filter((m) => !m.hasAttribute("data-arch-edge-clone")).length,
      clones: all.filter((m) => m.hasAttribute("data-arch-edge-clone")).length,
      scales: [...new Set(scales)].sort((a, b) => a - b),
      uniform: scales.length ? scales.every((v) => v === scales[0]) : true,
      edges: doc.querySelectorAll('[data-svgedge="1"]').length,
      // 개별 조정이 몇 개나 덮어써지는지(확인 다이얼로그 문구용)
      overridden: all.filter((m) => m.hasAttribute("data-arch-edge-clone")).length,
    };
  }

  function setGlobalHeadSize(doc, scale) {
    const s0 = parseFloat(scale);
    if (!Number.isFinite(s0) || s0 <= 0) return { ok: false, note: "화살촉 배율이 유효하지 않습니다." };
    const s = Math.max(HEAD_MIN, Math.min(HEAD_MAX, s0));
    const markers = [...doc.querySelectorAll("marker")];
    if (!markers.length) return { ok: false, note: "이 문서에는 화살촉 marker가 없습니다." };
    markers.forEach((m) => setMarkerHeadScale(doc, m, s));
    // 화살표에 남은 개별 배율 기록도 같은 값으로 — 패널 슬라이더가 실제 렌더 크기와 어긋나면
    // 다음 개별 조절이 "안 움직이는 슬라이더"처럼 보인다. 배율 축은 하나(1.0=원작 크기)로 통일.
    const edges = [...doc.querySelectorAll('[data-svgedge="1"]')];
    edges.forEach((e) => e.setAttribute("data-svgedge-head", fmt(s)));
    return { ok: true, scale: s, markers: markers.length, edges: edges.length, clamped: s !== s0 };
  }
  function getText(doc, eid) { return isSvgTextEid(eid) ? doc.querySelector('[data-arch-eid="' + eid + '"]') : null; }

  // 자유 <text>의 위치 판독 — x/y 속성 우선, transform="translate(...)"면 그쪽. (대부분 x/y.)
  function parseTextPos(t) {
    const tr = t.getAttribute("transform") || "";
    const m = /translate\(\s*(-?[\d.]+)(?:[ ,]+(-?[\d.]+))?\s*\)/.exec(tr);
    if (m) return { x: parseFloat(m[1]), y: m[2] != null ? parseFloat(m[2]) : 0, mode: "transform" };
    return { x: num(t.getAttribute("x"), 0), y: num(t.getAttribute("y"), 0), mode: "xy" };
  }

  function getBox(doc, eid) {
    if (!isSvgBoxEid(eid)) return null;
    return doc.querySelector('[data-arch-eid="' + eid + '"]');
  }
  function shapeOf(doc, eid) {
    const g = getBox(doc, eid);
    return g ? (g.getAttribute("data-svgbox-shape") || "rect") : null;
  }
  function isResizable(doc, eid) { return shapeOf(doc, eid) === "rect"; }

  // ---------------- 대표 텍스트 줄 ----------------
  // 박스의 "주 라벨" = font-size 속성이 가장 큰 <text>(동률이면 후순위=본문). STEP 소라벨
  // (작은 font-size, fill=#6b7280)이 아니라 굵은 본문 줄을 고른다.
  function mainTextEl(g) {
    const texts = directChildren(g, "text");
    if (!texts.length) return null;
    let best = texts[0], bestSize = num(texts[0].getAttribute("font-size"), 0);
    for (let i = 1; i < texts.length; i++) {
      const s = num(texts[i].getAttribute("font-size"), 0);
      if (s >= bestSize) { best = texts[i]; bestSize = s; }   // >= : 동률 시 후순위(본문)
    }
    return best;
  }

  // ---------------- 스냅샷 / 컨텍스트 ----------------

  // 자유 <text> 단위 스냅샷(D16 b). 크기(w/h)는 없음 — resizable=false.
  function textSnapshot(doc, eid) {
    const t = getText(doc, eid);
    if (!t) return {};
    const p = parseTextPos(t);
    return {
      kind: "svgtext",
      shape: "text",
      fill: t.getAttribute("fill") || "",
      stroke: "",
      text: (t.textContent || "").replace(/\s+/g, " ").trim(),
      x: p.x, y: p.y, posMode: p.mode,
      width: null, height: null,
      resizable: false,
    };
  }

  // 화살표 단위 스냅샷 — 정점열 + 선/화살촉 정보. editable=false면 기하 편집 불가(곡선 등).
  function edgeSnapshot(doc, eid) {
    const el = getEdge(doc, eid);
    if (!el) return {};
    const pts = edgePoints(el);
    return {
      kind: "svgedge",
      shape: "edge",
      tag: el.tagName.toLowerCase(),
      points: pts ? pts.map((p) => ({ x: p.x, y: p.y })) : null,
      vertexCount: pts ? pts.length : 0,
      editable: !!pts,
      stroke: el.getAttribute("stroke") || "",
      strokeWidth: num(el.getAttribute("stroke-width"), 1),
      markerEnd: markerRefOf(el),
      baseMarker: baseMarkerIdFor(el, eid),
      headScale: headScaleOf(el),
      text: "", width: null, height: null, resizable: false,   // 화살표엔 텍스트·크기 개념이 없다
    };
  }

  function styleSnapshot(doc, eid) {
    if (isSvgEdgeEid(eid)) return edgeSnapshot(doc, eid);
    if (isSvgTextEid(eid)) return textSnapshot(doc, eid);
    const g = getBox(doc, eid);
    if (!g) return {};
    const shape = primaryShape(g);
    const t = parseTranslate(g) || { x: 0, y: 0 };
    const label = mainTextEl(g);
    const rect = directChildren(g, "rect")[0] || null;
    // D16(a): 박스의 모든 <text> 줄을 문서 순서로 노출(패널 다중필드 + LLM 줄 타깃팅용).
    const texts = directChildren(g, "text");
    const lines = texts.map((tx, i) => ({
      index: i,
      text: (tx.textContent || "").replace(/\s+/g, " ").trim(),
      fontSize: num(tx.getAttribute("font-size"), 0),
      anchor: tx.getAttribute("text-anchor") || "",
      weight: tx.getAttribute("font-weight") || "",
      fill: tx.getAttribute("fill") || "",
      y: num(tx.getAttribute("y"), null),
    }));
    const mainLine = label ? texts.indexOf(label) : (texts.length ? 0 : -1);
    // 줄 추가 여지 미리보기(패널 "+" 활성/비활성 + 안내 문구용) — 실제 추가와 같은 배분 규칙으로 시뮬레이션.
    const sizes = lines.map((l) => (l.fontSize > 0 ? l.fontSize : 12));
    const nextSize = sizes.length ? sizes[sizes.length - 1] : null;
    const canAddLine = !sizes.length || !planLines(g, sizes.concat([nextSize]), textBlockCenter(g)).overflow;
    return {
      shape: g.getAttribute("data-svgbox-shape") || (shape ? shape.tagName.toLowerCase() : ""),
      fill: shape ? (shape.getAttribute("fill") || "") : "",
      stroke: shape ? (shape.getAttribute("stroke") || "") : "",
      text: label ? (label.textContent || "").replace(/\s+/g, " ").trim() : "",
      x: t.x, y: t.y,
      width: rect ? num(rect.getAttribute("width"), null) : null,
      height: rect ? num(rect.getAttribute("height"), null) : null,
      resizable: g.getAttribute("data-svgbox-shape") === "rect",
      lines, mainLine, canAddLine,
      shapeBox: shapeBoxOf(g),
    };
  }

  // LLM 컨텍스트(§4.1 class c 열): 박스 <g> outerHTML + 현재 fill/stroke/size/translate + 뷰포트.
  function liveBox(liveRect) {
    return liveRect
      ? { left: Math.round(liveRect.x), top: Math.round(liveRect.y), width: Math.round(liveRect.w), height: Math.round(liveRect.h) }
      : null;
  }

  // 자유 <text> 단위 LLM 컨텍스트 — setText/setFill/move만(stroke·resize 없음).
  function textContextFor(doc, eid, liveRect) {
    const t = getText(doc, eid);
    if (!t) throw new Error("선택 SVG 텍스트를 소스 문서에서 찾을 수 없음: " + eid);
    const svg = t.closest("svg");
    const snap = textSnapshot(doc, eid);
    return {
      eid, kind: "svgtext", shape: "text", resizable: false,
      outerHTML: t.outerHTML,
      current: { fill: snap.fill, stroke: "", text: snap.text, x: snap.x, y: snap.y },
      viewBox: svg ? (svg.getAttribute("viewBox") || "") : "",
      box: liveBox(liveRect),
    };
  }

  // 화살표 단위 LLM 컨텍스트 — flipEdge/moveVertex/addVertex/deleteVertex/setHeadSize.
  function edgeContextFor(doc, eid, liveRect) {
    const el = getEdge(doc, eid);
    if (!el) throw new Error("선택 화살표를 소스 문서에서 찾을 수 없음: " + eid);
    const svg = el.closest("svg");
    const snap = edgeSnapshot(doc, eid);
    return {
      eid, kind: "svgedge", shape: "edge", resizable: false,
      outerHTML: el.outerHTML,
      current: {
        tag: snap.tag, points: snap.points, vertexCount: snap.vertexCount, editable: snap.editable,
        stroke: snap.stroke, strokeWidth: snap.strokeWidth,
        markerEnd: snap.markerEnd, headScale: snap.headScale,
      },
      viewBox: svg ? (svg.getAttribute("viewBox") || "") : "",
      box: liveBox(liveRect),
    };
  }

  function contextFor(doc, eid, liveRect) {
    if (isSvgEdgeEid(eid)) return edgeContextFor(doc, eid, liveRect);
    if (isSvgTextEid(eid)) return textContextFor(doc, eid, liveRect);
    const g = getBox(doc, eid);
    if (!g) throw new Error("선택 SVG 박스를 소스 문서에서 찾을 수 없음: " + eid);
    const svg = g.closest("svg");
    const snap = styleSnapshot(doc, eid);
    return {
      eid,
      kind: "svgbox",
      shape: snap.shape,
      resizable: snap.resizable,
      outerHTML: g.outerHTML,
      current: { fill: snap.fill, stroke: snap.stroke, text: snap.text, x: snap.x, y: snap.y, width: snap.width, height: snap.height },
      lines: snap.lines || [],       // D16(a): 줄별 타깃팅 정보
      mainLine: snap.mainLine,
      viewBox: svg ? (svg.getAttribute("viewBox") || "") : "",
      box: liveBox(liveRect),
    };
  }

  function enumerate(doc) {
    const boxes = [...doc.querySelectorAll('[data-svgbox="1"]')].map((g) => {
      const eid = g.getAttribute("data-arch-eid");
      const s = styleSnapshot(doc, eid);
      return { eid, kind: "svgbox", shape: s.shape, text: s.text };
    });
    const texts = [...doc.querySelectorAll('[data-svgtext="1"]')].map((t) => {
      const eid = t.getAttribute("data-arch-eid");
      const s = textSnapshot(doc, eid);
      return { eid, kind: "svgtext", shape: "text", text: s.text };
    });
    const edges = [...doc.querySelectorAll('[data-svgedge="1"]')].map((e) => {
      const eid = e.getAttribute("data-arch-eid");
      const s = edgeSnapshot(doc, eid);
      return { eid, kind: "svgedge", shape: "edge", text: "", vertexCount: s.vertexCount, editable: s.editable };
    });
    return [...boxes, ...texts, ...edges];
  }

  // ---------------- 도구 스키마(§D3 1차 보증) ----------------
  // 모든 op의 eid를 선택 집합 S에 pin한다: |S|=1이면 {"const": eid}(기존 그대로), |S|>1이면
  // {"enum": [...S]}. 어느 쪽이든 **집합 밖 eid는 응답으로 표현 자체가 불가능**하다(D22 일반화).
  // resize 분기는 rect 박스에만 존재(도형 잠금).

  // 서식 op 스키마 조각 — pin을 받아 단일/배치가 같은 정의를 공유한다.
  const TEXT_STYLE_PROPS = {
    fontFamily: { type: "string", maxLength: 120 },
    fontSize: { type: "number", minimum: FONT_MIN, maximum: FONT_MAX },
    fontWeight: { type: "string", pattern: "^(normal|bold|[1-9]00)$" },
    fontStyle: { type: "string", enum: ["normal", "italic", "oblique"] },
    textDecoration: { type: "string", enum: ["none", "underline", "line-through", "underline line-through"] },
    letterSpacing: { type: "number", minimum: TRACK_MIN, maximum: TRACK_MAX },
    textAnchor: { type: "string", enum: ["start", "middle", "end"] },
    fill: { type: "string", maxLength: 64 },
  };
  function vTextStyle(pin, withLine) {
    const properties = {
      op: { const: "setTextStyle" }, eid: pin,
      style: { type: "object", additionalProperties: false, minProperties: 1, properties: TEXT_STYLE_PROPS },
    };
    if (withLine) properties.line = { type: "integer", minimum: 0 };
    return { type: "object", additionalProperties: false, required: ["op", "eid", "style"], properties };
  }
  function vLineSpacing(pin) {
    return {
      type: "object", additionalProperties: false, required: ["op", "eid", "spacing"],
      properties: { op: { const: "setLineSpacing" }, eid: pin, spacing: { type: "number", minimum: SPACING_MIN, maximum: SPACING_MAX } },
    };
  }
  const V_REJECT = {
    type: "object", additionalProperties: false, required: ["op", "reason"],
    properties: { op: { const: "reject" }, reason: { type: "string", maxLength: 500 } },
  };
  // maxItems: 단일 선택은 종전대로 8(LLM 출력 상한). 배치는 선택 원소마다 최소 1 op이 필요하므로
  // |S| 기준으로 넉넉히 잡되 상한을 둔다(무한 op 배열 방지).
  function wrapOps(variants, maxItems) {
    return {
      type: "object", additionalProperties: false, required: ["ops"],
      properties: { ops: { type: "array", minItems: 1, maxItems: maxItems || 8, items: { anyOf: variants } } },
    };
  }

  // 자유 <text> 단위 스키마(D16 b) — setText/setFill/move/setTextStyle/reject. stroke·resize 없음.
  function buildTextSchema(eid) {
    const pin = { const: eid };
    const variants = [
      {
        type: "object", additionalProperties: false, required: ["op", "eid", "text"],
        properties: { op: { const: "setText" }, eid: pin, text: { type: "string", maxLength: 2000 } },
      },
      {
        type: "object", additionalProperties: false, required: ["op", "eid", "color"],
        properties: { op: { const: "setFill" }, eid: pin, color: { type: "string", maxLength: 64 } },
      },
      {
        type: "object", additionalProperties: false, required: ["op", "eid"],
        properties: { op: { const: "move" }, eid: pin, x: { type: "number" }, y: { type: "number" } },
      },
      vTextStyle(pin, false),
      V_REJECT,
    ];
    return wrapOps(variants);
  }

  // 화살표 단위 스키마 — flipEdge/moveVertex/addVertex/deleteVertex/setHeadSize/reject.
  // eid는 {"const": eid}로 pin(생성 봉쇄), 좌표는 number(유한성은 sanitize가 재검), scale은 0.4~4.
  function buildEdgeSchema(eid) {
    const pin = { const: eid };
    const variants = [
      {
        type: "object", additionalProperties: false, required: ["op", "eid"],
        properties: { op: { const: "flipEdge" }, eid: pin },
      },
      {
        type: "object", additionalProperties: false, required: ["op", "eid", "index", "x", "y"],
        properties: { op: { const: "moveVertex" }, eid: pin, index: { type: "integer", minimum: 0 }, x: { type: "number" }, y: { type: "number" } },
      },
      {
        type: "object", additionalProperties: false, required: ["op", "eid", "afterIndex", "x", "y"],
        properties: { op: { const: "addVertex" }, eid: pin, afterIndex: { type: "integer", minimum: 0 }, x: { type: "number" }, y: { type: "number" } },
      },
      {
        type: "object", additionalProperties: false, required: ["op", "eid", "index"],
        properties: { op: { const: "deleteVertex" }, eid: pin, index: { type: "integer", minimum: 0 } },
      },
      {
        type: "object", additionalProperties: false, required: ["op", "eid", "scale"],
        properties: { op: { const: "setHeadSize" }, eid: pin, scale: { type: "number", minimum: HEAD_MIN, maximum: HEAD_MAX } },
      },
      V_REJECT,
    ];
    return wrapOps(variants);
  }

  function buildBoxSchema(eid, shape) {
    const pin = { const: eid };
    const variants = [
      {
        // D16(a): setText에 선택적 line 인덱스(박스 <g> 안 <text> 문서순 0-based). 생략 시 주 라벨.
        type: "object", additionalProperties: false, required: ["op", "eid", "text"],
        properties: { op: { const: "setText" }, eid: pin, text: { type: "string", maxLength: 2000 }, line: { type: "integer", minimum: 0 } },
      },
      {
        type: "object", additionalProperties: false, required: ["op", "eid", "color"],
        properties: { op: { const: "setFill" }, eid: pin, color: { type: "string", maxLength: 64 } },
      },
      {
        type: "object", additionalProperties: false, required: ["op", "eid", "color"],
        properties: { op: { const: "setStroke" }, eid: pin, color: { type: "string", maxLength: 64 } },
      },
      {
        type: "object", additionalProperties: false, required: ["op", "eid"],
        properties: { op: { const: "move" }, eid: pin, x: { type: "number" }, y: { type: "number" } },
      },
      {
        // 줄 추가 — afterIndex 뒤에 삽입(생략 시 맨 끝). 스타일은 이웃 줄에서 상속, y는 자동 재배분.
        type: "object", additionalProperties: false, required: ["op", "eid"],
        properties: { op: { const: "addTextLine" }, eid: pin, afterIndex: { type: "integer", minimum: 0 }, text: { type: "string", maxLength: 2000 } },
      },
      {
        // 줄 삭제 — 남은 줄은 자동 재배분. 0줄까지 허용(텍스트 없는 도형은 정당).
        type: "object", additionalProperties: false, required: ["op", "eid", "line"],
        properties: { op: { const: "removeTextLine" }, eid: pin, line: { type: "integer", minimum: 0 } },
      },
    ];
    if (shape === "rect") {
      variants.push({
        type: "object", additionalProperties: false, required: ["op", "eid"],
        properties: { op: { const: "resize" }, eid: pin, width: { type: "number", minimum: 8 }, height: { type: "number", minimum: 8 } },
      });
    }
    variants.push(vTextStyle(pin, true));
    variants.push(vLineSpacing(pin));
    variants.push(V_REJECT);
    return wrapOps(variants);
  }

  // ★ D22: 선택 집합 S용 스키마. op마다 **그 op이 유효한 종류의 eid에만** pin한다
  //   (setHeadSize는 화살표 eid에만, resize는 rect 박스 eid에만 …). 집합이 비면 그 분기 자체가
  //   사라져 op이 표현 불가능해진다 — 혼합 선택에서도 1차 보증이 느슨해지지 않고 오히려 정밀해진다.
  function buildBatchSchema(set, shapeSpec) {
    const shapeAt = mkShapeResolver(shapeSpec);
    const all = [...set];
    const boxes = all.filter(isSvgBoxEid);
    const texts = all.filter(isSvgTextEid);
    const edges = all.filter(isSvgEdgeEid);
    const rects = boxes.filter((e) => shapeAt(e) === "rect");
    const textish = boxes.concat(texts);           // 텍스트를 가진 단위(박스 줄 + 자유 텍스트)
    const variants = [];
    if (textish.length) {
      const pin = pinFor(textish);
      variants.push({
        type: "object", additionalProperties: false, required: ["op", "eid", "text"],
        properties: { op: { const: "setText" }, eid: pin, text: { type: "string", maxLength: 2000 }, line: { type: "integer", minimum: 0 } },
      });
      variants.push({
        type: "object", additionalProperties: false, required: ["op", "eid", "color"],
        properties: { op: { const: "setFill" }, eid: pin, color: { type: "string", maxLength: 64 } },
      });
      variants.push({
        type: "object", additionalProperties: false, required: ["op", "eid"],
        properties: { op: { const: "move" }, eid: pin, x: { type: "number" }, y: { type: "number" } },
      });
      variants.push(vTextStyle(pin, true));
    }
    if (boxes.length) {
      const pin = pinFor(boxes);
      variants.push({
        type: "object", additionalProperties: false, required: ["op", "eid", "color"],
        properties: { op: { const: "setStroke" }, eid: pin, color: { type: "string", maxLength: 64 } },
      });
      variants.push({
        type: "object", additionalProperties: false, required: ["op", "eid"],
        properties: { op: { const: "addTextLine" }, eid: pin, afterIndex: { type: "integer", minimum: 0 }, text: { type: "string", maxLength: 2000 } },
      });
      variants.push({
        type: "object", additionalProperties: false, required: ["op", "eid", "line"],
        properties: { op: { const: "removeTextLine" }, eid: pin, line: { type: "integer", minimum: 0 } },
      });
      variants.push(vLineSpacing(pin));
    }
    if (rects.length) {
      const pin = pinFor(rects);
      variants.push({
        type: "object", additionalProperties: false, required: ["op", "eid"],
        properties: { op: { const: "resize" }, eid: pin, width: { type: "number", minimum: 8 }, height: { type: "number", minimum: 8 } },
      });
    }
    if (edges.length) {
      const pin = pinFor(edges);
      variants.push({ type: "object", additionalProperties: false, required: ["op", "eid"], properties: { op: { const: "flipEdge" }, eid: pin } });
      variants.push({
        type: "object", additionalProperties: false, required: ["op", "eid", "index", "x", "y"],
        properties: { op: { const: "moveVertex" }, eid: pin, index: { type: "integer", minimum: 0 }, x: { type: "number" }, y: { type: "number" } },
      });
      variants.push({
        type: "object", additionalProperties: false, required: ["op", "eid", "afterIndex", "x", "y"],
        properties: { op: { const: "addVertex" }, eid: pin, afterIndex: { type: "integer", minimum: 0 }, x: { type: "number" }, y: { type: "number" } },
      });
      variants.push({
        type: "object", additionalProperties: false, required: ["op", "eid", "index"],
        properties: { op: { const: "deleteVertex" }, eid: pin, index: { type: "integer", minimum: 0 } },
      });
      variants.push({
        type: "object", additionalProperties: false, required: ["op", "eid", "scale"],
        properties: { op: { const: "setHeadSize" }, eid: pin, scale: { type: "number", minimum: HEAD_MIN, maximum: HEAD_MAX } },
      });
    }
    variants.push(V_REJECT);
    return wrapOps(variants, Math.min(256, Math.max(8, all.length * 4)));
  }

  // 공개 진입점 — eidSpec은 문자열(단일) | 배열 | Set(집합). |S|=1은 예전 스키마와 동일하다.
  function buildToolSchema(eidSpec, shapeSpec) {
    const set = toEidSet(eidSpec);
    if (set.size === 1) {
      const eid = [...set][0];
      if (isSvgEdgeEid(eid)) return buildEdgeSchema(eid);
      if (isSvgTextEid(eid)) return buildTextSchema(eid);
      return buildBoxSchema(eid, mkShapeResolver(shapeSpec)(eid));
    }
    return buildBatchSchema(set, shapeSpec);
  }

  function scopeError(msg) { const e = new Error(msg); e.name = "ScopeViolation"; return e; }

  // 2차 보증(D22 일반화): op **하나하나**를 그 op 자신의 eid 종류 규칙으로 sanitize한다.
  // 예전엔 "선택된 eid 하나"의 종류로 전체를 분기했는데, 혼합 선택(박스+텍스트+화살표)에서는
  // 그 전제가 성립하지 않는다 → 디스패치 축을 "선택"에서 "op의 eid"로 내렸다. 단일 선택에서는
  // 집합 원소가 하나뿐이라 결과가 예전과 완전히 동일하다.
  const KIND_LABEL = { svgbox: "SVG 박스", svgtext: "SVG 텍스트", svgedge: "화살표" };
  function kindOfEid(eid) {
    if (isSvgEdgeEid(eid)) return "svgedge";
    if (isSvgTextEid(eid)) return "svgtext";
    if (isSvgBoxEid(eid)) return "svgbox";
    return "other";
  }
  // 서식 style 객체 sanitize — 화이트리스트 키만, 값도 키별 규칙 통과분만 살아남는다.
  function cleanTextStyle(raw, notes, tag) {
    const style = {};
    for (const [k, v] of Object.entries(raw || {})) {
      if (!TEXT_STYLE_KEYS.includes(k)) { notes.push(tag + ": 허용 외 서식 키 '" + String(k).slice(0, 24) + "' 제거"); continue; }
      const cleaned = cleanTextStyleValue(k, v);
      if (cleaned == null) { notes.push(tag + ": '" + k + "' 값 '" + String(v).slice(0, 24) + "' 불허 — 제거"); continue; }
      style[k] = cleaned;
    }
    return style;
  }

  // ---- 종류별 per-op 규칙 (각 함수는 sanitize된 op 하나 또는 null을 돌려준다) ----
  function sanitizeTextOp(op, eid, notes) {
    if (op.op === "setText") {
      if (typeof op.text !== "string") { notes.push("setText: text 누락 — 무시"); return null; }
      return { op: "setText", eid, text: op.text.slice(0, 2000) };
    }
    if (op.op === "setFill") {
      if (!isColorToken(op.color)) { notes.push("setFill: 색 토큰 '" + String(op.color).slice(0, 24) + "' 불허(hex/rgb/hsl/named만) — 제거"); return null; }
      return { op: "setFill", eid, color: String(op.color).trim() };
    }
    if (op.op === "move") {
      if (!isFiniteNum(op.x) || !isFiniteNum(op.y)) { notes.push("move: 좌표가 유한수가 아님 — 무시"); return null; }
      return { op: "move", eid, x: parseFloat(op.x), y: parseFloat(op.y) };
    }
    if (op.op === "setTextStyle") {
      const style = cleanTextStyle(op.style, notes, "setTextStyle");
      if (op.line != null) notes.push("setTextStyle: 자유 텍스트는 줄 인덱스가 없어 line 무시");
      if (!Object.keys(style).length) { notes.push("setTextStyle: 적용 가능한 서식 키 없음 — op 제거"); return null; }
      if (style.textAnchor) notes.push("setTextStyle: 자유 텍스트는 기준 도형이 없어 정렬 시 x가 자동 보정되지 않습니다");
      return { op: "setTextStyle", eid, style };
    }
    if (op.op === "setStroke") { notes.push("setStroke: 자유 텍스트는 테두리색 편집 미지원(글자색은 setFill) — 무시"); return null; }
    if (op.op === "resize") { notes.push("resize: 텍스트는 크기(w/h)가 없어 조정 불가 — 무시"); return null; }
    if (op.op === "addTextLine" || op.op === "removeTextLine" || op.op === "setLineSpacing") {
      notes.push(op.op + ": 자유 텍스트는 그 자체가 한 줄이라 줄 단위 조작 대상이 아님(박스 단위 기능) — 무시");
      return null;
    }
    notes.push("알 수 없는 op '" + String(op.op).slice(0, 30) + "' 무시");
    return null;
  }

  // 화살표 규칙 — 정점 인덱스(정수·음수 불가) + 좌표 유한성 + 화살촉 배율 클램프.
  // 인덱스의 "범위" 검증은 실제 정점 수를 아는 applyEdgeOp이 담당한다(초과 시 throw → 자동 revert).
  function sanitizeEdgeOp(op, eid, notes) {
    const idx = (v) => { const n = typeof v === "number" ? v : parseInt(v, 10); return Number.isInteger(n) && n >= 0 ? n : null; };
    if (op.op === "flipEdge") return { op: "flipEdge", eid };
    if (op.op === "moveVertex" || op.op === "addVertex") {
      const i = idx(op.op === "moveVertex" ? op.index : op.afterIndex);
      if (i == null) { notes.push(op.op + ": 정점 인덱스가 0 이상 정수가 아님 — 무시"); return null; }
      if (!isFiniteNum(op.x) || !isFiniteNum(op.y)) { notes.push(op.op + ": 좌표가 유한수가 아님 — 무시"); return null; }
      const o = { op: op.op, eid, x: parseFloat(op.x), y: parseFloat(op.y) };
      if (op.op === "moveVertex") o.index = i; else o.afterIndex = i;
      return o;
    }
    if (op.op === "deleteVertex") {
      const i = idx(op.index);
      if (i == null) { notes.push("deleteVertex: 정점 인덱스가 0 이상 정수가 아님 — 무시"); return null; }
      return { op: "deleteVertex", eid, index: i };
    }
    if (op.op === "setHeadSize") {
      const s = parseFloat(op.scale);
      if (!Number.isFinite(s) || s <= 0) { notes.push("setHeadSize: 배율이 유효하지 않음 — 무시"); return null; }
      const c = Math.max(HEAD_MIN, Math.min(HEAD_MAX, s));
      if (c !== s) notes.push("setHeadSize: 배율 " + s + " → " + c + "로 클램프(" + HEAD_MIN + "~" + HEAD_MAX + "×)");
      return { op: "setHeadSize", eid, scale: c };
    }
    if (op.op === "setText") { notes.push("setText: 화살표에는 텍스트가 없습니다(라벨은 별도 자유 텍스트 단위) — 무시"); return null; }
    if (op.op === "setFill" || op.op === "setStroke" || op.op === "move" || op.op === "resize"
      || op.op === "addTextLine" || op.op === "removeTextLine" || op.op === "setTextStyle" || op.op === "setLineSpacing") {
      notes.push(op.op + ": 화살표 단위에서 미지원(방향·정점·화살촉 크기만) — 무시");
      return null;
    }
    notes.push("알 수 없는 op '" + String(op.op).slice(0, 30) + "' 무시");
    return null;
  }

  function sanitizeBoxOp(op, eid, shape, notes) {
    if (op.op === "setText") {
      if (typeof op.text !== "string") { notes.push("setText: text 누락 — 무시"); return null; }
      const o = { op: "setText", eid, text: op.text.slice(0, 2000) };
      // D16(a): line 인덱스가 있으면 그 <text> 줄을 타깃. 유효하지 않으면 주 라벨로 대체(note).
      if (op.line != null) {
        const li = typeof op.line === "number" ? op.line : parseInt(op.line, 10);
        if (Number.isInteger(li) && li >= 0) o.line = li;
        else notes.push("setText: line 인덱스 무효 — 주 라벨로 대체");
      }
      return o;
    }
    if (op.op === "setFill" || op.op === "setStroke") {
      if (!isColorToken(op.color)) { notes.push(op.op + ": 색 토큰 '" + String(op.color).slice(0, 24) + "' 불허(hex/rgb/hsl/named만) — 제거"); return null; }
      return { op: op.op, eid, color: String(op.color).trim() };
    }
    if (op.op === "move") {
      if (!isFiniteNum(op.x) || !isFiniteNum(op.y)) { notes.push("move: 좌표가 유한수가 아님 — 무시"); return null; }
      return { op: "move", eid, x: parseFloat(op.x), y: parseFloat(op.y) };
    }
    if (op.op === "resize") {
      if (shape !== "rect") { notes.push("resize: 이 박스는 rect가 아니라 크기 조정 불가(도형 잠금) — 무시"); return null; }
      const w = parseFloat(op.width), h = parseFloat(op.height);
      if (!Number.isFinite(w) || !Number.isFinite(h) || w < 8 || h < 8) { notes.push("resize: width/height가 유효하지 않음 — 무시"); return null; }
      return { op: "resize", eid, width: w, height: h };
    }
    if (op.op === "addTextLine") {
      const o = { op: "addTextLine", eid };
      if (op.afterIndex != null) {
        const i = typeof op.afterIndex === "number" ? op.afterIndex : parseInt(op.afterIndex, 10);
        if (Number.isInteger(i) && i >= 0) o.afterIndex = i;
        else notes.push("addTextLine: afterIndex가 0 이상 정수가 아님 — 맨 끝에 추가");
      }
      if (op.text != null) {
        if (typeof op.text !== "string") notes.push("addTextLine: text가 문자열이 아님 — 빈 줄로 추가");
        else o.text = op.text.slice(0, 2000);
      }
      return o;
    }
    if (op.op === "removeTextLine") {
      const i = typeof op.line === "number" ? op.line : parseInt(op.line, 10);
      if (!Number.isInteger(i) || i < 0) { notes.push("removeTextLine: 줄 인덱스가 0 이상 정수가 아님 — 무시"); return null; }
      return { op: "removeTextLine", eid, line: i };
    }
    if (op.op === "setTextStyle") {
      const style = cleanTextStyle(op.style, notes, "setTextStyle");
      if (!Object.keys(style).length) { notes.push("setTextStyle: 적용 가능한 서식 키 없음 — op 제거"); return null; }
      const o = { op: "setTextStyle", eid, style };
      if (op.line != null) {
        const li = typeof op.line === "number" ? op.line : parseInt(op.line, 10);
        if (Number.isInteger(li) && li >= 0) o.line = li;
        else notes.push("setTextStyle: line 인덱스 무효 — 모든 줄에 적용");
      }
      return o;
    }
    if (op.op === "setLineSpacing") {
      const s = parseFloat(op.spacing);
      if (!Number.isFinite(s) || s <= 0) { notes.push("setLineSpacing: 줄간격이 유효하지 않음 — 무시"); return null; }
      const c = Math.max(SPACING_MIN, Math.min(SPACING_MAX, s));
      if (c !== s) notes.push("setLineSpacing: 줄간격 " + s + " → " + c + "로 클램프(" + SPACING_MIN + "~" + SPACING_MAX + "배)");
      return { op: "setLineSpacing", eid, spacing: c };
    }
    notes.push("알 수 없는 op '" + String(op.op).slice(0, 30) + "' 무시");
    return null;
  }

  // ★ 통합 진입점 — eidSpec은 문자열(단일) | 배열 | Set(집합 S), shapeSpec은 문자열 | 맵 | 함수.
  // 집합 밖 eid는 여기서 ScopeViolation으로 막힌다(스키마가 뚫려도 코드가 다시 막는 2차 보증).
  function sanitizeOps(raw, eidSpec, shapeSpec) {
    if (!raw || !Array.isArray(raw.ops) || raw.ops.length === 0) throw new Error("응답에 ops 배열이 없습니다.");
    const set = toEidSet(eidSpec);
    const shapeAt = mkShapeResolver(shapeSpec);
    const only = set.size === 1 ? [...set][0] : null;
    const notes = [], ops = [];
    let reject = null;
    for (const op of raw.ops) {
      if (!op || typeof op !== "object") { notes.push("비정상 op 무시"); continue; }
      if (op.op === "reject") { reject = { op: "reject", reason: String(op.reason || "사유 미상").slice(0, 500) }; continue; }
      if (!set.has(op.eid)) {
        throw scopeError(only != null
          ? "op가 선택 " + (KIND_LABEL[kindOfEid(only)] || "요소") + "(" + only + ") 밖(" + op.eid + ")을 대상으로 함 — 적용 거부"
          : "op가 선택 집합(" + set.size + "개) 밖(" + op.eid + ")을 대상으로 함 — 적용 거부");
      }
      const eid = op.eid;
      const kind = kindOfEid(eid);
      let out = null;
      if (kind === "svgedge") out = sanitizeEdgeOp(op, eid, notes);
      else if (kind === "svgtext") out = sanitizeTextOp(op, eid, notes);
      else if (kind === "svgbox") out = sanitizeBoxOp(op, eid, shapeAt(eid), notes);
      else { notes.push("SVG 단위가 아닌 eid '" + String(eid).slice(0, 30) + "' — 이 어댑터 대상 아님"); continue; }
      if (out) ops.push(out);
    }
    return { ops, reject, notes };
  }

  // 호환 래퍼(기존 호출부·테스트용) — 통합 경로에 단일 원소 집합으로 위임한다.
  function sanitizeTextOps(raw, eid) { return sanitizeOps(raw, eid); }
  function sanitizeEdgeOps(raw, eid) { return sanitizeOps(raw, eid); }

  // ---------------- 적용 ----------------
  // doc은 호출측이 넘긴 클론(다음 상태 후보) — 원본은 bleed-diff 통과 전까지 불변.
  // 각 op은 자기 eid를 들고 있어 DomAdapter.applyOps와 시그니처가 호환된다.
  // 자유 <text> 단위 적용(D16 b) — setText는 textContent, move는 x/y(또는 transform), setFill은 fill.
  function applyTextOp(doc, op) {
    const t = getText(doc, op.eid);
    if (!t) throw new Error("적용 대상 SVG 텍스트가 없음: " + op.eid);
    if (op.op === "setText") {
      t.textContent = op.text;
    } else if (op.op === "setFill") {
      t.setAttribute("fill", op.color);
    } else if (op.op === "move") {
      const tr = t.getAttribute("transform") || "";
      if (/translate\(/.test(tr)) {
        t.setAttribute("transform", tr.replace(/translate\([^)]*\)/, "translate(" + fmt(op.x) + " " + fmt(op.y) + ")"));
      } else {
        t.setAttribute("x", fmt(op.x));
        t.setAttribute("y", fmt(op.y));
      }
    }
  }

  // 화살표 적용(D18) — 세 기능.
  //   flipEdge     : 정점 순서를 뒤집는다. marker-end는 "끝점"에 붙으므로 기하만 뒤집으면
  //                  화살촉이 반대편으로 간다(marker 속성은 손대지 않는다).
  //   moveVertex   : 그 정점만 이동.
  //   addVertex    : afterIndex 뒤에 새 정점 삽입 → 2점 <line>은 등가 <path>로 승격.
  //   deleteVertex : 그 정점 제거(최소 2점 유지).
  //   setHeadSize  : 그 화살표 전용 marker 클론 생성/갱신 후 marker-end만 그쪽으로.
  function applyEdgeOp(doc, op) {
    const el = getEdge(doc, op.eid);
    if (!el) throw new Error("적용 대상 화살표가 없음: " + op.eid);
    if (op.op === "setHeadSize") {
      const r = applyHeadSize(doc, el, op.eid, op.scale);
      if (!r.ok) throw new Error(r.note);
      return;
    }
    const pts = edgePoints(el);
    if (!pts) throw new Error("이 화살표는 M/L 직선 경로가 아니라 기하 편집이 불가합니다: " + op.eid);
    if (op.op === "flipEdge") {
      writeEdgePoints(el, pts.slice().reverse());
      return;
    }
    if (op.op === "moveVertex") {
      if (op.index >= pts.length) throw new Error("정점 인덱스 범위 초과: " + op.index + " (정점 " + pts.length + "개)");
      const next = pts.slice();
      next[op.index] = { x: op.x, y: op.y };
      writeEdgePoints(el, next);
      return;
    }
    if (op.op === "addVertex") {
      if (op.afterIndex >= pts.length) throw new Error("정점 인덱스 범위 초과: " + op.afterIndex + " (정점 " + pts.length + "개)");
      const next = pts.slice();
      next.splice(op.afterIndex + 1, 0, { x: op.x, y: op.y });
      if (el.tagName.toLowerCase() === "line") promoteLineToPath(doc, el, next);
      else writeEdgePoints(el, next);
      return;
    }
    if (op.op === "deleteVertex") {
      if (pts.length <= 2) throw new Error("정점이 2개뿐이라 삭제할 수 없습니다(선이 사라짐): " + op.eid);
      if (op.index >= pts.length) throw new Error("정점 인덱스 범위 초과: " + op.index + " (정점 " + pts.length + "개)");
      const next = pts.slice();
      next.splice(op.index, 1);
      writeEdgePoints(el, next);
    }
  }

  // 어떤 class-c eid(박스/텍스트/화살표)든 그 DOM 요소로 해석 — 셋 다 data-arch-eid로 stamp돼 있다.
  function unitEl(doc, eid) {
    return isSvgEid(eid) ? doc.querySelector('[data-arch-eid="' + eid + '"]') : null;
  }

  // D34b: class-c 겹침 순서 재배치 — primary(op.eid)를 다른 선택 요소(op.refEids)보다 앞/뒤로 DOM 이동.
  //   SVG는 z-index가 없고 **DOM 형제 순서가 곧 paint 순서**다(뒤 형제가 위에 그려진다).
  //   ★ 안전 제약(D34b): primary와 ref들이 **같은 부모(형제)**일 때만 이동한다. 다른 <g>(lane/phase 등)
  //     그룹으로 옮기면 그 그룹의 opacity/clip/transform 컨텍스트를 잘못 물려받아 렌더가 조용히 깨진다
  //     → 부모가 다르면 ScopeViolation을 던진다(에디터는 이 조합에서 버튼을 미리 비활성+사유로 막지만,
  //       apply 계층에서도 독립적으로 거절해 이중 방어한다). 반환: 손댄 eid 목록.
  function applyReorder(doc, op) {
    const el = unitEl(doc, op.eid);
    if (!el) throw new Error("적용 대상 요소가 없음: " + op.eid);
    const parent = el.parentNode;
    if (!parent) throw new Error("부모가 없는 요소는 재배치할 수 없습니다: " + op.eid);
    const refs = (op.refEids || []).map((e) => unitEl(doc, e)).filter(Boolean);
    if (!refs.length) throw new Error("겹침 순서 기준이 될 다른 선택 요소가 없습니다.");
    for (const r of refs) {
      if (r.parentNode !== parent) {
        const e = new Error("서로 다른 그룹(<g>)의 요소는 겹침 순서를 안전하게 바꿀 수 없습니다: " + op.eid);
        e.name = "ScopeViolation";
        throw e;
      }
    }
    // 문서 순서(= paint 순서)로 ref들의 극단을 찾는다. FOLLOWING(4)=인자가 acc 뒤, PRECEDING(2)=앞.
    const FOLLOWING = 4, PRECEDING = 2;
    const lastRef = refs.reduce((acc, n) => (acc.compareDocumentPosition(n) & FOLLOWING ? n : acc));
    const firstRef = refs.reduce((acc, n) => (acc.compareDocumentPosition(n) & PRECEDING ? n : acc));
    if (op.dir === "front") {
      // primary를 최상위 ref 바로 뒤로 → 모든 ref 위에 그려진다(3개 이상이면 전원 위로).
      const anchor = lastRef.nextSibling;
      if (el !== anchor) parent.insertBefore(el, anchor);   // 이미 그 자리면 no-op
    } else if (op.dir === "back") {
      // primary를 최하위 ref 바로 앞으로 → 모든 ref 아래로 간다(3개 이상이면 전원 아래로).
      if (el !== firstRef) parent.insertBefore(el, firstRef);
    } else {
      throw new Error("알 수 없는 재배치 방향: " + op.dir);
    }
    return [op.eid];
  }

  function applyOps(doc, ops) {
    const touched = [];
    for (const op of ops) {
      if (isSvgEdgeEid(op.eid)) {
        applyEdgeOp(doc, op);
        if (!touched.includes(op.eid)) touched.push(op.eid);
        continue;
      }
      if (isSvgTextEid(op.eid)) {
        if (op.op === "setTextStyle") applyTextStyleOp(doc, op);
        else applyTextOp(doc, op);
        if (!touched.includes(op.eid)) touched.push(op.eid);
        continue;
      }
      const g = getBox(doc, op.eid);
      if (!g) throw new Error("적용 대상 SVG 박스가 없음: " + op.eid);
      const shape = primaryShape(g);
      if (op.op === "setText") {
        // D16(a): line 인덱스가 유효 범위면 그 <text> 줄을, 아니면 주 라벨을 교체.
        const texts = directChildren(g, "text");
        const label = (op.line != null && op.line >= 0 && op.line < texts.length) ? texts[op.line] : mainTextEl(g);
        if (label) label.textContent = op.text;
      } else if (op.op === "setFill") {
        if (shape) shape.setAttribute("fill", op.color);
      } else if (op.op === "setStroke") {
        if (shape) shape.setAttribute("stroke", op.color);
      } else if (op.op === "move") {
        g.setAttribute("transform", "translate(" + fmt(op.x) + " " + fmt(op.y) + ")");
      } else if (op.op === "resize") {
        const rect = directChildren(g, "rect")[0];
        if (rect) {
          rect.setAttribute("width", fmt(op.width));
          rect.setAttribute("height", fmt(op.height));
          recenterTexts(g, op.width);   // text-anchor=middle 줄을 새 폭 중앙으로
        }
      } else if (op.op === "addTextLine") {
        addTextLine(doc, g, op);        // 넘치면 throw → 커밋 취소(소스 무변형)
      } else if (op.op === "removeTextLine") {
        removeTextLine(doc, g, op);
      } else if (op.op === "setTextStyle") {
        applyTextStyleOp(doc, op);      // D21: 줄 단위 서식(글꼴·크기·굵기·기울임·밑줄·자간·정렬·글자색)
      } else if (op.op === "setLineSpacing") {
        setLineSpacing(doc, g, op);     // D21: 줄간격 — D20 수직 재배분을 재사용, 넘치면 throw
      }
      if (!touched.includes(op.eid)) touched.push(op.eid);
    }
    return touched;
  }

  // 정수는 정수로, 소수는 소수로 — 원문 스타일(정수 좌표)을 최대한 보존해 diff 노이즈 최소화.
  function fmt(n) {
    const r = Math.round(n * 100) / 100;
    return Number.isInteger(r) ? String(r) : String(r);
  }

  // resize 시 text-anchor="middle" 텍스트의 x를 새 폭의 중앙(w/2)으로 재정렬(수직 y는 유지).
  function recenterTexts(g, width) {
    const texts = directChildren(g, "text");
    const cx = Math.round((width / 2) * 100) / 100;
    for (const t of texts) {
      if ((t.getAttribute("text-anchor") || "") === "middle") t.setAttribute("x", fmt(cx));
    }
  }

  // ---------------- D21: 서식 적용 ----------------
  // ★ 정렬(text-anchor)은 x도 같이 옮겨야 한다. anchor만 바꾸면 글자가 기준점을 축으로 통째로
  //   미끄러져 도형 밖으로 나간다(start로 바꾸면 오른쪽으로 반 폭, end면 왼쪽으로 반 폭).
  //   그래서 도형 경계(shapeBoxOf)를 읽어 그 정렬의 "옳은 x"를 다시 잡는다.
  //   여백(pad)은 도형 폭의 6%를 4~12u로 클램프 — 이 슬라이드의 박스(폭 100~200u)에서
  //   6~12u가 되어 손으로 짠 좌우 여백과 같은 눈금에 놓인다.
  //   ★ D31-실행: **rect에서만** x를 재계산한다. 다이아몬드(polygon)·게이트(path)는 shapeBoxOf가
  //   외곽 bbox를 돌려주지만, 그 도형은 텍스트 줄의 y위치에서 실제 폭이 bbox 폭보다 훨씬 좁다 —
  //   bbox 폭(=중앙 최대폭) 기준으로 x=x1-pad를 잡으면 글자가 뾰족한 모서리를 뚫고 나간다(실측 버그).
  //   비-rect는 x를 건드리지 않아(원 위치 유지) 도형 밖으로 밀어내지 않는다. (UI는 fmtCap에서 비-rect
  //   정렬을 아예 비활성 + 사유 표시하므로 이 경로는 LLM op·다줄 일괄 등 프로그램 경로의 최후 방어선.)
  const ANCHOR_PAD_RATIO = 0.06, ANCHOR_PAD_MIN = 4, ANCHOR_PAD_MAX = 12;
  function anchorXFor(box, anchor) {
    const w = box.x1 - box.x0;
    const pad = Math.max(ANCHOR_PAD_MIN, Math.min(ANCHOR_PAD_MAX, w * ANCHOR_PAD_RATIO));
    if (anchor === "start") return box.x0 + pad;
    if (anchor === "end") return box.x1 - pad;
    return (box.x0 + box.x1) / 2;
  }

  // <text> 한 줄에 서식 적용. ownerBox가 있으면 정렬 변경 시 x까지 재계산한다.
  function applyTextStyleTo(t, style, ownerBox) {
    let movedX = false;
    for (const k of TEXT_STYLE_KEYS) {
      if (style[k] == null) continue;
      t.setAttribute(TEXT_STYLE_ATTR[k], style[k]);
      // D31-실행: rect에서만 x 재계산(비-rect는 bbox 폭이 실제 가용폭보다 넓어 모서리 오버플로).
      if (k === "textAnchor" && ownerBox && ownerBox.kind === "rect") { t.setAttribute("x", fmt(anchorXFor(ownerBox, style[k]))); movedX = true; }
    }
    return movedX;
  }

  // 서식 op 적용 — 박스는 line 지정 시 그 줄만, 생략 시 모든 줄. 자유 텍스트는 자기 자신.
  function applyTextStyleOp(doc, op) {
    if (isSvgTextEid(op.eid)) {
      const t = getText(doc, op.eid);
      if (!t) throw new Error("적용 대상 SVG 텍스트가 없음: " + op.eid);
      applyTextStyleTo(t, op.style, null);
      return;
    }
    const g = getBox(doc, op.eid);
    if (!g) throw new Error("적용 대상 SVG 박스가 없음: " + op.eid);
    const texts = directChildren(g, "text");
    if (!texts.length) throw new Error("이 박스에는 서식을 적용할 텍스트 줄이 없습니다: " + op.eid);
    const box = shapeBoxOf(g);
    const targets = (op.line != null && op.line >= 0 && op.line < texts.length) ? [texts[op.line]] : texts;
    if (op.line != null && op.line >= texts.length) throw new Error("줄 인덱스 범위 초과: " + op.line + " (줄 " + texts.length + "개)");
    for (const t of targets) applyTextStyleTo(t, op.style, box);
  }

  // ---------------- D21: 문서에서 유도한 타입 스케일(프리셋·굵기 기준) ----------------
  // ★ 프리셋 수치를 직관으로 박지 않는다 — 이 문서가 실제로 쓰는 폰트 크기·굵기 분포에서 뽑는다.
  //   그래야 "제목"이 그 슬라이드의 제목과 같은 눈금이 되고, 굵게(B)가 원래 굵기(이 슬라이드는 800)로
  //   돌아간다(700을 상수로 박으면 굵게 눌렀는데 오히려 얇아지는 배신이 생긴다).
  function typeScale(doc) {
    const sizes = [], weights = [];
    doc.querySelectorAll('[data-svgbox="1"] > text, [data-svgtext="1"]').forEach((t) => {
      const s = num(t.getAttribute("font-size"), NaN);
      if (Number.isFinite(s) && s > 0) sizes.push(s);
      const w = parseInt(t.getAttribute("font-weight"), 10);
      if (Number.isFinite(w)) weights.push(w);
    });
    sizes.sort((a, b) => a - b);
    const at = (p) => (sizes.length ? sizes[Math.min(sizes.length - 1, Math.max(0, Math.round((sizes.length - 1) * p)))] : null);
    const bold = weights.filter((w) => w >= 600).sort((a, b) => a - b);
    const boldWeight = bold.length ? String(bold[Math.floor(bold.length / 2)]) : "700";
    return {
      n: sizes.length,
      boldWeight,                                  // "굵게"가 되돌아갈 굵기 = 문서의 중앙 굵은 값
      presets: sizes.length ? [
        { id: "title", label: "제목", fontSize: at(0.97), fontWeight: boldWeight },
        { id: "body", label: "본문", fontSize: at(0.5), fontWeight: boldWeight },
        { id: "caption", label: "캡션", fontSize: at(0.05), fontWeight: boldWeight },
      ] : [],
    };
  }

  // 선택 단위의 현재 서식 상태(툴바 표시용). 박스는 주 라벨 줄 기준, 자유 텍스트는 자기 자신.
  function textStyleSnapshot(doc, eid) {
    let t = null, g = null;
    if (isSvgTextEid(eid)) t = getText(doc, eid);
    else if (isSvgBoxEid(eid)) { g = getBox(doc, eid); t = g ? mainTextEl(g) : null; }
    if (!t) return null;
    const dec = (t.getAttribute("text-decoration") || "").trim();
    return {
      fontFamily: t.getAttribute("font-family") || "",
      fontSize: num(t.getAttribute("font-size"), null),
      fontWeight: t.getAttribute("font-weight") || "",
      fontStyle: t.getAttribute("font-style") || "normal",
      underline: /underline/.test(dec),
      strike: /line-through/.test(dec),
      letterSpacing: num(t.getAttribute("letter-spacing"), 0),
      textAnchor: t.getAttribute("text-anchor") || "start",
      fill: t.getAttribute("fill") || "",
      lineCount: g ? directChildren(g, "text").length : 1,
      lineGap: g ? currentLineGap(g) : null,
      lineSizes: g ? directChildren(g, "text").map((x) => num(x.getAttribute("font-size"), 12)) : [num(t.getAttribute("font-size"), 12)],
      mainLine: g ? directChildren(g, "text").indexOf(t) : 0,
    };
  }

  // D26: 한 줄(line index)의 서식 상태 — OFF 인라인 편집 중 그 줄에 정확히 대응하는 툴바 표시용.
  //   textStyleSnapshot은 박스의 **주 라벨 줄**만 보므로, 인라인으로 다른 줄을 편집할 땐 그 줄의
  //   실제 굵기/기울임/색을 읽어야 B/I 토글이 배신하지 않는다. 자유 텍스트(svgtext)는 줄 개념이
  //   없어 자기 자신, 범위 밖 line이면 null.
  function lineTextStyle(doc, eid, line) {
    let t = null;
    if (isSvgTextEid(eid)) t = getText(doc, eid);
    else if (isSvgBoxEid(eid)) {
      const g = getBox(doc, eid);
      const texts = g ? directChildren(g, "text") : [];
      t = (line != null && line >= 0 && line < texts.length) ? texts[line] : (g ? mainTextEl(g) : null);
    }
    if (!t) return null;
    const dec = (t.getAttribute("text-decoration") || "").trim();
    return {
      fontFamily: t.getAttribute("font-family") || "",
      fontSize: num(t.getAttribute("font-size"), null),
      fontWeight: t.getAttribute("font-weight") || "",
      fontStyle: t.getAttribute("font-style") || "normal",
      underline: /underline/.test(dec),
      strike: /line-through/.test(dec),
      letterSpacing: num(t.getAttribute("letter-spacing"), 0),
      textAnchor: t.getAttribute("text-anchor") || "start",
      fill: t.getAttribute("fill") || "",
    };
  }

  // ---------------- 줄 추가/삭제 + 수직 재배분 ----------------
  // ★ 설계의 핵심 지점: 박스는 고정 높이 도형이라 "마지막 y + 간격"으로 줄을 덧붙이면 도형 밖으로
  //   흘러넘친다(3줄 60u 박스에 4번째 줄). 그래서 추가·삭제 뒤에는 항상 **전 줄을 도형 세로 범위
  //   안에서 재배분**해 텍스트 블록이 시각적으로 가운데 오게 한다. 폰트 크기·순서·x는 보존하고
  //   y만 다시 계산한다 — 형제 줄의 y가 바뀌지만 전부 같은 박스 <g> 안이라 scope 합법이고
  //   bleed-diff는 여전히 "그 박스만 변경"으로 통과한다.
  const LINE_GAP_PREF = 1.35;   // 선호 행간(폰트 크기 배수) — 손으로 짠 슬라이드의 실측 행간에 근사
  const LINE_GAP_MIN = 1.05;    // 가독 하한 — 이보다 좁으면 글자 상·하단이 서로 닿기 시작한다
  const LINE_BAND = 0.92;       // 도형 높이 중 텍스트가 쓰는 비율(위·아래 4%는 여백)
  const LINE_ASCENT = 0.8;      // 베이스라인 위 대문자 높이(em) — 슬롯 안 수직 중앙 정렬용

  // 도형의 로컬 좌표 경계. rect는 정확, polygon/polyline은 points bbox, ellipse/circle은 중심±반지름,
  // path는 **절대 명령이고 좌표가 전부 x,y 쌍일 때만** 좌표 bbox(제어점 포함이라 실제의 상계).
  // 판독 불가면 null → 호출측이 "현재 텍스트 블록 중심 보존" 모드로 후퇴한다(모르는 도형 밖으로
  // 글자를 밀어내지 않는다 — 다이아·게이트 같은 수제 도형에서 이게 안전한 기본값).
  const PATH_PAIRWISE_CMDS = /^[MLCSQTZ]+$/;   // H/V(단일 좌표)·A(플래그)·소문자(상대)는 제외
  function shapeBoxOf(g) {
    const sh = primaryShape(g);
    if (!sh) return null;
    const tag = sh.tagName.toLowerCase();
    const bb = (xs, ys) => (xs.length && ys.length
      ? { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), kind: tag }
      : null);
    if (tag === "rect") {
      const x = num(sh.getAttribute("x"), 0), y = num(sh.getAttribute("y"), 0);
      const w = num(sh.getAttribute("width"), NaN), h = num(sh.getAttribute("height"), NaN);
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
      return { x0: x, y0: y, x1: x + w, y1: y + h, kind: "rect" };
    }
    if (tag === "polygon" || tag === "polyline") {
      const n = (sh.getAttribute("points") || "").trim().split(/[\s,]+/).map((v) => parseFloat(v)).filter((v) => Number.isFinite(v));
      if (n.length < 4) return null;
      const xs = [], ys = [];
      for (let i = 0; i + 1 < n.length; i += 2) { xs.push(n[i]); ys.push(n[i + 1]); }
      return bb(xs, ys);
    }
    if (tag === "ellipse" || tag === "circle") {
      const cx = num(sh.getAttribute("cx"), 0), cy = num(sh.getAttribute("cy"), 0);
      const rx = num(sh.getAttribute(tag === "circle" ? "r" : "rx"), NaN);
      const ry = num(sh.getAttribute(tag === "circle" ? "r" : "ry"), rx);
      if (!Number.isFinite(rx) || !Number.isFinite(ry)) return null;
      return { x0: cx - rx, y0: cy - ry, x1: cx + rx, y1: cy + ry, kind: tag };
    }
    if (tag === "path") {
      const d = sh.getAttribute("d") || "";
      // 숫자를 다 걷어낸 나머지가 명령 문자열 — 전부 "x,y 쌍만 받는 절대 명령"이어야 좌표 bbox가 성립.
      const letters = d.replace(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/g, "").replace(/[\s,]/g, "");
      if (!letters || !PATH_PAIRWISE_CMDS.test(letters)) return null;   // 상대명령·H/V·호 = 후퇴
      const n = (d.match(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/g) || []).map((v) => parseFloat(v));
      if (n.length < 4 || n.length % 2 !== 0) return null;
      const xs = [], ys = [];
      for (let i = 0; i + 1 < n.length; i += 2) { xs.push(n[i]); ys.push(n[i + 1]); }
      return bb(xs, ys);
    }
    return null;
  }

  // 현재 텍스트 블록의 시각적 세로 중심(도형을 못 읽을 때의 기준점). 줄이 없으면 null.
  function textBlockCenter(g) {
    const ts = directChildren(g, "text");
    if (!ts.length) return null;
    const ys = ts.map((t) => num(t.getAttribute("y"), NaN)).filter((v) => Number.isFinite(v));
    if (!ys.length) return null;
    const f0 = num(ts[0].getAttribute("font-size"), 12);
    const fN = num(ts[ts.length - 1].getAttribute("font-size"), 12);
    return ((Math.min(...ys) - f0 * LINE_ASCENT) + (Math.max(...ys) + fN * (1 - LINE_ASCENT))) / 2;
  }

  // 재배분 시뮬레이션(쓰지 않고 계산만) — 추가가 가능한지 미리 보기 위해 분리했다.
  // gapOverride(D21 줄간격): 주면 자동 산출 대신 그 행간을 강제한다. 도형 밖으로 넘치면
  // overflow=true로 알리고(호출측이 거절) 자동 경로의 의미론은 그대로 둔다(인자 미지정 시 무변경).
  function planLines(g, sizes, preCenter, gapOverride) {
    const total = sizes.reduce((a, b) => a + b, 0);
    if (!sizes.length || total <= 0) return { ys: [], gap: LINE_GAP_PREF, overflow: false, boxed: false, height: 0 };
    const box = shapeBoxOf(g);
    let gap, top, overflow = false;
    if (box) {
      const h = box.y1 - box.y0;
      const fit = (h * LINE_BAND) / total;
      if (gapOverride != null) {
        gap = Math.max(LINE_GAP_MIN, gapOverride);
        if (sizes.length > 1 && gap > fit) overflow = true;   // 요청 행간이 도형 안에 안 들어감
      } else {
        gap = Math.min(LINE_GAP_PREF, fit);
        if (gap < LINE_GAP_MIN) { gap = LINE_GAP_MIN; overflow = true; }
      }
      top = box.y0 + (h - total * gap) / 2;             // 블록을 도형 세로 중앙에
    } else {
      gap = gapOverride != null ? Math.max(LINE_GAP_MIN, gapOverride) : LINE_GAP_PREF;   // 도형 미상 → 기존 블록 중심을 보존
      const c = Number.isFinite(preCenter) ? preCenter : 0;
      top = c - (total * gap) / 2;
    }
    const ys = [];
    let cur = top;
    for (const fs of sizes) { ys.push(cur + fs * (gap - 1) / 2 + fs * LINE_ASCENT); cur += fs * gap; }
    return { ys, gap, overflow, top, height: total * gap, boxed: !!box, box };
  }

  // 실제 재배분(y 기록). preCenter는 변형 **전에** 잰 값을 넘겨야 도형 미상 박스에서 블록이 안 밀린다.
  function relayoutLines(g, preCenter, gapOverride) {
    const texts = directChildren(g, "text");
    if (!texts.length) return { ys: [], gap: LINE_GAP_PREF, overflow: false, count: 0, boxed: false };
    const sizes = texts.map((t) => { const v = num(t.getAttribute("font-size"), NaN); return Number.isFinite(v) && v > 0 ? v : 12; });
    const plan = planLines(g, sizes, preCenter, gapOverride);
    texts.forEach((t, i) => { if (plan.ys[i] != null) t.setAttribute("y", fmt(plan.ys[i])); });
    return { ...plan, count: texts.length };
  }

  // 현재 행간(폰트 크기 배수) 추정 — 툴바 표시용. 줄이 2개 미만이면 null(간격 개념 없음).
  // 인접 줄의 baseline 차 / 위쪽 줄의 font-size 중앙값. 손으로 짠 y도 그대로 읽힌다.
  function currentLineGap(g) {
    const texts = directChildren(g, "text");
    if (texts.length < 2) return null;
    const rows = texts.map((t) => ({ y: num(t.getAttribute("y"), NaN), fs: num(t.getAttribute("font-size"), 12) }));
    const gaps = [];
    for (let i = 0; i + 1 < rows.length; i++) {
      if (!Number.isFinite(rows[i].y) || !Number.isFinite(rows[i + 1].y) || !(rows[i].fs > 0)) continue;
      gaps.push((rows[i + 1].y - rows[i].y) / rows[i].fs);
    }
    if (!gaps.length) return null;
    gaps.sort((a, b) => a - b);
    return Math.round(gaps[Math.floor(gaps.length / 2)] * 100) / 100;
  }

  // D21 줄간격 op — 재배분 로직(D20)을 그대로 재사용한다(새 배치 알고리즘을 만들지 않는다).
  // 넘침 정책도 addTextLine과 동일: 도형을 몰래 키우지 않고 정직하게 거절한다.
  function setLineSpacing(doc, g, op) {
    const texts = directChildren(g, "text");
    if (texts.length < 2) throw new Error("줄이 2개 이상이어야 줄간격을 바꿀 수 있습니다(현재 " + texts.length + "줄).");
    const before = texts.map((t) => t.getAttribute("y"));
    const preCenter = textBlockCenter(g);
    const plan = relayoutLines(g, preCenter, op.spacing);
    if (plan.overflow) {
      texts.forEach((t, i) => { if (before[i] != null) t.setAttribute("y", before[i]); });   // 원상 복구
      throw new Error("줄간격 " + op.spacing + "배는 이 도형 높이"
        + (plan.box ? " (" + Math.round(plan.box.y1 - plan.box.y0) + "u)" : "") + "에 들어가지 않습니다 — 먼저 박스 높이를 키우세요.");
    }
    return plan;
  }

  // 줄이 하나도 없는 박스에 처음 줄을 만들 때의 기본 스타일 — 도형에서 유도(가운데 정렬, 읽을 수
  // 있는 크기). 폰트 크기는 도형 높이의 22%를 10~18u로 클램프(수제 슬라이드의 본문 13~14u와 근사).
  function defaultLineFor(doc, g) {
    const box = shapeBoxOf(g);
    const t = doc.createElementNS(SVGNS, "text");
    const h = box ? (box.y1 - box.y0) : 40;
    const fs = Math.max(10, Math.min(18, Math.round(h * 0.22)));
    t.setAttribute("x", fmt(box ? (box.x0 + box.x1) / 2 : 0));
    t.setAttribute("y", fmt(box ? (box.y0 + box.y1) / 2 : 0));   // relayoutLines가 곧 덮어씀
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", String(fs));
    t.setAttribute("font-weight", "700");
    t.setAttribute("fill", "#111827");
    return t;
  }

  // 줄 추가. 스타일은 이웃 줄(afterIndex 줄, 생략 시 마지막 줄)의 <text>를 그대로 복제해 상속한다
  // (font-size/weight/fill/text-anchor/letter-spacing/x가 전부 따라온다 — 기본 스타일 아님).
  // 넘침 정책 = **자라지 않고 거절**: 가독 하한 미만이 되면 추가를 취소하고 이유를 말한다.
  //   WHY: 빽빽한 수제 다이어그램에서 rect 높이를 몰래 키우면 이웃과 겹치는데 bleed-diff는
  //        "그 박스만 바뀜"이라 통과해 버린다(검사는 초록인데 그림은 깨지는 최악의 조합).
  //        게다가 다이아·게이트 같은 비-rect 도형은 애초에 키울 수 없어 같은 버튼이 도형별로
  //        다르게 행동하게 된다. 높이는 W/H 필드로 사용자가 명시적으로 키우는 게 낫다.
  function addTextLine(doc, g, op) {
    const texts = directChildren(g, "text");
    const at = (op.afterIndex != null && op.afterIndex < texts.length) ? op.afterIndex : (texts.length ? texts.length - 1 : -1);
    const donor = at >= 0 ? texts[at] : null;
    const preCenter = textBlockCenter(g);
    const t = donor ? donor.cloneNode(false) : defaultLineFor(doc, g);
    // 복제본이 주소·id를 물려받으면 eid가 중복된다(박스 내부 <text>는 미stamp가 원칙) — 방어적 제거.
    ["id", "data-arch-eid", "data-svgtext", "data-svgbox", "data-svgedge"].forEach((a) => t.removeAttribute(a));
    t.textContent = typeof op.text === "string" ? op.text : "";
    if (donor) donor.parentNode.insertBefore(t, donor.nextSibling);
    else g.appendChild(t);
    const plan = relayoutLines(g, preCenter);
    if (plan.overflow) {
      t.remove();
      relayoutLines(g, preCenter);   // 원상 복구(추가 전 배치로)
      const h = plan.box ? Math.round(plan.box.y1 - plan.box.y0) : null;
      throw new Error("이 박스에 " + (texts.length + 1) + "번째 줄을 넣으면 줄 간격이 가독 한계 미만이 됩니다"
        + (h != null ? " (도형 높이 " + h + "u)" : "") + " — 먼저 박스 높이를 키우거나 다른 줄을 지우세요.");
    }
    return plan;
  }

  // 줄 삭제. 삭제는 총량이 줄어드는 방향이라 넘침으로 막지 않는다(이미 넘치던 박스는 최선으로 배분).
  // 마지막 한 줄까지 지울 수 있다 — 텍스트 없는 도형은 정당한 상태이고(주 라벨=없음, 패널은 "+"만
  // 보여줌) stamp는 그대로 남아 재열기 후에도 계속 선택·편집된다.
  function removeTextLine(doc, g, op) {
    const texts = directChildren(g, "text");
    if (!texts.length) throw new Error("이 박스에는 삭제할 텍스트 줄이 없습니다.");
    if (op.line >= texts.length) throw new Error("줄 인덱스 범위 초과: " + op.line + " (줄 " + texts.length + "개)");
    const preCenter = textBlockCenter(g);
    texts[op.line].remove();
    return relayoutLines(g, preCenter);
  }

  // ---------------- D27b: SVG 단위 붙여넣기 (svgbox/svgtext/svgedge) ----------------
  // outerHTML을 SVG 네임스페이스로 파싱(image/svg+xml — inert) → doc 소유로 import → 새 eid(프리픽스별
  // max+1) + 좌표 오프셋(단위의 자기 좌표계, SVG user units) → owner <svg>에 append.
  function findOwnerSvg(doc) {
    const anchor = doc.querySelector('[data-svgbox="1"], [data-svgtext="1"], [data-svgedge="1"]');
    if (anchor) {
      const own = anchor.ownerSVGElement || (anchor.closest && anchor.closest("svg"));
      if (own) return own;
    }
    return doc.querySelector('svg[data-object="true"], svg[data-object], svg') || null;
  }
  function offsetSvgUnit(el, kind, dx, dy) {
    if (kind === "svgbox") {
      const tr = parseTranslate(el) || { x: 0, y: 0 };
      el.setAttribute("transform", "translate(" + fmt(tr.x + dx) + " " + fmt(tr.y + dy) + ")");
    } else if (kind === "svgtext") {
      const p = parseTextPos(el);
      if (p.mode === "transform") el.setAttribute("transform", "translate(" + fmt(p.x + dx) + " " + fmt(p.y + dy) + ")");
      else { el.setAttribute("x", fmt(p.x + dx)); el.setAttribute("y", fmt(p.y + dy)); }
    } else if (kind === "svgedge") {
      const tag = el.tagName.toLowerCase();
      if (tag === "line") {
        el.setAttribute("x1", fmt(num(el.getAttribute("x1"), 0) + dx)); el.setAttribute("y1", fmt(num(el.getAttribute("y1"), 0) + dy));
        el.setAttribute("x2", fmt(num(el.getAttribute("x2"), 0) + dx)); el.setAttribute("y2", fmt(num(el.getAttribute("y2"), 0) + dy));
        return;
      }
      const pts = tag === "path" ? parsePathPoints(el.getAttribute("d")) : null;
      if (pts) { el.setAttribute("d", pointsToD(pts.map((p) => ({ x: p.x + dx, y: p.y + dy })))); return; }
      // 파싱 불가(곡선 등) → transform으로 통째 이동(기하 편집은 어차피 유보 단위).
      const cur = el.getAttribute("transform") || "";
      el.setAttribute("transform", ("translate(" + fmt(dx) + " " + fmt(dy) + ") " + cur).trim());
    }
  }
  function pasteUnit(doc, html, kind, dx, dy) {
    const wrap = '<svg xmlns="' + SVGNS + '">' + html + "</svg>";
    const p = new DOMParser().parseFromString(wrap, "image/svg+xml");
    if (p.querySelector("parsererror")) throw new Error("붙여넣을 SVG 요소 파싱 실패");
    const src = p.documentElement && p.documentElement.firstElementChild;
    if (!src) throw new Error("붙여넣을 SVG 요소를 찾을 수 없습니다.");
    const el = doc.importNode(src, true);
    const eid = DomAdapter.freshEidFor(doc, kind + ":");
    el.setAttribute("data-arch-eid", eid);
    if (kind === "svgbox") el.setAttribute("data-svgbox", "1");
    else if (kind === "svgtext") el.setAttribute("data-svgtext", "1");
    else if (kind === "svgedge") el.setAttribute("data-svgedge", "1");
    offsetSvgUnit(el, kind, dx, dy);
    const svg = findOwnerSvg(doc);
    if (!svg) throw new Error("붙여넣을 대상 <svg>가 없습니다.");
    svg.appendChild(el);
    return { eid, kind };
  }

  // ---------------- 3차 보증: marker 인지 bleed-diff ----------------
  // 화살촉 크기 조절만이 유일하게 "선택 요소 밖"에 정당한 부수 변경을 만든다 — <defs>에 그 화살표
  // 전용 marker 클론 1개. §4.3-3의 legend/viewBox whitelist와 같은 성격이라 여기서 명시적으로,
  // 좁게 화이트리스트한다:
  //   (1) 추가/제거된 marker의 id가 "<before에도 있던 base marker id>--<선택 eid slug>" 꼴이고
  //   (2) 그 marker의 data-arch-edge-clone이 선택 eid와 일치할 때만 정당.
  // 통과하면 그 클론을 양쪽 문서 사본에서 제거한 뒤 표준 bleedDiff로 넘긴다 → 공유 marker(#ah 등)가
  // 바이트 동일한지, 다른 화살표의 marker-end가 그대로인지(각 화살표가 stamp된 eid라 outerHTML
  // 비교로 커버)를 기존 검증 축이 그대로 실증한다. 그 외 defs 변경은 전부 위반으로 남는다.
  function markerMap(doc) {
    const m = new Map();
    doc.querySelectorAll("marker").forEach((el) => { const id = el.getAttribute("id"); if (id) m.set(id, el); });
    return m;
  }
  // opts(D27a/b): mode="remove"/"add"를 DomAdapter.bleedDiff로 그대로 위임(삭제/붙여넣기 안전망 공유).
  //   marker 클론 회계는 화살촉 크기(replace) 전용이라 remove/add에선 changed=0(defs 무변경)로 자연 통과.
  function bleedDiff(beforeDoc, afterDoc, allowed, opts) {
    const set = allowed instanceof Set ? allowed : new Set(Array.isArray(allowed) ? allowed : [allowed]);
    const ma = markerMap(beforeDoc), mb = markerMap(afterDoc);
    // 실제로 달라진 marker: 추가 · 제거 · 내용 변경(반복 조절은 기존 클론을 제자리 수정한다).
    const changed = new Set();
    ma.forEach((el, id) => { const o = mb.get(id); if (!o || o.outerHTML !== el.outerHTML) changed.add(id); });
    mb.forEach((el, id) => { if (!ma.has(id)) changed.add(id); });
    if (!changed.size) return DomAdapter.bleedDiff(beforeDoc, afterDoc, allowed, opts);
    // 선택 화살표가 "소유한" 클론 id만 정당: id가 <before에 있던 base marker>--<eid slug> 꼴이고
    // data-arch-edge-clone이 그 eid. 공유 marker(#ah 등)나 다른 화살표의 클론은 여기 못 든다.
    const owned = new Set();
    for (const eid of set) {
      if (!isSvgEdgeEid(eid)) continue;
      const suf = "--" + eidSlug(eid);
      for (const [id, el] of [...ma, ...mb]) {
        if (id.length <= suf.length || id.slice(-suf.length) !== suf) continue;
        if (!ma.has(id.slice(0, -suf.length))) continue;          // base는 원래 있던 공유 marker여야
        if (el.getAttribute("data-arch-edge-clone") !== eid) continue;
        owned.add(id);
      }
    }
    const offenders = [...changed].filter((id) => !owned.has(id)).map((id) => "허용 밖 marker 변경: " + id);
    if (offenders.length) return { ok: false, offenders };
    // 정당한 클론을 양쪽 문서 사본에서 걷어낸 뒤 표준 bleed-diff로 "그 밖은 바이트 동일"을 실증.
    const bC = beforeDoc.cloneNode(true), aC = afterDoc.cloneNode(true);
    owned.forEach((id) => {
      const x = findMarker(bC, id); if (x) x.remove();
      const y = findMarker(aC, id); if (y) y.remove();
    });
    return DomAdapter.bleedDiff(bC, aC, allowed, opts);
  }

  return {
    SVGNS, stampBoxes, stampTexts, stampEdges,
    isSvgBoxEid, isSvgTextEid, isSvgEdgeEid, isSvgEid,
    getBox, getText, getEdge, shapeOf, isResizable,
    primaryShape, parseTranslate, parseTextPos, mainTextEl, directChildren,
    styleSnapshot, textSnapshot, edgeSnapshot, contextFor, enumerate,
    buildToolSchema, buildTextSchema, buildEdgeSchema, buildBoxSchema, buildBatchSchema,
    sanitizeOps, sanitizeTextOps, sanitizeEdgeOps,
    applyOps, applyTextOp, applyEdgeOp, applyReorder, unitEl, isColorToken, recenterTexts,
    // D21 서식: 줄 단위 텍스트 스타일 · 줄간격 · 문서 유래 타입 스케일
    applyTextStyleOp, setLineSpacing, currentLineGap, typeScale, textStyleSnapshot, lineTextStyle,
    cleanTextStyleValue, anchorXFor, TEXT_STYLE_KEYS, TEXT_STYLE_ATTR,
    FONT_MIN, FONT_MAX, TRACK_MIN, TRACK_MAX, SPACING_MIN, SPACING_MAX,
    // D22 선택 집합 축(단일=크기 1)
    toEidSet, mkShapeResolver, pinFor, kindOfEid,
    // 화살표 기하·화살촉 헬퍼(테스트·에이전트 대조용)
    parsePathPoints, pointsToD, edgePoints, promoteLineToPath,
    markerCloneId, markerRefOf, baseMarkerIdFor, headScaleOf, applyHeadSize,
    HEAD_MIN, HEAD_MAX, bleedDiff,
    // 화살촉 배율 공용 코어 + 전역(문서 단위) 일괄 조절
    setMarkerHeadScale, markerHeadScale, headBaseGeom, markerInventory, setGlobalHeadSize,
    // 줄 추가·삭제와 수직 재배분
    shapeBoxOf, textBlockCenter, planLines, relayoutLines, addTextLine, removeTextLine, defaultLineFor,
    LINE_GAP_PREF, LINE_GAP_MIN, LINE_BAND, LINE_ASCENT,
    // D27b: SVG 단위 붙여넣기
    pasteUnit, offsetSvgUnit, findOwnerSvg,
  };
})();

if (typeof globalThis !== "undefined") globalThis.SvgAdapter = SvgAdapter;
