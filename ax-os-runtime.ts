/**
 * AX OS - AX Runtime
 * Main integration layer that coordinates all AX OS components
 */

import {
  AXConfig,
  AXState,
  AXOutput,
  CapacityLevel,
  GateContext,
  LLMRequest,
  LLMResponse,
  LLMClient,
  TokenMetadata,
  PerformanceSnapshot,
  ResilienceState,
  AXOSError
} from "./ax-os-types.js";

import { TopKController } from "./ax-os-topk-controller.js";
import { EntropyController } from "./ax-os-entropy-controller.js";
import { GateManager, compute_g } from "./ax-os-gate-manager.js";
import { ResilienceManager } from "./ax-os-resilience-manager.js";
import { Monitor, MonitorConfig } from "./ax-os-monitor.js";

/**
 * Default AX configuration
 */
export const DEFAULT_AX_CONFIG: AXConfig = {
  topK: {
    minLevel: 0,
    maxLevel: 5,
    defaultLevel: 3,
    adaptationRate: 0.15,
    hysteresis: 0.05,
    kValues: [1, 5, 20, 50, 100, 500],
    dynamicThreshold: 0.7,
    temperatureSchedule: "adaptive"
  },
  entropy: {
    minLevel: 0,
    maxLevel: 5,
    defaultLevel: 3,
    adaptationRate: 0.2,
    hysteresis: 0.1,
    targetEntropy: 2.5,
    minEntropy: 0.5,
    maxEntropy: 5.0,
    windowSize: 10
  },
  resilience: {
    rollbackStrategy: {
      maxRollbackSteps: 3,
      rollbackThreshold: 0.3,
      preserveRecentOutputs: true
    },
    degradationPolicy: {
      steps: [5, 4, 3, 2, 1, 0],
      triggerConditions: [
        "quality_score < 0.3",
        "error_rate > 0.5",
        "latency_p99 > 10000"
      ],
      recoveryConditions: [
        "quality_score > 0.7",
        "error_rate < 0.1"
      ]
    }
  },
  monitoring: {
    enabled: true,
    sampleRate: 1.0,
    alertThresholds: [
      { metric: "latency", operator: "gt", value: 5000, durationMs: 30000 },
      { metric: "error_rate", operator: "gt", value: 0.1, durationMs: 60000 }
    ]
  }
};

/**
 * AX Runtime - main orchestrator
 */
export class AXRuntime {
  private config: AXConfig;
  private topKController: TopKController;
  private entropyController: EntropyController;
  private gateManager: GateManager;
  private resilienceManager: ResilienceManager;
  private monitor: Monitor;
  private llmClient: LLMClient | null = null;
  
  private state: AXState;
  private requestCount: number = 0;
  private totalTokens: number = 0;
  private startTime: number = Date.now();

  constructor(config: Partial<AXConfig> = {}) {
    this.config = this.mergeConfig(config);
    
    // Initialize controllers
    this.topKController = new TopKController(this.config.topK);
    this.entropyController = new EntropyController(this.config.entropy);
    this.gateManager = new GateManager(
      {},
      this.config.topK,
      this.config.entropy
    );
    this.resilienceManager = new ResilienceManager(
      this.config.resilience.rollbackStrategy,
      this.config.resilience.degradationPolicy
    );
    this.monitor = new Monitor(this.config.monitoring as Partial<MonitorConfig>);
    
    // Initialize state
    this.state = {
      currentCapacity: this.config.topK.defaultLevel,
      gateState: this.gateManager.getState(),
      resilienceState: "healthy",
      checkpoints: [],
      performanceHistory: []
    };

    this.monitor.recordEvent(
      "ax_runtime_initialized",
      "info",
      { config: this.config },
      "ax-runtime"
    );
  }

  /**
   * Merge user config with defaults
   */
  private mergeConfig(userConfig: Partial<AXConfig>): AXConfig {
    return {
      topK: { ...DEFAULT_AX_CONFIG.topK, ...userConfig.topK },
      entropy: { ...DEFAULT_AX_CONFIG.entropy, ...userConfig.entropy },
      resilience: {
        rollbackStrategy: {
          ...DEFAULT_AX_CONFIG.resilience.rollbackStrategy,
          ...userConfig.resilience?.rollbackStrategy
        },
        degradationPolicy: {
          ...DEFAULT_AX_CONFIG.resilience.degradationPolicy,
          ...userConfig.resilience?.degradationPolicy
        }
      },
      monitoring: { ...DEFAULT_AX_CONFIG.monitoring, ...userConfig.monitoring }
    };
  }

