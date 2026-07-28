// 결정론적 mock op 생성기 — NVIDIA 키 없이 전체 기계(스키마 → scope-gate → sanitize →
// apply → bleed-diff → undo → 다운로드)를 검증하기 위한 경로. LLM의 "판단 품질"이 아니라
// 파이프라인의 "기계적 보증"을 시험한다. 키가 비어 있으면 UI가 자동으로 이 경로를 켠다.
const ArchMock = (() => {
  const COLOR_MAP = [
    [/빨강|빨간|red/i, "#FDE2E2"],
    [/노랑|노란|yellow/i, "#FEF9C3"],
    [/파랑|파란|blue/i, "#DBEAFE"],
    [/초록|녹색|green/i, "#DCFCE7"],
    [/보라|자주|purple/i, "#EDE9FE"],
  ];

  // "제목을 '최종 리포트'로 바꿔줘" → 최종 리포트
  function extractTarget(instr) {
    const q = instr.match(/['"'‘“「『]([^'"'’”」』]+)['"'’”」』]/);
    if (q) return q[1].trim();
    const m = instr.match(/(?:을|를)\s*(.+?)\s*(?:으로|로)\s*(?:바꿔|변경|수정|교체)/);
    if (m) return m[1].trim();
    return instr.trim();
  }

  function generate(instruction, eid) {
    const instr = String(instruction || "").trim();
    if (!instr) return { ops: [{ op: "reject", reason: "빈 지시입니다." }] };

    // 스펙 순서: 제목/텍스트 → setText 우선
    if (/제목|텍스트|문구|이름/.test(instr)) {
      return { ops: [{ op: "setText", eid, text: extractTarget(instr) }] };
    }
    if (/배경|색/.test(instr)) {
      const hex = instr.match(/#[0-9a-fA-F]{3,8}\b/);
      let color = "#FEF3C7"; // 기본 강조색
      for (const [re, v] of COLOR_MAP) { if (re.test(instr)) { color = v; break; } }
      if (hex) color = hex[0];
      return { ops: [{ op: "setStyle", eid, style: { background: color } }] };
    }
    return {
      ops: [{
        op: "reject",
        reason: 'mock 모드: "제목/텍스트/문구" 또는 "배경/색" 지시만 처리합니다. 실제 AI 편집은 연결 설정에 NVIDIA 키를 입력하세요.',
      }],
    };
  }

  // ---------------- SVG 박스/자유 텍스트(class c) mock — setFill/setStroke/setText/move/resize ----------------
  // 선택 모드에서 SVG 박스·자유 텍스트(svgtext, D16 b) 지시를 결정론적 op로 변환한다. 색은 CSS
  // background가 아니라 <rect fill>/<rect stroke>(박스) 또는 <text fill>(자유 텍스트)를 바꾸는
  // setFill/setStroke op으로 나간다. 자유 텍스트에서 setStroke/resize는 어댑터 sanitize가 제거하므로
  // "색/채움"→setFill, "텍스트/라벨"→setText가 실효 op이다(별도 분기 불필요 — 어댑터가 걸러낸다).
  const SVG_COLOR_MAP = [
    [/빨강|빨간|red/i, "#ef4444"],
    [/노랑|노란|yellow/i, "#f59e0b"],
    [/파랑|파란|blue/i, "#3b82f6"],
    [/초록|녹색|green/i, "#22c55e"],
    [/보라|자주|purple/i, "#8b5cf6"],
    [/회색|gray|grey/i, "#9ca3af"],
    [/검정|검은|black/i, "#111827"],
    [/흰|하양|white/i, "#ffffff"],
  ];
  function svgColor(instr) {
    const hex = instr.match(/#[0-9a-fA-F]{3,8}\b/);
    if (hex) return hex[0];
    for (const [re, v] of SVG_COLOR_MAP) if (re.test(instr)) return v;
    return "#3b82f6"; // 기본 = 파랑
  }
  // 화살표(svgedge, D18) mock — 방향 뒤집기 / 화살촉 크기. 기하(정점) 편집은 좌표가 필요해
  // 자연어 mock 대상이 아니다(뷰 드래그가 담당) → 그 외 지시는 정직하게 reject.
  function generateEdge(instr, eid) {
    if (/방향|뒤집|반대|반전|flip|화살표 끝/i.test(instr)) {
      return { ops: [{ op: "flipEdge", eid }] };
    }
    if (/화살촉|머리|촉|헤드|head|크기|사이즈|키워|키우|줄여|작게|크게/i.test(instr)) {
      const m = instr.match(/([\d.]+)\s*(?:배|x|×)/i);
      let scale = m ? parseFloat(m[1]) : (/줄여|작게|축소/.test(instr) ? 0.6 : 2);
      if (!Number.isFinite(scale)) scale = 2;
      return { ops: [{ op: "setHeadSize", eid, scale }] };
    }
    return {
      ops: [{
        op: "reject",
        reason: 'mock 모드(화살표): "방향 뒤집기" 또는 "화살촉 크기"만 처리합니다. 꼭짓점 이동·추가는 뷰에서 드래그하세요.',
      }],
    };
  }

  function generateSvg(instruction, eid, shape) {
    const instr = String(instruction || "").trim();
    if (!instr) return { ops: [{ op: "reject", reason: "빈 지시입니다." }] };
    if (shape === "edge" || String(eid || "").indexOf("svgedge:") === 0) return generateEdge(instr, eid);
    // 줄 추가/삭제 — ★ setText 분기보다 먼저. "줄 추가"가 라벨 교체로 새지 않게 한다.
    //   ("크기를 줄여줘"도 /줄/에 걸리지만 추가·삭제 동사가 없어 아래 크기 분기로 정상 통과)
    if (/줄|라인/.test(instr)) {
      if (/추가|삽입|넣/.test(instr)) {
        const op = { op: "addTextLine", eid };
        const q = instr.match(/['"'‘“「『]([^'"'’”」』]+)['"'’”」』]/);
        if (q) op.text = q[1].trim();
        return { ops: [op] };
      }
      if (/삭제|제거|지우|지워|없애|빼/.test(instr)) {
        const m = instr.match(/(\d+)\s*(?:번째\s*)?(?:줄|라인)/);
        return { ops: [{ op: "removeTextLine", eid, line: m ? Math.max(0, parseInt(m[1], 10) - 1) : 0 }] };
      }
    }
    // 텍스트/제목/라벨 → setText
    if (/제목|텍스트|문구|이름|라벨/.test(instr)) {
      return { ops: [{ op: "setText", eid, text: extractTarget(instr) }] };
    }
    // 테두리/외곽/stroke → setStroke
    if (/테두리|외곽선|외곽|선색|stroke/i.test(instr)) {
      return { ops: [{ op: "setStroke", eid, color: svgColor(instr) }] };
    }
    // 색/채움/배경 → setFill (rect fill)
    if (/채움|배경|색|칠|fill/i.test(instr)) {
      return { ops: [{ op: "setFill", eid, color: svgColor(instr) }] };
    }
    // 크기/너비/높이 → resize (rect 박스에만; 아니면 sanitize가 제거)
    if (/크기|너비|폭|높이|사이즈|resize|width|height/i.test(instr)) {
      const nums = instr.match(/(\d+)\s*(?:x|×|,)\s*(\d+)/);
      const w = nums ? parseInt(nums[1], 10) : 180;
      const h = nums ? parseInt(nums[2], 10) : 80;
      return { ops: [{ op: "resize", eid, width: w, height: h }] };
    }
    return {
      ops: [{
        op: "reject",
        reason: 'mock 모드(SVG 박스): "색/채움", "테두리", "텍스트/라벨", "크기", "줄 추가/삭제" 지시만 처리합니다. 실제 AI 편집은 NVIDIA 키를 입력하세요.',
      }],
    };
  }

  // ---------------- 검증(audit) mock — ①②③⑤ (④는 클라이언트 기계검증이라 여기 없음) ----------------
  // findings의 suggestion을 generate()가 그대로 소화할 수 있는 문장으로 만들어, "AI로 고치기"가
  // 선택-모드 scoped edit 루프를 그대로 재사용해 한 요소만 고치는 흐름이 mock에서도 완주되게 한다.
  function audit(kind, inventory) {
    const textboxes = (inventory || []).filter((e) => e.kind === "textbox" && e.text);
    const n = kind === 5 ? 2 : 1;
    const label = { 1: "맞춤법·문법", 2: "용어 일관성", 3: "사실·정합성", 5: "전체" }[kind] || "검증";
    const findings = [];
    for (let i = 0; i < Math.min(n, textboxes.length); i++) {
      const t = textboxes[i];
      findings.push({
        eid: t.eid,
        issue: "[mock · " + label + "] '" + (t.text || "").slice(0, 18) + "' 항목에 예시 지적을 답니다.",
        suggestion: "제목을 '검증본" + (i + 1) + "'로 바꿔줘",
      });
    }
    if (!findings.length) {
      findings.push({ eid: (inventory[0] || {}).eid, issue: "[mock] 지적할 텍스트 요소를 찾지 못했습니다.", suggestion: "제목을 '검증본'로 바꿔줘" });
    }
    return { findings };
  }

  // ---------------- 레이아웃 mock — 위치·크기 op(필드 잠금 검증용) ----------------
  // 텍스트류 지시면 setText op을 일부러 반환해 필드 잠금(sanitizeLayoutOps)이 걸러냄을 보인다.
  function layout(instruction, elements) {
    const instr = String(instruction || "");
    if (/텍스트|제목|문구|글자|라벨/.test(instr)) {
      const e0 = (elements[0] || {}).eid;
      return { ops: [{ op: "setText", eid: e0, text: "레이아웃모드-텍스트변경-시도" }] };
    }
    const num = instr.match(/(\d+)\s*px/);
    const delta = num ? parseInt(num[1], 10) : 40;
    let axis = "left", sign = 1;
    if (/왼쪽|left/i.test(instr)) { axis = "left"; sign = -1; }
    else if (/아래|down|below/i.test(instr)) { axis = "top"; sign = 1; }
    else if (/위로|위쪽|up|above/i.test(instr)) { axis = "top"; sign = -1; }
    else { axis = "left"; sign = 1; }
    const targets = (elements || []).filter((e) => typeof e[axis] === "number").slice(0, 2);
    const ops = targets.map((e) => ({
      op: "setStyle", eid: e.eid, style: { [axis]: (e[axis] + sign * delta) + "px" },
    }));
    if (!ops.length) return { ops: [{ op: "reject", reason: "mock: 이동할 요소가 없습니다." }] };
    return { ops };
  }

  // ---------------- 다듬기 mock — 텍스트 op(역방향 필드 잠금 검증용) ----------------
  function polish(instruction, elements) {
    const instr = String(instruction || "");
    if (/위치|크기|이동|정렬|간격|좌표|width|height|left|top/i.test(instr)) {
      const e0 = (elements[0] || {}).eid;
      return { ops: [{ op: "setStyle", eid: e0, style: { left: "999px" } }] };
    }
    const targets = (elements || []).filter((e) => e.text).slice(0, 3);
    const ops = targets.map((e) => ({ op: "setText", eid: e.eid, text: e.text + " ✎" }));
    if (!ops.length) return { ops: [{ op: "reject", reason: "mock: 다듬을 텍스트가 없습니다." }] };
    return { ops };
  }

  return { generate, generateSvg, audit, layout, polish };
})();
