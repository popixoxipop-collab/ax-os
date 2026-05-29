/**
 * AX OS - Adaptive Router (Phase 7)
 *
 * Learns which agent performs best for each task type
 * by tracking outcomes with Exponential Moving Average (EMA).
 *
 * Routing priority:
 *   1. Explicit preferredAgentId
 *   2. Adaptive score (if ≥ MIN_TASKS observations exist)
 *   3. Static capability score (cold start / new task types)
 *
 * Score formula:
 *   adaptive_score = w_s * successRate + w_q * qualityScore
 *   where w_s=0.6, w_q=0.4
 *
 * EMA update (each new outcome):
 *   successRate  ← α * success   + (1-α) * successRate
 *   qualityScore ← α * quality   + (1-α) * qualityScore
 */

import { AgentRegistry } from "./ax-os-agent-registry.js";
import { AgentTask, AgentRoutingDecision } from "./ax-os-agent-types.js";
import { SharedMemory } from "./ax-os-memory.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface RoutingWeight {
  agentId:      string;
  taskType:     string;
  successRate:  number;   // EMA of success (0–1)
  qualityScore: number;   // EMA of quality (0–1)
  totalTasks:   number;
  lastUpdated:  number;   // epoch ms
}

export interface OutcomeRecord {
  readonly agentId:      string;
  readonly taskType:     string;
  readonly success:      boolean;
  readonly qualityScore: number;  // 0–1
  readonly latencyMs:    number;
}

export interface AdaptiveRouterConfig {
  /** EMA learning rate α ∈ (0,1). Higher = forgets past faster. Default: 0.15 */
  readonly learningRate?: number;
  /** Weight of successRate in final score. Default: 0.6 */
  readonly successWeight?: number;
  /** Weight of qualityScore in final score. Default: 0.4 */
  readonly qualityWeight?: number;
  /**
   * Minimum observations before adaptive score overrides static.
   * Below this, falls back to static capability. Default: 3
   */
  readonly minTasksForAdaptive?: number;
}

// ── Adaptive Router ───────────────────────────────────────────────────────────

export class AdaptiveRouter {
  private readonly weights = new Map<string, RoutingWeight>();
  private readonly α: number;
  private readonly wSuccess: number;
  private readonly wQuality: number;
  private readonly minTasks: number;

  constructor(config: AdaptiveRouterConfig = {}) {
    this.α        = config.learningRate         ?? 0.15;
    this.wSuccess = config.successWeight        ?? 0.6;
    this.wQuality = config.qualityWeight        ?? 0.4;
    this.minTasks = config.minTasksForAdaptive  ?? 3;
  }

  // ── Record ─────────────────────────────────────────────────────────────────

  record(outcome: OutcomeRecord): void {
    const k  = this.wkey(outcome.agentId, outcome.taskType);
    const α  = this.α;
    const existing = this.weights.get(k);

    if (existing) {
      existing.successRate  = α * (outcome.success ? 1 : 0) + (1 - α) * existing.successRate;
      existing.qualityScore = α * outcome.qualityScore       + (1 - α) * existing.qualityScore;
      existing.totalTasks++;
      existing.lastUpdated  = Date.now();
    } else {
      this.weights.set(k, {
        agentId:      outcome.agentId,
        taskType:     outcome.taskType,
        successRate:  outcome.success ? 1 : 0,
        qualityScore: outcome.qualityScore,
        totalTasks:   1,
        lastUpdated:  Date.now(),
      });
    }
  }

  // ── Score ──────────────────────────────────────────────────────────────────

  adaptiveScore(agentId: string, taskType: string): number | null {
    const w = this.weights.get(this.wkey(agentId, taskType));
    if (!w || w.totalTasks < this.minTasks) return null;
    return this.wSuccess * w.successRate + this.wQuality * w.qualityScore;
  }

