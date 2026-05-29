/**
 * AX OS - VectorMemory (Phase 6)
 *
 * Semantic search over stored text using Ollama embeddings.
 * Model: all-minilm:latest (45MB, 384-dim, ~5ms/embed on local CPU).
 * Storage: SQLite BLOB (Float32Array serialized as Buffer).
 *
 * Extends SharedMemory with two extra operations:
 *   embedSet()         — embed text, store vector + text
 *   similaritySearch() — embed query, rank by cosine similarity
 */

// node:sqlite available in Node 22+
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { DatabaseSync } = (await import("node:sqlite" as any)) as any;

// ── Types ────────────────────────────────────────────────────────────────────

export interface VectorEntry {
  readonly namespace: string;
  readonly key: string;
  readonly text: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: number;
}

export interface SearchResult extends VectorEntry {
  readonly score: number;   // cosine similarity 0–1
}

export interface EmbedderConfig {
  readonly baseURL?: string;
  readonly model?: string;
}

// ── Math ─────────────────────────────────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function float32ToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer);
}

function bufferToFloat32(buf: Uint8Array): Float32Array {
  // SQLite returns BLOBs as Uint8Array; copy to ArrayBuffer for Float32Array
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab as ArrayBuffer);
}

// ── Embedder ─────────────────────────────────────────────────────────────────

export class OllamaEmbedder {
  private readonly baseURL: string;
  private readonly model: string;
  private readonly cache = new Map<string, Float32Array>();

  constructor(config: EmbedderConfig = {}) {
    this.baseURL = config.baseURL ?? "http://localhost:11434";
    this.model   = config.model   ?? "all-minilm:latest";
  }

  async embed(text: string): Promise<Float32Array> {
    const key = `${this.model}:${text}`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    const resp = await fetch(`${this.baseURL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: text }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) throw new Error(`Ollama embed error ${resp.status}`);
    const data = (await resp.json()) as { embedding: number[] };
    const vec  = new Float32Array(data.embedding);
    this.cache.set(key, vec);
    return vec;
  }

  /** Embed a batch, returns in same order. */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }

  clearCache(): void { this.cache.clear(); }
}

// ── VectorMemory ─────────────────────────────────────────────────────────────

export class VectorMemory {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly db: any;
  readonly embedder: OllamaEmbedder;

  constructor(dbPath = ":memory:", embedderConfig: EmbedderConfig = {}) {
    this.db = new DatabaseSync(dbPath);
    this.embedder = new OllamaEmbedder(embedderConfig);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ax_vectors (
        namespace  TEXT    NOT NULL,
        key        TEXT    NOT NULL,
        text       TEXT    NOT NULL,
        embedding  BLOB    NOT NULL,
        metadata   TEXT    NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, key)
      );
      CREATE INDEX IF NOT EXISTS idx_axv_ns ON ax_vectors(namespace);
    `);
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  async set(
    namespace: string,
    key: string,
    text: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    const vec = await this.embedder.embed(text);
    this.db.prepare(`
      INSERT INTO ax_vectors (namespace, key, text, embedding, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, key) DO UPDATE SET
        text      = excluded.text,
        embedding = excluded.embedding,
        metadata  = excluded.metadata,
        created_at= excluded.created_at
    `).run(
      namespace,
      key,
      text,
      float32ToBuffer(vec),
      JSON.stringify(metadata),
      Date.now()
    );
  }

  /** Embed + store a batch. Logs progress for large batches. */
  async setBatch(
    namespace: string,
    entries: Array<{ key: string; text: string; metadata?: Record<string, unknown> }>,
    onProgress?: (done: number, total: number) => void
  ): Promise<void> {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      await this.set(namespace, e.key, e.text, e.metadata ?? {});
      onProgress?.(i + 1, entries.length);
    }
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  get(namespace: string, key: string): VectorEntry | null {
    const row = this.db.prepare(`
      SELECT key, text, metadata, created_at FROM ax_vectors
      WHERE namespace = ? AND key = ?
    `).get(namespace, key) as { key: string; text: string; metadata: string; created_at: number } | undefined;
    if (!row) return null;
    return { namespace, key: row.key, text: row.text, metadata: JSON.parse(row.metadata), createdAt: row.created_at };
  }

  list(namespace: string): VectorEntry[] {
    return (this.db.prepare(`
      SELECT key, text, metadata, created_at FROM ax_vectors WHERE namespace = ? ORDER BY created_at DESC
    `).all(namespace) as Array<{ key: string; text: string; metadata: string; created_at: number }>)
      .map(r => ({ namespace, key: r.key, text: r.text, metadata: JSON.parse(r.metadata), createdAt: r.created_at }));
  }

  count(namespace: string): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM ax_vectors WHERE namespace = ?`).get(namespace) as { n: number }).n;
  }

  // ── Semantic search ────────────────────────────────────────────────────────

  /**
   * Embed `query`, compute cosine similarity against all vectors in `namespace`,
   * return top-K results sorted by score descending.
   */
  async search(
    namespace: string,
    query: string,
    topK = 5,
    minScore = 0.0
  ): Promise<SearchResult[]> {
    const queryVec = await this.embedder.embed(query);

    const rows = this.db.prepare(`
      SELECT key, text, embedding, metadata, created_at FROM ax_vectors WHERE namespace = ?
    `).all(namespace) as Array<{ key: string; text: string; embedding: Uint8Array; metadata: string; created_at: number }>;

    const scored = rows.map(r => {
      const vec   = bufferToFloat32(r.embedding);
      const score = cosineSimilarity(queryVec, vec);
      return {
        namespace,
        key:      r.key,
        text:     r.text,
        metadata: JSON.parse(r.metadata) as Record<string, unknown>,
        createdAt: r.created_at,
        score,
      };
    });

    return scored
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  delete(namespace: string, key: string): boolean {
    return this.db.prepare(`DELETE FROM ax_vectors WHERE namespace = ? AND key = ?`).run(namespace, key).changes > 0;
  }

  clear(namespace: string): number {
    return this.db.prepare(`DELETE FROM ax_vectors WHERE namespace = ?`).run(namespace).changes;
  }

  stats(): { namespaces: string[]; totalVectors: number; embeddingDim: number } {
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM ax_vectors`).get() as { n: number }).n;
    const nss   = (this.db.prepare(`SELECT DISTINCT namespace FROM ax_vectors`).all() as { namespace: string }[]).map(r => r.namespace);
    return { namespaces: nss, totalVectors: total, embeddingDim: 384 };
  }
}
