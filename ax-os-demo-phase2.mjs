/**
 * AX OS v2 — Phase 2 Demo: AgentOrchestrator
 *
 * Workflow: planner → [researcher‖analyst] → synthesizer
 * (sequential step, then parallel group, then sequential step)
 *
 * Run: node ax-os-demo-phase2.mjs
 */

const OLLAMA_BASE = "http://localhost:11434";

// ─── Minimal inline registry (same as Phase 1) ────────────────────────────
class AgentRegistry {
  constructor() { this._agents = new Map(); }
  register(def) { this._agents.set(def.id, { def, tasks: 0, tokens: 0, errors: 0 }); }
  get(id) { return this._agents.get(id)?.def ?? null; }
  list() { return [...this._agents.values()].map(e => e.def); }
  route(task) {
    if (task.preferredAgentId && this._agents.has(task.preferredAgentId))
      return { selectedAgentId: task.preferredAgentId, score: 1.0, reason: "explicit" };
    let best = null, bestScore = -1;
    for (const [id, e] of this._agents) {
      const caps = task.requiredCapabilities ?? [];
      const score = caps.length === 0 ? 0.5
        : caps.reduce((s, r) => s + (e.def.capabilities.find(c => c.name === r)?.priority ?? 0), 0) / caps.length;
      if (score > bestScore) { bestScore = score; best = id; }
    }
    return best ? { selectedAgentId: best, score: bestScore, reason: "capability" } : null;
  }
  recordResult(r) {
    const e = this._agents.get(r.agentId); if (!e) return;
    e.tasks++; e.tokens += r.tokensUsed; if (!r.success) e.errors++;
  }
}

// ─── Ollama LLM client ────────────────────────────────────────────────────
function makeOllamaClient(model, systemPrompt) {
  return {
    async generate(req) {
      const msgs = [];
      if (systemPrompt) msgs.push({ role: "system", content: systemPrompt });
      msgs.push({ role: "user", content: req.prompt });
      const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: msgs,
          stream: false,
          options: { num_predict: req.maxTokens ?? 512, temperature: req.temperature ?? 0.6 },
        }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
      const d = await r.json();
      return { text: d.message.content, tokensUsed: (d.eval_count ?? 0) + (d.prompt_eval_count ?? 0), finishReason: d.done_reason ?? "stop" };
    },
    getTokenCount: t => Math.ceil(t.length / 4),
  };
}

// ─── Inline orchestrator ──────────────────────────────────────────────────
function interpolate(tpl, ctx) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] ?? `{{${k}}}`);
}

class AgentOrchestrator {
  constructor(registry, clients) {
    this.registry = registry;
    this.clients = clients;
    this.handlers = [];
  }
  on(fn) { this.handlers.push(fn); }
  emit(e) { this.handlers.forEach(h => h({ ...e, ts: Date.now() })); }

  async runStep(step, ctx, wfId) {
    this.emit({ type: "step:start", wfId, id: step.id });
    const decision = this.registry.route({ id: step.id, preferredAgentId: step.agentId, requiredCapabilities: step.requiredCapabilities ?? [] });
    if (!decision) return { stepId: step.id, agentId: "none", output: "", tokensUsed: 0, latencyMs: 0, success: false, error: "no agent" };

    const agent = this.registry.get(decision.selectedAgentId);
    const client = this.clients[agent.id];
    if (!client) return { stepId: step.id, agentId: agent.id, output: "", tokensUsed: 0, latencyMs: 0, success: false, error: `no client for ${agent.id}` };

    const prompt = interpolate(step.prompt, ctx);
    const t0 = Date.now();
    try {
      const resp = await client.generate({ prompt, maxTokens: step.maxTokens ?? 512, temperature: step.temperature ?? 0.6, topP: 0.9 });
      const result = { stepId: step.id, agentId: agent.id, output: resp.text, tokensUsed: resp.tokensUsed, latencyMs: Date.now() - t0, success: true };
      this.registry.recordResult({ agentId: agent.id, tokensUsed: resp.tokensUsed, success: true });
      this.emit({ type: "step:complete", wfId, id: step.id, latency: result.latencyMs, tokens: result.tokensUsed });
      return result;
    } catch (err) {
      this.emit({ type: "step:error", wfId, id: step.id, error: err.message });
      return { stepId: step.id, agentId: agent.id, output: "", tokensUsed: 0, latencyMs: Date.now() - t0, success: false, error: err.message };
    }
  }

