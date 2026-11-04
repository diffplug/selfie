// The package's exports as a UI would use them: plain results, no printing, no exit codes.
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  decide,
  isDecidable,
  openProject,
  readReviewCache,
  review,
  SelfieError,
  summarizeBatch,
  type Project,
} from "selfie-cli";
import { BLUE, createHarness, type Harness } from "./support.ts";

let h: Harness;
let project: Project;
const options = () => ({ render: h.render });

beforeEach(async () => {
  h = await createHarness();
  project = await openProject({ cwd: h.repo, env: { SELFIE_HOME: h.home } });
});
afterEach(async () => {
  project.close();
  await h.destroy();
});

test("isDecidable is true only of what differs", () => {
  expect(["changed", "added", "unchanged", "removed", "failed"].filter((state) => isDecidable(state as any))).toEqual([
    "changed",
    "added",
    "removed",
  ]);
});

test("a decision on exact images takes each as itself", async () => {
  h.stories = [{ id: "a*" }, { id: "ab" }];
  const { comparison } = await review(project, options());
  const { id: batchId } = comparison.batch;
  const star = comparison.renders.find(({ story }) => story === "a*")!;
  const target = { story: "a*", imageHash: star.imageHash! };
  const decided = await decide(project, { batchId, decision: "approved", actor: "ui", stories: { targets: [target] } });
  expect(decided.decided.map(({ story }) => story)).toEqual(["a*"]);
  expect(summarizeBatch(decided.comparison).counts.undecided).toBe(1);

  await expect(
    decide(project, { batchId, decision: "approved", actor: "ui", stories: { targets: [target, { story: "nobody", imageHash: star.imageHash! }] } }),
  ).rejects.toMatchObject({ code: "stale-decision" });
});

test("openProject needs only a directory and an environment, and fails with a code", async () => {
  await expect(openProject({ cwd: path.dirname(h.scratch), env: {} })).rejects.toSatisfy(
    (error) => error instanceof SelfieError && error.code === "not-a-repository",
  );
});

describe("review", () => {
  test("returns facts, and a verdict can be recomputed after every decision", async () => {
    h.stories = [{ id: "a" }, { id: "b" }];
    const reviewed = await review(project, options());
    const { id: batchId } = reviewed.comparison.batch;
    expect(reviewed.comparison.batch).toMatchObject({ dirty: false, baselineSha: null, storyFilter: null });
    expect(reviewed.dirtyPaths).toEqual([]);
    expect(reviewed.timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(summarizeBatch(reviewed.comparison).blockers.map(({ reason }) => reason)).toEqual([
      "added-unapproved",
      "added-unapproved",
    ]);
    // No wording about commands anywhere in a result.
    expect(JSON.stringify(reviewed)).not.toContain("selfie approve");

    const one = await decide(project, { batchId, decision: "approved", actor: "ui", stories: ["a"] });
    expect(one.decided.map(({ story }) => story)).toEqual(["a"]);
    expect(summarizeBatch(one.comparison).counts.undecided).toBe(1);

    const rest = await decide(project, { batchId, decision: "rejected", actor: "ui", stories: "all" });
    expect(summarizeBatch(rest.comparison).blockers.map(({ reason }) => reason)).toEqual(["rejected", "rejected"]);

    const all = await decide(project, { batchId, decision: "approved", actor: "ui", stories: "all" });
    expect(summarizeBatch(all.comparison).blockers).toEqual([]);
    const next = await review(project, options());
    expect(summarizeBatch(next.comparison).counts).toMatchObject({ unchanged: 2, undecided: 0 });
  });

  test("keeps a filter's unmatched patterns on the batch, and works without one", async () => {
    h.stories = [{ id: "a" }, { id: "b" }];
    const { comparison } = await review(project, { ...options(), stories: ["a", "nope"] });
    expect(comparison.batch.storyFilter).toEqual({ patterns: ["a", "nope"], unmatched: ["nope"] });
    expect(await project.batches.getBatch(comparison.batch.id)).toMatchObject({
      storyFilter: { patterns: ["a", "nope"], unmatched: ["nope"] },
    });
  });

  test("throws a coded error when it can't run", async () => {
    h.stories = [];
    await expect(review(project, options())).rejects.toSatisfy(
      (error) => error instanceof SelfieError && error.code === "no-stories",
    );
  });

  test("keeps the paths and pixel diffs in a cache that pruning can lose", async () => {
    h.stories = [{ id: "a" }];
    const first = await review(project, options());
    const batchId = first.comparison.batch.id;
    await decide(project, { batchId, decision: "approved", actor: "ui", stories: "all" });

    h.stories = [{ id: "a", color: BLUE }];
    const second = await review(project, options());
    const secondId = second.comparison.batch.id;
    const cache = await readReviewCache(project, secondId);
    expect(cache?.differences[0]).toMatchObject({
      story: "a",
      current: second.differences[0]!.current,
      golden: second.differences[0]!.golden,
      diff: second.differences[0]!.diff,
      pixelDiff: second.differences[0]!.pixelDiff,
    });

    await rm(path.dirname(second.differences[0]!.current!), { recursive: true });
    await rm(path.join(project.directory, "batches", secondId), { recursive: true });
    expect(await readReviewCache(project, secondId)).toBeNull();

    // What the UI would serve in its place.
    const image = await project.store.getImage(second.differences[0]!.imageHash!);
    expect(image).not.toBeNull();
  });
});
