/**
 * AX OS - Layer 4: Monitor
 * Telemetry, metrics, and alerting
 */

import {
  TelemetryEvent,
  PerformanceSnapshot,
  AlertThreshold,
  CapacityLevel,
  GateValue,
  AXOSError
} from "./ax-os-types.js";

/**
 * Alert severity levels
 */
type AlertSeverity = "info" | "warning" | "critical";

interface Alert {
  readonly id: string;
  readonly timestamp: number;
  readonly metric: string;
  readonly threshold: AlertThreshold;
  readonly actualValue: number;
  readonly severity: AlertSeverity;
  readonly acknowledged: boolean;
}

/**
 * Metrics aggregation window
 */
interface MetricsWindow {
  readonly startTime: number;
  readonly endTime: number;
  readonly snapshots: PerformanceSnapshot[];
  readonly aggregated: {
    avgLatency: number;
    p50Latency: number;
    p95Latency: number;
    p99Latency: number;
    totalTokens: number;
    avgQuality: number;
    totalCost: number;
  };
}

/**
 * Monitor configuration
 */
export interface MonitorConfig {
  enabled: boolean;
  sampleRate: number; // 0.0 - 1.0
  alertThresholds: AlertThreshold[];
  maxHistorySize: number;
  aggregationWindowMs: number;
  enableConsoleOutput: boolean;
}

/**
 * Default monitor configuration
 */
export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  enabled: true,
  sampleRate: 1.0,
  alertThresholds: [
    { metric: "latency", operator: "gt", value: 5000, durationMs: 30000 },
    { metric: "error_rate", operator: "gt", value: 0.1, durationMs: 60000 },
    { metric: "quality", operator: "lt", value: 0.5, durationMs: 60000 }
  ],
  maxHistorySize: 1000,
  aggregationWindowMs: 60000,
  enableConsoleOutput: true
};

/**
 * Monitor - handles telemetry, metrics, and alerting
 */
export class Monitor {
  private config: MonitorConfig;
  private telemetryEvents: TelemetryEvent[] = [];
  private performanceHistory: PerformanceSnapshot[] = [];
  private alerts: Alert[] = [];
  private alertStartTimes: Map<string, number> = new Map();
  private eventHandlers: Map<string, Array<(event: TelemetryEvent) => void>> = new Map();

  constructor(config: Partial<MonitorConfig> = {}) {
    this.config = { ...DEFAULT_MONITOR_CONFIG, ...config };
  }

  /**
   * Record a telemetry event
   */
  recordEvent(
    type: string,
    level: TelemetryEvent["level"],
    data: unknown,
    source: string = "ax-os"
  ): void {
    if (!this.config.enabled) return;
    
    // Apply sampling
    if (Math.random() > this.config.sampleRate) return;

    const event: TelemetryEvent = {
      timestamp: Date.now(),
      type,
      level,
      data,
      source
    };

    this.telemetryEvents.push(event);
    
    // Maintain history size
    if (this.telemetryEvents.length > this.config.maxHistorySize) {
      this.telemetryEvents = this.telemetryEvents.slice(-this.config.maxHistorySize);
    }

    // Notify handlers
    const handlers = this.eventHandlers.get(type) ?? [];
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (e) {
        // Prevent handler errors from breaking monitoring
      }
    }

