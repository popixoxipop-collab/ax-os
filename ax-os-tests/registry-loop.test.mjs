/** AgentRegistry routing + BRAIN loop primitives */
import { describe, it, expect } from "./_harness.mjs";
import { AgentRegistry } from "../ax-os-dist/ax-os-agent-registry.js";
import { mockSimulate, evaluate } from "../ax-os-dist/ax-os-brain-loop.js";

const mkAgent = (id, caps) => ({
  id, name: id, description: id, provider: "ollama", model: "test",
  capabilities: caps, defaultMaxTokens: 512, defaultTemperature: 0.4, timeoutMs: 1000,
});

describe("AgentRegistry", () => {
  it("routes a task to the highest-priority capable agent", () => {
    const reg = new AgentRegistry();
    reg.register(mkAgent("weak",   [{ name: "code", description: "", priority: 0.4 }]));
    reg.register(mkAgent("strong", [{ name: "code", description: "", priority: 0.9 }]));
    const d = reg.route({ id: "t", type: "code", prompt: "", requiredCapabilities: ["code"], priority: "normal" });
    expect(d.selectedAgentId).toBe("strong");
  });

  it("throws on duplicate registration", () => {
    const reg = new AgentRegistry();
    reg.register(mkAgent("dup", [{ name: "x", description: "", priority: 0.5 }]));
    expect(() => reg.register(mkAgent("dup", [{ name: "x", description: "", priority: 0.5 }]))).toThrow();
  });

  it("findByCapability sorts by priority descending", () => {
    const reg = new AgentRegistry();
    reg.register(mkAgent("a", [{ name: "analyze", description: "", priority: 0.6 }]));
    reg.register(mkAgent("b", [{ name: "analyze", description: "", priority: 0.9 }]));
    const found = reg.findByCapability("analyze");
    expect(found[0].id).toBe("b");
  });

  it("returns null route when registry empty", () => {
    expect(new AgentRegistry().route({ id: "t", type: "x", prompt: "", requiredCapabilities: [], priority: "normal" })).toBeNull();
  });

  it("tracks stats after recordResult", () => {
    const reg = new AgentRegistry();
    reg.register(mkAgent("a", [{ name: "x", description: "", priority: 0.5 }]));
    reg.recordResult({ taskId: "t", agentId: "a", output: "ok", tokensUsed: 100, latencyMs: 50, success: true });
    expect(reg.stats("a").totalTasksHandled).toBe(1);
    expect(reg.stats("a").totalTokensUsed).toBe(100);
  });
});

describe("mockSimulate", () => {
  it("is deterministic for the same expression", () => {
    expect(mockSimulate("rank(close)").sharpe).toBe(mockSimulate("rank(close)").sharpe);
  });

  it("produces sharpe within realistic bounds", () => {
    const s = mockSimulate("ts_decay_linear(operating_income, 30)");
    expect(s.sharpe).toBeGreaterThan(0);
    expect(s.sharpe).toBeLessThanOrEqual(4.0);
  });

  it("rewards known good operators with higher base", () => {
    const good = mockSimulate("ts_decay_linear(ts_rank(operating_income, 60), 8)");
    const bare = mockSimulate("close");
    expect(good.sharpe).toBeGreaterThan(bare.sharpe);
  });
});

describe("evaluate", () => {
  const thresh = { sharpe: 1.25, fitness: 1.0 };
  it("passes when SR and FIT both clear thresholds", () => {
    expect(evaluate({ expression:"x", sharpe:1.5, fitness:1.1, turnover:0.2, alphaId:"a", error:null }, thresh).passes).toBe(true);
  });
  it("fails when SR below threshold", () => {
    expect(evaluate({ expression:"x", sharpe:1.0, fitness:1.5, turnover:0.2, alphaId:"a", error:null }, thresh).passes).toBe(false);
  });
  it("fails on simulation error", () => {
    expect(evaluate({ expression:"x", sharpe:null, fitness:null, turnover:null, alphaId:null, error:"timeout" }, thresh).passes).toBe(false);
  });
  it("produces qualityScore in [0,1]", () => {
    const q = evaluate({ expression:"x", sharpe:2.0, fitness:1.5, turnover:0.2, alphaId:"a", error:null }, thresh).qualityScore;
    expect(q).toBeGreaterThanOrEqual(0);
    expect(q).toBeLessThanOrEqual(1);
  });
});
