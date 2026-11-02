// `selfie record`, and `selfie review` of a run it's told about, against real Git, a real store,
// real files, and only the browser replaced.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { BLUE, commit, createHarness, GREEN, type Harness } from "./support.ts";

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
    expect(reviewed.json).toMatchObject({ runId: head.json.runId, baseline: { sha: first.json.gitSha, given: false } });
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

describe("selfie review --baseline", () => {
  describe("with a run, which is how to look for flakiness", () => {
    test("exits 0 when two renders match", async () => {
      const [one, two] = [await record(), await record()];
      const { code, json } = await h.cli("review", two.json.runId, "--baseline", one.json.runId);
      expect(code).toBe(0);
      expect(json.differences).toEqual([]);
      expect(json.baseline).toMatchObject({ sha: null, run: one.json.runId, given: true });
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
      expect(json.differences[0].pixelDiff.kind).toBe("pixels");
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
      expect((await h.cli("review", two.json.runId)).json.baseline).toMatchObject({ sha: null, given: false });

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
      expect(json.baseline).toMatchObject({ sha: one.json.gitSha, run: null, given: true });
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
