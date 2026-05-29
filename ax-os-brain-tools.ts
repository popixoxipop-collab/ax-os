/**
 * AX OS - BRAIN-specific Tools
 * Tools that connect the agent orchestrator to the BRAIN alpha search pipeline.
 *
 * Registered tools:
 *   brain_query_top_alphas   — query top N alphas from results.db by sharpe range
 *   brain_query_patterns     — aggregate field/operator usage patterns
 *   brain_query_stats        — overall DB statistics
 *   brain_store_finding      — persist an agent's finding to SharedMemory
 *   brain_load_findings      — load prior findings from SharedMemory
 */

import { ToolDefinition } from "./ax-os-tools.js";

// node:sqlite available in Node 22+
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { DatabaseSync } = (await import("node:sqlite" as any)) as any;

const RESULTS_DB =
  process.env.BRAIN_DB_PATH ??
  "/Volumes/D50/brain_runtime/results.db";

// ── Helper: open DB read-only ─────────────────────────────────────────────────

function openDb() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new DatabaseSync(RESULTS_DB, { readOnly: true } as any);
}

// ── Tools ─────────────────────────────────────────────────────────────────────

/**
 * Query top alphas within a realistic sharpe range.
 * Excludes obvious outliers (sharpe > 10) and failed sims (sharpe <= 0).
 */
export const brainQueryTopAlphasTool: ToolDefinition = {
  name: "brain_query_top_alphas",
  description: "Query top N alphas from results.db, sorted by Sharpe ratio (filtered to realistic range)",
  parameters: {
    limit:     { type: "number",  description: "Number of rows to return",           required: false, default: 20 },
    minSharpe: { type: "number",  description: "Min sharpe filter",                  required: false, default: 0.5 },
    maxSharpe: { type: "number",  description: "Max sharpe filter (exclude outliers)",required: false, default: 5.0 },
    delay:     { type: "number",  description: "Filter by delay (0 or 1, -1=all)",   required: false, default: -1 },
  },
  async execute({ limit = 20, minSharpe = 0.5, maxSharpe = 5.0, delay = -1 }) {
    const db = openDb();
    try {
      const delayFilter = Number(delay) >= 0 ? `AND a.decay IS NOT NULL` : "";
      const rows = db.prepare(`
        SELECT
          a.id,
          a.expression,
          ROUND(a.sharpe, 4)       AS sharpe,
          ROUND(a.fitness, 4)      AS fitness,
          ROUND(a.turnover, 4)     AS turnover,
          a.neutralization,
          a.decay,
          a.status,
          a.submittable,
          s.source,
          s.stratum
        FROM alphas a
        LEFT JOIN alpha_sources s ON s.alpha_id = a.id
        WHERE a.sharpe >= ? AND a.sharpe <= ? ${delayFilter}
        ORDER BY a.sharpe DESC
        LIMIT ?
      `).all(Number(minSharpe), Number(maxSharpe), Number(limit));
      return rows;
    } finally {
      db.close();
    }
  },
};

/**
 * Analyze which operators/fields appear most in high-sharpe alphas.
 * Splits expression into tokens and counts occurrences.
 */
