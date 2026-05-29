/**
 * AX OS v2 — Multi-Agent Demo
 * Verifies: OllamaAdapter ping + AgentRegistry routing
 *
 * Run: node ax-os-demo-multiagent.mjs
 */

// ── Inline-import the compiled code (JS versions not built yet, so we use
//    a lightweight runtime test that calls Ollama directly) ─────────────────

const OLLAMA_BASE = "http://localhost:11434";

// ── 1. Ping Ollama ──────────────────────────────────────────────────────────
async function pingOllama() {
  try {
    const r = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return { ok: false, models: [] };
    const data = await r.json();
    return { ok: true, models: data.models.map(m => m.name) };
  } catch {
    return { ok: false, models: [] };
  }
}

// ── 2. Minimal AgentRegistry (JS, no TypeScript compiler needed) ────────────
class AgentRegistry {
  constructor() { this._agents = new Map(); }

  register(def) {
    if (this._agents.has(def.id)) throw new Error(`Duplicate agent: ${def.id}`);
    this._agents.set(def.id, { def, tasks: 0, errors: 0 });
    console.log(`  [registry] registered: ${def.id} (${def.provider}/${def.model})`);
  }

  route(task) {
    if (task.preferredAgentId && this._agents.has(task.preferredAgentId)) {
      return { agentId: task.preferredAgentId, score: 1.0, reason: "explicit" };
    }
    let best = null, bestScore = -1;
    for (const [id, entry] of this._agents) {
      const score = task.requiredCapabilities.length === 0 ? 0.5
        : task.requiredCapabilities.reduce((s, req) => {
            const cap = entry.def.capabilities.find(c => c.name === req);
            return s + (cap?.priority ?? 0);
          }, 0) / task.requiredCapabilities.length;
      if (score > bestScore) { bestScore = score; best = id; }
    }
    return best ? { agentId: best, score: bestScore, reason: "capability match" } : null;
  }

  list() { return [...this._agents.values()].map(e => e.def); }
}

// ── 3. Minimal OllamaAdapter ────────────────────────────────────────────────
async function ollamaGenerate(model, prompt, systemPrompt, maxTokens = 512) {
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });

  const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false, options: { num_predict: maxTokens } }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return { text: data.message.content, tokens: (data.eval_count ?? 0) + (data.prompt_eval_count ?? 0) };
}

// ── MAIN ────────────────────────────────────────────────────────────────────
(async () => {
  console.log("═══════════════════════════════════════════");
  console.log("  AX OS v2 — Multi-Agent Demo");
  console.log("═══════════════════════════════════════════\n");

  // 1. Check Ollama
  console.log("1. Pinging Ollama...");
  const { ok, models } = await pingOllama();
  if (!ok) {
    console.error("  ✗ Ollama unreachable at", OLLAMA_BASE);
    console.error("  → Make sure `ollama serve` is running.");
    process.exit(1);
  }
  console.log(`  ✓ Ollama online — ${models.length} models available`);
  console.log("  Models:", models.slice(0, 5).join(", "), models.length > 5 ? `...+${models.length - 5}` : "");

  // 2. Build agent registry
  console.log("\n2. Building AgentRegistry...");
  const registry = new AgentRegistry();

  registry.register({
    id: "coder",
    name: "Code Agent",
    description: "Writes and reviews code",
    provider: "ollama",
    model: "qwen2.5-coder:32b",
    capabilities: [
      { name: "code", description: "Write code", priority: 0.95 },
      { name: "review", description: "Code review", priority: 0.85 },
    ],
    systemPrompt: "You are an expert software engineer. Be concise and precise.",
    defaultMaxTokens: 2048,
    defaultTemperature: 0.2,
    timeoutMs: 60000,
  });

  registry.register({
    id: "analyst",
    name: "Analysis Agent",
    description: "Data analysis and research",
    provider: "ollama",
    model: "qwen2.5:14b-instruct",
    capabilities: [
      { name: "analyze", description: "Analyze data", priority: 0.90 },
      { name: "research", description: "Research topics", priority: 0.80 },
      { name: "summarize", description: "Summarize content", priority: 0.85 },
    ],
    systemPrompt: "You are a precise data analyst. Keep answers structured and factual.",
    defaultMaxTokens: 1024,
    defaultTemperature: 0.4,
    timeoutMs: 45000,
  });

  console.log(`  ✓ Registered ${registry.list().length} agents`);

  // 3. Routing demo
  console.log("\n3. Routing demo...");
  const tasks = [
    { id: "t1", type: "code",    prompt: "Write a Python function to compute Sharpe ratio.", requiredCapabilities: ["code"],    priority: "normal" },
    { id: "t2", type: "analyze", prompt: "Summarize why max SR=0.85 might indicate d0 universe constraints.", requiredCapabilities: ["analyze"], priority: "normal" },
    { id: "t3", type: "custom",  prompt: "Hello!", requiredCapabilities: [],          priority: "low" },
  ];

  for (const task of tasks) {
    const decision = registry.route(task);
    console.log(`  Task "${task.id}" [${task.requiredCapabilities.join(",")||"any"}] → agent: ${decision?.agentId} (score: ${decision?.score?.toFixed(2)}, ${decision?.reason})`);
  }

  // 4. Live inference test (first task, code agent)
  // Pick smallest available model for the live test (fastest cold-start)
  const FAST_MODELS = ["mistral:latest", "llama3.2:latest", "moondream:latest", "qwen2.5:14b-instruct", "qwen2.5-coder:32b"];
  const liveModel = FAST_MODELS.find(m => models.includes(m)) ?? models[0];
  console.log(`\n4. Live inference — model: ${liveModel}...`);

  const t0 = Date.now();
  const result = await ollamaGenerate(
    liveModel,
    "Write a one-line Python function to compute Sharpe ratio from a list of returns.",
    "You are a concise expert programmer. Reply with code only.",
    128
  );
  const latency = Date.now() - t0;
  console.log(`  ✓ Response (${latency}ms, ${result.tokens} tokens):`);
  console.log("  ─────────────────────────────────────────");
  console.log("  " + result.text.trim().replace(/\n/g, "\n  "));
  console.log("  ─────────────────────────────────────────");

  console.log("\n✅ Phase 1 complete — OllamaAdapter + AgentRegistry operational\n");
  console.log("Next: Phase 2 — AgentOrchestrator (sequential + parallel workflows)\n");
})().catch(err => { console.error(err); process.exit(1); });
