/**
 * AX OS v2 — Phase 3: SharedMemory + ToolRegistry + BRAIN Integration
 *
 * Workflow:
 *   [Tool] query_stats      — DB 통계 로드
 *   [Tool] query_patterns   — 상위 알파 패턴 분석
 *   [Tool] query_top_alphas — 상위 20개 알파 로드
 *   [Agent] pattern-analyst — 패턴 분석 + 개선 방향 도출
 *   [Agent] alpha-generator — 새 알파 표현식 아이디어 생성
 *   [Tool]  store_findings  — SharedMemory에 저장
 *   [Agent] report          — 최종 요약 보고서
 *
 * Run: node ax-os-demo-phase3.mjs
 */

import { DatabaseSync } from "node:sqlite";

const OLLAMA_BASE  = "http://localhost:11434";
const RESULTS_DB   = process.env.BRAIN_DB_PATH ?? "/Volumes/D50/brain_runtime/results.db";
const MEMORY_DB    = "/tmp/ax-os-memory.db";

// ─── SharedMemory (SQLite) ─────────────────────────────────────────────────
class SharedMemory {
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ax_memory (
        namespace TEXT NOT NULL,
        key       TEXT NOT NULL,
        value     TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, key)
      );
    `);
  }
  set(ns, key, value) {
    this.db.prepare(`INSERT INTO ax_memory VALUES (?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value, created_at=excluded.created_at`)
      .run(ns, key, String(value), Date.now());
  }
  get(ns, key) {
    const r = this.db.prepare(`SELECT value FROM ax_memory WHERE namespace=? AND key=?`).get(ns, key);
    return r?.value ?? null;
  }
  list(ns) {
    return this.db.prepare(`SELECT key, value FROM ax_memory WHERE namespace=? ORDER BY created_at DESC`).all(ns);
  }
  stats() {
    const n = this.db.prepare(`SELECT COUNT(*) as n FROM ax_memory`).get();
    const nss = this.db.prepare(`SELECT DISTINCT namespace FROM ax_memory`).all().map(r => r.namespace);
    return { total: n.n, namespaces: nss };
  }
}

// ─── ToolRegistry ──────────────────────────────────────────────────────────
class ToolRegistry {
  constructor() { this._tools = new Map(); }
  register(def) { this._tools.set(def.name, def); }
  async execute(call, ctx) {
    const def = this._tools.get(call.tool);
    if (!def) return { success: false, error: `tool "${call.tool}" not found`, serialized: "null", outputKey: call.outputKey };
    const t0 = Date.now();
    try {
      const value = await def.execute({ ...call.args }, ctx);
      const serialized = JSON.stringify(value, null, 2);
      return { success: true, value, serialized, outputKey: call.outputKey, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { success: false, error: e.message, serialized: "null", outputKey: call.outputKey, latencyMs: Date.now() - t0 };
    }
  }
}

// ─── BRAIN Tools ──────────────────────────────────────────────────────────
function makeBrainTools(memory) {
  const registry = new ToolRegistry();

  registry.register({
    name: "brain_query_stats",
    description: "DB overall stats",
    async execute() {
      const db = new DatabaseSync(RESULTS_DB, { readOnly: true });
      try {
        const total  = db.prepare(`SELECT COUNT(*) AS n FROM alphas`).get();
        const submit = db.prepare(`SELECT COUNT(*) AS n FROM alphas WHERE sharpe>=1.25 AND fitness>=1.0`).get();
        const recent = db.prepare(`SELECT COUNT(*) AS n FROM alphas WHERE created_at>=datetime('now','-1 day')`).get();
        const sr     = db.prepare(`SELECT ROUND(AVG(sharpe),4) AS avg, ROUND(MAX(sharpe),4) AS max FROM alphas WHERE sharpe BETWEEN 0.5 AND 5`).get();
        return { totalAlphas: total.n, submittable: submit.n, last24h: recent.n, sharpeAvg: sr.avg, sharpeMax: sr.max };
      } finally { db.close(); }
    },
  });

  registry.register({
    name: "brain_query_patterns",
    description: "Analyze operator/field frequency in top alphas",
    async execute({ topN = 300, minSharpe = 0.8, maxSharpe = 5.0 }) {
      const db = new DatabaseSync(RESULTS_DB, { readOnly: true });
      try {
        const rows = db.prepare(`SELECT expression, sharpe FROM alphas WHERE sharpe>=? AND sharpe<=? AND expression IS NOT NULL ORDER BY sharpe DESC LIMIT ?`).all(minSharpe, maxSharpe, topN);
        const opCount = {}, fieldCount = {};
        const OP_RE    = /\b(ts_rank|ts_mean|ts_std_dev|ts_delta|ts_decay_linear|ts_corr|rank|sign|log|abs|vec_avg|scale|zscore|winsorize|ts_backfill|ts_max|ts_min)\b/g;
        const FIELD_RE = /\b(close|volume|returns|beta|enterprise_value|book_value|earnings|adv|vwap|open|high|low|sharpe|volatility|turnover|market_cap|bookvalue_ps|unsystematic_risk|quality|growth|fscore|snt1)\b/g;
        for (const r of rows) {
          const e = r.expression ?? "";
          for (const m of e.matchAll(OP_RE))    opCount[m[1]]    = (opCount[m[1]] ?? 0) + 1;
          for (const m of e.matchAll(FIELD_RE)) fieldCount[m[1]] = (fieldCount[m[1]] ?? 0) + 1;
        }
        return {
          analyzed: rows.length,
          topOps:    Object.entries(opCount).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([op,n])=>({op,n})),
          topFields: Object.entries(fieldCount).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([f,n])=>({field:f,n})),
        };
      } finally { db.close(); }
    },
  });

  registry.register({
    name: "brain_query_top_alphas",
    description: "Top N alphas by sharpe",
    async execute({ limit = 20, minSharpe = 1.0, maxSharpe = 5.0 }) {
      const db = new DatabaseSync(RESULTS_DB, { readOnly: true });
      try {
        return db.prepare(`SELECT expression, ROUND(sharpe,4) AS sharpe, ROUND(fitness,4) AS fitness, neutralization FROM alphas WHERE sharpe>=? AND sharpe<=? ORDER BY sharpe DESC LIMIT ?`).all(minSharpe, maxSharpe, limit);
      } finally { db.close(); }
    },
  });

  registry.register({
    name: "brain_store_finding",
    description: "Store finding in SharedMemory",
    async execute({ key, value }) {
      memory.set("brain", key, value);
      return { stored: true, key };
    },
  });

  registry.register({
    name: "brain_load_findings",
    description: "Load prior findings",
    async execute() {
      return memory.list("brain");
    },
  });

  return registry;
}

// ─── Minimal AgentRegistry ────────────────────────────────────────────────
class AgentRegistry {
  constructor() { this._agents = new Map(); }
  register(def) { this._agents.set(def.id, { def, tasks:0, tokens:0, errors:0 }); }
  get(id) { return this._agents.get(id)?.def ?? null; }
  list() { return [...this._agents.values()].map(e => e.def); }
  route(task) {
    if (task.preferredAgentId && this._agents.has(task.preferredAgentId))
      return { selectedAgentId: task.preferredAgentId };
    let best = null, bs = -1;
    for (const [id, e] of this._agents) {
      const caps = task.requiredCapabilities ?? [];
      const s = caps.length === 0 ? 0.5
        : caps.reduce((sum,r) => sum + (e.def.capabilities.find(c=>c.name===r)?.priority??0),0) / caps.length;
      if (s > bs) { bs = s; best = id; }
    }
    return best ? { selectedAgentId: best } : null;
  }
  recordResult(r) { const e = this._agents.get(r.agentId); if(e){e.tasks++;e.tokens+=r.tokensUsed;if(!r.success)e.errors++;} }
}

// ─── Ollama client ────────────────────────────────────────────────────────
function makeOllamaClient(model, systemPrompt) {
  return {
    async generate(req) {
      const msgs = [];
      if (systemPrompt) msgs.push({ role:"system", content:systemPrompt });
      msgs.push({ role:"user", content:req.prompt });
      const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ model, messages:msgs, stream:false, options:{ num_predict: req.maxTokens??512, temperature: req.temperature??0.5 } }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
      const d = await r.json();
      return { text:d.message.content, tokensUsed:(d.eval_count??0)+(d.prompt_eval_count??0), finishReason:d.done_reason??"stop" };
    },
  };
}

// ─── Interpolation ────────────────────────────────────────────────────────
function interpolate(tpl, ctx) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] ?? `{{${k}}}`);
}

// ─── Phase 3 Orchestrator (with ToolRegistry + SharedMemory) ─────────────
class Phase3Orchestrator {
  constructor(registry, clients, tools, memory) {
    this.registry = registry;
    this.clients = clients;
    this.tools = tools;
    this.memory = memory;
    this.handlers = [];
  }
  on(fn) { this.handlers.push(fn); }
  emit(e) { this.handlers.forEach(h => h({ ...e, ts: Date.now() })); }

  async runPreTools(preTools, ctx, wfId, stepId) {
    if (!preTools?.length) return;
    for (const call of preTools) {
      this.emit({ type:"tool:start", wfId, stepId, tool: call.tool });
      const tr = await this.tools.execute(call, { memory: this.memory, agentId: "system", workflowId: wfId, runId: ctx._runId });
      if (tr.success) {
        ctx[call.outputKey] = tr.serialized;
        this.emit({ type:"tool:complete", wfId, stepId, tool: call.tool, latency: tr.latencyMs });
      } else {
        this.emit({ type:"tool:error", wfId, stepId, tool: call.tool, error: tr.error });
      }
    }
  }

  async runPostTools(postTools, ctx, wfId, stepId) {
    if (!postTools?.length) return;
    for (const call of postTools) {
      const resolvedArgs = Object.fromEntries(
        Object.entries(call.args).map(([k,v]) => [k, typeof v==="string" ? interpolate(v, ctx) : v])
      );
      const tr = await this.tools.execute({ ...call, args: resolvedArgs }, { memory: this.memory, agentId: "system", workflowId: wfId, runId: ctx._runId });
      if (tr.success) {
        ctx[call.outputKey] = tr.serialized;
        this.emit({ type:"tool:complete", wfId, stepId, tool: call.tool, latency: tr.latencyMs });
      }
    }
  }

  async runAgentStep(stepDef, ctx, wfId) {
    this.emit({ type:"step:start", wfId, id: stepDef.id });
    await this.runPreTools(stepDef.preTools, ctx, wfId, stepDef.id);

    const decision = this.registry.route({ preferredAgentId: stepDef.agentId, requiredCapabilities: stepDef.requiredCapabilities ?? [] });
    if (!decision) return { stepId: stepDef.id, agentId:"none", output:"", tokensUsed:0, latencyMs:0, success:false, error:"no agent" };

    const agent = this.registry.get(decision.selectedAgentId);
    const client = this.clients[agent.id];
    if (!client) return { stepId: stepDef.id, agentId: agent.id, output:"", tokensUsed:0, latencyMs:0, success:false, error:"no client" };

    const prompt = interpolate(stepDef.prompt, ctx);
    const t0 = Date.now();
    try {
      const resp = await client.generate({ prompt, maxTokens: stepDef.maxTokens??600, temperature: stepDef.temperature??0.5, topP:0.9 });
      const latencyMs = Date.now() - t0;
      const key = stepDef.outputKey ?? stepDef.id;
      ctx[key] = resp.text;
      this.registry.recordResult({ agentId: agent.id, tokensUsed: resp.tokensUsed, success: true });
      await this.runPostTools(stepDef.postTools, ctx, wfId, stepDef.id);
      this.emit({ type:"step:complete", wfId, id: stepDef.id, latency: latencyMs, tokens: resp.tokensUsed });
      return { stepId: stepDef.id, agentId: agent.id, output: resp.text, tokensUsed: resp.tokensUsed, latencyMs, success:true };
    } catch(e) {
      this.emit({ type:"step:error", wfId, id: stepDef.id, error: e.message });
      return { stepId: stepDef.id, agentId: agent.id, output:"", tokensUsed:0, latencyMs: Date.now()-t0, success:false, error: e.message };
    }
  }

  async run(workflow, vars = {}) {
    const runId = `run_${Date.now().toString(36)}`;
    const ctx = { ...vars, _runId: runId };
    const results = [];
    let totalTokens = 0;
    const t0 = Date.now();
    this.emit({ type:"workflow:start", wfId: workflow.id, runId });

    for (const step of workflow.steps) {
      if (step.kind === "agent") {
        const r = await this.runAgentStep(step, ctx, workflow.id);
        results.push(r); totalTokens += r.tokensUsed;
        if (!r.success && !step.continueOnError) break;
      } else if (step.kind === "parallel") {
        this.emit({ type:"parallel:start", wfId: workflow.id, id: step.id, count: step.steps.length });
        const pResults = await Promise.all(step.steps.map(s => this.runAgentStep(s, ctx, workflow.id)));
        pResults.forEach(r => { results.push(r); totalTokens += r.tokensUsed; });
        if (step.merge === "concat") ctx[step.id] = pResults.filter(r=>r.success).map(r=>r.output).join("\n\n---\n\n");
        this.emit({ type:"parallel:complete", wfId: workflow.id, id: step.id });
      }
    }

    this.emit({ type:"workflow:complete", wfId: workflow.id, runId, totalTokens });
    return { workflowId: workflow.id, runId, steps: results, context: { ...ctx }, totalTokens, totalLatencyMs: Date.now()-t0, success: results.every(r=>r.success) };
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────
(async () => {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  AX OS v2 — Phase 3: SharedMemory + Tools + BRAIN");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Models
  const tagsR = await fetch(`${OLLAMA_BASE}/api/tags`);
  const { models } = await tagsR.json();
  const available = models.map(m => m.name);
  const PREF = ["mistral:latest","qwen2.5:14b-instruct","llama3.2:latest","qwen2.5-coder:32b"];
  const model = PREF.find(m => available.includes(m)) ?? available[0];
  console.log(`Model: ${model}\n`);

  // SharedMemory
  const memory = new SharedMemory(MEMORY_DB);
  console.log(`SharedMemory: ${MEMORY_DB}`);

  // Tools
  const tools = makeBrainTools(memory);
  console.log("Tools registered: brain_query_stats, brain_query_patterns, brain_query_top_alphas, brain_store_finding, brain_load_findings\n");

  // Registry + clients
  const registry = new AgentRegistry();
  const SP_ANALYST   = "You are a quantitative finance expert. Analyze data concisely (max 200 words). Focus on actionable patterns.";
  const SP_GENERATOR = "You are a WorldQuant BRAIN alpha expression expert. Generate valid alpha expressions using ts_rank, ts_mean, ts_delta, rank, sign, returns, volume, close, beta, enterprise_value. Format: expression | expected_sharpe_range | rationale";
  const SP_REPORTER  = "You are a research lead. Write a concise executive summary (max 150 words) of findings and next actions.";

  registry.register({ id:"analyst",   model, capabilities:[{name:"analyze",priority:0.95},{name:"research",priority:0.85}], systemPrompt: SP_ANALYST,   defaultMaxTokens:500, defaultTemperature:0.4, timeoutMs:120000 });
  registry.register({ id:"generator", model, capabilities:[{name:"code",priority:0.90},{name:"generate",priority:0.95}],   systemPrompt: SP_GENERATOR, defaultMaxTokens:400, defaultTemperature:0.7, timeoutMs:120000 });
  registry.register({ id:"reporter",  model, capabilities:[{name:"summarize",priority:0.95}],                               systemPrompt: SP_REPORTER,  defaultMaxTokens:300, defaultTemperature:0.4, timeoutMs:120000 });

  const clients = {
    analyst:   makeOllamaClient(model, SP_ANALYST),
    generator: makeOllamaClient(model, SP_GENERATOR),
    reporter:  makeOllamaClient(model, SP_REPORTER),
  };

  // Orchestrator
  const orc = new Phase3Orchestrator(registry, clients, tools, memory);

  // Event logging
  orc.on(e => {
    const icons = { "workflow:start":"🚀","workflow:complete":"✅","step:start":"  ▶","step:complete":"  ✓","step:error":"  ✗","tool:start":"    🔧","tool:complete":"    ✓","tool:error":"    ✗","parallel:start":"  ⇉","parallel:complete":"  ⇉✓" };
    const icon = icons[e.type] ?? "  ·";
    const detail = e.latency ? ` (${e.latency}ms${e.tokens?`, ${e.tokens}tok`:""})` : e.count ? ` [×${e.count}]` : e.totalTokens ? ` [${e.totalTokens} tok total]` : e.error ? ` ERR: ${e.error}` : "";
    console.log(`${icon} [${e.type.padEnd(20)}] ${(e.tool??e.id??e.wfId).padEnd(28)}${detail}`);
  });

  // ── Workflow definition ──────────────────────────────────────────────────
  const workflow = {
    id: "brain-analysis-v1",
    name: "BRAIN Alpha Pattern Analysis",
    steps: [
      // Step 1: load DB stats + patterns via tools, then analyze
      {
        kind: "agent",
        id: "pattern-analysis",
        agentId: "analyst",
        requiredCapabilities: ["analyze"],
        preTools: [
          { tool: "brain_query_stats",    args: {},                                          outputKey: "db_stats"   },
          { tool: "brain_query_patterns", args: { topN:300, minSharpe:0.8, maxSharpe:5.0 }, outputKey: "patterns"   },
          { tool: "brain_query_top_alphas",args:{ limit:15, minSharpe:1.0, maxSharpe:5.0 }, outputKey: "top_alphas" },
        ],
        prompt: `You are analyzing a WorldQuant BRAIN alpha search database.

DB Statistics:
{{db_stats}}

Top operator/field patterns from ${300} high-sharpe alphas:
{{patterns}}

Top 15 alpha expressions (sharpe 1.0-5.0):
{{top_alphas}}

Analyze: what operators and fields consistently appear in high-sharpe alphas? What patterns distinguish SR>1.25 from SR<0.8? Keep it under 200 words.`,
        maxTokens: 400,
        outputKey: "pattern_analysis",
        postTools: [
          { tool:"brain_store_finding", args:{ key:"pattern_analysis_latest", value:"{{pattern_analysis}}" }, outputKey:"_stored1" },
        ],
      },

      // Step 2: parallel — generate new alpha ideas + check prior findings
      {
        kind: "parallel",
        id: "generation-phase",
        merge: "object",
        steps: [
          {
            kind: "agent",
            id: "alpha-ideas",
            agentId: "generator",
            requiredCapabilities: ["generate"],
            prompt: `Based on this pattern analysis of high-performing alphas:
{{pattern_analysis}}

Generate 5 NEW alpha expression ideas. Each must be a valid BRAIN expression.
Format each as:
expression | sharpe_est | rationale

Focus on combinations NOT seen in the current top alphas.`,
            maxTokens: 500,
            temperature: 0.75,
            outputKey: "alpha_ideas",
            postTools: [
              { tool:"brain_store_finding", args:{ key:"alpha_ideas_latest", value:"{{alpha_ideas}}" }, outputKey:"_stored2" },
            ],
          },
          {
            kind: "agent",
            id: "delay0-strategy",
            agentId: "analyst",
            requiredCapabilities: ["analyze"],
            preTools: [
              { tool:"brain_query_top_alphas", args:{ limit:10, minSharpe:0.5, maxSharpe:2.0 }, outputKey:"delay0_candidates" },
            ],
            prompt: `DB stats: {{db_stats}}
Current best alphas: {{delay0_candidates}}
Pattern analysis: {{pattern_analysis}}

The current pipeline has max SR=0.85 at delay=0 (d0 universe is narrower — many fields blocked).
Suggest 3 specific strategies to improve d0Score performance. Be concrete (field names, operator combos).`,
            maxTokens: 350,
            outputKey: "delay0_strategy",
          },
        ],
      },

      // Step 3: final report
      {
        kind: "agent",
        id: "final-report",
        agentId: "reporter",
        requiredCapabilities: ["summarize"],
        prompt: `Write a concise executive summary (max 150 words) of this BRAIN alpha research session:

Pattern Analysis:
{{pattern_analysis}}

New Alpha Ideas:
{{alpha_ideas}}

Delay=0 Strategy:
{{delay0_strategy}}

Include: key findings, top 2 alpha ideas to test, and immediate next action.`,
        maxTokens: 300,
        outputKey: "final_report",
        postTools: [
          { tool:"brain_store_finding", args:{ key:`report_${new Date().toISOString().slice(0,10)}`, value:"{{final_report}}" }, outputKey:"_stored_report" },
        ],
      },
    ],
  };

  // ── Run ──────────────────────────────────────────────────────────────────
  console.log("Running workflow: brain-analysis-v1\n");
  const result = await orc.run(workflow);

  // ── Print results ────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(61));
  console.log("RESULTS");
  console.log("═".repeat(61));
  console.log(`Run ID   : ${result.runId}`);
  console.log(`Success  : ${result.success}`);
  console.log(`Steps    : ${result.steps.length} (${result.steps.filter(s=>s.success).length} ok)`);
  console.log(`Tokens   : ${result.totalTokens}`);
  console.log(`Latency  : ${(result.totalLatencyMs/1000).toFixed(1)}s`);

  const sections = [
    { key:"pattern_analysis", label:"📊 Pattern Analysis" },
    { key:"alpha_ideas",      label:"💡 New Alpha Ideas" },
    { key:"delay0_strategy",  label:"🎯 delay=0 Strategy" },
    { key:"final_report",     label:"📋 Final Report" },
  ];
  for (const { key, label } of sections) {
    if (result.context[key]) {
      console.log(`\n${label}:`);
      console.log("─".repeat(61));
      console.log(result.context[key].trim());
    }
  }

  // ── SharedMemory stats ───────────────────────────────────────────────────
  const memStats = memory.stats();
  const findings = memory.list("brain");
  console.log("\n" + "═".repeat(61));
  console.log("📦 SharedMemory");
  console.log("─".repeat(61));
  console.log(`Namespaces: ${memStats.namespaces.join(", ")}`);
  console.log(`Total entries: ${memStats.total}`);
  console.log("Stored keys:");
  for (const f of findings) console.log(`  brain::${f.key} (${f.value.length} chars)`);

  // ── Agent stats ──────────────────────────────────────────────────────────
  console.log("\n📡 Agent Stats:");
  for (const a of registry.list()) {
    const e = registry._agents.get(a.id);
    console.log(`  ${a.id.padEnd(12)}: tasks=${e.tasks}, tokens=${e.tokens}, errors=${e.errors}`);
  }

  console.log("\n" + "═".repeat(61));
  console.log("✅ Phase 3 complete");
  console.log("   SharedMemory + ToolRegistry + BRAIN DB 연동 완료");
  console.log("   인사이트가 SharedMemory(brain namespace)에 영속 저장됨");
  console.log("═".repeat(61) + "\n");
})().catch(e => { console.error(e); process.exit(1); });