  /**
   * Set LLM client
   */
  setLLMClient(client: LLMClient): void {
    this.llmClient = client;
  }

  /**
   * Execute LLM request with AX OS management
   */
  async execute<T = string>(
    request: LLMRequest,
    context?: Partial<GateContext>
  ): Promise<AXOutput<T>> {
    const startTime = Date.now();
    this.requestCount++;

    try {
      // Build gate context
      const gateContext = this.buildGateContext(context);
      
      // Make routing decision
      const decision = this.gateManager.makeRoutingDecision(gateContext);
      
      // Apply resilience constraints
      const resilienceState = this.resilienceManager.getState();
      let effectiveCapacity = decision.targetCapacity;
      
      if (resilienceState === "degraded" || resilienceState === "critical") {
        effectiveCapacity = Math.max(0, effectiveCapacity - 2) as CapacityLevel;
      }
      
      // Create checkpoint
      const checkpoint = this.resilienceManager.createCheckpoint(
        effectiveCapacity,
        this.gateManager.getState(),
        this.hashRequest(request),
        { request }
      );

      // Execute with LLM
      if (!this.llmClient) {
        throw new AXOSError(
          "LLM client not configured",
          "LLM_CLIENT_MISSING",
          { request }
        );
      }

      const response = await this.llmClient.generate(request, effectiveCapacity);
      
      // Process response
      const latencyMs = Date.now() - startTime;
      this.totalTokens += response.tokensUsed;
      
      // Record entropy if logits available
      if (response.logits) {
        this.entropyController.recordEntropy(response.logits);
      }

      // Calculate quality score
      const qualityScore = this.calculateQualityScore(response, latencyMs);
      
      // Record performance
      const performance = this.monitor.recordPerformance(
        latencyMs,
        response.tokensUsed,
        effectiveCapacity,
        decision.gateValue,
        qualityScore,
        this.topKController.estimateCost(effectiveCapacity)
      );

      // Record success for resilience
      const recoveryResult = this.resilienceManager.recordSuccess();
      
      // Update state
      this.updateState(effectiveCapacity, performance, recoveryResult.state);

      // Build output
      const resilienceActions: string[] = [];
      if (recoveryResult.shouldRecover) {
        resilienceActions.push(`recovered to level ${recoveryResult.newLevel}`);
      }

      this.monitor.recordEvent(
        "request_completed",
        "info",
        { 
          latencyMs, 
          tokensUsed: response.tokensUsed,
          capacity: effectiveCapacity,
          gateValue: decision.gateValue
        },
        "ax-runtime"
      );

      return {
        data: response.text as T,
        capacityUsed: effectiveCapacity,
        gateValue: decision.gateValue,
        performance,
        resilienceActions
      };

    } catch (error) {
      const latencyMs = Date.now() - startTime;
      
      // Record error
      const errorResult = this.resilienceManager.recordError(
        error instanceof Error ? error : new Error(String(error)),
        { request, latencyMs }
      );

      // Attempt rollback if needed
      let rollbackResult: { checkpoint: { capacityLevel: CapacityLevel } | null; stepsBack: number } = { 
        checkpoint: null, 
        stepsBack: 0 
      };
      
      if (errorResult.shouldDegrade) {
        rollbackResult = this.resilienceManager.rollback();
      }

      // Record failure performance
      this.monitor.recordPerformance(
        latencyMs,
        0,
        this.state.currentCapacity,
        this.state.gateState.currentValue,
        0,
        0
      );

      this.monitor.recordEvent(
        "request_failed",
        "error",
        { 
          error: error instanceof Error ? error.message : String(error),
          latencyMs,
          degraded: errorResult.shouldDegrade,
          rollbackSteps: rollbackResult.stepsBack
        },
        "ax-runtime"
      );

      throw error;
    }
  }

