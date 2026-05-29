/**
 * AX OS - Layer 3: Resilience Manager
 * Handles rollback, degradation, and fault tolerance
 */

import {
  Checkpoint,
  RollbackStrategy,
  DegradationPolicy,
  ResilienceState,
  CapacityLevel,
  GateState,
  PerformanceSnapshot,
  ResilienceError,
  AXOSError
} from "./ax-os-types.js";

/**
 * Default rollback strategy
 */
export const DEFAULT_ROLLBACK_STRATEGY: RollbackStrategy = {
  maxRollbackSteps: 3,
  rollbackThreshold: 0.3,
  preserveRecentOutputs: true
};

/**
 * Default degradation policy
 */
export const DEFAULT_DEGRADATION_POLICY: DegradationPolicy = {
  steps: [5, 4, 3, 2, 1, 0] as const,
  triggerConditions: [
    "quality_score < 0.3",
    "error_rate > 0.5",
    "latency_p99 > 10000",
    "consecutive_failures > 3"
  ],
  recoveryConditions: [
    "quality_score > 0.7",
    "error_rate < 0.1",
    "stable_for > 60000"
  ]
};

/**
 * Error classification
 */
type ErrorCategory = "transient" | "persistent" | "fatal" | "resource";

interface ErrorInfo {
  category: ErrorCategory;
  retryable: boolean;
  severity: number; // 0-1
}

/**
 * Resilience Manager - handles fault tolerance and recovery
 */
export class ResilienceManager {
  private state: ResilienceState = "healthy";
  private checkpoints: Checkpoint[] = [];
  private rollbackStrategy: RollbackStrategy;
  private degradationPolicy: DegradationPolicy;
  private errorHistory: Array<{ timestamp: number; error: Error; context: unknown }> = [];
  private consecutiveFailures: number = 0;
  private lastHealthyTimestamp: number = Date.now();

  constructor(
    rollbackStrategy: Partial<RollbackStrategy> = {},
    degradationPolicy: Partial<DegradationPolicy> = {}
  ) {
    this.rollbackStrategy = { ...DEFAULT_ROLLBACK_STRATEGY, ...rollbackStrategy };
    this.degradationPolicy = { ...DEFAULT_DEGRADATION_POLICY, ...degradationPolicy };
  }

  /**
   * Create a checkpoint for potential rollback
   */
  createCheckpoint(
    capacityLevel: CapacityLevel,
    gateState: GateState,
    contextHash: string,
    metadata: Record<string, unknown> = {}
  ): Checkpoint {
    const checkpoint: Checkpoint = {
      id: this.generateCheckpointId(),
      timestamp: Date.now(),
      capacityLevel,
      gateState,
      contextHash,
      metadata
    };

    this.checkpoints.push(checkpoint);
    
    // Limit checkpoint history
    if (this.checkpoints.length > this.rollbackStrategy.maxRollbackSteps * 2) {
      this.checkpoints = this.checkpoints.slice(-this.rollbackStrategy.maxRollbackSteps);
    }

    return checkpoint;
  }

  /**
   * Rollback to a previous checkpoint
   */
  rollback(checkpointId?: string): {
    checkpoint: Checkpoint | null;
    stepsBack: number;
    preservedOutputs: unknown[];
  } {
    if (this.checkpoints.length === 0) {
      return { checkpoint: null, stepsBack: 0, preservedOutputs: [] };
    }

    let targetCheckpoint: Checkpoint | undefined;
    let stepsBack = 0;

    if (checkpointId) {
      const index = this.checkpoints.findIndex(cp => cp.id === checkpointId);
      if (index >= 0) {
        targetCheckpoint = this.checkpoints[index];
        stepsBack = this.checkpoints.length - index - 1;
      }
    }

    // Default to most recent checkpoint if not specified
    if (!targetCheckpoint) {
      const maxRollback = Math.min(
        this.rollbackStrategy.maxRollbackSteps,
        this.checkpoints.length - 1
      );
      targetCheckpoint = this.checkpoints[this.checkpoints.length - 1 - maxRollback];
      stepsBack = maxRollback;
    }

    // Preserve outputs if configured
    const preservedOutputs: unknown[] = [];
    if (this.rollbackStrategy.preserveRecentOutputs) {
      const recentCheckpoints = this.checkpoints.slice(-stepsBack);
      for (const cp of recentCheckpoints) {
        if (cp.metadata.output) {
          preservedOutputs.push(cp.metadata.output);
        }
      }
    }

    // Truncate checkpoint history
    const targetIndex = this.checkpoints.findIndex(cp => cp.id === targetCheckpoint!.id);
    this.checkpoints = this.checkpoints.slice(0, targetIndex + 1);

    this.state = "recovery";
    this.consecutiveFailures = 0;

    return {
      checkpoint: targetCheckpoint,
      stepsBack,
      preservedOutputs
    };
  }

