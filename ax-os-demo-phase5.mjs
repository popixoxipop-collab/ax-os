/**
 * AX OS v2 — Phase 5: A2A (Agent-to-Agent) Delegation Demo
 *
 * 패턴:
 *   Planner (depth=0)
 *     → delegate_to_agent("analyst", ...)   (depth=1, ReAct loop)
 *     → delegate_to_agent("coder",   ...)   (depth=1, ReAct loop)
 *     → final synthesis
 *
 * Planner는 analyst/coder가 무엇을 하는지 모름.
 * analyst/coder는 자신의 ReAct 루프로 자율 탐색.
 *
 * Run: node ax-os-demo-phase5.mjs
 */

import { DatabaseSync } from "node:sqlite";

const OLLAMA_BASE = "http://localhost:11434";
const RESULTS_DB  = process.env.BRAIN_DB_PATH ?? "/Volumes/D50/brain_runtime/results.db";
const MEMORY_DB   = "/tmp/ax-os-memory.db";

// ─── Indent logger ────────────────────────────────────────────────────────
const DEPTH_COLORS = ["", "  ", "    "];
const DEPTH_ICONS  = ["🧠", "📊", "💻"];

function log(depth, msg) {
  const pad  = DEPTH_COLORS[depth] ?? "      ";
  const icon = depth === 0 ? "" : `${DEPTH_ICONS[depth] ?? "  "}`;
  console.log(`${pad}${icon} ${msg}`);
}