  async run(workflow, vars = {}) {
    const ctx = { ...vars };
    const allResults = [];
    let totalTokens = 0;
    const runId = `run_${Date.now().toString(36)}`;
    this.emit({ type: "workflow:start", wfId: workflow.id, runId });
    const t0 = Date.now();

    for (const stepDef of workflow.steps) {
      if (stepDef.kind === "agent") {
        const r = await this.runStep(stepDef, ctx, workflow.id);
        allResults.push(r);
        totalTokens += r.tokensUsed;
        if (r.success) ctx[stepDef.outputKey ?? stepDef.id] = r.output;
        else if (!stepDef.continueOnError) { this.emit({ type: "workflow:error", wfId: workflow.id }); break; }

      } else if (stepDef.kind === "parallel") {
        this.emit({ type: "parallel:start", wfId: workflow.id, id: stepDef.id, count: stepDef.steps.length });
        const results = await Promise.all(stepDef.steps.map(s => this.runStep(s, ctx, workflow.id)));
        results.forEach(r => { allResults.push(r); totalTokens += r.tokensUsed; });
        // merge into context
        if (stepDef.merge === "concat") {
          ctx[stepDef.id] = results.filter(r => r.success).map(r => r.output).join("\n\n---\n\n");
        } else {
          results.forEach((r, i) => { if (r.success) ctx[stepDef.steps[i].outputKey ?? stepDef.steps[i].id] = r.output; });
        }
        this.emit({ type: "parallel:complete", wfId: workflow.id, id: stepDef.id });
      }
    }

    this.emit({ type: "workflow:complete", wfId: workflow.id, runId, totalTokens });
    return { workflowId: workflow.id, runId, steps: allResults, context: { ...ctx }, totalTokens, totalLatencyMs: Date.now() - t0, success: allResults.every(r => r.success) };
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────
(async () => {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  AX OS v2 — Phase 2: AgentOrchestrator");
  console.log("  Workflow: planner → [researcher ‖ analyst] → synth");
  console.log("═══════════════════════════════════════════════════════\n");

  // Pick available models
  const tagsR = await fetch(`${OLLAMA_BASE}/api/tags`);
  const { models } = await tagsR.json();
  const available = models.map(m => m.name);

  const PREF = ["mistral:latest", "qwen2.5:14b-instruct", "llama3.2:latest", "qwen2.5-coder:32b"];
  const pick = (role) => PREF.find(m => available.includes(m)) ?? available[0];

  const PLANNER_MODEL   = pick("planner");
  const RESEARCH_MODEL  = pick("researcher");
  const ANALYST_MODEL   = pick("analyst");
  const SYNTH_MODEL     = pick("synth");

  console.log(`Models selected:`);
  console.log(`  planner   → ${PLANNER_MODEL}`);
  console.log(`  researcher→ ${RESEARCH_MODEL}`);
  console.log(`  analyst   → ${ANALYST_MODEL}`);
  console.log(`  synth     → ${SYNTH_MODEL}`);

  // ── Registry ──────────────────────────────────────────────────────────────
  const registry = new AgentRegistry();
  registry.register({ id: "planner",    model: PLANNER_MODEL,  provider: "ollama", capabilities: [{ name: "plan", priority: 0.95 }], systemPrompt: "You create concise research plans. Be brief (3-5 bullet points max).", defaultMaxTokens: 300, defaultTemperature: 0.5, timeoutMs: 60000 });
  registry.register({ id: "researcher", model: RESEARCH_MODEL, provider: "ollama", capabilities: [{ name: "research", priority: 0.90 }], systemPrompt: "You are a financial researcher. Give 2-3 key findings about the topic. Be factual and brief.", defaultMaxTokens: 400, defaultTemperature: 0.4, timeoutMs: 60000 });
  registry.register({ id: "analyst",    model: ANALYST_MODEL,  provider: "ollama", capabilities: [{ name: "analyze", priority: 0.90 }], systemPrompt: "You are a quantitative analyst. Analyze the data briefly (2-3 insights). Be precise.", defaultMaxTokens: 400, defaultTemperature: 0.4, timeoutMs: 60000 });
  registry.register({ id: "synth",      model: SYNTH_MODEL,    provider: "ollama", capabilities: [{ name: "summarize", priority: 0.90 }], systemPrompt: "You synthesize research findings into a brief, actionable summary (max 150 words).", defaultMaxTokens: 300, defaultTemperature: 0.5, timeoutMs: 60000 });

  // ── Clients ───────────────────────────────────────────────────────────────
  const clients = {
    planner:    makeOllamaClient(PLANNER_MODEL,   "You create concise research plans. Be brief (3-5 bullet points max)."),
    researcher: makeOllamaClient(RESEARCH_MODEL,  "You are a financial researcher. Give 2-3 key findings. Be factual and brief."),
    analyst:    makeOllamaClient(ANALYST_MODEL,   "You are a quantitative analyst. Give 2-3 insights. Be precise."),
    synth:      makeOllamaClient(SYNTH_MODEL,     "You synthesize research into a brief, actionable summary (max 150 words)."),
  };

  // ── Orchestrator + event logging ──────────────────────────────────────────
  const orc = new AgentOrchestrator(registry, clients);
  orc.on(e => {
    const icons = { "workflow:start": "🚀", "workflow:complete": "✅", "workflow:error": "❌", "step:start": "  ▶", "step:complete": "  ✓", "step:error": "  ✗", "parallel:start": "  ⇉", "parallel:complete": "  ⇉✓" };
    const icon = icons[e.type] ?? "  ·";
    const detail = e.latency ? ` (${e.latency}ms, ${e.tokens}tok)` : e.count ? ` [${e.count} parallel]` : e.totalTokens ? ` [${e.totalTokens} total tokens]` : e.error ? ` ERROR: ${e.error}` : "";
    console.log(`${icon} [${e.type}] ${e.id ?? e.wfId}${detail}`);
  });

  // ── Workflow definition ───────────────────────────────────────────────────
  const workflow = {
    id: "alpha-research",
    name: "Alpha Factor Research Workflow",
    timeoutMs: 600_000,
    steps: [
      {
        kind: "agent",
        id: "plan",
        agentId: "planner",
        requiredCapabilities: ["plan"],
        prompt: "Create a brief research plan (3 bullet points) for finding alpha factors related to: {{topic}}",
        maxTokens: 200,
        outputKey: "plan",
      },
      {
        kind: "parallel",
        id: "research-phase",
        merge: "object",
        steps: [
          {
            kind: "agent",
            id: "research-momentum",
            agentId: "researcher",
            requiredCapabilities: ["research"],
            prompt: "Based on this plan:\n{{plan}}\n\nResearch: what does academic literature say about momentum factors for {{topic}}? 2-3 key findings.",
            maxTokens: 300,
            outputKey: "momentum_findings",
          },
          {
            kind: "agent",
            id: "research-value",
            agentId: "analyst",
            requiredCapabilities: ["analyze"],
            prompt: "Based on this plan:\n{{plan}}\n\nAnalyze: what value/fundamental factors are relevant for {{topic}}? 2-3 quantitative insights.",
            maxTokens: 300,
            outputKey: "value_findings",
          },
        ],
      },
      {
        kind: "agent",
        id: "synthesize",
        agentId: "synth",
        requiredCapabilities: ["summarize"],
        prompt: "Synthesize these research findings into actionable alpha factor ideas (max 150 words):\n\nMomentum research:\n{{momentum_findings}}\n\nValue/fundamental analysis:\n{{value_findings}}",
        maxTokens: 200,
        outputKey: "final_synthesis",
      },
    ],
  };

  // ── Run ───────────────────────────────────────────────────────────────────
  console.log("\nRunning workflow: alpha-research");
  console.log(`Topic: US small-cap equities\n`);

  const result = await orc.run(workflow, { topic: "US small-cap equities" });

  // ── Results ───────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(57));
  console.log("WORKFLOW RESULTS");
  console.log("═".repeat(57));
  console.log(`Run ID   : ${result.runId}`);
  console.log(`Success  : ${result.success}`);
  console.log(`Steps    : ${result.steps.length} (${result.steps.filter(s => s.success).length} succeeded)`);
  console.log(`Tokens   : ${result.totalTokens}`);
  console.log(`Latency  : ${(result.totalLatencyMs / 1000).toFixed(1)}s`);

  const outputs = [
    { key: "plan",             label: "📋 Plan" },
    { key: "momentum_findings",label: "📊 Momentum Research" },
    { key: "value_findings",   label: "📈 Value Analysis" },
    { key: "final_synthesis",  label: "🎯 Final Synthesis" },
  ];

  for (const { key, label } of outputs) {
    if (result.context[key]) {
      console.log(`\n${label}:`);
      console.log("─".repeat(57));
      console.log(result.context[key].trim());
    }
  }

  console.log("\n" + "═".repeat(57));
  console.log("✅ Phase 2 complete — AgentOrchestrator operational");
  console.log("   Sequential + Parallel workflows running on local models");
  console.log("═".repeat(57) + "\n");

  // Agent stats
  console.log("Agent stats:");
  for (const agent of registry.list()) {
    const e = registry._agents.get(agent.id);
    console.log(`  ${agent.id}: tasks=${e.tasks}, tokens=${e.tokens}, errors=${e.errors}`);
  }
})().catch(err => { console.error(err); process.exit(1); });