  /**
   * Record an error and potentially trigger degradation
   */
  recordError(error: Error, context?: unknown): {
    shouldDegrade: boolean;
    newLevel?: CapacityLevel;
    actions: string[];
  } {
    const now = Date.now();
    const errorInfo = this.classifyError(error);
    
    this.errorHistory.push({
      timestamp: now,
      error,
      context
    });

    // Keep recent error history
    const cutoff = now - 60000; // 1 minute
    this.errorHistory = this.errorHistory.filter(e => e.timestamp > cutoff);

    const actions: string[] = [];

    if (errorInfo.retryable) {
      this.consecutiveFailures++;
      actions.push(`recorded retryable error (consecutive: ${this.consecutiveFailures})`);
    } else {
      this.consecutiveFailures = Math.max(1, this.consecutiveFailures);
      actions.push("recorded non-retryable error");
    }

    const shouldDegrade = this.shouldDegrade();
    let newLevel: CapacityLevel | undefined;

    if (shouldDegrade) {
      newLevel = this.getDegradedLevel();
      this.state = "degraded";
      actions.push(`degraded to capacity level ${newLevel}`);
    } else if (this.consecutiveFailures >= 3) {
      this.state = "critical";
      actions.push("entered critical state");
    }

    return { shouldDegrade, newLevel, actions };
  }

  /**
   * Check if system should degrade based on current conditions
   */
  private shouldDegrade(): boolean {
    // Check consecutive failures
    if (this.consecutiveFailures >= 3) {
      return true;
    }

    // Check error rate
    const recentErrors = this.errorHistory.filter(
      e => e.timestamp > Date.now() - 10000
    );
    const errorRate = recentErrors.length / Math.max(1, this.errorHistory.length);
    
    if (errorRate > this.rollbackStrategy.rollbackThreshold) {
      return true;
    }

    return false;
  }

  /**
   * Get the degraded capacity level
   */
  private getDegradedLevel(): CapacityLevel {
    // Find current level in degradation steps
    const currentCheckpoint = this.checkpoints[this.checkpoints.length - 1];
    const currentLevel = currentCheckpoint?.capacityLevel ?? 3;
    
    const stepIndex = this.degradationPolicy.steps.indexOf(currentLevel);
    if (stepIndex >= 0 && stepIndex < this.degradationPolicy.steps.length - 1) {
      return this.degradationPolicy.steps[stepIndex + 1];
    }
    
    return Math.max(0, currentLevel - 1) as CapacityLevel;
  }

  /**
   * Record successful operation and potentially recover
   */
  recordSuccess(): {
    shouldRecover: boolean;
    newLevel?: CapacityLevel;
    state: ResilienceState;
  } {
    this.consecutiveFailures = 0;
    this.lastHealthyTimestamp = Date.now();

    const shouldRecover = this.shouldRecover();
    let newLevel: CapacityLevel | undefined;

    if (shouldRecover && this.state !== "healthy") {
      const currentCheckpoint = this.checkpoints[this.checkpoints.length - 1];
      const currentLevel = currentCheckpoint?.capacityLevel ?? 3;
      newLevel = Math.min(5, currentLevel + 1) as CapacityLevel;
      this.state = "healthy";
    } else if (this.state === "degraded" || this.state === "critical") {
      this.state = "recovery";
    }

    return { shouldRecover, newLevel, state: this.state };
  }

  /**
   * Check if system should recover to higher capacity
   */
  private shouldRecover(): boolean {
    const stableDuration = Date.now() - this.lastHealthyTimestamp;
    return (
      this.consecutiveFailures === 0 &&
      this.errorHistory.length === 0 &&
      stableDuration > 30000 // 30 seconds of stability
    );
  }

  /**
   * Classify error for appropriate handling
   */
  private classifyError(error: Error): ErrorInfo {
    const message = error.message.toLowerCase();
    
    // Resource errors
    if (
      message.includes("rate limit") ||
      message.includes("quota") ||
      message.includes("timeout") ||
      message.includes("too many requests")
    ) {
      return {
        category: "resource",
        retryable: true,
        severity: 0.6
      };
    }

    // Fatal errors
    if (
      message.includes("authentication") ||
      message.includes("unauthorized") ||
      message.includes("forbidden") ||
      error instanceof ResilienceError
    ) {
      return {
        category: "fatal",
        retryable: false,
        severity: 1.0
      };
    }

    // Transient errors
    if (
      message.includes("network") ||
      message.includes("connection") ||
      message.includes("temporary")
    ) {
      return {
        category: "transient",
        retryable: true,
        severity: 0.3
      };
    }

    // Default to persistent
    return {
      category: "persistent",
      retryable: false,
      severity: 0.8
    };
  }

  /**
   * Get current resilience state
   */
  getState(): ResilienceState {
    return this.state;
  }

  /**
   * Get available checkpoints
   */
  getCheckpoints(): readonly Checkpoint[] {
    return this.checkpoints;
  }

  /**
   * Get error statistics
   */
  getErrorStats(): {
    totalRecent: number;
    consecutiveFailures: number;
    byCategory: Record<ErrorCategory, number>;
  } {
    const byCategory: Record<ErrorCategory, number> = {
      transient: 0,
      persistent: 0,
      fatal: 0,
      resource: 0
    };

    for (const entry of this.errorHistory) {
      const info = this.classifyError(entry.error);
      byCategory[info.category]++;
    }

    return {
      totalRecent: this.errorHistory.length,
      consecutiveFailures: this.consecutiveFailures,
      byCategory
    };
  }

  /**
   * Reset resilience state (for testing/recovery)
   */
  reset(): void {
    this.state = "healthy";
    this.checkpoints = [];
    this.errorHistory = [];
    this.consecutiveFailures = 0;
    this.lastHealthyTimestamp = Date.now();
  }

  /**
   * Generate unique checkpoint ID
   */
  private generateCheckpointId(): string {
    return `cp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}