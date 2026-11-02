import type { SqlAdapter } from "../../src/core/index.ts";

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

export function withParamMode(adapter: SqlAdapter, mode: ParamMode): SqlAdapter {
  if (mode === "number") return adapter;
  return {
    execute: (statements) =>
      adapter.execute(
        statements.map(({ sql, params = [] }) => ({ sql, params: params.map(String) })),
      ),
  };
}
