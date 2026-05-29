/**
 * AX OS v2 — Phase 6: Vector Memory Demo
 *
 * 3 시나리오:
 *   A. BRAIN 알파 표현식 임베딩 → 시맨틱 검색
 *   B. 에이전트 과거 발견 recall (Phase 3~5 findings)
 *   C. 중복/유사 알파 탐지 (dedup guard)
 *
 * Model: all-minilm:latest (45MB, 384-dim)
 *
 * Run: node ax-os-demo-phase6.mjs
 */

import { DatabaseSync } from "node:sqlite";

const OLLAMA_BASE = "http://localhost:11434";
const RESULTS_DB  = process.env.BRAIN_DB_PATH ?? "/Volumes/D50/brain_runtime/results.db";
const VECTOR_DB   = "/tmp/ax-os-vectors.db";
const MEMORY_DB   = "/tmp/ax-os-memory.db";
const EMBED_MODEL = "all-minilm:latest";

// ─── Math ──────────────────────────────────────────────────────────────────
function cosine(a, b) {
  let dot=0, na=0, nb=0;
  for(let i=0;i<a.length;i++){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}
  const d = Math.sqrt(na)*Math.sqrt(nb);
  return d===0?0:dot/d;
}
function f32ToBlob(arr) { return Buffer.from(arr.buffer); }
function blobToF32(buf) {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength);
  return new Float32Array(ab);
}

// ─── Embedder ─────────────────────────────────────────────────────────────
const _embedCache = new Map();
async function embed(text) {
  if(_embedCache.has(text)) return _embedCache.get(text);
  const r = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ model:EMBED_MODEL, prompt:text }),
    signal: AbortSignal.timeout(10_000),
  });
  if(!r.ok) throw new Error(`embed ${r.status}: ${await r.text()}`);
  const { embedding } = await r.json();
  const vec = new Float32Array(embedding);
  _embedCache.set(text, vec);
  return vec;
}

