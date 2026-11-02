// The SQL contract against real D1, over the network. Opt-in through `pnpm test:d1`,
// since it needs credentials and spends the account's shared API rate limit. Only
// one run at a time: every run uses the same database.

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { D1RestError } from "../src/adapters/d1-rest.ts";
import { imageInsertStatement, initStoreSchema, Sql, Store } from "../src/core/index.ts";
import { describeSqlContract } from "./contract/sql-contract.ts";
import type { D1Harness } from "./support/d1-harness.ts";
import { d1Harness } from "./support/real-d1.ts";
import { pngOf } from "./support/png-builder.ts";
import { hashOf, insertedKey, withParamMode, type ImageRow } from "./support/sql-params.ts";
import { createTempStore } from "./support/temp-store.ts";

const ENABLED = process.env.SELFIE_D1_CONTRACT === "1";

// The contract's concurrent workloads total 1,280 inserts per parameter mode. Sent
// one per request, a run would pass the 1,200 request limit by itself. Grouped like
// this, each worker still interleaves with the others, batch by batch.
const INSERTS_PER_REQUEST = 25;

const overlaps: number[] = [];

describe.skipIf(!ENABLED)("real D1 (opt-in: pnpm test:d1)", () => {
  let harness: D1Harness;
  let swept = false;

  afterAll(() => {
    console.log(
      `Real-D1 run: ${harness?.requests} API requests. Peak requests in flight in each ` +
        `contract concurrency test: ${overlaps.join(", ")}.`,
    );
  });

  describeSqlContract("D1 REST", async () => {
    harness = await d1Harness();
    // Only the first time: a crashed run may have left tables behind.
    if (!swept) await harness.sweep();
    swept = true;
    const { connect, sweep, measureOverlap } = harness;
    return {
      connect: async () => connect(),
      insertConcurrently: async (workloads, mode) => {
        const { result, peak } = await measureOverlap(() =>
          Promise.all(
            workloads.map(async (rows: ImageRow[]) => {
              const sql = new Sql(withParamMode(connect(), mode));
              const keys: number[] = [];
              for (let i = 0; i < rows.length; i += INSERTS_PER_REQUEST) {
                const chunk = rows.slice(i, i + INSERTS_PER_REQUEST);
                const batch = await sql.batch(
                  chunk.map((row) => imageInsertStatement(row.hash, row.truncated)),
                );
                keys.push(...batch.map((rows) => insertedKey(rows)));
              }
              return keys;
            }),
          ),
        );
        overlaps.push(peak);
        // Fails the contract test: it proves nothing unless the workers really overlap.
        expect(peak).toBeGreaterThan(1);
        return result;
      },
      destroy: () => sweep(),
    };
  });

  describe("what the contract can't see", () => {
    beforeEach(async () => {
      harness = await d1Harness();
      await initStoreSchema(new Sql(harness.connect()));
    });

    afterEach(async () => {
      await harness.sweep();
    });

    // Guards the contract's concurrency tests the way the SQLite suite's thread test
    // does. Every image here is new and collides, so its negative key records the
    // order D1 ran it in, which shows the workers' single inserts interleaving there.
    it("runs separate connections' single inserts interleaved on D1", async () => {
      const WORKERS = 4;
      const PER_WORKER = 5;
      const owners = new Map<number, number>();
      await new Sql(harness.connect()).run(imageInsertStatement(hashOf(1), 500));

      const { peak } = await harness.measureOverlap(async () => {
        await Promise.all(
          Array.from({ length: WORKERS }, async (_, worker) => {
            const sql = new Sql(harness.connect());
            for (let i = 0; i < PER_WORKER; i++) {
              const statement = imageInsertStatement(hashOf(100 * (worker + 1) + i), 500);
              owners.set(insertedKey(await sql.run(statement)), worker);
            }
          }),
        );
      });

      const order = [...owners.entries()].sort(([a], [b]) => b - a).map(([, worker]) => worker);
      const switches = order.filter((worker, i) => i > 0 && worker !== order[i - 1]).length;
      console.log(`Single-insert overlap: peak ${peak} in flight, D1 order ${order.join("")}`);
      expect(peak).toBeGreaterThan(1);
      expect(order).toHaveLength(WORKERS * PER_WORKER);
      // Workers running one after another would switch only WORKERS - 1 times.
      expect(switches).toBeGreaterThan(WORKERS - 1);
    });

    it("gets the same key when an insert commits but its response is lost", async () => {
      let lost = 0;
      const sql = new Sql(
        harness.connect((next) => async (input, init) => {
          const response = await next(input, init);
          if (lost++ === 0) throw new TypeError("Simulated: connection lost after the commit");
          return response;
        }),
      );
      const rows = await sql.run(imageInsertStatement(hashOf(1), 500));
      expect(insertedKey(rows)).toBe(500);
      expect(lost).toBe(2);
      const stored = await new Sql(harness.connect()).run({ sql: "SELECT key FROM images" });
      expect(stored).toEqual([{ key: 500 }]);
    });

    it("stores many images in a few requests through Store.putImages", async () => {
      const temp = await createTempStore();
      try {
        const store = new Store({ sql: new Sql(harness.connect()), blob: temp.blob });
        const files = Array.from({ length: 205 }, (_, i) =>
          pngOf({ width: 1, height: 1, pixels: new Uint8Array([i & 255, i >> 8, 0]) }),
        );
        const before = harness.requests;
        const stored = await store.putImages(files);
        // A lookup and an insert for each of 3 groups.
        expect(harness.requests - before).toBe(6);
        expect(new Set(stored.map(({ key }) => key)).size).toBe(205);
        expect(await store.lookupKey(stored[204]!.hash)).toBe(stored[204]!.key);
      } finally {
        await temp.destroy();
      }
    });

    it("rejects with D1's own message and no token", async () => {
      const error = await new Sql(harness.connect()).run({ sql: "SELEKT 1" }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(D1RestError);
      const { message, codes, status, attempts } = error as D1RestError;
      expect(message).toContain("syntax error");
      expect({ codes, status, attempts }).toEqual({ codes: [7500], status: 400, attempts: 1 });
      expect(harness.leaksToken(message)).toBe(false);
      expect(harness.leaksToken(JSON.stringify(error))).toBe(false);
    });
  });
});
