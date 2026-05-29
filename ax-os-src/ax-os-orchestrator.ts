/**
 * AX OS - Agent Orchestrator (Layer 5)
 *
 * Executes multi-step workflows across registered agents.
 * Supports sequential pipelines, parallel groups, and context interpolation.
 *
 * Usage:
 *   const orc = new AgentOrchestrator(registry, executor);
 *   const run = await orc.run(workflowDef, { topic: "momentum" });
 */

import { AgentRegistry } from "./ax-os-agent-registry.js";
import { AgentTask, AgentResult } from "./ax-os-agent-types.js";
import {
  WorkflowDef,
  AgentStepDef,
  ParallelGroupDef,
  WorkflowRun,
  StepResult,
  WorkflowEvent,
  WorkflowEventHandler,
  WorkflowError,
} from "./ax-os-orchestrator-types.js";
import { LLMClient, CapacityLevel } from "./ax-os-types.js";
import { ToolRegistry, ToolContext } from "./ax-os-tools.js";
import { SharedMemory } from "./ax-os-memory.js";

// ── Agent executor interface ─────────────────────────────────────────────────

/** Thin wrapper: given a task + LLMClient, run the inference. */
export interface AgentExecutor {
  execute(task: AgentTask, client: LLMClient, capacityLevel: CapacityLevel): Promise<AgentResult>;
}

