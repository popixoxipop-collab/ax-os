/**
 * AX OS - Layer 2: Gate Manager
 * Implements compute_g() and routing decisions
 */

import {
  GateValue,
  GateState,
  GateContext,
  RoutingDecision,
  CapacityLevel,
  TopKConfig,
  EntropyConfig,
  PerformanceSnapshot,
  GateError
} from "./ax-os-types.js";

import { DEFAULT_TOPK_CONFIG } from "./ax-os-topk-controller.js";
import { DEFAULT_ENTROPY_CONFIG } from "./ax-os-entropy-controller.js";

/**
 * Weight configuration for gate computation
 */
export interface GateWeights {
  complexityWeight: number;
  historyWeight: number;
  loadWeight: number;
  entropyWeight: number;
}

/**
 * Default gate weights
 */
export const DEFAULT_GATE_WEIGHTS: GateWeights = {
  complexityWeight: 0.3,
  historyWeight: 0.25,
  loadWeight: 0.2,
  entropyWeight: 0.25
};

/**
 * Core gate computation function: compute_g()
 * 
 * Calculates the gate value g ∈ [0, 1] based on:
 * - Task complexity
 * - Historical performance
 * - Current system load
 * - Token entropy indicators
 */
export function compute_g(
  context: GateContext,
  weights: GateWeights = DEFAULT_GATE_WEIGHTS
): GateValue {
  // Normalize inputs to [0, 1]
  const complexityNorm = normalizeComplexity(context.taskComplexity);
  const historyScore = calculateHistoryScore(context.historicalPerformance);
  const loadNorm = normalizeLoad(context.currentLoad);
  const entropyNorm = calculateEntropyNorm(context.inputTokens);

  // Weighted combination
  const g = 
    weights.complexityWeight * complexityNorm +
    weights.historyWeight * historyScore +
    weights.loadWeight * loadNorm +
    weights.entropyWeight * entropyNorm;

  // Clamp to valid range
  return Math.max(0, Math.min(1, g));
}

/**
 * Normalize task complexity to [0, 1]
 */
function normalizeComplexity(complexity: number): number {
  // Assume complexity is roughly in range [0, 10]
  return Math.max(0, Math.min(1, complexity / 10));
}

/**
 * Normalize system load to [0, 1]
 */
function normalizeLoad(load: number): number {
  // Higher load = lower gate value (conserve resources)
  return Math.max(0, Math.min(1, 1 - load));
}

/**
 * Calculate performance-based score from historical data
 */
function calculateHistoryScore(
  history: readonly PerformanceSnapshot[]
): number {
  if (history.length === 0) return 0.5;
  
  // Recent performance weighted more heavily
  let weightedScore = 0;
  let totalWeight = 0;
  
  const now = Date.now();
  for (let i = 0; i < history.length; i++) {
    const snapshot = history[i];
    const age = now - snapshot.timestamp;
    const weight = Math.exp(-age / 60000); // Decay over 1 minute
    
    // Quality score normalized
    const qualityNorm = snapshot.qualityScore;
    weightedScore += qualityNorm * weight;
    totalWeight += weight;
  }
  
  return totalWeight > 0 ? weightedScore / totalWeight : 0.5;
}

/**
 * Calculate normalized entropy from input tokens
 */
function calculateEntropyNorm(
  tokens: readonly { entropy: number }[]
): number {
  if (tokens.length === 0) return 0.5;
  
  const avgEntropy = tokens.reduce((sum, t) => sum + t.entropy, 0) / tokens.length;
  // Normalize assuming entropy typically in [0, 5]
  return Math.max(0, Math.min(1, avgEntropy / 5));
}

/**
 * Map gate value to capacity level
 */
export function gateToCapacity(
  gateValue: GateValue,
  minLevel: CapacityLevel = 0,
  maxLevel: CapacityLevel = 5
): CapacityLevel {
  const range = maxLevel - minLevel;
  const level = Math.floor(gateValue * (range + 1));
  return Math.max(minLevel, Math.min(maxLevel, level)) as CapacityLevel;
}

/**
 * Gate Manager - manages gate state and routing decisions
 */
export class GateManager {
  private state: GateState;
  private weights: GateWeights;
  private topKConfig: TopKConfig;
  private entropyConfig: EntropyConfig;

