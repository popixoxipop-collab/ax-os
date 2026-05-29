/**
 * AX OS - AEQ Integration (Phase 12)
 *
 * Connects Adaptive Expert Quantization (AEQ) research to the AX OS model pool.
 * AEQ compresses MoE models (R01=BF16, R09+=MXFP4) for faster local inference.
 *
 * When AEQ-compressed models are available, they are registered as preferred
 * agents in the AgentRegistry, replacing full-size counterparts.
 *
 * Status tracking:
 *   - "available": compressed model file exists on disk
 *   - "training":  AEQ training in progress (Kaggle/RunPod job)
 *   - "pending":   not yet started
 */

import { AgentDefinition } from "./ax-os-agent-types.js";
import { SharedMemory }    from "./ax-os-memory.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type AEQStatus = "available" | "training" | "pending" | "failed";

export interface AEQModelConfig {
  readonly baseModel:       string;     // original model name (e.g. "gpt-oss:20b")
  readonly compressedPath:  string;     // path to compressed .gguf or adapter
  readonly quantScheme:     string;     // e.g. "R01=BF16,R09-R32=MXFP4,R33+=INT2"
  readonly expectedVRAM_GB: number;     // expected VRAM usage post-compression
  readonly expectedSpeedup: number;     // expected inference speedup vs base
  readonly capabilities:    string[];   // same as base model
  readonly status:          AEQStatus;
}

export interface AEQRegistry {
  readonly models:     AEQModelConfig[];
  readonly updatedAt:  number;
  readonly localGPU:   { model: string; vram_GB: number; sm_version: string };
}

// ── Default AEQ configs for models in the user's Ollama pool ─────────────────
// Based on aeq_research_direction.md and aeq_gpu_environment.md memories

export const DEFAULT_AEQ_CONFIGS: AEQModelConfig[] = [
  {
    baseModel:       "gpt-oss:20b",
    compressedPath:  "~/Desktop/AEQ/models/gpt-oss-20b-aeq.gguf",
    quantScheme:     "R01=BF16, R02-R08=FP8, R09-R32=MXFP4, R33+=INT2/prune",
    expectedVRAM_GB: 8.5,      // vs 13GB base (~35% reduction)
    expectedSpeedup: 1.6,
    capabilities:    ["analyze", "research", "plan"],
    status:          "pending",
  },
  {
    baseModel:       "hades-trunk-current:latest",
    compressedPath:  "~/Desktop/AEQ/models/hades-aeq.gguf",
    quantScheme:     "R01=BF16, R09+=MXFP4",
    expectedVRAM_GB: 4.8,      // vs 9GB base (~47% reduction)
    expectedSpeedup: 1.9,
    capabilities:    ["code", "analyze", "alpha_gen"],
    status:          "pending",
  },
  {
    baseModel:       "qwen2.5:14b-instruct",
    compressedPath:  "~/Desktop/AEQ/models/qwen-14b-aeq.gguf",
    quantScheme:     "R01=BF16, R09+=MXFP4, uniform attention",
    expectedVRAM_GB: 5.2,      // vs 9GB base (~42% reduction)
    expectedSpeedup: 1.7,
    capabilities:    ["analyze", "research", "summarize"],
    status:          "pending",
  },
];

// ── AEQ Runtime Config (RTX 5070 Ti: 15.9GB VRAM) ────────────────────────────

export const LOCAL_GPU = {
  model:      "RTX 5070 Ti",
  vram_GB:    15.9,
  sm_version: "SM12.0",
  bw_GBs:     576,
  tflops_bf16: 45,
};

// ── AEQIntegration class ──────────────────────────────────────────────────────

export class AEQIntegration {
  private readonly memory: SharedMemory;
  private configs: AEQModelConfig[];

  constructor(memory: SharedMemory, configs = DEFAULT_AEQ_CONFIGS) {
    this.memory  = memory;
    this.configs = [...configs];
  }

  /** Load status updates from SharedMemory (set by AEQ training jobs). */
  loadStatus(): void {
    for (let i = 0; i < this.configs.length; i++) {
      const key    = `aeq_status_${this.configs[i].baseModel.replace(/[:/]/g, "_")}`;
      const saved  = this.memory.get("aeq", key);
      if (saved) {
        const parsed = JSON.parse(saved) as { status: AEQStatus; compressedPath?: string };
        this.configs[i] = { ...this.configs[i], ...parsed };
      }
    }
  }

  /** Report a status update (called by AEQ training pipeline). */
  updateStatus(baseModel: string, status: AEQStatus, compressedPath?: string): void {
    const key = `aeq_status_${baseModel.replace(/[:/]/g, "_")}`;
    const update: Record<string, unknown> = { status, updatedAt: Date.now() };
    if (compressedPath) update.compressedPath = compressedPath;
    this.memory.set("aeq", key, JSON.stringify(update));
    const idx = this.configs.findIndex(c => c.baseModel === baseModel);
    if (idx >= 0) this.configs[idx] = { ...this.configs[idx], status, ...(compressedPath ? { compressedPath } : {}) };
  }

  /** Return AgentDefinition overrides for available AEQ models. */
  getAvailableAgentOverrides(): Partial<AgentDefinition>[] {
    return this.configs
      .filter(c => c.status === "available")
      .map(c => ({
        model:       `aeq:${c.baseModel}`,   // Ollama model name for AEQ variant
        description: `AEQ-compressed ${c.baseModel} (${c.quantScheme.slice(0, 40)})`,
        capabilities: c.capabilities.map(name => ({
          name,
          description: `${name} (AEQ-optimized)`,
          priority:    0.92,   // slightly boosted: faster = more responsive
        })),
      }));
  }

  /** Summary report for logging. */
  summary(): string {
    const gpu   = LOCAL_GPU;
    const lines = [
      `AEQ Integration Summary (${gpu.model}, ${gpu.vram_GB}GB, SM${gpu.sm_version})`,
      "",
    ];

    for (const c of this.configs) {
      const icon   = c.status === "available" ? "✅" : c.status === "training" ? "⏳" : "⏸️";
      const savings = ((1 - c.expectedVRAM_GB / 13) * 100).toFixed(0); // vs 13GB ref
      lines.push(`${icon} ${c.baseModel}`);
      lines.push(`   scheme:   ${c.quantScheme.slice(0, 60)}`);
      lines.push(`   VRAM:     ${c.expectedVRAM_GB}GB (${savings}% savings)`);
      lines.push(`   speedup:  ${c.expectedSpeedup}×`);
      lines.push(`   status:   ${c.status}`);
      lines.push("");
    }

    // VRAM planning: which AEQ models can run simultaneously
    const available = this.configs.filter(c => c.status === "available");
    if (available.length >= 2) {
      const totalVRAM = available.reduce((s, c) => s + c.expectedVRAM_GB, 0);
      lines.push(`Simultaneous loading: ${available.length} models = ${totalVRAM.toFixed(1)}GB`);
      lines.push(totalVRAM <= gpu.vram_GB
        ? `✅ Fits in ${gpu.vram_GB}GB VRAM — parallel agents possible`
        : `⚠️  Exceeds ${gpu.vram_GB}GB — sequential loading required`);
    }

    return lines.join("\n");
  }

  all(): AEQModelConfig[] { return [...this.configs]; }
}
