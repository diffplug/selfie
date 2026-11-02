import { DatabaseSync } from "node:sqlite";
import type { SqlAdapter, SqlRow, SqlStatement } from "../core/index.ts";

// How long a connection waits on another connection's lock before failing.
const BUSY_TIMEOUT_MS = 30_000;

/**
 * Local SQL through node:sqlite. One instance is one connection; open several on
 * the same file for several connections.
 *
 * Statements block the calling thread, including on another connection's lock:
 * node:sqlite's `Database` class is synchronous too in Node 26. So connections
 * on one thread never overlap, and only separate threads or processes contend.
 */
export class SqliteAdapter implements SqlAdapter {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS });
  }

  async execute(statements: readonly SqlStatement[]): Promise<SqlRow[][]> {
    return statements.map(({ sql, params = [] }) => {
      const rows = this.#db.prepare(sql).all(...params);
      return rows.map((row) => ({ ...row }) as SqlRow);
    });
  }

  close(): void {
    this.#db.close();
  }
}
