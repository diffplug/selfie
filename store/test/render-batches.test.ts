import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  imageInsertStatement,
  initStoreSchema,
  newestRenders,
  RenderBatches,
  Sql,
  Store,
  type ComparedRender,
  type RecordedRender,
  type SqlAdapter,
  type SqlStatement,
} from "../src/core/index.ts";
import {
  describeBatchContract,
  failing,
  rendered,
  replaying,
} from "./contract/render-batches-contract.ts";
import { pngOf } from "./support/png-builder.ts";
import { hashOf } from "./support/sql-params.ts";
import { createTempStore } from "./support/temp-store.ts";
import { sharpCodec } from "../src/adapters/sharp-codec.ts";

const ON = { batchId: "00000000-0000-4000-8000-000000000001", gitSha: "e".repeat(40) };

for (const mode of ["number", "string"] as const) {
  describeBatchContract("local SQLite", mode, async () => {
    const temp = await createTempStore();
    return { connect: () => temp.connectAdapter(), destroy: temp.destroy };
  });
}

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const ENV = "container-linux-arm64-0123456789abcdef";

/** Counts requests, the unit D1's shared API limit is spent in. */
function counting(adapter: SqlAdapter) {
  const sent: SqlStatement[][] = [];
  const responseBytes: number[] = [];
  return {
    sent,
    responseBytes,
    adapter: {
      execute: async (statements: readonly SqlStatement[]) => {
        sent.push([...statements]);
        const rows = await adapter.execute(statements);
        responseBytes.push(JSON.stringify(rows).length);
        return rows;
      },
    } satisfies SqlAdapter,
  };
}

