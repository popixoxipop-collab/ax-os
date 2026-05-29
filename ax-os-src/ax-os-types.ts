/**
 * AX OS - Layer 0: Core Types and Interfaces
 * Hierarchical Adaptive Dimensionality Expansion for LLM Reliability
 * 
 * CODE POLICY v2 - Section 1: TYPE SYSTEM
 * - All interfaces are readonly where possible
 * - Strict null checks enforced
 * - No `any` types permitted
 */

// ============================================================================
// TOKEN & EMBEDDING TYPES
// ============================================================================

export type TokenId = number;
export type TokenVector = Float32Array;
export type AttentionWeights = Float32Array;
export type Logits = Float32Array;

export interface TokenMetadata {
  readonly id: TokenId;
  readonly text: string;
  readonly position: number;
  readonly layerActivations: ReadonlyMap<number, number>;
  readonly entropy: number;
}

// ============================================================================
// CAPACITY CONTROL TYPES
// ============================================================================

export type CapacityLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface CapacityConfig {
  readonly minLevel: CapacityLevel;
  readonly maxLevel: CapacityLevel;
  readonly defaultLevel: CapacityLevel;
  readonly adaptationRate: number; // 0.0 - 1.0
  readonly hysteresis: number; // Prevents oscillation
}

export interface TopKConfig extends CapacityConfig {
  readonly kValues: readonly number[]; // K values for each capacity level
  readonly dynamicThreshold: number;
  readonly temperatureSchedule: "constant" | "annealing" | "adaptive";
}

export interface EntropyConfig extends CapacityConfig {
  readonly targetEntropy: number;
  readonly minEntropy: number;
  readonly maxEntropy: number;
  readonly windowSize: number; // Rolling window for entropy calculation
}

// ============================================================================
// GATE & ROUTING TYPES
// ============================================================================

export type GateValue = number; // 0.0 - 1.0, computed by compute_g()

export interface GateState {
  readonly currentValue: GateValue;
  readonly previousValue: GateValue;
  readonly trend: "increasing" | "decreasing" | "stable";
  readonly confidence: number;
  readonly lastUpdated: number; // Timestamp
}

export interface RoutingDecision {
  readonly targetCapacity: CapacityLevel;
  readonly gateValue: GateValue;
  readonly reason: string;
  readonly estimatedCost: number;
  readonly estimatedQuality: number;
}

export interface GateContext {
  readonly inputTokens: readonly TokenMetadata[];
  readonly taskComplexity: number;
  readonly historicalPerformance: readonly PerformanceSnapshot[];
  readonly currentLoad: number;
}

// ============================================================================
// RESILIENCE TYPES
// ============================================================================

export type ResilienceState = "healthy" | "degraded" | "critical" | "recovery";

export interface Checkpoint {
  readonly id: string;
  readonly timestamp: number;
  readonly capacityLevel: CapacityLevel;
  readonly gateState: GateState;
  readonly contextHash: string;
  readonly metadata: Record<string, unknown>;
}

export interface RollbackStrategy {
  readonly maxRollbackSteps: number;
  readonly rollbackThreshold: number;
  readonly preserveRecentOutputs: boolean;
}

export interface DegradationPolicy {
  readonly steps: readonly CapacityLevel[];
  readonly triggerConditions: readonly string[];
  readonly recoveryConditions: readonly string[];
}

// ============================================================================
// MONITORING TYPES
// ============================================================================

export interface TelemetryEvent {
  readonly timestamp: number;
  readonly type: string;
  readonly level: "debug" | "info" | "warn" | "error";
  readonly data: unknown;
  readonly source: string;
}

export interface PerformanceSnapshot {
  readonly timestamp: number;
  readonly latencyMs: number;
  readonly tokenCount: number;
  readonly capacityLevel: CapacityLevel;
  readonly gateValue: GateValue;
  readonly qualityScore: number;
  readonly costUnits: number;
}

export interface AlertThreshold {
  readonly metric: string;
  readonly operator: "gt" | "lt" | "eq" | "gte" | "lte";
  readonly value: number;
  readonly durationMs: number;
}

// ============================================================================
// AX RUNTIME TYPES
// ============================================================================

export interface AXConfig {
  readonly topK: TopKConfig;
  readonly entropy: EntropyConfig;
  readonly resilience: {
    readonly rollbackStrategy: RollbackStrategy;
    readonly degradationPolicy: DegradationPolicy;
  };
  readonly monitoring: {
    readonly enabled: boolean;
    readonly sampleRate: number;
    readonly alertThresholds: readonly AlertThreshold[];
  };
}

export interface AXState {
  readonly currentCapacity: CapacityLevel;
  readonly gateState: GateState;
  readonly resilienceState: ResilienceState;
  readonly checkpoints: readonly Checkpoint[];
  readonly performanceHistory: readonly PerformanceSnapshot[];
}

export interface AXOutput<T = unknown> {
  readonly data: T;
  readonly capacityUsed: CapacityLevel;
  readonly gateValue: GateValue;
  readonly performance: PerformanceSnapshot;
  readonly resilienceActions: readonly string[];
}

// ============================================================================
// LLM ADAPTER TYPES
// ============================================================================

/** Single turn in a multi-turn conversation. */
export interface LLMMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface LLMRequest {
  readonly prompt: string;
  /**
   * When provided, the adapter uses these messages instead of `prompt`.
   * Enables multi-turn conversations required by ReAct loops.
   */
  readonly messages?: readonly LLMMessage[];
  readonly maxTokens: number;
  readonly temperature: number;
  readonly topP: number;
}

export interface LLMResponse {
  readonly text: string;
  readonly tokensUsed: number;
  readonly finishReason: string;
  readonly logits?: Logits;
  readonly attentionWeights?: readonly AttentionWeights[];
}

export interface LLMClient {
  generate(request: LLMRequest, capacityLevel: CapacityLevel): Promise<LLMResponse>;
  stream?(request: LLMRequest, capacityLevel: CapacityLevel): AsyncIterable<LLMResponse>;
  getTokenCount(text: string): number;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export class AXOSError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: unknown
  ) {
    super(message);
    this.name = "AXOSError";
  }
}

export class CapacityError extends AXOSError {
  constructor(message: string, context?: unknown) {
    super(message, "CAPACITY_ERROR", context);
    this.name = "CapacityError";
  }
}

export class GateError extends AXOSError {
  constructor(message: string, context?: unknown) {
    super(message, "GATE_ERROR", context);
    this.name = "GateError";
  }
}

export class ResilienceError extends AXOSError {
  constructor(message: string, context?: unknown) {
    super(message, "RESILIENCE_ERROR", context);
    this.name = "ResilienceError";
  }
}