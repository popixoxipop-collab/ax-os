// DomObjectAdapter — 설계문서 §3.3 class (b): hand-authored 절대배치 슬라이드용 어댑터.
// 부모(editor.js)가 들고 있는 파싱된 Document가 유일한 authoritative source이고,
// 그 문서를 읽고/변형하는 코드는 전부 이 파일에 모여 있다.
//
// scope 3중 보증(설계 D3)이 모두 여기 있다:
//   1) buildToolSchema  — 모든 op의 eid를 {"const": 선택 eid}로 스키마 pin (생성 단계 봉쇄)
//   2) sanitizeOps      — 코드 레벨 scope-gate(ScopeViolation) + 스타일/속성/값 sanitize
//   3) bleedDiff        — 적용 전/후 직렬화 비교로 "선택 요소 밖은 바이트 동일"을 사후 실증
const DomAdapter = (() => {
  const STYLE_WHITELIST = [
    "top", "left", "width", "height",          // 위치·크기
    "color", "background",                     // 색
    "fontSize", "fontWeight",                  // 폰트
    // D27c: class-b(obj) 서식 등가화 — svgbox 수준의 텍스트 서식을 CSS 등가물로 매핑.
    //   family→font-family · italic→font-style · decor→text-decoration · align→text-align ·
    //   gap→line-height · track→letter-spacing (전부 직접 CSS 존재, 새 속성 발명 없음).
    "fontFamily", "fontStyle", "textDecoration", "textAlign", "lineHeight", "letterSpacing",
    "border", "borderRadius",                  // 테두리
    "zIndex",
  ];
  // 값 차단: 외부 리소스 로드(url()), CSS 인젝션 류. 텍스트는 textContent로만 들어가서 원천 안전.
  const BAD_STYLE_VALUE = /url\s*\(|expression|javascript:|@import|[<>]/i;
  const BAD_ATTR_VALUE = /javascript:|https?:|on\w+\s*=|[<>]/i;

  function parse(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }

  // 로드 시 ephemeral 주소 부여: 문서 순서대로 obj:<i> (§3.3). 저장물에도 유지(Q6 기본값).
  function assignEids(doc) {
    const els = doc.querySelectorAll('[data-object="true"]');
    els.forEach((el, i) => el.setAttribute("data-arch-eid", "obj:" + i));
    return els.length;
  }

  function load(html) {
    const doc = parse(html);
    const count = assignEids(doc);
    return { doc, count };
  }

  function getByEid(doc, eid) {
    // eid 형식은 어댑터가 만든 obj:<int>뿐 — 셀렉터 인젝션 여지 없음(따옴표 attr 값)
    return doc.querySelector('[data-arch-eid="' + eid + '"]');
  }

  // D34b: obj(class-b)의 명시적 CSS z-index(인라인) 정수값. 없거나 auto면 0(stacking 기본 근사).
  //   fixture 전수: obj는 인라인 style에 z-index를 명시(1~11+)하므로 style.zIndex 직독으로 충분하다
  //   (레이아웃 없는 DOMParser 문서라 getComputedStyle 불가 — 인라인이라 문제 없음).
  function objZIndex(doc, eid) {
    const el = getByEid(doc, eid);
    if (!el) return 0;
    const z = parseInt((el.style && el.style.zIndex) || "", 10);
    return Number.isFinite(z) ? z : 0;
  }

  function textDigest(el, n) {
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n) + "…" : t;
  }

  function inlineBox(el) {
    const s = el.style || {};
    const parts = [];
    for (const k of ["left", "top", "width", "height"]) if (s[k]) parts.push(k[0] + "=" + s[k]);
    return parts.join(",") || "-";
  }

  function enumerate(doc) {
    return [...doc.querySelectorAll("[data-arch-eid]")].map((el) => ({
      eid: el.getAttribute("data-arch-eid"),
      kind: el.getAttribute("data-object-type") || "element",
      tag: el.tagName.toLowerCase(),
      box: inlineBox(el),
      text: textDigest(el, 60),
    }));
  }

  // LLM 요청 컨텍스트(§4.1 class b 열): 선택 요소 outerHTML + 실측 박스 + 이웃 digest + 뷰포트
  function contextFor(doc, eid, liveRect) {
    const el = getByEid(doc, eid);
    if (!el) throw new Error("선택 요소를 소스 문서에서 찾을 수 없음: " + eid);
    const container = doc.querySelector(".slide-container");
    const viewport = {
      width: (container && container.style.width) || "1920px",
      height: (container && container.style.height) || "1080px",
    };
    return {
      eid,
      kind: el.getAttribute("data-object-type") || "element",
      outerHTML: el.outerHTML,
      box: liveRect
        ? { left: Math.round(liveRect.x), top: Math.round(liveRect.y), width: Math.round(liveRect.w), height: Math.round(liveRect.h) }
        : null,
      viewport,
      neighbors: enumerate(doc).filter((x) => x.eid !== eid),
    };
  }

  // edit_element 도구의 input_schema — 모든 op 변형의 eid가 {"const": eid}로 고정된다.
  // scope 위반 op는 스키마 준수 응답으로는 아예 표현이 불가능하다(설계 D3의 1차 보증).
  function buildToolSchema(eid) {
    const pin = { const: eid };
    const styleProps = {};
    for (const k of STYLE_WHITELIST) styleProps[k] = { type: "string", maxLength: 300 };
    return {
      type: "object",
      additionalProperties: false,
      required: ["ops"],
      properties: {
        ops: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            anyOf: [
              {
                type: "object", additionalProperties: false, required: ["op", "eid", "text"],
                properties: { op: { const: "setText" }, eid: pin, text: { type: "string", maxLength: 2000 } },
              },
              {
                type: "object", additionalProperties: false, required: ["op", "eid", "style"],
                properties: {
                  op: { const: "setStyle" }, eid: pin,
                  style: { type: "object", additionalProperties: false, minProperties: 1, properties: styleProps },
                },
              },
              {
                type: "object", additionalProperties: false, required: ["op", "eid", "name", "value"],
                properties: {
                  op: { const: "setAttr" }, eid: pin,
                  name: { type: "string", pattern: "^(class|data-[a-zA-Z0-9_-]+)$" },
                  value: { type: "string", maxLength: 500 },
                },
              },
              {
                type: "object", additionalProperties: false, required: ["op", "reason"],
                properties: { op: { const: "reject" }, reason: { type: "string", maxLength: 500 } },
              },
            ],
          },
        },
      },
    };
  }

  function scopeError(msg) {
    const e = new Error(msg);
    e.name = "ScopeViolation";
    return e;
  }

  // D37: 링크 href 화이트리스트 검증. 통과하면 정제된 URL, 아니면 null.
  //   WHY: 블록리스트(javascript:/data: 등을 하나씩 금지)가 아니라 **화이트리스트**(안전한 스킴만 열거)를
  //     쓴다 — 인코딩 변형·신종 스킴에 강하고, "허용된 것만 통과"가 저장물 보안 규약에 부합한다.
  //   COST: http/https/mailto 외 링크(tel:·상대경로 등)는 전부 거부된다(필요해지면 화이트리스트만 확장).
  const HREF_WHITELIST = /^(https?:|mailto:)/i;
  function sanitizeHrefValue(url) {
    if (typeof url !== "string") return null;
    const u = url.trim();
    if (!u || u.length > 2000) return null;
    if (BAD_STYLE_VALUE.test(u)) return null;   // <,>,javascript: 등 인젝션 문자 이중 차단
    if (!HREF_WHITELIST.test(u)) return null;
    return u;
  }

  // 2차 보증: 코드 레벨 scope-gate + sanitize. 스키마를 통과해 왔더라도(혹은 mock이더라도)
  // 여기서 다시 기계적으로 검사한다. 반환: { ops, reject, notes }
  function sanitizeOps(raw, eid) {
    if (!raw || !Array.isArray(raw.ops) || raw.ops.length === 0) {
      throw new Error("응답에 ops 배열이 없습니다.");
    }
    const notes = [];
    const ops = [];
    let reject = null;

    for (const op of raw.ops) {
      if (!op || typeof op !== "object") { notes.push("비정상 op 무시"); continue; }
      if (op.op === "reject") {
        reject = { op: "reject", reason: String(op.reason || "사유 미상").slice(0, 500) };
        continue;
      }
      if (op.eid !== eid) {
        throw scopeError("op가 선택 요소(" + eid + ") 밖(" + op.eid + ")을 대상으로 함 — 적용 거부");
      }
      if (op.op === "setText") {
        if (typeof op.text !== "string") { notes.push("setText: text 누락 — 무시"); continue; }
        const o = { op: "setText", eid, text: op.text.slice(0, 2000) };
        // D27c(a): 줄 인덱스(깨끗한 줄 구조일 때만 apply가 존중, 아니면 largestFontLine 폴백).
        if (Number.isInteger(op.line) && op.line >= 0) o.line = op.line;
        ops.push(o);
      } else if (op.op === "setStyle") {
        const style = {};
        for (const [k, v] of Object.entries(op.style || {})) {
          if (!STYLE_WHITELIST.includes(k)) { notes.push("setStyle: 허용 외 키 '" + k + "' 제거"); continue; }
          if (typeof v !== "string" || BAD_STYLE_VALUE.test(v)) { notes.push("setStyle: '" + k + "' 값 불허(외부 URL/인젝션 류) — 제거"); continue; }
          style[k] = v.slice(0, 300);
        }
        // target 축: "text"=대표 텍스트 줄, 그 외/기본="box"=컨테이너. 선택 요소 subtree 내부라
        // scope는 그대로 보증된다(편집 모드 스타일 패널이 폰트/색을 텍스트 줄에 적용할 때 사용).
        const target = op.target === "text" ? "text" : "box";
        const o = { op: "setStyle", eid, style, target };
        if (Number.isInteger(op.line) && op.line >= 0) o.line = op.line;   // D27c(a): 줄별 서식
        if (Object.keys(style).length) ops.push(o);
        else notes.push("setStyle: 적용 가능한 키 없음 — op 제거");
      } else if (op.op === "setAttr") {
        const name = String(op.name || "");
        const okName = name === "class" ||
          (/^data-[a-zA-Z0-9_-]+$/.test(name) && name !== "data-arch-eid" && name !== "data-object");
        if (!okName) { notes.push("setAttr: 속성 '" + name + "' 불허(class·data-*만, 주소 속성 제외) — 무시"); continue; }
        const value = String(op.value == null ? "" : op.value);
        if (BAD_ATTR_VALUE.test(value)) { notes.push("setAttr: '" + name + "' 값 불허 — 무시"); continue; }
        ops.push({ op: "setAttr", eid, name, value: value.slice(0, 500) });
      } else if (op.op === "setLink") {
        // D37: 링크 — 대상 (서브)줄을 <a href>로 감싼다. href는 화이트리스트(http/https/mailto)만.
        const href = sanitizeHrefValue(op.href);
        if (!href) { notes.push("setLink: href 불허(http/https/mailto만) — 제거"); continue; }
        const o = { op: "setLink", eid, href, target: op.target === "text" ? "text" : "box" };
        if (Number.isInteger(op.line) && op.line >= 0) o.line = op.line;
        ops.push(o);
      } else {
        notes.push("알 수 없는 op '" + String(op.op).slice(0, 30) + "' 무시");
      }
    }
    return { ops, reject, notes };
  }

  // setText 의미론: 요소의 "대표 텍스트 줄"(인라인 font-size가 가장 큰, 직접 텍스트를 가진
  // 후손)의 텍스트를 교체한다. 슬라이드가 전부 인라인 스타일이라 레이아웃 없이 결정 가능.
  // 시스템 프롬프트에 같은 의미론을 명시해 LLM과 계약을 맞춘다.
  function largestFontLine(root) {
    const cands = [];
    (function walk(el) {
      for (const n of el.childNodes) {
        if (n.nodeType === 3 && n.textContent.trim()) { cands.push(el); break; }
      }
      for (const c of el.children) walk(c);
    })(root);
    if (!cands.length) return root;

    const sizeOf = (el) => {
      let cur = el;
      while (cur) {
        const fs = cur.style && cur.style.fontSize;
        if (fs) {
          const m = /^([\d.]+)px$/.exec(fs.trim());
          return m ? parseFloat(m[1]) : 0;
        }
        if (cur === root) break;
        cur = cur.parentElement;
      }
      return 0;
    };
    let best = cands[0];
    let bestSize = sizeOf(best);
    for (const c of cands.slice(1)) {
      const s = sizeOf(c);
      if (s > bestSize) { best = c; bestSize = s; }
    }
    return best;
  }

  // ---------------- D27c(a): obj "줄" 감지 — svgbox의 directChildren(g,"text")와 동형 ----------------
  // 컨테이너가 "깨끗한 줄-divs"(직속 자식마다 자기 텍스트를 직접 가진 요소)일 때만 줄 배열을 준다.
  // 아니면(중첩 span만/플렉스 헤더/블록 중첩/최상위 혼합 텍스트/단일 leaf 텍스트) null → 폴백:
  //   읽기·편집은 largestFontLine(오늘 동작), 줄 추가/삭제는 비활성(사유 표기). 새 필수 구조를 강제하지 않는다.
  //   실측: p01 obj:1(eyebrow/title/subtitle 3 div)·노드 본문(FRONTEND/제목/부제)은 깨끗,
  //         legend(플렉스+span)·게이트 헤더(중첩 div)는 폴백.
  function hasDirectText(el) {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
    return false;
  }
  function hasBlockChild(el) {
    // 줄 안의 인라인(span/b/i/strong/a/code 등)은 허용, 블록(div/p/ul/table/section 등)이 있으면 줄이 아님.
    const BLOCK = new Set(["div", "p", "ul", "ol", "li", "table", "section", "header", "footer", "article", "svg"]);
    for (const c of el.children) if (BLOCK.has(c.tagName.toLowerCase())) return true;
    return false;
  }
  function objLineDivs(container) {
    if (!container || !container.childNodes) return null;
    const kids = [];
    for (const n of container.childNodes) {
      if (n.nodeType === 1) kids.push(n);                             // element
      else if (n.nodeType === 3 && n.textContent.trim()) return null;  // 최상위 혼합 텍스트 = 안 깨끗
    }
    if (!kids.length) return null;
    for (const k of kids) {
      if (!hasDirectText(k)) return null;   // 각 줄은 직접 텍스트를 가져야(순수 span 래핑/플렉스 헤더 배제)
      if (hasBlockChild(k)) return null;    // 중첩 블록(게이트 헤더의 div 2개 등) → 줄 아님
    }
    return kids;
  }
  // ---------------- D29: obj "줄" 감지를 "직속 자식" → "재귀적 리프"로 일반화 ----------------
  // D27c의 objLineDivs는 컨테이너의 **직속 자식**만 줄 후보로 보고, 그 중 하나라도 "리프"가 아니면
  // (예: 텍스트가 한 겹 더 안에 중첩된 flex 헤더) **컨테이너 전체를 all-or-nothing 폴백**시켰다 →
  // 멀쩡한 형제 줄까지 largestFontLine 하나로 도미노 붕괴(P01 노드박스 4곳에서 실측 재현).
  //   여기서는 서브트리를 재귀적으로 훑어 **리프 텍스트 요소를 전부 줄로 인정**한다:
  //     · 리프 = 직접 텍스트를 갖고(hasDirectText) 중첩 block 자식이 없는(!hasBlockChild) 요소.
  //             인라인 자식(span/b/i/a/code 등)은 리프 안에 허용(D27c의 hasBlockChild 규약 그대로).
  //     · block 자식을 가진 요소(flex wrapper 등)나 텍스트 없는 인라인 래퍼는 "그 자체가 줄"이 아니라
  //       순수 컨테이너 → 재귀 진입(자식들을 마저 리프 판정). 텍스트 없는 장식 요소(색점 span 등)는
  //       리프 조건(직접 텍스트) 미달로 무수확 → 자연 제외(별도 배제 목록 불필요).
  //   ★ 상위호환(strict superset) 증명: D27c objLineDivs가 non-null(=모든 직속 자식이 리프)인 컨테이너에서는
  //     재귀가 첫 레벨에서 전부 리프로 판정해 그대로 push하므로 **동일 배열**을 돌려준다(무회귀). 컨테이너 최상위에
  //     느슨한 텍스트가 섞인 경우도 D27c와 똑같이 null 폴백(largestFontLine)해 도달성을 보존한다.
  //   depth=1(평평한 직속 자식)·depth=1+<br>는 이 일반 모델의 특수 케이스일 뿐이다.
  function objLeafLines(container) {
    if (!container || !container.childNodes) return null;
    // D27c와 동일: 컨테이너 최상위에 느슨한 텍스트가 섞이면 전체 폴백(largestFontLine) — 도달성 무회귀.
    for (const n of container.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim()) return null;
    }
    const out = [];
    (function walk(el) {
      for (const c of el.children) {
        if (hasDirectText(c) && !hasBlockChild(c)) out.push(c);   // 리프 = 줄(인라인 자식 허용)
        else walk(c);                                             // 순수 컨테이너/인라인 래퍼 → 재귀(빈 장식은 무수확)
      }
    })(container);
    return out.length ? out : null;
  }
  // ---------------- D28(B): <br> 서브라인 — 직속 자식 div 안의 <br>를 추가 줄 구분자로 인식 ----------------
  // D27c 모델은 "직속 자식 div = 한 줄"이었다. 그런데 <div>브라우저<br>클라이언트</div>는 화면엔 2줄인데
  // 직속 div 하나다(<br>는 인라인이라 objLineDivs의 "깨끗" 검사를 이미 통과함). 여기서 각 (이미 깨끗하다고
  // 판정된) 직속 자식 div를 <br> 기준으로 세그먼트로 한 단계 더 쪼개 **평탄화된 줄 타깃**을 만든다.
  //   <br>가 없으면 세그먼트 1개(=div 전체, D27c와 동일 = 무회귀). 반환: [{ div, seg, segCount }] 또는 null(폴백).
  //   ★ 인덱스 축: setText/클릭/인라인편집은 이 평탄화 축(서브라인). 줄 추가/삭제(+/−)는 여전히 objLineDivs의
  //     div 축(수동 입력 인덱스라 두 축이 섞이지 않음). 서식/스냅샷은 세그먼트가 요소가 아니라서 div 단위로 그레이스풀 폴백.
  function brSegments(div) {
    const groups = [[]];
    for (const n of div.childNodes) {
      if (n.nodeType === 1 && n.tagName && n.tagName.toLowerCase() === "br") groups.push([]);
      else groups[groups.length - 1].push(n);
    }
    return groups;
  }
  //   D29: 줄 후보를 재귀 리프(objLeafLines)로 뽑는다 — 직속 자식만 보던 D27c를 일반화(무회귀 상위호환).
  //   각 리프를 <br> 세그먼트로 한 단계 더 쪼개 평탄화 타깃을 만든다(D28 그대로).
  function objLineTargets(container) {
    const divs = objLeafLines(container);
    if (!divs) return null;
    const out = [];
    for (const div of divs) {
      const segCount = Math.max(1, brSegments(div).length);
      for (let s = 0; s < segCount; s++) out.push({ div, seg: s, segCount });
    }
    return out;
  }
  // 평탄화 인덱스 → 그 서브라인이 속한 (스타일 적용 대상) div 요소, 아니면 null → 호출측 largestFontLine 폴백.
  function objTargetLine(container, line) {
    const targets = objLineTargets(container);
    if (!targets || line == null || line < 0 || line >= targets.length) return null;
    return targets[line].div;
  }
  // 편집/서식 대상 요소 — line이 유효하고 구조가 깨끗하면 그 (서브)줄의 div, 아니면 largestFontLine(폴백).
  function editLine(container, line) {
    return objTargetLine(container, line) || largestFontLine(container);
  }
  // 세그먼트 텍스트 읽기(평탄화 인덱스) — 편집기가 그 서브라인만 보여주도록.
  function objLineText(container, line) {
    const targets = objLineTargets(container);
    if (!targets || line == null || line < 0 || line >= targets.length) {
      const t = largestFontLine(container); return t ? t.textContent : "";
    }
    const tg = targets[line];
    if (tg.segCount <= 1) return tg.div.textContent;
    const groups = brSegments(tg.div);
    return (groups[tg.seg] || []).map((n) => n.textContent).join("");
  }
  // setText: 평탄화 인덱스의 그 서브라인 텍스트만 교체 — <br>와 형제 세그먼트를 바이트 보존.
  //   <br> 없는 div(세그먼트 1개)는 오늘처럼 div.textContent 교체(무회귀). 폴백은 largestFontLine.
  function setObjLineText(doc, container, line, text) {
    const targets = objLineTargets(container);
    if (!targets || line == null || line < 0 || line >= targets.length) {
      largestFontLine(container).textContent = text; return;
    }
    const tg = targets[line];
    if (tg.segCount <= 1) { tg.div.textContent = text; return; }
    // <br> 서브라인: 그 세그먼트의 노드만 텍스트 노드 하나로 치환(다른 세그먼트·<br>는 손대지 않아 바이트 동일).
    const nodes = brSegments(tg.div)[tg.seg] || [];
    const tn = doc.createTextNode(text);
    if (nodes.length) {
      tg.div.insertBefore(tn, nodes[0]);
      for (const n of nodes) tg.div.removeChild(n);
    } else {
      // 빈 세그먼트(예: a<br><br>b의 가운데) — seg번째 <br> 뒤에 삽입.
      let count = 0, ref = null;
      for (const n of tg.div.childNodes) { if (n.nodeType === 1 && n.tagName && n.tagName.toLowerCase() === "br") { count++; if (count === tg.seg) { ref = n.nextSibling; break; } } }
      tg.div.insertBefore(tn, ref);
    }
  }
  // 줄 추가/삭제 UI 게이팅용 스냅샷: 깨끗한 줄 구조인가 · 줄 수 · (고정높이면) 한 줄 더 들어가나.
  function objLineInfo(doc, eid) {
    const el = getByEid(doc, eid);
    if (!el) return { clean: false, lines: 0, canAddLine: false, why: "요소를 찾을 수 없습니다." };
    const lines = objLineDivs(el);
    if (!lines) return { clean: false, lines: 0, canAddLine: false, why: OBJ_NOLINES_WHY };
    return { clean: true, lines: lines.length, canAddLine: canFitOneMore(el, lines) };
  }
  const OBJ_NOLINES_WHY = "이 텍스트 상자는 줄(직속 자식) 구조가 아니어서 줄 추가/삭제를 할 수 없습니다.";

  // D27c(c): obj 줄 추가/삭제 — D20(svgbox)의 "인접 줄 스타일 복제 + 안 넘치면 거절" 정책을 CSS로 이식.
  //   ★ 재배분은 CSS 흐름 기반(SVG y좌표 산술 아님): 자동 높이 컨테이너는 normal flow가 줄을 쌓고
  //     복제한 줄이 인접 줄의 margin-top을 물려받아 간격이 유지된다(명시 y 배치 불필요). 고정 높이
  //     컨테이너는 D20식으로 슬롯 높이를 기하 추정해 넘치면 거절한다(도형을 몰래 키우지 않는다 — 검사는
  //     초록인데 이웃과 겹치는 최악의 조합 방지). 자동 높이면 늘어나는 게 정상이라 거절하지 않는다.
  const OBJ_LINE_MIN_PX = 12;   // 가독 하한(줄 슬롯 높이) — D20의 LINE_GAP_MIN에 대응
  function lineSlotPx(el) {
    const fs = parseFloat(el.style && el.style.fontSize) || 16;
    let lh = parseFloat(el.style && el.style.lineHeight);
    if (!Number.isFinite(lh) || lh <= 0) lh = 1.2;
    if (lh > 4) lh = lh / fs;                // px로 준 line-height를 배수로 환산(방어적)
    const mt = parseFloat(el.style && el.style.marginTop) || 0;
    return Math.max(OBJ_LINE_MIN_PX, fs * lh) + mt;
  }
  function containerFixedHeight(container) {
    const h = parseFloat(container.style && container.style.height);
    return Number.isFinite(h) && h > 0 ? h : null;
  }
  // 고정 높이 컨테이너에 줄이 하나 더 들어가는가. 자동 높이면 항상 true(흐름이 늘어나는 게 설계 의도).
  function canFitOneMore(container, lines) {
    const fixed = containerFixedHeight(container);
    if (fixed == null) return true;
    const donor = lines.length ? lines[lines.length - 1] : null;
    const extra = donor ? lineSlotPx(donor) : OBJ_LINE_MIN_PX;
    const used = lines.reduce((a, el) => a + lineSlotPx(el), 0);
    const padV = (parseFloat(container.style.paddingTop) || 0) + (parseFloat(container.style.paddingBottom) || 0);
    return used + extra + padV <= fixed + 0.5;
  }
  function addObjLine(doc, container, op) {
    const lines = objLineDivs(container);
    if (!lines) throw new Error(OBJ_NOLINES_WHY);
    const at = (op.afterIndex != null && op.afterIndex >= 0 && op.afterIndex < lines.length) ? op.afterIndex : lines.length - 1;
    const donor = at >= 0 ? lines[at] : null;
    if (!canFitOneMore(container, lines)) {
      const fixed = containerFixedHeight(container);
      throw new Error("이 텍스트 상자에 " + (lines.length + 1) + "번째 줄을 넣으면 고정 높이"
        + (fixed != null ? " (" + Math.round(fixed) + "px)" : "") + "를 넘칩니다 — 먼저 상자 높이를 키우거나 다른 줄을 지우세요.");
    }
    // 인접 줄의 스타일을 복제(margin-top·font-size·color 등 상속) — 기본 스타일로 튀지 않게(D20 관례).
    const t = donor ? donor.cloneNode(false) : doc.createElement("div");
    ["id", "data-arch-eid", "data-object", "data-object-type"].forEach((a) => t.removeAttribute(a));
    t.textContent = typeof op.text === "string" ? op.text : OBJ_NEW_LINE_TEXT;
    if (donor) donor.parentNode.insertBefore(t, donor.nextSibling);
    else container.appendChild(t);
    return { lines: lines.length + 1 };
  }
  function removeObjLine(doc, container, op) {
    const lines = objLineDivs(container);
    if (!lines) throw new Error(OBJ_NOLINES_WHY);
    if (!lines.length) throw new Error("이 텍스트 상자에는 삭제할 줄이 없습니다.");
    const i = op.line;
    if (!Number.isInteger(i) || i < 0 || i >= lines.length) throw new Error("줄 인덱스 범위 초과: " + i + " (줄 " + lines.length + "개)");
    lines[i].remove();
    return { lines: lines.length - 1 };
  }
  const OBJ_NEW_LINE_TEXT = "새 줄";

  // ---------------- D27a/b: 삭제 · 복사/붙여넣기 (직접조작 — LLM op 아님) ----------------

  // 속성 셀렉터 값 이스케이프(eid는 obj:/svgbox: 등 " 를 담지 않지만 방어적으로).
  function attrEsc(v) { return String(v).replace(/[\\"]/g, "\\$&"); }

  // 프리픽스별 max+1 채번 — stampBoxes/stampTexts/stampEdges/assignEids와 같은 관례.
  //   재열기 시 assignEids/stamp*가 문서 순서로 재정규화하므로 세션 내 유일성만 보장하면 된다.
  function freshEidFor(doc, prefix) {
    let max = -1;
    doc.querySelectorAll("[data-arch-eid]").forEach((el) => {
      const e = el.getAttribute("data-arch-eid") || "";
      if (e.indexOf(prefix) === 0) { const n = parseInt(e.slice(prefix.length), 10); if (Number.isFinite(n)) max = Math.max(max, n); }
    });
    return prefix + (max + 1);
  }

  // 허용 eid 집합을 제거한 문서 직렬화 — 삭제/붙여넣기 bleed-diff의 "그 밖은 바이트 동일" 실증에 쓴다.
  //   (maskedSerialize는 자리에 <arch-mask>를 남기지만, 개수가 바뀌는 삭제/추가는 "실제로 제거"해야
  //    양쪽이 맞는다: before에서 삭제집합을 제거 == after(이미 없음). add는 대칭.)
  function removeSerialize(doc, set) {
    const clone = doc.cloneNode(true);
    for (const eid of set) { const el = clone.querySelector('[data-arch-eid="' + attrEsc(eid) + '"]'); if (el) el.remove(); }
    return clone.documentElement.outerHTML;
  }

  // 선택 집합 전체의 DOM subtree를 제거(직접조작 삭제). 반환: 실제로 지운 eid 목록.
  function deleteUnits(doc, eids) {
    const set = toEidSet(eids);
    const removed = [];
    for (const eid of set) { const el = getByEid(doc, eid); if (el) { el.remove(); removed.push(eid); } }
    return removed;
  }

  // obj(class-b div) 붙여넣기 — outerHTML을 doc 소유로 파싱 → 새 eid → 좌표 오프셋 → 컨테이너 append.
  function offsetObjStyle(el, dx, dy) {
    const bump = (k, sign) => {
      const cur = el.style[k];
      if (cur == null || cur === "") return;
      const n = parseFloat(cur);
      if (!Number.isFinite(n)) return;
      const unit = /px|%|em|rem/.exec(cur);
      el.style[k] = (n + sign) + (unit ? unit[0] : "px");
    };
    // 아래-오른쪽으로 이동: left/top +dx/+dy, right/bottom 은 반대 부호(같은 시각적 방향).
    bump("left", dx); bump("top", dy); bump("right", -dx); bump("bottom", -dy);
    if ((el.style.left == null || el.style.left === "") && (el.style.right == null || el.style.right === "")) {
      el.style.left = dx + "px";   // 위치 지정이 아예 없던 경우 최소 오프셋 부여
    }
  }
  function pasteObj(doc, html, dx, dy) {
    // ★ innerHTML 대신 DOMParser(이 파일의 parse())로 파싱 — 스크립트 미실행 inert 문서, 그 뒤 importNode.
    //   클립보드 html은 사용자 자신이 로드한 sourceDoc의 el.outerHTML(같은 신뢰 수준)이지만, 파서 경로가
    //   더 견고하고 innerHTML 주입 패턴을 피한다.
    const tmp = parse(html);
    const src = tmp.body ? tmp.body.firstElementChild : null;
    if (!src) throw new Error("붙여넣을 obj 요소를 찾을 수 없습니다.");
    const el = doc.importNode(src, true);
    const eid = freshEidFor(doc, "obj:");
    el.setAttribute("data-object", "true");
    el.setAttribute("data-arch-eid", eid);
    offsetObjStyle(el, dx, dy);
    const container = doc.querySelector(".slide-container") || doc.body;
    if (!container) throw new Error("붙여넣을 컨테이너(.slide-container)가 없습니다.");
    container.appendChild(el);
    return { eid, kind: "obj" };
  }

  // sanitize를 통과한 op만 받는다. doc은 호출측이 넘긴 "다음 상태 후보"(클론) — 원본은
  // bleedDiff 통과 전까지 절대 변형되지 않는다. 각 op은 자기 eid를 들고 있어 단일/배치
  // (레이아웃·다듬기 광역 모드)를 같은 코드로 처리한다. 반환: 실제로 손댄 eid 목록.
  // D37: 요소의 (서브)줄 콘텐츠를 <a href>로 감싼다. 이미 통째로 <a>면 href만 갱신(중첩 <a> 방지).
  //   자식 노드 전체를 옮겨 담으므로 인라인 서식(b/i/span 등)이 링크 안에 그대로 보존된다.
  function wrapLink(doc, el, href) {
    if (el.childNodes.length === 1 && el.firstElementChild && el.firstElementChild.tagName.toLowerCase() === "a") {
      el.firstElementChild.setAttribute("href", href); return;
    }
    const a = doc.createElement("a");
    a.setAttribute("href", href);
    while (el.firstChild) a.appendChild(el.firstChild);
    el.appendChild(a);
  }
  function applyOps(doc, ops) {
    const touched = [];
    for (const op of ops) {
      const el = getByEid(doc, op.eid);
      if (!el) throw new Error("적용 대상 요소가 없음: " + op.eid);
      if (op.op === "setText") {
        // D27c(a)+D28(B): 줄 인덱스가 있고 구조가 깨끗하면 그 (서브)줄, 아니면 largestFontLine(폴백).
        //   <br> 서브라인이면 그 세그먼트만 교체해 <br>·형제 세그먼트를 보존한다(setObjLineText).
        setObjLineText(doc, el, op.line != null ? op.line : null, op.text);
      } else if (op.op === "setStyle") {
        const tgt = op.target === "text" ? editLine(el, op.line != null ? op.line : null) : el;
        for (const [k, v] of Object.entries(op.style)) tgt.style[k] = v;
        // D46: 이 op이 한글 텍스트를 굵게 세팅하고 문서가 폴백 폰트를 쓰는 중이면, 같은 op이
        //   font-family에도 "Pretendard"를 붙여 실물 굵기로 렌더되게 한다(합성 굵게 방지).
        if (op.target === "text" && op.style.fontWeight != null && isBoldWeight(op.style.fontWeight)
            && needsBoldFallback(doc) && HANGUL_RE.test(tgt.textContent || "")) {
          tgt.style.fontFamily = prependFallbackFamily(tgt.style.fontFamily);
        }
      } else if (op.op === "setLink") {
        // D37: 대상 (서브)줄을 <a href>로 감싼다. 굵게(setStyle target:text)와 같은 줄 스코프.
        const tgt = op.target === "text" ? editLine(el, op.line != null ? op.line : null) : el;
        wrapLink(doc, tgt, op.href);
      } else if (op.op === "setAttr") {
        el.setAttribute(op.name, op.value);
      } else if (op.op === "addObjLine") {
        addObjLine(doc, el, op);        // D27c(c): 넘치면 throw → 커밋 취소(소스 무변형)
      } else if (op.op === "removeObjLine") {
        removeObjLine(doc, el, op);
      }
      if (!touched.includes(op.eid)) touched.push(op.eid);
    }
    return touched;
  }

  function serializeRaw(doc) {
    return "<!doctype html>\n" + doc.documentElement.outerHTML;
  }

  // 다운로드용 직렬화 — editor-agent 스크립트와 선택 오버레이는 애초에 소스 Document에
  // 들어가지 않지만(뷰 srcdoc에만 주입됨), 방어적으로 한 번 더 제거를 보장한다.
  // data-arch-eid는 유지(Q6 확정: 재열기 시 핀 안정성).
  function serializeClean(doc) {
    const clone = doc.cloneNode(true);
    clone.querySelectorAll("script[data-arch-editor-agent], [data-arch-overlay]").forEach((n) => n.remove());
    return "<!doctype html>\n" + clone.documentElement.outerHTML;
  }

  // allowed는 단일 eid 문자열 | 배열 | Set 모두 허용 → 하나의 Set으로 정규화.
  // 선택 모드는 크기 1의 집합, 광역 모드(레이아웃·다듬기)는 LLM이 손대도 되는 eid 집합.
  function toEidSet(allowed) {
    if (allowed instanceof Set) return allowed;
    if (Array.isArray(allowed)) return new Set(allowed);
    return new Set([allowed]);
  }

  function maskedSerialize(doc, allowed) {
    const set = toEidSet(allowed);
    const clone = doc.cloneNode(true);
    for (const eid of set) {
      const el = clone.querySelector('[data-arch-eid="' + eid + '"]');
      if (el) el.replaceWith(clone.createElement("arch-mask"));
    }
    return clone.documentElement.outerHTML;
  }

  // 3차 보증: bleed-diff — "허용 eid 집합" 축으로 일반화됐다.
  //   ★ D27a/b 일반화: opts.mode로 개수 변화를 회계한다(모든 미래 add/remove op의 공유 안전망).
  //     · "replace"(기본·미지정): 지금까지의 모든 op — 개수 불변, 자리에서 교체. **바이트 동일 유지**(무회귀).
  //     · "remove"(삭제): 허용집합이 정확히 -|S|만큼 사라짐 + 사라진 게 정확히 S + 그 밖은 바이트 동일.
  //     · "add"(붙여넣기/추가): 허용집합이 정확히 +|S|만큼 생김 + 새 eid가 정확히 S + 그 밖은 바이트 동일.
  //   마스터 증명(remove/add 공통): 집합을 **양쪽에서 실제로 제거**하면 문서가 바이트 동일해야 한다
  //     (before−S == after−S). 삭제는 after에 이미 없어 no-op, 추가는 before에 없어 no-op이라 대칭.
  //   단일 선택(크기 1) 보증은 그대로 유지된다(집합 원소가 하나뿐).
  function bleedDiff(beforeDoc, afterDoc, allowed, opts) {
    const mode = (opts && opts.mode) || "replace";
    const set = toEidSet(allowed);
    const collect = (doc) => {
      const m = new Map();
      doc.querySelectorAll("[data-arch-eid]").forEach((el) => m.set(el.getAttribute("data-arch-eid"), el));
      return m;
    };
    const ma = collect(beforeDoc);
    const mb = collect(afterDoc);
    const offenders = [];

    if (mode === "remove" || mode === "add") {
      const inBefore = mode === "remove", inAfter = mode === "add";
      // (1) 방향 검사: 삭제=before에 있고 after에 없음 / 추가=after에 있고 before에 없음.
      for (const e of set) {
        const wasBefore = ma.has(e), isAfter = mb.has(e);
        if (inBefore && !wasBefore) offenders.push("삭제 대상 " + e + "가 before에 없음");
        if (inBefore && isAfter) offenders.push("삭제 대상 " + e + "가 after에 남음");
        if (inAfter && !isAfter) offenders.push("추가 대상 " + e + "가 after에 없음");
        if (inAfter && wasBefore) offenders.push("추가 대상 " + e + "가 before에 이미 존재");
      }
      // (2) 개수는 정확히 ∓|S|.
      const expected = mode === "remove" ? -set.size : set.size;
      if (mb.size - ma.size !== expected) offenders.push("요소 수 변화가 " + (expected >= 0 ? "+" : "") + expected + "가 아님 " + ma.size + "→" + mb.size);
      // (3) 집합 밖 요소는 양쪽에 존재 + 바이트 동일 — 단, 삭제/추가된 것의 **조상**은 정당하게 바뀐다(자식 변화).
      const removedEls = inBefore ? [...set].map((e) => getByEid(beforeDoc, e)).filter(Boolean) : [];
      const addedAncestors = new Set();
      if (inAfter) {
        for (const e of set) {
          let n = getByEid(afterDoc, e);
          n = n && n.parentElement;
          while (n) { const a = n.getAttribute && n.getAttribute("data-arch-eid"); if (a) addedAncestors.add(a); n = n.parentElement; }
        }
      }
      for (const [k, elA] of ma) {
        if (set.has(k)) continue;
        const elB = mb.get(k);
        if (!elB) { offenders.push(k + " 소실"); continue; }
        if (inBefore && removedEls.some((re) => elA.contains(re))) continue;  // 삭제된 것의 조상 — 마스터가 커버
        if (inAfter && addedAncestors.has(k)) continue;                       // 붙여넣기를 받은 컨테이너
        if (elA.outerHTML !== elB.outerHTML) offenders.push(k);
      }
      // (4) 삭제인데 예상 밖 신규 eid가 생기면 위반(추가는 위 방향 검사가 커버).
      if (inBefore) for (const k of mb.keys()) if (!ma.has(k)) offenders.push("예상 밖 새 요소: " + k);
      // (5) 마스터 증명: 집합을 양쪽에서 제거하면 문서 전체가 바이트 동일.
      if (removeSerialize(beforeDoc, set) !== removeSerialize(afterDoc, set)) {
        if (!offenders.length) offenders.push("집합 밖 문서 변경");
      }
      return { ok: offenders.length === 0, offenders };
    }

    // ── reorder 모드(D34b): class-c(svg 유닛) DOM 재배치 전용 안전망 ──
    //   재배치는 어떤 요소의 **내용**도 바꾸지 않는다 — 형제 순서(= SVG paint 순서)만 바뀐다.
    //   그래서 replace 모드의 maskedSerialize 마스터증명이 여기선 **정당한 재배치를 실패로 잡는다**:
    //   마스크 <arch-mask>가 이동 요소 자리에 남는데 그 자리가 옮겨가므로 직렬화가 달라진다.
    //   → 마스터증명을 remove/add와 같은 removeSerialize(집합 제거 후 동일) 축으로 바꾼다:
    //     이동집합 S를 before/after 양쪽에서 걷어내면 문서가 바이트 동일해야 한다
    //     ⇒ "S 밖 요소는 위치·내용 모두 불변이고, 오직 S의 위치만 달라졌다"를 실증한다.
    //   여기에 두 가지를 더한다:
    //     (b) S 각 원소의 자기 outerHTML 불변 — 재배치는 내용을 바꾸지 않는다(내용편집과의 구별).
    //     (d) 부모 경계 불변 — removeSerialize만으로는 A→B 부모 교차 이동을 못 잡는다(양쪽에서 S를
    //         빼면 서로 같아질 수 있음). 부모를 복제해 S를 제거한 서명을 before/after로 대조해,
    //         다른 <g>(lane/phase 등 다른 opacity/clip/transform 컨텍스트)로 넘어간 이동을 잡는다.
    if (mode === "reorder") {
      // (a) 개수 불변
      if (ma.size !== mb.size) offenders.push("요소 수 변화 " + ma.size + "→" + mb.size);
      // 부모-minus-S 서명: S 자신의 위치에 불변인, "이 요소가 어느 부모 아래에 있는가"의 지문.
      const parentSig = (el) => {
        const p = el && el.parentNode;
        if (!p || p.nodeType !== 1) return p ? "#docroot" : "#none";
        const c = p.cloneNode(true);
        for (const e of set) { const x = c.querySelector('[data-arch-eid="' + attrEsc(e) + '"]'); if (x) x.remove(); }
        return (c.tagName || "") + "|" + c.outerHTML;
      };
      for (const e of set) {
        const a = ma.get(e), b = mb.get(e);
        if (!a) { offenders.push("이동 대상 " + e + "가 before에 없음"); continue; }
        if (!b) { offenders.push("이동 대상 " + e + "가 after에 없음"); continue; }
        // (b) 내용 불변 — 재배치가 outerHTML을 바꾸면(내용까지 손댔으면) 위반.
        if (a.outerHTML !== b.outerHTML) offenders.push("이동 대상 " + e + "의 내용이 바뀜(재배치는 내용을 바꾸지 않아야 함)");
        // (d) 부모 경계 불변 — 다른 부모로 넘어갔으면 위반(그룹 컨텍스트 오염 방지).
        if (parentSig(a) !== parentSig(b)) offenders.push("이동 대상 " + e + "가 다른 부모(<g>)로 이동함 — 그룹 경계를 넘음");
      }
      // (c) 마스터증명: 이동집합을 양쪽에서 제거하면 문서 전체가 바이트 동일 → S 밖은 위치·내용 불변.
      if (removeSerialize(beforeDoc, set) !== removeSerialize(afterDoc, set)) {
        if (!offenders.length) offenders.push("집합 밖 문서 변경(재배치가 다른 요소의 위치·내용을 건드림)");
      }
      return { ok: offenders.length === 0, offenders };
    }

    // ── replace 모드(기본): 기존 동작 그대로(개수 불변, 자리에서 교체) — 바이트 동일 유지 ──
    if (ma.size !== mb.size) offenders.push("요소 수 변화 " + ma.size + "→" + mb.size);

    const allowedEls = [...set].map((e) => getByEid(beforeDoc, e)).filter(Boolean);
    for (const [k, elA] of ma) {
      if (set.has(k)) continue;
      const elB = mb.get(k);
      if (!elB) { offenders.push(k + " 소실"); continue; }
      if (allowedEls.some((ae) => elA.contains(ae))) continue; // 허용 요소의 조상 — (2)가 커버
      if (elA.outerHTML !== elB.outerHTML) offenders.push(k);
    }
    if (maskedSerialize(beforeDoc, set) !== maskedSerialize(afterDoc, set)) {
      if (!offenders.length) offenders.push("허용 요소 밖 문서 변경(비 data-object 영역)");
    }
    return { ok: offenders.length === 0, offenders };
  }

  // 그리기(요소 추가)용 검증 — bleedDiff는 요소 수가 같아야 하므로 쓸 수 없다. 대신:
  // (1) 기존 모든 eid의 outerHTML이 바이트 동일, (2) 추가된 eid가 정확히 newEid 하나,
  // (3) after에서 newEid를 제거하면 문서 전체가 before와 바이트 동일. 셋 다 통과해야 삽입 승격.
  function addDiff(beforeDoc, afterDoc, newEid) {
    const collect = (doc) => {
      const m = new Map();
      doc.querySelectorAll("[data-arch-eid]").forEach((el) => m.set(el.getAttribute("data-arch-eid"), el));
      return m;
    };
    const ma = collect(beforeDoc), mb = collect(afterDoc);
    const offenders = [];
    if (ma.has(newEid)) offenders.push("새 eid가 이미 존재: " + newEid);
    for (const [k, elA] of ma) {
      const elB = mb.get(k);
      if (!elB) { offenders.push(k + " 소실"); continue; }
      if (elA.outerHTML !== elB.outerHTML) offenders.push(k + " 변경됨");
    }
    const added = [...mb.keys()].filter((k) => !ma.has(k));
    if (added.length !== 1 || added[0] !== newEid) offenders.push("추가 요소가 [" + newEid + "] 하나가 아님: " + JSON.stringify(added));
    const clone = afterDoc.cloneNode(true);
    const nEl = clone.querySelector('[data-arch-eid="' + newEid + '"]');
    if (nEl) nEl.remove();
    if (clone.documentElement.outerHTML !== beforeDoc.documentElement.outerHTML) {
      offenders.push("새 요소 외 문서 영역 변경");
    }
    return { ok: offenders.length === 0, offenders };
  }

  // ---------------- 그리기(요소 추가) ----------------

  // 세션 내 유일 eid: 기존 eid들의 숫자 접미사 최댓값 +1을 new: 네임스페이스로 발급.
  // (재열기 시 assignEids가 obj:i로 재정규화하므로 저장물엔 흔적이 남지 않는다.)
  function freshEid(doc) {
    let max = -1;
    doc.querySelectorAll("[data-arch-eid]").forEach((el) => {
      const m = /:(\d+)$/.exec(el.getAttribute("data-arch-eid") || "");
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return "new:" + (max + 1);
  }

  // 클릭 지점에 새 data-object 요소를 삽입한다(그리기 모드). 반환: { eid, kind }.
  //   WHY: kind가 shape/textbox/image/table 무엇이든 **항상 새 <div data-object>를 .slide-container에
  //     append**한다 — 원본이 class-b(div)든 class-c(순수 SVG)든 SVG DOM을 직접 건드리지 않아야
  //     "단일 eid 추가·그 밖 바이트 동일"(addDiff) 요소 스코프 불변식이 한 경로로 성립한다.
  //   COST: 이미지 data URI/표 마크업을 인라인으로 담아 문서가 자기완결(외부 자산 참조 0). EXIT:
  //     SVG 네이티브 삽입(엣지 등)이 필요해지면 별도 어댑터로 분리(이 함수는 obj-only를 유지).
  function addObject(doc, spec) {
    const kind = (spec.kind === "shape" || spec.kind === "image" || spec.kind === "table") ? spec.kind : "textbox";
    const left = Math.round(spec.left), top = Math.round(spec.top);
    const width = Math.round(spec.width), height = Math.round(spec.height);
    const container = doc.querySelector(".slide-container") || doc.body;
    const eid = freshEid(doc);
    const el = doc.createElement("div");
    el.setAttribute("data-object", "true");
    el.setAttribute("data-object-type", kind);
    el.setAttribute("data-arch-eid", eid);
    if (kind === "shape") {
      el.setAttribute("style",
        "position:absolute; left:" + left + "px; top:" + top + "px; width:" + width + "px; height:" + height +
        "px; background:#FFFFFF; border:2px solid #5D40C4; border-radius:4px; z-index:20;");
    } else if (kind === "image") {
      // 이미지는 테두리 없는 고정 크기 박스 + object-fit:fill <img>. data URI는 setAttribute로 넣어
      //   (HTML 파싱 아님) 이스케이프 이슈가 없다. 내부 <img>엔 eid 없음(addDiff 단일).
      //   D39 WHY: fill은 박스 종횡비를 무시하고 <img>를 박스 전체로 늘린다(레터박스 없음) — 사용자가
      //     "박스 크기에 맞춰 늘어나도 됨"을 명시 요청. (contain=종횡비 유지+여백, cover=채우되 잘림과 대비.)
      el.setAttribute("style",
        "position:absolute; left:" + left + "px; top:" + top + "px; width:" + width + "px; height:" + height +
        "px; z-index:20;");
      const img = doc.createElement("img");
      img.setAttribute("src", spec.imgSrc || "");
      img.setAttribute("style", "width:100%; height:100%; object-fit:fill; display:block;");
      el.appendChild(img);
    } else if (kind === "table") {
      // N행×M열 순수 <table>(D40: 삽입 다이얼로그가 spec.rows/cols를 실어 보낸다 — 미지정 시 3×3 하위호환).
      //   각 <td>는 직속 텍스트만(블록 자식 없음) → D29 objLeafLines가 셀을 줄로 인식해 클릭 인라인
      //   편집이 그대로 붙는다(새 텍스트편집 경로 불필요). innerHTML로 조립해 <tbody> 자동삽입이
      //   소스/뷰 양쪽에 동일하게 일어나 줄 인덱스 축이 정합한다.
      //   D38(표 크기버그) WHY: 표를 바깥 div의 지정 크기에 가두는 3중 레시피 —
      //     ① <table> table-layout:fixed + <td> overflow:hidden;min-width:0 → 가로(열 폭)가 min-content로
      //        벌어지지 않고 div width에 맞춰 균등 분배(가로 초과 삐져나옴 제거).
      //     ② 바깥 div overflow:hidden → 세로는 표 행이 콘텐츠 min-content 밑으로 안 줄어들어(표 고유 특성)
      //        div height보다 커질 수 있는데, 이를 박스 안에서 클립해 선택 핸들 밖으로 삐져나오지 않게 한다.
      //     (기존엔 div가 overflow:visible 기본이라 초과분이 핸들 밖으로 노출됐음 — 사용자 신고의 직접 원인.)
      //   D43(세로축소=클립 대신 폰트/패딩 자동축소) WHY: 세로로 표를 자연 높이 밑으로 줄이면 클립 대신
      //     셀 폰트를 줄여 내용이 박스 안에 들어맞게 한다(agent.js fitTableFont, 리사이즈 mouseup 1회).
      //     그 축소가 폰트 한 값(div font-size)만 바꿔도 성립하도록 셀 패딩을 px가 아닌 **em**으로 둔다
      //     — padding:0.25em 0.5em은 셀이 상속하는 font-size에 비례하므로, div의 font-size만 줄이면
      //     글자와 패딩이 함께 축소된다(셀마다 개별 op 불필요 → 단일 setStyle target:box로 커밋).
      //     기본 셀 폰트=16px(실측)에서 0.25em 0.5em == 4px 8px라 초기 렌더는 종전과 바이트 동일.
      //     COST: 폰트 하한(12px)까지 줄여도 안 맞는 극단 축소는 ② overflow:hidden이 최종 안전망으로 클립.
      //     EXIT: 셀 자동확장(내용에 맞춰 div 키우기)이 필요하면 별도 경로로.
      el.setAttribute("style",
        "position:absolute; left:" + left + "px; top:" + top + "px; width:" + width + "px; height:" + height +
        "px; overflow:hidden; z-index:20;");
      const nRows = Math.max(1, Math.min(20, Math.round(spec.rows) || 3));
      const nCols = Math.max(1, Math.min(20, Math.round(spec.cols) || 3));
      const rows = [];
      for (let r = 0; r < nRows; r++) {
        const cells = [];
        for (let c = 0; c < nCols; c++) cells.push('<td style="border:1px solid #ccc; padding:0.25em 0.5em; overflow:hidden; min-width:0;">셀</td>');
        rows.push("<tr>" + cells.join("") + "</tr>");
      }
      el.innerHTML = '<table style="width:100%; height:100%; border-collapse:collapse; table-layout:fixed;">' + rows.join("") + "</table>";
    } else {
      // textbox는 height 미지정(내용에 맞춰 성장) — 대표 텍스트 줄 하나를 넣어 setText/편집 타깃 확보
      el.setAttribute("style",
        "position:absolute; left:" + left + "px; top:" + top + "px; width:" + width +
        "px; z-index:20; padding:8px 10px;");
      const inner = doc.createElement("div");
      inner.setAttribute("style", "font-size:22px; font-weight:700; color:#1A1A1F; line-height:1.25;");
      inner.textContent = "새 텍스트";
      el.appendChild(inner);
    }
    container.appendChild(el);
    return { eid, kind };
  }

  // ---------------- 광역 모드 컨텍스트 ----------------

  // 요소별 대표 텍스트(가장 큰 font-size 줄) 인벤토리 — 다듬기·검증 LLM 컨텍스트/diff의 기준.
  function textInventory(doc) {
    return enumerate(doc).map((e) => {
      const el = getByEid(doc, e.eid);
      const line = el ? largestFontLine(el) : null;
      const text = line ? (line.textContent || "").replace(/\s+/g, " ").trim() : "";
      return { eid: e.eid, kind: e.kind, text };
    });
  }

  // 편집 모드 스타일 패널/서식 툴바 프리필용 — box 배경 + 대상 텍스트 줄의 서식.
  // D27c(b): line을 주면 그 줄(깨끗한 구조일 때), 아니면 largestFontLine. 서식 어휘 전체를 CSS로 읽는다.
  //   기존 호출(line 미지정)은 largestFontLine을 계속 쓰므로 하위호환. 각 값의 폴백은 줄 → 컨테이너 순.
  function styleSnapshot(doc, eid, line) {
    const el = getByEid(doc, eid);
    if (!el) return {};
    const t = editLine(el, line != null ? line : null);
    const pick = (k) => (t.style && t.style[k]) || (el.style && el.style[k]) || "";
    return {
      background: (el.style && el.style.background) || "",
      color: pick("color"),
      fontSize: pick("fontSize"),
      fontWeight: pick("fontWeight"),
      fontStyle: pick("fontStyle"),
      textDecoration: (t.style && (t.style.textDecoration || t.style.textDecorationLine)) || "",
      fontFamily: pick("fontFamily"),
      letterSpacing: pick("letterSpacing"),
      textAlign: pick("textAlign"),
      lineHeight: pick("lineHeight"),
    };
  }

  // ---------------- 검증(audit) 도구 스키마 ----------------

  // findings의 eid를 enum(실재 요소)으로 못박아 존재하지 않는 요소로의 핀을 스키마가 차단.
  function buildAuditSchema(eids) {
    return {
      type: "object", additionalProperties: false, required: ["findings"],
      properties: {
        findings: {
          type: "array", maxItems: 24,
          items: {
            type: "object", additionalProperties: false, required: ["eid", "issue", "suggestion"],
            properties: {
              eid: { enum: eids },
              issue: { type: "string", maxLength: 500 },
              suggestion: { type: "string", maxLength: 500 },
            },
          },
        },
      },
    };
  }

  // ---------------- 필드-클래스 잠금: 레이아웃(위치·크기만) / 다듬기(텍스트만) ----------------
  // 선택 모드의 id-pin과 같은 원리를 "필드 축"에 적용 — 광역 모드의 scope 규율.

  const GEOM_KEYS = ["top", "left", "width", "height", "zIndex"];
  const GEOM_VALUE = /^-?\d+(\.\d+)?(px|%)?$|^auto$/i;

  // 레이아웃 스키마: setStyle의 style 프로퍼티가 GEOM_KEYS로만 제한된다(텍스트 op 분기 아예 없음).
  function buildLayoutSchema(eids) {
    const geomProps = {};
    for (const k of GEOM_KEYS) geomProps[k] = { type: "string", maxLength: 40 };
    return {
      type: "object", additionalProperties: false, required: ["ops"],
      properties: {
        ops: {
          type: "array", minItems: 1, maxItems: 80,
          items: {
            anyOf: [
              {
                type: "object", additionalProperties: false, required: ["op", "eid", "style"],
                properties: {
                  op: { const: "setStyle" }, eid: { enum: eids },
                  style: { type: "object", additionalProperties: false, minProperties: 1, properties: geomProps },
                },
              },
              {
                type: "object", additionalProperties: false, required: ["op", "reason"],
                properties: { op: { const: "reject" }, reason: { type: "string", maxLength: 500 } },
              },
            ],
          },
        },
      },
    };
  }

  // 다듬기 스키마: setText 분기만 존재(geometry/style 분기 아예 없음) — 역방향 잠금.
  function buildPolishSchema(eids) {
    return {
      type: "object", additionalProperties: false, required: ["ops"],
      properties: {
        ops: {
          type: "array", minItems: 1, maxItems: 80,
          items: {
            anyOf: [
              {
                type: "object", additionalProperties: false, required: ["op", "eid", "text"],
                properties: { op: { const: "setText" }, eid: { enum: eids }, text: { type: "string", maxLength: 2000 } },
              },
              {
                type: "object", additionalProperties: false, required: ["op", "reason"],
                properties: { op: { const: "reject" }, reason: { type: "string", maxLength: 500 } },
              },
            ],
          },
        },
      },
    };
  }

  // 레이아웃 sanitize: 기계적 필드 잠금 — setText 등 비-geometry op은 스키마를 우회해 왔어도 제거.
  function sanitizeLayoutOps(raw, allowedEids) {
    const allow = toEidSet(allowedEids);
    if (!raw || !Array.isArray(raw.ops)) throw new Error("레이아웃 응답에 ops 배열이 없습니다.");
    const ops = [], notes = []; let reject = null;
    for (const op of raw.ops) {
      if (!op || typeof op !== "object") { notes.push("비정상 op 무시"); continue; }
      if (op.op === "reject") { reject = { reason: String(op.reason || "사유 미상").slice(0, 500) }; continue; }
      if (op.op !== "setStyle") { notes.push("필드 잠금: '" + String(op.op).slice(0, 20) + "'은 레이아웃 모드에서 불가(위치·크기만) — 제거"); continue; }
      if (!allow.has(op.eid)) { notes.push("대상 밖 eid '" + op.eid + "' 무시"); continue; }
      const style = {};
      for (const [k, v] of Object.entries(op.style || {})) {
        if (!GEOM_KEYS.includes(k)) { notes.push("필드 잠금: 스타일 키 '" + k + "' 제거(위치·크기만)"); continue; }
        if (typeof v !== "string" || BAD_STYLE_VALUE.test(v) || !GEOM_VALUE.test(v.trim())) { notes.push("setStyle: '" + k + "' 값 불허 — 제거"); continue; }
        style[k] = v.trim().slice(0, 40);
      }
      if (Object.keys(style).length) ops.push({ op: "setStyle", eid: op.eid, style, target: "box" });
      else notes.push("setStyle: 적용 가능한 위치·크기 키 없음 — op 제거");
    }
    return { ops, reject, notes };
  }

  // 다듬기 sanitize: 역방향 필드 잠금 — setStyle 등 비-text op 제거.
  function sanitizePolishOps(raw, allowedEids) {
    const allow = toEidSet(allowedEids);
    if (!raw || !Array.isArray(raw.ops)) throw new Error("다듬기 응답에 ops 배열이 없습니다.");
    const ops = [], notes = []; let reject = null;
    for (const op of raw.ops) {
      if (!op || typeof op !== "object") { notes.push("비정상 op 무시"); continue; }
      if (op.op === "reject") { reject = { reason: String(op.reason || "사유 미상").slice(0, 500) }; continue; }
      if (op.op !== "setText") { notes.push("필드 잠금: '" + String(op.op).slice(0, 20) + "'은 다듬기 모드에서 불가(텍스트만) — 제거"); continue; }
      if (!allow.has(op.eid)) { notes.push("대상 밖 eid '" + op.eid + "' 무시"); continue; }
      if (typeof op.text !== "string") { notes.push("setText: text 누락 — 무시"); continue; }
      ops.push({ op: "setText", eid: op.eid, text: op.text.slice(0, 2000) });
    }
    return { ops, reject, notes };
  }

  // ---------------- D46: 다이어그램 콘텐츠 굵은 한글 폰트 폴백 ----------------
  // 배경: srcdoc iframe(#diagram-frame)은 부모 페이지(styles.css)의 @font-face("Pretendard")를
  //   상속하지 않는다 — 별개 document라 브라우저가 부모 스타일시트를 넘겨주지 않는다(표준 동작).
  //   그래서 다이어그램 텍스트를 굵게 지정해도 iframe에는 실물 굵은 한글 글리프가 없어 브라우저가
  //   합성(가짜 굵게)한다. 문서가 이미 자기 폰트(예: p01의 Google Fonts @import)를 갖고 있으면
  //   손대지 않는다(불필요한 용량 증가 방지) — hasOwnFontSource가 그 판단을 맡는다.
  const HANGUL_RE = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힣ힰ-퟿]/;

  // editor.js의 isBoldWeight(D26)와 판정 기준을 반드시 일치시킨다(600 이상 또는 "bold").
  function isBoldWeight(w) {
    const n = parseInt(w, 10);
    if (Number.isFinite(n)) return n >= 600;
    return String(w || "").trim() === "bold";
  }

  // 문서 <head>에 이미 자기 폰트 소스(@font-face·@import 또는 폰트 관련 <link rel=stylesheet>)가
  // 있는가 — 있으면 폴백을 주입하지 않는다(문서가 이미 스스로 해결한 문제).
  function hasOwnFontSource(doc) {
    if (!doc || !doc.head) return false;
    const styleHit = [...doc.head.querySelectorAll("style")]
      .some((s) => /@import\s+url\(|@font-face/i.test(s.textContent || ""));
    if (styleHit) return true;
    return [...doc.head.querySelectorAll('link[rel="stylesheet"]')]
      .some((l) => /font/i.test(l.getAttribute("href") || ""));
  }

  // 이 문서가 이미 폴백 스타일을 주입받았는가(= 이후 편집도 폴백 처리를 받아야 하는가의 게이트).
  function needsBoldFallback(doc) {
    return !!(doc && doc.head && doc.head.querySelector("#arch-bold-fallback"));
  }

  // family 값 앞에 "Pretendard"를 접두(중복 접두 방지 idempotent).
  function prependFallbackFamily(existing) {
    const e = existing || "";
    if (e.trim().indexOf('"Pretendard"') === 0) return e;
    return '"Pretendard", ' + (existing || "sans-serif");
  }

  // Regular/Bold woff2를 base64로 읽어 세션 내 캐시(재호출 시 재사용, 중복 fetch 방지).
  let _fallbackFontsCache = null;
  async function loadFallbackFontsBase64() {
    if (!_fallbackFontsCache) {
      const toBase64 = (buf) => {
        let binary = "";
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
      };
      _fallbackFontsCache = Promise.all([
        fetch("fonts/Pretendard-Regular.woff2").then((r) => r.arrayBuffer()),
        fetch("fonts/Pretendard-Bold.woff2").then((r) => r.arrayBuffer()),
      ]).then(([regBuf, boldBuf]) => ({ regular64: toBase64(regBuf), bold64: toBase64(boldBuf) }));
    }
    return _fallbackFontsCache;
  }

  // base64 self-contained <style>을 <head>에 주입 — 다운로드한 파일을 서버 없이(file://) 열어도
  // 그대로 작동한다. 400과 700-900 두 얼굴 모두 등록 필수(한 얼굴만 등록하면 CSS 폰트매칭이
  // "그 family의 가장 가까운 등록 굵기"로 스냅되어 일반 본문(400)까지 Bold 글리프로 렌더되는
  // 회귀가 생긴다 — styles.css:8-12의 실측 교훈과 동일한 함정).
  function injectFallbackStyle(doc, regular64, bold64) {
    if (needsBoldFallback(doc)) return;   // 방어적 idempotency
    const style = doc.createElement("style");
    style.id = "arch-bold-fallback";
    style.textContent =
      '@font-face { font-family: "Pretendard"; font-weight: 400; font-style: normal; ' +
      'src: url(data:font/woff2;base64,' + regular64 + ') format("woff2"); }\n' +
      '@font-face { font-family: "Pretendard"; font-weight: 700 900; font-style: normal; ' +
      'src: url(data:font/woff2;base64,' + bold64 + ') format("woff2"); }';
    doc.head.appendChild(style);
  }

  // 로드 시점에 이미 굵은(문서 자체 굵기 기준) 한글 텍스트가 있으면 소급으로 family를 붙인다 —
  // (1) SVG <text font-weight> 속성 축, (2) obj(HTML) 인라인 style.fontWeight 축.
  function retrofitExistingBoldHangul(doc) {
    doc.querySelectorAll("text[font-weight]").forEach((t) => {
      if (isBoldWeight(t.getAttribute("font-weight")) && HANGUL_RE.test(t.textContent || "")) {
        t.setAttribute("font-family", prependFallbackFamily(t.getAttribute("font-family")));
      }
    });
    doc.querySelectorAll("[style]").forEach((el) => {
      if (isBoldWeight(el.style.fontWeight) && HANGUL_RE.test(el.textContent || "")) {
        el.style.fontFamily = prependFallbackFamily(el.style.fontFamily);
      }
    });
  }

  // 문서 로드 시 1회 호출(editor.js loadDom, 첫 undo 스냅샷 이전) — 자기 폰트가 있으면 아무것도
  // 안 하고 false, 없으면 폴백을 주입 + 기존 굵은 한글을 소급 수정하고 true.
  async function ensureBoldFallback(doc) {
    if (hasOwnFontSource(doc)) return false;
    const { regular64, bold64 } = await loadFallbackFontsBase64();
    injectFallbackStyle(doc, regular64, bold64);
    retrofitExistingBoldHangul(doc);
    return true;
  }

  return {
    parse, load, assignEids, getByEid, objZIndex, enumerate, contextFor,
    buildToolSchema, sanitizeOps, applyOps, bleedDiff, addDiff,
    serializeRaw, serializeClean, maskedSerialize, STYLE_WHITELIST,
    sanitizeHrefValue,   // D37: 링크 href 화이트리스트 검증(editor.js fmtApplyLink에서 선검증)
    // stage 3 추가:
    freshEid, addObject, textInventory, styleSnapshot, largestFontLine,
    buildAuditSchema, buildLayoutSchema, buildPolishSchema,
    sanitizeLayoutOps, sanitizePolishOps, GEOM_KEYS,
    // D27a/b/c 추가: 삭제·붙여넣기·obj 줄 정밀도/추가·삭제
    deleteUnits, pasteObj, freshEidFor, removeSerialize,
    objLineDivs, objLeafLines, objTargetLine, editLine, objLineInfo, addObjLine, removeObjLine,
    // D28(B): <br> 서브라인 평탄화 모델
    objLineTargets, objLineText, setObjLineText,
    // D46: 다이어그램 콘텐츠 굵은 한글 폰트 폴백
    HANGUL_RE, isBoldWeight, hasOwnFontSource, needsBoldFallback, prependFallbackFamily,
    loadFallbackFontsBase64, injectFallbackStyle, retrofitExistingBoldHangul, ensureBoldFallback,
  };
})();
