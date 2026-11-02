import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashOf } from "./support/sql-params.ts";
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
      hash: hashOf(i + 1),
      truncated: 500,
    }));
    const outputs = await runInsertWorkers(temp.path, [images, images, images, images], "number");
    const latestStart = Math.max(...outputs.map((output) => output.startedAt));
    const earliestFinish = Math.min(...outputs.map((output) => output.finishedAt));
    expect(latestStart).toBeLessThan(earliestFinish);
  });
});
