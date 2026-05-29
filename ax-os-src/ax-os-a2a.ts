/**
 * AX OS - Agent-to-Agent (A2A) Delegation (Phase 5)
 *
 * Adds a `delegate_to_agent` tool that any ReAct agent can call
 * to spawn a child agent for a subtask. Enables hierarchical
 * multi-agent patterns: Planner → [Analyst, Coder, Reviewer].
 *
 * Depth limit prevents infinite recursion.
 * SharedMemory is shared across all depth levels.
 */

import { AgentRegistry } from "./ax-os-agent-registry.js";
import { AgentTask } from "./ax-os-agent-types.js";
import { LLMClient, CapacityLevel } from "./ax-os-types.js";
import { ToolRegistry, ToolDefinition } from "./ax-os-tools.js";
import { SharedMemory } from "./ax-os-memory.js";
import { ReactAgentExecutor } from "./ax-os-react-executor.js";

// ── Config ────────────────────────────────────────────────────────────────────

export interface A2AConfig {
  readonly registry: AgentRegistry;
  /** agentId → LLMClient */
  readonly clients: Readonly<Record<string, LLMClient>>;
  readonly baseTools: ToolRegistry;    // tools available to all agents
  readonly memory: SharedMemory;
  readonly defaultCapacity?: CapacityLevel;
  /** Hard cap on nesting depth. Default: 3 */
  readonly maxDepth?: number;
  /** Max ReAct turns per sub-agent. Default: 6 */
  readonly maxTurnsPerAgent?: number;
}

// ── delegate_to_agent tool factory ────────────────────────────────────────────

/**
 * Build a `delegate_to_agent` ToolDefinition at a given nesting depth.
 * At maxDepth the tool is omitted so child registries have no delegate.
 */
export function createDelegateTool(
  config: A2AConfig,
  depth: number
): ToolDefinition {
  const maxDepth = config.maxDepth ?? 3;
  const maxTurns = config.maxTurnsPerAgent ?? 6;
  const capacity = config.defaultCapacity ?? 3;

  return {
    name: "delegate_to_agent",
    description:
      "Spawn a child agent to handle a focused subtask. " +
      "The child has its own ReAct loop and returns its final answer. " +
      `Available agents: ${config.registry.list().map(a => a.id).join(", ")}`,
    parameters: {
      agentId: {
        type: "string",
        description: "ID of the agent to delegate to",
        required: true,
      },
      task: {
        type: "string",
        description: "Full task description for the child agent",
        required: true,
      },
      maxTurns: {
        type: "number",
        description: "Max ReAct turns for the child (default 6)",
        required: false,
        default: maxTurns,
      },
    },

    async execute({ agentId, task, maxTurns: turns = maxTurns }, ctx) {
      const agentDef = config.registry.get(String(agentId));
      if (!agentDef) {
        return { error: `Agent "${agentId}" not registered`, output: "", success: false };
      }

      const client: LLMClient | undefined = config.clients[agentDef.id];
      if (!client) {
        return { error: `No LLMClient for agent "${agentId}"`, output: "", success: false };
      }

      // Build child tool registry:
      //   - all base tools (DB queries, memory, etc.)
      //   - delegate tool at depth+1 only if below maxDepth
      const childTools = new ToolRegistry();
      for (const t of config.baseTools.list()) {
        childTools.register(t);
      }
      if (depth + 1 < maxDepth) {
        childTools.register(createDelegateTool(config, depth + 1));
      }

      const executor = new ReactAgentExecutor({
        toolRegistry: childTools,
        memory: config.memory,
        maxTurns: Number(turns),
        maxTokensPerTurn: 900,
      });

      const agentTask: AgentTask = {
        id: `a2a_${ctx.workflowId}_d${depth + 1}_${Date.now().toString(36)}`,
        type: "custom",
        prompt: String(task),
        requiredCapabilities: [],
        preferredAgentId: agentDef.id,
        priority: "normal",
        maxTokens: 900,
        temperature: agentDef.defaultTemperature,
        metadata: {
          workflowId: ctx.workflowId,
          runId:      ctx.runId,
          depth:      depth + 1,
          parentAgent: ctx.agentId,
        },
      };

      const result = await executor.execute(agentTask, client, capacity);

      // Persist delegation summary to memory
      config.memory.set(
        "a2a",
        `${ctx.workflowId}:d${depth+1}:${agentId}:${Date.now().toString(36)}`,
        JSON.stringify({
          parentAgent: ctx.agentId,
          childAgent:  agentId,
          task:        String(task).slice(0, 200),
          outputLen:   result.output.length,
          tokens:      result.tokensUsed,
          turns:       (result.metadata as { turns?: number })?.turns ?? 0,
        })
      );

      return {
        agentId,
        output:     result.output,
        tokensUsed: result.tokensUsed,
        success:    result.success,
        depth:      depth + 1,
      };
    },
  };
}

// ── Convenience: build root ToolRegistry with A2A wired in ───────────────────

/**
 * Returns a root ToolRegistry (depth=0) that includes all baseTools
 * plus the `delegate_to_agent` tool (if maxDepth > 0).
 */
export function buildA2AToolRegistry(config: A2AConfig): ToolRegistry {
  const root = new ToolRegistry();

  for (const t of config.baseTools.list()) {
    root.register(t);
  }

  const maxDepth = config.maxDepth ?? 3;
  if (maxDepth > 0) {
    root.register(createDelegateTool(config, 0));
  }

  return root;
}
