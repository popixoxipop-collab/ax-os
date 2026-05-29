/**
 * AX OS - ReAct Agent Executor (Phase 4)
 *
 * Implements the Reasoning + Acting loop:
 *   LLM generates text
 *   → parser finds <tool_call> blocks
 *   → tools execute
 *   → observations injected back as next user turn
 *   → LLM continues
 *   → repeat until no tool calls or maxTurns reached
 *
 * Drop-in replacement for DefaultAgentExecutor: implements AgentExecutor.
 */

import { AgentExecutor } from "./ax-os-orchestrator.js";
import { AgentTask, AgentResult } from "./ax-os-agent-types.js";
import { LLMClient, LLMMessage, CapacityLevel } from "./ax-os-types.js";
import { ToolRegistry, ToolContext } from "./ax-os-tools.js";
import { SharedMemory } from "./ax-os-memory.js";
import {
  parseToolCalls,
  stripToolCalls,
  buildObservation,
  buildToolDescriptions,
} from "./ax-os-react-parser.js";

// ── Config ───────────────────────────────────────────────────────────────────

export interface ReactExecutorConfig {
  readonly toolRegistry: ToolRegistry;
  readonly memory: SharedMemory;
  /** Maximum reasoning turns before forcing a final answer. Default: 8 */
  readonly maxTurns?: number;
  /** Max tokens per LLM turn. Default: 1024 */
  readonly maxTokensPerTurn?: number;
  /** Log each turn to console. Default: false */
  readonly verbose?: boolean;
  /** System prompt override (replaces auto-generated ReAct prompt). */
  readonly systemPrompt?: string;
}

// ── Executor ─────────────────────────────────────────────────────────────────

export class ReactAgentExecutor implements AgentExecutor {
  private readonly tools: ToolRegistry;
  private readonly memory: SharedMemory;
  private readonly maxTurns: number;
  private readonly maxTokensPerTurn: number;
  private readonly verbose: boolean;
  private readonly systemPromptOverride?: string;

  constructor(config: ReactExecutorConfig) {
    this.tools     = config.toolRegistry;
    this.memory    = config.memory;
    this.maxTurns  = config.maxTurns ?? 8;
    this.maxTokensPerTurn = config.maxTokensPerTurn ?? 1024;
    this.verbose   = config.verbose ?? false;
    this.systemPromptOverride = config.systemPrompt;
  }

  // ── AgentExecutor interface ───────────────────────────────────────────────

  async execute(
    task: AgentTask,
    client: LLMClient,
    capacityLevel: CapacityLevel
  ): Promise<AgentResult> {
    const startMs = Date.now();

    const toolCtx: ToolContext = {
      memory:     this.memory,
      agentId:    task.preferredAgentId ?? "react-agent",
      workflowId: String(task.metadata?.workflowId ?? "react"),
      runId:      String(task.metadata?.runId      ?? `r_${Date.now().toString(36)}`),
    };

    // Build conversation (system + user seed)
    const systemMsg = this.systemPromptOverride
      ?? this.buildSystemPrompt();

    const messages: LLMMessage[] = [
      { role: "system",    content: systemMsg },
      { role: "user",      content: task.prompt },
    ];

    let totalTokens = 0;
    let lastText    = "";
    let turn        = 0;
    const trace: ReactTurn[] = [];

    // ── ReAct loop ────────────────────────────────────────────────────────
    while (turn < this.maxTurns) {
      const resp = await client.generate({
        prompt:      "",          // ignored when messages is present
        messages,
        maxTokens:   task.maxTokens ?? this.maxTokensPerTurn,
        temperature: task.temperature ?? 0.35,
        topP:        0.9,
      }, capacityLevel);

      totalTokens += resp.tokensUsed;
      lastText     = resp.text;
      turn++;

      if (this.verbose) {
        console.log(`\n── ReAct turn ${turn} ─────────────────────────`);
        console.log(resp.text);
      }

      const calls = parseToolCalls(resp.text);

      trace.push({
        turn,
        assistantText: resp.text,
        toolCalls: calls.map(c => c.name),
        tokens: resp.tokensUsed,
      });

      if (calls.length === 0) break;    // no more tool calls → final answer

      // Append assistant turn to messages
      messages.push({ role: "assistant", content: resp.text });

      // Execute tools → collect observations
      const observations: string[] = [];
      for (const call of calls) {
        if (this.verbose) console.log(`  🔧 ${call.name}(${JSON.stringify(call.args)})`);

        const result = await this.tools.execute(
          { tool: call.name, args: call.args, outputKey: `_react_${call.name}` },
          toolCtx
        );

        const obs = buildObservation(call.name, result.serialized, result.success);
        observations.push(obs);

        if (this.verbose) console.log(`  ✓ observation (${result.latencyMs}ms)`);
      }

      // Observations become the next user turn
      messages.push({ role: "user", content: observations.join("\n\n") });
    }

    const latencyMs  = Date.now() - startMs;
    const finalAnswer = stripToolCalls(lastText);

    return {
      taskId:     task.id,
      agentId:    task.preferredAgentId ?? "react-agent",
      output:     finalAnswer,
      tokensUsed: totalTokens,
      latencyMs,
      success:    true,
      metadata:   { turns: turn, trace },
    };
  }

  // ── System prompt ─────────────────────────────────────────────────────────

  private buildSystemPrompt(): string {
    const toolDesc = buildToolDescriptions(
      this.tools.list().map(t => ({
        name: t.name,
        description: t.description,
        parameters: Object.fromEntries(
          Object.entries(t.parameters).map(([k, p]) => [k, {
            type: p.type,
            description: p.description,
            required: p.required,
          }])
        ),
      }))
    );

    return `You are a reasoning and acting agent. Think step by step and use tools when you need external data.

To call a tool, output EXACTLY this format (valid JSON inside the tags):
<tool_call>{"name": "tool_name", "args": {"param": "value"}}</tool_call>

After each tool call you will receive an Observation. Continue reasoning until you have enough information, then write your final answer WITHOUT any <tool_call> tags.

Available tools:
${toolDesc}

Rules:
- Call one tool per turn when you need data
- Use the observations to reason further
- Stop tool calls when you have enough to answer
- Final answer must be clear, structured, and actionable`;
  }
}

// ── Internal types ────────────────────────────────────────────────────────────

interface ReactTurn {
  turn: number;
  assistantText: string;
  toolCalls: string[];
  tokens: number;
}
