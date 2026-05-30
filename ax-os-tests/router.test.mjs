/** AdaptiveRouter — EMA learning + routing priority */
import { describe, it, expect } from "./_harness.mjs";
import { AdaptiveRouter } from "../ax-os-dist/ax-os-adaptive-router.js";
import { AgentRegistry }  from "../ax-os-dist/ax-os-agent-registry.js";

const mkAgent = (id, caps) => ({
  id, name: id, description: id, provider: "ollama", model: "test",
  capabilities: caps, defaultMaxTokens: 512, defaultTemperature: 0.4, timeoutMs: 1000,
});

describe("AdaptiveRouter EMA", () => {
  it("ranks a consistently-successful agent above a failing one", () => {
    const r = new AdaptiveRouter({ learningRate: 0.3, minTasksForAdaptive: 2 });
    for (let i = 0; i < 5; i++) {
      r.record({ agentId: "good", taskType: "analyze", success: true,  qualityScore: 0.9, latencyMs: 1 });
      r.record({ agentId: "bad",  taskType: "analyze", success: false, qualityScore: 0.3, latencyMs: 1 });
    }
    expect(r.adaptiveScore("good", "analyze")).toBeGreaterThan(r.adaptiveScore("bad", "analyze"));
  });

  it("returns null adaptive score below minTasks threshold", () => {
    const r = new AdaptiveRouter({ minTasksForAdaptive: 3 });
    r.record({ agentId: "x", taskType: "code", success: true, qualityScore: 0.8, latencyMs: 1 });
    expect(r.adaptiveScore("x", "code")).toBeNull();
  });

  it("leaderboard orders agents by descending score", () => {
    const r = new AdaptiveRouter({ minTasksForAdaptive: 2 });
    for (let i = 0; i < 3; i++) {
      r.record({ agentId: "hi", taskType: "t", success: true,  qualityScore: 0.95, latencyMs: 1 });
      r.record({ agentId: "lo", taskType: "t", success: false, qualityScore: 0.20, latencyMs: 1 });
    }
    const lb = r.leaderboard("t");
    expect(lb[0].agentId).toBe("hi");
    expect(lb[lb.length - 1].agentId).toBe("lo");
  });

  it("EMA weights recent outcomes more than old ones", () => {
    const r = new AdaptiveRouter({ learningRate: 0.5, minTasksForAdaptive: 1 });
    r.record({ agentId: "a", taskType: "t", success: false, qualityScore: 0.0, latencyMs: 1 });
    const low = r.adaptiveScore("a", "t");
    r.record({ agentId: "a", taskType: "t", success: true, qualityScore: 1.0, latencyMs: 1 });
    expect(r.adaptiveScore("a", "t")).toBeGreaterThan(low);
  });
});

describe("AdaptiveRouter routing", () => {
  it("prefers adaptive score over static once enough data exists", () => {
    const r = new AdaptiveRouter({ minTasksForAdaptive: 2 });
    const reg = new AgentRegistry();
    reg.register(mkAgent("a", [{ name: "analyze", description: "", priority: 0.85 }]));
    reg.register(mkAgent("b", [{ name: "analyze", description: "", priority: 0.85 }]));
    // a proves better
    for (let i = 0; i < 4; i++) {
      r.record({ agentId: "a", taskType: "analyze", success: true,  qualityScore: 0.9, latencyMs: 1 });
      r.record({ agentId: "b", taskType: "analyze", success: false, qualityScore: 0.3, latencyMs: 1 });
    }
    const d = r.route({ id: "t", type: "analyze", prompt: "", requiredCapabilities: ["analyze"], priority: "normal" }, reg);
    expect(d.selectedAgentId).toBe("a");
    expect(d.reason).toContain("adaptive");
  });

  it("honors explicit preferredAgentId", () => {
    const r = new AdaptiveRouter();
    const reg = new AgentRegistry();
    reg.register(mkAgent("a", [{ name: "x", description: "", priority: 0.5 }]));
    reg.register(mkAgent("b", [{ name: "x", description: "", priority: 0.9 }]));
    const d = r.route({ id: "t", type: "x", prompt: "", requiredCapabilities: ["x"], preferredAgentId: "a", priority: "normal" }, reg);
    expect(d.selectedAgentId).toBe("a");
  });
});
