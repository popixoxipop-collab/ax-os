/**
 * AX OS - SharedMemory (Layer 5)
 * SQLite-backed persistent key-value store shared across agents and runs.
 * Uses node:sqlite (Node 22+).
 */

// node:sqlite is available in Node 22+. Type stub for TS compilation.
// At runtime this resolves to the built-in module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { DatabaseSync } = (await import("node:sqlite" as any)) as any;

// ── Types ────────────────────────────────────────────────────────────────────

export interface MemoryEntry {
  readonly namespace: string;
  readonly key: string;
  readonly value: string;
  readonly createdAt: number;
  readonly expiresAt: number | null;
}

export interface MemoryStats {
  readonly totalEntries: number;
  readonly namespaces: string[];
  readonly expiredPurged: number;
}

// ── Implementation ───────────────────────────────────────────────────────────

export class SharedMemory {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly db: any;

  constructor(dbPath = ":memory:") {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ax_memory (
        namespace TEXT NOT NULL,
        key       TEXT NOT NULL,
        value     TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        PRIMARY KEY (namespace, key)
      );
      CREATE INDEX IF NOT EXISTS idx_ax_memory_ns ON ax_memory(namespace);
    `);
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  set(namespace: string, key: string, value: string, ttlMs?: number): void {
    const now = Date.now();
    const expiresAt = ttlMs != null ? now + ttlMs : null;
    this.db.prepare(`
      INSERT INTO ax_memory (namespace, key, value, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(namespace, key) DO UPDATE SET
        value = excluded.value,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at
    `).run(namespace, key, value, now, expiresAt);
  }

  setJSON(namespace: string, key: string, value: unknown, ttlMs?: number): void {
    this.set(namespace, key, JSON.stringify(value), ttlMs);
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  get(namespace: string, key: string): string | null {
    const row = this.db.prepare(`
      SELECT value, expires_at FROM ax_memory
      WHERE namespace = ? AND key = ?
    `).get(namespace, key) as { value: string; expires_at: number | null } | undefined;

    if (!row) return null;
    if (row.expires_at != null && row.expires_at < Date.now()) {
      this.delete(namespace, key);
      return null;
    }
    return row.value;
  }

  getJSON<T = unknown>(namespace: string, key: string): T | null {
    const raw = this.get(namespace, key);
    if (raw == null) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }

  /** All non-expired entries in a namespace. */
  list(namespace: string): MemoryEntry[] {
    const now = Date.now();
    return (this.db.prepare(`
      SELECT namespace, key, value, created_at, expires_at
      FROM ax_memory
      WHERE namespace = ? AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC
    `).all(namespace, now) as MemoryEntry[]);
  }

  /** Keys whose key LIKE prefix% in a namespace. */
  search(namespace: string, prefix: string): MemoryEntry[] {
    const now = Date.now();
    return (this.db.prepare(`
      SELECT namespace, key, value, created_at, expires_at
      FROM ax_memory
      WHERE namespace = ? AND key LIKE ? AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC
    `).all(namespace, `${prefix}%`, now) as MemoryEntry[]);
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  delete(namespace: string, key: string): boolean {
    const r = this.db.prepare(
      `DELETE FROM ax_memory WHERE namespace = ? AND key = ?`
    ).run(namespace, key);
    return r.changes > 0;
  }

  clear(namespace?: string): number {
    const r = namespace
      ? this.db.prepare(`DELETE FROM ax_memory WHERE namespace = ?`).run(namespace)
      : this.db.prepare(`DELETE FROM ax_memory`).run();
    return r.changes;
  }

  // ── Housekeeping ───────────────────────────────────────────────────────────

  /** Remove expired entries. Returns count purged. */
  purgeExpired(): number {
    const r = this.db.prepare(
      `DELETE FROM ax_memory WHERE expires_at IS NOT NULL AND expires_at < ?`
    ).run(Date.now());
    return r.changes;
  }

  stats(): MemoryStats {
    const total = (this.db.prepare(`SELECT COUNT(*) as n FROM ax_memory`).get() as { n: number }).n;
    const nsRows = this.db.prepare(
      `SELECT DISTINCT namespace FROM ax_memory ORDER BY namespace`
    ).all() as { namespace: string }[];
    const purged = this.purgeExpired();
    return { totalEntries: total, namespaces: nsRows.map(r => r.namespace), expiredPurged: purged };
  }
}
