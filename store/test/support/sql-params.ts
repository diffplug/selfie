import type { SqlAdapter, SqlRow } from "../../src/core/index.ts";

/**
 * The D1 REST API documents its parameters as strings, so SQL tests run with
 * numbers bound as numbers and again with them converted to strings.
 */
export type ParamMode = "number" | "string";

/** One row to insert into `images`: an image's hash, and that hash truncated to 53 bits. */
export interface ImageRow {
  readonly hash: string;
  readonly truncated: number;
}

/** A valid image hash, distinct for each number. */
export function hashOf(n: number): string {
  return n.toString(16).padStart(64, "0");
}

/** The key from an image insert's rows. Throws rather than asserts, since worker threads use this too. */
export function insertedKey(rows: readonly SqlRow[]): number {
  const key = rows[0]?.key;
  if (rows.length !== 1 || typeof key !== "number") {
    throw new TypeError(`Expected one row with a numeric key, got ${JSON.stringify(rows)}`);
  }
  return key;
}

export function withParamMode(adapter: SqlAdapter, mode: ParamMode): SqlAdapter {
  if (mode === "number") return adapter;
  return {
    execute: (statements) =>
      adapter.execute(
        statements.map(({ sql, params = [] }) => ({ sql, params: params.map(String) })),
      ),
  };
}
