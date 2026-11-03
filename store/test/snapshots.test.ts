import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  imageInsertStatement,
  initStoreSchema,
  Snapshots,
  Sql,
  Store,
  type RecordedSnapshot,
  type SqlAdapter,
  type SqlStatement,
} from "../src/core/index.ts";
import {
  describeSnapshotContract,
  failing,
  rendered,
  replaying,
} from "./contract/snapshots-contract.ts";
import { pngOf } from "./support/png-builder.ts";
import { hashOf } from "./support/sql-params.ts";
import { createTempStore } from "./support/temp-store.ts";

for (const mode of ["number", "string"] as const) {
  describeSnapshotContract("local SQLite", mode, async () => {
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

describe("Snapshots", () => {
  let temp: Awaited<ReturnType<typeof createTempStore>>;
  let adapter: SqlAdapter;
  let sql: Sql;
  let snapshots: Snapshots;
  let clock: number;

  const over = (wrap: (adapter: SqlAdapter) => SqlAdapter) =>
    new Snapshots({ sql: new Sql(wrap(adapter)), now: () => clock++ });

  /** A finished run of these snapshots. */
  const recordRun = async (
    gitSha: string,
    items: readonly RecordedSnapshot[],
    environment = ENV,
    model = snapshots,
  ) => {
    const run = await model.beginRun({ gitSha, environment, scale: 1, dirty: false, baselineSha: null });
    await model.recordSnapshots(run.id, items);
    return model.finishRun(run.id, items.length);
  };

  const approve = (items: readonly RecordedSnapshot[], environment = ENV, model = snapshots) =>
    model.decide({
      environment,
      decision: "approved",
      actor: "ned",
      snapshots: items.map(({ story, imageHash }) => ({ story, imageHash: imageHash! })),
    });

  /** Goldens at this SHA, holding these snapshots. */
  const goldensAt = async (gitSha: string, items: readonly RecordedSnapshot[]) => {
    const run = await recordRun(gitSha, items);
    await approve(items);
    expect(await snapshots.acceptRun(run.id, null, 0)).toBe(true);
    return run;
  };

  const statesOf = async (runId: string, baseline: string | null, model = snapshots) => {
    const { snapshots: compared } = await model.compareRun(runId, baseline, { includeUnchanged: true });
    return Object.fromEntries(compared.map(({ story, state }) => [story, state]));
  };

  /** What a run holds, as a reader finds out: its full comparison. */
  const heldBy = async (runId: string) => {
    const { snapshots: compared } = await snapshots.compareRun(runId, null, { includeUnchanged: true });
    return compared;
  };

  beforeEach(async () => {
    temp = await createTempStore();
    adapter = temp.connectAdapter();
    sql = new Sql(adapter);
    clock = 1_000;
    snapshots = new Snapshots({ sql, now: () => clock++ });
    await sql.batch(Array.from({ length: 40 }, (_, i) => imageInsertStatement(hashOf(i + 1), i + 1)));
  });

  afterEach(async () => {
    await temp.destroy();
  });

  describe("firstWithGoldens's requests", () => {
    it("stops at the first group holding one, and asks one query per group", async () => {
      const { sent, adapter: counted } = counting(adapter);
      const model = new Snapshots({ sql: new Sql(counted) });
      const golden = await recordRun(SHA_A, [rendered("a", 1)]);
      await approve([rendered("a", 1)]);
      await snapshots.acceptRun(golden.id, null, 0);

      const others = Array.from({ length: 1000 }, (_, i) => i.toString(16).padStart(40, "f"));
      expect(await model.firstWithGoldens(others, ENV)).toBeNull();
      expect(sent).toHaveLength(11);
      sent.length = 0;
      expect(await model.firstWithGoldens([SHA_A, ...others], ENV)).toBe(SHA_A);
      expect(sent).toHaveLength(1);
    });
  });

  describe("recording a play error", () => {
    it("cuts it as a failure is cut, by code point", async () => {
      const run = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV, scale: 1, dirty: false, baselineSha: null });
      await snapshots.recordSnapshots(run.id, [{ story: "a", failure: "boom", playError: `${"x".repeat(1999)}😀😀\0` }]);
      await snapshots.finishRun(run.id, 1);
      const { snapshots: compared } = await snapshots.compareRun(run.id, null);
      expect(compared[0]!.playError).toBe(`${"x".repeat(1999)}😀`);
    });

    it("keeps a statement inside the parameter limit when only some rows have one", async () => {
      const { sent, adapter: counted } = counting(adapter);
      const model = new Snapshots({ sql: new Sql(counted) });
      const run = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV, scale: 1, dirty: false, baselineSha: null });
      const rows = Array.from({ length: 200 }, (_, i) => ({
        story: `s${i}`,
        failure: "boom",
        ...(i % 2 === 0 ? { playError: "play" } : {}),
      }));
      await model.recordSnapshots(run.id, rows);
      for (const { params = [] } of sent.flat()) expect(params.length).toBeLessThanOrEqual(100);
      await expect(model.finishRun(run.id, 200)).resolves.toMatchObject({ failedCount: 200 });
    });
  });

  describe("names", () => {
    it("takes a story ID as opaque, whatever it holds", async () => {
      const stories = ["ui/button--primary", "it's", 'a"b', "--", "\u{1F600}", "123", "(?1)", "NULL"];
      const run = await recordRun(SHA_A, stories.map((story, i) => rendered(story, i + 1)));
      const held = await heldBy(run.id);
      expect(held.map(({ story }) => story).sort()).toEqual([...stories].sort());
    });

    it("refuses a scale that isn't a positive number", async () => {
      for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(snapshots.beginRun({ gitSha: SHA_A, environment: ENV, scale, dirty: false, baselineSha: null })).rejects.toThrow(RangeError);
      }
    });

    it("refuses what can't name a snapshot", async () => {
      const run = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV, scale: 1, dirty: false, baselineSha: null });
      for (const bad of ["", "a\0b"]) {
        await expect(snapshots.recordSnapshots(run.id, [rendered(bad, 1)])).rejects.toThrow(RangeError);
        await expect(snapshots.beginRun({ gitSha: SHA_A, environment: bad, scale: 1, dirty: false, baselineSha: null })).rejects.toThrow(RangeError);
      }
      await expect(
        snapshots.recordSnapshots(run.id, [{ story: "a", imageHash: "abc" }]),
      ).rejects.toThrow("Not an image hash");
      await expect(snapshots.recordSnapshots(run.id, [rendered("a", 1), rendered("a", 2)])).rejects.toThrow(
        "recorded twice",
      );
      for (const sha of ["abc123", SHA_A.toUpperCase()]) {
        await expect(snapshots.beginRun({ gitSha: sha, environment: ENV, scale: 1, dirty: false, baselineSha: null })).rejects.toThrow("Git SHA");
      }
      await expect(snapshots.finishRun(run.id, 0)).resolves.toMatchObject({ status: "complete" });
    });
  });

  describe("recording", () => {
    it("takes the newer result for a name, until the run is finished", async () => {
      const run = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV, scale: 1, dirty: false, baselineSha: null });
      await snapshots.recordSnapshots(run.id, [{ story: "a", failure: "Timeout" }, rendered("b", 1)]);
      await snapshots.recordSnapshots(run.id, [rendered("a", 2), { story: "b", failure: "Crash" }]);
      expect(await snapshots.finishRun(run.id, 2)).toMatchObject({ status: "failed", failedCount: 1 });
      expect(await heldBy(run.id)).toMatchObject([
        { story: "a", state: "new", imageHash: hashOf(2), failure: null },
        { story: "b", state: "failed", imageHash: null, failure: "Crash" },
      ]);

      await expect(snapshots.recordSnapshots(run.id, [rendered("b", 3)])).rejects.toMatchObject({
        code: "run-finished",
      });
      expect((await heldBy(run.id))[1]).toMatchObject({ state: "failed", failure: "Crash" });
    });

    it("records a failed story, so it isn't silently absent", async () => {
      const run = await recordRun(SHA_A, [{ story: "a", failure: "" }]);
      expect(run.status).toBe("failed");
      expect(await statesOf(run.id, null)).toEqual({ a: "failed" });
    });

    it("records a mix of results in one statement", async () => {
      const { adapter: counted, sent } = counting(adapter);
      const model = new Snapshots({ sql: new Sql(counted) });
      const run = await model.beginRun({ gitSha: SHA_A, environment: ENV, scale: 1, dirty: false, baselineSha: null });
      sent.length = 0;
      await model.recordSnapshots(run.id, [
        rendered("a", 1),
        { story: "b", failure: "Boom" },
        rendered("c", 2),
        rendered("d", 3),
        { story: "e", failure: "Second failure" },
      ]);
      expect(sent.flat()).toHaveLength(1);
      await model.finishRun(run.id, 5);
      expect(await heldBy(run.id)).toMatchObject([
        { story: "a", state: "new" },
        { story: "b", state: "failed" },
        { story: "c", state: "new" },
        { story: "d", state: "new" },
        { story: "e", state: "failed" },
      ]);
    });

    it("bounds a failure message without splitting a character", async () => {
      const run = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV, scale: 1, dirty: false, baselineSha: null });
      await snapshots.recordSnapshots(run.id, [{ story: "a", failure: "\0\u{1F600}".repeat(5_000) }]);
      await snapshots.finishRun(run.id, 1);
      expect((await heldBy(run.id))[0]?.failure).toBe("\u{1F600}".repeat(2_000));
    });

    it("refuses an image that isn't stored, and a run that doesn't exist", async () => {
      const run = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV, scale: 1, dirty: false, baselineSha: null });
      await expect(snapshots.recordSnapshots(run.id, [rendered("a", 9_999)])).rejects.toMatchObject({
        code: "unknown-image",
      });
      await expect(snapshots.recordSnapshots("nope", [rendered("a", 1)])).rejects.toMatchObject({
        code: "unknown-run",
      });
      await expect(snapshots.finishRun("nope", 0)).rejects.toMatchObject({ code: "unknown-run" });
      await expect(snapshots.compareRun("nope", null)).rejects.toMatchObject({ code: "unknown-run" });
      await expect(snapshots.acceptRun("nope", null, 0)).rejects.toMatchObject({ code: "unknown-run" });
      expect(await snapshots.getRun("nope")).toBeNull();
    });

    it("keeps the good rows of a statement that also names an unstored image", async () => {
      const run = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV, scale: 1, dirty: false, baselineSha: null });
      await expect(
        snapshots.recordSnapshots(run.id, [rendered("a", 1), rendered("b", 9_999)]),
      ).rejects.toMatchObject({ code: "unknown-image", message: expect.stringContaining("1 snapshots") });
      await expect(snapshots.finishRun(run.id, 2)).rejects.toMatchObject({
        message: expect.stringContaining("holds 1 snapshots"),
      });
    });

    it("finishes an empty run, and sends nothing for an empty call", async () => {
      const { adapter: counted, sent } = counting(adapter);
      const model = new Snapshots({ sql: new Sql(counted) });
      const run = await model.beginRun({ gitSha: SHA_A, environment: ENV, scale: 1, dirty: false, baselineSha: null });
      await model.recordSnapshots(run.id, []);
      await model.decide({ environment: ENV, decision: "approved", actor: "ned", snapshots: [] });
      expect(sent).toHaveLength(1);
      expect(await model.finishRun(run.id, 0)).toMatchObject({ status: "complete", failedCount: 0 });
    });

    it("lists runs at a SHA, crashed ones included, for one environment", async () => {
      const crashed = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV, scale: 1, dirty: false, baselineSha: null });
      const later = await recordRun(SHA_A, []);
      await recordRun(SHA_A, [], "other");
      await recordRun(SHA_B, []);
      expect((await snapshots.runsAt(SHA_A, ENV)).map(({ id, status }) => [id, status])).toEqual([
        [later.id, "complete"],
        [crashed.id, "recording"],
      ]);
      expect(await snapshots.getRun(crashed.id)).toEqual(crashed);
    });
  });

  describe("crashes partway", () => {
    // 19,600 snapshots fill the 400 statements of one request, so this takes two.
    const SNAPSHOTS = 20_000;
    const items: RecordedSnapshot[] = Array.from({ length: SNAPSHOTS }, (_, i) =>
      rendered(`story-${i}`, (i % 40) + 1),
    );

    it("sends a large run in as few requests as the limits allow", async () => {
      const { adapter: counted, sent } = counting(adapter);
      const model = new Snapshots({ sql: new Sql(counted) });
      const run = await model.beginRun({ gitSha: SHA_A, environment: ENV, scale: 1, dirty: false, baselineSha: null });
      sent.length = 0;
      await model.recordSnapshots(run.id, items);
      expect(sent.map((statements) => statements.length)).toEqual([400, 9]);
    });

    it.each([
      ["nothing landed", 0, 19_600],
      ["its statements landed in part", 5, 19_600 + 5 * 49],
    ])("leaves a run that says so when a batch dies and %s", async (_, ran, stored) => {
      const run = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV, scale: 1, dirty: false, baselineSha: null });
      let requests = 0;
      const dying = over((inner) => failing(inner, () => ++requests === 2, ran));

      await expect(dying.recordSnapshots(run.id, items)).rejects.toThrow("Simulated");

      // What a crash leaves: a run that says so, and refuses to be taken for complete.
      expect((await snapshots.getRun(run.id))?.status).toBe("recording");
      await expect(snapshots.finishRun(run.id, SNAPSHOTS)).rejects.toMatchObject({
        code: "wrong-snapshot-count",
        message: expect.stringContaining(`holds ${stored} snapshots`),
      });
      await expect(snapshots.compareRun(run.id, null)).rejects.toMatchObject({
        code: "run-not-finished",
      });
      await expect(snapshots.acceptRun(run.id, null, 0)).rejects.toMatchObject({
        code: "run-not-finished",
      });

      // A new run replaces it, and it stays behind, still saying what it is.
      const fresh = await recordRun(SHA_A, items);
      expect(fresh.status).toBe("complete");
      expect((await snapshots.runsAt(SHA_A, ENV)).map(({ status }) => status)).toEqual([
        "complete",
        "recording",
      ]);
    });

    it("can send a failed call again, whatever of it landed", async () => {
      const run = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV, scale: 1, dirty: false, baselineSha: null });
      let requests = 0;
      const dying = over((inner) => failing(inner, () => ++requests === 2, 5));
      await expect(dying.recordSnapshots(run.id, items)).rejects.toThrow("Simulated");
      await snapshots.recordSnapshots(run.id, items);
      expect(await snapshots.finishRun(run.id, SNAPSHOTS)).toMatchObject({ status: "complete" });
    });

    it("keeps one row per name when a request commits and its response is lost", async () => {
      const run = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV, scale: 1, dirty: false, baselineSha: null });
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
      await expect(losing.recordSnapshots(run.id, items)).rejects.toThrow("Simulated");
      await losing.recordSnapshots(run.id, items);
      expect(await snapshots.finishRun(run.id, SNAPSHOTS)).toMatchObject({ status: "complete" });
    });

    it("marks everything idempotent, and gives the same answers when all of it is resent", async () => {
      const { adapter: counted, sent } = counting(adapter);
      const model = over(() => replaying(counted));
      const golden = await recordRun(SHA_A, [rendered("a", 1), rendered("b", 2), rendered("gone", 5)], ENV, model);
      await approve([rendered("a", 1), rendered("b", 2), rendered("gone", 5)], ENV, model);
      expect(await model.acceptRun(golden.id, null, 0)).toBe(true);
      const head = await recordRun(
        SHA_B,
        [rendered("a", 1), rendered("b", 3), rendered("c", 4), { story: "d", failure: "Boom" }],
        ENV,
        model,
      );
      const states = await statesOf(head.id, SHA_A, model);
      expect(states).toEqual({ a: "unchanged", b: "changed", c: "new", d: "failed", gone: "removed" });
      expect(await model.runsAt(SHA_B, ENV)).toHaveLength(1);
      expect(await model.hasCompleteGoldens(SHA_A, ENV)).toBe(true);
      expect(await model.getRun(head.id)).toMatchObject({ failedCount: 1 });

      // A rerun accepted over its own SHA's goldens, with a removal. Sent again, the baseline
      // is by then the run itself and nothing reads as removed, so it mustn't report a mismatch.
      const rerun = await recordRun(SHA_A, [rendered("a", 1), rendered("b", 2)], ENV, model);
      expect(await model.acceptRun(rerun.id, SHA_A, 1)).toBe(true);

      expect(sent.flat().filter(({ idempotent }) => idempotent !== true)).toEqual([]);
      // Finished at the first send's time, not the second's.
      expect((await snapshots.getRun(head.id))?.finishedAt).toBe(head.finishedAt);
    });
  });

  describe("decisions", () => {
    const decisionOn = async (runId: string) => (await heldBy(runId))[0]?.decision;
    const decide = (decision: "approved" | "rejected", actor: string) =>
      snapshots.decide({
        environment: ENV,
        decision,
        actor,
        snapshots: [{ story: "a", imageHash: hashOf(1) }],
      });

    it("keeps the most recent decision, with who and when", async () => {
      clock = 500;
      const run = await recordRun(SHA_A, [rendered("a", 1)]);
      clock = 1_000;
      await decide("rejected", "bob");
      expect(await decisionOn(run.id)).toEqual({ decision: "rejected", actor: "bob", at: 1_000 });
      clock = 2_000;
      await decide("approved", "ned");
      expect(await decisionOn(run.id)).toEqual({ decision: "approved", actor: "ned", at: 2_000 });
    });

    it("carries through a push: no new approval at a new SHA for the same image", async () => {
      await goldensAt(SHA_A, [rendered("a", 1)]);
      const local = await recordRun(SHA_B, [rendered("a", 2)]);
      await approve([rendered("a", 2)]);
      expect(await snapshots.compareRun(local.id, SHA_A)).toMatchObject({
        snapshots: [{ state: "changed", decision: { decision: "approved", actor: "ned" } }],
      });

      // A rebase and push: a new SHA, a new run, the same pixels.
      const pushed = await recordRun(SHA_C, [rendered("a", 2)]);
      expect(await snapshots.compareRun(pushed.id, SHA_A)).toMatchObject({
        snapshots: [{ state: "changed", decision: { decision: "approved", actor: "ned" } }],
      });
      expect(await snapshots.acceptRun(pushed.id, SHA_A, 0)).toBe(true);
    });

    it("may be recorded before the image reaches this store", async () => {
      const hash = hashOf(9_999);
      await snapshots.decide({
        environment: ENV,
        decision: "approved",
        actor: "ned",
        snapshots: [{ story: "a", imageHash: hash }],
      });
      await sql.run(imageInsertStatement(hash, 9_999));
      const run = await recordRun(SHA_A, [{ story: "a", imageHash: hash }]);
      expect(await snapshots.acceptRun(run.id, null, 0)).toBe(true);
    });

    it("refuses a malformed hash, and a decision by nobody", async () => {
      await expect(
        snapshots.decide({
          environment: ENV,
          decision: "approved",
          actor: "ned",
          snapshots: [{ story: "a", imageHash: "1" }],
        }),
      ).rejects.toThrow("Not an image hash");
      await expect(
        snapshots.decide({ environment: ENV, decision: "approved", actor: "", snapshots: [] }),
      ).rejects.toThrow("who made it");
    });
  });

  describe("goldens", () => {
    it("has none until a run is accepted, then has that run's images", async () => {
      expect(await snapshots.hasCompleteGoldens(SHA_A, ENV)).toBe(false);
      await goldensAt(SHA_A, [rendered("a", 1), rendered("b", 2)]);
      expect(await snapshots.hasCompleteGoldens(SHA_A, ENV)).toBe(true);
      expect(await snapshots.hasCompleteGoldens(SHA_B, ENV)).toBe(false);
      expect(await snapshots.hasCompleteGoldens(SHA_A, "other")).toBe(false);

      const head = await recordRun(SHA_B, [rendered("a", 3), rendered("b", 2)]);
      expect((await snapshots.compareRun(head.id, SHA_A, { includeUnchanged: true })).snapshots).toMatchObject([
        { story: "a", goldenHash: hashOf(1) },
        { story: "b", goldenHash: hashOf(2) },
      ]);
    });

    it("accepts what is unchanged or approved, and nothing else", async () => {
      await goldensAt(SHA_A, [rendered("a", 1), rendered("b", 2), rendered("gone", 3)]);
      const head = await recordRun(SHA_B, [rendered("a", 1), rendered("b", 4), rendered("c", 5)]);

      // Nothing decided on the changed b or the new c.
      expect(await snapshots.acceptRun(head.id, SHA_A, 1)).toBe(false);
      await approve([rendered("b", 4)]);
      expect(await snapshots.acceptRun(head.id, SHA_A, 1)).toBe(false);

      // Another image for c is approved, and c's own is rejected.
      await approve([rendered("c", 6)]);
      expect(await snapshots.acceptRun(head.id, SHA_A, 1)).toBe(false);
      await snapshots.decide({
        environment: ENV,
        decision: "rejected",
        actor: "bob",
        snapshots: [{ story: "c", imageHash: hashOf(5) }],
      });
      expect(await snapshots.acceptRun(head.id, SHA_A, 1)).toBe(false);
      expect(await snapshots.hasCompleteGoldens(SHA_B, ENV)).toBe(false);

      await approve([rendered("c", 5)]);
      expect(await snapshots.acceptRun(head.id, SHA_A, 1)).toBe(true);
      expect(await snapshots.hasCompleteGoldens(SHA_B, ENV)).toBe(true);
    });

    it("refuses to silently drop 500 goldens a filtered render missed", async () => {
      const everything = Array.from({ length: 510 }, (_, i) =>
        rendered(`story-${String(i).padStart(3, "0")}`, (i % 40) + 1),
      );
      await goldensAt(SHA_A, everything);

      // Every image it rendered is unchanged, so without the count this would be accepted.
      const filtered = await recordRun(SHA_B, everything.slice(0, 10));
      const compared = await snapshots.compareRun(filtered.id, SHA_A);
      expect(compared.unchangedCount).toBe(10);
      const removed = compared.snapshots.filter(({ state }) => state === "removed");
      expect(removed).toHaveLength(500);

      await expect(snapshots.acceptRun(filtered.id, SHA_A, 0)).rejects.toMatchObject({
        code: "wrong-removed-count",
        message: expect.stringContaining("would remove 500 goldens, not the 0 the reviewer saw"),
      });
      await expect(snapshots.acceptRun(filtered.id, SHA_A, 499)).rejects.toMatchObject({
        code: "wrong-removed-count",
      });
      expect(await snapshots.hasCompleteGoldens(SHA_B, ENV)).toBe(false);

      // A reviewer who saw all 500 may accept them.
      expect(await snapshots.acceptRun(filtered.id, SHA_A, removed.length)).toBe(true);
      expect(await snapshots.hasCompleteGoldens(SHA_B, ENV)).toBe(true);
    });

    it("refuses a claim of removals with no baseline, and a wrong count of too many", async () => {
      const run = await recordRun(SHA_A, [rendered("a", 1)]);
      await approve([rendered("a", 1)]);
      await expect(snapshots.acceptRun(run.id, null, 1)).rejects.toMatchObject({
        code: "wrong-removed-count",
      });
      expect(await snapshots.acceptRun(run.id, null, 0)).toBe(true);
    });

    it("doesn't take an approval from another environment", async () => {
      const run = await recordRun(SHA_A, [rendered("a", 1)]);
      await approve([rendered("a", 1)], "other");
      expect(await snapshots.acceptRun(run.id, null, 0)).toBe(false);
    });

    it("refuses a run with failures or still recording, and a baseline with no goldens", async () => {
      const failed = await recordRun(SHA_A, [{ story: "a", failure: "Boom" }]);
      await expect(snapshots.acceptRun(failed.id, null, 0)).rejects.toMatchObject({
        code: "run-has-failures",
      });
      const recording = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV, scale: 1, dirty: false, baselineSha: null });
      await expect(snapshots.acceptRun(recording.id, null, 0)).rejects.toMatchObject({
        code: "run-not-finished",
      });

      // Approved, so only the missing baseline can stop it, and it must change nothing.
      const run = await recordRun(SHA_A, [rendered("a", 1)]);
      await approve([rendered("a", 1)]);
      await expect(snapshots.acceptRun(run.id, SHA_C, 0)).rejects.toMatchObject({ code: "no-goldens" });
      expect(await snapshots.hasCompleteGoldens(SHA_A, ENV)).toBe(false);
    });

    it("lets a rerun's acceptance replace a SHA's goldens, all at once", async () => {
      await goldensAt(SHA_A, [rendered("a", 1), rendered("b", 2)]);
      const rerun = await recordRun(SHA_A, [rendered("a", 3)]);
      expect(await snapshots.compareRun(rerun.id, SHA_A)).toMatchObject({
        snapshots: [
          { story: "a", state: "changed", goldenHash: hashOf(1) },
          { story: "b", state: "removed", goldenHash: hashOf(2) },
        ],
      });
      await approve([rendered("a", 3)]);
      expect(await snapshots.acceptRun(rerun.id, SHA_A, 1)).toBe(true);
      expect(await statesOf(rerun.id, SHA_A)).toEqual({ a: "unchanged" });
    });
  });

  describe("compare", () => {
    it("lists only differences and any play error, unless asked for everything", async () => {
      await goldensAt(SHA_A, [rendered("same", 1), rendered("played", 2), rendered("calm", 3)]);
      const run = await recordRun(SHA_B, [
        rendered("same", 1),
        { ...rendered("played", 2), playError: "Boom" },
        rendered("calm", 3),
        { story: "broken", failure: "Boom" },
      ]);

      const differences = await snapshots.compareRun(run.id, SHA_A);
      expect(differences.snapshots.map(({ story, state, playError }) => [story, state, playError])).toEqual([
        ["broken", "failed", null],
        ["played", "unchanged", "Boom"],
      ]);
      expect(differences.unchangedCount).toBe(3);

      const everything = await snapshots.compareRun(run.id, SHA_A, { includeUnchanged: true });
      expect(everything.snapshots.map(({ story }) => story)).toEqual(["broken", "calm", "played", "same"]);
      expect(everything.unchangedCount).toBe(3);
    });

    it("lists a failure that has no golden, with or without a baseline", async () => {
      const run = await recordRun(SHA_A, [{ story: "a", failure: "Boom" }]);
      expect((await snapshots.compareRun(run.id, null)).snapshots).toMatchObject([{ state: "failed" }]);
      await goldensAt(SHA_B, [rendered("b", 1)]);
      expect((await snapshots.compareRun(run.id, SHA_B)).snapshots).toMatchObject([
        { story: "a", state: "failed", goldenHash: null },
        { story: "b", state: "removed" },
      ]);
    });

    it("counts nothing as unchanged with no baseline", async () => {
      const run = await recordRun(SHA_A, [rendered("a", 1)]);
      expect((await snapshots.compareRun(run.id, null)).unchangedCount).toBe(0);
    });

    it("compares images with colliding truncated hashes by their full hash", async () => {
      const a = hashOf(50_001);
      const b = hashOf(50_002);
      await sql.batch([imageInsertStatement(a, 500), imageInsertStatement(b, 500)]);
      await goldensAt(SHA_A, [{ story: "x", imageHash: a }]);
      const head = await recordRun(SHA_B, [{ story: "x", imageHash: b }]);
      expect(await statesOf(head.id, SHA_A)).toEqual({ x: "changed" });
      expect(await snapshots.acceptRun(head.id, SHA_A, 0)).toBe(false);
      await approve([{ story: "x", imageHash: a }]);
      expect(await snapshots.acceptRun(head.id, SHA_A, 0)).toBe(false);
    });

    it("uses images a real Store put", async () => {
      const store = new Store({ sql, blob: temp.blob });
      const files = [1, 2].map((v) =>
        pngOf({ width: 1, height: 1, pixels: new Uint8Array([v, 0, 0]) }),
      );
      const [one, two] = await store.putImages(files);
      await goldensAt(SHA_A, [{ story: "x", imageHash: one!.hash }]);
      const head = await recordRun(SHA_B, [{ story: "x", imageHash: two!.hash }]);
      const { snapshots: compared } = await snapshots.compareRun(head.id, SHA_A);
      expect(compared).toMatchObject([
        { state: "changed", imageHash: two!.hash, goldenHash: one!.hash },
      ]);
    });

    it("reads every page, however the rows fall across them", async () => {
      // Exactly one page of compared snapshots, and more than one of removed ones.
      const PAGE = 5_000;
      const golden = Array.from({ length: PAGE + 5_500 }, (_, i) =>
        rendered(`old-${String(i).padStart(5, "0")}`, (i % 40) + 1),
      );
      await goldensAt(SHA_A, golden);
      const run = await recordRun(SHA_B, golden.slice(0, PAGE));
      const { snapshots: compared } = await snapshots.compareRun(run.id, SHA_A, { includeUnchanged: true });
      expect(compared.filter(({ state }) => state === "unchanged")).toHaveLength(PAGE);
      expect(compared.filter(({ state }) => state === "removed")).toHaveLength(5_500);
      expect(new Set(compared.map(({ story }) => story)).size).toBe(PAGE + 5_500);
    });

    it("reads every page of differences alone, past a run of unchanged rows", async () => {
      const PAGE = 5_000;
      const golden = Array.from({ length: PAGE + 200 }, (_, i) =>
        rendered(`s-${String(i).padStart(5, "0")}`, 1),
      );
      await goldensAt(SHA_A, golden);
      // The first 100 are unchanged, and the rest differ, so differences span two pages.
      const run = await recordRun(
        SHA_B,
        golden.map((item, i) => (i < 100 ? item : rendered(item.story, 2))),
      );
      const { snapshots: compared, unchangedCount } = await snapshots.compareRun(run.id, SHA_A);
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
          ["runs", "run_snapshots", "decisions", "goldens"].map((table) => ({
            sql: `DROP TABLE ${table}`,
          })),
        );
        await elsewhere.sql.run(imageInsertStatement(hashOf(1), 1));
        await initStoreSchema(elsewhere.sql);
        await initStoreSchema(elsewhere.sql);
        const model = new Snapshots({ sql: elsewhere.sql });
        const run = await recordRun(SHA_A, [rendered("a", 1)], ENV, model);
        expect(run.status).toBe("complete");
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

    it("records, compares, and accepts 10,000 snapshots in few requests", { timeout: 120_000 }, async () => {
      seedMany(1_000_000, N + 1_000);
      const { adapter: counted, sent, responseBytes } = counting(adapter);
      const model = new Snapshots({ sql: new Sql(counted) });
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
      const golden = await measure("beginRun", () => model.beginRun({ gitSha: SHA_A, environment: ENV, scale: 1, dirty: false, baselineSha: null }));
      await measure("recordSnapshots", () => model.recordSnapshots(golden.id, goldenItems));
      await measure("finishRun", () => model.finishRun(golden.id, N));
      await measure("decide (all)", () => approve(goldenItems, ENV, model));
      const accepted = await measure("acceptRun (all approved)", () => model.acceptRun(golden.id, null, 0));
      expect(accepted).toBe(true);

      // 100 changed, 50 failed, and 50 removed, with 50 new, and the rest unchanged.
      const head: RecordedSnapshot[] = goldenItems.slice(0, N - 50).map((item, i) =>
        i < 100
          ? rendered(item.story, 1_000_000 + N + i)
          : i < 150
            ? { story: item.story, failure: "Render threw" }
            : item,
      );
      for (let i = 0; i < 50; i++) head.push(rendered(`zz-new-${i}`, 1_000_000 + N + 500 + i));
      const run = await measure("beginRun (head)", () => model.beginRun({ gitSha: SHA_B, environment: ENV, scale: 1, dirty: false, baselineSha: null }));
      await measure("recordSnapshots (head)", () => model.recordSnapshots(run.id, head));
      const finished = await measure("finishRun (head)", () => model.finishRun(run.id, head.length));
      expect(finished.failedCount).toBe(50);

      const differences = await measure("compareRun (differences)", () => model.compareRun(run.id, SHA_A));
      expect(differences.snapshots).toHaveLength(250);
      expect(differences.unchangedCount).toBe(N - 200);

      const { snapshots: compared } = await measure("compareRun (includeUnchanged)", () =>
        model.compareRun(run.id, SHA_A, { includeUnchanged: true }),
      );
      const counts: Record<string, number> = {};
      for (const { state } of compared) counts[state] = (counts[state] ?? 0) + 1;
      expect(counts).toEqual({ unchanged: N - 200, changed: 100, failed: 50, new: 50, removed: 50 });

      await measure("hasCompleteGoldens", () => model.hasCompleteGoldens(SHA_A, ENV));

      console.log(`Snapshot model at ${N} snapshots:`);
      console.table(report);

      expect(report.recordSnapshots!.requests).toBe(1);
      expect(report["decide (all)"]!.requests).toBe(1);
      expect(report["acceptRun (all approved)"]!.requests).toBe(1);
      expect(report["compareRun (differences)"]!.requests).toBe(1);
      // 10,000 rows at 5,000 per page, and one more that finds none.
      expect(report["compareRun (includeUnchanged)"]!.requests).toBe(3);
    });

    it("never scans a table, for anything a review or a sync sends", async () => {
      const { adapter: counted, sent } = counting(adapter);
      const model = new Snapshots({ sql: new Sql(counted) });
      const items = [rendered("a", 1), rendered("b", 2)];
      const golden = await recordRun(SHA_A, items, ENV, model);
      await approve(items, ENV, model);
      await model.acceptRun(golden.id, null, 0);
      const head = await recordRun(SHA_B, [rendered("a", 3), { story: "c", failure: "Boom" }], ENV, model);
      await model.compareRun(head.id, SHA_A);
      await model.compareRun(head.id, SHA_A, { includeUnchanged: true });
      await model.acceptRun(head.id, SHA_A, 1).catch(() => {});
      const clean = await recordRun(SHA_C, [rendered("a", 3)], ENV, model);
      await model.acceptRun(clean.id, SHA_A, 0).catch(() => {});
      await model.runsAt(SHA_A, ENV);
      await model.hasCompleteGoldens(SHA_A, ENV);
      await model.firstWithGoldens([SHA_C, SHA_B, SHA_A], ENV);
      await model.getRun(head.id);
      await model.finishRun(head.id, 2);
      await model.finishRun(head.id, 99).catch(() => {});
      await model.readRun(head.id);
      await model.mergeDecisions(ENV, [{ story: "a", imageHash: hashOf(3), decision: "approved", actor: "ned", at: 1 }]);
      await model.adoptGoldens(clean.id);
      await model.receiveRun(clean);

      const db = new DatabaseSync(temp.path);
      try {
        const seen = new Set<string>();
        const scans = sent.flat().flatMap(({ sql: text, params = [] }) => {
          seen.add(text);
          const plan = db.prepare(`EXPLAIN QUERY PLAN ${text}`).all(...params);
          return plan
            .map(({ detail }) => String(detail))
            // Reading a statement's own VALUES, or a one-row aggregate, is no table scan.
            .filter((detail) => /\bSCAN\b/.test(detail) && !/\bSCAN (v|c|\d+ CONSTANT ROWS?|CONSTANT ROW)\b/.test(detail))
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
