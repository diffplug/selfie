import { chunks, STATEMENTS_PER_REQUEST } from "./chunks.ts";
import type { Sql, SqlStatement } from "./sql.ts";

// As one bound parameter.
const HASHES_PER_STATEMENT = 1_000;

/**
 * Gives a hash its key in `images` or `built_storybooks`: its truncated value, or if that's taken, or
 * 0, the next negative key. One statement, so concurrent inserts of the same or colliding hashes cannot
 * interleave. The CASTs make a string parameter behave like a number: without them a string '0' gets
 * key 0. Numbered parameters because D1 does not support named ones. Idempotent: a second batch hits
 * ON CONFLICT and returns the key the first assigned. See `docs/specs/store.md` -> Image keys.
 *
 * A future delete must handle this: the next negative key is derived from the lowest key present, so
 * deleting the row holding it would let that key be reused.
 */
export const insertHashKeyStatement = (table: "images" | "built_storybooks", hash: string, truncated: number): SqlStatement => ({
  sql: `INSERT INTO ${table}(key, hash)
SELECT CASE WHEN CAST(?1 AS INTEGER) = 0 OR EXISTS(SELECT 1 FROM ${table} WHERE key = CAST(?1 AS INTEGER))
            THEN (SELECT MIN(COALESCE(MIN(key), 0), 0) - 1 FROM ${table})
            ELSE CAST(?1 AS INTEGER) END, ?2
WHERE true
ON CONFLICT(hash) DO UPDATE SET hash = excluded.hash
RETURNING key`,
  params: [truncated, hash],
  idempotent: true,
});

/** Which of these images this store doesn't hold, each once, in the order given. */
export async function missingImages(sql: Sql, hashes: readonly string[]): Promise<string[]> {
  const distinct = [...new Set(hashes)];
  const statements = chunks(distinct, HASHES_PER_STATEMENT).map((group) => ({
    sql: "SELECT j.value AS hash FROM json_each(?1) j LEFT JOIN images i ON i.hash = j.value WHERE i.key IS NULL",
    params: [JSON.stringify(group)],
    idempotent: true,
  }));
  const missing = new Set<string>();
  for (const request of chunks(statements, STATEMENTS_PER_REQUEST)) {
    for (const rows of await sql.batch(request)) for (const row of rows) missing.add(row.hash as string);
  }
  return distinct.filter((hash) => missing.has(hash));
}
