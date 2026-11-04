import type { SqlAdapter, SqlRow, SqlStatement } from "../core/sql.ts";

/** The part of a Worker's D1 binding this uses, stated here so the store needs no Cloudflare types. */
export interface D1DatabaseLike {
  prepare(sql: string): { bind(...values: unknown[]): unknown };
  batch(statements: never[]): Promise<readonly { readonly results: readonly unknown[] }[]>;
}

/** A Worker's own D1 database. A batch is one transaction, and the binding has no shared API limit to share. */
export class D1BindingAdapter implements SqlAdapter {
  readonly #db: D1DatabaseLike;

  constructor(db: D1DatabaseLike) {
    this.#db = db;
  }

  async execute(statements: readonly SqlStatement[]): Promise<SqlRow[][]> {
    const results = await this.#db.batch(statements.map(({ sql, params = [] }) => this.#db.prepare(sql).bind(...params)) as never[]);
    return results.map(({ results: rows }) => rows as SqlRow[]);
  }
}
