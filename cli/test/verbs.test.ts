// `selfie record`, and `selfie review` of a run it's told about, against real Git, a real store,
// real files, and only the browser replaced.
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { BLUE, commit, createHarness, git, GREEN, type Harness } from "./support.ts";

let h: Harness;
let build: string;
let captures: number;

const record = (...flags: string[]) => h.cli("record", "--storybook-dir", build, ...flags);
const reviewBuild = (...flags: string[]) => h.cli("review", "--storybook-dir", build, ...flags);

beforeEach(async () => {
  h = await createHarness();
  build = path.join(h.scratch, "build");
  await mkdir(build, { recursive: true });
  await writeFile(path.join(build, "iframe.html"), "<html></html>");
  h.stories = [{ id: "a--one" }, { id: "a--two" }];
  captures = 0;
  h.onCapture = () => {
    captures += 1;
  };
});
afterEach(async () => {
  await h.destroy();
});

describe("selfie record", () => {
  test("says what it recorded, and judges nothing", async () => {
    const { code, json } = await record();
    expect(code).toBe(0);
    expect(json).toMatchObject({ dirty: false, status: "complete", failedCount: 0, baseline: { sha: null } });
    expect(json).not.toHaveProperty("differences");
    expect(json).not.toHaveProperty("blockers");
    expect(json.next.join()).toContain(`selfie review ${json.runId}`);
  });

  test("exits 0 with a failed story, which is a fact for a review to judge", async () => {
    h.stories = [{ id: "a--one", failed: "It threw" }];
    const { code, json } = await record();
    expect(code).toBe(0);
    expect(json).toMatchObject({ status: "failed", failedCount: 1 });
    expect((await h.cli("review", json.runId)).code).toBe(1);
  });

  test("exits 2 if it couldn't run", async () => {
    const { code, json } = await record("--story", "nope--*");
    expect(code).toBe(2);
    expect(json.error.code).toBe("no-stories");
  });

  test("takes no run", async () => {
    expect((await record("some-run")).code).toBe(2);
  });
});

describe("selfie review <run>", () => {
  test("never renders, and compares with the baseline the run recorded", async () => {
    const first = await reviewBuild();
    await h.cli("approve", first.json.runId, "--all");
    await h.cli("accept", first.json.runId);
    await commit(h.repo, "moves on");
    h.stories = [{ id: "a--one", color: BLUE }, { id: "a--two" }];
    await writeFile(path.join(build, "iframe.html"), "<html>changed</html>");
    const head = await record();
    expect(captures).toBe(2);

    const reviewed = await h.cli("review", head.json.runId);
    expect(captures).toBe(2);
    expect(reviewed.code).toBe(1);
    expect(reviewed.json).toMatchObject({ runId: head.json.runId, comparedWith: { source: "baseline", sha: first.json.gitSha } });
    expect(reviewed.json.differences.map(({ story }: any) => story)).toEqual(["a--one"]);
    await readFile(reviewed.json.differences[0].diff);
  });

  test("reports a dirty run as dirty, without knowing its paths", async () => {
    await writeFile(path.join(h.repo, "untracked.txt"), "changed");
    const { json } = await record();
    const { json: reviewed } = await h.cli("review", json.runId);
    expect(reviewed).toMatchObject({ dirty: true, dirtyPaths: [] });
    expect(reviewed.next.join()).toContain("dirty");
  });

  test.each([
    ["--storybook-dir", "x"],
    ["--build-command", "x"],
    ["--story", "x"],
    ["--native"],
  ])("refuses %s, since the run is already recorded", async (...flags) => {
    const { json } = await record();
    const refused = await h.cli("review", json.runId, ...flags.filter((flag) => flag !== undefined));
    expect(refused.code).toBe(2);
    expect(refused.json.error.code).toBe("usage");
  });

  test.each([
    ["not-a-run", "bad-run-id"],
    ["00000000-0000-4000-8000-000000000000", "unknown-run"],
  ])("exits 2 for %s", async (run, errorCode) => {
    const { code, json } = await h.cli("review", run);
    expect(code).toBe(2);
    expect(json.error.code).toBe(errorCode);
  });

  test("takes one run, and says where a baseline goes", async () => {
    const { json } = await record();
    const refused = await h.cli("review", json.runId, json.runId);
    expect(refused.code).toBe(2);
    expect(refused.json.error.message).toContain("--baseline");
  });
});

