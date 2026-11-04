// `selfie render`, and `selfie review` of a batch it's told about, against real Git, a real store,
// real files, and only the browser replaced.
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { BLUE, commit, createHarness, git, GREEN, type Harness, TEST_CONFIG, writeTestConfig } from "./support.ts";

let h: Harness;
let build: string;
let renders: number;

const record = (...flags: string[]) => h.cli("render", ...flags);
const reviewBuild = (...flags: string[]) => h.cli("review", ...flags);

beforeEach(async () => {
  h = await createHarness();
  build = path.join(h.repo, TEST_CONFIG.storybookDir);
  await mkdir(build, { recursive: true });
  await writeFile(path.join(build, "iframe.html"), "<html></html>");
  h.stories = [{ id: "a--one" }, { id: "a--two" }];
  renders = 0;
  h.onRender = () => {
    renders += 1;
  };
});
afterEach(async () => {
  await h.destroy();
});

describe("selfie render", () => {
  test("says what it recorded, and judges nothing", async () => {
    const { code, json } = await record();
    expect(code).toBe(0);
    expect(json).toMatchObject({ dirty: false, status: "complete", failedCount: 0 });
    expect(json).not.toHaveProperty("baseline");
    expect(json).not.toHaveProperty("differences");
    expect(json).not.toHaveProperty("blockers");
    expect(json.next.join()).toContain(`selfie review ${json.batchId}`);
  });

  test("exits 0 with a failed story, which is a fact for a review to judge", async () => {
    h.stories = [{ id: "a--one", failed: "It threw" }];
    const { code, json } = await record();
    expect(code).toBe(0);
    expect(json).toMatchObject({ status: "failed", failedCount: 1 });
    expect((await h.cli("review", json.batchId)).code).toBe(1);
  });

  test("exits 2 if it couldn't run", async () => {
    const { code, json } = await record("--story", "nope--*");
    expect(code).toBe(2);
    expect(json.error.code).toBe("no-stories");
  });

  test("takes no batch", async () => {
    expect((await record("some-batch")).code).toBe(2);
  });
});

describe("selfie review <batch>", () => {
  test("never renders, and compares with what's approved", async () => {
    const first = await reviewBuild();
    await h.cli("approve", first.json.batchId, "--all");
    await commit(h.repo, "moves on");
    h.stories = [{ id: "a--one", color: BLUE }, { id: "a--two" }];
    await writeFile(path.join(build, "iframe.html"), "<html>changed</html>");
    const head = await record();
    expect(renders).toBe(2);

    const reviewed = await h.cli("review", head.json.batchId);
    expect(renders).toBe(2);
    expect(reviewed.code).toBe(1);
    expect(reviewed.json).toMatchObject({ batchId: head.json.batchId, comparedWith: { source: "approvals", sha: null, batch: null } });
    expect(reviewed.json.differences.map(({ story }: any) => story)).toEqual(["a--one"]);
    await readFile(reviewed.json.differences[0].diff);
  });

  test("reports a dirty batch as dirty, without knowing its paths", async () => {
    await writeFile(path.join(h.repo, "untracked.txt"), "changed");
    const { json } = await record();
    const { json: reviewed } = await h.cli("review", json.batchId);
    expect(reviewed).toMatchObject({ dirty: true, dirtyPaths: [] });
  });

  test.each([
    ["--build"],
    ["--story", "x"],
    ["--native"],
  ])("refuses %s, since the batch is already recorded", async (...flags) => {
    const { json } = await record();
    const refused = await h.cli("review", json.batchId, ...flags.filter((flag) => flag !== undefined));
    expect(refused.code).toBe(2);
    expect(refused.json.error.code).toBe("usage");
  });

  test.each([
    ["not-a-batch", "bad-batch-id"],
    ["00000000-0000-4000-8000-000000000000", "unknown-batch"],
  ])("exits 2 for %s", async (batch, errorCode) => {
    const { code, json } = await h.cli("review", batch);
    expect(code).toBe(2);
    expect(json.error.code).toBe(errorCode);
  });

  test("takes one batch, and says where a baseline goes", async () => {
    const { json } = await record();
    const refused = await h.cli("review", json.batchId, json.batchId);
    expect(refused.code).toBe(2);
    expect(refused.json.error.message).toContain("--baseline");
  });
});