  private staticScore(
    agent: ReturnType<AgentRegistry["list"]>[number],
    task: AgentTask
  ): number {
    const caps = task.requiredCapabilities ?? [];
    if (caps.length === 0) return 0.5;
    return (
      caps.reduce((s, c) => {
        const cap = agent.capabilities.find(x => x.name === c);
        return s + (cap?.priority ?? 0);
      }, 0) / caps.length
    );
  }

  // ── Route ──────────────────────────────────────────────────────────────────

  route(task: AgentTask, registry: AgentRegistry): AgentRoutingDecision | null {
    const agents = registry.list();
    if (agents.length === 0) return null;

    // 1. Explicit preference
    if (task.preferredAgentId && registry.get(task.preferredAgentId)) {
      return {
        selectedAgentId: task.preferredAgentId,
        score: 1.0,
        reason: "explicit preferredAgentId",
      };
    }

    // 2. Score every agent; prefer adaptive over static when available
    type Candidate = { id: string; score: number; source: "adaptive" | "static"; tasks: number };
    let best: Candidate | null = null;
    let secondBest: Candidate | null = null;

    for (const agent of agents) {
      const adaptive = this.adaptiveScore(agent.id, task.type);
      const score  = adaptive ?? this.staticScore(agent, task);
      const source = (adaptive !== null ? "adaptive" : "static") as "adaptive" | "static";
      const tasks  = this.weights.get(this.wkey(agent.id, task.type))?.totalTasks ?? 0;

      // Adaptive beats static regardless of raw score
      const beats = !best ||
        (source === "adaptive" && best.source === "static") ||
        (source === best.source && score > best.score);

      if (beats) {
        secondBest = best;
        best = { id: agent.id, score, source, tasks };
      } else if (
        !secondBest ||
        (source === "adaptive" && secondBest.source === "static") ||
        (source === secondBest.source && score > secondBest.score)
      ) {
        secondBest = { id: agent.id, score, source, tasks };
      }
    }

    if (!best) return null;

    const reason = best.source === "adaptive"
      ? `adaptive (EMA score=${best.score.toFixed(3)}, n=${best.tasks})`
      : `static capability (score=${best.score.toFixed(3)})`;

    return {
      selectedAgentId:  best.id,
      score:            best.score,
      reason,
      fallbackAgentId:  secondBest?.id,
    };
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  save(memory: SharedMemory): void {
    for (const [k, w] of this.weights) {
      memory.set("routing_weights", k, JSON.stringify(w));
    }
  }

  load(memory: SharedMemory): number {
    const entries = memory.list("routing_weights");
    for (const e of entries) {
      try {
        const w = JSON.parse(e.value) as RoutingWeight;
        this.weights.set(this.wkey(w.agentId, w.taskType), w);
      } catch { /* skip corrupted */ }
    }
    return entries.length;
  }

  // ── Introspection ──────────────────────────────────────────────────────────

  getWeight(agentId: string, taskType: string): RoutingWeight | null {
    return this.weights.get(this.wkey(agentId, taskType)) ?? null;
  }

  allWeights(): RoutingWeight[] {
    return [...this.weights.values()].sort((a, b) => b.totalTasks - a.totalTasks);
  }

  /** Per-task-type leaderboard: agents sorted by adaptive score. */
  leaderboard(taskType: string): Array<{ agentId: string; score: number; tasks: number }> {
    return [...this.weights.values()]
      .filter(w => w.taskType === taskType && w.totalTasks >= this.minTasks)
      .map(w => ({
        agentId: w.agentId,
        score:   this.wSuccess * w.successRate + this.wQuality * w.qualityScore,
        tasks:   w.totalTasks,
      }))
      .sort((a, b) => b.score - a.score);
  }

  reset(agentId?: string, taskType?: string): void {
    if (!agentId && !taskType) { this.weights.clear(); return; }
    for (const k of this.weights.keys()) {
      const w = this.weights.get(k)!;
      if ((!agentId || w.agentId === agentId) && (!taskType || w.taskType === taskType)) {
        this.weights.delete(k);
      }
    }
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private wkey(agentId: string, taskType: string): string {
    return `${agentId}::${taskType}`;
  }
}