  /**
   * Build gate context from request and history
   */
  private buildGateContext(
    context?: Partial<GateContext>
  ): GateContext {
    const history = this.state.performanceHistory;
    const recentHistory = history.slice(-10);
    
    // Calculate task complexity from prompt
    const taskComplexity = context?.taskComplexity ?? 
      (context?.inputTokens ? context.inputTokens.length / 100 : 5);

    return {
      inputTokens: context?.inputTokens ?? [],
      taskComplexity,
      historicalPerformance: recentHistory,
      currentLoad: this.calculateCurrentLoad()
    };
  }

  /**
   * Calculate current system load
   */
  private calculateCurrentLoad(): number {
    const recentRequests = this.state.performanceHistory
      .filter(p => p.timestamp > Date.now() - 60000)
      .length;
    
    // Normalize to 0-1 range (assuming max 100 requests/minute)
    return Math.min(1, recentRequests / 100);
  }

  /**
   * Calculate quality score from response
   */
  private calculateQualityScore(response: LLMResponse, latencyMs: number): number {
    // Base quality on response characteristics
    let score = 0.5;
    
    // Penalize very short responses
    if (response.tokensUsed < 10) score -= 0.1;
    
    // Penalize very long latencies
    if (latencyMs > 5000) score -= 0.1;
    
    // Check finish reason
    if (response.finishReason === "stop") score += 0.2;
    else if (response.finishReason === "length") score -= 0.1;
    
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Update internal state
   */
  private updateState(
    capacity: CapacityLevel,
    performance: PerformanceSnapshot,
    resilienceState: ResilienceState
  ): void {
    this.state = {
      currentCapacity: capacity,
      gateState: this.gateManager.getState(),
      resilienceState,
      checkpoints: this.resilienceManager.getCheckpoints(),
      performanceHistory: [
        ...this.state.performanceHistory,
        performance
      ].slice(-100)
    };
  }

  /**
   * Simple hash of request for checkpoint context
   */
  private hashRequest(request: LLMRequest): string {
    const str = `${request.prompt}:${request.maxTokens}:${request.temperature}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  /**
   * Get current state
   */
  getState(): AXState {
    return { ...this.state };
  }

  /**
   * Get runtime statistics
   */
  getStats(): {
    uptimeMs: number;
    totalRequests: number;
    totalTokens: number;
    avgTokensPerRequest: number;
    currentCapacity: CapacityLevel;
    resilienceState: ResilienceState;
    errorStats: ReturnType<ResilienceManager["getErrorStats"]>;
    metricsWindow: ReturnType<Monitor["getMetricsWindow"]>;
  } {
    const uptimeMs = Date.now() - this.startTime;
    
    return {
      uptimeMs,
      totalRequests: this.requestCount,
      totalTokens: this.totalTokens,
      avgTokensPerRequest: this.requestCount > 0 
        ? this.totalTokens / this.requestCount 
        : 0,
      currentCapacity: this.state.currentCapacity,
      resilienceState: this.state.resilienceState,
      errorStats: this.resilienceManager.getErrorStats(),
      metricsWindow: this.monitor.getMetricsWindow()
    };
  }

  /**
   * Force capacity level (emergency override)
   */
  forceCapacityLevel(level: CapacityLevel): void {
    this.topKController.forceSetLevel(level);
    this.entropyController.forceSetLevel(level);
    
    this.monitor.recordEvent(
      "capacity_forced",
      "warn",
      { forcedLevel: level },
      "ax-runtime"
    );
  }

  /**
   * Reset runtime state
   */
  reset(): void {
    this.requestCount = 0;
    this.totalTokens = 0;
    this.startTime = Date.now();
    
    this.topKController = new TopKController(this.config.topK);
    this.entropyController = new EntropyController(this.config.entropy);
    this.gateManager = new GateManager({}, this.config.topK, this.config.entropy);
    this.resilienceManager = new ResilienceManager(
      this.config.resilience.rollbackStrategy,
      this.config.resilience.degradationPolicy
    );
    this.monitor.clear();
    
    this.state = {
      currentCapacity: this.config.topK.defaultLevel,
      gateState: this.gateManager.getState(),
      resilienceState: "healthy",
      checkpoints: [],
      performanceHistory: []
    };

    this.monitor.recordEvent("ax_runtime_reset", "info", {}, "ax-runtime");
  }
}