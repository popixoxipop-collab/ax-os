/**
 * AX OS - Main Entry Point
 * Hierarchical Adaptive Dimensionality Expansion for LLM Reliability
 * 
 * @example
 * ```typescript
 * import { AXRuntime, createLLMAdapter } from "./ax-os-index.js";
 * 
 * const ax = new AXRuntime();
 * const llm = createLLMAdapter("openai", { apiKey: "...", model: "gpt-4" });
 * ax.setLLMClient(llm);
 * 
 * const result = await ax.execute({
 *   prompt: "Explain quantum computing",
 *   maxTokens: 500,
 *   temperature: 0.7
 * });
 * 
 * console.log(result.data);
 * console.log(`Capacity used: ${result.capacityUsed}`);
 * ```
 */

// ============================================================================
// LAYER 0: Core Types
// ============================================================================

export {
  // Token types
  TokenId,
  TokenVector,
  AttentionWeights,
  Logits,
  TokenMetadata,
  
  // Capacity types
  CapacityLevel,
  CapacityConfig,
  TopKConfig,
  EntropyConfig,
  
  // Gate types
  GateValue,
  GateState,
  GateContext,
  RoutingDecision,
  
  // Resilience types
  Checkpoint,
  RollbackStrategy,
  DegradationPolicy,
  ResilienceState,
  
  // Monitoring types
  TelemetryEvent,
  PerformanceSnapshot,
  AlertThreshold,
  
  // Runtime types
  AXConfig,
  AXState,
  AXOutput,
  
  // LLM types
  LLMRequest,
  LLMResponse,
  LLMClient,
  
  // Error types
  AXOSError,
  CapacityError,
  GateError,
  ResilienceError
} from "./ax-os-types.js";

// ============================================================================
// LAYER 1: Capacity Controllers
// ============================================================================

export {
  TopKController,
  DEFAULT_TOPK_CONFIG,
  computeKValue,
  calculateTokenDiversity,
  shouldIncreaseCapacity,
  shouldDecreaseCapacity
} from "./ax-os-topk-controller.js";

export {
  EntropyController,
  DEFAULT_ENTROPY_CONFIG,
  calculateEntropy,
  calculateRollingEntropy
} from "./ax-os-entropy-controller.js";

// ============================================================================
// LAYER 2: Gate Manager
// ============================================================================

export {
  GateManager,
  GateWeights,
  DEFAULT_GATE_WEIGHTS,
  compute_g,
  gateToCapacity
} from "./ax-os-gate-manager.js";

// ============================================================================
// LAYER 3: Resilience Manager
// ============================================================================

export {
  ResilienceManager,
  DEFAULT_ROLLBACK_STRATEGY,
  DEFAULT_DEGRADATION_POLICY
} from "./ax-os-resilience-manager.js";

// ============================================================================
// LAYER 4: Monitor
// ============================================================================

export {
  Monitor,
  MonitorConfig,
  DEFAULT_MONITOR_CONFIG
} from "./ax-os-monitor.js";

// ============================================================================
// AX RUNTIME
// ============================================================================

export {
  AXRuntime,
  DEFAULT_AX_CONFIG
} from "./ax-os-runtime.js";

// ============================================================================
// LLM ADAPTERS
// ============================================================================

export {
  OpenAIAdapter,
  OpenAIAdapterConfig,
  MockLLMAdapter,
  createLLMAdapter
} from "./ax-os-llm-adapter.js";

// ============================================================================
// VERSION
// ============================================================================

// ============================================================================
// LAYER 5: Agent System (Multi-Agent OS)
// ============================================================================

export {
  AgentId,
  AgentProvider,
  AgentCapability,
  AgentDefinition,
  AgentTask,
  TaskType,
  TaskPriority,
  AgentResult,
  AgentRegistryEntry,
  AgentRoutingDecision,
  AgentRegistryError,
  AgentExecutionError,
} from "./ax-os-agent-types.js";

export { AgentRegistry } from "./ax-os-agent-registry.js";

// ============================================================================
// LAYER 5b: Orchestrator
// ============================================================================

export {
  AgentStepDef,
  ParallelGroupDef,
  WorkflowStepDef,
  WorkflowDef,
  StepResult,
  WorkflowRun,
  WorkflowEvent,
  WorkflowEventType,
  WorkflowEventHandler,
  WorkflowError,
} from "./ax-os-orchestrator-types.js";

export {
  AgentExecutor,
  DefaultAgentExecutor,
  OrchestratorConfig,
  AgentOrchestrator,
} from "./ax-os-orchestrator.js";

// ============================================================================
// ADAPTERS (Ollama + Anthropic)
// ============================================================================

export { OllamaAdapter, OllamaAdapterConfig } from "./ax-os-ollama-adapter.js";
export { AnthropicAdapter, AnthropicAdapterConfig } from "./ax-os-anthropic-adapter.js";

// ============================================================================
// VERSION
// ============================================================================

export const VERSION = "2.0.0";
export const CODE_POLICY_VERSION = "2";

// ============================================================================
// CONVENIENCE FACTORY
// ============================================================================

import { AXRuntime, DEFAULT_AX_CONFIG } from "./ax-os-runtime.js";
import { createLLMAdapter } from "./ax-os-llm-adapter.js";
import { AXConfig } from "./ax-os-types.js";

/**
 * Create configured AX Runtime with provider
 */
export function createAXRuntime(
  provider: "openai" | "mock",
  providerConfig: Record<string, unknown>,
  axConfig: Partial<AXConfig> = {}
): AXRuntime {
  const runtime = new AXRuntime({ ...DEFAULT_AX_CONFIG, ...axConfig });
  const adapter = createLLMAdapter(provider, providerConfig);
  runtime.setLLMClient(adapter);
  return runtime;
}