// The snapshot contract against real D1, over the network. Opt-in through `pnpm test:d1`
// or, on its own, `pnpm test:d1:snapshots`, since it needs credentials and spends the
// account's shared API rate limit. Only one run of any real-D1 suite at a time: all of
// them use the same database.

import { afterAll, describe, expect, it } from "vitest";
import { Snapshots, Sql, type RecordedSnapshot, type SqlStatement } from "../src/core/index.ts";
import { describeSnapshotContract } from "./contract/snapshots-contract.ts";
import { CONTRACT_DATABASE_ID, loadD1Credentials } from "./support/d1-credentials.ts";
import { createD1Harness, type D1Harness } from "./support/d1-harness.ts";
import { hashOf } from "./support/sql-params.ts";

const ENABLED = process.env.SELFIE_D1_CONTRACT === "1";

// Well above a healthy run of about 50, and far below the shared limit of 1,200 per 5 minutes.
const REQUEST_BUDGET = 80;

// The size a run must stay efficient at, and more than a page of rows.
const SNAPSHOTS = 10_000;

describe.skipIf(!ENABLED)("real D1 snapshots (opt-in: pnpm test:d1:snapshots)", () => {
  let harness: D1Harness | undefined;

  const shared = async () => {
    if (harness !== undefined) return harness;
    const { accountId, token } = await loadD1Credentials();
    harness = createD1Harness({
      accountId,
      token,
      databaseId: CONTRACT_DATABASE_ID,
      budget: REQUEST_BUDGET,
    });
    // A crashed run may have left tables behind.
    await harness.sweep();
    return harness;
  };

  afterAll(async () => {
    await harness?.sweep();
    console.log(`Real-D1 snapshot run: ${harness?.requests} API requests.`);
  });

  // Numbers only, as the code sends them. Local SQLite covers both forms.
  describeSnapshotContract("D1 REST", "number", async () => {
    const { connect } = await shared();
    // The tables stay for the test below, and `afterAll` sweeps them.
    return { connect: () => connect(), destroy: async () => {} };
  });

  it(`records and compares ${SNAPSHOTS} snapshots, and reports what D1 billed`, async () => {
    const { connect } = await shared();
    let rowsRead = 0;
    let rowsWritten = 0;
    const sql = new Sql(
      connect((next) => async (input, init) => {
        const response = await next(input, init);
        const body = (await response.clone().json()) as {
          result?: { meta?: { rows_read?: number; rows_written?: number } }[];
        };
        for (const { meta } of body.result ?? []) {
          rowsRead += meta?.rows_read ?? 0;
          rowsWritten += meta?.rows_written ?? 0;
        }
        return response;
      }),
    );
    const snapshots = new Snapshots({ sql });

    const hashes = Array.from({ length: SNAPSHOTS }, (_, i) => hashOf(5_000_000 + i));
    const imageStatements: SqlStatement[] = [];
    for (let i = 0; i < SNAPSHOTS; i += 49) {
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
      const before = { requests: harness!.requests, rowsRead, rowsWritten };
      const start = performance.now();
      const result = await work();
      report[name] = {
        ms: Math.round(performance.now() - start),
        requests: harness!.requests - before.requests,
        rowsRead: rowsRead - before.rowsRead,
        rowsWritten: rowsWritten - before.rowsWritten,
      };
      return result;
    };

    const items: RecordedSnapshot[] = hashes.map((imageHash, i) => ({
      story: `component-${String(i).padStart(5, "0")}--story`,
      imageHash,
    }));
    const environment = "size";
    const gitSha = "3".repeat(40);
    const run = await measure("beginRun", () => snapshots.beginRun({ gitSha, environment }));
    await measure("recordSnapshots", () => snapshots.recordSnapshots(run.id, items));
    await measure("finishRun", () => snapshots.finishRun(run.id, SNAPSHOTS));
    await measure("decide", () =>
      snapshots.decide({
        environment,
        decision: "approved",
        actor: "real-d1-test",
        snapshots: items.map(({ story, imageHash }) => ({ story, imageHash: imageHash! })),
      }),
    );
    expect(await measure("acceptRun", () => snapshots.acceptRun(run.id, null))).toBe(true);
    const { snapshots: compared } = await measure("compareRun", () => snapshots.compareRun(run.id, gitSha));

    console.log(`Real D1 at ${SNAPSHOTS} snapshots:`);
    console.table(report);
    expect(compared.filter(({ state }) => state === "unchanged")).toHaveLength(SNAPSHOTS);
  });
});