describe("an approval someone takes back", () => {
  test("no longer counts, so its image blocks until approved again", async () => {
    const first = await reviewBuild();
    await h.cli("approve", first.json.batchId, "--all");
    await commit(h.repo, "moves on");
    await h.cli("reject", first.json.batchId, "--story", "a--one");
    await writeFile(path.join(build, "iframe.html"), "<html>changed</html>");

    const { code, json } = await reviewBuild();
    expect(code).toBe(1);
    expect(json.blockers).toEqual([{ story: "a--one", reason: "rejected", detail: "tester@example.com" }]);
    expect(json.differences.map(({ story, state }: any) => [story, state])).toEqual([["a--one", "added"]]);

    await h.cli("approve", json.batchId, "--story", "a--one");
    expect((await h.cli("review", json.batchId)).code).toBe(0);
  });
});

describe("the config's storybookDir", () => {
  const config = (value: object) => writeTestConfig(h.repo, value);

  beforeEach(async () => {
    await mkdir(path.join(h.repo, "built"));
    await writeFile(path.join(h.repo, "built", "iframe.html"), "<html></html>");
    h.onRender = (options) => {
      renders += 1;
      seen = options.storybookDir;
    };
  });
  let seen: string | undefined;

  test("is what a command uses, relative to the Git top level", async () => {
    await config({ storybookDir: "built" });
    expect((await h.cli("render")).code).toBe(0);
    expect(seen).toBe(path.join(await realpath(h.repo), "built"));
  });

  test.each(["../outside", "/etc"])("refuses %s, outside the repository", async (storybookDir) => {
    await config({ storybookDir });
    const { code, json } = await h.cli("render");
    expect(code).toBe(2);
    expect(json.error.code).toBe("bad-config");
  });

  test("a buildCommand isn't run unless someone asks, since a checkout must not run a shell by itself", async () => {
    const marker = path.join(h.scratch, "ran");
    await writeTestConfig(h.repo, { buildCommand: `touch ${marker}` });
    h.stories = [{ id: "a" }];
    await h.cli("render");
    await expect(access(marker)).rejects.toThrow();
    await h.cli("render", "--build");
    await expect(access(marker)).resolves.toBeUndefined();
  });
});

describe("hunkMergeDistance", () => {
  const config = (value: object) => writeTestConfig(h.repo, value);

  test("groups what a review shows, and never what it compares", async () => {
    const one = await record();
    h.stories = [{ id: "a--one", patch: [1, 1, 2, 2, [1, 2, 3]] }, { id: "a--two" }];
    const two = await record();
    const review = async () => (await h.cli("review", two.json.batchId, "--baseline", one.json.batchId)).json.differences[0];

    const standard = await review();
    expect(standard.hunkGroups).toEqual([{ current: { x: 1, y: 1, width: 2, height: 2 }, golden: { x: 1, y: 1, width: 2, height: 2 }, kind: "changed" }]);
    await config({ hunkMergeDistance: 100 });
    const wide = await review();
    expect(wide.pixelDiff).toEqual(standard.pixelDiff);
    expect(wide.diff.endsWith("diff.png")).toBe(true);
  });

  test.each([-1, "12"])("refuses %s", async (hunkMergeDistance) => {
    const { json } = await record();
    await config({ hunkMergeDistance });
    const refused = await h.cli("review", json.batchId);
    expect(refused.code).toBe(2);
    expect(refused.json.error.code).toBe("bad-config");
  });
});

