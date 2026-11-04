import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareWithApprovals, decisionsThatCount, imageInsertStatement, RenderBatches, type PlacedDecision, type RenderBatch } from "../src/core/index.ts";
import { hashOf } from "./support/sql-params.ts";
import { createTempStore } from "./support/temp-store.ts";

const THIS = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const batch = { id: THIS } as RenderBatch;
const [A, B, C] = [hashOf(1), hashOf(2), hashOf(3)];
const SHA = "e".repeat(40);

const render = (story: string, imageHash: string | null) => ({ story, imageHash, failure: imageHash === null ? "broke" : null });
const approved = (story: string, imageHash: string | null, at: number, batchId = OTHER): PlacedDecision => ({ story, imageHash, decision: "approved", actor: "a", at, batchId, gitSha: SHA });
const rejected = (story: string, imageHash: string, at: number, batchId = OTHER): PlacedDecision => ({ story, imageHash, decision: "rejected", actor: "a", at, batchId, gitSha: SHA });

const states = (rendered: Parameters<typeof compareWithApprovals>[1], decisions: readonly PlacedDecision[]) =>
  compareWithApprovals(batch, rendered, decisions, { includeUnchanged: true }).renders.map(({ story, state, goldenHash, decision }) => [story, state, goldenHash, decision?.decision ?? null]);

describe("comparing with what history has approved", () => {
  it("reads everything as added with no approvals at all", () => {
    expect(states([render("s", A)], [])).toEqual([["s", "added", null, null]]);
  });

  it("is unchanged against an approval of the same image", () => {
    expect(states([render("s", A)], [approved("s", A, 1)])).toEqual([["s", "unchanged", A, "approved"]]);
  });

  it("shows a change against the newest approval, undecided", () => {
    expect(states([render("s", C)], [approved("s", A, 1), approved("s", B, 2)])).toEqual([["s", "changed", B, null]]);
  });

  it("doesn't read a story as unchanged the moment it's approved on this batch", () => {
    expect(states([render("s", B)], [approved("s", A, 1), approved("s", B, 2, THIS)])).toEqual([["s", "changed", A, "approved"]]);
    expect(states([render("s", A)], [approved("s", A, 2, THIS)])).toEqual([["s", "added", null, "approved"]]);
  });

  it("asks again about an image approved long ago that a change has brought back", () => {
    expect(states([render("s", A)], [approved("s", A, 1), approved("s", B, 2)])).toEqual([["s", "changed", B, null]]);
  });

  it("keeps a rejection that's newer than the reference, and forgets one that's older", () => {
    expect(states([render("s", B)], [approved("s", A, 1), rejected("s", B, 2)])).toEqual([["s", "changed", A, "rejected"]]);
    expect(states([render("s", B)], [rejected("s", B, 1), approved("s", A, 2)])).toEqual([["s", "changed", A, null]]);
  });

  it("at the same moment, takes a rejection over an approval", () => {
    expect(states([render("s", A)], [approved("s", A, 1, THIS), rejected("s", A, 1, THIS)])[0]![3]).toBe("rejected");
  });

  it("says a story with a reference is removed, until that's approved", () => {
    expect(states([], [approved("s", A, 1)])).toEqual([["s", "removed", A, null]]);
    expect(states([], [approved("s", A, 1), approved("s", null, 2, THIS)])).toEqual([["s", "removed", A, "approved"]]);
  });

  it("has no reference after an approved removal, so a later batch reads it as added", () => {
    expect(states([], [approved("s", A, 1), approved("s", null, 2)])).toEqual([]);
    expect(states([render("s", A)], [approved("s", A, 1), approved("s", null, 2)])).toEqual([["s", "added", null, null]]);
  });

  it("lists what's unchanged only if it's asked to, and counts it either way", () => {
    const { renders, unchangedCount } = compareWithApprovals(batch, [render("s", A), render("t", B)], [approved("s", A, 1), approved("t", A, 1)]);
    expect(renders.map(({ story }) => story)).toEqual(["t"]);
    expect(unchangedCount).toBe(1);
  });

  it("keeps a failed story's reference, with no decision", () => {
    expect(states([render("s", null)], [approved("s", A, 1)])).toEqual([["s", "failed", A, null]]);
  });
});

