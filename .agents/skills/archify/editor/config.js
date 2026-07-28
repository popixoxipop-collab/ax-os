// 연결 설정 — Pipeline Lab의 LabConfig 패턴(docs/lab/config.js) 축약 이식.
// 키는 메모리에만 산다: localStorage/sessionStorage 어디에도 저장하지 않고(원본 패턴보다 더 엄격),
// 밖으로 나가는 경로는 오직 llm.js의 프록시 호출 x-nvidia-api-key 헤더 하나뿐이다.
// 프록시 URL은 원본과 동일하게 "잠기지 않은 기본값"(수정 가능한 시작값)이다.
const ArchConfig = (() => {
  const DEFAULT_PROXY_URL = "https://nvidia-proxy.popixoxipop.workers.dev";
  // D15: 기본 모델 = stepfun-ai/step-3.5-flash (NVIDIA Build) — 사용자 지정 + 실측 최적
  //   WHY: 라이브 실측(2026-07-20, 같은 프록시·같은 tool-call patch op) 모델 지연 비교 —
  //        step-3.5-flash=58s(valid tool_call ✓), llama-3.1-8b=110s, llama-3.3-70b=>254s.
  //        step이 지금까지 테스트 중 가장 빠르고 tool_call도 유효. 인터랙티브 요소 편집은
  //        지연이 UX를 지배하므로 최저지연+유효출력 모델이 기본값으로 최적. 모델 ID는
  //        repo의 16모델 벤치마크(turn_engine_grading, step-3.5-flash 1위 0.866)에서 확인한
  //        정확한 NVIDIA Build 카탈로그 id(`stepfun-ai/` 접두어 — `stepfun/`은 404).
  //   COST: 여전히 build-tier 고유 지연이라 "즉시"는 아님(58s, 데모는 mock이 즉시). flash
  //        급이라 아주 복잡한 지시 해석은 대형모델보다 약할 수 있음(단순 필드 patch는 유효 확인).
  //   EXIT: 어려운 편집엔 연결설정 model 입력으로 대형모델(70b 등)로 상향(품질↔속도 사용자
  //        선택, 설계 D10). 이 id가 NVIDIA 카탈로그에서 빠지면(404) 여기만 갱신.
  const DEFAULT_MODEL = "stepfun-ai/step-3.5-flash";

  const state = {
    "proxy-url": DEFAULT_PROXY_URL,
    "nvidia-key": "",
    "model": DEFAULT_MODEL,
  };

  // input 요소 id == state 키 규약 (proxy-url / nvidia-key / model)
  function wire(onChange) {
    for (const f of Object.keys(state)) {
      const el = document.getElementById(f);
      if (!el) continue;
      el.value = state[f];
      el.addEventListener("input", () => {
        state[f] = el.value.trim();
        if (onChange) onChange(f);
      });
    }
  }

  function get(f) { return state[f] || ""; }
  function has(f) { return Boolean(state[f]); }

  return { wire, get, has, DEFAULT_PROXY_URL, DEFAULT_MODEL };
})();