describe("a branch when the default branch has no goldens", () => {
  /** Goldens at a commit on a feature branch. */
  async function goldensOnBranch() {
    git(h.repo, "switch", "--quiet", "-c", "feature");
    await commit(h.repo, "on feature");
    const first = await reviewBuild();
    await h.cli("approve", first.json.runId, "--all");
    expect((await h.cli("accept", first.json.runId)).code).toBe(0);
    return first.json;
  }
  /** And a new commit after them. */
  async function acceptedOnBranch() {
    const first = await goldensOnBranch();
    await commit(h.repo, "more on feature");
    return first;
  }
  const changeTheBuild = () => writeFile(path.join(build, "iframe.html"), `<html>${Math.random()}</html>`);

  test("compares with the nearest goldens there, and says so", async () => {
    const first = await acceptedOnBranch();
    h.stories = [{ id: "a--one", color: BLUE }, { id: "a--two" }];
    await changeTheBuild();
    const { code, json } = await reviewBuild();
    expect(code).toBe(1);
    expect(json.comparedWith).toEqual({ source: "branch", sha: first.gitSha, run: null });
    expect(json.baseline).toMatchObject({ sha: null, reason: "no-goldens" });
    expect(json.counts).toMatchObject({ unchanged: 1, changed: 1, new: 0, undecided: 1 });
    expect(json.differences.map(({ story, state }: any) => [story, state])).toEqual([["a--one", "changed"]]);
    expect(json.differences[0].pixelDiff.changedPixels).toBeGreaterThan(0);
    expect(json.next.join()).toContain("only to look at");
  });

  test("is only to look at: the run records no baseline, and accepting needs each image approved", async () => {
    await acceptedOnBranch();
    h.stories = [{ id: "a--one", color: BLUE }, { id: "a--two" }];
    await changeTheBuild();
    const { json } = await reviewBuild();

    const refused = await h.cli("accept", json.runId);
    expect(refused.code).toBe(1);
    expect(refused.json.baselineSha).toBeNull();
    expect(refused.json.refusals.flatMap(({ stories }: any) => stories.map(({ story }: any) => story))).toEqual(["a--one"]);

    await h.cli("approve", json.runId, "--story", "a--one");
    expect((await h.cli("accept", json.runId)).code).toBe(0);
  });

  test("won't let an image pass for matching a golden someone has since rejected", async () => {
    const first = await acceptedOnBranch();
    await h.cli("reject", first.runId, "--story", "a--one");
    await changeTheBuild();
    const { json } = await reviewBuild();
    expect(json.counts).toMatchObject({ unchanged: 2, changed: 0 });
    // What it blocks on is what accepting would refuse, whatever it shows.
    expect(json.blockers).toEqual([{ story: "a--one", reason: "rejected", detail: expect.any(String) }]);

    const refused = await h.cli("accept", json.runId);
    expect(refused.code).toBe(1);
    expect(refused.json.refusals[0].stories).toEqual([{ story: "a--one", state: "new", decision: "rejected" }]);
    expect((await h.cli("approve", json.runId, "--story", "a--one")).code).toBe(0);
    expect((await h.cli("accept", json.runId)).code).toBe(0);
  });

  test("a story gone since those goldens needs no count to accept", async () => {
    await acceptedOnBranch();
    h.stories = [{ id: "a--two" }];
    await changeTheBuild();
    const { json } = await reviewBuild();
    expect(json.counts.removed).toBe(1);
    expect(json.next.join()).toContain(`selfie accept ${json.runId}`);
    expect(json.next.join()).not.toContain("--removed");
    expect(json.blockers).toEqual([]);
    expect((await h.cli("accept", json.runId)).code).toBe(0);
  });

  test("a review at the commit with the goldens shows nothing differing", async () => {
    await goldensOnBranch();
    const again = await reviewBuild();
    expect(again.code).toBe(0);
    expect(again.json.comparedWith.source).toBe("branch");
    expect(again.json.differences).toEqual([]);
  });

  test("never applies on the default branch, or once it has goldens", async () => {
    const onMain = await reviewBuild();
    expect(onMain.json.comparedWith).toMatchObject({ source: "baseline", sha: null });

    await h.cli("approve", onMain.json.runId, "--all");
    await h.cli("accept", onMain.json.runId);
    git(h.repo, "switch", "--quiet", "-c", "feature");
    await commit(h.repo, "on feature");
    const one = await reviewBuild();
    await h.cli("accept", one.json.runId);
    await commit(h.repo, "more on feature");
    const two = await reviewBuild();
    expect(two.json.comparedWith).toEqual({ source: "baseline", sha: onMain.json.gitSha, run: null });
  });

  test("--baseline wins over it", async () => {
    const first = await acceptedOnBranch();
    const { json } = await reviewBuild();
    const given = await h.cli("review", json.runId, "--baseline", first.runId);
    expect(given.json.comparedWith).toEqual({ source: "given", sha: null, run: first.runId });
  });
});

