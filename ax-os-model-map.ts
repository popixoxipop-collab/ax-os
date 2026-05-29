/**
 * AX OS - Model Specialization Map (Phase 10)
 *
 * Maps available Ollama models to specific agent roles based on:
 *   1. Model name patterns (qwen2.5-coder → code role)
 *   2. Model size (larger = more capable, slower)
 *   3. Custom overrides
 *
 * Auto-discovers available Ollama models and assigns roles.
 */

import { AgentDefinition, AgentProvider } from "./ax-os-agent-types.js";

// ── Role definitions ──────────────────────────────────────────────────────────

export type ModelRole =
  | "embed"       // embedding only (all-minilm)
  | "fast"        // quick classification, routing hints (small models)
  | "code"        // code/expression generation
  | "analyze"     // data analysis, reasoning
  | "research"    // paper reading, synthesis
  | "plan"        // multi-step planning
  | "general"     // catch-all

export interface ModelProfile {
  readonly name:      string;
  readonly sizeGB:    number;
  readonly roles:     ModelRole[];
  readonly priority:  Partial<Record<ModelRole, number>>;  // 0–1
  readonly provider:  AgentProvider;
}

// ── Pattern-based role assignment ─────────────────────────────────────────────

const ROLE_PATTERNS: Array<{ pattern: RegExp; roles: ModelRole[]; priority: Partial<Record<ModelRole, number>> }> = [
  { pattern: /all-minilm/i,     roles: ["embed"],                           priority: { embed: 1.0 } },
  { pattern: /coder/i,          roles: ["code","general"],                  priority: { code: 0.95, general: 0.65 } },
  { pattern: /qwen.*32b/i,      roles: ["code","analyze","plan","general"], priority: { code: 0.92, analyze: 0.85, plan: 0.80 } },
  { pattern: /qwen.*14b/i,      roles: ["analyze","research","general"],    priority: { analyze: 0.88, research: 0.82, plan: 0.75 } },
  { pattern: /llama3\.3/i,      roles: ["general","analyze","research"],    priority: { general: 0.85, analyze: 0.80, research: 0.78 } },
  { pattern: /hades.*trunk/i,   roles: ["code","analyze","general"],        priority: { code: 0.80, analyze: 0.78, general: 0.75 } },  // custom domain
  { pattern: /gpt.oss.*20b/i,   roles: ["analyze","research","plan"],       priority: { analyze: 0.85, research: 0.88, plan: 0.82 } },
  { pattern: /mistral/i,        roles: ["fast","general","analyze"],        priority: { fast: 0.80, general: 0.72, analyze: 0.68 } },
  { pattern: /llama3\.2/i,      roles: ["fast","general"],                  priority: { fast: 0.85, general: 0.70 } },
  { pattern: /moondream/i,      roles: ["fast"],                            priority: { fast: 0.70 } },
  { pattern: /llava/i,          roles: ["fast"],                            priority: { fast: 0.65 } },
  { pattern: /phi/i,            roles: ["fast","general"],                  priority: { fast: 0.82, general: 0.68 } },
];

// Model size heuristics (GB) — used to infer capability
const SIZE_PATTERNS: Array<{ pattern: RegExp; sizeGB: number }> = [
  { pattern: /32b/i,  sizeGB: 19 },
  { pattern: /20b/i,  sizeGB: 13 },
  { pattern: /14b/i,  sizeGB: 9  },
  { pattern: /7b/i,   sizeGB: 5  },
  { pattern: /3b/i,   sizeGB: 2  },
  { pattern: /:latest$/i, sizeGB: 4 },
];

// ── ModelMap class ────────────────────────────────────────────────────────────

export class ModelMap {
  private profiles: Map<string, ModelProfile> = new Map();

  /** Discover models from Ollama API and build profiles. */
  async discover(ollamaBaseURL = "http://localhost:11434"): Promise<ModelProfile[]> {
    const resp = await fetch(`${ollamaBaseURL}/api/tags`);
    if (!resp.ok) throw new Error(`Ollama unreachable: ${resp.status}`);
    const data = (await resp.json()) as { models: Array<{ name: string; size: number }> };

    this.profiles.clear();
    for (const m of data.models) {
      const profile = this.buildProfile(m.name, m.size / 1e9);
      this.profiles.set(m.name, profile);
    }
    return [...this.profiles.values()];
  }

  private buildProfile(name: string, sizeGB: number): ModelProfile {
    // Find matching pattern
    const match = ROLE_PATTERNS.find(p => p.pattern.test(name));
    const roles    = match?.roles    ?? ["general"];
    const priority = match?.priority ?? { general: 0.60 };

    // Infer size if not provided
    let inferredSize = sizeGB;
    if (!inferredSize) {
      inferredSize = SIZE_PATTERNS.find(p => p.pattern.test(name))?.sizeGB ?? 4;
    }

    return { name, sizeGB: inferredSize, roles, priority, provider: "ollama" };
  }

  /** Best model for a given role. Prefers larger models for high-priority roles. */
  bestFor(role: ModelRole): ModelProfile | null {
    let best: ModelProfile | null = null;
    let bestScore = -1;
    for (const p of this.profiles.values()) {
      const pri = p.priority[role] ?? 0;
      if (pri === 0) continue;
      // Size bonus for non-embed roles (bigger = smarter)
      const sizeBonus = role === "embed" ? 0 : Math.min(p.sizeGB / 20, 0.1);
      const score = pri + sizeBonus;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  /** All models capable of a role, sorted by priority. */
  forRole(role: ModelRole): ModelProfile[] {
    return [...this.profiles.values()]
      .filter(p => (p.priority[role] ?? 0) > 0)
      .sort((a, b) => (b.priority[role] ?? 0) - (a.priority[role] ?? 0));
  }

  /** Build AgentDefinition stubs from discovered profiles. */
  toAgentDefs(roles?: ModelRole[]): AgentDefinition[] {
    const targetRoles = roles ?? ["code", "analyze", "research", "plan", "fast"];
    const seen = new Set<ModelRole>();
    const defs: AgentDefinition[] = [];

    for (const role of targetRoles) {
      if (seen.has(role)) continue;
      const profile = this.bestFor(role);
      if (!profile || profile.roles.includes("embed")) continue;
      seen.add(role);
      defs.push({
        id:                  `${role}-agent`,
        name:                `${role.charAt(0).toUpperCase() + role.slice(1)} Agent`,
        description:         `Specialized for ${role} tasks`,
        provider:            "ollama",
        model:               profile.name,
        capabilities:        profile.roles
          .filter(r => r !== "embed")
          .map(r => ({ name: r, description: `${r} capability`, priority: profile.priority[r] ?? 0.5 })),
        defaultMaxTokens:    role === "fast" ? 256 : 1024,
        defaultTemperature:  role === "code" ? 0.25 : 0.55,
        timeoutMs:           role === "fast" ? 15_000 : 90_000,
      });
    }
    return defs;
  }

  all(): ModelProfile[] { return [...this.profiles.values()]; }
  get(name: string): ModelProfile | null { return this.profiles.get(name) ?? null; }
}
