/**
 * AX OS - Orchestrator Types (Layer 5+)
 * Workflow definition and execution result types.
 */

import { AgentId } from "./ax-os-agent-types.js";
import { ToolCall, ToolResult } from "./ax-os-tools.js";

// ── Step definitions ─────────────────────────────────────────────────────────

/**
 * Single agent call step.
 * `prompt` supports {{stepId}} template interpolation from prior step outputs.
 */
export interface AgentStepDef {
  readonly kind: "agent";
  readonly id: string;
  /** Fixed agent; if omitted, auto-routed by requiredCapabilities. */
  readonly agentId?: AgentId;
  readonly requiredCapabilities?: readonly string[];
  readonly prompt: string;
  readonly systemPromptOverride?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  /**
   * Context key under which this step's output is stored.
   * Defaults to the step id.
   */
  readonly outputKey?: string;
  /** Continue workflow even if this step fails. Default false. */
  readonly continueOnError?: boolean;
  /**
   * Tools to execute BEFORE the LLM call.
   * Results are injected into context as {{outputKey}} for prompt interpolation.
   */
  readonly preTools?: readonly ToolCall[];
  /**
   * Tools to execute AFTER the LLM call.
   * Agent output is available in context as {{stepId}} during post-tool execution.
   */
  readonly postTools?: readonly ToolCall[];
}

// Re-export for convenience
export { ToolCall, ToolResult };

/**
 * Group of steps that run concurrently.
 * After all complete, results are merged into context.
 */
export interface ParallelGroupDef {
  readonly kind: "parallel";
  readonly id: string;
  readonly steps: readonly AgentStepDef[];
  /**
   * "object"  — context key = step.outputKey ?? step.id, value = output  (default)
   * "concat"  — context key = group.id, value = all outputs joined with \n\n
   */
  readonly merge?: "object" | "concat";
  readonly continueOnError?: boolean;
}

export type WorkflowStepDef = AgentStepDef | ParallelGroupDef;

// ── Workflow definition ──────────────────────────────────────────────────────

export interface WorkflowDef {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly WorkflowStepDef[];
  /** Wall-clock timeout for the entire workflow in ms. Default 300_000. */
  readonly timeoutMs?: number;
}

// ── Execution results ────────────────────────────────────────────────────────

export interface StepResult {
  readonly stepId: string;
  readonly agentId: AgentId | "none";
  readonly output: string;
  readonly tokensUsed: number;
  readonly latencyMs: number;
  readonly success: boolean;
  readonly error?: string;
}

export interface WorkflowRun {
  readonly workflowId: string;
  readonly runId: string;
  readonly startedAt: number;
  readonly steps: StepResult[];
  /** Accumulated context: stepId/outputKey → output string */
  readonly context: Readonly<Record<string, string>>;
  readonly totalTokens: number;
  readonly totalLatencyMs: number;
  readonly success: boolean;
  readonly error?: string;
}

// ── Events (for progress callbacks) ─────────────────────────────────────────

export type WorkflowEventType =
  | "workflow:start"
  | "workflow:complete"
  | "workflow:error"
  | "step:start"
  | "step:complete"
  | "step:error"
  | "parallel:start"
  | "parallel:complete";

export interface WorkflowEvent {
  readonly type: WorkflowEventType;
  readonly workflowId: string;
  readonly runId: string;
  readonly stepId?: string;
  readonly data?: unknown;
  readonly timestamp: number;
}

export type WorkflowEventHandler = (event: WorkflowEvent) => void;

// ── Errors ───────────────────────────────────────────────────────────────────

export class WorkflowError extends Error {
  constructor(
    message: string,
    public readonly workflowId: string,
    public readonly stepId: string | undefined,
    public readonly code: string
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}