export const brainQueryPatternsTool: ToolDefinition = {
  name: "brain_query_patterns",
  description: "Analyze which operators and fields appear most frequently in top-performing alphas",
  parameters: {
    topN:      { type: "number", description: "How many top alphas to analyze", required: false, default: 200 },
    minSharpe: { type: "number", description: "Min sharpe threshold",           required: false, default: 0.8 },
    maxSharpe: { type: "number", description: "Max sharpe (exclude outliers)",  required: false, default: 5.0 },
  },
  async execute({ topN = 200, minSharpe = 0.8, maxSharpe = 5.0 }) {
    const db = openDb();
    try {
      const rows = db.prepare(`
        SELECT expression, sharpe FROM alphas
        WHERE sharpe >= ? AND sharpe <= ? AND expression IS NOT NULL
        ORDER BY sharpe DESC LIMIT ?
      `).all(Number(minSharpe), Number(maxSharpe), Number(topN)) as { expression: string; sharpe: number }[];

      // Token frequency analysis
      const opCount: Record<string, number> = {};
      const fieldCount: Record<string, number> = {};

      const OP_PATTERN = /\b(ts_rank|ts_mean|ts_std_dev|ts_delta|ts_decay_linear|ts_corr|rank|sign|log|abs|max|min|sum|zscore|winsorize|pasteurize|vec_avg|vec_sum|scale|decay_linear|ts_max|ts_min|ts_backfill)\b/g;
      const FIELD_PATTERN = /\b(close|volume|returns|beta|sharpe|enterprise_value|book_value|earnings|revenue|debt|equity|rsi|momentum|volatility|turnover|market_cap|pe_ratio|pb_ratio|ps_ratio|adv|vwap|open|high|low|fscore|snt1|cored1|unsystematic_risk|bookvalue_ps|quality|growth)\b/g;

      for (const row of rows) {
        const expr = row.expression ?? "";
        for (const m of expr.matchAll(OP_PATTERN))  opCount[m[1]]    = (opCount[m[1]] ?? 0) + 1;
        for (const m of expr.matchAll(FIELD_PATTERN)) fieldCount[m[1]] = (fieldCount[m[1]] ?? 0) + 1;
      }

      const sortedOps = Object.entries(opCount).sort((a, b) => b[1] - a[1]).slice(0, 15);
      const sortedFields = Object.entries(fieldCount).sort((a, b) => b[1] - a[1]).slice(0, 15);

      return {
        analyzedCount: rows.length,
        sharpeRange: { min: minSharpe, max: maxSharpe },
        topOperators: sortedOps.map(([op, count]) => ({ op, count })),
        topFields: sortedFields.map(([field, count]) => ({ field, count })),
      };
    } finally {
      db.close();
    }
  },
};

/** Overall DB statistics */
export const brainQueryStatsTool: ToolDefinition = {
  name: "brain_query_stats",
  description: "Get overall statistics from the BRAIN results.db",
  parameters: {},
  async execute() {
    const db = openDb();
    try {
      const total  = db.prepare(`SELECT COUNT(*) AS n FROM alphas`).get() as { n: number };
      const sr     = db.prepare(`SELECT MIN(sharpe) AS lo, MAX(sharpe) AS hi, AVG(sharpe) AS avg FROM alphas WHERE sharpe BETWEEN 0 AND 5`).get() as { lo: number; hi: number; avg: number };
      const submit = db.prepare(`SELECT COUNT(*) AS n FROM alphas WHERE sharpe >= 1.25 AND fitness >= 1.0`).get() as { n: number };
      const recent = db.prepare(`SELECT COUNT(*) AS n FROM alphas WHERE created_at >= datetime('now','-1 day')`).get() as { n: number };
      return {
        totalAlphas: total.n,
        submittable: submit.n,
        last24h: recent.n,
        sharpeStats: { min: sr.lo, max: sr.hi, avg: Math.round((sr.avg ?? 0) * 1000) / 1000 },
      };
    } finally {
      db.close();
    }
  },
};

/** Store an agent finding in SharedMemory under the "brain" namespace. */
export const brainStoreFindingTool: ToolDefinition = {
  name: "brain_store_finding",
  description: "Persist an agent's research finding to SharedMemory (brain namespace)",
  parameters: {
    key:   { type: "string", description: "Finding key (e.g. 'top_operators_2026-05-29')", required: true },
    value: { type: "string", description: "Finding content",                                required: true },
  },
  async execute({ key, value }, { memory }) {
    memory.set("brain", String(key), String(value));
    return { stored: true, key, namespace: "brain" };
  },
};

/** Load all prior findings from SharedMemory brain namespace. */
export const brainLoadFindingsTool: ToolDefinition = {
  name: "brain_load_findings",
  description: "Load all prior agent findings from SharedMemory (brain namespace)",
  parameters: {
    prefix: { type: "string", description: "Key prefix filter (empty = all)", required: false, default: "" },
  },
  async execute({ prefix = "" }, { memory }) {
    const entries = prefix
      ? memory.search("brain", String(prefix))
      : memory.list("brain");
    return entries.map(e => ({ key: e.key, value: e.value }));
  },
};