describe("RenderBatches", () => {
  let temp: Awaited<ReturnType<typeof createTempStore>>;
  let adapter: SqlAdapter;
  let sql: Sql;
  let batches: RenderBatches;
  let clock: number;

  const over = (wrap: (adapter: SqlAdapter) => SqlAdapter) =>
    new RenderBatches({ sql: new Sql(wrap(adapter)), now: () => clock++ });

  /** A finished batch of these renders. */
  const recordBatch = async (
    gitSha: string,
    items: readonly RecordedRender[],
    environment = ENV,
    model = batches,
  ) => {
    const batch = await model.beginBatch({ gitSha, environment, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
    await model.recordRenders(batch.id, items);
    return model.finishBatch(batch.id, items.length);
  };

  const approve = (items: readonly RecordedRender[], environment = ENV, model = batches) =>
    model.decide({ on: ON,
      environment,
      decision: "approved",
      actor: "ned",
      renders: items.map(({ story, imageHash }) => ({ story, imageHash: imageHash! })),
    });

  /** Goldens at this SHA, holding these renders. */
  const goldensAt = async (gitSha: string, items: readonly RecordedRender[]) => {
    const batch = await recordBatch(gitSha, items);
    await approve(items);
    expect(await batches.acceptBatch(batch.id, null, 0)).toBe(true);
    return batch;
  };

  const statesOf = async (batchId: string, baseline: string | null, model = batches) => {
    const { renders: compared } = await model.compareBatch(batchId, baseline, { includeUnchanged: true });
    return Object.fromEntries(compared.map(({ story, state }) => [story, state]));
  };

  /** What a batch holds, as a reader finds out: its full comparison. */
  const heldBy = async (batchId: string) => {
    const { renders: compared } = await batches.compareBatch(batchId, null, { includeUnchanged: true });
    return compared;
  };

  beforeEach(async () => {
    temp = await createTempStore();
    adapter = temp.connectAdapter();
    sql = new Sql(adapter);
    clock = 1_000;
    batches = new RenderBatches({ sql, now: () => clock++ });
    await sql.batch(Array.from({ length: 40 }, (_, i) => imageInsertStatement(hashOf(i + 1), i + 1)));
  });

  afterEach(async () => {
    await temp.destroy();
  });

  describe("firstWithGoldens's requests", () => {
    it("stops at the first group holding one, and asks one query per group", async () => {
      const { sent, adapter: counted } = counting(adapter);
      const model = new RenderBatches({ sql: new Sql(counted) });
      const golden = await recordBatch(SHA_A, [rendered("a", 1)]);
      await approve([rendered("a", 1)]);
      await batches.acceptBatch(golden.id, null, 0);

      const others = Array.from({ length: 1000 }, (_, i) => i.toString(16).padStart(40, "f"));
      expect(await model.firstWithGoldens(others, ENV)).toBeNull();
      expect(sent).toHaveLength(11);
      sent.length = 0;
      expect(await model.firstWithGoldens([SHA_A, ...others], ENV)).toBe(SHA_A);
      expect(sent).toHaveLength(1);
    });
  });

  describe("recording a failure", () => {
    it("cuts it by code point", async () => {
      const batch = await batches.beginBatch({ gitSha: SHA_A, environment: ENV, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      await batches.recordRenders(batch.id, [{ story: "a", failure: `${"x".repeat(1999)}😀😀\0` }]);
      await batches.finishBatch(batch.id, 1);
      const { renders: compared } = await batches.compareBatch(batch.id, null);
      expect(compared[0]!.failure).toBe(`${"x".repeat(1999)}😀`);
    });

    it("keeps a statement inside the parameter limit when only some rows have both an image and a failure", async () => {
      await recordBatch(SHA_B, [rendered("holds-the-image", 9)]);
      const { sent, adapter: counted } = counting(adapter);
      const model = new RenderBatches({ sql: new Sql(counted) });
      const batch = await batches.beginBatch({ gitSha: SHA_A, environment: ENV, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      const rows = Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? { ...rendered(`s${i}`, 9), failure: "boom" } : { story: `s${i}`, failure: "boom" }));
      await model.recordRenders(batch.id, rows);
      for (const { params = [] } of sent.flat()) expect(params.length).toBeLessThanOrEqual(100);
      await expect(model.finishBatch(batch.id, 200)).resolves.toMatchObject({ failedCount: 200 });
    });
  });

  describe("names", () => {
    it("takes a story ID as opaque, whatever it holds", async () => {
      const stories = ["ui/button--primary", "it's", 'a"b', "--", "\u{1F600}", "123", "(?1)", "NULL"];
      const batch = await recordBatch(SHA_A, stories.map((story, i) => rendered(story, i + 1)));
      const held = await heldBy(batch.id);
      expect(held.map(({ story }) => story).sort()).toEqual([...stories].sort());
    });

    it("refuses a scale that isn't a positive number", async () => {
      for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(batches.beginBatch({ gitSha: SHA_A, environment: ENV, scale, viewport: { width: 1200, height: 900 }, dirty: false, })).rejects.toThrow(RangeError);
      }
    });

    it("refuses what can't name a render", async () => {
      const batch = await batches.beginBatch({ gitSha: SHA_A, environment: ENV, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      for (const bad of ["", "a\0b"]) {
        await expect(batches.recordRenders(batch.id, [rendered(bad, 1)])).rejects.toThrow(RangeError);
        await expect(batches.beginBatch({ gitSha: SHA_A, environment: bad, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, })).rejects.toThrow(RangeError);
      }
      await expect(
        batches.recordRenders(batch.id, [{ story: "a", imageHash: "abc" }]),
      ).rejects.toThrow("Not an image hash");
      await expect(batches.recordRenders(batch.id, [rendered("a", 1), rendered("a", 2)])).rejects.toThrow(
        "recorded twice",
      );
      for (const sha of ["abc123", SHA_A.toUpperCase()]) {
        await expect(batches.beginBatch({ gitSha: sha, environment: ENV, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, })).rejects.toThrow("Git SHA");
      }
      await expect(batches.finishBatch(batch.id, 0)).resolves.toMatchObject({ status: "complete" });
    });
  });

  describe("recording", () => {
    it("takes the newer result for a name, until the batch is finished", async () => {
      const batch = await batches.beginBatch({ gitSha: SHA_A, environment: ENV, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      await batches.recordRenders(batch.id, [{ story: "a", failure: "Timeout" }, rendered("b", 1)]);
      await batches.recordRenders(batch.id, [rendered("a", 2), { story: "b", failure: "Crash" }]);
      expect(await batches.finishBatch(batch.id, 2)).toMatchObject({ status: "failed", failedCount: 1 });
      expect(await heldBy(batch.id)).toMatchObject([
        { story: "a", state: "added", imageHash: hashOf(2), failure: null },
        { story: "b", state: "failed", imageHash: null, failure: "Crash" },
      ]);

      await expect(batches.recordRenders(batch.id, [rendered("b", 3)])).rejects.toMatchObject({
        code: "batch-finished",
      });
      expect((await heldBy(batch.id))[1]).toMatchObject({ state: "failed", failure: "Crash" });
    });

    it("records a failed story, so it isn't silently absent", async () => {
      const batch = await recordBatch(SHA_A, [{ story: "a", failure: "" }]);
      expect(batch.status).toBe("failed");
      expect(await statesOf(batch.id, null)).toEqual({ a: "failed" });
    });

    it("records a mix of results in one statement, beside the one that gives stories their keys", async () => {
      const { adapter: counted, sent } = counting(adapter);
      const model = new RenderBatches({ sql: new Sql(counted) });
      const batch = await model.beginBatch({ gitSha: SHA_A, environment: ENV, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      sent.length = 0;
      await model.recordRenders(batch.id, [
        rendered("a", 1),
        { story: "b", failure: "Boom" },
        rendered("c", 2),
        rendered("d", 3),
        { story: "e", failure: "Second failure" },
      ]);
      expect(sent.flat()).toHaveLength(2);
      await model.finishBatch(batch.id, 5);
      expect(await heldBy(batch.id)).toMatchObject([
        { story: "a", state: "added" },
        { story: "b", state: "failed" },
        { story: "c", state: "added" },
        { story: "d", state: "added" },
        { story: "e", state: "failed" },
      ]);
    });

    it("bounds a failure message without splitting a character", async () => {
      const batch = await batches.beginBatch({ gitSha: SHA_A, environment: ENV, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      await batches.recordRenders(batch.id, [{ story: "a", failure: "\0\u{1F600}".repeat(5_000) }]);
      await batches.finishBatch(batch.id, 1);
      expect((await heldBy(batch.id))[0]?.failure).toBe("\u{1F600}".repeat(2_000));
    });

    it("refuses an image that isn't stored, and a batch that doesn't exist", async () => {
      const batch = await batches.beginBatch({ gitSha: SHA_A, environment: ENV, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      await expect(batches.recordRenders(batch.id, [rendered("a", 9_999)])).rejects.toMatchObject({
        code: "unknown-image",
      });
      await expect(batches.recordRenders("nope", [rendered("a", 1)])).rejects.toMatchObject({
        code: "unknown-batch",
      });
      await expect(batches.finishBatch("nope", 0)).rejects.toMatchObject({ code: "unknown-batch" });
      await expect(batches.compareBatch("nope", null)).rejects.toMatchObject({ code: "unknown-batch" });
      await expect(batches.acceptBatch("nope", null, 0)).rejects.toMatchObject({ code: "unknown-batch" });
      expect(await batches.getBatch("nope")).toBeNull();
    });

    it("keeps the good rows of a statement that also names an unstored image", async () => {
      const batch = await batches.beginBatch({ gitSha: SHA_A, environment: ENV, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      await expect(
        batches.recordRenders(batch.id, [rendered("a", 1), rendered("b", 9_999)]),
      ).rejects.toMatchObject({ code: "unknown-image", message: expect.stringContaining("1 renders") });
      await expect(batches.finishBatch(batch.id, 2)).rejects.toMatchObject({
        message: expect.stringContaining("holds 1 renders"),
      });
    });

    it("finishes an empty batch, and sends nothing for an empty call", async () => {
      const { adapter: counted, sent } = counting(adapter);
      const model = new RenderBatches({ sql: new Sql(counted) });
      const batch = await model.beginBatch({ gitSha: SHA_A, environment: ENV, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      await model.recordRenders(batch.id, []);
      await model.decide({ on: ON, environment: ENV, decision: "approved", actor: "ned", renders: [] });
      expect(sent).toHaveLength(1);
      expect(await model.finishBatch(batch.id, 0)).toMatchObject({ status: "complete", failedCount: 0 });
    });

    it("lists batches at a SHA, crashed ones included, for one environment", async () => {
      const crashed = await batches.beginBatch({ gitSha: SHA_A, environment: ENV, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      const later = await recordBatch(SHA_A, []);
      await recordBatch(SHA_A, [], "other");
      await recordBatch(SHA_B, []);
      expect((await batches.batchesAt(SHA_A, ENV)).map(({ id, status }) => [id, status])).toEqual([
        [later.id, "complete"],
        [crashed.id, "recording"],
      ]);
      expect(await batches.getBatch(crashed.id)).toEqual(crashed);
    });
  });

  describe("crashes partway", () => {
    // 19,600 renders fill the 400 statements of one request, so this takes two.
    const RENDERS = 20_000;
    const items: RecordedRender[] = Array.from({ length: RENDERS }, (_, i) =>
      rendered(`story-${i}`, (i % 40) + 1),
    );

    it("sends a large run in as few requests as the limits allow", async () => {
      const { adapter: counted, sent } = counting(adapter);
      const model = new RenderBatches({ sql: new Sql(counted) });
      const batch = await model.beginBatch({ gitSha: SHA_A, environment: ENV, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      sent.length = 0;
      await model.recordRenders(batch.id, items);
      expect(sent.map((statements) => statements.length)).toEqual([400, 29]);
    });

    it.each([
      ["nothing landed", 0, 18_620],
      ["its statements landed in part", 5, 18_620 + 5 * 49],
    ])("leaves a batch that says so when its statements die and %s", async (_, ran, stored) => {
      const batch = await batches.beginBatch({ gitSha: SHA_A, environment: ENV, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      let requests = 0;
      const dying = over((inner) => failing(inner, () => ++requests === 2, ran));

      await expect(dying.recordRenders(batch.id, items)).rejects.toThrow("Simulated");

      // What a crash leaves: a batch that says so, and refuses to be taken for complete.
      expect((await batches.getBatch(batch.id))?.status).toBe("recording");
      await expect(batches.finishBatch(batch.id, RENDERS)).rejects.toMatchObject({
        code: "wrong-render-count",
        message: expect.stringContaining(`holds ${stored} renders`),
      });
      await expect(batches.compareBatch(batch.id, null)).rejects.toMatchObject({
        code: "batch-not-finished",
      });
      await expect(batches.acceptBatch(batch.id, null, 0)).rejects.toMatchObject({
        code: "batch-not-finished",
      });

      // A new batch replaces it, and it stays behind, still saying what it is.
      const fresh = await recordBatch(SHA_A, items);
      expect(fresh.status).toBe("complete");
      expect((await batches.batchesAt(SHA_A, ENV)).map(({ status }) => status)).toEqual([
        "complete",
        "recording",
      ]);
    });

    it("can send a failed call again, whatever of it landed", async () => {
      const batch = await batches.beginBatch({ gitSha: SHA_A, environment: ENV, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      let requests = 0;
      const dying = over((inner) => failing(inner, () => ++requests === 2, 5));
      await expect(dying.recordRenders(batch.id, items)).rejects.toThrow("Simulated");
      await batches.recordRenders(batch.id, items);
      expect(await batches.finishBatch(batch.id, RENDERS)).toMatchObject({ status: "complete" });
    });

    it("keeps one row per name when a request commits and its response is lost", async () => {
      const batch = await batches.beginBatch({ gitSha: SHA_A, environment: ENV, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      let lost = false;
      const losing = over((inner) => ({
        execute: async (statements) => {
          const rows = await inner.execute(statements);
          if (!lost) {
            lost = true;
            throw new Error("Simulated: the response was lost");
          }
          return rows;
        },
      }));
      await expect(losing.recordRenders(batch.id, items)).rejects.toThrow("Simulated");
      await losing.recordRenders(batch.id, items);
      expect(await batches.finishBatch(batch.id, RENDERS)).toMatchObject({ status: "complete" });
    });

    it("marks everything idempotent, and gives the same answers when all of it is resent", async () => {
      const { adapter: counted, sent } = counting(adapter);
      const model = over(() => replaying(counted));
      const golden = await recordBatch(SHA_A, [rendered("a", 1), rendered("b", 2), rendered("gone", 5)], ENV, model);
      await approve([rendered("a", 1), rendered("b", 2), rendered("gone", 5)], ENV, model);
      expect(await model.acceptBatch(golden.id, null, 0)).toBe(true);
      const head = await recordBatch(
        SHA_B,
        [rendered("a", 1), rendered("b", 3), rendered("c", 4), { story: "d", failure: "Boom" }],
        ENV,
        model,
      );
      const states = await statesOf(head.id, SHA_A, model);
      expect(states).toEqual({ a: "unchanged", b: "changed", c: "added", d: "failed", gone: "removed" });
      expect(await model.batchesAt(SHA_B, ENV)).toHaveLength(1);
      expect(await model.acceptedBatchAt(SHA_A, ENV)).not.toBeNull();
      expect(await model.getBatch(head.id)).toMatchObject({ failedCount: 1 });

      // A rerun accepted over its own SHA's goldens, with a removal. Sent again, the baseline
      // is by then the batch itself and nothing reads as removed, so it mustn't report a mismatch.
      const rerun = await recordBatch(SHA_A, [rendered("a", 1), rendered("b", 2)], ENV, model);
      expect(await model.acceptBatch(rerun.id, SHA_A, 1)).toBe(true);

      expect(sent.flat().filter(({ idempotent }) => idempotent !== true)).toEqual([]);
      // Finished at the first send's time, not the second's.
      expect((await batches.getBatch(head.id))?.finishedAt).toBe(head.finishedAt);
    });
  });

  describe("decisions", () => {
    const decisionOn = async (batchId: string) => (await heldBy(batchId))[0]?.decision;
    const decide = (decision: "approved" | "rejected", actor: string) =>
      batches.decide({ on: ON,
        environment: ENV,
        decision,
        actor,
        renders: [{ story: "a", imageHash: hashOf(1) }],
      });

    it("keeps the most recent decision, with who and when", async () => {
      clock = 500;
      const batch = await recordBatch(SHA_A, [rendered("a", 1)]);
      clock = 1_000;
      await decide("rejected", "bob");
      expect(await decisionOn(batch.id)).toEqual({ decision: "rejected", actor: "bob", at: 1_000 });
      clock = 2_000;
      await decide("approved", "ned");
      expect(await decisionOn(batch.id)).toEqual({ decision: "approved", actor: "ned", at: 2_000 });
    });

    it("carries through a push: no new approval at a new SHA for the same image", async () => {
      await goldensAt(SHA_A, [rendered("a", 1)]);
      const local = await recordBatch(SHA_B, [rendered("a", 2)]);
      await approve([rendered("a", 2)]);
      expect(await batches.compareBatch(local.id, SHA_A)).toMatchObject({
        renders: [{ state: "changed", decision: { decision: "approved", actor: "ned" } }],
      });

      // A rebase and push: a new SHA, a new batch, the same pixels.
      const pushed = await recordBatch(SHA_C, [rendered("a", 2)]);
      expect(await batches.compareBatch(pushed.id, SHA_A)).toMatchObject({
        renders: [{ state: "changed", decision: { decision: "approved", actor: "ned" } }],
      });
      expect(await batches.acceptBatch(pushed.id, SHA_A, 0)).toBe(true);
    });

    it("are refused, all of them, for an image this store doesn't hold", async () => {
      const held = { story: "held", imageHash: hashOf(1) };
      const missing = { story: "missing", imageHash: hashOf(9_999) };
      await expect(batches.decide({ on: ON, environment: ENV, decision: "approved", actor: "ned", renders: [held, missing] })).rejects.toMatchObject({ code: "unknown-image" });
      const decision = { decision: "approved" as const, actor: "ned", at: 1, gitSha: ON.gitSha, batchId: ON.batchId };
      await expect(batches.mergeDecisions(ENV, [{ ...held, ...decision }, { ...missing, ...decision }])).rejects.toMatchObject({ code: "unknown-image" });
      expect(await batches.decisionsAt(ENV, [ON.gitSha])).toEqual([]);
    });

    it("refuses a malformed hash, and a decision by nobody", async () => {
      await expect(
        batches.decide({ on: ON,
          environment: ENV,
          decision: "approved",
          actor: "ned",
          renders: [{ story: "a", imageHash: "1" }],
        }),
      ).rejects.toThrow("Not an image hash");
      await expect(
        batches.decide({ on: ON, environment: ENV, decision: "approved", actor: "", renders: [] }),
      ).rejects.toThrow("who made it");
    });
  });

  describe("goldens", () => {
    it("has none until a batch is accepted, then has that batch's images", async () => {
      expect(await batches.acceptedBatchAt(SHA_A, ENV)).toBeNull();
      await goldensAt(SHA_A, [rendered("a", 1), rendered("b", 2)]);
      expect(await batches.acceptedBatchAt(SHA_A, ENV)).not.toBeNull();
      expect(await batches.acceptedBatchAt(SHA_B, ENV)).toBeNull();
      expect(await batches.acceptedBatchAt(SHA_A, "other")).toBeNull();

      const head = await recordBatch(SHA_B, [rendered("a", 3), rendered("b", 2)]);
      expect((await batches.compareBatch(head.id, SHA_A, { includeUnchanged: true })).renders).toMatchObject([
        { story: "a", goldenHash: hashOf(1) },
        { story: "b", goldenHash: hashOf(2) },
      ]);
    });

    it("accepts what is unchanged or approved, and nothing else", async () => {
      await goldensAt(SHA_A, [rendered("a", 1), rendered("b", 2), rendered("gone", 3)]);
      const head = await recordBatch(SHA_B, [rendered("a", 1), rendered("b", 4), rendered("c", 5)]);

      // Nothing decided on the changed b or the new c.
      expect(await batches.acceptBatch(head.id, SHA_A, 1)).toBe(false);
      await approve([rendered("b", 4)]);
      expect(await batches.acceptBatch(head.id, SHA_A, 1)).toBe(false);

      // Another image for c is approved, and c's own is rejected.
      await approve([rendered("c", 6)]);
      expect(await batches.acceptBatch(head.id, SHA_A, 1)).toBe(false);
      await batches.decide({ on: ON,
        environment: ENV,
        decision: "rejected",
        actor: "bob",
        renders: [{ story: "c", imageHash: hashOf(5) }],
      });
      expect(await batches.acceptBatch(head.id, SHA_A, 1)).toBe(false);
      expect(await batches.acceptedBatchAt(SHA_B, ENV)).toBeNull();

      await approve([rendered("c", 5)]);
      expect(await batches.acceptBatch(head.id, SHA_A, 1)).toBe(true);
      expect(await batches.acceptedBatchAt(SHA_B, ENV)).not.toBeNull();
    });

    it("refuses to silently drop 500 goldens a filtered render missed", async () => {
      const everything = Array.from({ length: 510 }, (_, i) =>
        rendered(`story-${String(i).padStart(3, "0")}`, (i % 40) + 1),
      );
      await goldensAt(SHA_A, everything);

      // Every image it rendered is unchanged, so without the count this would be accepted.
      const filtered = await recordBatch(SHA_B, everything.slice(0, 10));
      const compared = await batches.compareBatch(filtered.id, SHA_A);
      expect(compared.unchangedCount).toBe(10);
      const removed = compared.renders.filter(({ state }) => state === "removed");
      expect(removed).toHaveLength(500);

      await expect(batches.acceptBatch(filtered.id, SHA_A, 0)).rejects.toMatchObject({
        code: "wrong-removed-count",
        message: expect.stringContaining("would remove 500 goldens, not the 0 the reviewer saw"),
      });
      await expect(batches.acceptBatch(filtered.id, SHA_A, 499)).rejects.toMatchObject({
        code: "wrong-removed-count",
      });
      expect(await batches.acceptedBatchAt(SHA_B, ENV)).toBeNull();

      // A reviewer who saw all 500 may accept them.
      expect(await batches.acceptBatch(filtered.id, SHA_A, removed.length)).toBe(true);
      expect(await batches.acceptedBatchAt(SHA_B, ENV)).not.toBeNull();
    });

    it("refuses a claim of removals with no baseline, and a wrong count of too many", async () => {
      const batch = await recordBatch(SHA_A, [rendered("a", 1)]);
      await approve([rendered("a", 1)]);
      await expect(batches.acceptBatch(batch.id, null, 1)).rejects.toMatchObject({
        code: "wrong-removed-count",
      });
      expect(await batches.acceptBatch(batch.id, null, 0)).toBe(true);
    });

    it("doesn't take an approval from another environment", async () => {
      const batch = await recordBatch(SHA_A, [rendered("a", 1)]);
      await approve([rendered("a", 1)], "other");
      expect(await batches.acceptBatch(batch.id, null, 0)).toBe(false);
    });

    it("refuses a batch with failures or still recording, and a baseline with no goldens", async () => {
      const failed = await recordBatch(SHA_A, [{ story: "a", failure: "Boom" }]);
      await expect(batches.acceptBatch(failed.id, null, 0)).rejects.toMatchObject({
        code: "batch-has-failures",
      });
      const recording = await batches.beginBatch({ gitSha: SHA_A, environment: ENV, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      await expect(batches.acceptBatch(recording.id, null, 0)).rejects.toMatchObject({
        code: "batch-not-finished",
      });

      // Approved, so only the missing baseline can stop it, and it must change nothing.
      const batch = await recordBatch(SHA_A, [rendered("a", 1)]);
      await approve([rendered("a", 1)]);
      await expect(batches.acceptBatch(batch.id, SHA_C, 0)).rejects.toMatchObject({ code: "no-goldens" });
      expect(await batches.acceptedBatchAt(SHA_A, ENV)).toBeNull();
    });

    it("lets a rerun's acceptance replace a SHA's goldens, all at once", async () => {
      await goldensAt(SHA_A, [rendered("a", 1), rendered("b", 2)]);
      const rerun = await recordBatch(SHA_A, [rendered("a", 3)]);
      expect(await batches.compareBatch(rerun.id, SHA_A)).toMatchObject({
        renders: [
          { story: "a", state: "changed", goldenHash: hashOf(1) },
          { story: "b", state: "removed", goldenHash: hashOf(2) },
        ],
      });
      await approve([rendered("a", 3)]);
      expect(await batches.acceptBatch(rerun.id, SHA_A, 1)).toBe(true);
      expect(await statesOf(rerun.id, SHA_A)).toEqual({ a: "unchanged" });
    });
  });

  describe("compare", () => {
    it("lists only differences and failures, unless asked for everything", async () => {
      await goldensAt(SHA_A, [rendered("same", 1), rendered("played", 2), rendered("calm", 3)]);
      const batch = await recordBatch(SHA_B, [
        rendered("same", 1),
        { ...rendered("played", 2), failure: "play: Boom" },
        rendered("calm", 3),
        { story: "broken", failure: "Boom" },
      ]);

      const differences = await batches.compareBatch(batch.id, SHA_A);
      expect(differences.renders.map(({ story, state, failure }) => [story, state, failure])).toEqual([
        ["broken", "failed", "Boom"],
        ["played", "failed", "play: Boom"],
      ]);
      expect(differences.unchangedCount).toBe(2);

      const everything = await batches.compareBatch(batch.id, SHA_A, { includeUnchanged: true });
      expect(everything.renders.map(({ story }) => story)).toEqual(["broken", "calm", "played", "same"]);
      expect(everything.unchangedCount).toBe(2);
    });

    it("lists a failure that has no golden, with or without a baseline", async () => {
      const batch = await recordBatch(SHA_A, [{ story: "a", failure: "Boom" }]);
      expect((await batches.compareBatch(batch.id, null)).renders).toMatchObject([{ state: "failed" }]);
      await goldensAt(SHA_B, [rendered("b", 1)]);
      expect((await batches.compareBatch(batch.id, SHA_B)).renders).toMatchObject([
        { story: "a", state: "failed", goldenHash: null },
        { story: "b", state: "removed" },
      ]);
    });

    it("counts nothing as unchanged with no baseline", async () => {
      const batch = await recordBatch(SHA_A, [rendered("a", 1)]);
      expect((await batches.compareBatch(batch.id, null)).unchangedCount).toBe(0);
    });

    it("compares images with colliding truncated hashes by their full hash", async () => {
      const a = hashOf(50_001);
      const b = hashOf(50_002);
      await sql.batch([imageInsertStatement(a, 500), imageInsertStatement(b, 500)]);
      await goldensAt(SHA_A, [{ story: "x", imageHash: a }]);
      const head = await recordBatch(SHA_B, [{ story: "x", imageHash: b }]);
      expect(await statesOf(head.id, SHA_A)).toEqual({ x: "changed" });
      expect(await batches.acceptBatch(head.id, SHA_A, 0)).toBe(false);
      await approve([{ story: "x", imageHash: a }]);
      expect(await batches.acceptBatch(head.id, SHA_A, 0)).toBe(false);
    });

    it("uses images a real Store put", async () => {
      const store = new Store({ codec: sharpCodec, sql, blob: temp.blob });
      const files = [1, 2].map((v) =>
        pngOf({ width: 1, height: 1, pixels: new Uint8Array([v, 0, 0]) }),
      );
      const [one, two] = await store.putImages(files);
      await goldensAt(SHA_A, [{ story: "x", imageHash: one!.hash }]);
      const head = await recordBatch(SHA_B, [{ story: "x", imageHash: two!.hash }]);
      const { renders: compared } = await batches.compareBatch(head.id, SHA_A);
      expect(compared).toMatchObject([
        { state: "changed", imageHash: two!.hash, goldenHash: one!.hash },
      ]);
    });

    it("reads every page, however the rows fall across them", async () => {
      // Exactly one page of compared renders, and more than one of removed ones.
      const PAGE = 5_000;
      const golden = Array.from({ length: PAGE + 5_500 }, (_, i) =>
        rendered(`old-${String(i).padStart(5, "0")}`, (i % 40) + 1),
      );
      await goldensAt(SHA_A, golden);
      const batch = await recordBatch(SHA_B, golden.slice(0, PAGE));
      const { renders: compared } = await batches.compareBatch(batch.id, SHA_A, { includeUnchanged: true });
      expect(compared.filter(({ state }) => state === "unchanged")).toHaveLength(PAGE);
      expect(compared.filter(({ state }) => state === "removed")).toHaveLength(5_500);
      expect(new Set(compared.map(({ story }) => story)).size).toBe(PAGE + 5_500);
    });

    it("reads every page of differences alone, past a batch of unchanged rows", async () => {
      const PAGE = 5_000;
      const golden = Array.from({ length: PAGE + 200 }, (_, i) =>
        rendered(`s-${String(i).padStart(5, "0")}`, 1),
      );
      await goldensAt(SHA_A, golden);
      // The first 100 are unchanged, and the rest differ, so differences span two pages.
      const batch = await recordBatch(
        SHA_B,
        golden.map((item, i) => (i < 100 ? item : rendered(item.story, 2))),
      );
      const { renders: compared, unchangedCount } = await batches.compareBatch(batch.id, SHA_A);
      expect(compared).toHaveLength(PAGE + 100);
      expect(new Set(compared.map(({ story }) => story)).size).toBe(PAGE + 100);
      expect(unchangedCount).toBe(100);
    });
  });

  describe("schema", () => {
    it("adds its tables to a store that holds only images, and can run again", async () => {
      const elsewhere = await createTempStore();
      try {
        await elsewhere.sql.batch(
          ["goldens", "decisions", "renders", "render_batches", "actors", "commits", "stories", "environments"].map((table) => ({
            sql: `DROP TABLE ${table}`,
          })),
        );
        await elsewhere.sql.run(imageInsertStatement(hashOf(1), 1));
        await initStoreSchema(elsewhere.sql);
        await initStoreSchema(elsewhere.sql);
        const model = new RenderBatches({ sql: elsewhere.sql });
        const batch = await recordBatch(SHA_A, [rendered("a", 1)], ENV, model);
        expect(batch.status).toBe("complete");
      } finally {
        await elsewhere.destroy();
      }
    });
  });

  describe("at scale", () => {
    const N = 10_000;
    const pad = (i: number) => `component-${String(i).padStart(5, "0")}--story`;

    /** Quicker than a statement per image. */
    const seedMany = (start: number, count: number) => {
      const db = new DatabaseSync(temp.path);
      try {
        const insert = db.prepare("INSERT OR IGNORE INTO images(key, hash) VALUES (?, ?)");
        db.exec("BEGIN");
        for (let i = start; i < start + count; i++) insert.run(i, hashOf(i));
        db.exec("COMMIT");
      } finally {
        db.close();
      }
    };

    it("records, compares, and accepts 10,000 renders in few requests", { timeout: 120_000 }, async () => {
      seedMany(1_000_000, N + 1_000);
      const { adapter: counted, sent, responseBytes } = counting(adapter);
      const model = new RenderBatches({ sql: new Sql(counted) });
      const report: Record<string, { ms: number; requests: number; statements: number; responseBytes: number }> = {};
      const measure = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
        sent.length = 0;
        responseBytes.length = 0;
        const start = performance.now();
        const result = await work();
        report[name] = {
          ms: Math.round(performance.now() - start),
          requests: sent.length,
          statements: sent.flat().length,
          responseBytes: responseBytes.reduce((sum, bytes) => sum + bytes, 0),
        };
        return result;
      };

      const goldenItems = Array.from({ length: N }, (_, i) => rendered(pad(i), 1_000_000 + i));
      const golden = await measure("beginBatch", () => model.beginBatch({ gitSha: SHA_A, environment: ENV, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, }));
      await measure("recordRenders", () => model.recordRenders(golden.id, goldenItems));
      await measure("finishBatch", () => model.finishBatch(golden.id, N));
      await measure("decide (all)", () => approve(goldenItems, ENV, model));
      const accepted = await measure("acceptBatch (all approved)", () => model.acceptBatch(golden.id, null, 0));
      expect(accepted).toBe(true);

      // 100 changed, 50 failed, and 50 removed, with 50 new, and the rest unchanged.
      const head: RecordedRender[] = goldenItems.slice(0, N - 50).map((item, i) =>
        i < 100
          ? rendered(item.story, 1_000_000 + N + i)
          : i < 150
            ? { story: item.story, failure: "Render threw" }
            : item,
      );
      for (let i = 0; i < 50; i++) head.push(rendered(`zz-new-${i}`, 1_000_000 + N + 500 + i));
      const batch = await measure("beginBatch (head)", () => model.beginBatch({ gitSha: SHA_B, environment: ENV, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, }));
      await measure("recordRenders (head)", () => model.recordRenders(batch.id, head));
      const finished = await measure("finishBatch (head)", () => model.finishBatch(batch.id, head.length));
      expect(finished.failedCount).toBe(50);

      const differences = await measure("compareBatch (differences)", () => model.compareBatch(batch.id, SHA_A));
      expect(differences.renders).toHaveLength(250);
      expect(differences.unchangedCount).toBe(N - 200);

      const { renders: compared } = await measure("compareBatch (includeUnchanged)", () =>
        model.compareBatch(batch.id, SHA_A, { includeUnchanged: true }),
      );
      const counts: Record<string, number> = {};
      for (const { state } of compared) counts[state] = (counts[state] ?? 0) + 1;
      expect(counts).toEqual({ unchanged: N - 200, changed: 100, failed: 50, added: 50, removed: 50 });

      console.log(`Render model at ${N} renders:`);
      console.table(report);

      expect(report.recordRenders!.requests).toBe(1);
      // One that checks the images are here, and one that writes.
      expect(report["decide (all)"]!.requests).toBe(2);
      expect(report["acceptBatch (all approved)"]!.requests).toBe(1);
      expect(report["compareBatch (differences)"]!.requests).toBe(1);
      // 10,000 rows at 5,000 per page, and one more that finds none.
      expect(report["compareBatch (includeUnchanged)"]!.requests).toBe(3);
    });

    it("refuses a row whose batch or image isn't here, as D1 does", async () => {
      const sql = new Sql(adapter);
      await expect(sql.run({ sql: "INSERT INTO renders(batch_key, story_key, failure) VALUES (424242, 424242, 'boom')" })).rejects.toThrow(/FOREIGN KEY/);
      await expect(sql.run({ sql: "INSERT INTO goldens(commit_key, environment_key, batch_key) VALUES (424242, 424242, 424242)" })).rejects.toThrow(/FOREIGN KEY/);
      await expect(sql.run({ sql: "INSERT INTO decisions(environment_key, commit_key, story_key, image_key, rejected, decided_at, actor_key, batch_id) VALUES (424242, 424242, 424242, 0, 0, 1, 424242, 'x')" })).rejects.toThrow(/FOREIGN KEY/);
      const batch = await recordBatch(SHA_A, [rendered("a", 1)]);
      const [{ key }] = (await sql.run({ sql: "SELECT key FROM render_batches WHERE id = ?1", params: [batch.id] })) as [{ key: number }];
      await sql.run({ sql: "INSERT INTO stories(id) VALUES ('never-rendered')" });
      await expect(sql.run({ sql: "INSERT INTO renders(batch_key, story_key, image_key) VALUES (CAST(?1 AS INTEGER), (SELECT key FROM stories WHERE id = 'never-rendered'), 424242)", params: [key] })).rejects.toThrow(/FOREIGN KEY/);
    });

    it("never scans a table, for anything a review or a sync sends", async () => {
      const { adapter: counted, sent } = counting(adapter);
      const model = new RenderBatches({ sql: new Sql(counted) });
      const items = [rendered("a", 1), rendered("b", 2)];
      const golden = await recordBatch(SHA_A, items, ENV, model);
      await approve(items, ENV, model);
      await model.acceptBatch(golden.id, null, 0);
      const head = await recordBatch(SHA_B, [rendered("a", 3), { story: "c", failure: "Boom" }], ENV, model);
      await model.compareBatch(head.id, SHA_A);
      await model.compareBatch(head.id, SHA_A, { includeUnchanged: true });
      await model.compareFromHistory(head.id, await model.decisionsAt(ENV, [SHA_A, SHA_B]));
      await model.commitsOfBranch("topic", ENV, 0, Number.MAX_SAFE_INTEGER);
      await model.acceptBatch(head.id, SHA_A, 1).catch(() => {});
      const clean = await recordBatch(SHA_C, [rendered("a", 3)], ENV, model);
      await model.acceptBatch(clean.id, SHA_A, 0).catch(() => {});
      await model.batchesAt(SHA_A, ENV);
      await model.firstWithGoldens([SHA_C, SHA_B, SHA_A], ENV);
      await model.getBatch(head.id);
      await model.finishBatch(head.id, 2);
      await model.finishBatch(head.id, 99).catch(() => {});
      await model.readBatch(head.id);
      await model.removedFrom(head.id, SHA_A);
      await model.mergeDecisions(ENV, [{ story: "a", imageHash: hashOf(3), decision: "approved", actor: "ned", at: 1, gitSha: ON.gitSha, batchId: ON.batchId }]);
      await model.adoptGoldens(clean.id);
      await model.receiveBatch(clean);

      const db = new DatabaseSync(temp.path);
      try {
        const seen = new Set<string>();
        const scans = sent.flat().flatMap(({ sql: text, params = [] }) => {
          seen.add(text);
          // A new name may fix a foreign key that's pending, so its plan lists every table that refers to it. SQLite skips
          // those while none is pending, and none ever is, since every statement here writes a parent first.
          if (/^INSERT INTO (environments|stories|commits|actors)\b/.test(text)) return [];
          const plan = db.prepare(`EXPLAIN QUERY PLAN ${text}`).all(...params);
          return plan
            .map(({ detail }) => String(detail))
            // Reading a statement's own VALUES or JSON list, or a one-row aggregate, is no table scan.
            // The primary key by environment alone is every decision there, which the plan doesn't call a scan.
            .filter((detail) => (/\bSCAN\b/.test(detail) && !/\bSCAN (v|c|j|json_each|\d+ CONSTANT ROWS?|CONSTANT ROW)\b/.test(detail)) || /USING PRIMARY KEY \(environment_key=\?\)/.test(detail))
            .map((detail) => `${detail} in ${text}`);
        });
        expect(seen.size).toBeGreaterThan(10);
        expect(scans).toEqual([]);
      } finally {
        db.close();
      }
    });
  });
});

describe("newestRenders", () => {
  const row = (story: string, state: ComparedRender["state"] = "unchanged"): ComparedRender => ({ story, state, imageHash: null, goldenHash: null, failure: null, decision: null });

  it("takes each story from the first batch that has it, and stops once each wanted one has an answer", async () => {
    const read: string[] = [];
    const rows: Record<string, ComparedRender[]> = { newest: [row("a")], middle: [row("a"), row("b")], oldest: [row("c")] };
    const rowsOf = async (batch: string) => {
      read.push(batch);
      return rows[batch]!;
    };
    const found = await newestRenders(["newest", "middle", "oldest"], rowsOf, new Set(["a", "b"]));
    expect(Object.fromEntries([...found].map(([story, { batch }]) => [story, batch]))).toEqual({ a: "newest", b: "middle" });
    expect(read).toEqual(["newest", "middle"]);
  });

  it("doesn't count what isn't wanted towards stopping, and reads a removed story as nothing", async () => {
    const rows: Record<string, ComparedRender[]> = { newest: [row("gone"), row("a"), row("b", "removed")], older: [row("b")] };
    const found = await newestRenders(["newest", "older"], async (batch) => rows[batch]!, new Set(["a", "b"]));
    expect(found.get("b")?.batch).toBe("older");
    expect(found.has("gone")).toBe(false);
  });

  it("reads every batch if it isn't told which stories", async () => {
    const found = await newestRenders(["one", "two"], async (batch) => [row(batch)]);
    expect([...found.keys()]).toEqual(["one", "two"]);
  });
});
