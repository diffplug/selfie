// The package's exports as a UI would use them: plain results, no printing, no exit codes.
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  accept,
  checkAccept,
  decide,
  findBaseline,
  isDecidable,
  openProject,
  readReviewCache,
  resolveRenderSettings,
  review,
  SelfieError,
  summarizeRun,
  type Project,
} from "selfie-cli";
import { BLUE, createHarness, git, type Harness } from "./support.ts";

let h: Harness;
let project: Project;
const options = () => ({ storybookDir: "ignored", render: h.render });

beforeEach(async () => {
  h = await createHarness();
  project = await openProject({ cwd: h.repo, env: { SELFIE_HOME: h.home } });
});
afterEach(async () => {
  project.close();
  await h.destroy();
});

test("isDecidable is true only of what has an added image", () => {
  expect(["changed", "added", "unchanged", "removed", "failed"].filter((state) => isDecidable(state as any))).toEqual([
    "changed",
    "added",
  ]);
});

test("a decision on exact images takes each as itself, and checkAccept changes nothing", async () => {
  h.stories = [{ id: "a*" }, { id: "ab" }];
  const { comparison } = await review(project, options());
  const { id: runId } = comparison.run;
  const star = comparison.snapshots.find(({ story }) => story === "a*")!;
  const target = { story: "a*", imageHash: star.imageHash! };
  const decided = await decide(project, { runId, decision: "approved", actor: "ui", stories: { targets: [target] } });
  expect(decided.decided.map(({ story }) => story)).toEqual(["a*"]);
  expect(summarizeRun(decided.comparison).counts.undecided).toBe(1);

  await expect(
    decide(project, { runId, decision: "approved", actor: "ui", stories: { targets: [target, { story: "nobody", imageHash: star.imageHash! }] } }),
  ).rejects.toMatchObject({ code: "stale-decision" });

  const all = await decide(project, { runId, decision: "approved", actor: "ui", stories: "all" });
  const check = await checkAccept(project, all.comparison);
  expect(check.refusals).toEqual([]);
  const { gitSha, environment } = all.comparison.run;
  expect(await project.snapshots.acceptedRunAt(gitSha, environment)).toBeNull();
  expect((await accept(project, { runId })).accepted).toBe(true);
  expect(await project.snapshots.acceptedRunAt(gitSha, environment)).toBe(runId);
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
    const { id: runId } = reviewed.comparison.run;
    expect(reviewed.comparison.run).toMatchObject({ dirty: false, baselineSha: null, storyFilter: null });
    expect(reviewed.dirtyPaths).toEqual([]);
    expect(reviewed.timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(summarizeRun(reviewed.comparison).blockers.map(({ reason }) => reason)).toEqual([
      "added-unapproved",
      "added-unapproved",
    ]);
    // No wording about commands anywhere in a result.
    expect(JSON.stringify(reviewed)).not.toContain("selfie approve");

    const one = await decide(project, { runId, decision: "approved", actor: "ui", stories: ["a"] });
    expect(one.decided.map(({ story }) => story)).toEqual(["a"]);
    expect(summarizeRun(one.comparison).counts.undecided).toBe(1);

    const rest = await decide(project, { runId, decision: "rejected", actor: "ui", stories: "all" });
    expect(summarizeRun(rest.comparison).blockers.map(({ reason }) => reason)).toEqual(["rejected", "rejected"]);

    const refused = await accept(project, { runId });
    expect(refused.accepted).toBe(false);
    expect(refused.refusals).toEqual([
      {
        reason: "unapproved",
        stories: [
          { story: "a", state: "added", decision: "rejected" },
          { story: "b", state: "added", decision: "rejected" },
        ],
      },
    ]);

    await decide(project, { runId, decision: "approved", actor: "ui", stories: "all" });
    const accepted = await accept(project, { runId });
    expect(accepted).toMatchObject({ accepted: true, refusals: [], usableAsBaseline: true });
    const { environmentId } = await resolveRenderSettings(project.repo);
    expect((await findBaseline(project, environmentId)).sha).toBe(git(h.repo, "rev-parse", "HEAD"));
  });

  test("keeps a filter's unmatched patterns on the run, and works without one", async () => {
    h.stories = [{ id: "a" }, { id: "b" }];
    const { comparison } = await review(project, { ...options(), stories: ["a", "nope"] });
    expect(comparison.run.storyFilter).toEqual({ patterns: ["a", "nope"], unmatched: ["nope"] });
    expect(await project.snapshots.getRun(comparison.run.id)).toMatchObject({
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
    const runId = first.comparison.run.id;
    await decide(project, { runId, decision: "approved", actor: "ui", stories: "all" });
    await accept(project, { runId });

    h.stories = [{ id: "a", color: BLUE }];
    const second = await review(project, options());
    const secondId = second.comparison.run.id;
    const cache = await readReviewCache(project, secondId);
    expect(cache?.differences[0]).toMatchObject({
      story: "a",
      current: second.differences[0]!.current,
      golden: second.differences[0]!.golden,
      diff: second.differences[0]!.diff,
      pixelDiff: second.differences[0]!.pixelDiff,
    });

    await rm(path.dirname(second.differences[0]!.current!), { recursive: true });
    await rm(path.join(project.directory, "runs", secondId), { recursive: true });
    expect(await readReviewCache(project, secondId)).toBeNull();

    // What the UI would serve in its place.
    const image = await project.store.getImage(second.differences[0]!.imageHash!);
    expect(image).not.toBeNull();
  });
});
