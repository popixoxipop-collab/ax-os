// editor-agent — sandboxed iframe(srcdoc) 안에서만 실행되는 스크립트의 소스.
// 부모(editor.js:buildSrcdoc)가 뷰를 만들 때 문자열로 주입한다. authoritative 소스
// Document에는 절대 들어가지 않으므로 다운로드 산출물에 이 코드가 실릴 일이 없다
// (serializeClean이 방어적으로 한 번 더 제거).
//
// 역할(모드별):
//   선택      : hit-test → arch-hit {eid,kind,rect}, hover 아웃라인, 적용 후 flash
//   편집      : 요소 선택 → 이동(드래그)·리사이즈(코너 핸들)·텍스트(더블클릭 contenteditable)
//               → arch-geom / arch-text (부모가 같은 setStyle/setText apply 경로로 처리)
//   그리기    : 빈 곳 클릭 → arch-draw-at {x,y,kind}
//   검증/레이아웃/다듬기 : 클릭 하이라이트 + arch-collect-boxes 요청에 실측 박스 응답
// 오버레이는 전부 data-arch-overlay 속성을 달고 iframe 뷰에만 산다.
//
// 주의: agentMain은 Function.toString()으로 직렬화되므로 완전히 self-contained여야 하고
// (외부 클로저 참조 금지), 소스 텍스트에 "</" 시퀀스가 들어가면 안 된다(script 파싱 종료 방지).
const ArchAgent = (() => {
  function agentMain() {
    var SVGNS = "http://www.w3.org/2000/svg";
    var mode = "select";
    var drawKind = "textbox";
    // provenance: "dom"(class b, [data-object] 슬라이드) | "archify"(class a, [data-arch-id] 렌더)
    // 부모가 arch-mode 메시지로 권위 있게 지정하지만, 첫 상호작용 전이라도 옳게 동작하도록 자가 감지도 한다.
    var provenance = (document.querySelector("[data-arch-id]") && !document.querySelector("[data-object]")) ? "archify" : "dom";
    var selEid = null;    // 편집 모드에서 선택된 요소 eid
    var selSvg = null;    // class c: 선택이 SVG 박스면 { shape, svg }, CSS 박스면 null
    var drag = null;      // { kind:"move"|"resize", corner, sx, sy, l0,t0,w0,h0 } (svg면 tx0/ty0/rw0/rh0)
    var editing = null;   // { line, orig, eid } — contenteditable 진행 상태(class-b obj)
    // D25a: 요소 편집(블록) 토글. ON=드래그·리사이즈·패널(오늘 동작), OFF=텍스트 직접(인라인) 편집.
    //   부모(editor.js)가 arch-mode 메시지로 권위 있게 내려준다(기본 ON).
    var elementEditOn = true;
    // D25c: ON일 때 hit-test를 좁히는 3-way 도구. "all"(전체·오늘) | "node"(노드 전용) | "arrow"(화살표 우선).
    var editFocus = "all";
    // D25b: OFF 인라인 텍스트 편집 상태. SVG <text>는 오버레이 <input>(정확한 글리프 위치·크기),
    //   class-b obj(HTML div)는 기존 contenteditable(editing) 경로를 단일클릭으로 승격해 재사용한다.
    //   { input, eid, kind:"svgbox"|"svgtext", line, orig }
    var inlineEdit = null;
    // D22: 부모가 권위 있게 내려주는 선택 **집합**. 뷰는 이걸 그리기만 한다(상태는 부모가 소유).
    var selSet = [];      // 현재 선택된 eid 전부(주 선택 포함)
    var selPrimary = null;   // D41: 마지막 drawSelSet의 주 선택 — 그룹 이동 중 오버레이 재배치에 쓴다
    var groupMoved = false;  // D41: 방금 그룹 이동 드래그가 실제로 움직였으면 true → 뒤따르는 click이 선택을 무너뜨리지 못하게 소비
    // D30: OFF(텍스트편집)에서 유닛 테두리 mousedown이 "유닛 전체 이동"을 arm하면 true.
    //   뒤따르는 click이 인라인 텍스트편집을 열지 못하게 막는 표식(매 mousedown 시작 시 리셋).
    var offBorderArmed = false;

    function mkBox(name, css) {
      var d = document.createElement("div");
      d.setAttribute("data-arch-overlay", name);
      var s = d.style;
      s.position = "fixed";
      s.pointerEvents = "none";
      s.zIndex = "2147483000";
      s.display = "none";
      s.boxSizing = "border-box";
      for (var k in css) s[k] = css[k];
      document.body.appendChild(d);
      return d;
    }
    var hoverBox = mkBox("hover", { border: "1.5px dashed rgba(229,72,77,0.85)", borderRadius: "3px" });
    var selBox = mkBox("sel", { border: "2px solid #E5484D", borderRadius: "3px", boxShadow: "0 0 0 3px rgba(229,72,77,0.22)" });
    var flashBox = mkBox("flash", { border: "2px solid #30A46C", borderRadius: "3px", background: "rgba(48,164,108,0.14)", transition: "opacity .6s ease" });
    // D30: OFF 테두리대 hover 큐 — "잡아서 이동" 어포던스. 보라 점선 + 옅은 보라 채움으로 ON 이동
    //   오버레이(#6E56CF)와 같은 색감을 써 "이동"을 읽히게 하고, 인라인 텍스트편집의 빨간 hoverBox와
    //   시각적으로 명확히 구분된다(빨강 점선=텍스트 편집, 보라 점선=상자 이동).
    var moveHoverBox = mkBox("movehover", { border: "1.5px dashed rgba(110,86,207,0.95)", borderRadius: "3px", background: "rgba(110,86,207,0.06)" });
    // D42: 화살표 끝점 스냅 마커 — 스냅 후보에 붙는 순간 그 지점에 작은 초록 원을 잠깐 보여준다(발견성).
    var snapMarker = mkBox("snap", { border: "2px solid #30A46C", borderRadius: "50%", background: "rgba(48,164,108,0.28)", zIndex: "2147483400" });

    // 편집 크롬: 이동 오버레이(전체 bbox, 드래그) + 4 코너 리사이즈 핸들
    var moveOverlay = mkBox("move", {
      pointerEvents: "auto", cursor: "move", zIndex: "2147483200",
      background: "rgba(110,86,207,0.06)", border: "1px solid rgba(110,86,207,0.35)",
    });
    var CORNERS = ["nw", "ne", "sw", "se"];
    var CURSORS = { nw: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", se: "nwse-resize" };
    var handles = [];
    for (var ci = 0; ci < 4; ci++) {
      var h = mkBox("handle", {
        pointerEvents: "auto", zIndex: "2147483300", width: "12px", height: "12px",
        background: "#6E56CF", border: "2px solid #FFFFFF", borderRadius: "3px",
        cursor: CURSORS[CORNERS[ci]], boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
      });
      h.setAttribute("data-corner", CORNERS[ci]);
      handles.push(h);
    }

    // D18: 화살표 오버레이 — 선택/hover를 "그 화살표의 폴리라인"으로 그린다(bbox 사각형이 아니라).
    // 소스 SVG에는 절대 그리지 않는다: 화면 고정 오버레이 <svg>에 화면좌표 폴리라인으로만 그린다.
    var edgeSvg = document.createElementNS(SVGNS, "svg");
    edgeSvg.setAttribute("data-arch-overlay", "edge");
    edgeSvg.style.position = "fixed";
    edgeSvg.style.left = "0"; edgeSvg.style.top = "0";
    edgeSvg.style.width = "100%"; edgeSvg.style.height = "100%";
    edgeSvg.style.pointerEvents = "none";
    edgeSvg.style.zIndex = "2147483100";
    function mkPolyline(stroke, width, dash, opacity) {
      var p = document.createElementNS(SVGNS, "polyline");
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", stroke);
      p.setAttribute("stroke-width", width);
      p.setAttribute("stroke-linejoin", "round");
      p.setAttribute("stroke-linecap", "round");
      if (dash) p.setAttribute("stroke-dasharray", dash);
      p.setAttribute("opacity", opacity);
      p.style.display = "none";
      edgeSvg.appendChild(p);
      return p;
    }
    var edgeHoverLine = mkPolyline("#E5484D", "4", "5 4", "0.6");
    var edgeSelLine = mkPolyline("#E5484D", "4", "", "0.85");
    document.body.appendChild(edgeSvg);

    // ---- D22: 다중 선택 오버레이 ----
    // 주 선택(마지막 클릭)은 기존 selBox/edgeSelLine 그대로 쓰고, **나머지 집합 원소**만 이 풀로
    // 그린다. WHY: data-arch-overlay="sel"이 문서에 하나뿐이라는 전제에 기존 테스트가 걸려 있고,
    // "마지막에 만진 것"이 시각적으로 구분되는 편이 실제로도 읽기 쉽다.
    var mselBoxes = [], mselLines = [];
    function mselBox(i) {
      while (mselBoxes.length <= i) {
        mselBoxes.push(mkBox("msel", {
          border: "2px solid #30A46C", borderRadius: "3px",
          boxShadow: "0 0 0 3px rgba(48,164,108,0.18)",
        }));
      }
      return mselBoxes[i];
    }
    function mselLine(i) {
      while (mselLines.length <= i) mselLines.push(mkPolyline("#30A46C", "4", "", "0.85"));
      return mselLines[i];
    }
    function hideMsel() {
      for (var i = 0; i < mselBoxes.length; i++) mselBoxes[i].style.display = "none";
      for (var j = 0; j < mselLines.length; j++) mselLines[j].style.display = "none";
    }
    // 부모가 보낸 집합을 그린다. 재렌더 뒤 복원도 이 한 경로로 수렴한다(뷰는 순수 함수).
    function drawSelSet(eids, primary) {
      selSet = eids || [];
      selPrimary = primary || null;   // D41: 그룹 이동 중 오버레이 재배치용
      hideMsel();
      var bi = 0, li = 0;
      for (var i = 0; i < selSet.length; i++) {
        var el = document.querySelector('[data-arch-eid="' + attrEsc(selSet[i]) + '"]');
        if (!el) continue;
        var isEdge = el.getAttribute("data-svgedge") === "1" || String(selSet[i]).indexOf("svgedge:") === 0;
        if (selSet[i] === primary) {
          if (isEdge) { selBox.style.display = "none"; drawEdgeSel(el); }
          else { hideEdgeSel(); place(selBox, el); }
          continue;
        }
        if (isEdge) { setPolyline(mselLine(li++), edgeScreenPts(el, [])); }
        else { place(mselBox(bi++), el); }
      }
      if (!selSet.length) { selBox.style.display = "none"; hideEdgeSel(); }
      // 다중 선택 중에는 이동/리사이즈/정점 핸들을 감춘다 — 여러 요소를 동시에 끄는 드래그는
      // 이 버전의 범위가 아니고, 핸들이 남아 있으면 "주 선택만 움직이는" 오해를 부른다.
      if (selSet.length > 1) hideEditChrome();
      else if (mode === "edit" && selEid) showEditChrome();
    }

    var vHandles = [], mHandles = [];   // 정점 핸들 / 중간점 핸들 (가변 개수 풀)
    function edgeHandle(i, isMid) {
      var arr = isMid ? mHandles : vHandles;
      while (arr.length <= i) {
        var hh = mkBox(isMid ? "midhandle" : "vhandle", isMid
          ? { pointerEvents: "auto", zIndex: "2147483300", width: "10px", height: "10px",
              background: "rgba(255,255,255,0.92)", border: "2px solid #6E56CF", borderRadius: "50%",
              cursor: "copy", boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }
          : { pointerEvents: "auto", zIndex: "2147483350", width: "12px", height: "12px",
              background: "#E5484D", border: "2px solid #FFFFFF", borderRadius: "3px",
              cursor: "move", boxShadow: "0 1px 3px rgba(0,0,0,0.4)" });
        hh.setAttribute("data-vi", String(arr.length));
        (function (node, mid) {
          node.addEventListener("mousedown", function (e) {
            if (mode !== "edit") return;
            startEdgeDrag(e, parseInt(node.getAttribute("data-vi"), 10), mid);
          });
        })(hh, isMid);
        arr.push(hh);
      }
      return arr[i];
    }
    function hideEdgeHandles() {
      for (var i = 0; i < vHandles.length; i++) vHandles[i].style.display = "none";
      for (var j = 0; j < mHandles.length; j++) mHandles[j].style.display = "none";
    }
    function setPolyline(line, sp) {
      if (!sp || sp.length < 2) { line.style.display = "none"; return; }
      var s = "";
      for (var i = 0; i < sp.length; i++) s += (i ? " " : "") + sp[i].x + "," + sp[i].y;
      line.setAttribute("points", s);
      line.style.display = "block";
    }
    function drawEdgeSel(el) { setPolyline(edgeSelLine, edgeScreenPts(el, [])); }
    function hideEdgeSel() { edgeSelLine.style.display = "none"; }
    function drawEdgeHover(el) { setPolyline(edgeHoverLine, edgeScreenPts(el, [])); }
    function hideEdgeHover() { edgeHoverLine.style.display = "none"; }
    // 편집 크롬(엣지): 폴리라인 + 정점마다 핸들 + 각 선분 중간점 핸들(=꼭짓점 추가).
    function showEdgeChrome() {
      var el = selectedEl();
      if (!el) { hideEdgeChrome(); return; }
      var sp = edgeScreenPts(el, []);
      hideEdgeHandles();
      if (!sp) { hideEdgeSel(); return; }   // 곡선 등 미지원 기하 — 핸들 없음
      setPolyline(edgeSelLine, sp);
      for (var a = 0; a < sp.length; a++) {
        var h = edgeHandle(a, false);
        h.style.display = "block";
        h.style.left = (sp[a].x - 6) + "px";
        h.style.top = (sp[a].y - 6) + "px";
      }
      for (var b = 0; b + 1 < sp.length; b++) {
        var mh = edgeHandle(b, true);
        mh.style.display = "block";
        mh.style.left = ((sp[b].x + sp[b + 1].x) / 2 - 5) + "px";
        mh.style.top = ((sp[b].y + sp[b + 1].y) / 2 - 5) + "px";
      }
    }
    function hideEdgeChrome() { hideEdgeSel(); hideEdgeHover(); hideEdgeHandles(); }

    function isOverlay(el) {
      return !!(el && el.getAttribute && el.getAttribute("data-arch-overlay") != null);
    }

    function inSvg(el) {
      var p = el;
      while (p) {
        if (p.namespaceURI === SVGNS) return true;
        p = p.parentElement;
      }
      return false;
    }

    // ---- class c: SVG 좌표 헬퍼 ----
    function ownerSvgOf(el) {
      if (el && el.ownerSVGElement) return el.ownerSVGElement;
      var p = el;
      while (p) { if (p.namespaceURI === SVGNS && p.tagName && p.tagName.toLowerCase() === "svg") return p; p = p.parentElement; }
      return null;
    }
    function parseTranslate(g) {
      var t = g.getAttribute("transform") || "";
      var m = /translate\(\s*(-?[\d.]+)(?:[ ,]+(-?[\d.]+))?\s*\)/.exec(t);
      if (!m) return { x: 0, y: 0 };
      return { x: parseFloat(m[1]), y: m[2] != null ? parseFloat(m[2]) : 0 };
    }
    function svgRectOf(g) {
      for (var i = 0; i < g.children.length; i++) { if (g.children[i].tagName.toLowerCase() === "rect") return g.children[i]; }
      return null;
    }
    // 자유 <text>의 위치 판독 — x/y 우선, transform="translate(...)"면 그쪽(대부분 x/y).
    function textPos(t) {
      var tr = t.getAttribute("transform") || "";
      var m = /translate\(\s*(-?[\d.]+)(?:[ ,]+(-?[\d.]+))?\s*\)/.exec(tr);
      if (m) return { x: parseFloat(m[1]), y: m[2] != null ? parseFloat(m[2]) : 0, mode: "transform" };
      return { x: parseFloat(t.getAttribute("x")) || 0, y: parseFloat(t.getAttribute("y")) || 0, mode: "xy" };
    }
    // 화면 픽셀 델타 (dx,dy) → SVG user 단위 델타. getScreenCTM 역행렬로 viewBox 매핑을 정확히 반영
    // (iframe 안이라 부모 stage scale과 무관 — 이벤트도 getScreenCTM도 같은 iframe 좌표계).
    function svgUserDelta(svg, dx, dy) {
      if (!svg || !svg.getScreenCTM) return { x: dx, y: dy };
      var ctm = svg.getScreenCTM();
      if (!ctm) return { x: dx, y: dy };
      var inv = ctm.inverse();
      var p0 = svg.createSVGPoint(); p0.x = 0; p0.y = 0;
      var p1 = svg.createSVGPoint(); p1.x = dx; p1.y = dy;
      var u0 = p0.matrixTransform(inv), u1 = p1.matrixTransform(inv);
      return { x: u1.x - u0.x, y: u1.y - u0.y };
    }
    function fmtNum(n) { return String(Math.round(n * 100) / 100); }
    function recenterSvgTexts(g, width) {
      var cx = Math.round((width / 2) * 100) / 100;
      for (var i = 0; i < g.children.length; i++) {
        var c = g.children[i];
        if (c.tagName.toLowerCase() === "text" && (c.getAttribute("text-anchor") || "") === "middle") c.setAttribute("x", fmtNum(cx));
      }
    }

    // ---- D18: 화살표(엣지) 기하 — 소스측 SvgAdapter와 같은 의미론을 self-contained로 복제 ----
    // 전량 소비 파서: 모든 토큰이 [명령+수+수]로 소진되고 M,L,L… 순서일 때만 정점을 준다.
    // 곡선·상대명령·암묵 lineto가 섞이면 null → 기하 편집 불가(선택·화살촉 크기만).
    function parsePathPtsA(d) {
      var s = String(d || "").trim();
      if (!s) return null;
      var toks = s.match(/[A-Za-z]|-?\d*\.?\d+(?:e[+-]?\d+)?/gi);
      if (!toks) return null;
      if (toks.join("") !== s.replace(/[\s,]/g, "")) return null;
      var pts = [];
      for (var i = 0; i < toks.length; i += 3) {
        var c = toks[i];
        if (!/^[A-Za-z]$/.test(c)) return null;
        if (pts.length === 0 ? c !== "M" : c !== "L") return null;
        var x = parseFloat(toks[i + 1]), y = parseFloat(toks[i + 2]);
        if (!isFinite(x) || !isFinite(y)) return null;
        pts.push({ x: x, y: y });
      }
      return pts.length >= 2 ? pts : null;
    }
    function ptsToDA(pts) {
      var out = "";
      for (var i = 0; i < pts.length; i++) out += (i === 0 ? "M" : " L") + fmtNum(pts[i].x) + "," + fmtNum(pts[i].y);
      return out;
    }
    function edgePtsOf(el) {
      if (!el) return null;
      var tag = el.tagName.toLowerCase();
      if (tag === "line") {
        var p = [
          { x: parseFloat(el.getAttribute("x1")), y: parseFloat(el.getAttribute("y1")) },
          { x: parseFloat(el.getAttribute("x2")), y: parseFloat(el.getAttribute("y2")) },
        ];
        return (isFinite(p[0].x) && isFinite(p[0].y) && isFinite(p[1].x) && isFinite(p[1].y)) ? p : null;
      }
      if (tag === "path") return parsePathPtsA(el.getAttribute("d"));
      return null;
    }
    function writePtsA(el, pts) {
      if (el.tagName.toLowerCase() === "line") {
        el.setAttribute("x1", fmtNum(pts[0].x)); el.setAttribute("y1", fmtNum(pts[0].y));
        el.setAttribute("x2", fmtNum(pts[1].x)); el.setAttribute("y2", fmtNum(pts[1].y));
        return el;
      }
      el.setAttribute("d", ptsToDA(pts));
      return el;
    }
    // 뷰 전용 승격(정점을 얻은 2점 <line> → 등가 <path>). 부모가 authoritative 소스에 같은 승격을
    // addVertex op으로 수행하므로 여기서는 드래그 미리보기만 맞으면 된다.
    function promoteLineA(el, pts) {
      var p = document.createElementNS(SVGNS, "path");
      var attrs = el.attributes;
      for (var i = 0; i < attrs.length; i++) {
        var n = attrs[i].name.toLowerCase();
        if (n === "x1" || n === "y1" || n === "x2" || n === "y2") continue;
        p.setAttribute(attrs[i].name, attrs[i].value);
      }
      if (!p.hasAttribute("fill")) p.setAttribute("fill", "none");
      p.setAttribute("d", ptsToDA(pts));
      el.replaceWith(p);
      return p;
    }
    // user 좌표 → 화면 좌표(요소 자신의 CTM 기준: 조상 transform까지 반영).
    function toScreenPt(el, x, y, m) {
      var svg = ownerSvgOf(el);
      var ctm = m || (el.getScreenCTM ? el.getScreenCTM() : null);
      if (!svg || !ctm) return { x: x, y: y };
      var p = svg.createSVGPoint(); p.x = x; p.y = y;
      var r = p.matrixTransform(ctm);
      return { x: r.x, y: r.y };
    }
    // 요소 기준 화면px 델타 → user 델타(박스/텍스트의 svgUserDelta와 같은 원리, CTM만 요소 것).
    function elemUserDelta(el, dx, dy) {
      var ctm = el.getScreenCTM ? el.getScreenCTM() : null;
      var svg = ownerSvgOf(el);
      if (!ctm || !svg) return { x: dx, y: dy };
      var inv = ctm.inverse();
      var p0 = svg.createSVGPoint(); p0.x = 0; p0.y = 0;
      var p1 = svg.createSVGPoint(); p1.x = dx; p1.y = dy;
      var u0 = p0.matrixTransform(inv), u1 = p1.matrixTransform(inv);
      return { x: u1.x - u0.x, y: u1.y - u0.y };
    }
    function distToSeg(px, py, ax, ay, bx, by) {
      var dx = bx - ax, dy = by - ay;
      var L2 = dx * dx + dy * dy;
      var t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      var cx = ax + t * dx - px, cy = ay + t * dy - py;
      return Math.sqrt(cx * cx + cy * cy);
    }
    // ★ 얇은 선(2px)은 elementFromPoint로 사실상 못 누른다. hit-proxy 요소를 소스에 심으면
    // bleed-diff가 잡으므로(저장물 오염) 대신 기하로 푼다: stamp된 화살표들의 정점을 화면
    // 좌표로 투영해 클릭점~각 선분 거리를 재고 EDGE_HIT_PX 이내 최근접을 고른다.
    var EDGE_HIT_PX = 8;
    // D25c: 화살표 편집 focus에서 쓰는 넓힌 허용 반경. "선 클릭이 잘 안 됨"(사용자 신고)의 직접
    // 수정 레버 — 얇은 2px 선에서 3배 가까이 떨어진 클릭도 그 화살표를 잡는다.
    var EDGE_HIT_PX_FOCUS = 22;
    // D44: "두 요소 사이 꼭짓점 중점" 스냅의 1차 필터(후보 요소 선별) 반경. 스냅 판정 자체는 여전히 22px(EDGE_HIT_PX_FOCUS)이나,
    //   "이 요소를 중점 계산에 넣을지"는 더 넓게 봐야 두 요소 사이 허공에 끝점이 있을 때 양쪽을 포착한다.
    //   값=EDGE_HIT_PX_FOCUS×8=176px: demo 요소 최근접중심거리 median 64px의 ~2.75배 → 커서가 gap(≤~350px, 양쪽 176px 이내)에
    //   있을 때 두 요소를 포함하되 더 먼 무관 요소는 배제(실측 기반, §13 데이터 우선). CAP=8: 근방 상위 8개만 → 쌍 ≤28로 상한 고정.
    var SNAP_PAIR_FOCUS_R = EDGE_HIT_PX_FOCUS * 8;   // 176px
    var SNAP_NEAR_CAP = 8;
    function edgeScreenPts(el, cache) {
      var pts = edgePtsOf(el);
      if (!pts) return null;
      var m = null;
      if (el.getAttribute("transform")) m = el.getScreenCTM ? el.getScreenCTM() : null;
      else {
        var svg = ownerSvgOf(el);
        for (var c = 0; c < cache.length; c++) { if (cache[c].svg === svg) { m = cache[c].m; break; } }
        if (!m) { m = svg && svg.getScreenCTM ? svg.getScreenCTM() : null; cache.push({ svg: svg, m: m }); }
      }
      if (!m) return null;
      var out = [];
      for (var i = 0; i < pts.length; i++) out.push(toScreenPt(el, pts[i].x, pts[i].y, m));
      return out;
    }
    function pickEdgeAt(x, y, tol) {
      var els = document.querySelectorAll('[data-svgedge="1"]');
      var best = null, bestD = tol || EDGE_HIT_PX, cache = [];
      for (var i = 0; i < els.length; i++) {
        var sp = edgeScreenPts(els[i], cache);
        if (!sp) continue;
        for (var k = 0; k + 1 < sp.length; k++) {
          var d = distToSeg(x, y, sp[k].x, sp[k].y, sp[k + 1].x, sp[k + 1].y);
          if (d < bestD) { bestD = d; best = els[i]; }
        }
      }
      return best;
    }

    // class b/c hit-test. class c: svg 안이면 stamp된 박스 <g>(data-svgbox)·자유 텍스트·화살표를
    // 주소로 잡고, 그 밖(bare 도형·바깥 svg 자체)은 unaddressable → 부모에 토스트만 요청.
    function resolveAt(x, y, fallback) {
      var el = document.elementFromPoint(x, y) || fallback || null;
      if (!el) return null;
      if (isOverlay(el)) return { overlay: true };
      if (inSvg(el)) {
        // hit-test 우선순위: 박스 내부 클릭은 box <g>(svgbox), 자유 <text>는 자기 자신(svgtext),
        // 화살표는 자기 자신(svgedge). 박스 텍스트는 미stamp라 closest가 박스 <g>로 올라간다.
        var unit = el.closest ? el.closest('[data-arch-eid]') : null;
        if (unit) {
          var ueid = unit.getAttribute("data-arch-eid") || "";
          if (unit.getAttribute("data-svgbox") === "1" || ueid.indexOf("svgbox:") === 0) {
            return { el: unit, eid: ueid, kind: "svgbox", svgbox: true, shape: unit.getAttribute("data-svgbox-shape") || "rect" };
          }
          if (unit.getAttribute("data-svgtext") === "1" || ueid.indexOf("svgtext:") === 0) {
            return { el: unit, eid: ueid, kind: "svgtext", svgtext: true };
          }
          if (unit.getAttribute("data-svgedge") === "1" || ueid.indexOf("svgedge:") === 0) {
            return { el: unit, eid: ueid, kind: "svgedge", svgedge: true };
          }
        }
        // 박스·텍스트에 안 걸린 클릭만 기하 근접 판정으로 화살표를 찾는다(우선순위 보존).
        var ge = pickEdgeAt(x, y);
        if (ge) return { el: ge, eid: ge.getAttribute("data-arch-eid"), kind: "svgedge", svgedge: true };
        return { svg: true };
      }
      var obj = el.closest ? el.closest("[data-object]") : null;
      if (!obj) return null;
      if (inSvg(obj)) return { svg: true };
      var eid = obj.getAttribute("data-arch-eid");
      if (!eid) return null;
      return { el: obj, eid: eid, kind: obj.getAttribute("data-object-type") || "element" };
    }

    // 박스 <g>의 직속 <text> 자식(문서 순서) — 소스측 SvgAdapter.directChildren(g,"text")와 동일 의미.
    // OFF 인라인 편집의 줄 인덱스는 이 순서로 매겨지고, 커밋의 setText(line=…)와 정확히 맞물린다.
    function directChildrenText(g) {
      var out = [];
      for (var i = 0; i < g.children.length; i++) {
        if (g.children[i].tagName && g.children[i].tagName.toLowerCase() === "text") out.push(g.children[i]);
      }
      return out;
    }

    // ---- D25b: 줄 단위 텍스트 hit-test (OFF 모드 인라인 편집의 주소화) ----
    // 클릭 대상이 (또는 그 안이) 박스 <g>의 직속 <text>면 **그 줄**(박스 내 줄 인덱스)로,
    // 자유 <text> 단위면 그 자체(svgtext)로, class-b [data-object] div면 obj로 해석한다.
    // 텍스트가 아닌 곳(빈 도형 여백 등)은 null → 부모가 무동작(파괴 금지).
    function resolveTextAt(x, y, fallback) {
      var el = document.elementFromPoint(x, y) || fallback || null;
      if (!el || isOverlay(el)) return null;
      var t = el.closest ? el.closest("text") : null;
      if (t && inSvg(t)) {
        var unit = t.closest ? t.closest('[data-arch-eid]') : null;
        if (unit && (unit.getAttribute("data-svgtext") === "1" || (unit.getAttribute("data-arch-eid") || "").indexOf("svgtext:") === 0)) {
          return { kind: "svgtext", el: unit, textEl: unit, eid: unit.getAttribute("data-arch-eid") };
        }
        if (unit && (unit.getAttribute("data-svgbox") === "1" || (unit.getAttribute("data-arch-eid") || "").indexOf("svgbox:") === 0)) {
          // 클릭된 <text>가 <g>의 직속이 아닐 수 있다(tspan 래핑) → 직속 조상 <text>까지 올린다.
          var dt = t;
          while (dt && dt.parentNode !== unit) dt = dt.parentNode;
          if (!dt || !dt.tagName || dt.tagName.toLowerCase() !== "text") dt = t.parentNode === unit ? t : null;
          if (!dt) return null;
          var texts = directChildrenText(unit);
          var line = texts.indexOf(dt);
          if (line < 0) return null;
          return { kind: "svgbox", el: unit, boxEl: unit, textEl: dt, eid: unit.getAttribute("data-arch-eid"), line: line };
        }
        return null;
      }
      var obj = el.closest ? el.closest("[data-object]") : null;
      if (obj && !inSvg(obj)) {
        var oe = obj.getAttribute("data-arch-eid");
        // D27c(a)+D28(B): svgbox 분기처럼 클릭된 (서브)줄의 평탄화 인덱스를 함께 준다 — 깨끗한 줄 구조가
        //   아니면 line=null → beginObjInline이 largestFontLine으로 폴백(오늘 동작). <br> 서브라인은 좌표로 판정.
        if (oe) return { kind: "obj", el: obj, eid: oe, line: objLineIndexAt(obj, el, x, y) };
      }
      return null;
    }

    // ---- D25c: 노드 편집 focus — 화살표는 비상호작용. 클릭점 아래의 **노드**만 잡는다 ----
    // elementsFromPoint(위→아래)를 훑어 화살표를 건너뛰고 첫 박스/텍스트/obj를 고른다. 화살표가
    // 박스를 가로질러 위에 있어도, 얇은 선을 직접 눌러도, 그 아래 노드가 이긴다(기하 폴백은 아예 안 씀).
    function resolveNodeAt(x, y, fallback) {
      var stack = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
      if (!stack || !stack.length) { if (fallback) stack = [fallback]; else return null; }
      for (var i = 0; i < stack.length; i++) {
        var el = stack[i];
        if (!el || isOverlay(el)) continue;
        if (inSvg(el)) {
          var unit = el.closest ? el.closest('[data-arch-eid]') : null;
          if (!unit) continue;
          var ueid = unit.getAttribute("data-arch-eid") || "";
          if (unit.getAttribute("data-svgedge") === "1" || ueid.indexOf("svgedge:") === 0) continue;  // 화살표 무시
          if (unit.getAttribute("data-svgbox") === "1" || ueid.indexOf("svgbox:") === 0) {
            return { el: unit, eid: ueid, kind: "svgbox", svgbox: true, shape: unit.getAttribute("data-svgbox-shape") || "rect" };
          }
          if (unit.getAttribute("data-svgtext") === "1" || ueid.indexOf("svgtext:") === 0) {
            return { el: unit, eid: ueid, kind: "svgtext", svgtext: true };
          }
          continue;
        }
        var obj = el.closest ? el.closest("[data-object]") : null;
        if (obj && !inSvg(obj) && obj.getAttribute("data-arch-eid")) {
          return { el: obj, eid: obj.getAttribute("data-arch-eid"), kind: obj.getAttribute("data-object-type") || "element" };
        }
      }
      return null;
    }

    // ---- D25c: 화살표 편집 focus — 엣지 우선 + 넓힌 허용반경 ----
    // 넓힌 반경(EDGE_HIT_PX_FOCUS)으로 최근접 화살표를 먼저 찾고, 없을 때만 일반 해석으로 폴백해
    // 박스·텍스트도 여전히 고를 수 있게 한다(도구를 켰다고 다른 편집이 막히면 안 됨).
    function resolveArrowFocusAt(x, y, fallback) {
      var ge = pickEdgeAt(x, y, EDGE_HIT_PX_FOCUS);
      if (ge) return { el: ge, eid: ge.getAttribute("data-arch-eid"), kind: "svgedge", svgedge: true };
      return resolveAt(x, y, fallback);
    }

    // class (a): 렌더러가 찍은 <g data-arch-id/kind/part> 클러스터를 hit-test. SVG 안이어도
    // 선택 대상(class b와 정반대 — class b는 SVG 엣지를 잘랐지만 class a는 SVG가 바로 요소다).
    function resolveArchAt(x, y, fallback) {
      var el = document.elementFromPoint(x, y) || fallback || null;
      if (!el) return null;
      if (isOverlay(el)) return { overlay: true };
      var g = el.closest ? el.closest("[data-arch-id]") : null;
      if (!g) return null;
      return {
        el: g,
        id: g.getAttribute("data-arch-id"),
        kind: g.getAttribute("data-arch-kind") || "element",
        part: g.getAttribute("data-arch-part") || null,
      };
    }

    // 속성 셀렉터 값 이스케이프(파생 id는 :,-> 를 담지만 " 는 없다 — 방어적으로 처리).
    function attrEsc(v) { return String(v).replace(/[\\"]/g, "\\$&"); }

    function place(box, el) {
      var r = el.getBoundingClientRect();
      box.style.display = "block";
      box.style.left = (r.left - 2) + "px";
      box.style.top = (r.top - 2) + "px";
      box.style.width = (r.width + 4) + "px";
      box.style.height = (r.height + 4) + "px";
      return r;
    }

    // 여러 클러스터(예: class a 엣지의 path+label)를 하나의 박스로 감싼다 — 합집합 bbox.
    function placeUnion(box, els) {
      var minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
      for (var i = 0; i < els.length; i++) {
        var r = els[i].getBoundingClientRect();
        if (r.left < minL) minL = r.left;
        if (r.top < minT) minT = r.top;
        if (r.right > maxR) maxR = r.right;
        if (r.bottom > maxB) maxB = r.bottom;
      }
      if (minL === Infinity) { box.style.display = "none"; return; }
      box.style.display = "block";
      box.style.left = (minL - 2) + "px";
      box.style.top = (minT - 2) + "px";
      box.style.width = (maxR - minL + 4) + "px";
      box.style.height = (maxB - minT + 4) + "px";
    }

    // 소스측 largestFontLine과 동일 의미론(대표 텍스트 줄)을 self-contained로 복제.
    function editLargestLine(root) {
      var cands = [];
      (function walk(el) {
        for (var n = el.firstChild; n; n = n.nextSibling) {
          if (n.nodeType === 3 && n.textContent.trim()) { cands.push(el); break; }
        }
        for (var c = 0; c < el.children.length; c++) walk(el.children[c]);
      })(root);
      if (!cands.length) return root;
      function sizeOf(el) {
        var cur = el;
        while (cur) {
          var fs = cur.style && cur.style.fontSize;
          if (fs) { var m = /^([\d.]+)px$/.exec(fs.trim()); return m ? parseFloat(m[1]) : 0; }
          if (cur === root) break;
          cur = cur.parentElement;
        }
        return 0;
      }
      var best = cands[0], bestSize = sizeOf(best);
      for (var i = 1; i < cands.length; i++) { var s = sizeOf(cands[i]); if (s > bestSize) { best = cands[i]; bestSize = s; } }
      return best;
    }

    // D27c(a): obj "줄" 감지 — 소스측 DomAdapter.objLineDivs와 동일 의미(직속 자식마다 직접 텍스트,
    //   중첩 블록 없음). 깨끗한 줄 구조가 아니면 null → 폴백(largestFontLine). self-contained.
    function objLineDivsA(container) {
      if (!container || !container.childNodes) return null;
      var BLOCK = { div: 1, p: 1, ul: 1, ol: 1, li: 1, table: 1, section: 1, header: 1, footer: 1, article: 1, svg: 1 };
      var kids = [];
      for (var n = container.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 1) kids.push(n);
        else if (n.nodeType === 3 && n.textContent.trim()) return null;   // 최상위 혼합 텍스트
      }
      if (!kids.length) return null;
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i], hasText = false;
        for (var c = k.firstChild; c; c = c.nextSibling) { if (c.nodeType === 3 && c.textContent.trim()) { hasText = true; break; } }
        if (!hasText) return null;
        for (var j = 0; j < k.children.length; j++) { if (BLOCK[k.children[j].tagName.toLowerCase()]) return null; }
      }
      return kids;
    }
    // ---- D29: obj 줄 감지를 "직속 자식" → "재귀적 리프"로 일반화 — 소스측 DomAdapter.objLeafLines와 동일 의미 ----
    // 리프 = 직접 텍스트가 있고(hasDirectTextA) 중첩 block 자식이 없는(!hasBlockChildA) 요소(인라인 자식 허용).
    //   block 자식을 가진 요소(flex 헤더)·텍스트 없는 인라인 래퍼는 순수 컨테이너 → 재귀 진입.
    //   텍스트 없는 장식 요소는 리프 조건 미달로 자연 제외. D27c 평평-직속-자식은 재귀 depth-1 특수케이스(무회귀 상위호환).
    //   ★ 소스측(objLeafLines)과 **인덱스 순서가 정확히 일치**해야 한다(클릭 line 인덱스가 setText/setStyle의 축과 정합). self-contained.
    var OBJ_BLOCK = { div: 1, p: 1, ul: 1, ol: 1, li: 1, table: 1, section: 1, header: 1, footer: 1, article: 1, svg: 1 };
    function hasDirectTextA(el) {
      for (var n = el.firstChild; n; n = n.nextSibling) { if (n.nodeType === 3 && n.textContent.trim()) return true; }
      return false;
    }
    function hasBlockChildA(el) {
      for (var i = 0; i < el.children.length; i++) { if (OBJ_BLOCK[el.children[i].tagName.toLowerCase()]) return true; }
      return false;
    }
    function objLeafLinesA(container) {
      if (!container || !container.childNodes) return null;
      for (var n = container.firstChild; n; n = n.nextSibling) { if (n.nodeType === 3 && n.textContent.trim()) return null; }
      var out = [];
      (function walk(el) {
        for (var i = 0; i < el.children.length; i++) {
          var c = el.children[i];
          if (hasDirectTextA(c) && !hasBlockChildA(c)) out.push(c);   // 리프 = 줄
          else walk(c);                                              // 순수 컨테이너/인라인 래퍼 → 재귀
        }
      })(container);
      return out.length ? out : null;
    }
    // ---- D28(B): <br> 서브라인 — 소스측 DomAdapter.objLineTargets와 동일 의미(직속 div를 <br> 세그먼트로 세분) ----
    // 각 (objLineDivsA로 이미 깨끗하다고 판정된) 직속 자식 div를 <br> 기준으로 쪼갠 평탄화 타깃 배열.
    //   <br> 없으면 세그먼트 1개(=div 전체, D27c와 동일). 반환 [{ div, seg, segCount }] 또는 null(폴백). self-contained.
    function brSegmentsA(div) {
      var groups = [[]];
      for (var n = div.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 1 && n.tagName && n.tagName.toLowerCase() === "br") groups.push([]);
        else groups[groups.length - 1].push(n);
      }
      return groups;
    }
    function objLineTargetsA(container) {
      var divs = objLeafLinesA(container);   // D29: 재귀 리프(직속 자식 일반화, 무회귀 상위호환)
      if (!divs) return null;
      var out = [];
      for (var i = 0; i < divs.length; i++) {
        var segCount = Math.max(1, brSegmentsA(divs[i]).length);
        for (var s = 0; s < segCount; s++) out.push({ div: divs[i], seg: s, segCount: segCount });
      }
      return out;
    }
    // 한 div의 <br> 세그먼트별 화면 사각형(어느 시각 줄을 눌렀는지 판정용) — Range.getBoundingClientRect 사용.
    function segByYA(div, y) {
      var groups = brSegmentsA(div);
      if (groups.length <= 1) return 0;
      var best = 0, bestD = Infinity;
      for (var g = 0; g < groups.length; g++) {
        var nodes = groups[g];
        if (!nodes.length) continue;
        var r;
        try { var rng = document.createRange(); rng.setStartBefore(nodes[0]); rng.setEndAfter(nodes[nodes.length - 1]); r = rng.getBoundingClientRect(); }
        catch (e) { continue; }
        if (!r || (!r.height && !r.width)) continue;
        if (y >= r.top && y <= r.bottom) return g;
        var d = Math.min(Math.abs(y - r.top), Math.abs(y - r.bottom));
        if (d < bestD) { bestD = d; best = g; }
      }
      return best;
    }
    // 편집을 위해 그 세그먼트 노드들을 뷰에서만 <span>으로 감싼다(소스엔 안 감 — 커밋은 setObjLineText가 세그먼트만 교체).
    function wrapSegmentForEdit(div, seg) {
      var groups = brSegmentsA(div);
      if (seg < 0 || seg >= groups.length) return null;
      var nodes = groups[seg];
      var span = document.createElement("span");
      span.setAttribute("data-arch-subedit", "1");
      if (nodes.length) {
        div.insertBefore(span, nodes[0]);
        for (var i = 0; i < nodes.length; i++) span.appendChild(nodes[i]);
      } else {
        var count = 0, ref = null;
        for (var m = div.firstChild; m; m = m.nextSibling) { if (m.nodeType === 1 && m.tagName && m.tagName.toLowerCase() === "br") { count++; if (count === seg) { ref = m.nextSibling; break; } } }
        div.insertBefore(span, ref);
      }
      return span;
    }
    function unwrapSegment(span) {
      if (!span || !span.parentNode) return;
      var parent = span.parentNode;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
    }
    // 클릭 대상 el+좌표가 obj container의 어느 (서브)줄인지 → 평탄화 줄 인덱스(깨끗한 구조일 때만), 아니면 null.
    function objLineIndexAt(container, el, x, y) {
      var targets = objLineTargetsA(container);
      if (!targets) return null;
      // D29: 리프가 컨테이너의 직속 자식이 아닐 수 있다(flex 헤더 안 SECURITY/AND, 또는 리프 안 인라인 <b>).
      //   el에서 위로 올라가며 가장 가까운 **타깃 리프**를 찾는다(직속 자식 가정 폐기). D27c 평평 케이스에선
      //   el 자신이 리프라 즉시 일치하므로 결과가 이전과 동일(무회귀).
      var leaf = null;
      for (var node = el; node && node !== container; node = node.parentNode) {
        for (var t = 0; t < targets.length; t++) { if (targets[t].div === node) { leaf = node; break; } }
        if (leaf) break;
      }
      if (!leaf) return null;
      var base = -1, segCount = 0;
      for (var i = 0; i < targets.length; i++) { if (targets[i].div === leaf) { if (base < 0) base = i; segCount++; } }
      if (base < 0) return null;
      if (segCount <= 1) return base;                 // <br> 없음 = 리프 전체가 한 줄
      var seg = segByYA(leaf, y);                      // 여러 세그먼트 → 클릭 Y로 시각 줄 판정
      return base + Math.min(Math.max(0, seg), segCount - 1);
    }

    // ---------------- 편집 크롬 ----------------
    function selectedEl() { return selEid ? document.querySelector('[data-arch-eid="' + selEid + '"]') : null; }

    function showEditChrome() {
      // D30: OFF 테두리 이동 중엔 ON 크롬(이동 오버레이·리사이즈 핸들)을 세우지 않는다 —
      //   OFF는 이동만 허용(리사이즈·fill 등은 ON 필요)이므로 핸들이 뜨면 오해를 준다. 이동 피드백은
      //   onDragMove의 selBox(빨간 외곽선)가 담당한다.
      if (drag && drag.offMove) { hideEditChrome(); return; }
      var el = selectedEl();
      if (!el) { hideEditChrome(); return; }
      if (selSet.length > 1) { hideEditChrome(); return; }   // D22: 다중 선택 중엔 단일 요소 크롬 없음
      // 화살표: 이동 오버레이·코너 핸들 대신 폴리라인 + 정점/중간점 핸들.
      if (selSvg && selSvg.isEdge) {
        moveOverlay.style.display = "none";
        for (var q = 0; q < 4; q++) handles[q].style.display = "none";
        showEdgeChrome();
        return;
      }
      hideEdgeChrome();
      var r = el.getBoundingClientRect();
      moveOverlay.style.display = "block";
      moveOverlay.style.left = r.left + "px"; moveOverlay.style.top = r.top + "px";
      moveOverlay.style.width = r.width + "px"; moveOverlay.style.height = r.height + "px";
      // 리사이즈 핸들: CSS 박스는 항상, SVG 박스는 rect일 때만(게이트·다이아 등 path/polygon은 유보).
      var showHandles = !selSvg || selSvg.shape === "rect";
      var pts = [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]];
      for (var i = 0; i < 4; i++) {
        handles[i].style.display = showHandles ? "block" : "none";
        if (showHandles) {
          handles[i].style.left = (pts[i][0] - 6) + "px";
          handles[i].style.top = (pts[i][1] - 6) + "px";
        }
      }
    }
    function hideEditChrome() {
      moveOverlay.style.display = "none";
      for (var i = 0; i < 4; i++) handles[i].style.display = "none";
      hideEdgeChrome();
    }
    // svgMode: "box"(<g> 박스, resize 가능) | "text"(자유 <text>) | "edge"(화살표) | falsy(class-b CSS 박스)
    // additive(D22): Cmd/Ctrl+클릭 — 크롬(이동·리사이즈 핸들)을 세우지 않고 집합 토글 의도만 보고한다.
    function selectForEdit(el, eid, kind, svgMode, shape, additive) {
      var r = el.getBoundingClientRect();
      if (!additive) {
        selEid = eid;
        if (svgMode === "text") selSvg = { isText: true, svg: ownerSvgOf(el) };
        else if (svgMode === "edge") selSvg = { isEdge: true, svg: ownerSvgOf(el) };
        else if (svgMode === "box" || svgMode === true) selSvg = { shape: shape || "rect", svg: ownerSvgOf(el) };
        else selSvg = null;
        hideMsel();
        // 화살표는 bbox 사각형이 오히려 방해된다(직교 라우팅은 bbox가 거대) → 폴리라인만.
        if (svgMode === "edge") selBox.style.display = "none";
        else place(selBox, el);
        showEditChrome();
      }
      parent.postMessage({
        type: "arch-edit-hit", eid: eid, kind: kind, additive: !!additive,
        svgbox: svgMode === "box" || svgMode === true, svgtext: svgMode === "text",
        svgedge: svgMode === "edge",
        shape: shape || null, rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      }, "*");
    }
    function deselectEdit() {
      selEid = null;
      selSvg = null;
      selSet = [];
      selBox.style.display = "none";
      hideMsel();
      hideEditChrome();
    }

    function px(v, dflt) { var n = parseFloat(v); return isNaN(n) ? dflt : n; }

    // ---- D18: 정점 드래그 / 중간점 드래그(=꼭짓점 추가) / Alt+클릭 삭제 ----
    // Shift 스냅: 드래그 중인 정점을 "이웃 정점과 축 정렬"시킨다(더 가까운 축 하나만).
    //   WHY: 이 슬라이드의 라우팅이 전부 직교라 자유 드래그는 대개 직교를 깨뜨린다. 그렇다고
    //   상시 자동 스냅을 걸면 의도적 사선 배치를 막아 사용자와 싸운다 → Figma/Illustrator 관용구인
    //   "Shift=제약"을 따른다(기본 자유, Shift 누르면 직교).
    function orthoSnap(pts, i, x, y) {
      var cands = [];
      if (i > 0) cands.push(pts[i - 1]);
      if (i + 1 < pts.length) cands.push(pts[i + 1]);
      if (!cands.length) return { x: x, y: y };
      var bx = null, by = null, bdx = Infinity, bdy = Infinity;
      for (var k = 0; k < cands.length; k++) {
        var ddx = Math.abs(cands[k].x - x); if (ddx < bdx) { bdx = ddx; bx = cands[k].x; }
        var ddy = Math.abs(cands[k].y - y); if (ddy < bdy) { bdy = ddy; by = cands[k].y; }
      }
      return bdx <= bdy ? { x: bx, y: y } : { x: x, y: by };
    }

    // ---- D42/D44: 화살표 끝점 스냅 ----
    //   WHY(D42): 끝점을 다른 요소의 bbox 꼭짓점(4모서리) / 두 꼭짓점의 정중앙(변 중점·중심)에 달라붙게 한다.
    //     스냅 반경은 D25c의 화살표 클릭반경 확장값(EDGE_HIT_PX_FOCUS=22px, 실측 기반)을 그대로 재사용 —
    //     상호작용 스케일을 한 값으로 통일한다.
    //   WHY(D44): 여기에 더해 "서로 다른 두 요소의 꼭짓점 사이 정중앙"(두 요소 사이 허공일 수 있음)도 후보로 넣는다.
    //     조합폭발(N²×16) 방지: ① 후보 요소는 커서(끝점) 근방 SNAP_PAIR_FOCUS_R 이내로 한정 → ② 그중 상위
    //     SNAP_NEAR_CAP개만 → ③ 쌍마다 상호 최근접(마주보는) 꼭짓점만 중점화. interElementMidpoints 참조.
    //   COST: bbox 수집·꼭짓점 캐시는 드래그 시작 1회(O(요소수), getBoundingClientRect). 드래그 중 D44 중점은
    //     캐시 좌표 산술만(요소가 안 움직이므로 유효) — 매 mousemove도 가볍다. EXIT: 대상/반경 조정은
    //     collectSnapTargets·SNAP_* 상수에서. 좌표: 후보는 화면(getBoundingClientRect)으로 모으고, 끝점 화면
    //     위치와 비교해 최근접에 붙인 뒤 elemUserDelta와 같은 el.getScreenCTM 기준으로 edge-local user 좌표로
    //     되돌린다(엣지/박스가 다른 svg여도 화면 좌표가 다리 역할).
    function userToScreenEl(el, ux, uy) {
      var ctm = el.getScreenCTM ? el.getScreenCTM() : null, svg = ownerSvgOf(el);
      if (!ctm || !svg) return { x: ux, y: uy };
      var p = svg.createSVGPoint(); p.x = ux; p.y = uy;
      var s = p.matrixTransform(ctm);
      return { x: s.x, y: s.y };
    }
    function screenToUserEl(el, sx, sy) {
      var ctm = el.getScreenCTM ? el.getScreenCTM() : null, svg = ownerSvgOf(el);
      if (!ctm || !svg) return { x: sx, y: sy };
      var p = svg.createSVGPoint(); p.x = sx; p.y = sy;
      var u = p.matrixTransform(ctm.inverse());
      return { x: u.x, y: u.y };
    }
    function collectSnapTargets(exceptEl) {
      var targets = [], boxes = [], els = document.querySelectorAll("[data-arch-eid]");
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el === exceptEl) continue;
        var eid = el.getAttribute("data-arch-eid") || "";
        if (eid.indexOf("svgedge:") === 0 || el.getAttribute("data-svgedge") === "1") continue;   // 다른 화살표는 앵커에서 제외
        var r = el.getBoundingClientRect();
        if (!r || (r.width < 1 && r.height < 1)) continue;
        var L = r.left, T = r.top, R = r.right, B = r.bottom, MX = (L + R) / 2, MY = (T + B) / 2;
        targets.push({ x: L, y: T }, { x: R, y: T }, { x: L, y: B }, { x: R, y: B },      // 4모서리
                     { x: MX, y: T }, { x: MX, y: B }, { x: L, y: MY }, { x: R, y: MY },   // 변 중점(두 꼭짓점의 정중앙)
                     { x: MX, y: MY });                                                    // 중심
        // D44: 요소별 4꼭짓점 캐시 — "서로 다른 두 요소의 꼭짓점 사이 중점"을 드래그 중 커서 근방에서만 산출(아래 interElementMidpoints).
        //   드래그 시작 1회만 getBoundingClientRect(값비싼 레이아웃 접근) — 드래그 중엔 이 캐시 좌표로 산술만 한다(엣지 편집 중 다른 요소는 안 움직임).
        boxes.push({ c: [{ x: L, y: T }, { x: R, y: T }, { x: L, y: B }, { x: R, y: B }] });
      }
      return { targets: targets, boxes: boxes };
    }
    // D44: 커서(끝점) 근방 요소쌍의 "마주보는(상호 최근접) 꼭짓점 중점"을 후보로 반환(캐시된 boxes·화면좌표).
    //   조합폭발(N²×16) 방지 3단: ① 커서 반경 R 밖 요소 제외 → ② 남은 것 중 커서에 가까운 상위 SNAP_NEAR_CAP개만
    //   → ③ 쌍마다 16개 전조합이 아니라 "상호 최근접 꼭짓점"만 중점화(마주보는 2쌍 정도로 수렴). 전부 캐시 산술이라 매 mousemove도 가볍다.
    function interElementMidpoints(boxes, sp, R) {
      var out = [];
      if (!boxes || boxes.length < 2) return out;
      var near = [];
      for (var i = 0; i < boxes.length; i++) {                     // ① 커서 반경 R 이내(요소 최근접 꼭짓점 기준)
        var cs = boxes[i].c, dmin = Infinity;
        for (var k = 0; k < 4; k++) { var d = Math.hypot(sp.x - cs[k].x, sp.y - cs[k].y); if (d < dmin) dmin = d; }
        if (dmin <= R) near.push({ c: cs, d: dmin });
      }
      if (near.length < 2) return out;
      near.sort(function (p, q) { return p.d - q.d; });             // ② 커서에 가까운 순 상위 CAP개만(쌍 수 상한 고정)
      if (near.length > SNAP_NEAR_CAP) near.length = SNAP_NEAR_CAP;
      for (var a = 0; a < near.length; a++) for (var b = a + 1; b < near.length; b++) {
        var A = near[a].c, Bx = near[b].c;
        for (var ci = 0; ci < 4; ci++) {                           // ③ A의 각 꼭짓점 ca에 대해 상호 최근접 B꼭짓점만
          var ca = A[ci], cb = null, cbd = Infinity;
          for (var cj = 0; cj < 4; cj++) { var dd = Math.hypot(ca.x - Bx[cj].x, ca.y - Bx[cj].y); if (dd < cbd) { cbd = dd; cb = Bx[cj]; } }
          var back = null, bd = Infinity;
          for (var ck = 0; ck < 4; ck++) { var dd2 = Math.hypot(cb.x - A[ck].x, cb.y - A[ck].y); if (dd2 < bd) { bd = dd2; back = A[ck]; } }
          if (back === ca) out.push({ x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 });   // 상호 최근접(마주보는 꼭짓점 쌍)만
        }
      }
      return out;
    }
    function showSnapMarker(sx, sy) {
      var sz = 12;
      snapMarker.style.left = (sx - sz / 2) + "px"; snapMarker.style.top = (sy - sz / 2) + "px";
      snapMarker.style.width = sz + "px"; snapMarker.style.height = sz + "px"; snapMarker.style.display = "block";
    }
    function hideSnapMarker() { snapMarker.style.display = "none"; }
    // 끝점(user nx,ny)을 스냅 후보에 붙인다 — 붙으면 마커 표시 + 스냅좌표(user) 반환, 아니면 원좌표 + 마커 숨김.
    //   후보 = D42 요소별 9앵커(targets, 드래그 1회 수집) + D44 커서 근방 요소쌍의 마주보는 꼭짓점 중점(매 move 산출, 캐시 산술).
    function applyEndpointSnap(el, nx, ny, targets, boxes) {
      var sp = userToScreenEl(el, nx, ny), best = null, bestD = EDGE_HIT_PX_FOCUS;
      if (targets) for (var i = 0; i < targets.length; i++) {          // D42: 요소 자신의 9앵커
        var t = targets[i], d = Math.sqrt((sp.x - t.x) * (sp.x - t.x) + (sp.y - t.y) * (sp.y - t.y));
        if (d <= bestD) { bestD = d; best = t; }
      }
      var mids = interElementMidpoints(boxes, sp, SNAP_PAIR_FOCUS_R);  // D44: 두 요소 사이 꼭짓점 중점(커서 근방만)
      for (var j = 0; j < mids.length; j++) {
        var m = mids[j], dm = Math.sqrt((sp.x - m.x) * (sp.x - m.x) + (sp.y - m.y) * (sp.y - m.y));
        if (dm <= bestD) { bestD = dm; best = m; }
      }
      if (!best) { hideSnapMarker(); return { x: nx, y: ny }; }
      showSnapMarker(best.x, best.y);
      return screenToUserEl(el, best.x, best.y);
    }

    function startEdgeDrag(e, index, isMid) {
      var el = selectedEl();
      if (!el || !selSvg || !selSvg.isEdge) return;
      var pts = edgePtsOf(el);
      if (!pts) return;
      // Alt+클릭(정점 핸들) = 그 꼭짓점 삭제. 2점짜리는 선이 사라지므로 부모가 거절한다.
      if (!isMid && e.altKey) {
        e.preventDefault(); e.stopPropagation();
        parent.postMessage({ type: "arch-svgedge-delvertex", eid: selEid, index: index }, "*");
        return;
      }
      // 중간점은 "움직이기 시작할 때" 삽입한다(pending) — 그냥 클릭만 하면 아무 일도 없게.
      var snap = collectSnapTargets(el);   // D42/D44: 드래그 1회만 DOM/bbox 수집(엣지 편집 중 다른 요소는 불변)
      drag = {
        kind: "edge", edge: true, index: index, pending: !!isMid, added: false, afterIndex: -1,
        sx: e.clientX, sy: e.clientY, moved: false, pts0: pts.slice(),
        snapTargets: snap.targets,   // D42: 끝점 스냅 후보(다른 요소 bbox 꼭짓점/변중점/중심, 화면좌표)
        snapBoxes: snap.boxes,       // D44: 요소별 4꼭짓점 캐시(커서 근방 요소쌍 중점 산출용)
      };
      e.preventDefault();
      e.stopPropagation();
    }

    function onDragMoveEdge(e) {
      var el = selectedEl();
      if (!el) return;
      var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (drag.pending) {
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;   // 클릭 오차는 삽입하지 않음
        var p0 = drag.pts0[drag.index], p1 = drag.pts0[drag.index + 1];
        var mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        var seeded = drag.pts0.slice();
        seeded.splice(drag.index + 1, 0, mid);
        if (el.tagName.toLowerCase() === "line") el = promoteLineA(el, seeded);
        else writePtsA(el, seeded);
        drag.pending = false; drag.added = true; drag.afterIndex = drag.index;
        drag.index = drag.index + 1; drag.pts0 = seeded;
      }
      var du = elemUserDelta(el, dx, dy);
      var next = drag.pts0.slice();
      var nx = drag.pts0[drag.index].x + du.x, ny = drag.pts0[drag.index].y + du.y;
      // D42/D44: 끝점(index 0 또는 마지막)만 요소 스냅. Shift(직교 스냅)와는 배타 — Shift 중엔 요소 스냅 안 함.
      var isEndpoint = (drag.index === 0 || drag.index === drag.pts0.length - 1);
      if (e.shiftKey) { var s = orthoSnap(next, drag.index, nx, ny); nx = s.x; ny = s.y; hideSnapMarker(); }
      else if (isEndpoint) { var sn = applyEndpointSnap(el, nx, ny, drag.snapTargets, drag.snapBoxes); nx = sn.x; ny = sn.y; }
      else hideSnapMarker();
      next[drag.index] = { x: nx, y: ny };
      writePtsA(el, next);
      drag.moved = true;
      showEdgeChrome();
      e.preventDefault();
    }

    function startDrag(e, kind, corner) {
      var el = selectedEl();
      if (!el) return;
      var r = el.getBoundingClientRect();
      if (selSvg && selSvg.isText) {
        var tp = textPos(el);
        drag = {
          kind: "move", corner: null, sx: e.clientX, sy: e.clientY, moved: false, svgtext: true,
          usesTransform: tp.mode === "transform", x0: tp.x, y0: tp.y,
        };
      } else if (selSvg) {
        var tr = parseTranslate(el);
        var rect = svgRectOf(el);
        drag = {
          kind: kind, corner: corner, sx: e.clientX, sy: e.clientY, moved: false, svg: true,
          tx0: tr.x, ty0: tr.y,
          rw0: rect ? parseFloat(rect.getAttribute("width")) : 0,
          rh0: rect ? parseFloat(rect.getAttribute("height")) : 0,
        };
      } else {
        drag = {
          kind: kind, corner: corner, sx: e.clientX, sy: e.clientY, moved: false,
          l0: px(el.style.left, r.left), t0: px(el.style.top, r.top),
          w0: px(el.style.width, r.width), h0: px(el.style.height, r.height),
        };
      }
      e.preventDefault();
      e.stopPropagation();
    }

    // class c: SVG 박스 라이브 이동/리사이즈. 화면 델타를 svgUserDelta로 user 단위로 바꿔
    // <g transform>(이동) / <rect width height>+translate(리사이즈)를 직접 갱신한다.
    function onDragMoveSvg(el, dx, dy) {
      var svg = (selSvg && selSvg.svg) || ownerSvgOf(el);
      var du = svgUserDelta(svg, dx, dy);
      if (drag.kind === "move") {
        el.setAttribute("transform", "translate(" + fmtNum(drag.tx0 + du.x) + " " + fmtNum(drag.ty0 + du.y) + ")");
        return;
      }
      var rect = svgRectOf(el);
      if (!rect) return;
      var MIN = 16, c = drag.corner;
      var tx = drag.tx0, ty = drag.ty0, w = drag.rw0, h = drag.rh0;
      if (c === "se") { w = Math.max(MIN, drag.rw0 + du.x); h = Math.max(MIN, drag.rh0 + du.y); }
      else if (c === "ne") { w = Math.max(MIN, drag.rw0 + du.x); h = Math.max(MIN, drag.rh0 - du.y); ty = drag.ty0 + (drag.rh0 - h); }
      else if (c === "sw") { w = Math.max(MIN, drag.rw0 - du.x); tx = drag.tx0 + (drag.rw0 - w); h = Math.max(MIN, drag.rh0 + du.y); }
      else if (c === "nw") { w = Math.max(MIN, drag.rw0 - du.x); tx = drag.tx0 + (drag.rw0 - w); h = Math.max(MIN, drag.rh0 - du.y); ty = drag.ty0 + (drag.rh0 - h); }
      rect.setAttribute("width", fmtNum(w));
      rect.setAttribute("height", fmtNum(h));
      el.setAttribute("transform", "translate(" + fmtNum(tx) + " " + fmtNum(ty) + ")");
      recenterSvgTexts(el, w);
    }

    // 자유 <text> 라이브 이동 — 화면px 델타를 svgUserDelta로 user 단위로 바꿔 x/y(또는 transform) 갱신.
    function onDragMoveText(el, dx, dy) {
      var svg = (selSvg && selSvg.svg) || ownerSvgOf(el);
      var du = svgUserDelta(svg, dx, dy);
      if (drag.usesTransform) {
        el.setAttribute("transform", "translate(" + fmtNum(drag.x0 + du.x) + " " + fmtNum(drag.y0 + du.y) + ")");
      } else {
        el.setAttribute("x", fmtNum(drag.x0 + du.x));
        el.setAttribute("y", fmtNum(drag.y0 + du.y));
      }
    }

    function onDragMove(e) {
      if (!drag) return;
      if (drag.group) { onDragMoveGroup(e); return; }   // D41: 그룹 이동은 주 선택(selEid) 유무와 무관하게 동작
      var el = selectedEl();
      if (!el) return;
      if (drag.edge) { onDragMoveEdge(e); return; }
      var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
      if (drag.svgtext) { onDragMoveText(el, dx, dy); place(selBox, el); showEditChrome(); e.preventDefault(); return; }
      if (drag.svg) { onDragMoveSvg(el, dx, dy); place(selBox, el); showEditChrome(); e.preventDefault(); return; }
      if (drag.kind === "move") {
        el.style.left = (drag.l0 + dx) + "px";
        el.style.top = (drag.t0 + dy) + "px";
      } else {
        var c = drag.corner, MIN = 20;
        var l = drag.l0, t = drag.t0, w = drag.w0, h = drag.h0;
        if (c === "se") { w = Math.max(MIN, drag.w0 + dx); h = Math.max(MIN, drag.h0 + dy); }
        else if (c === "ne") { w = Math.max(MIN, drag.w0 + dx); h = Math.max(MIN, drag.h0 - dy); t = drag.t0 + (drag.h0 - h); }
        else if (c === "sw") { w = Math.max(MIN, drag.w0 - dx); l = drag.l0 + (drag.w0 - w); h = Math.max(MIN, drag.h0 + dy); }
        else if (c === "nw") { w = Math.max(MIN, drag.w0 - dx); l = drag.l0 + (drag.w0 - w); h = Math.max(MIN, drag.h0 - dy); t = drag.t0 + (drag.h0 - h); }
        el.style.left = l + "px"; el.style.top = t + "px";
        el.style.width = w + "px"; el.style.height = h + "px";
      }
      place(selBox, el);
      showEditChrome();
      e.preventDefault();
    }

    // ---- D43: 표 세로축소 시 클립 대신 폰트/패딩 자동축소 ----
    //   WHY: 표 div를 표의 자연(intrinsic) 높이보다 작게 리사이즈하면, 클립(overflow:hidden) 대신 셀
    //     font-size를 줄여 내용이 박스 안에 들어맞게 한다. 셀 패딩은 em(0.25em/0.5em, dom-adapter 표 템플릿)
    //     이라 div의 font-size 한 값만 바꿔도 글자+패딩이 함께 비례 축소된다(셀마다 개별 op 불필요).
    //   COST: 리사이즈 종료(onDragEnd) 1회만 실측 루프(≤6회) — 매 mousemove가 아니라 mouseup 후 1회라
    //     드래그 중 부담 0. intrinsic 측정은 <table>을 잠깐 height:auto로 두고 boundingRect를 읽어 되돌린다.
    //   EXIT: 폰트 하한(TABLE_FONT_MIN_PX)까지 줄여도 안 맞으면 그 이상은 바깥 div overflow:hidden 안전망이 클립.
    var TABLE_FONT_BASE_PX = 16;   // 표 기본 셀 폰트(실측: 상속 기본 16px) = 확대 시 복귀 상한
    var TABLE_FONT_MIN_PX = 12;    // 폰트 하한 — dom-adapter.js OBJ_LINE_MIN_PX(=12px, 가독 하한) 재사용.
                                   //   기본 16px의 75%선 = 표 셀이 읽히는 최소. 이 밑은 안전망 클립으로 넘긴다.
    function tableIntrinsicPx(tableEl) {
      var prev = tableEl.style.height;
      tableEl.style.height = "auto";                   // 폰트/패딩 그대로일 때 표가 필요로 하는 실제 높이
      var h = tableEl.getBoundingClientRect().height;
      tableEl.style.height = prev || "100%";           // 원복(고정 100% 유지 — 렌더 상태 불변)
      return h;
    }
    // el(표 obj div)의 셀 폰트를 박스에 맞게 축소/복귀시키고 최종 font-size 문자열 반환(표 아니면 null).
    function fitTableFont(el) {
      if (!el || el.getAttribute("data-object-type") !== "table") return null;
      var table = el.querySelector("table");
      if (!table) return null;
      var avail = el.clientHeight;                     // div 안쪽 높이(표 div엔 border/padding 없음 → 지정 height와 동일)
      if (!(avail > 0)) return null;
      var F = TABLE_FONT_BASE_PX;
      el.style.fontSize = F + "px";                    // 늘 기본에서 출발 → 박스를 다시 키우면 이전 축소분이 복귀
      var I = tableIntrinsicPx(table);
      // 기본 폰트로 이미 맞으면 그대로. 안 맞으면 (avail/I) 비율 추정 + 실측 재확인으로 수렴 축소.
      for (var iter = 0; iter < 6 && I > avail && F > TABLE_FONT_MIN_PX; iter++) {
        var guess = Math.floor(F * avail / I);         // 높이∝폰트 가정한 1차 추정(테두리 등 고정분은 무시 → 살짝 보수적)
        if (guess >= F) guess = F - 1;                 // 반올림 정체 방지(매 회 최소 1px 전진)
        if (guess < TABLE_FONT_MIN_PX) guess = TABLE_FONT_MIN_PX;
        F = guess;
        el.style.fontSize = F + "px";
        I = tableIntrinsicPx(table);                   // 실측 재확인 — 고정분 비선형성을 매 회 자기교정
      }
      return F + "px";
    }

    function onDragEnd(e) {
      if (!drag) return;
      var d = drag; drag = null;
      if (d.group) { finishGroupDrag(d, e); return; }   // D41: 그룹 이동 커밋(단일 undo)
      var el = selectedEl();
      if (d.edge) {
        hideSnapMarker();   // D42: 드래그 종료 — 스냅 마커 정리
        // 미이동(단순 클릭)은 뷰도 소스도 그대로 — pending 삽입은 아직 일어나지 않았다.
        if (!el || !d.moved) { showEdgeChrome(); return; }
        var epts = edgePtsOf(el);
        if (!epts || d.index >= epts.length) { showEdgeChrome(); return; }
        var v = epts[d.index];
        if (d.added) parent.postMessage({ type: "arch-svgedge-addvertex", eid: selEid, afterIndex: d.afterIndex, x: v.x, y: v.y }, "*");
        else parent.postMessage({ type: "arch-svgedge-vertex", eid: selEid, index: d.index, x: v.x, y: v.y }, "*");
        return;
      }
      if (!el || !d.moved) return;
      if (d.svgtext) {
        var tp2 = textPos(el);
        parent.postMessage({ type: "arch-svgtext-move", eid: selEid, x: tp2.x, y: tp2.y }, "*");
        return;
      }
      if (d.svg) {
        var tr = parseTranslate(el);
        if (d.kind === "move") {
          parent.postMessage({ type: "arch-svg-move", eid: selEid, x: tr.x, y: tr.y }, "*");
        } else {
          var rect = svgRectOf(el);
          parent.postMessage({
            type: "arch-svg-resize", eid: selEid,
            width: rect ? parseFloat(rect.getAttribute("width")) : 0,
            height: rect ? parseFloat(rect.getAttribute("height")) : 0,
            x: tr.x, y: tr.y,
          }, "*");
        }
        return;
      }
      var props;
      if (d.kind === "move") {
        props = { left: el.style.left, top: el.style.top };
      } else if (d.corner === "se") {
        props = { width: el.style.width, height: el.style.height };
      } else if (d.corner === "ne") {
        props = { width: el.style.width, height: el.style.height, top: el.style.top };
      } else if (d.corner === "sw") {
        props = { width: el.style.width, height: el.style.height, left: el.style.left };
      } else {
        props = { width: el.style.width, height: el.style.height, left: el.style.left, top: el.style.top };
      }
      // D43: 리사이즈(이동 아님)로 크기가 바뀌었으면 표는 셀 폰트를 박스에 맞게 축소/복귀시켜 함께 커밋.
      //   fitTableFont는 표가 아니면 null(폰트 미첨부 → 종전 동작 그대로). mouseup 후 1회만 실행.
      if (d.kind !== "move") { var tf = fitTableFont(el); if (tf != null) props.fontSize = tf; }
      parent.postMessage({ type: "arch-geom", eid: selEid, props: props }, "*");
    }

    // ---------------- D41: 다중 선택 그룹 이동 ----------------
    //   WHY: 2개 이상 선택된 상태에서 그 중 하나를 드래그하면 선택된 전부가 상대위치를 유지한 채 함께 이동한다.
    //     단일 선택 경로(moveOverlay/OFF 테두리)는 전혀 건드리지 않는다 — 이건 selSet.length>1일 때만 타는 새 분기다.
    //   좌표계: obj는 style.left/top(레이아웃 px, 화면 델타 1:1), svgbox/svgtext는 svgUserDelta로 화면 델타를 user
    //     단위로 바꿔 각자의 좌표체계에 동일 델타를 적용한다. svgedge(화살표)는 이번 범위 밖(폴리라인 평행이동은
    //     별건) → skip해 자리 보존. COST: 엣지는 함께 안 움직임. EXIT: 필요 시 엣지 전 정점 평행이동을 추가.
    function selectedUnitAt(node) {   // node의 조상 중 선택 집합에 든 첫 유닛의 eid(없으면 null)
      while (node && node !== document) {
        if (node.getAttribute) {
          var eid = node.getAttribute("data-arch-eid");
          if (eid && selSet.indexOf(eid) >= 0) return eid;
        }
        node = node.parentNode;
      }
      return null;
    }
    function startGroupDrag(e) {
      var members = [];
      for (var i = 0; i < selSet.length; i++) {
        var eid = selSet[i];
        var el = document.querySelector('[data-arch-eid="' + attrEsc(eid) + '"]');
        if (!el) continue;
        var m = { eid: eid, el: el };
        if (el.getAttribute("data-svgtext") === "1") {
          var tp = textPos(el);
          m.type = "svgtext"; m.usesTransform = (tp.mode === "transform"); m.x0 = tp.x; m.y0 = tp.y; m.svg = ownerSvgOf(el);
        } else if (el.getAttribute("data-svgbox") === "1") {
          var tr = parseTranslate(el);
          m.type = "svgbox"; m.tx0 = tr.x; m.ty0 = tr.y; m.svg = ownerSvgOf(el);
        } else if (el.getAttribute("data-svgedge") === "1") {
          m.type = "svgedge"; m.skip = true;   // 엣지는 이번 그룹이동 범위 밖 — 자리 보존
        } else {
          var r = el.getBoundingClientRect();
          m.type = "obj"; m.l0 = px(el.style.left, r.left); m.t0 = px(el.style.top, r.top);
        }
        members.push(m);
      }
      drag = { group: members, kind: "move", sx: e.clientX, sy: e.clientY, moved: false };
      groupMoved = false;
      e.preventDefault();
      e.stopPropagation();
    }
    function onDragMoveGroup(e) {
      var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) { drag.moved = true; groupMoved = true; }
      for (var i = 0; i < drag.group.length; i++) {
        var m = drag.group[i];
        if (m.skip) continue;
        if (m.type === "obj") {
          m.el.style.left = (m.l0 + dx) + "px";
          m.el.style.top = (m.t0 + dy) + "px";
        } else if (m.type === "svgbox") {
          var du = svgUserDelta(m.svg, dx, dy);
          m.el.setAttribute("transform", "translate(" + fmtNum(m.tx0 + du.x) + " " + fmtNum(m.ty0 + du.y) + ")");
        } else if (m.type === "svgtext") {
          var du2 = svgUserDelta(m.svg, dx, dy);
          if (m.usesTransform) m.el.setAttribute("transform", "translate(" + fmtNum(m.x0 + du2.x) + " " + fmtNum(m.y0 + du2.y) + ")");
          else { m.el.setAttribute("x", fmtNum(m.x0 + du2.x)); m.el.setAttribute("y", fmtNum(m.y0 + du2.y)); }
        }
      }
      drawSelSet(selSet, selPrimary);   // 오버레이(주 selBox + msel 박스)를 이동한 위치로 다시 그림
      e.preventDefault();
    }
    function finishGroupDrag(d, e) {
      if (!d.moved) return;   // 미이동(단순 클릭)은 무커밋 — 선택 유지
      var moves = [];
      for (var i = 0; i < d.group.length; i++) {
        var m = d.group[i];
        if (m.skip) continue;
        if (m.type === "obj") {
          moves.push({ eid: m.eid, kind: "obj", left: m.el.style.left, top: m.el.style.top });
        } else if (m.type === "svgbox") {
          var tr = parseTranslate(m.el);
          moves.push({ eid: m.eid, kind: "svgbox", x: tr.x, y: tr.y });
        } else if (m.type === "svgtext") {
          var tp = textPos(m.el);
          moves.push({ eid: m.eid, kind: "svgtext", x: tp.x, y: tp.y });
        }
      }
      if (moves.length) parent.postMessage({ type: "arch-group-move", moves: moves }, "*");
    }

    // ---------------- 텍스트 편집(contenteditable) ----------------
    function beginTextEdit() {
      var el = selectedEl();
      if (!el) return;
      // SVG 박스/자유 텍스트는 contenteditable 대신 부모 패널의 텍스트 필드로 편집한다.
      if (selSvg && selSvg.isText) { parent.postMessage({ type: "arch-svgtext-textedit", eid: selEid }, "*"); return; }
      if (selSvg) { parent.postMessage({ type: "arch-svg-textedit", eid: selEid }, "*"); return; }
      var line = editLargestLine(el);
      editing = { line: line, orig: line.textContent, eid: selEid };
      hideEditChrome();
      moveOverlay.style.display = "none";
      line.setAttribute("contenteditable", "true");
      line.style.outline = "2px solid #6E56CF";
      line.focus();
      try {
        var range = document.createRange();
        range.selectNodeContents(line);
        var sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
      } catch (err) {}
    }
    function endTextEdit(commit) {
      if (!editing) return;
      var line = editing.line, orig = editing.orig, brWrap = editing.brWrap;
      var text = line.textContent;
      line.removeAttribute("contenteditable");
      line.style.outline = "";
      var e = editing; editing = null;
      if (commit) {
        // D26: obj 커밋 — changed로 텍스트 변경 여부 전달(부모가 pending 서식과 한 배치로 커밋).
        //   D28(B): 줄 인덱스는 부모의 inlineSession.line(평탄화)에서 읽으므로 여기선 텍스트만 보낸다.
        parent.postMessage({ type: "arch-text", eid: e.eid || selEid, text: text, changed: (text !== orig) }, "*");
        if (brWrap) unwrapSegment(brWrap);   // 뷰 정리(소스는 setObjLineText가 세그먼트만 교체; 변경 시 재렌더가 뷰 대체)
      } else {
        line.textContent = orig;
        if (brWrap) unwrapSegment(brWrap);
        parent.postMessage({ type: "arch-inline-cancel", eid: e.eid || selEid }, "*");   // D26: pending 폐기
        if (selEid) showEditChrome();
      }
    }

    // ---- D25b: OFF 인라인 텍스트 편집 (오버레이 <input>) ----
    // SVG <text>의 contenteditable은 브라우저마다 편집 호스트로 동작하지 않는 경우가 있어(글리프에
    // 캐럿이 안 잡힘) **정확히 그 줄 위에 겹친 오버레이 <input>**을 쓴다 — 폰트 크기·굵기·색·정렬을
    // 맞춰 "글리프 자리에서 바로 타이핑"하는 느낌을 준다. 커밋(Enter/blur)은 부모의 setText(+line)로
    // 넘어가 scope/undo/bleed가 불변이다. 입력은 data-arch-overlay라 뷰에만 살고 저장물엔 안 남는다.
    // class-b obj(HTML div)만은 contenteditable이 정상 동작하므로 기존 경로를 단일클릭으로 승격한다.
    // D28(A): 식별자(eid/kind/line)로 인라인 편집 타깃을 복원 — 재렌더 후 부모가 arch-open-inline으로 세션을 다시 열 때.
    function hitFromIdentity(eid, kind, line) {
      var unit = document.querySelector('[data-arch-eid="' + eid + '"]');
      if (!unit) return null;
      if (kind === "obj") return { kind: "obj", el: unit, eid: eid, line: (line != null ? line : null) };
      if (kind === "svgtext") return { kind: "svgtext", el: unit, textEl: unit, eid: eid };
      if (kind === "svgbox") {
        var texts = directChildrenText(unit);
        var tEl = (line != null && line >= 0 && line < texts.length) ? texts[line] : texts[0];
        if (!tEl) return null;
        return { kind: "svgbox", el: unit, boxEl: unit, textEl: tEl, eid: eid, line: (line != null ? line : 0) };
      }
      return null;
    }
    function beginInlineEdit(hit) {
      cancelInlineEdit();
      if (editing) endTextEdit(false);
      if (hit.kind === "obj") { beginObjInline(hit.el, hit.eid, hit.line != null ? hit.line : null); return; }
      var tEl = hit.textEl;
      if (!tEl || !tEl.getBoundingClientRect) return;
      var r = tEl.getBoundingClientRect();
      var cs = window.getComputedStyle(tEl);
      var anchor = tEl.getAttribute("text-anchor") || cs.textAnchor || "start";
      var inp = document.createElement("input");
      inp.type = "text";
      inp.setAttribute("data-arch-overlay", "inline");
      inp.value = (tEl.textContent || "").replace(/\s+/g, " ");
      var s = inp.style;
      s.position = "fixed";
      s.left = (r.left - 3) + "px";
      s.top = (r.top - 2) + "px";
      s.height = Math.max(16, r.height + 4) + "px";
      s.width = Math.max(28, r.width + 16) + "px";
      s.zIndex = "2147483400";
      s.margin = "0"; s.padding = "0 3px"; s.boxSizing = "border-box";
      s.fontSize = cs.fontSize;
      s.fontFamily = cs.fontFamily;
      s.fontWeight = cs.fontWeight;
      s.fontStyle = cs.fontStyle;
      s.lineHeight = Math.max(16, r.height + 4) + "px";
      s.color = (cs.fill && cs.fill !== "none") ? cs.fill : (tEl.getAttribute("fill") || "#111827");
      s.textAlign = anchor === "middle" ? "center" : anchor === "end" ? "right" : "left";
      s.background = "#FFFFFF";
      s.border = "2px solid #6E56CF";
      s.borderRadius = "3px";
      s.outline = "none";
      s.boxShadow = "0 2px 10px rgba(0,0,0,0.35)";
      document.body.appendChild(inp);
      inlineEdit = { input: inp, eid: hit.eid, kind: hit.kind, line: (hit.line != null ? hit.line : null), orig: (tEl.textContent || "").replace(/\s+/g, " "), basePx: (parseFloat(cs.fontSize) || 14) };
      inp.focus();
      inp.select();
      inp.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { ev.preventDefault(); commitInlineEdit(); }
        else if (ev.key === "Escape") { ev.preventDefault(); cancelInlineEdit(); }
        ev.stopPropagation();          // 부모의 undo/redo/escape 단축키와 싸우지 않게
      });
      // D26: blur 커밋은 상황을 가린다. 포커스가 iframe 안에 남아 있으면(다른 줄/요소 클릭) 종전대로
      //   즉시 커밋. 밖으로 나갔으면(부모 툴바일 수 있음) 부모에게 물어본다 — 서식 버튼이면 hold(유지),
      //   진짜 바깥 클릭이면 docommit. 이래야 "타이핑 중 Bold 클릭"이 세션을 안 끊는다.
      inp.addEventListener("blur", function () {
        if (document.hasFocus && !document.hasFocus()) parent.postMessage({ type: "arch-inline-blur" }, "*");
        else commitInlineEdit();
      });
      inp.addEventListener("mousedown", function (ev) { ev.stopPropagation(); });
      inp.addEventListener("click", function (ev) { ev.stopPropagation(); });
      // D26: 부모(텍스트 서식 게이트)에 세션 시작을 미러. 도형 선택과 무관하게 이 신호가 게이트를 연다.
      parent.postMessage({ type: "arch-inline-start", eid: inlineEdit.eid, kind: inlineEdit.kind, line: inlineEdit.line, text: inlineEdit.orig }, "*");
    }
    function commitInlineEdit() {
      if (!inlineEdit) return;
      var ie = inlineEdit; inlineEdit = null;
      var text = ie.input.value;
      if (ie.input.parentNode) ie.input.parentNode.removeChild(ie.input);
      // D26: 항상 커밋 신호를 보낸다(텍스트 무변경이라도 pending 서식이 있을 수 있음). changed로 구분.
      parent.postMessage({ type: "arch-inline-commit", eid: ie.eid, kind: ie.kind, line: ie.line, text: text, changed: (text !== ie.orig) }, "*");
    }
    function cancelInlineEdit() {
      if (!inlineEdit) return;
      var ie = inlineEdit; inlineEdit = null;
      if (ie.input && ie.input.parentNode) ie.input.parentNode.removeChild(ie.input);
      parent.postMessage({ type: "arch-inline-cancel", eid: ie.eid }, "*");   // D26: pending 서식까지 폐기
    }
    function beginObjInline(el, eid, lineIdx) {
      // D27c(a)+D28(B): 평탄화 줄 인덱스가 유효하고 구조가 깨끗하면 그 (서브)줄을, 아니면 largestFontLine(폴백).
      //   <br> 세그먼트(같은 div에 여러 서브라인)면 그 세그먼트만 뷰에서 <span>으로 감싸 편집 범위를 그 반쪽으로 한정.
      var targets = objLineTargetsA(el);
      var clean = targets && lineIdx != null && lineIdx >= 0 && lineIdx < targets.length;
      var line, objLine = clean ? lineIdx : null, brWrap = null;
      if (clean) {
        var tg = targets[lineIdx];
        if (tg.segCount > 1) {
          var span = wrapSegmentForEdit(tg.div, tg.seg);   // <br> 서브라인 — 그 세그먼트만 편집
          line = span || tg.div;
          brWrap = span || null;
        } else {
          line = tg.div;                                    // <br> 없는 줄 = div 전체(오늘)
        }
      } else {
        line = editLargestLine(el);
      }
      editing = { line: line, orig: line.textContent, eid: eid, brWrap: brWrap };
      line.setAttribute("contenteditable", "true");
      line.style.outline = "2px solid #6E56CF";
      line.focus();
      // D26: obj(class-b) 인라인도 부모에 세션 시작 미러(텍스트 서식 게이트). D27c/D28: 평탄화 줄 인덱스를 실어보낸다.
      parent.postMessage({ type: "arch-inline-start", eid: eid, kind: "obj", line: objLine, text: line.textContent }, "*");
      try {
        var range = document.createRange();
        range.selectNodeContents(line);
        var sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
      } catch (err) {}
    }

    // ---------------- 박스 수집(검증·레이아웃 컨텍스트) ----------------
    function collectBoxes() {
      var out = [], els = document.querySelectorAll("[data-arch-eid]");
      for (var i = 0; i < els.length; i++) {
        var el = els[i], r = el.getBoundingClientRect();
        var st = el.getAttribute("style") || "";
        var hasH = /(^|;)\s*height\s*:/.test(st);
        out.push({
          eid: el.getAttribute("data-arch-eid"), type: el.getAttribute("data-object-type") || "element",
          x: r.left, y: r.top, w: r.width, h: r.height,
          sw: el.scrollWidth, sh: el.scrollHeight, cw: el.clientWidth, ch: el.clientHeight, hasH: hasH,
          // D18: 화살표는 겹침 검증에서 제외 대상(박스를 가로지르는 게 정상) — 부모가 필터링한다.
          edge: el.getAttribute("data-svgedge") === "1",
        });
      }
      return out;
    }

    // ---------------- D30: OFF 모드 테두리 클릭 = 유닛 전체 이동 ----------------
    // OFF(텍스트편집)에서 유닛 바운딩박스 "테두리대"(경계 ±M px 링) 안 클릭은 그 유닛 전체를 이동하고,
    // 그 안쪽(경계에서 M 이상 떨어진 내부)은 오늘 그대로 인라인 텍스트편집을 연다. 이동은 새 op을 만들지
    // 않고 ON모드 블록편집과 똑같은 기계(startDrag → onDragMove{Svg,Text,CSS} → onDragEnd postMessage)를
    // 그대로 재사용한다 — 유일한 신규는 "OFF에서 테두리라는 트리거"뿐. undo·bleed-diff·scope 보증은 그
    // commit 경로(부모의 commitSvgOps/commitOps)가 그대로 준다(별도 검증 불필요, 재사용의 자연 귀결).
    var BORDER_M = 8;            // 테두리대 반폭(화면 px). D18 화살표 클릭 허용치(EDGE_HIT_PX=8)를 기준점으로 채택.
    var BORDER_MAX_FRAC = 0.33;  // 작은 유닛 보호: 축별 유효 마진 = min(M, 치수×0.33) → 내부(텍스트편집)가 항상 각 축 ≥~34% 남는다.

    // 이동 가능한 모든 유닛 요소(화살표 제외): svgbox/svgtext(<g>·<text>) + class-b obj([data-object] 비-SVG).
    function movableUnits() {
      var out = [], i;
      var a = document.querySelectorAll('[data-svgbox="1"],[data-svgtext="1"]');
      for (i = 0; i < a.length; i++) out.push(a[i]);
      var b = document.querySelectorAll("[data-object]");
      for (i = 0; i < b.length; i++) { if (!inSvg(b[i]) && b[i].getAttribute("data-arch-eid")) out.push(b[i]); }
      return out;
    }
    function unitKindOf(el) {
      var eid = el.getAttribute("data-arch-eid") || "";
      if (el.getAttribute("data-svgbox") === "1" || eid.indexOf("svgbox:") === 0) return "svgbox";
      if (el.getAttribute("data-svgtext") === "1" || eid.indexOf("svgtext:") === 0) return "svgtext";
      return "obj";
    }
    // 유닛의 "테두리 기준" 화면 사각형. svgbox는 실제 렌더된 <rect> stroke가 있으면 그 rect의 화면 사각형
    //   (시각적으로 정직·정확), 없으면 기하 bbox(<g>)로 폴백. obj는 getBoundingClientRect가 CSS border까지
    //   포함하므로 그대로가 곧 테두리 기준. svgtext는 글리프 bbox.
    function ringBoxOf(el, kind) {
      if (kind === "svgbox") {
        var rect = svgRectOf(el);
        if (rect) { var s = rect.getAttribute("stroke"); if (s && s !== "none") return rect.getBoundingClientRect(); }
      }
      return el.getBoundingClientRect();
    }
    // 점 (x,y)의 링 판정: "interior"(경계에서 M 이상 안쪽) | "border"(경계 ±M 링) | "none"(무관).
    //   결정론적 경계 규약: 내부 판정은 포함식(>=/<=)이라 "경계에서 정확히 M 안쪽"은 interior
    //   (= 문서화된 "경계에서 M 이상 떨어진 내부"). 그 M 미만이면 border. 유닛 밖은 M 이내면 border.
    function classifyRing(r, x, y) {
      var mx = Math.min(BORDER_M, r.width * BORDER_MAX_FRAC);
      var my = Math.min(BORDER_M, r.height * BORDER_MAX_FRAC);
      if (x >= r.left + mx && x <= r.right - mx && y >= r.top + my && y <= r.bottom - my) return "interior";
      if (x >= r.left - BORDER_M && x <= r.right + BORDER_M && y >= r.top - BORDER_M && y <= r.bottom + BORDER_M) return "border";
      return "none";
    }
    // 이동 트리거 타깃 {eid,kind,el,selSvg,box}. selSvg는 selectForEdit과 동일 구조(startDrag 분기용).
    function moveTargetOf(el, kind) {
      var sv;
      if (kind === "svgtext") sv = { isText: true, svg: ownerSvgOf(el) };
      else if (kind === "svgbox") sv = { shape: el.getAttribute("data-svgbox-shape") || "rect", svg: ownerSvgOf(el) };
      else sv = null;   // class-b obj(CSS 박스)
      return { eid: el.getAttribute("data-arch-eid"), kind: kind, el: el, selSvg: sv, box: ringBoxOf(el, kind) };
    }
    // 점 (x,y)가 어떤 유닛의 테두리대에 있으면 그 이동 타깃을, 내부/무관이면 null.
    //   (1) 점 아래 유닛(resolveAt: elementFromPoint 기반, z-order·리프 정밀 존중)이 있으면 그 유닛만 판정
    //       — border면 타깃, interior/none이면 null(내부 = 인라인 텍스트편집이 처리, D25b/D29 정밀 불변).
    //   (2) 점 아래 유닛이 없으면(빈틈/맨 svg) 유닛들의 "바깥 링"을 스캔해 M 이내 최근접 테두리를 잡는다.
    // 클릭 지점이 "실제 편집 텍스트" 위인가 — svg <text> 글리프, 또는 obj의 텍스트 **리프**(자기 텍스트를
    //   직접 가진 요소)만 참. ★ resolveTextAt을 쓰면 안 되는 이유: obj 분기가 greedy라(전체 슬라이드가
    //   [data-object]="obj:0"의 후손이므로) 어떤 점이든 컨테이너를 돌려줘 여백·테두리까지 '텍스트'로 쳐버린다.
    //   여기선 elementFromPoint가 실제 텍스트 리프를 반환하는지로 정밀 판정 → 여백/테두리에서만 이동 arm.
    function isOnEditableText(x, y, fallback) {
      var el = document.elementFromPoint(x, y) || fallback || null;
      if (!el || isOverlay(el)) return false;
      var t = el.closest ? el.closest("text") : null;
      if (t && inSvg(t)) return true;                          // svg <text> 글리프 위
      var obj = el.closest ? el.closest("[data-object]") : null;
      if (obj && !inSvg(obj)) return hasDirectTextA(el);       // obj: 자기 텍스트 리프 위만(컨테이너/여백 제외)
      return false;
    }
    function borderUnitAt(x, y, fallback) {
      // ★ 실제 텍스트(리프/글리프) 위면 항상 텍스트편집이 이긴다 — 이동은 텍스트 없는 테두리 여백/바깥에서만.
      //   경계 근처(≤M)라도 편집 대상 텍스트 위면 인라인편집 그대로(D27c/D28/D29 per-leaf 정밀 불변).
      if (isOnEditableText(x, y, fallback)) return null;
      var hit = resolveAt(x, y, fallback);
      if (hit && hit.el && hit.eid && !hit.svgedge) {
        var kind = hit.svgbox ? "svgbox" : hit.svgtext ? "svgtext" : "obj";
        var r = ringBoxOf(hit.el, kind);
        return classifyRing(r, x, y) === "border" ? moveTargetOf(hit.el, kind) : null;
      }
      var units = movableUnits(), best = null, bestD = BORDER_M + 0.001;
      for (var i = 0; i < units.length; i++) {
        var el = units[i], k = unitKindOf(el), rr = ringBoxOf(el, k);
        var outside = x < rr.left || x > rr.right || y < rr.top || y > rr.bottom;
        if (!outside) continue;   // 내부는 (1)에서 처리됐어야 함
        var ddx = x < rr.left ? rr.left - x : (x > rr.right ? x - rr.right : 0);
        var ddy = y < rr.top ? rr.top - y : (y > rr.bottom ? y - rr.bottom : 0);
        var d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d <= BORDER_M && d < bestD) { bestD = d; best = moveTargetOf(el, k); }
      }
      return best;
    }
    // OFF 이동 커서: 테두리 위 = move, 그 외 = OFF 기본(text)/draw(crosshair)/기타(""). 값 변화 시에만 기록.
    function setMoveCursor(on) {
      var want = on ? "move" : (mode === "draw" ? "crosshair" : (mode === "edit" && !elementEditOn) ? "text" : "");
      if (document.body.style.cursor !== want) document.body.style.cursor = want;
    }
    function placeRectBox(box, r) {
      box.style.display = "block";
      box.style.left = r.left + "px"; box.style.top = r.top + "px";
      box.style.width = r.width + "px"; box.style.height = r.height + "px";
    }

    // ---------------- 이벤트 ----------------
    document.addEventListener("mousemove", function (e) {
      // D25b: 인라인/contenteditable 편집 중엔 hover 크롬을 멈춘다(편집기와 안 싸우게).
      if (inlineEdit || editing) { hoverBox.style.display = "none"; moveHoverBox.style.display = "none"; hideEdgeHover(); return; }
      if (provenance === "archify") {
        moveHoverBox.style.display = "none";
        // stage 5: 선택·편집·그리기 모드에서 요소 hover 아웃라인(검증/레이아웃/다듬기는 hover 없음)
        if (mode !== "select" && mode !== "edit" && mode !== "draw") { hoverBox.style.display = "none"; return; }
        var ha = resolveArchAt(e.clientX, e.clientY, e.target);
        if (ha && ha.el) place(hoverBox, ha.el); else hoverBox.style.display = "none";
        return;
      }
      // 드래그 중엔 cursor·moveHover 그대로 둔다(OFF 이동이면 onDragMove의 selBox가 대신 표시).
      if (drag) { onDragMove(e); return; }
      if (mode !== "select" && mode !== "edit") { hoverBox.style.display = "none"; moveHoverBox.style.display = "none"; hideEdgeHover(); setMoveCursor(false); return; }
      // D30: OFF 테두리대 hover = 이동 큐(보라 점선 + move 커서). 내부/텍스트 hover는 아래 기존(빨강) 경로.
      if (mode === "edit" && !elementEditOn) {
        var bt = borderUnitAt(e.clientX, e.clientY, e.target);
        if (bt) { hoverBox.style.display = "none"; hideEdgeHover(); placeRectBox(moveHoverBox, bt.box); setMoveCursor(true); return; }
        moveHoverBox.style.display = "none"; setMoveCursor(false);
      } else {
        moveHoverBox.style.display = "none";
      }
      var hit = resolveAt(e.clientX, e.clientY, e.target);
      // 화살표 hover는 bbox 점선이 아니라 폴리라인으로(직교 라우팅은 bbox가 화면만큼 커진다).
      if (hit && hit.svgedge && hit.eid !== selEid) { hoverBox.style.display = "none"; drawEdgeHover(hit.el); return; }
      hideEdgeHover();
      if (hit && hit.el && hit.eid !== selEid) place(hoverBox, hit.el);
      else hoverBox.style.display = "none";
    }, true);

    // D18 · 기능 A: 화살표 더블클릭 = 방향 뒤집기(편집 모드). 패널의 "방향 뒤집기" 버튼과 같은 op.
    // 오버레이(정점 핸들 등) 위 더블클릭은 제외 — 핸들 조작과 충돌하지 않게.
    document.addEventListener("dblclick", function (e) {
      if (mode !== "edit" || editing) return;
      var ov = (e.target && e.target.getAttribute) ? e.target.getAttribute("data-arch-overlay") : null;
      // 정점/중간점 핸들은 "선택된 그 화살표" 위에만 뜬다 → 그 위 더블클릭도 방향 뒤집기로 친다.
      // (핸들이 선 위를 덮고 있어 이걸 막으면 선 한가운데 더블클릭이 먹통이 된다.)
      if (ov === "vhandle" || ov === "midhandle") {
        if (selSvg && selSvg.isEdge && selEid) { e.preventDefault(); parent.postMessage({ type: "arch-svgedge-flip", eid: selEid }, "*"); }
        return;
      }
      if (ov != null) return;                 // 그 외 오버레이(이동·코너 핸들)는 박스 동작에 양보
      var hd = resolveAt(e.clientX, e.clientY, e.target);
      if (hd && hd.svgedge) {
        e.preventDefault();
        parent.postMessage({ type: "arch-svgedge-flip", eid: hd.eid }, "*");
      }
    }, true);

    document.addEventListener("mouseup", function (e) {
      if (!drag) return;
      var wasOff = drag.offMove;
      onDragEnd(e);   // 이동이면 여기서 이미 arch-*-move postMessage로 커밋(ON/OFF 동일 경로)
      // D30: OFF 테두리 이동 정리 — 임시 selEid/selSvg·크롬을 내려 OFF의 "지속 선택 없음"을 유지한다.
      //   (이동 없이 단순 테두리 클릭이었어도 동일 정리 — onDragEnd는 미이동이면 무커밋.)
      if (wasOff) { selEid = null; selSvg = null; selBox.style.display = "none"; hideEditChrome(); setMoveCursor(false); }
    }, true);

    // D30: OFF(텍스트편집)에서 유닛 "테두리대" mousedown = 그 유닛 전체 이동 개시. ON모드 블록편집과
    //   똑같은 move 기계(startDrag)를 재사용하고, 뒤따르는 click이 인라인편집을 열지 않도록 offBorderArmed
    //   로 표시한다. 내부(경계에서 M 이상)·유닛 밖(M 초과)은 arm하지 않음 → click 핸들러가 오늘처럼
    //   인라인 텍스트편집을 처리(D25b/D29 정밀 불변). 다중선택(D22)은 ON 개념 → OFF 이동은 단일 대상만.
    document.addEventListener("mousedown", function (e) {
      offBorderArmed = false;   // 매 상호작용 시작 시 리셋(직전 드래그가 click 없이 끝난 잔상 제거)
      if (mode !== "edit" || elementEditOn || inlineEdit || editing) return;
      if (provenance === "archify" || isOverlay(e.target)) return;
      var bt = borderUnitAt(e.clientX, e.clientY, e.target);
      if (!bt) return;   // 내부/무관 → click 핸들러가 인라인편집 처리
      offBorderArmed = true;
      selEid = bt.eid; selSvg = bt.selSvg;
      startDrag(e, "move", null);          // 기존 move 기계 재사용 — selSvg 분기로 svgbox/svgtext/obj 자동
      if (drag) drag.offMove = true;       // onDragMove(ON 크롬 억제)·mouseup(정리)에서 OFF 이동임을 인지
      moveHoverBox.style.display = "none"; // 이동 시작 — hover 큐 대신 selBox가 뜬다
    }, true);

    // D41: ON(요소 편집)에서 2개 이상 선택된 상태에서 "선택된 요소" 위 mousedown = 그룹 이동 개시.
    //   단일 선택은 기존 moveOverlay 경로가 담당하므로 여기선 selSet.length>1일 때만 관여한다(무회귀).
    //   선택되지 않은 요소 위 mousedown은 무시 → 뒤따르는 click이 평소대로 그 요소를 새로 선택한다.
    document.addEventListener("mousedown", function (e) {
      if (mode !== "edit" || !elementEditOn || inlineEdit || editing) return;
      if (provenance === "archify" || isOverlay(e.target)) return;
      if (selSet.length < 2) return;                 // 단일/무선택은 기존 경로
      if (!selectedUnitAt(e.target)) return;         // 선택된 유닛 위에서 시작한 드래그만 그룹 이동
      startGroupDrag(e);
    }, true);

    // 편집 드래그 시작(핸들/이동 오버레이)
    moveOverlay.addEventListener("mousedown", function (e) { if (mode === "edit") startDrag(e, "move", null); });
    // D25a: 요소 편집 ON에서 더블클릭 텍스트 편집은 비활성(텍스트 편집은 OFF의 단일클릭으로 일원화).
    //   moveOverlay는 ON일 때만 뜨므로 !elementEditOn 가드로 실질적으로 항상 꺼진다(방어적).
    moveOverlay.addEventListener("dblclick", function (e) { if (mode === "edit" && !elementEditOn) { e.preventDefault(); beginTextEdit(); } });
    for (var hi = 0; hi < 4; hi++) {
      (function (handle) {
        handle.addEventListener("mousedown", function (e) { if (mode === "edit") startDrag(e, "resize", handle.getAttribute("data-corner")); });
      })(handles[hi]);
    }

    document.addEventListener("click", function (e) {
      // 다이어그램 위 클릭을 부모에 항상 알린다 — 툴바 드롭다운의 "바깥 클릭 닫기"용.
      //   WHY: 뷰가 sandboxed iframe이라 여기서 소비된 클릭은 부모 document에 절대 도달하지
      //        않는다(D17b와 같은 현상). 부모에만 바깥 클릭 핸들러를 걸면 화면에서 제일 넓은
      //        "바깥"인 다이어그램을 눌러도 메뉴가 안 닫힌다 — 실측으로 확인된 갭.
      //   COST: 클릭마다 메시지 1건 추가(부모는 메뉴가 열려 있을 때만 반응).
      parent.postMessage({ type: "arch-viewclick" }, "*");
      if (groupMoved) { groupMoved = false; return; }   // D41: 그룹 이동 직후의 click은 선택 집합을 무너뜨리지 않게 소비
      // D28(A): obj contenteditable 세션이 열린 채 **다른** 유효 텍스트 타깃을 클릭하면, 한 클릭 안에서
      //   현재 줄 커밋 + 새 타깃 즉시 오픈(2클릭 버그 수정). 같은 줄(편집 중 span/div) 안 클릭은 편집 유지.
      //   커밋이 재렌더를 유발(텍스트 변경)하면 새 타깃은 부모가 arch-ready 후 arch-open-inline으로 다시 연다.
      //   (svg 오버레이 세션은 blur가 이미 커밋해 inlineEdit=null이라 아래 일반 경로가 새 타깃을 연다 — 같은 공유 인프라.)
      if (editing) {
        if (e.target && editing.line.contains && editing.line.contains(e.target)) return;   // 현재 줄 내부 클릭 — 편집 유지
        endTextEdit(true);   // 현재 줄 커밋(+ <br> span 언랩); DOM은 이후 비동기 재렌더 전까지 깨끗
        if (mode === "edit" && !elementEditOn && !isOverlay(e.target)) {
          var swHit = resolveTextAt(e.clientX, e.clientY, e.target);
          if (swHit) beginInlineEdit(swHit);   // 새 타깃을 같은 클릭에서 연다
        }
        return;
      }
      if (isOverlay(e.target)) return; // 편집 크롬 클릭 — 선택 유지

      if (provenance === "archify") {
        // class a는 선택 모드만 지원한다(부모가 나머지 5모드를 잠근다).
        var ga = resolveArchAt(e.clientX, e.clientY, e.target);
        if (ga && ga.el) {
          var ra = place(selBox, ga.el);
          parent.postMessage({ type: "arch-hit", id: ga.id, kind: ga.kind, part: ga.part, arch: true, rect: { x: ra.left, y: ra.top, w: ra.width, h: ra.height } }, "*");
        } else { selBox.style.display = "none"; parent.postMessage({ type: "arch-miss" }, "*"); }
        return;
      }

      // D22: Cmd/Ctrl+클릭 = 그 요소를 선택 집합에 토글. 부모가 집합의 소유자라 여기서는
      // "추가 의도"만 실어 보내고, 그림은 부모가 돌려주는 arch-select-set으로만 갱신한다.
      // (뷰가 스스로 집합을 추측하면 부모 상태와 어긋나는 순간이 반드시 생긴다.)
      var additive = !!(e.metaKey || e.ctrlKey);

      if (mode === "select") {
        var hit = resolveAt(e.clientX, e.clientY, e.target);
        if (hit && hit.svg) { parent.postMessage({ type: "arch-svg-hit" }, "*"); return; }
        if (hit && hit.el) {
          var r;
          if (additive) {
            r = hit.el.getBoundingClientRect();      // 그리기는 부모의 arch-select-set이 담당
          } else if (hit.svgedge) {
            selBox.style.display = "none"; hideMsel(); drawEdgeSel(hit.el); r = hit.el.getBoundingClientRect();
          } else {
            hideEdgeSel(); hideMsel(); r = place(selBox, hit.el);
          }
          parent.postMessage({ type: "arch-hit", eid: hit.eid, kind: hit.kind, additive: additive, svgbox: !!hit.svgbox, svgtext: !!hit.svgtext, svgedge: !!hit.svgedge, shape: hit.shape || null, rect: { x: r.left, y: r.top, w: r.width, h: r.height } }, "*");
        } else { selBox.style.display = "none"; hideEdgeSel(); hideMsel(); parent.postMessage({ type: "arch-miss" }, "*"); }
        return;
      }
      if (mode === "edit") {
        // D25a/b: 요소 편집 OFF = 텍스트 직접 편집. 클릭한 텍스트 줄에 즉시 인라인 편집을 연다.
        //   블록 조작(선택·드래그·리사이즈·패널)은 아무것도 arm하지 않는다. 다중선택은 블록 개념이라
        //   OFF에선 additive(Cmd/Ctrl)를 무시하고 항상 단일 대상 인라인 텍스트 편집만 한다.
        if (!elementEditOn) {
          // D30: 직전 mousedown이 테두리 이동을 arm했으면 이 click은 거기서 왔다 — 인라인편집을 열지 않는다.
          //   (이동했든(드래그) 안 했든(단순 테두리 클릭) 동일. 다음 mousedown이 offBorderArmed를 리셋한다.)
          if (offBorderArmed) { offBorderArmed = false; return; }
          var tHit = resolveTextAt(e.clientX, e.clientY, e.target);
          if (tHit) beginInlineEdit(tHit);   // 테두리대 밖 내부 = 오늘 그대로(텍스트 아닌 곳은 무동작·파괴 금지)
          return;
        }
        // D25c: focus로 hit-test를 좁힌다. all=오늘 그대로, node=화살표 무시, arrow=엣지 우선(넓힌 반경).
        var hitE;
        if (editFocus === "node") hitE = resolveNodeAt(e.clientX, e.clientY, e.target);
        else if (editFocus === "arrow") hitE = resolveArrowFocusAt(e.clientX, e.clientY, e.target);
        else hitE = resolveAt(e.clientX, e.clientY, e.target);
        if (hitE && hitE.svgbox) { selectForEdit(hitE.el, hitE.eid, "svgbox", "box", hitE.shape, additive); return; }
        if (hitE && hitE.svgtext) { selectForEdit(hitE.el, hitE.eid, "svgtext", "text", null, additive); return; }
        if (hitE && hitE.svgedge) { selectForEdit(hitE.el, hitE.eid, "svgedge", "edge", null, additive); return; }
        if (hitE && hitE.svg) { parent.postMessage({ type: "arch-svg-hit" }, "*"); return; }
        if (hitE && hitE.el) selectForEdit(hitE.el, hitE.eid, hitE.kind, null, null, additive);
        else { deselectEdit(); hideMsel(); parent.postMessage({ type: "arch-miss" }, "*"); }
        return;
      }
      if (mode === "draw") {
        parent.postMessage({ type: "arch-draw-at", x: e.clientX, y: e.clientY, kind: drawKind }, "*");
        return;
      }
      // audit/layout/polish: 클릭 하이라이트(정보용)
      var hitH = resolveAt(e.clientX, e.clientY, e.target);
      if (hitH && hitH.el) place(selBox, hitH.el);
      else selBox.style.display = "none";
    }, false);

    document.addEventListener("keydown", function (e) {
      // D17b: Cmd/Ctrl+Z를 iframe 안에서도 받아 부모로 전달.
      //   WHY: 요소를 클릭하면 포커스가 iframe으로 옮겨가(activeElement=diagram-frame)
      //        부모 document의 keydown이 아예 발화하지 않는다(실측: parentSawKeydown=[]).
      //        즉 "클릭 → Cmd+Z"라는 가장 흔한 사용 경로에서 단축키가 죽는다. 부모에만
      //        리스너를 거는 구현으로는 원리적으로 해결 불가 → 양쪽에 걸고 postMessage로 합류.
      //   COST: 리스너가 두 곳(부모/iframe)이라 로직이 이원화 — 양보 규칙을 양쪽에 동일 적용해야 함.
      //   EXIT: 되돌리려면 이 블록과 부모의 "arch-undo" 분기를 함께 제거.
      // D21: 다시 실행(⇧⌘Z)도 같은 이유로 여기 걸어야 한다 — 되돌린 직후 포커스는 여전히 iframe
      // 안이라 부모 리스너만으로는 절대 발화하지 않는다(undo와 정확히 같은 D17b 경로).
      var zKey = (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "z" || e.key === "Z");
      if (zKey) {
        var t = e.target;
        var inField = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
        if (!inField && !editing && !inlineEdit) {   // 인라인 텍스트 편집 중이면 브라우저 기본 undo에 양보
          e.preventDefault();
          parent.postMessage({ type: e.shiftKey ? "arch-redo" : "arch-undo" }, "*");
          return;
        }
      }
      // D27a/b: Delete/Backspace=선택 요소 삭제, Ctrl/Cmd+C/V=복사/붙여넣기. iframe이 이 키들을
      //   삼키므로(D17b와 같은 현상) 여기서 받아 부모로 전달 — 부모가 모드·선택·busy·클립보드를 보고
      //   실제 수행한다(드래그·리사이즈와 같은 직접조작). 양보 규칙은 undo와 동일: 입력 필드/
      //   contenteditable/인라인편집 중이면 브라우저 기본 동작(글자 삭제·복붙)에 양보한다. 블록 편집
      //   (edit+ON)에서만 개입 — 다른 모드에선 preventDefault하지 않는다.
      var kt = e.target;
      var kInField = kt && (kt.tagName === "INPUT" || kt.tagName === "TEXTAREA" || kt.isContentEditable);
      if (mode === "edit" && elementEditOn && !kInField && !editing && !inlineEdit) {
        var hasSel = !!(selEid || (selSet && selSet.length));   // 뭔가 선택돼 있을 때만 삭제/복사 개입(네이티브 복사 안 막게)
        var cv = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
        if ((e.key === "Delete" || e.key === "Backspace") && hasSel) { e.preventDefault(); parent.postMessage({ type: "arch-delete" }, "*"); return; }
        if (cv && (e.key === "c" || e.key === "C") && hasSel) { e.preventDefault(); parent.postMessage({ type: "arch-copy" }, "*"); return; }
        if (cv && (e.key === "v" || e.key === "V")) { e.preventDefault(); parent.postMessage({ type: "arch-paste" }, "*"); return; }
      }
      // Escape로 선택 해제 — 이것도 iframe이 삼키던 키다(다중 선택은 해제 경로가 더 중요해졌다).
      // 인라인 편집 중 Escape는 입력 자신의 핸들러(cancelInlineEdit)가 처리하므로 여기선 양보.
      if (e.key === "Escape" && !editing && !inlineEdit) { parent.postMessage({ type: "arch-escape" }, "*"); return; }
      if (!editing) return;
      if (e.key === "Enter") { e.preventDefault(); endTextEdit(true); }
      else if (e.key === "Escape") { e.preventDefault(); endTextEdit(false); }
    });

    window.addEventListener("message", function (e) {
      if (e.source !== parent) return;
      var d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "arch-mode") {
        if (d.provenance) provenance = d.provenance;
        if (editing) endTextEdit(false);
        // D25a/b: 요소 편집이 OFF로 바뀌거나 편집 모드를 벗어나면 진행 중 인라인 편집을 취소(무커밋).
        var wasOn = elementEditOn;
        if (d.mode !== "edit" || d.elementEditOn === false) cancelInlineEdit();
        if (mode === "edit" && d.mode !== "edit") deselectEdit();
        mode = d.mode || "select";
        if (d.drawKind) drawKind = d.drawKind;
        if (d.elementEditOn != null) elementEditOn = !!d.elementEditOn;
        if (d.editFocus) editFocus = d.editFocus;
        // OFF로 전환되면 블록 편집 크롬(이동·리사이즈·정점 핸들)을 전부 내린다.
        if (mode === "edit" && !elementEditOn && wasOn) { deselectEdit(); hideEditChrome(); }
        hoverBox.style.display = "none";
        // OFF(텍스트 편집)에서는 텍스트 커서로 "여기서 타이핑한다"를 알린다.
        document.body.style.cursor = mode === "draw" ? "crosshair" : (mode === "edit" && !elementEditOn) ? "text" : "";
        if (mode !== "edit") hideEditChrome();
      } else if (d.type === "arch-inline-preview") {
        // D26: 부모가 서식을 적용 — 살아있는 오버레이 <input>(또는 obj 편집줄)에 같은 CSS를 즉시 입혀
        //   "타이핑하며 눈으로 서식이 바뀌는" 프리뷰를 준다. 실제 소스 반영은 Enter 커밋 때.
        var pt = inlineEdit ? inlineEdit.input : (editing ? editing.line : null);
        if (pt && d.style) { for (var pk in d.style) { try { pt.style[pk] = d.style[pk]; } catch (er) {} } }
        // SVG user-unit 크기는 직접 px가 안 맞으므로 배율을 오버레이 기준 px에 곱한다.
        if (pt && inlineEdit && d.fontScale != null) { try { pt.style.fontSize = (inlineEdit.basePx * d.fontScale) + "px"; } catch (er) {} }
        if (inlineEdit && inlineEdit.input && inlineEdit.input.focus) { try { inlineEdit.input.focus(); } catch (er) {} }   // 서식 후 타이핑 재개(svg 오버레이만)
      } else if (d.type === "arch-inline-hold") {
        // D26: 부모가 "포커스가 서식 툴바로 갔다 — blur 커밋하지 말라". 버튼이면 오버레이로 포커스 복귀.
        if (inlineEdit && d.refocus && inlineEdit.input && inlineEdit.input.focus) { try { inlineEdit.input.focus(); } catch (er) {} }
      } else if (d.type === "arch-inline-docommit") {
        // D26: 부모가 "진짜 바깥 클릭이다 — 커밋하라"(blur 위임의 회신).
        if (inlineEdit) commitInlineEdit();
      } else if (d.type === "arch-open-inline") {
        // D28(A): 줄→줄 전환 커밋이 재렌더를 유발한 뒤, 부모가 새 뷰에서 인라인 세션을 다시 연다(식별자로 복원).
        if (mode === "edit" && !elementEditOn) {
          var oh = hitFromIdentity(d.eid, d.kind, (d.line != null ? d.line : null));
          if (oh) beginInlineEdit(oh);
        }
      } else if (d.type === "arch-clear") {
        if (editing) endTextEdit(false);
        selBox.style.display = "none";
        hoverBox.style.display = "none";
        hideEdgeChrome();
        hideMsel();
        selSet = [];
        deselectEdit();
      } else if (d.type === "arch-select-set") {
        // D22: 부모가 선택 집합을 통째로 내려준다(추가/토글/재렌더 후 복원이 전부 이 경로).
        drawSelSet(d.eids || [], d.primary || null);
      } else if (d.type === "arch-select") {
        var el = d.id != null
          ? document.querySelector('[data-arch-id="' + attrEsc(d.id) + '"]')
          : document.querySelector('[data-arch-eid="' + d.eid + '"]');
        if (el) { place(selBox, el); if (el.scrollIntoView) el.scrollIntoView({ block: "nearest", inline: "nearest" }); }
      } else if (d.type === "arch-edit-select") {
        // D30: OFF(텍스트편집)에는 지속 블록 선택 개념이 없다. 테두리 이동 커밋 후 부모가 reselectEid로
        //   이 메시지를 보내지만(ON/공유 commit 경로), OFF에서 selectForEdit을 타면 ON 크롬(핸들)이 떠
        //   버린다 → OFF에선 무시. (D30 이전엔 OFF에서 이 메시지가 발생할 일이 없었으므로 무회귀.)
        if (mode === "edit" && !elementEditOn) return;
        var ee = document.querySelector('[data-arch-eid="' + d.eid + '"]');
        if (ee) {
          var eeBox = ee.getAttribute("data-svgbox") === "1" || (d.eid || "").indexOf("svgbox:") === 0;
          var eeTxt = ee.getAttribute("data-svgtext") === "1" || (d.eid || "").indexOf("svgtext:") === 0;
          var eeEdge = ee.getAttribute("data-svgedge") === "1" || (d.eid || "").indexOf("svgedge:") === 0;
          if (eeEdge) selectForEdit(ee, d.eid, "svgedge", "edge", null);
          else if (eeTxt) selectForEdit(ee, d.eid, "svgtext", "text", null);
          else if (eeBox) selectForEdit(ee, d.eid, "svgbox", "box", ee.getAttribute("data-svgbox-shape") || "rect");
          else selectForEdit(ee, d.eid, ee.getAttribute("data-object-type") || "element");
        }
      } else if (d.type === "arch-flash") {
        var targets;
        if (d.id != null) targets = document.querySelectorAll('[data-arch-id="' + attrEsc(d.id) + '"]');
        else { var one = document.querySelector('[data-arch-eid="' + d.eid + '"]'); targets = one ? [one] : []; }
        if (targets && targets.length) {
          placeUnion(flashBox, targets);
          flashBox.style.opacity = "1";
          setTimeout(function () { flashBox.style.opacity = "0"; }, 1400);
          setTimeout(function () { flashBox.style.display = "none"; flashBox.style.opacity = "1"; }, 2000);
        }
      } else if (d.type === "arch-collect-boxes") {
        parent.postMessage({ type: "arch-boxes", reqId: d.reqId, boxes: collectBoxes() }, "*");
      }
    });

    parent.postMessage({ type: "arch-ready" }, "*");
  }

  function source() {
    return "(" + agentMain.toString() + ")();";
  }

  return { source };
})();
