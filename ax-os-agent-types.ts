/**
 * AX OS - Agent Types (Layer 5)
 * Multi-agent system type extensions for the AX OS core.
 */

// ── Agent identity ───────────────────────────────────────────────────────────

export type AgentId = string;
export type AgentProvider = "ollama" | "anthropic" | "openai" | "mock";

export interface AgentCapability {
  readonly name: string;       // "code" | "analyze" | "research" | "plan" | ...
  readonly description: string;
  readonly priority: number;   // 0.0–1.0, specialization strength
}

export interface AgentDefinition {
  readonly id: AgentId;
  readonly name: string;
  readonly description: string;
  readonly provider: AgentProvider;
  readonly model: string;      // e.g. "qwen2.5-coder:32b", "claude-sonnet-4-6"
  readonly capabilities: readonly AgentCapability[];
  readonly systemPrompt?: string;
  readonly defaultMaxTokens: number;
  readonly defaultTemperature: number;
  readonly timeoutMs: number;
}

// ── Task ────────────────────────────────────────────────────────────────────

export type TaskType =
  | "code"
  | "analyze"
  | "research"
  | "plan"
  | "summarize"
  | "review"
  | "custom";

export type TaskPriority = "low" | "normal" | "high" | "critical";

export interface AgentTask {
  readonly id: string;
  readonly type: TaskType;
  readonly prompt: string;
  readonly systemPromptOverride?: string;
  readonly context?: Record<string, unknown>;        // shared state in
  readonly requiredCapabilities: readonly string[];
  readonly preferredAgentId?: AgentId;               // optional routing hint
  readonly priority: TaskPriority;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly timeoutMs?: number;
  readonly metadata?: Record<string, unknown>;
}

// ── Result ──────────────────────────────────────────────────────────────────

export interface AgentResult {
  readonly taskId: string;
  readonly agentId: AgentId;
  readonly output: string;
  readonly tokensUsed: number;
  readonly latencyMs: number;
  readonly success: boolean;
  readonly error?: string;
  readonly metadata?: Record<string, unknown>;
}

// ── Registry entry (mutable stats, immutable def) ───────────────────────────

export interface AgentRegistryEntry {
  readonly definition: AgentDefinition;
  readonly registeredAt: number;
  totalTasksHandled: number;
  totalTokensUsed: number;
  totalLatencyMs: number;
  errorCount: number;
}

// ── Routing ─────────────────────────────────────────────────────────────────

export interface AgentRoutingDecision {
  readonly selectedAgentId: AgentId;
  readonly score: number;          // 0–1 match quality
  readonly reason: string;
  readonly fallbackAgentId?: AgentId;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class AgentRegistryError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "AgentRegistryError";
  }
}

export class AgentExecutionError extends Error {
  constructor(
    message: string,
    public readonly agentId: AgentId,
    public readonly taskId: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "AgentExecutionError";
  }
}
