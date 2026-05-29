/**
 * AX OS - Layer 1: Entropy Controller
 * Controls capacity based on output entropy and uncertainty
 */

import {
  CapacityLevel,
  EntropyConfig,
  Logits,
  CapacityError
} from "./ax-os-types.js";

/**
 * Default entropy configuration
 */
export const DEFAULT_ENTROPY_CONFIG: EntropyConfig = {
  minLevel: 0,
  maxLevel: 5,
  defaultLevel: 3,
  adaptationRate: 0.2,
  hysteresis: 0.1,
  targetEntropy: 2.5,
  minEntropy: 0.5,
  maxEntropy: 5.0,
  windowSize: 10
};

/**
 * Calculate Shannon entropy from logits
 */
export function calculateEntropy(logits: Logits): number {
  // Convert logits to probabilities using softmax
  const maxLogit = Math.max(...logits);
  const expLogits = logits.map(l => Math.exp(l - maxLogit));
  const sumExp = expLogits.reduce((a, b) => a + b, 0);
  const probs = expLogits.map(e => e / sumExp);
  
  // Calculate entropy: -sum(p * log(p))
  let entropy = 0;
  for (const p of probs) {
    if (p > 1e-10) {
      entropy -= p * Math.log2(p);
    }
  }
  
  return entropy;
}

/**
 * Calculate rolling entropy over a window of logits
 */
export function calculateRollingEntropy(
  logitsHistory: readonly Logits[],
  windowSize: number
): number {
  if (logitsHistory.length === 0) return 0;
  
  const recentLogits = logitsHistory.slice(-windowSize);
  const entropies = recentLogits.map(calculateEntropy);
  
  return entropies.reduce((a, b) => a + b, 0) / entropies.length;
}

/**
 * Entropy-based capacity controller
 */
export class EntropyController {
  private currentLevel: CapacityLevel;
  private config: EntropyConfig;
  private entropyHistory: number[] = [];
  private lastAdaptationTime: number = 0;

  constructor(config: Partial<EntropyConfig> = {}) {
    this.config = { ...DEFAULT_ENTROPY_CONFIG, ...config };
    this.currentLevel = this.config.defaultLevel;
  }

  /**
   * Get current capacity level
   */
  getCurrentLevel(): CapacityLevel {
    return this.currentLevel;
  }

  /**
   * Record entropy measurement
   */
  recordEntropy(logits: Logits): void {
    const entropy = calculateEntropy(logits);
    this.entropyHistory.push(entropy);
    
    // Maintain window size
    if (this.entropyHistory.length > this.config.windowSize * 2) {
      this.entropyHistory = this.entropyHistory.slice(-this.config.windowSize);
    }
  }

  /**
   * Adapt capacity based on entropy
   * High entropy = uncertain = need more capacity
   * Low entropy = confident = can use less capacity
   */
  adapt(): CapacityLevel {
    const currentEntropy = this.getCurrentEntropy();
    const now = Date.now();
    
    // Rate limiting
    const timeSinceLastAdaptation = now - this.lastAdaptationTime;
    if (timeSinceLastAdaptation < 100) { // Minimum 100ms between adaptations
      return this.currentLevel;
    }

    let newLevel = this.currentLevel;
    
    if (currentEntropy > this.config.targetEntropy * (1 + this.config.hysteresis)) {
      // High entropy - increase capacity
      newLevel = Math.min(
        this.currentLevel + 1,
        this.config.maxLevel
      ) as CapacityLevel;
    } else if (currentEntropy < this.config.targetEntropy * (1 - this.config.hysteresis)) {
      // Low entropy - decrease capacity
      newLevel = Math.max(
        this.currentLevel - 1,
        this.config.minLevel
      ) as CapacityLevel;
    }

    if (newLevel !== this.currentLevel) {
      this.currentLevel = newLevel;
      this.lastAdaptationTime = now;
    }

    return this.currentLevel;
  }

  /**
   * Get current entropy (average of recent window)
   */
  getCurrentEntropy(): number {
    if (this.entropyHistory.length === 0) return this.config.targetEntropy;
    
    const recent = this.entropyHistory.slice(-this.config.windowSize);
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }

  /**
   * Get entropy trend
   */
  getEntropyTrend(): "increasing" | "decreasing" | "stable" {
    if (this.entropyHistory.length < 5) return "stable";
    
    const half = Math.floor(this.entropyHistory.length / 2);
    const firstHalf = this.entropyHistory.slice(0, half);
    const secondHalf = this.entropyHistory.slice(half);
    
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    
    const diff = secondAvg - firstAvg;
    const threshold = this.config.targetEntropy * 0.1;
    
    if (diff > threshold) return "increasing";
    if (diff < -threshold) return "decreasing";
    return "stable";
  }

  /**
   * Force set capacity level
   */
  forceSetLevel(level: CapacityLevel): void {
    if (level < this.config.minLevel || level > this.config.maxLevel) {
      throw new CapacityError(
        `Invalid capacity level: ${level}`,
        { level, config: this.config }
      );
    }
    this.currentLevel = level;
  }

  /**
   * Get normalized uncertainty score (0-1)
   */
  getUncertaintyScore(): number {
    const entropy = this.getCurrentEntropy();
    return Math.max(0, Math.min(1, 
      (entropy - this.config.minEntropy) / 
      (this.config.maxEntropy - this.config.minEntropy)
    ));
  }

  /**
   * Get entropy history
   */
  getEntropyHistory(): readonly number[] {
    return this.entropyHistory;
  }
}