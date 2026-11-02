import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempStore } from "./support/temp-store.ts";
import { runInsertWorkers } from "./support/sqlite-workers.ts";

describe("SqliteAdapter across threads", () => {
  let temp: Awaited<ReturnType<typeof createTempStore>>;

  beforeEach(async () => {
    temp = await createTempStore();
  });

  afterEach(async () => {
    await temp.destroy();
  });

  // Guards the contract's concurrency tests: they prove nothing unless the
  // workers are really running at the same time.
  it("runs the workers' inserts at the same time", async () => {
    const images = Array.from({ length: 300 }, (_, i) => ({
      hash: (i + 1).toString(16).padStart(64, "0"),
      truncated: 500,
    }));
    const outputs = await runInsertWorkers(temp.path, [images, images, images, images], "number");
    const latestStart = Math.max(...outputs.map((output) => output.startedAt));
    const earliestFinish = Math.min(...outputs.map((output) => output.finishedAt));
    expect(latestStart).toBeLessThan(earliestFinish);
  });

  it("leaves a consistent table after every worker's connection closes", async () => {
    const images = Array.from({ length: 100 }, (_, i) => ({
      hash: (i + 1).toString(16).padStart(64, "0"),
      truncated: 500,
    }));
    await runInsertWorkers(temp.path, [images, images, images], "string");
    const [row] = await temp.sql.run(
      "SELECT COUNT(*) AS rows, COUNT(DISTINCT key) AS keys, MIN(key) AS low, MAX(key) AS high FROM images",
    );
    expect(row).toEqual({ rows: 100, keys: 100, low: -99, high: 500 });
  });
});
