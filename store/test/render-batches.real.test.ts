// The render contract against real D1, over the network. Opt-in through `pnpm test:d1`
// or, on its own, `pnpm test:d1:render-batches` in `store/`, since it needs credentials and
// spends the account's shared API rate limit. Only one batch of any real-D1 suite at a time: all of
// them use the same database.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RenderBatches, Sql, type RecordedRender, type SqlStatement } from "../src/core/index.ts";
import { describeBatchContract } from "./contract/render-batches-contract.ts";
import type { D1Harness } from "./support/d1-harness.ts";
import { d1Harness } from "./support/real-d1.ts";
import { hashOf } from "./support/sql-params.ts";

const ON = { batchId: "00000000-0000-4000-8000-000000000001", gitSha: "e".repeat(40) };

const ENABLED = process.env.SELFIE_D1_CONTRACT === "1";

// Well above a healthy batch of about 90, and far below the shared limit of 1,200 per 5 minutes.
const REQUEST_BUDGET = 120;

// The size a batch must stay efficient at.
const RENDERS = 10_000;

// How a mostly unchanged batch differs from its baseline.
const CHANGED = 100;
const NEW = 50;
const FAILED = 50;
const REMOVED = 50;

describe.skipIf(!ENABLED)("real D1 renders (opt-in: pnpm test:d1:render-batches)", () => {
  let harness: D1Harness;

  beforeAll(async () => {
    harness = await d1Harness(REQUEST_BUDGET);
    // A crashed batch may have left tables behind.
    await harness.sweep();
  });

  afterAll(async () => {
    await harness?.sweep();
    console.log(`Real-D1 render run: ${harness?.requests} API requests.`);
  });

  // Numbers only, as the code sends them. Local SQLite covers both forms.
  describeBatchContract("D1 REST", "number", async () => ({
    connect: () => harness.connect(),
    // The tables stay for the test below, and `afterAll` sweeps them.
    destroy: async () => {},
  }));

  it(`records and compares ${RENDERS} renders, and reports what D1 billed`, async () => {
    let rowsRead = 0;
    let rowsWritten = 0;
    let responseBytes = 0;
    const sql = new Sql(
      harness.connect((next) => async (input, init) => {
        const response = await next(input, init);
        const text = await response.clone().text();
        responseBytes += text.length;
        const body = JSON.parse(text) as {
          result?: { meta?: { rows_read?: number; rows_written?: number } }[];
        };
        for (const { meta } of body.result ?? []) {
          rowsRead += meta?.rows_read ?? 0;
          rowsWritten += meta?.rows_written ?? 0;
        }
        return response;
      }),
    );
    const batches = new RenderBatches({ sql });

    const total = RENDERS + CHANGED + NEW;
    const hashes = Array.from({ length: total }, (_, i) => hashOf(5_000_000 + i));
    const imageStatements: SqlStatement[] = [];
    for (let i = 0; i < total; i += 49) {
      const group = hashes.slice(i, i + 49);
      imageStatements.push({
        sql: `INSERT INTO images(key, hash) VALUES ${group
          .map((_, j) => `(CAST(?${2 * j + 1} AS INTEGER), ?${2 * j + 2})`)
          .join(", ")}`,
        params: group.flatMap((hash, j) => [5_000_000 + i + j, hash]),
      });
    }
    await sql.batch(imageStatements);

    const report: Record<string, object> = {};
    const measure = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
      const before = { requests: harness.requests, rowsRead, rowsWritten, responseBytes };
      const start = performance.now();
      const result = await work();
      report[name] = {
        ms: Math.round(performance.now() - start),
        requests: harness.requests - before.requests,
        rowsRead: rowsRead - before.rowsRead,
        rowsWritten: rowsWritten - before.rowsWritten,
        responseBytes: responseBytes - before.responseBytes,
      };
      return result;
    };

    const items = hashes.slice(0, RENDERS).map((imageHash, i) => ({
      story: `component-${String(i).padStart(5, "0")}--story`,
      imageHash,
    }));
    const environment = "size";
    const gitSha = "3".repeat(40);
    const batch = await measure("beginBatch", () => batches.beginBatch({ gitSha, environment, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, }));
    await measure("recordRenders", () => batches.recordRenders(batch.id, items));
    await measure("finishBatch", () => batches.finishBatch(batch.id, RENDERS));
    await measure("decide", () =>
      batches.decide({ on: ON, environment, decision: "approved", actor: "real-d1-test", renders: items }),
    );
    expect(await measure("acceptBatch", () => batches.acceptBatch(batch.id, null, 0))).toBe(true);

    const head: RecordedRender[] = items.slice(0, RENDERS - REMOVED).map((item, i) =>
      i < CHANGED
        ? { story: item.story, imageHash: hashes[RENDERS + i]! }
        : i < CHANGED + FAILED
          ? { story: item.story, failure: "Render threw" }
          : item,
    );
    for (let i = 0; i < NEW; i++) {
      head.push({ story: `zz-new-${i}`, imageHash: hashes[RENDERS + CHANGED + i]! });
    }
    const headBatch = await batches.beginBatch({ gitSha: "4".repeat(40), environment, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
    await batches.recordRenders(headBatch.id, head);
    await batches.finishBatch(headBatch.id, head.length);
    const { renders: compared, unchangedCount } = await measure("compareBatch (differences)", () =>
      batches.compareBatch(headBatch.id, gitSha),
    );

    console.log(`Real D1 at ${RENDERS} renders:`);
    console.table(report);
    expect(compared).toHaveLength(CHANGED + NEW + FAILED + REMOVED);
    expect(unchangedCount).toBe(RENDERS - CHANGED - FAILED - REMOVED);
  });
});