describe("the config's storybookDir", () => {
  const config = (value: unknown) => writeFile(path.join(h.repo, "selfie.config.json"), JSON.stringify(value));

  beforeEach(async () => {
    await mkdir(path.join(h.repo, "built"));
    await writeFile(path.join(h.repo, "built", "iframe.html"), "<html></html>");
    h.onCapture = (options) => {
      captures += 1;
      seen = options.storybookDir;
    };
  });
  let seen: string | undefined;

  test("is what a command uses with no flag, relative to the Git top level", async () => {
    await config({ storybookDir: "built" });
    expect((await h.cli("record")).code).toBe(0);
    expect(seen).toBe(path.join(await realpath(h.repo), "built"));
  });

  test("loses to --storybook-dir", async () => {
    await config({ storybookDir: "built" });
    expect((await record()).code).toBe(0);
    expect(seen).toBe(build);
  });

  test.each(["../outside", "/etc"])("refuses %s, outside the repository", async (storybookDir) => {
    await config({ storybookDir });
    const { code, json } = await h.cli("record");
    expect(code).toBe(2);
    expect(json.error.code).toBe("bad-config");
  });

  test.each(["build-command", "build"])("has no %s, since a checkout must not run a shell", async (key) => {
    await config({ [key]: "touch pwned" });
    const { code, json } = await h.cli("record");
    expect(code).toBe(2);
    expect(json.error.code).toBe("bad-config");
  });

  test("a buildCommand isn't run unless someone asks, since a checkout must not run a shell by itself", async () => {
    const marker = path.join(h.scratch, "ran");
    await writeFile(path.join(h.repo, "selfie.config.json"), JSON.stringify({ buildCommand: `touch ${marker}` }));
    h.stories = [{ id: "a" }];
    await h.cli("record", "--storybook-dir", "ignored");
    await expect(access(marker)).rejects.toThrow();
    await h.cli("record", "--storybook-dir", "ignored", "--build");
    await expect(access(marker)).resolves.toBeUndefined();
  });
});

describe("regionMergeDistance", () => {
  const config = (value: unknown) => writeFile(path.join(h.repo, "selfie.config.json"), JSON.stringify(value));

  test("groups what a review shows, and never what it compares", async () => {
    const one = await record();
    h.stories = [{ id: "a--one", patch: [1, 1, 2, 2, [1, 2, 3]] }, { id: "a--two" }];
    const two = await record();
    const review = async () => (await h.cli("review", two.json.runId, "--baseline", one.json.runId)).json.differences[0];

    const standard = await review();
    expect(standard.regionGroups).toEqual([{ current: { x: 1, y: 1, width: 2, height: 2 }, golden: { x: 1, y: 1, width: 2, height: 2 }, kind: "changed" }]);
    await config({ regionMergeDistance: 100 });
    const wide = await review();
    expect(wide.pixelDiff).toEqual(standard.pixelDiff);
    expect(wide.diff.endsWith("diff.png")).toBe(true);
  });

  test.each([-1, "12"])("refuses %s", async (regionMergeDistance) => {
    const { json } = await record();
    await config({ regionMergeDistance });
    const refused = await h.cli("review", json.runId);
    expect(refused.code).toBe(2);
    expect(refused.json.error.code).toBe("bad-config");
  });
});