// ─── VectorMemory ─────────────────────────────────────────────────────────
class VectorMemory {
  constructor(path=":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ax_vectors(
        namespace TEXT, key TEXT, text TEXT,
        embedding BLOB, metadata TEXT DEFAULT '{}',
        created_at INTEGER,
        PRIMARY KEY(namespace,key)
      );
      CREATE INDEX IF NOT EXISTS idx_ns ON ax_vectors(namespace);
    `);
  }
  async set(ns, key, text, meta={}) {
    const vec = await embed(text);
    this.db.prepare(`INSERT INTO ax_vectors VALUES(?,?,?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET text=excluded.text,embedding=excluded.embedding,metadata=excluded.metadata,created_at=excluded.created_at`)
      .run(ns,key,text,f32ToBlob(vec),JSON.stringify(meta),Date.now());
  }
  count(ns) { return this.db.prepare(`SELECT COUNT(*) AS n FROM ax_vectors WHERE namespace=?`).get(ns).n; }
  async search(ns, query, topK=5, minScore=0.0) {
    const qvec = await embed(query);
    const rows = this.db.prepare(`SELECT key,text,embedding,metadata,created_at FROM ax_vectors WHERE namespace=?`).all(ns);
    return rows
      .map(r=>({ key:r.key, text:r.text, metadata:JSON.parse(r.metadata), score:cosine(qvec,blobToF32(r.embedding)) }))
      .filter(r=>r.score>=minScore)
      .sort((a,b)=>b.score-a.score)
      .slice(0,topK);
  }
  stats() {
    const n = this.db.prepare(`SELECT COUNT(*) AS n FROM ax_vectors`).get().n;
    const nss = this.db.prepare(`SELECT DISTINCT namespace FROM ax_vectors`).all().map(r=>r.namespace);
    return { total:n, namespaces:nss };
  }
}

// ─── SharedMemory (read prior findings) ───────────────────────────────────
class SharedMemory {
  constructor(path) {
    try {
      this.db = new DatabaseSync(path);
    } catch { this.db = null; }
  }
  list(ns) {
    if(!this.db) return [];
    try { return this.db.prepare(`SELECT key,value FROM ax_memory WHERE namespace=? ORDER BY created_at DESC`).all(ns); }
    catch { return []; }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function bar(score, width=20) {
  const filled = Math.round(score*width);
  return "█".repeat(filled)+"░".repeat(width-filled);
}
function shortExpr(expr, max=70) {
  return expr.length>max ? expr.slice(0,max-3)+"..." : expr;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────
(async()=>{
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  AX OS v2 — Phase 6: Vector Memory (Semantic Search)");
  console.log("  Model: all-minilm:latest (384-dim, ~5ms/embed)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // 1. Verify embedder
  process.stdout.write("Checking all-minilm... ");
  const testVec = await embed("test");
  console.log(`✓ dim=${testVec.length}\n`);

  const vm = new VectorMemory(VECTOR_DB);

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario A: Embed top BRAIN alpha expressions
  // ══════════════════════════════════════════════════════════════════════════
  console.log("─── Scenario A: Alpha Expression Semantic Index ─────────────────");
  console.log("Loading top alphas from results.db...");

  const brainDb = new DatabaseSync(RESULTS_DB, { readOnly:true });
  const topAlphas = brainDb.prepare(
    `SELECT id, expression, ROUND(sharpe,4) AS sharpe, ROUND(fitness,4) AS fitness, neutralization
     FROM alphas WHERE sharpe BETWEEN 0.8 AND 5 AND expression IS NOT NULL
     ORDER BY sharpe DESC LIMIT 60`
  ).all();
  brainDb.close();

  console.log(`Embedding ${topAlphas.length} alpha expressions...`);
  const t0 = Date.now();
  let embedded = 0;
  for(const a of topAlphas) {
    await vm.set("alphas", a.id, a.expression, { sharpe:a.sharpe, fitness:a.fitness, neutralization:a.neutralization });
    embedded++;
    if(embedded%10===0) process.stdout.write(`  ${embedded}/${topAlphas.length}\r`);
  }
  console.log(`\n✓ ${embedded} expressions embedded in ${((Date.now()-t0)/1000).toFixed(1)}s`);
  console.log(`  Avg: ${((Date.now()-t0)/embedded).toFixed(0)}ms/expr\n`);

  // Search queries
  const alphaQueries = [
    "operating income decay momentum strategy",
    "price volatility rank reversal",
    "correlation between returns and volume",
    "rank earnings growth value",
  ];

  for(const q of alphaQueries) {
    console.log(`\n🔍 Query: "${q}"`);
    console.log("─".repeat(63));
    const results = await vm.search("alphas", q, 4, 0.3);
    for(const r of results) {
      const meta = r.metadata;
      console.log(`  ${bar(r.score)} ${(r.score*100).toFixed(1)}%  SR=${meta.sharpe}`);
      console.log(`  ${shortExpr(r.text)}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario B: Embed prior agent findings → recall
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n\n─── Scenario B: Agent Findings Semantic Recall ──────────────────");
  const sharedMem = new SharedMemory(MEMORY_DB);
  const priorFindings = sharedMem.list("brain");

  if(priorFindings.length > 0) {
    console.log(`Loading ${priorFindings.length} prior findings from SharedMemory...`);
    for(const f of priorFindings) {
      await vm.set("findings", f.key, f.value, { source:"brain_namespace" });
    }
    console.log(`✓ Embedded ${priorFindings.length} findings\n`);

    const findingQueries = [
      "momentum and decay operators in high sharpe alphas",
      "operating income financial performance ranking",
      "alpha expression template recommendations",
    ];
    for(const q of findingQueries) {
      console.log(`🔍 "${q}"`);
      const results = await vm.search("findings", q, 2, 0.3);
      for(const r of results) {
        console.log(`  ${bar(r.score)} ${(r.score*100).toFixed(1)}%  key=${r.key}`);
        console.log(`  "${r.text.slice(0,120).replace(/\n/g," ")}..."`);
      }
      console.log();
    }
  } else {
    console.log("No prior findings in SharedMemory — skipping recall demo.");
    console.log("(Run Phase 3 demo first to populate findings)\n");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario C: Dedup guard — detect similar new alpha before simulating
  // ══════════════════════════════════════════════════════════════════════════
  console.log("─── Scenario C: Dedup Guard ─────────────────────────────────────");
  console.log("Simulates checking a new alpha against the existing index\n");

  const newCandidates = [
    "rank(ts_decay_linear(operating_income, 30))",
    "ts_rank(volume, 20) * sign(returns)",
    "rank(-ts_rank(enterprise_value, 5))",            // likely a near-duplicate
    "zscore(ts_delta(close, 5)) - ts_mean(close, 20)", // novel
  ];

  const DEDUP_THRESHOLD = 0.88;

  console.log(`  Threshold: ${DEDUP_THRESHOLD} (above = likely duplicate, skip simulation)`);
  console.log();

  for(const candidate of newCandidates) {
    const results = await vm.search("alphas", candidate, 1, 0.0);
    const top = results[0];
    const score = top?.score ?? 0;
    const isDup = score >= DEDUP_THRESHOLD;

    const status = isDup ? "⛔ SKIP (similar exists)" : "✅ NEW  (simulate this)";
    console.log(`  ${status}`);
    console.log(`  New    : ${shortExpr(candidate)}`);
    if(top) {
      console.log(`  Similar: ${shortExpr(top.text)} [SR=${top.metadata.sharpe}]`);
      console.log(`  Score  : ${bar(score)} ${(score*100).toFixed(1)}%`);
    }
    console.log();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Stats
  // ══════════════════════════════════════════════════════════════════════════
  const s = vm.stats();
  console.log("─── Vector Memory Stats ─────────────────────────────────────────");
  console.log(`  Namespaces : ${s.namespaces.join(", ")}`);
  console.log(`  Total vecs : ${s.total}`);
  console.log(`  Embed cache: ${_embedCache.size} entries`);

  console.log("\n" + "═".repeat(63));
  console.log("✅ Phase 6 complete — Vector Memory operational");
  console.log("   Semantic search over alpha expressions working");
  console.log("   Dedup guard ready for BRAIN pipeline integration");
  console.log("═".repeat(63) + "\n");
})().catch(e=>{ console.error(e); process.exit(1); });
