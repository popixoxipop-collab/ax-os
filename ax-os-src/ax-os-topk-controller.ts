/**
 * AX OS - Layer 1: Top-K Controller
 * Controls effective capacity through Top-K sampling parameter
 */

import {
  CapacityLevel,
  TopKConfig,
  TokenMetadata,
  CapacityError
} from "./ax-os-types.js";

/**
 * Default Top-K configuration following AX OS policy
 */
export const DEFAULT_TOPK_CONFIG: TopKConfig = {
  minLevel: 0,
  maxLevel: 5,
  defaultLevel: 3,
  adaptationRate: 0.15,
  hysteresis: 0.05,
  kValues: [1, 5, 20, 50, 100, 500] as const,
  dynamicThreshold: 0.7,
  temperatureSchedule: "adaptive"
};

/**
 * Computes the effective K value for a given capacity level
 */
export function computeKValue(
  capacityLevel: CapacityLevel,
  config: TopKConfig = DEFAULT_TOPK_CONFIG
): number {
  if (capacityLevel < config.minLevel || capacityLevel > config.maxLevel) {
    throw new CapacityError(
      `Invalid capacity level: ${capacityLevel}. Must be between ${config.minLevel} and ${config.maxLevel}`,
      { capacityLevel, config }
    );
  }
  return config.kValues[capacityLevel];
}

/**
 * Calculates token diversity from token metadata
 */
export function calculateTokenDiversity(
  tokens: readonly TokenMetadata[]
): number {
  if (tokens.length === 0) return 0;
  
  const entropySum = tokens.reduce((sum, t) => sum + t.entropy, 0);
  return entropySum / tokens.length;
}

/**
 * Determines if capacity should increase based on diversity metrics
 */
export function shouldIncreaseCapacity(
  currentDiversity: number,
  targetDiversity: number,
  config: TopKConfig
): boolean {
  const threshold = targetDiversity * (1 - config.hysteresis);
  return currentDiversity < threshold;
}

/**
 * Determines if capacity should decrease to save costs
 */
export function shouldDecreaseCapacity(
  currentDiversity: number,
  targetDiversity: number,
  config: TopKConfig
): boolean {
  const threshold = targetDiversity * (1 + config.hysteresis);
  return currentDiversity > threshold;
}

/**
 * Adaptive Top-K controller with dynamic capacity adjustment
 */
export class TopKController {
  private currentLevel: CapacityLevel;
  private config: TopKConfig;
  private adaptationHistory: Array<{ timestamp: number; level: CapacityLevel; diversity: number }> = [];

  constructor(config: Partial<TopKConfig> = {}) {
    this.config = { ...DEFAULT_TOPK_CONFIG, ...config };
    this.currentLevel = this.config.defaultLevel;
  }

  /**
   * Get current K value
   */
  getKValue(): number {
    return computeKValue(this.currentLevel, this.config);
  }

  /**
   * Get current capacity level
   */
  getCurrentLevel(): CapacityLevel {
    return this.currentLevel;
  }

  /**
   * Adapt capacity based on token diversity
   */
  adapt(tokens: readonly TokenMetadata[], targetDiversity: number): CapacityLevel {
    const diversity = calculateTokenDiversity(tokens);
    
    let newLevel = this.currentLevel;
    
    if (shouldIncreaseCapacity(diversity, targetDiversity, this.config)) {
      newLevel = Math.min(
        this.currentLevel + 1,
        this.config.maxLevel
      ) as CapacityLevel;
    } else if (shouldDecreaseCapacity(diversity, targetDiversity, this.config)) {
      newLevel = Math.max(
        this.currentLevel - 1,
        this.config.minLevel
      ) as CapacityLevel;
    }

    if (newLevel !== this.currentLevel) {
      this.adaptationHistory.push({
        timestamp: Date.now(),
        level: newLevel,
        diversity
      });
      this.currentLevel = newLevel;
    }

    return this.currentLevel;
  }

  /**
   * Force set capacity level (for resilience/recovery)
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
   * Get adaptation history for analysis
   */
  getAdaptationHistory(): ReadonlyArray<{ timestamp: number; level: CapacityLevel; diversity: number }> {
    return this.adaptationHistory;
  }

  /**
   * Calculate temperature based on schedule and current state
   */
  calculateTemperature(baseTemp: number): number {
    switch (this.config.temperatureSchedule) {
      case "constant":
        return baseTemp;
      
      case "annealing": {
        const step = this.adaptationHistory.length;
        return baseTemp * Math.exp(-0.1 * step);
      }
      
      case "adaptive": {
        // Higher capacity = more exploration = higher temperature
        const levelRatio = this.currentLevel / this.config.maxLevel;
        return baseTemp * (0.8 + 0.4 * levelRatio);
      }
      
      default:
        return baseTemp;
    }
  }

  /**
   * Estimate computational cost for a given capacity level
   */
  estimateCost(level: CapacityLevel = this.currentLevel): number {
    const k = computeKValue(level, this.config);
    // Cost scales approximately with K
    return k * 0.1;
  }
}