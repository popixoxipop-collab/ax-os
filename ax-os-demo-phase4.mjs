/**
 * AX OS v2 — Phase 4: ReAct Loop Demo
 *
 * 에이전트가 툴 호출 순서를 스스로 결정한다.
 * 워크플로 YAML 없음 — LLM이 판단.
 *
 * Task: "BRAIN 알파 DB를 분석해서 SR≥1.25를 달성하기 위한
 *        가장 유망한 3가지 방향을 제안하라."
 *
 * Run: node ax-os-demo-phase4.mjs
 */

import { DatabaseSync } from "node:sqlite";

const OLLAMA_BASE = "http://localhost:11434";
const RESULTS_DB  = process.env.BRAIN_DB_PATH ?? "/Volumes/D50/brain_runtime/results.db";
const MEMORY_DB   = "/tmp/ax-os-memory.db";

// ─── Tool call parser ─────────────────────────────────────────────────────
function parseToolCalls(text) {
  const results = [];
  const re = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    try {
      const p = JSON.parse(m[1].trim());
      results.push({ name: p.name ?? p.tool ?? "", args: p.args ?? {}, raw: m[0] });
    } catch { /* skip */ }
  }
  return results;
}

function stripToolCalls(text) {
  return text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
}

function buildObservation(name, result, success) {
  const MAX = 1800;
  const body = success
    ? (result.length > MAX ? result.slice(0, MAX) + "\n...[truncated]" : result)
    : `ERROR — ${result}`;
  return `Observation [${name}]:\n${body}`;
}

