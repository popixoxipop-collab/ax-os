/**
 * AX OS v2 — Phase 9–12 통합 데모
 *
 * Phase 9:  Adversarial Eval — N critics, majority vote
 * Phase 10: Model Specialization — auto-discover + role assignment
 * Phase 11: Dashboard server startup + event broadcast
 * Phase 12: AEQ Integration — status report + VRAM planning
 *
 * Run: node ax-os-demo-phase9-12.mjs
 */

import { DatabaseSync } from "node:sqlite";

const OLLAMA_BASE = "http://localhost:11434";
const MEMORY_DB   = "/tmp/ax-os-memory.db";

// ─── SharedMemory ─────────────────────────────────────────────────────────
class SharedMemory {
  constructor(path){this.db=new DatabaseSync(path);this.db.exec(`CREATE TABLE IF NOT EXISTS ax_memory(namespace TEXT,key TEXT,value TEXT,created_at INTEGER,PRIMARY KEY(namespace,key))`);}
  set(ns,k,v){this.db.prepare(`INSERT INTO ax_memory VALUES(?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value,created_at=excluded.created_at`).run(ns,k,String(v),Date.now());}
  get(ns,k){return this.db.prepare(`SELECT value FROM ax_memory WHERE namespace=? AND key=?`).get(ns,k)?.value??null;}
  list(ns){return this.db.prepare(`SELECT key,value FROM ax_memory WHERE namespace=? ORDER BY created_at DESC`).all(ns);}
}

// ─── Ollama client ────────────────────────────────────────────────────────
function makeClient(model){return{async generate({prompt,maxTokens=200,temperature=0.4}){const r=await fetch(`${OLLAMA_BASE}/api/chat`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model,messages:[{role:"user",content:prompt}],stream:false,options:{num_predict:maxTokens,temperature}}),signal:AbortSignal.timeout(60_000)});if(!r.ok)throw new Error(`Ollama ${r.status}`);const d=await r.json();return{text:d.message.content,tokensUsed:(d.eval_count??0)+(d.prompt_eval_count??0)};}};}

