// NVIDIA Build 호출 클라이언트 — Pipeline Lab docs/lab/llm.js에서 submitAndPoll + chatTool을
// 거의 그대로 이식(설계 D10). 원본 결정 요지 유지:
//  - D-C: integrate.api.nvidia.com은 CORS 헤더가 없어 브라우저 직접 호출 불가 → 모든 호출은
//    프록시(worker/nvidia-proxy.js 계약)를 거친다. 이 파일은 NVIDIA와 직접 대화하지 않고,
//    키를 in-memory config 밖에 보존하지 않는다.
//  - D-H: 프록시는 POST에 즉시 job_id를 돌려주고 실제 NVIDIA 호출은 서버측 큐 consumer가
//    수행(최대 15분, 클라이언트 대기 없음) → 여기서는 GET ?job=<id>를 폴링한다.
//  - D-I/D169: 실패 시 서버측 자동 재시도(x-max-attempts 미지정 시 기본 3회).
// 원본과 다른 점 2가지: (1) 디버그 트래픽 그래프용 requestLog 제거(이 앱에 그래프 없음),
// (2) MAX_POLL_MS 35분 → 10분 — 단일 요소 편집 UX에서 35분 대기는 무의미하고, 10분이면
// 1회 시도(600s)+재시도 초입까지 커버한다.
const ArchLLM = (() => {
  const POLL_INTERVAL_MS = 3000;
  const MAX_POLL_MS = 10 * 60 * 1000;

  async function submitAndPoll(proxyUrl, apiKey, body, opts = {}) {
    const headers = { "content-type": "application/json", "x-nvidia-api-key": apiKey };
    if (opts.maxAttempts) headers["x-max-attempts"] = String(opts.maxAttempts);
    const submitRes = await fetch(proxyUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!submitRes.ok) {
      const text = await submitRes.text().catch(() => "");
      throw new Error(`작업 제출 실패 (HTTP ${submitRes.status}): ${text.slice(0, 300)}`);
    }
    const submitData = await submitRes.json();
    const jobId = submitData.job_id;
    if (!jobId) throw new Error(`작업 제출 응답에 job_id가 없음: ${JSON.stringify(submitData).slice(0, 200)}`);

    const base = proxyUrl.split("?")[0];
    const pollUrl = `${base}?job=${encodeURIComponent(jobId)}`;
    const startedAt = Date.now();
    while (Date.now() - startedAt < MAX_POLL_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      let job;
      try {
        const pollRes = await fetch(pollUrl);
        if (!pollRes.ok) continue; // transient poll hiccup -- just try again next tick
        job = await pollRes.json();
      } catch (e) {
        continue; // network blip on the poll itself -- keep polling, don't fail the job for it
      }
      if (job.status === "pending") continue;
      if (job.status === "done") return JSON.parse(job.result);
      if (job.status === "error") {
        const err = new Error(`NVIDIA 호출 실패: ${job.error || "알 수 없는 오류"}`);
        err.retryable = !!job.retryable;
        throw err;
      }
      throw new Error(`알 수 없는 작업 상태: ${JSON.stringify(job).slice(0, 200)}`);
    }
    throw new Error(`작업이 ${Math.round(MAX_POLL_MS / 60000)}분 안에 끝나지 않음 (job_id=${jobId})`);
  }

  // OpenAI-compatible tools + tool_choice로 함수 호출을 강제하고, tool_calls의 arguments를
  // 파싱해 돌려준다 — 응답 형태가 tool.input_schema로 강제되는 것이 설계 D3의 핵심
  // (scope는 프롬프트가 아니라 스키마가 자른다).
  async function chatTool({ model, messages, tool, maxTokens, temperature = 0.0, maxAttempts }) {
    const proxyUrl = ArchConfig.get("proxy-url");
    const apiKey = ArchConfig.get("nvidia-key");
    if (!proxyUrl || !apiKey) {
      throw new Error("NVIDIA API 키와 프록시 URL을 먼저 입력하세요 (연결 설정).");
    }
    const body = {
      model, messages, max_tokens: maxTokens, temperature,
      tools: [{ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }],
      tool_choice: { type: "function", function: { name: tool.name } },
    };
    const data = await submitAndPoll(proxyUrl, apiKey, body, { maxAttempts });
    const choice = data.choices && data.choices[0] && data.choices[0].message;
    const call = choice && choice.tool_calls && choice.tool_calls.find((c) => c.function.name === tool.name);
    if (!call) throw new Error(`tool_calls에서 ${tool.name}을 찾지 못함: ${JSON.stringify(data).slice(0, 300)}`);
    return JSON.parse(call.function.arguments);
  }

  return { submitAndPoll, chatTool };
})();
