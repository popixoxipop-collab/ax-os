/**
 * AX OS - BRAIN Full Loop (Phase 8)
 *
 * Complete alpha discovery cycle:
 *   generate → validate → dedup_check → simulate → evaluate → record → store
 *
 * Simulation modes:
 *   BRAIN_REAL=1  → calls brain/simulator.py via Python subprocess (real BRAIN API)
 *   default       → mock simulator (fast, realistic SR distribution)
 *
 * Integrates all prior phases:
 *   - ReAct agent generates expressions (Phase 4)
 *   - VectorMemory dedup check (Phase 6)
 *   - AdaptiveRouter records outcomes (Phase 7)
 *   - SharedMemory persists session state (Phase 3)
 */

import { execSync } from "node:child_process";
import { VectorMemory } from "./ax-os-vector-memory.js";
import { AdaptiveRouter, OutcomeRecord } from "./ax-os-adaptive-router.js";
import { SharedMemory } from "./ax-os-memory.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SimResult {
  readonly expression: string;
  readonly sharpe:     number | null;
  readonly fitness:    number | null;
  readonly turnover:   number | null;
  readonly alphaId:    string | null;
  readonly error:      string | null;
}

export interface EvalResult {
  readonly passes:     boolean;
  readonly reason:     string;
  readonly qualityScore: number;   // 0–1 for AdaptiveRouter
}

export interface LoopCycleResult {
  readonly cycle:        number;
  readonly expression:   string;
  readonly valid:        boolean;
  readonly dupScore:     number;
  readonly skippedDup:   boolean;
  readonly sim:          SimResult | null;
  readonly eval:         EvalResult | null;
  readonly latencyMs:    number;
}

export interface BrainLoopConfig {
  readonly financePath:     string;    // ~/Desktop/Finance
  readonly dupThreshold:    number;    // default 0.88
  readonly submitThreshold: { sharpe: number; fitness: number };
  readonly mockMode:        boolean;   // true = mock simulator
  readonly agentId:         string;    // for AdaptiveRouter
}

// ── Validator bridge (Python subprocess) ─────────────────────────────────────

