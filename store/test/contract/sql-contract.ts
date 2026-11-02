import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  imageInsertStatement,
  initStoreSchema,
  Sql,
  SqlInterfaceError,
  type SqlAdapter,
} from "../../src/core/index.ts";
import {
  hashOf,
  insertedKey,
  withParamMode,
  type ImageRow,
  type ParamMode,
} from "../support/sql-params.ts";

/** One empty database, created for one test. */
export interface SqlTestDatabase {
  /** Opens a new, separate connection to this database. */
  connect(): Promise<SqlAdapter>;
  /**
   * Inserts each workload on its own connection, all at the same time, and returns
   * each workload's keys in order. The factory must make the statements really
   * overlap and prove it, since these tests pass trivially if they run in turn.
   */
  insertConcurrently(workloads: ImageRow[][], mode: ParamMode): Promise<number[][]>;
  destroy(): Promise<void>;
}

export type SqlAdapterFactory = () => Promise<SqlTestDatabase>;

const MAX_KEY = Number.MAX_SAFE_INTEGER;

// Spelled out, not imported, so changing the limit in the code fails this suite.
const LIMIT = 100;

/** Run this with a factory to prove a new SQL adapter correct. */
export function describeSqlContract(name: string, factory: SqlAdapterFactory): void {
  describe.each<ParamMode>(["number", "string"])(`SQL contract: ${name}, %s parameters`, (mode) => {
    let database: SqlTestDatabase;
    let sql: Sql;

    const connect = async () => new Sql(withParamMode(await database.connect(), mode));
    const insert = async (row: ImageRow) => {
      const { sql: text, params } = imageInsertStatement(row.hash, row.truncated);
      return insertedKey(await sql.run(text, params));
    };
    const allRows = () => sql.run("SELECT key, hash FROM images ORDER BY key DESC");
    const insertConcurrently = (workloads: ImageRow[][]) =>
      database.insertConcurrently(workloads, mode);

    beforeEach(async () => {
      database = await factory();
      sql = await connect();
      await initStoreSchema(sql);
    });

    afterEach(async () => {
      await database.destroy();
    });

    describe("statements", () => {
      it("returns rows with string, number, and null values", async () => {
        const rows = await sql.run("SELECT 'a' AS s, 2 AS n, NULL AS z");
        expect(rows).toEqual([{ s: "a", n: 2, z: null }]);
      });

      it("returns no rows from a statement that produces none", async () => {
        expect(await sql.run("CREATE TABLE empty_table (id INTEGER)")).toEqual([]);
      });

      it("gives the same result for an integer through CAST in either parameter form", async () => {
        const rows = await sql.run("SELECT CAST(?1 AS INTEGER) AS n, typeof(CAST(?1 AS INTEGER)) AS t", [
          MAX_KEY,
        ]);
        expect(rows).toEqual([{ n: MAX_KEY, t: "integer" }]);
      });

      it("rejects invalid SQL", async () => {
        await expect(sql.run("SELEKT 1")).rejects.toThrow();
      });

      it("runs a batch in order and returns each statement's rows", async () => {
        await sql.run("CREATE TABLE ordered (n INTEGER)");
        const results = await sql.batch([
          { sql: "INSERT INTO ordered VALUES (CAST(?1 AS INTEGER))", params: [1] },
          { sql: "INSERT INTO ordered VALUES (CAST(?1 AS INTEGER))", params: [2] },
          { sql: "SELECT n FROM ordered ORDER BY n" },
          { sql: "SELECT 'last' AS v" },
        ]);
        expect(results).toEqual([[], [], [{ n: 1 }, { n: 2 }], [{ v: "last" }]]);
      });

      // Asserts nothing about the earlier statement: the interface promises no
      // atomicity, and adapters are free to differ.
      it("rejects a batch when one of its statements fails", async () => {
        await expect(
          sql.batch([{ sql: "SELECT 1" }, { sql: "SELECT * FROM no_such_table" }]),
        ).rejects.toThrow();
      });
    });

    describe("bound parameter limit", () => {
      const placeholders = (count: number) =>
        Array.from({ length: count }, (_, i) => `?${i + 1} AS p${i + 1}`).join(", ");
      const values = (count: number) => Array.from({ length: count }, (_, i) => `v${i + 1}`);

      it("allows exactly the limit", async () => {
        const [row] = await sql.run(
          `SELECT ${placeholders(LIMIT)}`,
          values(LIMIT),
        );
        expect(row?.[`p${LIMIT}`]).toBe(`v${LIMIT}`);
      });

      it("refuses one over the limit", async () => {
        const over = LIMIT + 1;
        await expect(sql.run(`SELECT ${placeholders(over)}`, values(over))).rejects.toThrow(
          SqlInterfaceError,
        );
      });

      it("refuses one over the limit inside a batch", async () => {
        const over = LIMIT + 1;
        await expect(
          sql.batch([{ sql: "SELECT 1" }, { sql: `SELECT ${placeholders(over)}`, params: values(over) }]),
        ).rejects.toThrow(SqlInterfaceError);
      });
    });

    describe("image insert", () => {
      it("assigns the truncated value as the key when it is unclaimed", async () => {
        expect(await insert({ hash: hashOf(1), truncated: 12345 })).toBe(12345);
      });

      it("accepts both ends of the positive range", async () => {
        expect(await insert({ hash: hashOf(1), truncated: 1 })).toBe(1);
        expect(await insert({ hash: hashOf(2), truncated: MAX_KEY })).toBe(MAX_KEY);
      });

      it("stores the key as an integer and the hash as text", async () => {
        await insert({ hash: hashOf(1), truncated: 7 });
        const rows = await sql.run("SELECT typeof(key) AS k, typeof(hash) AS h FROM images");
        expect(rows).toEqual([{ k: "integer", h: "text" }]);
      });

      it("assigns monotonic negative keys from -1 when the value is claimed", async () => {
        expect(await insert({ hash: hashOf(1), truncated: 500 })).toBe(500);
        expect(await insert({ hash: hashOf(2), truncated: 500 })).toBe(-1);
        expect(await insert({ hash: hashOf(3), truncated: 500 })).toBe(-2);
      });

      it("assigns a negative key when the truncated value is 0", async () => {
        expect(await insert({ hash: hashOf(1), truncated: 0 })).toBe(-1);
        expect(await insert({ hash: hashOf(2), truncated: 0 })).toBe(-2);
        const keys = await sql.run("SELECT key FROM images WHERE key = 0");
        expect(keys).toEqual([]);
      });

      it("shares one negative sequence across different collisions", async () => {
        await insert({ hash: hashOf(1), truncated: 10 });
        await insert({ hash: hashOf(2), truncated: 20 });
        expect(await insert({ hash: hashOf(3), truncated: 10 })).toBe(-1);
        expect(await insert({ hash: hashOf(4), truncated: 20 })).toBe(-2);
        expect(await insert({ hash: hashOf(5), truncated: 0 })).toBe(-3);
      });

      it("returns the existing key on reinsert, positive or negative", async () => {
        await insert({ hash: hashOf(1), truncated: 500 });
        await insert({ hash: hashOf(2), truncated: 500 });
        await insert({ hash: hashOf(3), truncated: 0 });
        expect(await insert({ hash: hashOf(1), truncated: 500 })).toBe(500);
        expect(await insert({ hash: hashOf(2), truncated: 500 })).toBe(-1);
        expect(await insert({ hash: hashOf(3), truncated: 0 })).toBe(-2);
        expect(await allRows()).toHaveLength(3);
      });

      it("does not spend a negative key on a reinsert", async () => {
        await insert({ hash: hashOf(1), truncated: 500 });
        await insert({ hash: hashOf(2), truncated: 500 });
        await insert({ hash: hashOf(2), truncated: 500 });
        expect(await insert({ hash: hashOf(3), truncated: 500 })).toBe(-2);
      });

      it("returns the existing key whatever truncated value arrives with the hash", async () => {
        expect(await insert({ hash: hashOf(1), truncated: 500 })).toBe(500);
        expect(await insert({ hash: hashOf(2), truncated: 600 })).toBe(600);
        expect(await insert({ hash: hashOf(1), truncated: 600 })).toBe(500);
      });

      it("sees rows written by another connection", async () => {
        const other = await connect();
        const { sql: text, params } = imageInsertStatement(hashOf(1), 500);
        expect(insertedKey(await other.run(text, params))).toBe(500);
        expect(await insert({ hash: hashOf(2), truncated: 500 })).toBe(-1);
      });
    });

    describe("concurrent inserts through separate connections", () => {
      const WORKERS = 4;

      const shuffled = <T>(items: readonly T[], seed: number): T[] => {
        const result = [...items];
        let state = seed;
        for (let i = result.length - 1; i > 0; i--) {
          state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
          const j = state % (i + 1);
          [result[i], result[j]] = [result[j]!, result[i]!];
        }
        return result;
      };

      /** Every worker got one key per image, and the table holds exactly those. */
      const expectOneKeyPerImage = async (workloads: ImageRow[][], results: number[][]) => {
        const keyOf = new Map<string, number>();
        workloads.forEach((rows, w) => {
          rows.forEach((row, i) => {
            const key = results[w]?.[i];
            if (key === undefined) throw new Error("Missing key");
            if (keyOf.has(row.hash)) expect(key).toBe(keyOf.get(row.hash));
            keyOf.set(row.hash, key);
          });
        });
        const stored = await allRows();
        expect(new Map(stored.map((row) => [row.hash, row.key]))).toEqual(keyOf);
        expect(new Set(keyOf.values()).size).toBe(keyOf.size);
        return keyOf;
      };

      it("gives every connection the same key for the same image", async () => {
        const workloads = Array.from({ length: WORKERS }, () =>
          Array.from({ length: 50 }, () => ({ hash: hashOf(1), truncated: 500 })),
        );
        const results = await insertConcurrently(workloads);
        const keyOf = await expectOneKeyPerImage(workloads, results);
        expect(keyOf.get(hashOf(1))).toBe(500);
      });

      it("gives colliding images one positive key and gapless negative keys", async () => {
        const images = Array.from({ length: 50 }, (_, i) => ({ hash: hashOf(i + 1), truncated: 500 }));
        const workloads = Array.from({ length: WORKERS }, (_, w) => shuffled(images, w + 1));
        const results = await insertConcurrently(workloads);
        const keyOf = await expectOneKeyPerImage(workloads, results);
        const keys = [...keyOf.values()].sort((a, b) => b - a);
        expect(keys).toEqual([500, ...Array.from({ length: 49 }, (_, i) => -(i + 1))]);
      });

      it("gives images with truncated value 0 only negative keys", async () => {
        const images = Array.from({ length: 20 }, (_, i) => ({ hash: hashOf(i + 1), truncated: 0 }));
        const workloads = Array.from({ length: WORKERS }, (_, w) => shuffled(images, w + 1));
        const results = await insertConcurrently(workloads);
        const keyOf = await expectOneKeyPerImage(workloads, results);
        expect([...keyOf.values()].sort((a, b) => b - a)).toEqual(
          Array.from({ length: 20 }, (_, i) => -(i + 1)),
        );
      });

      it("handles a mix of distinct, colliding, and repeated images", async () => {
        const images = Array.from({ length: 200 }, (_, i) => ({
          hash: hashOf(i + 1),
          // Every value is shared by up to four images, so most inserts contend on a claim.
          truncated: 1000 + Math.floor(i / 4),
        }));
        const workloads = Array.from({ length: WORKERS }, (_, w) => shuffled(images, w + 1));
        const results = await insertConcurrently(workloads);
        const keyOf = await expectOneKeyPerImage(workloads, results);
        const keys = [...keyOf.values()];
        expect(keys.filter((key) => key > 0)).toHaveLength(50);
        expect(keys.filter((key) => key < 0).sort((a, b) => b - a)).toEqual(
          Array.from({ length: 150 }, (_, i) => -(i + 1)),
        );
      });
    });
  });
}