/** Default executor: calls client.generate() with the task prompt. */
export class DefaultAgentExecutor implements AgentExecutor {
  async execute(
    task: AgentTask,
    client: LLMClient,
    capacityLevel: CapacityLevel
  ): Promise<AgentResult> {
    const start = Date.now();
    try {
      const resp = await client.generate(
        {
          prompt: task.prompt,
          maxTokens: task.maxTokens ?? 2048,
          temperature: task.temperature ?? 0.7,
          topP: 0.9,
        },
        capacityLevel
      );
      return {
        taskId: task.id,
        agentId: task.preferredAgentId ?? "unknown",
        output: resp.text,
        tokensUsed: resp.tokensUsed,
        latencyMs: Date.now() - start,
        success: true,
      };
    } catch (err) {
      return {
        taskId: task.id,
        agentId: task.preferredAgentId ?? "unknown",
        output: "",
        tokensUsed: 0,
        latencyMs: Date.now() - start,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export interface OrchestratorConfig {
  /** Default capacity level for all agent calls. Default: 3 */
  readonly defaultCapacityLevel?: CapacityLevel;
  /** Map agentId → LLMClient. Required for any agent that will be called. */
  readonly clients: Readonly<Record<string, LLMClient>>;
  /** Custom executor. Default: DefaultAgentExecutor. */
  readonly executor?: AgentExecutor;
  /** Tool registry for pre/post-step tool execution. */
  readonly tools?: ToolRegistry;
  /** Shared memory instance passed to tool contexts. */
  readonly memory?: SharedMemory;
}

export class AgentOrchestrator {
  private readonly registry: AgentRegistry;
  private readonly clients: Readonly<Record<string, LLMClient>>;
  private readonly executor: AgentExecutor;
  private readonly defaultCapacity: CapacityLevel;
  private readonly tools: ToolRegistry | null;
  private readonly memory: SharedMemory | null;
  private readonly handlers: WorkflowEventHandler[] = [];

  constructor(registry: AgentRegistry, config: OrchestratorConfig) {
    this.registry = registry;
    this.clients = config.clients;
    this.executor = config.executor ?? new DefaultAgentExecutor();
    this.defaultCapacity = config.defaultCapacityLevel ?? 3;
    this.tools = config.tools ?? null;
    this.memory = config.memory ?? null;
  }

  // ── Event bus ──────────────────────────────────────────────────────────────

  on(handler: WorkflowEventHandler): () => void {
    this.handlers.push(handler);
    return () => { const i = this.handlers.indexOf(handler); if (i >= 0) this.handlers.splice(i, 1); };
  }

  private emit(event: Omit<WorkflowEvent, "timestamp">): void {
    const full: WorkflowEvent = { ...event, timestamp: Date.now() };
    for (const h of this.handlers) h(full);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Run a workflow.
   * @param def     Workflow definition
   * @param vars    Initial template variables merged into context
   */
  async run(
    def: WorkflowDef,
    vars: Record<string, string> = {}
  ): Promise<WorkflowRun> {
    const runId = `run_${Date.now().toString(36)}`;
    const startedAt = Date.now();
    const context: Record<string, string> = { ...vars };
    const stepResults: StepResult[] = [];
    let totalTokens = 0;

    this.emit({ type: "workflow:start", workflowId: def.id, runId });

    const timeoutMs = def.timeoutMs ?? 300_000;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; }, timeoutMs);

    try {
      for (const stepDef of def.steps) {
        if (timedOut) throw new WorkflowError("Workflow timed out", def.id, stepDef.id, "TIMEOUT");

        if (stepDef.kind === "agent") {
          const result = await this.runAgentStep(stepDef, context, def.id, runId);
          stepResults.push(result);
          totalTokens += result.tokensUsed;
          // Store output in context
          const key = stepDef.outputKey ?? stepDef.id;
          if (result.success) context[key] = result.output;
          if (!result.success && !stepDef.continueOnError) {
            throw new WorkflowError(
              `Step "${stepDef.id}" failed: ${result.error}`,
              def.id, stepDef.id, "STEP_FAILED"
            );
          }
        } else {
          // parallel group
          const groupResults = await this.runParallelGroup(stepDef, context, def.id, runId);
          for (const r of groupResults) {
            stepResults.push(r);
            totalTokens += r.tokensUsed;
          }
          // Merge into context
          if (stepDef.merge === "concat") {
            context[stepDef.id] = groupResults
              .filter(r => r.success)
              .map(r => r.output)
              .join("\n\n");
          } else {
            for (let i = 0; i < stepDef.steps.length; i++) {
              const sub = stepDef.steps[i];
              const key = sub.outputKey ?? sub.id;
              if (groupResults[i]?.success) context[key] = groupResults[i].output;
            }
          }
          const anyFailed = groupResults.some(r => !r.success);
          if (anyFailed && !stepDef.continueOnError) {
            const failed = groupResults.find(r => !r.success);
            throw new WorkflowError(
              `Parallel step "${failed?.stepId}" failed: ${failed?.error}`,
              def.id, stepDef.id, "PARALLEL_STEP_FAILED"
            );
          }
        }
      }

      clearTimeout(timer);
      const run: WorkflowRun = {
        workflowId: def.id,
        runId,
        startedAt,
        steps: stepResults,
        context: { ...context },
        totalTokens,
        totalLatencyMs: Date.now() - startedAt,
        success: true,
      };
      this.emit({ type: "workflow:complete", workflowId: def.id, runId, data: { totalTokens, steps: stepResults.length } });
      return run;

    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      this.emit({ type: "workflow:error", workflowId: def.id, runId, data: { error: msg } });
      return {
        workflowId: def.id,
        runId,
        startedAt,
        steps: stepResults,
        context: { ...context },
        totalTokens,
        totalLatencyMs: Date.now() - startedAt,
        success: false,
        error: msg,
      };
    }
  }

  // ── Step execution ─────────────────────────────────────────────────────────

  private async runAgentStep(
    stepDef: AgentStepDef,
    context: Record<string, string>,
    workflowId: string,
    runId: string
  ): Promise<StepResult> {
    this.emit({ type: "step:start", workflowId, runId, stepId: stepDef.id });

    // Resolve agent
    const decision = this.registry.route({
      id: stepDef.id,
      type: "custom",
      prompt: stepDef.prompt,
      requiredCapabilities: stepDef.requiredCapabilities ?? [],
      preferredAgentId: stepDef.agentId,
      priority: "normal",
    });

    if (!decision) {
      const err: StepResult = {
        stepId: stepDef.id,
        agentId: "none",
        output: "",
        tokensUsed: 0,
        latencyMs: 0,
        success: false,
        error: "No agent available for step",
      };
      this.emit({ type: "step:error", workflowId, runId, stepId: stepDef.id, data: { error: err.error } });
      return err;
    }

    const agentDef = this.registry.get(decision.selectedAgentId)!;
    const client = this.clients[agentDef.id] ?? this.clients[agentDef.provider];
    if (!client) {
      const err: StepResult = {
        stepId: stepDef.id,
        agentId: agentDef.id,
        output: "",
        tokensUsed: 0,
        latencyMs: 0,
        success: false,
        error: `No LLMClient configured for agent "${agentDef.id}"`,
      };
      this.emit({ type: "step:error", workflowId, runId, stepId: stepDef.id, data: { error: err.error } });
      return err;
    }

    // ── Pre-tools: run tools and inject results into context ─────────────────
    if (stepDef.preTools?.length && this.tools && this.memory) {
      const toolCtx: ToolContext = {
        memory: this.memory,
        agentId: agentDef.id,
        workflowId,
        runId,
      };
      for (const call of stepDef.preTools) {
        const tr = await this.tools.execute(call, toolCtx);
        if (tr.success) {
          context[tr.outputKey] = tr.serialized;
          this.emit({ type: "step:complete", workflowId, runId, stepId: `${stepDef.id}:tool:${call.tool}`,
            data: { tool: call.tool, outputKey: tr.outputKey, latencyMs: tr.latencyMs } });
        } else {
          this.emit({ type: "step:error", workflowId, runId, stepId: `${stepDef.id}:tool:${call.tool}`,
            data: { error: tr.error } });
        }
      }
    }

    // Interpolate {{key}} placeholders from context
    const resolvedPrompt = interpolate(stepDef.prompt, context);
    const resolvedSystem = stepDef.systemPromptOverride
      ? interpolate(stepDef.systemPromptOverride, context)
      : agentDef.systemPrompt;

    const task: AgentTask = {
      id: stepDef.id,
      type: "custom",
      prompt: resolvedSystem
        ? `[System: ${resolvedSystem}]\n\n${resolvedPrompt}`
        : resolvedPrompt,
      requiredCapabilities: stepDef.requiredCapabilities ?? [],
      preferredAgentId: agentDef.id,
      priority: "normal",
      maxTokens: stepDef.maxTokens ?? agentDef.defaultMaxTokens,
      temperature: stepDef.temperature ?? agentDef.defaultTemperature,
    };

    const result = await this.executor.execute(task, client, this.defaultCapacity);

    const stepResult: StepResult = {
      stepId: stepDef.id,
      agentId: agentDef.id,
      output: result.output,
      tokensUsed: result.tokensUsed,
      latencyMs: result.latencyMs,
      success: result.success,
      error: result.error,
    };

    this.registry.recordResult(result);
    this.emit({
      type: result.success ? "step:complete" : "step:error",
      workflowId, runId, stepId: stepDef.id,
      data: { agentId: agentDef.id, tokens: result.tokensUsed, latencyMs: result.latencyMs },
    });

    // ── Post-tools: run tools after LLM (agent output already in context) ────
    if (result.success && stepDef.postTools?.length && this.tools && this.memory) {
      const toolCtx: ToolContext = {
        memory: this.memory,
        agentId: agentDef.id,
        workflowId,
        runId,
      };
      // Make this step's output available for post-tool args via context
      context[stepDef.outputKey ?? stepDef.id] = result.output;
      for (const call of stepDef.postTools) {
        // Allow arg values to reference context via {{key}} interpolation
        const resolvedArgs = Object.fromEntries(
          Object.entries(call.args).map(([k, v]) =>
            [k, typeof v === "string" ? interpolate(v, context) : v]
          )
        );
        const tr = await this.tools.execute({ ...call, args: resolvedArgs }, toolCtx);
        if (tr.success) {
          context[tr.outputKey] = tr.serialized;
        }
      }
    }

    return stepResult;
  }

  private async runParallelGroup(
    groupDef: ParallelGroupDef,
    context: Record<string, string>,
    workflowId: string,
    runId: string
  ): Promise<StepResult[]> {
    this.emit({ type: "parallel:start", workflowId, runId, stepId: groupDef.id, data: { count: groupDef.steps.length } });

    const results = await Promise.all(
      groupDef.steps.map(sub => this.runAgentStep(sub, context, workflowId, runId))
    );

    this.emit({
      type: "parallel:complete", workflowId, runId, stepId: groupDef.id,
      data: { success: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length },
    });

    return results;
  }
}

// ── Template interpolation ────────────────────────────────────────────────────

/** Replace {{key}} with context[key]. Unknown keys are left as-is. */
function interpolate(template: string, context: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => context[key] ?? `{{${key}}}`);
}