// ─── SharedMemory ─────────────────────────────────────────────────────────
class SharedMemory {
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS ax_memory (namespace TEXT, key TEXT, value TEXT, created_at INTEGER, PRIMARY KEY(namespace,key))`);
  }
  set(ns, key, val) { this.db.prepare(`INSERT INTO ax_memory VALUES(?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value,created_at=excluded.created_at`).run(ns,key,String(val),Date.now()); }
  get(ns, key) { return this.db.prepare(`SELECT value FROM ax_memory WHERE namespace=? AND key=?`).get(ns,key)?.value ?? null; }
  list(ns) { return this.db.prepare(`SELECT key,value FROM ax_memory WHERE namespace=? ORDER BY created_at DESC`).all(ns); }
}

// ─── ToolRegistry ─────────────────────────────────────────────────────────
class ToolRegistry {
  constructor() { this._tools = new Map(); }
  register(t) { this._tools.set(t.name, t); }
  list() { return [...this._tools.values()]; }
  async execute(name, args, ctx) {
    const def = this._tools.get(name);
    if (!def) return { success: false, error: `unknown tool: ${name}`, serialized: "null" };
    const t0 = Date.now();
    try {
      const val = await def.execute(args, ctx);
      return { success: true, serialized: JSON.stringify(val, null, 2), latencyMs: Date.now()-t0 };
    } catch(e) {
      return { success: false, error: e.message, serialized: "null", latencyMs: Date.now()-t0 };
    }
  }
}

// ─── BRAIN tools ──────────────────────────────────────────────────────────
function registerBrainTools(registry, memory) {
  registry.register({
    name: "brain_query_stats",
    description: "Get overall BRAIN results.db statistics (total alphas, submittable count, sharpe distribution)",
    parameters: {},
    async execute() {
      const db = new DatabaseSync(RESULTS_DB, { readOnly: true });
      try {
        const total  = db.prepare(`SELECT COUNT(*) AS n FROM alphas`).get();
        const submit = db.prepare(`SELECT COUNT(*) AS n FROM alphas WHERE sharpe>=1.25 AND fitness>=1.0`).get();
        const sr     = db.prepare(`SELECT ROUND(AVG(sharpe),4) AS avg, ROUND(MIN(sharpe),4) AS min, ROUND(MAX(sharpe),4) AS max FROM alphas WHERE sharpe BETWEEN 0.3 AND 5`).get();
        const byNeut = db.prepare(`SELECT neutralization, COUNT(*) AS n, ROUND(AVG(sharpe),3) AS avg_sr FROM alphas WHERE sharpe BETWEEN 0.3 AND 5 GROUP BY neutralization ORDER BY avg_sr DESC`).all();
        return { totalAlphas: total.n, submittable: submit.n, sharpe: sr, byNeutralization: byNeut };
      } finally { db.close(); }
    },
  });

  registry.register({
    name: "brain_query_patterns",
    description: "Analyze which operators and fields appear most in high-sharpe alphas",
    parameters: {
      minSharpe: { type:"number", description:"Min sharpe threshold", required:false, default:0.9 },
      topN:      { type:"number", description:"Number of alphas to analyze", required:false, default:300 },
    },
    async execute({ minSharpe=0.9, topN=300 }) {
      const db = new DatabaseSync(RESULTS_DB, { readOnly: true });
      try {
        const rows = db.prepare(`SELECT expression, sharpe FROM alphas WHERE sharpe>=? AND sharpe<=5 AND expression IS NOT NULL ORDER BY sharpe DESC LIMIT ?`).all(minSharpe, topN);
        const opC={}, fC={};
        const OPS = /\b(ts_rank|ts_mean|ts_std_dev|ts_delta|ts_decay_linear|ts_corr|rank|sign|log|abs|zscore|winsorize|ts_backfill|ts_max|ts_min|vec_avg|scale)\b/g;
        const FLD = /\b(close|volume|returns|beta|enterprise_value|book_value|earnings|adv|vwap|open|high|low|bookvalue_ps|unsystematic_risk|quality|growth|fscore|snt1|operating_income|debt|cash|revenue)\b/g;
        for (const r of rows) {
          const e = r.expression ?? "";
          for (const m of e.matchAll(OPS)) opC[m[1]] = (opC[m[1]]??0)+1;
          for (const m of e.matchAll(FLD)) fC[m[1]]  = (fC[m[1]] ??0)+1;
        }
        return {
          analyzed: rows.length, minSharpe,
          topOps:    Object.entries(opC).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([op,n])=>({op,n})),
          topFields: Object.entries(fC).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([f,n])=>({field:f,n})),
        };
      } finally { db.close(); }
    },
  });

  registry.register({
    name: "brain_query_top_alphas",
    description: "Fetch top N alpha expressions sorted by Sharpe ratio",
    parameters: {
      limit:     { type:"number", description:"How many to return", required:false, default:15 },
      minSharpe: { type:"number", description:"Min sharpe",         required:false, default:1.0 },
    },
    async execute({ limit=15, minSharpe=1.0 }) {
      const db = new DatabaseSync(RESULTS_DB, { readOnly: true });
      try {
        return db.prepare(`SELECT expression, ROUND(sharpe,4) AS sharpe, ROUND(fitness,4) AS fitness, neutralization FROM alphas WHERE sharpe>=? AND sharpe<=5 ORDER BY sharpe DESC LIMIT ?`).all(minSharpe, limit);
      } finally { db.close(); }
    },
  });

  registry.register({
    name: "brain_query_expression_structure",
    description: "Analyze structural depth and operator combination patterns in top alphas",
    parameters: {
      minSharpe: { type:"number", description:"Min sharpe", required:false, default:1.1 },
      limit:     { type:"number", description:"Sample size",required:false, default:100 },
    },
    async execute({ minSharpe=1.1, limit=100 }) {
      const db = new DatabaseSync(RESULTS_DB, { readOnly: true });
      try {
        const rows = db.prepare(`SELECT expression, sharpe FROM alphas WHERE sharpe>=? AND sharpe<=5 AND expression IS NOT NULL ORDER BY sharpe DESC LIMIT ?`).all(minSharpe, limit);
        const patterns = rows.map(r => ({
          sharpe: r.sharpe,
          length: r.expression.length,
          depth: (r.expression.match(/\(/g)??[]).length,
          hasRank:     r.expression.includes("rank"),
          hasDecay:    r.expression.includes("decay"),
          hasTsCorr:   r.expression.includes("ts_corr"),
          hasSign:     r.expression.includes("sign"),
          hasTsRank:   r.expression.includes("ts_rank"),
          expression:  r.expression.slice(0, 120),
        }));
        const avgDepth = patterns.reduce((s,p)=>s+p.depth,0)/patterns.length;
        const withRank  = patterns.filter(p=>p.hasRank).length;
        const withDecay = patterns.filter(p=>p.hasDecay).length;
        return { analyzed: patterns.length, avgNestingDepth: avgDepth.toFixed(1), withRank, withDecay, samples: patterns.slice(0,8) };
      } finally { db.close(); }
    },
  });

  registry.register({
    name: "brain_load_prior_research",
    description: "Load prior agent findings from SharedMemory (brain namespace)",
    parameters: {},
    async execute() { return memory.list("brain"); },
  });

  registry.register({
    name: "brain_save_finding",
    description: "Save a key finding or recommendation to SharedMemory for future sessions",
    parameters: {
      key:   { type:"string", description:"Finding identifier",   required:true },
      value: { type:"string", description:"Finding content",      required:true },
    },
    async execute({ key, value }) { memory.set("brain", key, value); return { saved: true, key }; },
  });
}

// ─── Ollama multi-turn client ─────────────────────────────────────────────
function makeMultiTurnClient(model) {
  return {
    async generate({ messages, maxTokens=1024, temperature=0.35 }) {
      const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ model, messages, stream:false, options:{ num_predict:maxTokens, temperature } }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
      const d = await r.json();
      return { text: d.message.content, tokensUsed: (d.eval_count??0)+(d.prompt_eval_count??0) };
    },
  };
}

// ─── ReAct loop ───────────────────────────────────────────────────────────
async function reactLoop({ task, client, tools, memory, maxTurns=8, verbose=false }) {
  const toolList = tools.list();
  const toolDesc = toolList.map(t =>
    `• ${t.name}: ${t.description}\n` +
    Object.entries(t.parameters??{}).map(([k,p])=>`    ${k} (${p.type}${p.required ? "" : ", optional"}): ${p.description}`).join("\n")
  ).join("\n\n");

  const systemPrompt = `You are a reasoning and acting agent analyzing a WorldQuant BRAIN alpha search database.
Think step by step. Call tools to gather data, then reason about the results.

To call a tool, output EXACTLY:
<tool_call>{"name": "tool_name", "args": {"param": "value"}}</tool_call>

After each call you receive an Observation. Continue until you can give a final answer WITHOUT any <tool_call> tags.

Available tools:
${toolDesc}

Rules:
- Start with brain_query_stats to understand the overall picture
- Use brain_query_patterns to find what operators/fields work
- Use brain_query_top_alphas and brain_query_expression_structure for examples
- Check brain_load_prior_research for prior findings
- Save your final recommendations with brain_save_finding
- Final answer: 3 specific directions with concrete expression templates`;

  const messages = [
    { role:"system",    content: systemPrompt },
    { role:"user",      content: task },
  ];

  let totalTokens = 0, lastText = "", turn = 0;
  const ctx = { memory, agentId:"react-agent", workflowId:"brain-react", runId:`r_${Date.now().toString(36)}` };

  console.log(`\nReAct agent starting — max ${maxTurns} turns\n${"─".repeat(60)}`);

  while (turn < maxTurns) {
    const resp = await client.generate({ messages, maxTokens:900, temperature:0.35 });
    totalTokens += resp.tokensUsed;
    lastText = resp.text;
    turn++;

    const calls = parseToolCalls(resp.text);
    const preview = stripToolCalls(resp.text).slice(0, 160).replace(/\n/g," ");

    console.log(`\nTurn ${turn} — ${calls.length} tool call(s) | ${resp.tokensUsed}tok`);
    if (calls.length > 0)
      console.log(`  calls: ${calls.map(c=>`${c.name}(${JSON.stringify(c.args)})`).join(", ")}`);
    else
      console.log(`  [final answer] ${preview}...`);

    if (calls.length === 0) break;

    messages.push({ role:"assistant", content: resp.text });

    const observations = [];
    for (const call of calls) {
      process.stdout.write(`  🔧 ${call.name}... `);
      const t0 = Date.now();
      const result = await tools.execute(call.name, call.args, ctx);
      console.log(`${result.success ? "✓" : "✗"} (${Date.now()-t0}ms)`);
      observations.push(buildObservation(call.name, result.serialized, result.success));
    }

    messages.push({ role:"user", content: observations.join("\n\n") });
  }

  return { output: stripToolCalls(lastText), totalTokens, turns: turn };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────
(async () => {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  AX OS v2 — Phase 4: ReAct Loop");
  console.log("  LLM decides which tools to call and in what order");
  console.log("═══════════════════════════════════════════════════════════");

  // Model selection
  const { models } = await fetch(`${OLLAMA_BASE}/api/tags`).then(r=>r.json());
  const available = models.map(m=>m.name);
  const PREF = ["qwen2.5:14b-instruct","mistral:latest","llama3.2:latest","qwen2.5-coder:32b"];
  const model = PREF.find(m=>available.includes(m)) ?? available[0];
  console.log(`\nModel: ${model}`);

  // Setup
  const memory  = new SharedMemory(MEMORY_DB);
  const tools   = new ToolRegistry();
  registerBrainTools(tools, memory);
  const client  = makeMultiTurnClient(model);

  console.log(`Tools: ${tools.list().map(t=>t.name).join(", ")}`);

  // Load prior findings count
  const prior = memory.list("brain");
  console.log(`SharedMemory[brain]: ${prior.length} prior finding(s) available\n`);

  // ── The task — agent decides everything from here ─────────────────────
  const task = `Analyze the BRAIN alpha search database and propose the 3 most promising directions to achieve Sharpe Ratio ≥ 1.25.

For each direction provide:
1. The specific operator+field combination to focus on
2. A concrete alpha expression template
3. Why this is likely to work based on the data

Be specific — use actual field names and operator names from the database.`;

  const t0 = Date.now();
  const result = await reactLoop({
    task, client, tools, memory,
    maxTurns: 8,
    verbose: false,
  });
  const elapsed = ((Date.now()-t0)/1000).toFixed(1);

  // ── Output ─────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(61));
  console.log("FINAL ANSWER");
  console.log("═".repeat(61));
  console.log(result.output);

  console.log("\n" + "═".repeat(61));
  console.log("STATS");
  console.log("─".repeat(61));
  console.log(`Turns  : ${result.turns}`);
  console.log(`Tokens : ${result.totalTokens}`);
  console.log(`Time   : ${elapsed}s`);

  const saved = memory.list("brain");
  console.log(`\nSharedMemory[brain]: ${saved.length} finding(s) stored`);
  for (const f of saved) console.log(`  • ${f.key} (${f.value.length}ch)`);

  console.log("\n" + "═".repeat(61));
  console.log("✅ Phase 4 complete — ReAct loop operational");
  console.log("   LLM autonomously selected tools and reasoning path");
  console.log("═".repeat(61) + "\n");
})().catch(e => { console.error(e); process.exit(1); });