export function validateExpression(expression: string, financePath: string): {
  ok: boolean; errors: string[]; repaired: string | null;
} {
  const escaped = expression.replace(/'/g, "\\'").replace(/\\/g, "\\\\");
  try {
    const out = execSync(
      `cd "${financePath}" && python3 -c "
import sys, json
sys.path.insert(0, '.')
from brain.validator import validate, repair
ok, errs, _warns = validate('${escaped}')
rep, _fixes = repair('${escaped}') if not ok else (None, [])
print(json.dumps({'ok': ok, 'errors': errs, 'repaired': rep}))
"`, { timeout: 10_000, encoding: "utf8" }
    ).trim();
    const lastLine = out.split("\n").find(l => l.startsWith("{")) ?? "{}";
    return JSON.parse(lastLine) as { ok: boolean; errors: string[]; repaired: string | null };
  } catch (e) {
    // fallback: basic regex check
    const hasBalancedParens = (expression.match(/\(/g) ?? []).length === (expression.match(/\)/g) ?? []).length;
    return { ok: hasBalancedParens, errors: hasBalancedParens ? [] : ["unbalanced parentheses"], repaired: null };
  }
}

// ── Mock simulator ────────────────────────────────────────────────────────────

/** Deterministic mock SR based on expression features. */
export function mockSimulate(expression: string): SimResult {
  const GOOD_OPS = ["ts_decay_linear","ts_rank","rank","ts_corr","ts_std_dev","ts_mean"];
  const GOOD_FIELDS = ["operating_income","enterprise_value","bookvalue_ps","returns","beta"];

  let base = 0.5;
  for (const op of GOOD_OPS)    if (expression.includes(op))    base += 0.08;
  for (const f  of GOOD_FIELDS) if (expression.includes(f))     base += 0.06;

  // Expression complexity bonus
  const depth = (expression.match(/\(/g) ?? []).length;
  base += Math.min(depth * 0.03, 0.25);

  // Deterministic noise: hash expression → value in [-0.25, +0.25]
  let h = 0;
  for (let i = 0; i < expression.length; i++) h = (h * 31 + expression.charCodeAt(i)) >>> 0;
  const noise = ((h % 1000) / 1000 - 0.5) * 0.5;

  // NOTE: use unsigned >>> shifts — signed >> goes negative when h >= 2^31,
  // which produced impossible negative turnover (caught by real BRAIN sim 2026-05-30).
  const sharpe  = Math.max(0.1, Math.min(4.0, base + noise));
  const fitness = Math.max(0.1, Math.min(3.0, sharpe * (0.7 + ((h >>> 8) % 100) / 200)));
  const turnover = 0.1 + ((h >>> 16) % 100) / 200;

  return {
    expression,
    sharpe:   Math.round(sharpe  * 1000) / 1000,
    fitness:  Math.round(fitness * 1000) / 1000,
    turnover: Math.round(turnover* 1000) / 1000,
    alphaId:  `mock_${(h >>> 0).toString(16).slice(0, 8)}`,
    error:    null,
  };
}

// ── Real simulator bridge ─────────────────────────────────────────────────────

export function realSimulate(expression: string, financePath: string): SimResult {
  const escaped = expression.replace(/'/g, "\\'").replace(/\\/g, "\\\\");
  try {
    const out = execSync(
      `cd "${financePath}" && python3 -c "
import sys, json
sys.path.insert(0, '.')
from brain.simulator import run_simulate
results = run_simulate(['${escaped}'], concurrency=1)
print(json.dumps(results[0] if results else {}))
"`, { timeout: 1_800_000, encoding: "utf8" }  // 30 min timeout
    ).trim();
    const lastLine = out.split("\n").find(l => l.startsWith("{")) ?? "{}";
    const r = JSON.parse(lastLine) as Record<string, unknown>;
    return {
      expression,
      sharpe:   typeof r.sharpe  === "number" ? r.sharpe  : null,
      fitness:  typeof r.fitness === "number" ? r.fitness : null,
      turnover: typeof r.turnover=== "number" ? r.turnover: null,
      alphaId:  typeof r.alpha_id=== "string" ? r.alpha_id: null,
      error:    typeof r.error   === "string" ? r.error   : null,
    };
  } catch (e) {
    return { expression, sharpe: null, fitness: null, turnover: null, alphaId: null, error: String(e) };
  }
}

// ── Evaluator ─────────────────────────────────────────────────────────────────

export function evaluate(sim: SimResult, threshold: BrainLoopConfig["submitThreshold"]): EvalResult {
  if (sim.error || sim.sharpe === null) {
    return { passes: false, reason: `simulation error: ${sim.error ?? "no sharpe"}`, qualityScore: 0 };
  }
  const srPass  = sim.sharpe  >= threshold.sharpe;
  const fitPass = (sim.fitness ?? 0) >= threshold.fitness;

  const qualityScore = Math.min(1,
    (sim.sharpe  / (threshold.sharpe  * 2)) * 0.6 +
    ((sim.fitness ?? 0) / (threshold.fitness * 2)) * 0.4
  );

  if (srPass && fitPass) {
    return { passes: true,  reason: `SR=${sim.sharpe} FIT=${sim.fitness} ✓`, qualityScore };
  }
  const why = !srPass ? `SR=${sim.sharpe}<${threshold.sharpe}` : `FIT=${sim.fitness}<${threshold.fitness}`;
  return { passes: false, reason: why, qualityScore };
}

// ── Main loop orchestrator ────────────────────────────────────────────────────

export class BrainFullLoop {
  constructor(
    private readonly config: BrainLoopConfig,
    private readonly vectorMem: VectorMemory,
    private readonly router: AdaptiveRouter,
    private readonly sharedMem: SharedMemory
  ) {}

  async runCycle(
    expression: string,
    cycle: number,
    onProgress?: (msg: string) => void
  ): Promise<LoopCycleResult> {
    const t0    = Date.now();
    const emit  = (msg: string) => onProgress?.(`[cycle ${cycle}] ${msg}`);

    // 1. Validate
    emit(`validate: ${expression.slice(0, 60)}...`);
    const val = validateExpression(expression, this.config.financePath);
    const finalExpr = val.ok ? expression : (val.repaired ?? expression);
    if (!val.ok && !val.repaired) {
      return { cycle, expression, valid: false, dupScore: 0, skippedDup: false, sim: null, eval: null, latencyMs: Date.now() - t0 };
    }

    // 2. Dedup check
    emit("dedup check...");
    const simResults = await this.vectorMem.search("alphas", finalExpr, 1, 0);
    const dupScore = simResults[0]?.score ?? 0;
    if (dupScore >= this.config.dupThreshold) {
      emit(`⛔ dup (${(dupScore*100).toFixed(1)}% similar to ${simResults[0]?.key})`);
      return { cycle, expression: finalExpr, valid: true, dupScore, skippedDup: true, sim: null, eval: null, latencyMs: Date.now() - t0 };
    }
    emit(`dedup ok (${(dupScore*100).toFixed(1)}% — below ${(this.config.dupThreshold*100).toFixed(0)}% threshold)`);

    // 3. Simulate
    emit(`simulate (${this.config.mockMode ? "mock" : "real"})...`);
    const sim = this.config.mockMode
      ? mockSimulate(finalExpr)
      : realSimulate(finalExpr, this.config.financePath);

    // 4. Evaluate
    const evalResult = evaluate(sim, this.config.submitThreshold);
    emit(`eval: ${evalResult.reason}`);

    // 5. Record to AdaptiveRouter
    const outcome: OutcomeRecord = {
      agentId:      this.config.agentId,
      taskType:     "alpha_gen",
      success:      evalResult.passes,
      qualityScore: evalResult.qualityScore,
      latencyMs:    Date.now() - t0,
    };
    this.router.record(outcome);

    // 6. Store to VectorMemory (with metadata)
    await this.vectorMem.set("alphas", sim.alphaId ?? `gen_${Date.now().toString(36)}`, finalExpr, {
      sharpe: sim.sharpe, fitness: sim.fitness, source: "agent_gen", cycle,
    });

    // 7. Persist to SharedMemory
    this.sharedMem.set("brain_loop", `cycle_${cycle}`, JSON.stringify({
      expression: finalExpr, sharpe: sim.sharpe, fitness: sim.fitness,
      passes: evalResult.passes, ts: Date.now(),
    }));

    return {
      cycle, expression: finalExpr, valid: true,
      dupScore, skippedDup: false, sim, eval: evalResult,
      latencyMs: Date.now() - t0,
    };
  }
}
