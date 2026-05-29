/**
 * AX OS - Agent Registry
 * Catalog of available agents; capability-based routing lookup.
 */

import {
  AgentId,
  AgentDefinition,
  AgentRegistryEntry,
  AgentResult,
  AgentRoutingDecision,
  AgentTask,
  AgentRegistryError,
} from "./ax-os-agent-types.js";

export class AgentRegistry {
  private readonly entries = new Map<AgentId, AgentRegistryEntry>();

  // ── Registration ──────────────────────────────────────────────────────────

  register(definition: AgentDefinition): void {
    if (this.entries.has(definition.id)) {
      throw new AgentRegistryError(
        `Agent "${definition.id}" already registered`,
        "DUPLICATE_AGENT"
      );
    }
    this.entries.set(definition.id, {
      definition,
      registeredAt: Date.now(),
      totalTasksHandled: 0,
      totalTokensUsed: 0,
      totalLatencyMs: 0,
      errorCount: 0,
    });
  }

  unregister(id: AgentId): boolean {
    return this.entries.delete(id);
  }

  // ── Lookup ────────────────────────────────────────────────────────────────

  get(id: AgentId): AgentDefinition | null {
    return this.entries.get(id)?.definition ?? null;
  }

  list(): readonly AgentDefinition[] {
    return [...this.entries.values()].map(e => e.definition);
  }

  /** All agents that have the given capability, sorted by priority desc. */
  findByCapability(capability: string): AgentDefinition[] {
    return [...this.entries.values()]
      .filter(e => e.definition.capabilities.some(c => c.name === capability))
      .sort((a, b) => {
        const ap = a.definition.capabilities.find(c => c.name === capability)?.priority ?? 0;
        const bp = b.definition.capabilities.find(c => c.name === capability)?.priority ?? 0;
        return bp - ap;
      })
      .map(e => e.definition);
  }

  // ── Routing decision ──────────────────────────────────────────────────────

  /**
   * Select the best agent for a task.
   * Priority order:
   *  1. preferredAgentId if set and registered
   *  2. Highest aggregate capability score across requiredCapabilities
   *  3. First registered agent as ultimate fallback
   */
  route(task: AgentTask): AgentRoutingDecision | null {
    if (this.entries.size === 0) return null;

    // 1. Explicit preference
    if (task.preferredAgentId && this.entries.has(task.preferredAgentId)) {
      return {
        selectedAgentId: task.preferredAgentId,
        score: 1.0,
        reason: "explicit preferredAgentId",
      };
    }

    // 2. Score all agents against requiredCapabilities
    let best: { id: AgentId; score: number } | null = null;
    let secondBest: { id: AgentId; score: number } | null = null;

    for (const entry of this.entries.values()) {
      const score =
        task.requiredCapabilities.length === 0
          ? 0.5  // no preference — treat all equally
          : task.requiredCapabilities.reduce((sum, req) => {
              const cap = entry.definition.capabilities.find(c => c.name === req);
              return sum + (cap?.priority ?? 0);
            }, 0) / task.requiredCapabilities.length;

      if (!best || score > best.score) {
        secondBest = best;
        best = { id: entry.definition.id, score };
      } else if (!secondBest || score > secondBest.score) {
        secondBest = { id: entry.definition.id, score };
      }
    }

    if (!best) return null;

    return {
      selectedAgentId: best.id,
      score: best.score,
      reason: task.requiredCapabilities.length === 0
        ? "no capability filter — first match"
        : `best capability match (score=${best.score.toFixed(2)})`,
      fallbackAgentId: secondBest?.id,
    };
  }

  // ── Stats tracking ────────────────────────────────────────────────────────

  recordResult(result: AgentResult): void {
    const entry = this.entries.get(result.agentId);
    if (!entry) return;
    entry.totalTasksHandled++;
    entry.totalTokensUsed += result.tokensUsed;
    entry.totalLatencyMs += result.latencyMs;
    if (!result.success) entry.errorCount++;
  }

  stats(id: AgentId): Omit<AgentRegistryEntry, "definition"> | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const { definition: _def, ...s } = entry;
    return s;
  }

  allStats(): Record<AgentId, Omit<AgentRegistryEntry, "definition">> {
    const out: Record<AgentId, Omit<AgentRegistryEntry, "definition">> = {};
    for (const [id, entry] of this.entries) {
      const { definition: _def, ...s } = entry;
      out[id] = s;
    }
    return out;
  }
}
