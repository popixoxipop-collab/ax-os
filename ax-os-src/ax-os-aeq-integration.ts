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
  // NOTE: VRAM/speedup below are UNVERIFIED estimates for a CUDA target machine
  // (not measured). The MEASURED results that contradict the mixed-precision
  // assumption are in AEQ_MEASURED_2026_05_30 — read that before trusting these.
  {
    baseModel:       "gpt-oss:20b",
    compressedPath:  "~/Desktop/AEQ/models/gpt-oss-20b-aeq.gguf",
    quantScheme:     "R01=BF16, R02-R08=FP8, R09-R32=MXFP4, R33+=INT2/prune",
    expectedVRAM_GB: 8.5,      // ESTIMATE — not measured
    expectedSpeedup: 1.6,      // ESTIMATE — not measured
    capabilities:    ["analyze", "research", "plan"],
    status:          "pending",
  },
  {
    baseModel:       "hades-trunk-current:latest",
    compressedPath:  "~/Desktop/AEQ/models/hades-aeq.gguf",
    quantScheme:     "R01=BF16, R09+=MXFP4",
    expectedVRAM_GB: 4.8,      // ESTIMATE — not measured
    expectedSpeedup: 1.9,      // ESTIMATE — not measured
    capabilities:    ["code", "analyze", "alpha_gen"],
    status:          "pending",
  },
];

// ── MEASURED AEQ benchmark (2026-05-30, M1 Max, MLX 0.31.2) ──────────────────
// Qwen2.5-1.5B-Instruct quantized 5 ways, perplexity on a fixed eval text.
// KEY FINDING (contradicts the Phase-12 assumption):
//   For a small DENSE model, uniform q4 beats mixed-precision on BOTH size
//   AND quality. The 2–3 bit low-bit layers in mixed recipes destroy quality.
//   AEQ mixed-precision only plausibly pays off on LARGE MoE models with high
//   expert redundancy — that hypothesis is NOT yet tested. (CLAUDE.md §13)
export interface AEQMeasurement {
  readonly variant:     string;
  readonly sizeMB:      number;
  readonly compression: number;   // vs bf16
  readonly perplexity:  number;   // lower = better (fixed eval text)
  readonly tokPerSec:   number;
}

export const AEQ_MEASURED_2026_05_30 = {
  model:    "Qwen2.5-1.5B-Instruct",
  platform: "Apple M1 Max, MLX 0.31.2",
  evalText: "fixed 40-token paragraph on quantization",
  results: [
    { variant: "bf16",          sizeMB: 2970, compression: 1.00, perplexity: 48.183,     tokPerSec: 23.0 },
    { variant: "q8_uniform",    sizeMB: 1577, compression: 1.88, perplexity: 46.700,     tokPerSec: 22.7 },
    { variant: "q4_uniform",    sizeMB: 840,  compression: 3.54, perplexity: 59.964,     tokPerSec: 35.6 },
    { variant: "aeq_mixed_3_6", sizeMB: 736,  compression: 4.04, perplexity: 130.974,    tokPerSec: 30.3 },
    { variant: "aeq_mixed_2_6", sizeMB: 566,  compression: 5.25, perplexity: 162754.791, tokPerSec: 33.2 },
  ] as AEQMeasurement[],
  conclusion:
    "On Qwen2.5-1.5B (dense), uniform q4 is the sweet spot: 3.54x compression, " +
    "perplexity 60 (vs 48 bf16), 35.6 tok/s. Mixed-precision recipes are WORSE " +
    "on both axes — mixed_3_6 ppl=131, mixed_2_6 collapses (ppl 162k). " +
    "Mixed-precision/AEQ must be re-validated on large MoE before adoption.",
};

// ── Runtime config for the CUDA target machine (NOT this Mac) ────────────────
// This session ran on Apple M1 Max (Metal). The RTX 5070 Ti is a separate box.
export const LOCAL_GPU = {
  model:      "RTX 5070 Ti",   // separate CUDA machine, not the measurement host
  vram_GB:    15.9,
  sm_version: "SM12.0",
  bw_GBs:     576,
  tflops_bf16: 45,
};

export const MEASUREMENT_HOST = {
  model:      "Apple M1 Max",
  unifiedRAM_GB: 68.7,
  backend:    "MLX / Metal",
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