describe("selfie review --baseline", () => {
  describe("with a batch, which is how to look for flakiness", () => {
    test("exits 0 when two renders match, with nothing approved", async () => {
      const [one, two] = [await record(), await record()];
      const { code, json } = await h.cli("review", two.json.batchId, "--baseline", one.json.batchId);
      expect(code).toBe(0);
      expect(json.differences).toEqual([]);
      expect(json.blockers).toEqual([]);
      expect(json.comparedWith).toEqual({ source: "given", sha: null, batch: one.json.batchId });
    });

    test("exits 1 when they differ, even if both images are approved", async () => {
      const one = await record();
      h.stories = [{ id: "a--one", color: BLUE }, { id: "a--two" }];
      const two = await record();
      await h.cli("approve", one.json.batchId, "--all");
      await h.cli("approve", two.json.batchId, "--all");

      const { code, json } = await h.cli("review", two.json.batchId, "--baseline", one.json.batchId);
      expect(code).toBe(1);
      expect(json.blockers).toEqual([]);
      expect(json.differences.map(({ story, state }: any) => [story, state])).toEqual([["a--one", "changed"]]);
      expect(json.differences[0].pixelDiff.changedPixels).toBeGreaterThan(0);
      expect(json.next.join()).toContain("for this review alone");
    });

    test("changes nothing about the batch: its exports, its comparison, or what blocks it", async () => {
      const one = await reviewBuild();
      h.stories = [{ id: "a--one", color: GREEN }, { id: "a--two" }];
      const two = await record();
      const reviewed = await h.cli("review", two.json.batchId);
      const cache = path.join(path.dirname(path.dirname(path.dirname(reviewed.json.differences[0].current))), "review.json");
      const before = await readFile(cache, "utf8");

      const against = await h.cli("review", two.json.batchId, "--baseline", one.json.batchId);
      expect(against.json.differences[0].current).toContain(path.join("against", one.json.batchId));
      expect(await readFile(cache, "utf8")).toBe(before);
      expect((await h.cli("review", two.json.batchId)).json.comparedWith).toEqual({ source: "approvals", sha: null, batch: null });

      // Nothing is approved, and comparing with a batch holding the same image doesn't change that.
      const same = await h.cli("review", two.json.batchId, "--baseline", two.json.batchId);
      expect(same.json.differences).toEqual([]);
      expect((await h.cli("review", two.json.batchId)).code).toBe(1);
    });
  });

  describe("with a commit", () => {
    test("compares with what its history approved, by anything Git calls it", async () => {
      const one = await reviewBuild();
      await h.cli("approve", one.json.batchId, "--all");
      await commit(h.repo, "moves on");
      h.stories = [{ id: "a--one", color: BLUE }, { id: "a--two" }];
      const two = await record();

      const { code, json } = await h.cli("review", two.json.batchId, "--baseline", "HEAD~1");
      expect(code).toBe(1);
      expect(json.comparedWith).toEqual({ source: "given", sha: one.json.gitSha, batch: null });
      expect(json.differences.map(({ story }: any) => story)).toEqual(["a--one"]);
    });

    test("with nothing approved in its history, everything is added", async () => {
      const { json } = await record();
      const { code, json: against } = await h.cli("review", json.batchId, "--baseline", "HEAD");
      expect(code).toBe(1);
      expect(against.comparedWith).toEqual({ source: "given", sha: json.gitSha, batch: null });
      expect(against.differences.map(({ state }: any) => state)).toEqual(["added", "added"]);
    });
  });

  test.each(["nothing-by-this-name", "--end-of-options"])("exits 2 for %s", async (baseline) => {
    const { json } = await record();
    const refused = await h.cli("review", json.batchId, `--baseline=${baseline}`);
    expect(refused.code).toBe(2);
    expect(refused.json.error.code).toBe("unknown-baseline");
  });

  test("exits 2 for a batch in another environment", async () => {
    const one = await record();
    await writeTestConfig(h.repo, { environment: { scale: 2 } });
    const two = await record();
    const refused = await h.cli("review", two.json.batchId, "--baseline", one.json.batchId);
    expect(refused.code).toBe(2);
    expect(refused.json.error.code).toBe("no-baseline-batch");
  });

  test("works with no batch too, on the batch for this built Storybook", async () => {
    const one = await record();
    const { json } = await reviewBuild("--baseline", one.json.batchId);
    expect(json.batchId).toBe(one.json.batchId);
    expect(json.differences).toEqual([]);
    expect(renders).toBe(1);
  });
});
