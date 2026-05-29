/**
 * AX OS - Eval Framework (Phase 9)
 *
 * Adversarial review: N independent evaluators try to refute an output.
 * Majority vote gates whether output proceeds to the next stage.
 *
 * Patterns:
 *   - adversarial_review: spawn N critics, each tries to find flaws
 *   - perspective_diverse: N evaluators with different lenses
 *   - confidence_gate: block outputs below confidence threshold
 */

import { LLMClient, CapacityLevel } from "./ax-os-types.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type EvalLens =
  | "correctness"     // Is the logic correct?
  | "feasibility"     // Is this implementable in BRAIN?
  | "novelty"         // Is this genuinely different from known approaches?
  | "risk"            // What can go wrong?
  | "statistical";    // Is the SR/FIT claim statistically sound?

export interface EvalVote {
  readonly lens:      EvalLens;
  readonly pass:      boolean;       // true = output survives this lens
  readonly confidence: number;       // 0–1
  readonly critique:  string;        // what the evaluator found
  readonly latencyMs: number;
}

export interface EvalResult {
  readonly subject:    string;       // what was evaluated (truncated)
  readonly votes:      EvalVote[];
  readonly passPct:    number;       // fraction of votes that pass
  readonly approved:   boolean;      // passPct >= approvalThreshold
  readonly summary:    string;       // aggregated critique
  readonly totalTokens: number;
}

export interface EvalConfig {
  readonly lenses:             EvalLens[];
  /** Fraction of lenses that must pass. Default: 0.6 */
  readonly approvalThreshold?: number;
  readonly maxTokensPerEval?:  number;
  readonly temperature?:       number;
}

// ── Default lenses for BRAIN alpha evaluation ─────────────────────────────────

export const BRAIN_EVAL_LENSES: EvalLens[] = ["correctness","feasibility","novelty","statistical"];

const LENS_PROMPTS: Record<EvalLens, string> = {
  correctness:   "Evaluate whether the alpha expression logic is mathematically correct. Find any logical flaws, circular dependencies, or nonsensical combinations.",
  feasibility:   "Evaluate whether this alpha expression can actually run in WorldQuant BRAIN. Check operator names, field names, and argument counts for validity.",
  novelty:       "Evaluate whether this alpha expression represents a genuinely novel signal, or if it is trivially similar to common known patterns.",
  risk:          "Evaluate the risk profile of this alpha. What market regimes would cause it to fail? What are the failure modes?",
  statistical:   "Evaluate whether the claimed or expected Sharpe Ratio is statistically plausible given the expression's complexity and the fields used.",
};

// ── Evaluator ─────────────────────────────────────────────────────────────────

export class AdversarialEvaluator {
  constructor(
    private readonly client: LLMClient,
    private readonly config: EvalConfig
  ) {}

  private async runLens(
    subject: string,
    lens: EvalLens,
    context: string,
    capacity: CapacityLevel
  ): Promise<EvalVote> {
    const t0 = Date.now();
    const prompt = `You are a critical evaluator. Your lens: ${lens.toUpperCase()}.

${LENS_PROMPTS[lens]}

Evaluate this alpha expression:
${subject}

Additional context:
${context || "none"}

Reply in EXACTLY this format (no other text):
PASS: yes|no
CONFIDENCE: 0.0-1.0
CRITIQUE: <one paragraph explaining your finding>`;

    try {
      const resp = await this.client.generate(
        { prompt, maxTokens: this.config.maxTokensPerEval ?? 256, temperature: this.config.temperature ?? 0.4, topP: 0.9 },
        capacity
      );

      const text = resp.text;
      const passMatch = text.match(/PASS:\s*(yes|no)/i);
      const confMatch = text.match(/CONFIDENCE:\s*([\d.]+)/i);
      const critMatch = text.match(/CRITIQUE:\s*([\s\S]*)/i);

      return {
        lens,
        pass:       passMatch?.[1]?.toLowerCase() === "yes",
        confidence: parseFloat(confMatch?.[1] ?? "0.5"),
        critique:   critMatch?.[1]?.trim() ?? text.slice(0, 200),
        latencyMs:  Date.now() - t0,
      };
    } catch (e) {
      return { lens, pass: false, confidence: 0, critique: `error: ${e}`, latencyMs: Date.now() - t0 };
    }
  }

  async evaluate(
    subject: string,
    context = "",
    capacity: CapacityLevel = 3
  ): Promise<EvalResult> {
    const threshold = this.config.approvalThreshold ?? 0.6;

    // Run all lenses in parallel
    const votes = await Promise.all(
      this.config.lenses.map(lens => this.runLens(subject, lens, context, capacity))
    );

    const passCount  = votes.filter(v => v.pass).length;
    const passPct    = passCount / votes.length;
    const approved   = passPct >= threshold;
    const totalTokens = 0; // approximate; not tracked per-lens easily

    const summary = votes
      .map(v => `[${v.lens}:${v.pass?"PASS":"FAIL"} ${(v.confidence*100).toFixed(0)}%] ${v.critique.slice(0, 100)}`)
      .join("\n");

    return {
      subject: subject.slice(0, 150),
      votes,
      passPct,
      approved,
      summary,
      totalTokens,
    };
  }
}

// ── Confidence gate ────────────────────────────────────────────────────────────

/**
 * Simple gate: run a single evaluator, check confidence.
 * Use when full adversarial panel is too expensive.
 */
export async function confidenceGate(
  subject: string,
  client: LLMClient,
  threshold = 0.7,
  capacity: CapacityLevel = 3
): Promise<{ pass: boolean; confidence: number; reason: string }> {
  const prompt = `Rate the quality of this alpha expression on a scale of 0.0 to 1.0.
Expression: ${subject}
Reply ONLY: SCORE: 0.0-1.0\nREASON: <brief>`;

  const resp = await client.generate(
    { prompt, maxTokens: 100, temperature: 0.3, topP: 0.9 },
    capacity
  );
  const scoreMatch = resp.text.match(/SCORE:\s*([\d.]+)/i);
  const reasonMatch = resp.text.match(/REASON:\s*(.*)/i);
  const score = parseFloat(scoreMatch?.[1] ?? "0");
  return { pass: score >= threshold, confidence: score, reason: reasonMatch?.[1]?.trim() ?? "" };
}