    if (this.config.enableConsoleOutput && level === "error") {
      console.error(`[AX-OS] ${source}: ${type}`, data);
    }
  }

  /**
   * Record performance snapshot
   */
  recordPerformance(
    latencyMs: number,
    tokenCount: number,
    capacityLevel: CapacityLevel,
    gateValue: GateValue,
    qualityScore: number,
    costUnits: number
  ): PerformanceSnapshot {
    const snapshot: PerformanceSnapshot = {
      timestamp: Date.now(),
      latencyMs,
      tokenCount,
      capacityLevel,
      gateValue,
      qualityScore,
      costUnits
    };

    this.performanceHistory.push(snapshot);
    
    // Maintain history size
    if (this.performanceHistory.length > this.config.maxHistorySize) {
      this.performanceHistory = this.performanceHistory.slice(-this.config.maxHistorySize);
    }

    // Check alert thresholds
    this.checkAlertThresholds(snapshot);

    return snapshot;
  }

  /**
   * Check if any alert thresholds are breached
   */
  private checkAlertThresholds(snapshot: PerformanceSnapshot): void {
    const now = Date.now();

    for (const threshold of this.config.alertThresholds) {
      const value = this.getMetricValue(snapshot, threshold.metric);
      const breached = this.evaluateThreshold(value, threshold);

      if (breached) {
        const alertKey = `${threshold.metric}_${threshold.operator}_${threshold.value}`;
        const startTime = this.alertStartTimes.get(alertKey);

        if (!startTime) {
          this.alertStartTimes.set(alertKey, now);
        } else if (now - startTime >= threshold.durationMs) {
          // Threshold breached for duration, create alert
          this.createAlert(threshold, value, alertKey);
          this.alertStartTimes.delete(alertKey);
        }
      }
    }
  }

  /**
   * Get metric value from snapshot
   */
  private getMetricValue(snapshot: PerformanceSnapshot, metric: string): number {
    switch (metric) {
      case "latency":
        return snapshot.latencyMs;
      case "quality":
        return snapshot.qualityScore;
      case "cost":
        return snapshot.costUnits;
      case "tokens":
        return snapshot.tokenCount;
      default:
        return 0;
    }
  }

  /**
   * Evaluate if threshold is breached
   */
  private evaluateThreshold(value: number, threshold: AlertThreshold): boolean {
    switch (threshold.operator) {
      case "gt":
        return value > threshold.value;
      case "lt":
        return value < threshold.value;
      case "eq":
        return value === threshold.value;
      case "gte":
        return value >= threshold.value;
      case "lte":
        return value <= threshold.value;
      default:
        return false;
    }
  }

  /**
   * Create an alert
   */
  private createAlert(
    threshold: AlertThreshold,
    actualValue: number,
    metric: string
  ): void {
    const severity = this.calculateSeverity(threshold, actualValue);
    
    const alert: Alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      metric,
      threshold,
      actualValue,
      severity,
      acknowledged: false
    };

    this.alerts.push(alert);

    this.recordEvent(
      "alert_triggered",
      severity === "critical" ? "error" : "warn",
      { alert, threshold, actualValue },
      "monitor"
    );
  }

  /**
   * Calculate alert severity
   */
  private calculateSeverity(threshold: AlertThreshold, actualValue: number): AlertSeverity {
    const ratio = threshold.operator.startsWith("g")
      ? actualValue / threshold.value
      : threshold.value / actualValue;

    if (ratio > 2) return "critical";
    if (ratio > 1.5) return "warning";
    return "info";
  }

  /**
   * Get aggregated metrics for a time window
   */
  getMetricsWindow(
    startTime?: number,
    endTime: number = Date.now()
  ): MetricsWindow {
    const start = startTime ?? endTime - this.config.aggregationWindowMs;
    
    const snapshots = this.performanceHistory.filter(
      s => s.timestamp >= start && s.timestamp <= endTime
    );

    if (snapshots.length === 0) {
      return {
        startTime: start,
        endTime,
        snapshots: [],
        aggregated: {
          avgLatency: 0,
          p50Latency: 0,
          p95Latency: 0,
          p99Latency: 0,
          totalTokens: 0,
          avgQuality: 0,
          totalCost: 0
        }
      };
    }

    const latencies = snapshots.map(s => s.latencyMs).sort((a, b) => a - b);
    const totalTokens = snapshots.reduce((sum, s) => sum + s.tokenCount, 0);
    const totalCost = snapshots.reduce((sum, s) => sum + s.costUnits, 0);
    const avgQuality = snapshots.reduce((sum, s) => sum + s.qualityScore, 0) / snapshots.length;

    return {
      startTime: start,
      endTime,
      snapshots,
      aggregated: {
        avgLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length,
        p50Latency: this.percentile(latencies, 0.5),
        p95Latency: this.percentile(latencies, 0.95),
        p99Latency: this.percentile(latencies, 0.99),
        totalTokens,
        avgQuality,
        totalCost
      }
    };
  }

  /**
   * Calculate percentile
   */
  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Register event handler
   */
  onEvent(type: string, handler: (event: TelemetryEvent) => void): () => void {
    const handlers = this.eventHandlers.get(type) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(type, handlers);

    // Return unsubscribe function
    return () => {
      const current = this.eventHandlers.get(type) ?? [];
      const filtered = current.filter(h => h !== handler);
      this.eventHandlers.set(type, filtered);
    };
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): readonly Alert[] {
    return this.alerts.filter(a => !a.acknowledged);
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      (alert as { acknowledged: boolean }).acknowledged = true;
      return true;
    }
    return false;
  }

  /**
   * Get telemetry events
   */
  getTelemetryEvents(
    type?: string,
    level?: TelemetryEvent["level"],
    limit: number = 100
  ): readonly TelemetryEvent[] {
    let events = this.telemetryEvents;
    
    if (type) {
      events = events.filter(e => e.type === type);
    }
    if (level) {
      events = events.filter(e => e.level === level);
    }
    
    return events.slice(-limit);
  }

  /**
   * Get performance history
   */
  getPerformanceHistory(limit: number = 100): readonly PerformanceSnapshot[] {
    return this.performanceHistory.slice(-limit);
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.telemetryEvents = [];
    this.performanceHistory = [];
    this.alerts = [];
    this.alertStartTimes.clear();
  }
}