  constructor(
    weights: Partial<GateWeights> = {},
    topKConfig: Partial<TopKConfig> = {},
    entropyConfig: Partial<EntropyConfig> = {}
  ) {
    this.weights = { ...DEFAULT_GATE_WEIGHTS, ...weights };
    this.topKConfig = { ...DEFAULT_TOPK_CONFIG, ...topKConfig };
    this.entropyConfig = { ...DEFAULT_ENTROPY_CONFIG, ...entropyConfig };
    
    this.state = {
      currentValue: 0.5,
      previousValue: 0.5,
      trend: "stable",
      confidence: 1.0,
      lastUpdated: Date.now()
    };
  }

  /**
   * Compute routing decision based on context
   */
  makeRoutingDecision(context: GateContext): RoutingDecision {
    const gateValue = compute_g(context, this.weights);
    
    // Update state
    this.updateState(gateValue);
    
    const targetCapacity = gateToCapacity(
      gateValue,
      this.topKConfig.minLevel,
      this.topKConfig.maxLevel
    );

    // Estimate cost and quality
    const estimatedCost = this.estimateCost(targetCapacity);
    const estimatedQuality = this.estimateQuality(gateValue, context);

    const reason = this.generateReason(gateValue, targetCapacity, context);

    return {
      targetCapacity,
      gateValue,
      reason,
      estimatedCost,
      estimatedQuality
    };
  }

  /**
   * Update internal gate state
   */
  private updateState(newValue: GateValue): void {
    const previousValue = this.state.currentValue;
    const diff = newValue - previousValue;
    
    let trend: "increasing" | "decreasing" | "stable" = "stable";
    if (diff > 0.05) trend = "increasing";
    else if (diff < -0.05) trend = "decreasing";

    // Calculate confidence based on consistency
    const confidence = 1 - Math.abs(diff);

    this.state = {
      currentValue: newValue,
      previousValue,
      trend,
      confidence,
      lastUpdated: Date.now()
    };
  }

  /**
   * Get current gate state
   */
  getState(): GateState {
    return { ...this.state };
  }

  /**
   * Estimate computational cost for capacity level
   */
  private estimateCost(level: CapacityLevel): number {
    const kValues = this.topKConfig.kValues;
    return kValues[level] * 0.1;
  }

  /**
   * Estimate quality score for given gate value and context
   */
  private estimateQuality(gateValue: GateValue, context: GateContext): number {
    // Higher gate value + sufficient history = higher quality
    const historyFactor = Math.min(1, context.historicalPerformance.length / 5);
    return 0.5 + 0.5 * gateValue * historyFactor;
  }

  /**
   * Generate human-readable reason for routing decision
   */
  private generateReason(
    gateValue: GateValue,
    capacity: CapacityLevel,
    context: GateContext
  ): string {
    const parts: string[] = [];
    
    if (context.taskComplexity > 7) {
      parts.push("high task complexity");
    } else if (context.taskComplexity < 3) {
      parts.push("low task complexity");
    }
    
    if (context.currentLoad > 0.8) {
      parts.push("high system load");
    }
    
    if (context.historicalPerformance.length > 0) {
      const recent = context.historicalPerformance[context.historicalPerformance.length - 1];
      if (recent.qualityScore > 0.8) {
        parts.push("strong historical performance");
      }
    }
    
    if (parts.length === 0) {
      parts.push("default routing");
    }
    
    return `Gate value ${gateValue.toFixed(3)} -> Capacity ${capacity} (${parts.join(", ")})`;
  }

  /**
   * Update gate weights dynamically
   */
  updateWeights(newWeights: Partial<GateWeights>): void {
    const totalWeight = Object.values({ ...this.weights, ...newWeights })
      .reduce((a, b) => a + b, 0);
    
    if (Math.abs(totalWeight - 1.0) > 0.01) {
      throw new GateError(
        `Gate weights must sum to 1.0, got ${totalWeight}`,
        { weights: newWeights }
      );
    }
    
    this.weights = { ...this.weights, ...newWeights };
  }

  /**
   * Force gate value (for testing/emergency)
   */
  forceGateValue(value: GateValue): void {
    if (value < 0 || value > 1) {
      throw new GateError(
        `Gate value must be in [0, 1], got ${value}`,
        { value }
      );
    }
    this.updateState(value);
  }
}