describe("what another store needs of a history", () => {
  const ats = (decisions: readonly PlacedDecision[]) => decisions.map(({ story, at }) => [story, at]);

  it("keeps everything back through the second approval, and nothing older", () => {
    const history = [approved("s", A, 1), rejected("s", C, 2), approved("s", B, 3), rejected("s", A, 4), approved("s", C, 5), rejected("s", B, 6)];
    expect(ats(decisionsThatCount(history))).toEqual([["s", 6], ["s", 5], ["s", 4], ["s", 3]]);
  });

  it("does it for each story on its own, whatever order they're given in", () => {
    const history = [approved("t", A, 3), approved("s", C, 3), approved("s", A, 1), approved("t", B, 9), approved("s", B, 2), approved("t", C, 1)];
    const counted = decisionsThatCount(history);
    expect(ats(counted.filter(({ story }) => story === "s"))).toEqual([["s", 3], ["s", 2]]);
    expect(ats(counted.filter(({ story }) => story === "t"))).toEqual([["t", 9], ["t", 3]]);
  });

  it("keeps a rejection newer than the approvals", () => {
    const rejection = rejected("s", C, 9);
    expect(decisionsThatCount([approved("s", A, 1), approved("s", B, 2), rejection])).toContainEqual(rejection);
    expect(ats(decisionsThatCount([approved("s", A, 1), approved("s", B, 2), approved("s", A, 3), rejection]))).toEqual([["s", 9], ["s", 3], ["s", 2]]);
  });

  it("keeps a rejection at the same moment as the second approval, since it's read first", () => {
    const history = [approved("s", A, 1), rejected("s", C, 2), approved("s", B, 2), approved("s", A, 3)];
    expect(decisionsThatCount(history)).toHaveLength(3);
    expect(decisionsThatCount(history)).toContainEqual(rejected("s", C, 2));
  });

  it("keeps all of a story with fewer than two approvals", () => {
    const none = [rejected("s", A, 1), rejected("s", B, 2)];
    expect(ats(decisionsThatCount(none))).toEqual([["s", 2], ["s", 1]]);
    const one = [rejected("t", A, 1), approved("t", B, 2), rejected("t", C, 3)];
    expect(ats(decisionsThatCount(one))).toEqual([["t", 3], ["t", 2], ["t", 1]]);
    expect(decisionsThatCount([])).toEqual([]);
  });

  it("counts an approved removal as an approval, and keeps it", () => {
    const removal = approved("s", null, 4);
    expect(decisionsThatCount([approved("s", A, 1), approved("s", B, 2), approved("s", C, 3), removal])).toEqual([removal, approved("s", C, 3)]);
  });

  it("gives what the whole history would, even for the batch that made the newest approval", () => {
    const history = [approved("s", A, 1), rejected("s", C, 2), approved("s", B, 3), rejected("s", B, 4), approved("s", C, 5, THIS), approved("t", A, 1), approved("gone", A, 1), approved("gone", B, 2), approved("gone", null, 3, THIS)];
    const rendered = [render("s", C), render("t", B)];
    expect(states(rendered, decisionsThatCount(history))).toEqual(states(rendered, history));
    expect(states(rendered, history)).toEqual([["s", "changed", B, "approved"], ["t", "changed", A, null], ["gone", "removed", B, "approved"]]);
  });
});

describe("on a store", () => {
  let temp: Awaited<ReturnType<typeof createTempStore>>;
  let batches: RenderBatches;
  const ENV = "container-linux-arm64-0123456789abcdef";
  const SHAS = ["a".repeat(40), "b".repeat(40), "c".repeat(40)] as const;

  beforeEach(async () => {
    temp = await createTempStore();
    batches = new RenderBatches({ sql: temp.sql, now: (() => { let at = 1000; return () => (at += 1); })() });
  });
  afterEach(() => temp.destroy());

  const finished = async (gitSha: string, stories: Record<string, number>) => {
    const entries = Object.entries(stories);
    const hashes = entries.map(([, image]) => hashOf(image));
    await temp.sql.batch(entries.map(([, image]) => imageInsertStatement(hashOf(image), image)));
    const batch = await batches.beginBatch({ gitSha, environment: ENV, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, branch: "topic" });
    await batches.recordRenders(batch.id, entries.map(([story], at) => ({ story, imageHash: hashes[at]! })));
    await batches.finishBatch(batch.id, entries.length);
    return { batch, hash: (story: string) => hashes[entries.findIndex(([name]) => name === story)]! };
  };
  const approve = (batch: RenderBatch, story: string, imageHash: string | null) =>
    batches.decide({ environment: ENV, decision: "approved", actor: "a", renders: [{ story, imageHash }], on: { batchId: batch.id, gitSha: batch.gitSha } });

  it("only counts approvals at the commits it's told it can reach", async () => {
    const first = await finished(SHAS[0], { s: 1 });
    await approve(first.batch, "s", first.hash("s"));
    const later = await finished(SHAS[1], { s: 1 });
    expect((await batches.compareFromHistory(later.batch.id, await batches.decisionsAt(ENV, [SHAS[1], SHAS[0]]), { includeUnchanged: true })).renders[0]!.state).toBe("unchanged");
    expect((await batches.compareFromHistory(later.batch.id, await batches.decisionsAt(ENV, [SHAS[1]]), { includeUnchanged: true })).renders[0]!.state).toBe("added");
  });

  it("keeps a decision per commit, so approving the same pixels elsewhere doesn't take it from here", async () => {
    const first = await finished(SHAS[0], { s: 1 });
    await approve(first.batch, "s", first.hash("s"));
    const elsewhere = await finished(SHAS[2], { s: 1 });
    await approve(elsewhere.batch, "s", elsewhere.hash("s"));
    expect(await batches.decisionsAt(ENV, [SHAS[0]])).toHaveLength(1);
    expect(await batches.decisionsAt(ENV, [SHAS[2]])).toHaveLength(1);
  });

  it("works through the walkthrough: approve some, change the code, and approve only what's new", async () => {
    const first = await finished(SHAS[0], { a: 1, b: 2 });
    await approve(first.batch, "a", first.hash("a"));
    const second = await finished(SHAS[1], { a: 1, b: 3 });
    const compared = await batches.compareFromHistory(second.batch.id, await batches.decisionsAt(ENV, [SHAS[1], SHAS[0]]));
    expect(compared.renders.map(({ story, state }) => [story, state])).toEqual([["b", "added"]]);
    expect(compared.unchangedCount).toBe(1);
  });

  it("finds a branch's commits since a time, for a rebase's sake", async () => {
    const { batch } = await finished(SHAS[0], { a: 1 });
    expect(await batches.commitsOfBranch("topic", ENV, 0, Number.MAX_SAFE_INTEGER)).toEqual([SHAS[0]]);
    expect(await batches.commitsOfBranch("other", ENV, 0, Number.MAX_SAFE_INTEGER)).toEqual([]);
    expect(await batches.commitsOfBranch("topic", ENV, batch.startedAt + 1, Number.MAX_SAFE_INTEGER)).toEqual([]);
  });
});