// ─── SharedMemory ─────────────────────────────────────────────────────────
class SharedMemory {
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS ax_memory(namespace TEXT, key TEXT, value TEXT, created_at INTEGER, PRIMARY KEY(namespace,key))`);
  }
  set(ns, k, v) { this.db.prepare(`INSERT INTO ax_memory VALUES(?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value,created_at=excluded.created_at`).run(ns,k,String(v),Date.now()); }
  get(ns, k) { return this.db.prepare(`SELECT value FROM ax_memory WHERE namespace=? AND key=?`).get(ns,k)?.value ?? null; }
  list(ns) { return this.db.prepare(`SELECT key,value FROM ax_memory WHERE namespace=? ORDER BY created_at DESC`).all(ns); }
}

// ─── ToolRegistry ─────────────────────────────────────────────────────────
class ToolRegistry {
  constructor() { this._tools = new Map(); }
  register(t)    { this._tools.set(t.name, t); }
  list()         { return [...this._tools.values()]; }
  has(name)      { return this._tools.has(name); }
  async execute(name, args, ctx) {
    const def = this._tools.get(name);
    if (!def) return { success:false, error:`unknown tool: ${name}`, serialized:"null", latencyMs:0 };
    const t0 = Date.now();
    try {
      const val = await def.execute(args, ctx);
      return { success:true, serialized:JSON.stringify(val,null,2), latencyMs:Date.now()-t0 };
    } catch(e) {
      return { success:false, error:e.message, serialized:"null", latencyMs:Date.now()-t0 };
    }
  }
}

// ─── ReAct loop (depth-aware) ─────────────────────────────────────────────
function parseToolCalls(text) {
  const res = [];
  // 1. closed tags: <tool_call>...</tool_call>
  const closed = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let m;
  while ((m = closed.exec(text)) !== null) {
    try { const p=JSON.parse(m[1].trim()); res.push({name:p.name??"",args:p.args??{},raw:m[0]}); } catch {}
  }
  if (res.length) return res;
  // 2. unclosed tags: <tool_call>{...} (model forgot closing tag)
  const unclosed = /<tool_call>(\{[\s\S]*?\})(?:<\/tool_call>|$|\n[^\{])/g;
  while ((m = unclosed.exec(text)) !== null) {
    try { const p=JSON.parse(m[1].trim()); res.push({name:p.name??"",args:p.args??{},raw:m[0]}); } catch {}
  }
  if (res.length) return res;
  // 3. bare JSON blocks with "name" key (last resort)
  const bare = /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"args"\s*:\s*(\{[^}]*\})\s*\}/g;
  while ((m = bare.exec(text)) !== null) {
    try { const args=JSON.parse(m[2]); res.push({name:m[1],args,raw:m[0]}); } catch {}
  }
  return res;
}
function stripToolCalls(text) { return text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g,"").trim(); }
function buildObservation(name,result,success) {
  const MAX=1600; const body=success?(result.length>MAX?result.slice(0,MAX)+"\n...[truncated]":result):`ERROR — ${result}`;
  return `Observation [${name}]:\n${body}`;
}

async function reactLoop({ agentId, task, systemPrompt, client, tools, memory, maxTurns=6, depth=0, workflowId }) {
  const toolDesc = tools.list().map(t=>{
    const params=Object.entries(t.parameters??{}).map(([k,p])=>`      ${k} (${p.type}${p.required?"":", opt"}): ${p.description}`).join("\n");
    return `  • ${t.name}: ${t.description}${params?"\n"+params:""}`;
  }).join("\n\n");

  const sys = systemPrompt ?? `You are ${agentId}, a specialist reasoning agent.
Use tools when you need data. Call ONE tool at a time.
Format: <tool_call>{"name":"tool_name","args":{"k":"v"}}</tool_call>
After each Observation, continue reasoning. When done, give final answer WITHOUT tool calls.

Tools:\n${toolDesc}`;

  const messages = [
    { role:"system",  content: sys },
    { role:"user",    content: task },
  ];

  let totalTokens=0, lastText="", turn=0;
  const ctx = { memory, agentId, workflowId, runId:`r_${Date.now().toString(36)}`, depth };

  log(depth, `[${agentId}] starting — max ${maxTurns} turns`);

  while(turn < maxTurns) {
    const resp = await client.generate({ messages, maxTokens:800, temperature:0.35 });
    totalTokens += resp.tokensUsed;
    lastText = resp.text;
    turn++;

    const calls = parseToolCalls(resp.text);
    if(calls.length > 0) {
      log(depth, `turn ${turn}: ${calls.map(c=>`${c.name}(${JSON.stringify(c.args).slice(0,60)})`).join(", ")} | ${resp.tokensUsed}tok`);
    } else {
      const preview = stripToolCalls(resp.text).slice(0,100).replace(/\n/g," ");
      log(depth, `turn ${turn}: ✅ final answer | ${resp.tokensUsed}tok`);
      log(depth, `"${preview}..."`);
    }

    if(calls.length === 0) break;
    messages.push({ role:"assistant", content:resp.text });

    const observations=[];
    for(const call of calls) {
      process.stdout.write(`${DEPTH_COLORS[depth]??""}  🔧 ${call.name}... `);
      const r = await tools.execute(call.name, call.args, ctx);
      console.log(`${r.success?"✓":"✗"} (${r.latencyMs}ms)`);
      observations.push(buildObservation(call.name, r.serialized, r.success));
    }
    messages.push({ role:"user", content:observations.join("\n\n") });
  }

  return { output:stripToolCalls(lastText), totalTokens, turns:turn };
}

// ─── delegate_to_agent tool factory ──────────────────────────────────────
function createDelegateTool({ registry, clients, baseTools, memory, maxDepth=3, maxTurns=6, depth=0, workflowId }) {
  return {
    name: "delegate_to_agent",
    description: `Spawn a child agent for a focused subtask. Available agents: ${[...registry.keys()].join(", ")}`,
    parameters: {
      agentId:  { type:"string", description:"Which agent to delegate to", required:true },
      task:     { type:"string", description:"Full task description",       required:true },
      maxTurns: { type:"number", description:"Max turns for child (default 6)", required:false, default:6 },
    },
    async execute({ agentId, task, maxTurns:turns=maxTurns }, ctx) {
      const agent  = registry.get(agentId);
      const client = clients.get(agentId);
      if(!agent || !client) return { error:`agent "${agentId}" not found`, output:"", success:false };

      log(depth+1, `──────────── DELEGATE: ${ctx.agentId} → ${agentId} ────────────`);
      log(depth+1, `task: "${String(task).slice(0,80)}..."`);

      // Child tool registry: base tools + delegate at next depth (if not at limit)
      const childTools = new ToolRegistry();
      for(const t of baseTools.list()) childTools.register(t);
      if(depth+1 < maxDepth) {
        childTools.register(createDelegateTool({ registry, clients, baseTools, memory, maxDepth, maxTurns, depth:depth+1, workflowId }));
      }

      const result = await reactLoop({
        agentId, task:String(task), systemPrompt:agent.systemPrompt,
        client, tools:childTools, memory,
        maxTurns:Number(turns), depth:depth+1, workflowId,
      });

      log(depth+1, `──────────── END DELEGATE [${agentId}] (${result.turns}t, ${result.totalTokens}tok) ────`);

      // Save delegation to memory
      memory.set("a2a", `${workflowId}:d${depth+1}:${agentId}:${Date.now().toString(36)}`,
        JSON.stringify({ parent:ctx.agentId, child:agentId, turns:result.turns, tokens:result.totalTokens, outputLen:result.output.length }));

      return { agentId, output:result.output, tokensUsed:result.totalTokens, success:true, depth:depth+1 };
    },
  };
}

// ─── BRAIN tools (shared base) ────────────────────────────────────────────
function makeBrainTools(memory) {
  const reg = new ToolRegistry();

  reg.register({ name:"brain_query_stats", description:"DB stats: total alphas, submittable count, neutralization breakdown", parameters:{},
    async execute() {
      const db=new DatabaseSync(RESULTS_DB,{readOnly:true});
      try {
        const total = db.prepare(`SELECT COUNT(*) AS n FROM alphas`).get();
        const sub   = db.prepare(`SELECT COUNT(*) AS n FROM alphas WHERE sharpe>=1.25 AND fitness>=1.0`).get();
        const sr    = db.prepare(`SELECT ROUND(AVG(sharpe),3) AS avg, ROUND(MIN(sharpe),3) AS min, ROUND(MAX(sharpe),3) AS max FROM alphas WHERE sharpe BETWEEN 0.3 AND 5`).get();
        const neut  = db.prepare(`SELECT neutralization, COUNT(*) AS n, ROUND(AVG(sharpe),3) AS avg_sr FROM alphas WHERE sharpe BETWEEN 0.3 AND 5 GROUP BY neutralization ORDER BY avg_sr DESC`).all();
        return { totalAlphas:total.n, submittable:sub.n, sharpe:sr, byNeutralization:neut };
      } finally { db.close(); }
    },
  });

  reg.register({ name:"brain_query_patterns", description:"Top operators and fields in high-sharpe alphas",
    parameters:{ minSharpe:{type:"number",description:"Min sharpe",required:false,default:1.0}, topN:{type:"number",description:"Sample size",required:false,default:200} },
    async execute({ minSharpe=1.0, topN=200 }) {
      const db=new DatabaseSync(RESULTS_DB,{readOnly:true});
      try {
        const rows=db.prepare(`SELECT expression,sharpe FROM alphas WHERE sharpe>=? AND sharpe<=5 AND expression IS NOT NULL ORDER BY sharpe DESC LIMIT ?`).all(minSharpe,topN);
        const oC={},fC={};
        for(const r of rows){
          const e=r.expression??"";
          for(const m of e.matchAll(/\b(ts_rank|ts_mean|ts_std_dev|ts_delta|ts_decay_linear|ts_corr|rank|sign|zscore|winsorize|ts_backfill|ts_max|ts_min)\b/g)) oC[m[1]]=(oC[m[1]]??0)+1;
          for(const m of e.matchAll(/\b(close|volume|returns|beta|enterprise_value|book_value|earnings|adv|vwap|open|high|low|bookvalue_ps|unsystematic_risk|operating_income|debt|cash|revenue|quality|growth|fscore)\b/g)) fC[m[1]]=(fC[m[1]]??0)+1;
        }
        return { analyzed:rows.length, topOps:Object.entries(oC).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([op,n])=>({op,n})), topFields:Object.entries(fC).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([f,n])=>({f,n})) };
      } finally { db.close(); }
    },
  });

  reg.register({ name:"brain_query_top_alphas", description:"Top N alpha expressions by sharpe",
    parameters:{ limit:{type:"number",description:"Count",required:false,default:10}, minSharpe:{type:"number",description:"Min sharpe",required:false,default:1.0} },
    async execute({ limit=10, minSharpe=1.0 }) {
      const db=new DatabaseSync(RESULTS_DB,{readOnly:true});
      try { return db.prepare(`SELECT expression,ROUND(sharpe,4) AS sharpe,ROUND(fitness,4) AS fitness,neutralization FROM alphas WHERE sharpe>=? AND sharpe<=5 ORDER BY sharpe DESC LIMIT ?`).all(minSharpe,limit); }
      finally { db.close(); }
    },
  });

  reg.register({ name:"brain_save_finding", description:"Save finding to SharedMemory for future sessions",
    parameters:{ key:{type:"string",description:"Key",required:true}, value:{type:"string",description:"Content",required:true} },
    async execute({ key, value }) { memory.set("brain",key,String(value)); return {saved:true,key}; },
  });

  return reg;
}

// ─── Ollama multi-turn client ─────────────────────────────────────────────
function makeClient(model) {
  return {
    model,
    async generate({ messages, maxTokens=800, temperature=0.4 }) {
      const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ model, messages, stream:false, options:{ num_predict:maxTokens, temperature } }),
        signal:AbortSignal.timeout(180_000),
      });
      if(!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
      const d = await r.json();
      return { text:d.message.content, tokensUsed:(d.eval_count??0)+(d.prompt_eval_count??0) };
    },
  };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────
(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  AX OS v2 — Phase 5: A2A Agent-to-Agent Delegation");
  console.log("  Planner(depth=0) → Analyst(depth=1) + Coder(depth=1)");
  console.log("═══════════════════════════════════════════════════════════════");

  // Model selection
  const { models } = await fetch(`${OLLAMA_BASE}/api/tags`).then(r=>r.json());
  const avail = models.map(m=>m.name);
  const PREF  = ["qwen2.5:14b-instruct","mistral:latest","llama3.2:latest","qwen2.5-coder:32b"];
  const model = PREF.find(m=>avail.includes(m)) ?? avail[0];
  console.log(`\nModel: ${model}\n`);

  const memory  = new SharedMemory(MEMORY_DB);
  const baseTools = makeBrainTools(memory);

  // Agent definitions
  const AGENTS = new Map([
    ["planner", {
      id:"planner",
      systemPrompt:`You are a strategic planner for WorldQuant BRAIN alpha research.
Decompose tasks and delegate to specialists using the EXACT tool call format below.

CRITICAL — all tool calls, including delegate_to_agent, MUST use this EXACT format:
<tool_call>{"name":"tool_name","args":{"key":"value"}}</tool_call>

Example — delegating to analyst:
<tool_call>{"name":"delegate_to_agent","args":{"agentId":"analyst","task":"Find the top operator+field patterns in alphas with sharpe >= 1.0"}}</tool_call>

Example — delegating to coder:
<tool_call>{"name":"delegate_to_agent","args":{"agentId":"coder","task":"Generate 3 alpha expressions using ts_decay_linear and operating_income. Analyst found: {{analyst_output}}"}}</tool_call>

After each Observation you will see the specialist's output. Use it to delegate further or synthesize.
When you have all specialist outputs, write your final RECOMMENDATION without any tool calls.`,
    }],
    ["analyst", {
      id:"analyst",
      systemPrompt:`You are a quantitative analyst specializing in alpha factor research.
You analyze data patterns, identify statistical regularities, and explain what works.
Be precise with field names and operator names.
Format tool calls as: <tool_call>{"name":"tool_name","args":{...}}</tool_call>`,
    }],
    ["coder", {
      id:"coder",
      systemPrompt:`You are an alpha expression engineer for WorldQuant BRAIN.
You translate research insights into concrete, valid BRAIN alpha expressions.
Use operators: ts_rank, ts_mean, ts_decay_linear, rank, sign, ts_corr, ts_std_dev, ts_delta.
Use fields: returns, close, volume, enterprise_value, operating_income, bookvalue_ps, beta.
Format tool calls as: <tool_call>{"name":"tool_name","args":{...}}</tool_call>`,
    }],
  ]);

  const CLIENTS = new Map([
    ["planner",  makeClient(model)],
    ["analyst",  makeClient(model)],
    ["coder",    makeClient(model)],
  ]);

  const workflowId = `wf_a2a_${Date.now().toString(36)}`;

  // Build root tools: base tools + delegate at depth=0
  const rootTools = new ToolRegistry();
  for(const t of baseTools.list()) rootTools.register(t);
  rootTools.register(createDelegateTool({
    registry: AGENTS,
    clients:  CLIENTS,
    baseTools,
    memory,
    maxDepth: 3,
    maxTurns: 6,
    depth: 0,
    workflowId,
  }));

  console.log(`Base tools : ${baseTools.list().map(t=>t.name).join(", ")}`);
  console.log(`Root tools : ${rootTools.list().map(t=>t.name).join(", ")}`);
  console.log(`Agents     : ${[...AGENTS.keys()].join(", ")}`);
  console.log(`Prior brain findings: ${memory.list("brain").length}`);
  console.log();

  // ── The planner task ───────────────────────────────────────────────────
  const plannerTask = `You are running a BRAIN alpha discovery session.
Goal: identify and recommend ONE ready-to-test alpha expression likely to achieve Sharpe Ratio >= 1.25.

Work through these steps:
1. Call brain_query_stats to understand the current database state
2. Delegate to the analyst agent to find which operator+field combinations appear most in high-sharpe alphas
3. Delegate to the coder agent, passing the analyst findings, to generate 3 concrete alpha expressions
4. Write a final RECOMMENDATION choosing the best expression and explaining why

Use the delegate_to_agent tool to involve specialist agents.
After all delegations complete, synthesize everything into a clear final recommendation.`;

  const t0 = Date.now();
  console.log("── Planner Agent starting ─────────────────────────────────────\n");

  const result = await reactLoop({
    agentId:      "planner",
    task:         plannerTask,
    systemPrompt: AGENTS.get("planner").systemPrompt,
    client:       CLIENTS.get("planner"),
    tools:        rootTools,
    memory,
    maxTurns:     8,
    depth:        0,
    workflowId,
  });

  const elapsed = ((Date.now()-t0)/1000).toFixed(1);

  // ── Results ─────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(63));
  console.log("PLANNER FINAL OUTPUT");
  console.log("═".repeat(63));
  console.log(result.output);

  console.log("\n" + "═".repeat(63));
  console.log("SESSION STATS");
  console.log("─".repeat(63));
  console.log(`Total time   : ${elapsed}s`);
  console.log(`Planner turns: ${result.turns}`);
  console.log(`Total tokens : ${result.totalTokens}`);

  const a2aLog = memory.list("a2a");
  console.log(`\nA2A delegation log (${a2aLog.length} entries):`);
  for(const e of a2aLog) {
    const d = JSON.parse(e.value);
    console.log(`  ${d.parent} → ${d.child} | turns=${d.turns}, tokens=${d.tokens}, outLen=${d.outputLen}ch`);
  }

  const brainFindings = memory.list("brain");
  console.log(`\nSharedMemory[brain]: ${brainFindings.length} finding(s)`);
  for(const f of brainFindings) console.log(`  • ${f.key} (${f.value.length}ch)`);

  console.log("\n" + "═".repeat(63));
  console.log("✅ Phase 5 complete — A2A hierarchical delegation working");
  console.log("   Planner autonomously spawned Analyst + Coder sub-agents");
  console.log("═".repeat(63) + "\n");
})().catch(e => { console.error(e); process.exit(1); });
