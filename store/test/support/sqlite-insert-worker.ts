// Runs inserts on its own thread and its own connection, for tests of real overlap
// between connections. Loaded by runInsertWorkers, not by vitest.

import { parentPort, workerData } from "node:worker_threads";
import { SqliteAdapter } from "../../src/adapters/sqlite.ts";
import { imageInsertStatement, Sql } from "../../src/core/index.ts";
import { insertedKey, withParamMode } from "./sql-params.ts";
import type { WorkerInput, WorkerOutput } from "./sqlite-workers.ts";

const { path, rows, mode, parties, barrier } = workerData as WorkerInput;
const adapter = new SqliteAdapter(path);
const sql = new Sql(withParamMode(adapter, mode));

// Wait here until every worker has its connection open, so all start together.
const gate = new Int32Array(barrier);
if (Atomics.add(gate, 0, 1) + 1 === parties) {
  Atomics.notify(gate, 0);
} else {
  for (let seen = Atomics.load(gate, 0); seen < parties; seen = Atomics.load(gate, 0)) {
    Atomics.wait(gate, 0, seen);
  }
}

const startedAt = performance.timeOrigin + performance.now();
const keys: number[] = [];
for (const row of rows) {
  keys.push(insertedKey(await sql.run(imageInsertStatement(row.hash, row.truncated))));
}
const finishedAt = performance.timeOrigin + performance.now();

adapter.close();
parentPort!.postMessage({ keys, startedAt, finishedAt } satisfies WorkerOutput);
