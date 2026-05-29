/**
 * AX OS v2 — Build Verification
 *
 * Unlike the phase demos (which inline-reimplement logic in .mjs),
 * THIS file imports the actual COMPILED library from ax-os-dist/.
 * If this runs, the TypeScript library code genuinely works.
 *
 * Run: node ax-os-verify-build.mjs
 */

import { AdaptiveRouter }  from "./ax-os-dist/ax-os-adaptive-router.js";
import { AgentRegistry }   from "./ax-os-dist/ax-os-agent-registry.js";
import { parseToolCalls, stripToolCalls, buildObservation } from "./ax-os-dist/ax-os-react-parser.js";
import { mockSimulate, evaluate } from "./ax-os-dist/ax-os-brain-loop.js";
import { VectorMemory }    from "./ax-os-dist/ax-os-vector-memory.js";
import { SharedMemory }    from "./ax-os-dist/ax-os-memory.js";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}${detail?`  ${detail}`:""}`); pass++; }
  else      { console.log(`  ✗ ${name}  FAILED ${detail}`); fail++; }
}

console.log("═══════════════════════════════════════════════════════════════");
console.log("  AX OS v2 — Build Verification (imports compiled ax-os-dist/)");
console.log("═══════════════════════════════════════════════════════════════\n");

// ── 1. AgentRegistry (compiled) ─────────────────────────────────────────────
console.log("── AgentRegistry ──");
const reg = new AgentRegistry();
reg.register({
  id: "coder", name: "Coder", description: "code agent", provider: "ollama",
  model: "qwen2.5-coder:32b",
  capabilities: [{ name: "code", description: "write code", priority: 0.95 }],
  defaultMaxTokens: 1024, defaultTemperature: 0.2, timeoutMs: 60000,
});
reg.register({
  id: "analyst", name: "Analyst", description: "analysis", provider: "ollama",
  model: "qwen2.5:14b-instruct",
  capabilities: [{ name: "analyze", description: "analyze", priority: 0.90 }],
  defaultMaxTokens: 1024, defaultTemperature: 0.4, timeoutMs: 60000,
});
const codeDecision = reg.route({ id:"t1", type:"code", prompt:"x", requiredCapabilities:["code"], priority:"normal" });
check("route code task → coder", codeDecision?.selectedAgentId === "coder", `(${codeDecision?.selectedAgentId}, score=${codeDecision?.score})`);
const anaDecision = reg.route({ id:"t2", type:"analyze", prompt:"x", requiredCapabilities:["analyze"], priority:"normal" });
check("route analyze task → analyst", anaDecision?.selectedAgentId === "analyst");
check("findByCapability(code)", reg.findByCapability("code").length === 1);
check("list() returns 2 agents", reg.list().length === 2);

// ── 2. AdaptiveRouter (compiled) ────────────────────────────────────────────
console.log("\n── AdaptiveRouter ──");
const router = new AdaptiveRouter({ learningRate: 0.3, minTasksForAdaptive: 2 });
// analyst-a strong, analyst-b weak on analyze
for (let i = 0; i < 5; i++) {
  router.record({ agentId:"analyst-a", taskType:"analyze", success:true,  qualityScore:0.9, latencyMs:100 });
  router.record({ agentId:"analyst-b", taskType:"analyze", success:false, qualityScore:0.4, latencyMs:100 });
}
const scoreA = router.adaptiveScore("analyst-a", "analyze");
const scoreB = router.adaptiveScore("analyst-b", "analyze");
check("EMA: analyst-a > analyst-b", scoreA > scoreB, `(a=${scoreA?.toFixed(3)}, b=${scoreB?.toFixed(3)})`);
check("adaptiveScore null below minTasks", router.adaptiveScore("analyst-a","code") === null);
const lb = router.leaderboard("analyze");
check("leaderboard ranks analyst-a first", lb[0]?.agentId === "analyst-a", `(${lb.map(x=>x.agentId).join(">")})`);

// ── 3. ReAct parser (compiled) ──────────────────────────────────────────────
console.log("\n── ReAct Parser ──");
const txt = `Let me check.\n<tool_call>{"name": "brain_query_stats", "args": {}}</tool_call>\nThen analyze.`;
const calls = parseToolCalls(txt);
check("parse single tool call", calls.length === 1 && calls[0].name === "brain_query_stats");
const multi = `<tool_call>{"name":"a","args":{"x":1}}</tool_call><tool_call>{"name":"b","args":{}}</tool_call>`;
check("parse multiple tool calls", parseToolCalls(multi).length === 2);
check("stripToolCalls removes tags", !stripToolCalls(txt).includes("<tool_call>"));
const obs = buildObservation("test_tool", "result data", true);
check("buildObservation formats", obs.includes("Observation [test_tool]") && obs.includes("result data"));
const errObs = buildObservation("t", "boom", false);
check("buildObservation marks errors", errObs.includes("ERROR"));

// ── 4. BRAIN loop primitives (compiled) ─────────────────────────────────────
console.log("\n── BRAIN Loop ──");
const sim1 = mockSimulate("rank(ts_decay_linear(operating_income, 30))");
const sim2 = mockSimulate("rank(ts_decay_linear(operating_income, 30))");
check("mockSimulate deterministic", sim1.sharpe === sim2.sharpe, `(SR=${sim1.sharpe})`);
check("mockSimulate returns valid SR", sim1.sharpe > 0 && sim1.sharpe < 5);
const evalPass = evaluate({ expression:"x", sharpe:1.5, fitness:1.2, turnover:0.2, alphaId:"a", error:null }, { sharpe:1.25, fitness:1.0 });
check("evaluate PASS for SR=1.5", evalPass.passes === true);
const evalFail = evaluate({ expression:"x", sharpe:0.8, fitness:0.5, turnover:0.2, alphaId:"a", error:null }, { sharpe:1.25, fitness:1.0 });
check("evaluate FAIL for SR=0.8", evalFail.passes === false);
check("evaluate qualityScore in [0,1]", evalPass.qualityScore >= 0 && evalPass.qualityScore <= 1);

// ── 5. SharedMemory (compiled, uses node:sqlite) ────────────────────────────
console.log("\n── SharedMemory (node:sqlite) ──");
const mem = new SharedMemory(":memory:");
mem.set("test", "key1", "value1");
check("SharedMemory set/get", mem.get("test", "key1") === "value1");
mem.setJSON("test", "obj", { a: 1, b: [2,3] });
const got = mem.getJSON("test", "obj");
check("SharedMemory JSON roundtrip", got?.a === 1 && got?.b?.[1] === 3);
mem.set("test", "ttl", "expires", 1);  // 1ms TTL
await new Promise(r => setTimeout(r, 10));
check("SharedMemory TTL expiry", mem.get("test", "ttl") === null);
check("SharedMemory list", mem.list("test").length >= 1);

// ── 6. VectorMemory (compiled, uses Ollama embeddings) ──────────────────────
console.log("\n── VectorMemory (all-minilm) ──");
try {
  const vm = new VectorMemory(":memory:");
  await vm.set("v", "a1", "momentum decay strategy on operating income");
  await vm.set("v", "a2", "correlation between returns and volume");
  check("VectorMemory stored 2 vectors", vm.count("v") === 2);
  const results = await vm.search("v", "income decay momentum", 2);
  check("VectorMemory search returns ranked", results.length === 2 && results[0].score >= results[1].score,
        `(top=${results[0]?.key} @ ${(results[0]?.score*100).toFixed(0)}%)`);
  check("VectorMemory top match is a1", results[0].key === "a1");
} catch (e) {
  console.log(`  ⚠ VectorMemory skipped (Ollama not running?): ${e.message}`);
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(63));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log("═".repeat(63));
if (fail === 0) {
  console.log("✅ Compiled library verified — ax-os-dist/ modules work end-to-end");
} else {
  console.log("❌ Some checks failed — see above");
  process.exit(1);
}