describe("selfie review --baseline", () => {
  describe("with a run, which is how to look for flakiness", () => {
    test("exits 0 when two renders match", async () => {
      const [one, two] = [await record(), await record()];
      const { code, json } = await h.cli("review", two.json.runId, "--baseline", one.json.runId);
      expect(code).toBe(0);
      expect(json.differences).toEqual([]);
      expect(json.comparedWith).toEqual({ source: "given", sha: null, run: one.json.runId });
    });

    test("exits 1 when they differ, even if both images are approved", async () => {
      const one = await record();
      h.stories = [{ id: "a--one", color: BLUE }, { id: "a--two" }];
      const two = await record();
      await h.cli("approve", one.json.runId, "--all");
      await h.cli("approve", two.json.runId, "--all");

      const { code, json } = await h.cli("review", two.json.runId, "--baseline", one.json.runId);
      expect(code).toBe(1);
      expect(json.blockers).toEqual([]);
      expect(json.differences.map(({ story, state }: any) => [story, state])).toEqual([["a--one", "changed"]]);
      expect(json.differences[0].pixelDiff.changedPixels).toBeGreaterThan(0);
      expect(json.next.join()).toContain("for this review alone");
    });

    test("changes nothing about the run: its exports, its comparison, or what accept checks", async () => {
      const one = await reviewBuild();
      h.stories = [{ id: "a--one", color: GREEN }, { id: "a--two" }];
      const two = await record();
      const reviewed = await h.cli("review", two.json.runId);
      const cache = path.join(path.dirname(path.dirname(path.dirname(reviewed.json.differences[0].current))), "review.json");
      const before = await readFile(cache, "utf8");

      const against = await h.cli("review", two.json.runId, "--baseline", one.json.runId);
      expect(against.json.differences[0].current).toContain(path.join("against", one.json.runId));
      expect(await readFile(cache, "utf8")).toBe(before);
      expect((await h.cli("review", two.json.runId)).json.comparedWith).toMatchObject({ source: "baseline", sha: null });

      // Nothing is approved, and comparing with a run holding the same image doesn't change that.
      const same = await h.cli("review", two.json.runId, "--baseline", two.json.runId);
      expect(same.code).toBe(0);
      expect((await h.cli("accept", two.json.runId)).code).toBe(1);
    });
  });

  describe("with a commit", () => {
    test("compares with its goldens, by anything Git calls it", async () => {
      const one = await reviewBuild();
      await h.cli("approve", one.json.runId, "--all");
      await h.cli("accept", one.json.runId);
      await commit(h.repo, "moves on");
      h.stories = [{ id: "a--one", color: BLUE }, { id: "a--two" }];
      const two = await record();

      const { code, json } = await h.cli("review", two.json.runId, "--baseline", "HEAD~1");
      expect(code).toBe(1);
      expect(json.comparedWith).toEqual({ source: "given", sha: one.json.gitSha, run: null });
      expect(json.differences.map(({ story }: any) => story)).toEqual(["a--one"]);
    });

    test("exits 2 if it has no goldens", async () => {
      const { json } = await record();
      const refused = await h.cli("review", json.runId, "--baseline", "HEAD");
      expect(refused.code).toBe(2);
      expect(refused.json.error.code).toBe("no-goldens");
    });
  });

  test.each(["nothing-by-this-name", "--end-of-options"])("exits 2 for %s", async (baseline) => {
    const { json } = await record();
    const refused = await h.cli("review", json.runId, `--baseline=${baseline}`);
    expect(refused.code).toBe(2);
    expect(refused.json.error.code).toBe("unknown-baseline");
  });

  test("exits 2 for a run in another environment", async () => {
    const one = await record();
    await writeFile(path.join(h.repo, "selfie.config.json"), JSON.stringify({ environment: { scale: 2 } }));
    const two = await record();
    const refused = await h.cli("review", two.json.runId, "--baseline", one.json.runId);
    expect(refused.code).toBe(2);
    expect(refused.json.error.code).toBe("no-baseline-run");
  });

  test("works with no run too, on the run for this build", async () => {
    const one = await record();
    const { code, json } = await reviewBuild("--baseline", one.json.runId);
    expect(code).toBe(0);
    expect(json.runId).toBe(one.json.runId);
    expect(captures).toBe(1);
  });
});