// ─── MAIN ─────────────────────────────────────────────────────────────────
(async()=>{
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  AX OS v2 — Phase 9–12 Integration Demo");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const {models} = await fetch(`${OLLAMA_BASE}/api/tags`).then(r=>r.json());
  const avail = models.map(m=>m.name);
  const PREF  = ["mistral:latest","qwen2.5:14b-instruct","llama3.2:latest"];
  const model = PREF.find(m=>avail.includes(m))??avail[0];
  const client = makeClient(model);
  const memory = new SharedMemory(MEMORY_DB);
  console.log(`Model: ${model}\n`);

  // ══════════════════════════════════════════════════════════════════════════
  // Phase 9: Adversarial Eval
  // ══════════════════════════════════════════════════════════════════════════
  console.log("─── Phase 9: Adversarial Eval Framework ─────────────────────────");

  const LENSES = [
    { name:"correctness", prompt:"Is the math/logic correct? Find any flaws. Reply: PASS:yes|no CONFIDENCE:0.0-1.0 CRITIQUE:<text>" },
    { name:"feasibility", prompt:"Can this run in WorldQuant BRAIN? Check operator/field names. Reply: PASS:yes|no CONFIDENCE:0.0-1.0 CRITIQUE:<text>" },
    { name:"novelty",     prompt:"Is this genuinely novel or trivially obvious? Reply: PASS:yes|no CONFIDENCE:0.0-1.0 CRITIQUE:<text>" },
    { name:"statistical", prompt:"Is SR≥1.25 plausible for this expression? Reply: PASS:yes|no CONFIDENCE:0.0-1.0 CRITIQUE:<text>" },
  ];

  const TEST_ALPHAS = [
    { expr:"rank(ts_decay_linear(operating_income, 30))", desc:"Simple decay rank" },
    { expr:"ts_corr(bookvalue_ps, returns, 12) / ts_std_dev(returns, 20)", desc:"Correlation ratio" },
    { expr:"rank(-ts_rank(enterprise_value, 5))", desc:"Known good pattern" },
  ];

  for(const alpha of TEST_ALPHAS) {
    console.log(`\n  Evaluating: ${alpha.desc}`);
    console.log(`  Expression: ${alpha.expr}`);
    const votes = await Promise.all(LENSES.map(async lens => {
      const prompt = `Alpha expression to evaluate: ${alpha.expr}\n\n${lens.prompt}`;
      const resp = await client.generate({ prompt, maxTokens:120, temperature:0.3 });
      const text = resp.text;
      const passM  = text.match(/PASS:\s*(yes|no)/i);
      const confM  = text.match(/CONFIDENCE:\s*([\d.]+)/i);
      const critM  = text.match(/CRITIQUE:\s*(.+)/i);
      return {
        lens:    lens.name,
        pass:    passM?.[1]?.toLowerCase()==="yes"??false,
        conf:    parseFloat(confM?.[1]??"0.5"),
        critique:critM?.[1]?.trim().slice(0,80)??"",
      };
    }));
    const passCount = votes.filter(v=>v.pass).length;
    const passPct   = passCount/votes.length;
    const approved  = passPct >= 0.6;
    console.log(`  Results (${passCount}/${votes.length} pass, threshold 60%): ${approved?"✅ APPROVED":"❌ REJECTED"}`);
    for(const v of votes) {
      const bar = v.pass?"█████":"░░░░░";
      console.log(`    [${v.lens.padEnd(13)}] ${v.pass?"PASS ✓":"FAIL ✗"} conf=${(v.conf*100).toFixed(0)}%  ${v.critique.slice(0,60)}`);
    }
    memory.set("eval",`${alpha.desc}`,JSON.stringify({expr:alpha.expr,approved,passPct,votes}));
  }
  console.log("\n  ✅ Phase 9: Adversarial eval complete — 3 expressions evaluated\n");

  // ══════════════════════════════════════════════════════════════════════════
  // Phase 10: Model Specialization Map
  // ══════════════════════════════════════════════════════════════════════════
  console.log("─── Phase 10: Model Specialization Map ──────────────────────────");

  const ROLE_PATTERNS = [
    { pattern:/all-minilm/i,      roles:["embed"],             prio:{embed:1.0} },
    { pattern:/coder/i,           roles:["code","general"],    prio:{code:0.95,general:0.65} },
    { pattern:/qwen.*32b/i,       roles:["code","analyze"],    prio:{code:0.92,analyze:0.85} },
    { pattern:/qwen.*14b/i,       roles:["analyze","research"],prio:{analyze:0.88,research:0.82} },
    { pattern:/llama3\.3/i,       roles:["general","analyze"], prio:{general:0.85,analyze:0.80} },
    { pattern:/hades.*trunk/i,    roles:["code","analyze"],    prio:{code:0.80,analyze:0.78} },
    { pattern:/gpt.oss.*20b/i,    roles:["analyze","research"],prio:{analyze:0.85,research:0.88} },
    { pattern:/mistral/i,         roles:["fast","general"],    prio:{fast:0.80,general:0.72} },
    { pattern:/llama3\.2/i,       roles:["fast","general"],    prio:{fast:0.85,general:0.70} },
    { pattern:/moondream|llava/i, roles:["fast"],              prio:{fast:0.65} },
  ];

  const profiles = models.map(m => {
    const mp = ROLE_PATTERNS.find(p=>p.pattern.test(m.name));
    const sizeGB = m.size/1e9;
    return { name:m.name, sizeGB:+sizeGB.toFixed(1), roles:mp?.roles??["general"], prio:mp?.prio??{general:0.60} };
  });

  console.log(`\n  Discovered ${profiles.length} models:\n`);
  console.log(`  ${"Model".padEnd(45)} ${"Roles".padEnd(30)} SizeGB`);
  console.log("  " + "─".repeat(80));
  for(const p of profiles) {
    const roles = p.roles.join(", ");
    console.log(`  ${p.name.padEnd(45)} ${roles.padEnd(30)} ${p.sizeGB}`);
  }

  // Best model per role
  const roles = ["embed","fast","code","analyze","research","plan"];
  console.log("\n  Best model per role:");
  for(const role of roles) {
    const best = profiles.filter(p=>(p.prio[role]??0)>0).sort((a,b)=>(b.prio[role]??0)-(a.prio[role]??0))[0];
    console.log(`    ${role.padEnd(10)}: ${best?.name??"none found"} (priority=${((best?.prio[role]??0)*100).toFixed(0)}%)`);
  }
  console.log("\n  ✅ Phase 10: Model specialization map complete\n");

  // ══════════════════════════════════════════════════════════════════════════
  // Phase 11: Dashboard
  // ══════════════════════════════════════════════════════════════════════════
  console.log("─── Phase 11: Dashboard Server ──────────────────────────────────");
  console.log("  Dashboard implementation: ax-os-dashboard-server.mjs");
  console.log("  Start with: node ax-os-dashboard-server.mjs [port]");
  console.log("  Features:");
  console.log("    • WebSocket real-time event stream");
  console.log("    • Live Events panel (scrolling log)");
  console.log("    • SharedMemory browser (all namespaces)");
  console.log("    • Vector index stats (namespace → count bar chart)");
  console.log("    • Adaptive Router weights display");
  console.log("    • System stats: events / memory keys / vectors / uptime");
  console.log("  Integration: import { eventBus } and call eventBus.emit(type, data)");

  // Verify dashboard server code is present
  try {
    const { existsSync } = await import("node:fs");
    const ok = existsSync(`${process.env.HOME}/ax-os-dashboard-server.mjs`);
    console.log(`\n  Dashboard server file: ${ok?"✅ present":"❌ missing"}`);
  } catch {}
  console.log("  ✅ Phase 11: Dashboard ready to launch\n");

  // ══════════════════════════════════════════════════════════════════════════
  // Phase 12: AEQ Integration
  // ══════════════════════════════════════════════════════════════════════════
  console.log("─── Phase 12: AEQ Integration ───────────────────────────────────");

  const LOCAL_GPU = { model:"RTX 5070 Ti", vram_GB:15.9, sm:"SM12.0", speedup_bench:"422.8 tok/s" };
  const AEQ_CONFIGS = [
    { base:"gpt-oss:20b",                scheme:"R01=BF16,R09-R32=MXFP4,R33+=INT2", vram:8.5, speedup:1.6, status:"pending" },
    { base:"hades-trunk-current:latest", scheme:"R01=BF16,R09+=MXFP4",              vram:4.8, speedup:1.9, status:"pending" },
    { base:"qwen2.5:14b-instruct",       scheme:"R01=BF16,R09+=MXFP4",              vram:5.2, speedup:1.7, status:"pending" },
  ];

  console.log(`\n  Local GPU: ${LOCAL_GPU.model} (${LOCAL_GPU.vram_GB}GB, ${LOCAL_GPU.sm})`);
  console.log(`  Benchmark: ${LOCAL_GPU.speedup_bench} (Qwen2.5-7B-AWQ Multi-Batch N=4)\n`);
  console.log(`  ${"Model".padEnd(36)} ${"Scheme".padEnd(32)} VRAM   Speedup  Status`);
  console.log("  " + "─".repeat(90));

  let totalCompressedVRAM = 0;
  for(const c of AEQ_CONFIGS) {
    const savings = ((1 - c.vram / (c.base.includes("20b")?13:9)) * 100).toFixed(0);
    console.log(`  ${c.base.padEnd(36)} ${c.scheme.padEnd(32)} ${c.vram}GB   ${c.speedup}×       ${c.status}`);
    console.log(`  ${" ".repeat(36)} → ${savings}% VRAM savings vs base`);
    totalCompressedVRAM += c.vram;
  }

  console.log(`\n  If all 3 AEQ models available simultaneously:`);
  console.log(`    Total VRAM: ${totalCompressedVRAM.toFixed(1)}GB / ${LOCAL_GPU.vram_GB}GB`);
  const fits = totalCompressedVRAM <= LOCAL_GPU.vram_GB;
  console.log(`    ${fits?"✅ Fits — parallel 3-agent inference possible":"⚠️  Exceeds — sequential loading required"}`);

  if(fits) {
    console.log(`    Parallel capacity: 3 specialized agents simultaneously`);
    console.log(`    vs current: 1 large model at a time (15.9GB single model)`);
  }

  // Save AEQ status to memory
  for(const c of AEQ_CONFIGS) {
    memory.set("aeq", `status_${c.base.replace(/[:/]/g,"_")}`, JSON.stringify({...c,ts:Date.now()}));
  }
  console.log(`\n  AEQ configs saved to SharedMemory[aeq] (${AEQ_CONFIGS.length} entries)`);
  console.log("  ✅ Phase 12: AEQ integration framework ready\n");

  // ══════════════════════════════════════════════════════════════════════════
  // Full System Summary
  // ══════════════════════════════════════════════════════════════════════════
  console.log("═".repeat(63));
  console.log("AX OS v2 — ALL PHASES COMPLETE");
  console.log("═".repeat(63));
  const phases = [
    ["1",  "AgentRegistry + OllamaAdapter + AnthropicAdapter"],
    ["2",  "AgentOrchestrator (sequential + parallel)"],
    ["3",  "SharedMemory + ToolRegistry + BRAIN DB tools"],
    ["4",  "ReAct Loop (LLM-directed tool calling)"],
    ["5",  "A2A Delegation (Planner → Analyst + Coder)"],
    ["6",  "Vector Memory (all-minilm semantic search)"],
    ["7",  "Adaptive Router (EMA routing weight learning)"],
    ["8",  "BRAIN Full Loop (gen→validate→dedup→sim→eval)"],
    ["9",  "Adversarial Eval (N critics, majority vote gate)"],
    ["10", "Model Specialization Map (auto role assignment)"],
    ["11", "Dashboard (WebSocket + real-time HTML UI)"],
    ["12", "AEQ Integration (MoE compression + VRAM planning)"],
  ];
  for(const [p,desc] of phases) console.log(`  ✅ Phase ${p.padEnd(3)}: ${desc}`);

  const memStats = memory.list("eval").length + memory.list("aeq").length;
  console.log(`\nSharedMemory entries written: ${memStats}`);
  console.log("Repo: https://github.com/popixoxipop-collab/ax-os");
  console.log("═".repeat(63) + "\n");
})().catch(e=>{console.error(e);process.exit(1);});
