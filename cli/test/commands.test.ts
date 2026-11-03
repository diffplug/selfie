// The commands against real Git, a real store, and real files, with only the browser replaced.
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { decodeImage } from "./support.ts";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { encodePng } from "../src/png.ts";
import { BLUE, commit, createHarness, git, GREEN, RED, solid, type Harness } from "./support.ts";

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.destroy();
});

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );
const reasons = (list: readonly any[]) => list.map(({ reason }) => reason);
const review = (...flags: string[]) => h.cli("review", "--storybook-dir", "ignored", ...flags);
const writeConfig = (config: unknown) => writeFile(path.join(h.repo, "selfie.config.json"), JSON.stringify(config));
const projectDirectory = async () => path.join(h.home, (await readdir(h.home)).find((name) => name !== "d1.env")!);

/** Reviews, approves all, and accepts, so `h.stories` become the goldens of HEAD. */
async function makeGoldens(): Promise<string> {
  const { json } = await review();
  expect((await h.cli("approve", json.runId, "--all")).code).toBe(0);
  const accepted = await h.cli("accept", json.runId);
  expect(accepted.code).toBe(0);
  return json.gitSha;
}

describe("a first review, with no baseline", () => {
  beforeEach(() => {
    h.stories = [{ id: "a--one" }, { id: "a--two", color: BLUE }];
  });

  test("reports every story as new, with a current image, and exits 1", async () => {
    const { code, json, stderr } = await review();
    expect(code).toBe(1);
    expect(json.schemaVersion).toBe(1);
    expect(json.baseline).toEqual({ sha: null, reason: "no-goldens", message: expect.any(String) });
    expect(json.comparedWith).toEqual({ source: "baseline", sha: null, run: null });
    expect(json.gitSha).toBe(git(h.repo, "rev-parse", "HEAD"));
    expect(json.dirtyPaths).toEqual([]);
    expect(json.environment).toMatch(/^container-linux-arm64-/);
    expect(json.counts).toEqual({ stories: 2, unchanged: 0, changed: 0, added: 2, removed: 0, undecided: 2, advisories: 0 });
    expect(reasons(json.blockers)).toEqual(["added-unapproved", "added-unapproved"]);
    expect(json.advisories).toEqual([]);
    for (const difference of json.differences) {
      expect(difference.state).toBe("added");
      expect(await exists(difference.current)).toBe(true);
      expect(difference.golden).toBeNull();
      expect(difference.diff).toBeNull();
      expect(difference.imageHash).toMatch(/^[0-9a-f]{64}$/);
      expect((await decodeImage(await readFile(difference.current))).width).toBe(8);
    }
    expect(stderr).toContain("Recorded run");
    expect(stderr).toMatch(/Timings: render \d+ ms, store \d+ ms, compare \d+ ms, diff \d+ ms, total \d+ ms/);
  });

  test("leaves out what the document no longer carries", async () => {
    const { json } = await review();
    for (const key of ["failures", "status", "storybookDir", "outputDir", "initScriptSha256", "timings", "baselineSha", "needsAttention"]) {
      expect(json).not.toHaveProperty(key);
    }
  });

  test("becomes goldens with approve --all and accept, and then has nothing to report", async () => {
    const first = await review();
    expect((await h.cli("accept", first.json.runId)).code).toBe(1);

    const approved = await h.cli("approve", first.json.runId, "--all");
    expect(approved.code).toBe(0);
    expect(approved.json.actor).toBe("tester@example.com");
    expect(approved.json.decided.map(({ story }: any) => story)).toEqual(["a--one", "a--two"]);
    expect(approved.json.undecided).toEqual([]);

    const accepted = await h.cli("accept", first.json.runId);
    expect(accepted.code).toBe(0);
    expect(accepted.json).toMatchObject({
      accepted: true,
      gitSha: first.json.gitSha,
      baselineSha: null,
      removed: [],
      refusals: [],
      usableAsBaseline: true,
    });

    const second = await review();
    expect(second.code).toBe(0);
    expect(second.json.baseline.sha).toBe(first.json.gitSha);
    expect(second.json.differences).toEqual([]);
    expect(second.json.counts).toMatchObject({ stories: 2, unchanged: 2, undecided: 0 });
    expect(second.json.blockers).toEqual([]);
    expect(second.json.next).toEqual([]);

    const found = await h.cli("find-baseline");
    expect(found.code).toBe(0);
    expect(found.json.sha).toBe(first.json.gitSha);
  });

  test("at the merge-base, the next step is to accept here", async () => {
    const { json } = await review();
    expect(json.next.join(" ")).toContain(`selfie accept ${json.runId}`);
    expect(json.next.join(" ")).not.toContain("merge-base");
  });

  test("on a feature branch, says how to make a baseline, and that accepting here still helps", async () => {
    git(h.repo, "switch", "--quiet", "-c", "feature");
    await commit(h.repo, "on feature");
    const { json } = await review();
    const next = json.next.join(" ");
    expect(next).toContain("accept on main");
    expect(next).toContain("only show later reviews here what changed");
    expect(next).toContain("selfie accept " + json.runId);
  });

  test("accept says a feature branch's goldens are only for later reviews there", async () => {
    git(h.repo, "switch", "--quiet", "-c", "feature");
    await commit(h.repo, "on feature");
    const { json } = await review();
    await h.cli("approve", json.runId, "--all");
    const accepted = await h.cli("accept", json.runId);
    expect(accepted.code).toBe(0);
    expect(accepted.json).toMatchObject({ accepted: true, usableAsBaseline: false });
    expect(accepted.stderr).toContain("only later reviews on this branch will compare with these goldens");
    expect((await h.cli("find-baseline")).json.sha).toBeNull();
  });
});

describe("comparing with a baseline", () => {
  beforeEach(async () => {
    h.stories = [{ id: "a--one" }, { id: "a--two" }, { id: "b--three" }];
    await makeGoldens();
  });

  test("computes a pixel diff and writes all three images, only for what changed", async () => {
    h.stories = [
      { id: "a--one", patch: [2, 3, 4, 2, [90, 30, 30]] },
      { id: "a--two" },
      { id: "b--three" },
    ];
    const { code, json } = await review();
    expect(code).toBe(1);
    expect(json.counts).toMatchObject({ changed: 1, unchanged: 2, undecided: 1 });
    expect(reasons(json.blockers)).toEqual(["changed-unapproved"]);

    const [difference] = json.differences;
    expect(difference.imageHash).not.toBe(difference.goldenHash);
    expect(difference.pixelDiff).toEqual({
      current: { width: 8, height: 8 },
      golden: { width: 8, height: 8 },
      hunks: [{ current: { x: 2, y: 3, width: 4, height: 2 }, golden: { x: 2, y: 3, width: 4, height: 2 }, kind: "changed", changedPixels: 8, moved: [] }],
      changedPixels: 8,
      movedPixels: 0,
      spacingPixels: 0,
      totalPixels: 64,
      boundingBox: { x: 2, y: 3, width: 4, height: 2 },
      firstChanged: { x: 2, y: 3 },
      maxChannelDelta: 110,
    });
    expect((await decodeImage(await readFile(difference.current))).pixels[(3 * 8 + 2) * 3]).toBe(90);
    expect((await decodeImage(await readFile(difference.golden))).pixels[(3 * 8 + 2) * 3]).toBe(200);
    const diff = await decodeImage(await readFile(difference.diff));
    expect([...diff.pixels.subarray((3 * 8 + 2) * 3, (3 * 8 + 2) * 3 + 3)]).toEqual([255, 0, 80]);
    expect(diff.pixels[0]).toBe(diff.pixels[1]);

    const storiesDir = path.dirname(path.dirname(difference.current));
    expect(await readdir(storiesDir)).toHaveLength(1);
  });

  test("reports images of different sizes with a diff image", async () => {
    h.stories = [{ id: "a--one", width: 10, height: 4 }, { id: "a--two" }, { id: "b--three" }];
    const { code, json } = await review();
    expect(code).toBe(1);
    const [difference] = json.differences;
    expect(difference.pixelDiff).toMatchObject({
      current: { width: 10, height: 4 },
      golden: { width: 8, height: 8 },
    });
    expect(await exists(difference.diff)).toBe(true);
    expect(await exists(difference.current)).toBe(true);
    expect(await exists(difference.golden)).toBe(true);
    expect(reasons(json.blockers)).toEqual(["changed-unapproved"]);
  });

  test("shows removals, and requires the count to accept them", async () => {
    h.stories = [{ id: "a--one" }, { id: "a--two" }];
    await commit(h.repo, "second");
    const { code, json } = await review();
    expect(code).toBe(1);
    expect(reasons(json.blockers)).toEqual(["removed"]);
    expect(json.differences[0]).toMatchObject({ story: "b--three", state: "removed", current: null });
    expect(await exists(json.differences[0].golden)).toBe(true);
    expect(json.counts.removed).toBe(1);

    const unacknowledged = await h.cli("accept", json.runId);
    expect(unacknowledged.code).toBe(1);
    expect(unacknowledged.json.accepted).toBe(false);
    expect(unacknowledged.json.removed).toEqual(["b--three"]);
    expect(unacknowledged.json.refusals[0]).toMatchObject({
      reason: "removed-unacknowledged",
      stories: ["b--three"],
      outsideFilter: 0,
    });
    expect(unacknowledged.json.refusals[0].message).toContain("--removed 1");

    const wrong = await h.cli("accept", json.runId, "--removed", "2");
    expect(wrong.code).toBe(1);
    expect(wrong.json.refusals[0]).toMatchObject({ reason: "wrong-removed-count", seen: 2 });

    const right = await h.cli("accept", json.runId, "--removed", "1");
    expect(right.code).toBe(0);
    expect(right.json.removed).toEqual(["b--three"]);
    expect((await review()).json.differences).toEqual([]);
  });

  test("--removed is checked even when nothing is removed", async () => {
    await commit(h.repo, "second");
    const { json } = await review();
    const wrong = await h.cli("accept", json.runId, "--removed", "1");
    expect(wrong.code).toBe(1);
    expect(wrong.json.refusals[0]).toMatchObject({ reason: "wrong-removed-count", stories: [], seen: 1 });
  });

  test("a filter limits what's rendered, and doesn't call the rest removed", async () => {
    const { code, json } = await review("--story", "a--*");
    expect(code).toBe(0);
    expect(json.counts).toMatchObject({ stories: 2, removed: 0 });
    expect(json.filter).toEqual({ patterns: ["a--*"], notRendered: 1 });
    expect(json.differences).toEqual([]);

    // Accepting it would still drop that golden, so that needs the acknowledgment.
    const refused = await h.cli("accept", json.runId);
    expect(refused.code).toBe(1);
    expect(refused.json.refusals[0]).toMatchObject({ reason: "removed-unacknowledged", outsideFilter: 1 });
    expect(refused.json.refusals[0].message).toContain("outside this run's --story filter");
  });

  test("a filter still reports a matching story that's gone", async () => {
    h.stories = [{ id: "a--one" }, { id: "b--three" }];
    const { code, json } = await review("--story", "a--*");
    expect(code).toBe(1);
    expect(json.differences.map(({ story }: any) => story)).toEqual(["a--two"]);
    expect(json.filter.notRendered).toBe(1);
  });

  test("a pattern matching nothing is a mistake, not a pass", async () => {
    const none = await review("--story", "nope--*");
    expect(none.code).toBe(2);
    expect(none.json.error).toMatchObject({ code: "no-stories", message: expect.stringContaining("nope--*") });

    const some = await review("--story", "a--*", "--story", "nope--*");
    expect(some.code).toBe(1);
    expect(some.json.blockers).toEqual([{ story: null, reason: "pattern-unmatched", detail: "nope--*" }]);
  });

  test("baselines don't cross environments", async () => {
    await writeConfig({ environment: { viewport: { width: 640, height: 480 } } });
    const { json } = await h.cli("find-baseline");
    expect(json.sha).toBeNull();
    const reviewed = await review();
    expect(reviewed.json.baseline.sha).toBeNull();
    expect(reviewed.json.counts.added).toBe(3);

    await rm(path.join(h.repo, "selfie.config.json"));
    expect((await h.cli("find-baseline")).json.sha).not.toBeNull();
  });
});

describe("selfie.config.json", () => {
  beforeEach(() => {
    h.stories = [{ id: "a--one" }];
  });

  test("gives the environment and the init script", async () => {
    await writeFile(path.join(h.repo, "freeze.js"), "frozen();");
    await writeConfig({ environment: { scale: 2 }, initScript: "freeze.js" });
    let seen: any;
    h.onRender = (options) => {
      seen = options;
    };
    await review();
    expect(seen.initScript).toBe("frozen();");
    expect(seen.environment.scale).toBe(2);
  });

  test("uses the pinned default with no file", async () => {
    let seen: any;
    h.onRender = (options) => {
      seen = options;
    };
    await review();
    expect(seen.environment.scale).toBe(1);
    expect(seen.initScript).toBeUndefined();
  });

  test.each([
    [{ initScript: "../outside.js" }, "must be inside"],
    [{ initScript: "missing.js" }, "Can't read the init script"],
    [[1], "must hold a JSON object"],
  ])("refuses %j", async (config, message) => {
    await writeConfig(config);
    const { code, json } = await review();
    expect(code).toBe(2);
    expect(json.error).toMatchObject({ code: "bad-config", message: expect.stringContaining(message) });
  });

  test("refuses what isn't JSON", async () => {
    await writeFile(path.join(h.repo, "selfie.config.json"), "{nope");
    const { json } = await review();
    expect(json.error.code).toBe("bad-config");
  });
});

describe("decisions", () => {
  beforeEach(async () => {
    h.stories = [{ id: "a--one" }, { id: "a--two" }, { id: "b--three" }];
    await makeGoldens();
    h.stories = [{ id: "a--one", color: BLUE }, { id: "a--two", color: BLUE }, { id: "b--three", color: GREEN }];
  });

  test("a pattern decides only what it matches", async () => {
    const { json } = await review();
    const approved = await h.cli("approve", json.runId, "--story", "a--*");
    expect(approved.code).toBe(0);
    expect(approved.json.decided.map(({ story }: any) => story)).toEqual(["a--one", "a--two"]);
    expect(approved.json.undecided).toEqual([{ story: "b--three", state: "changed" }]);

    const refused = await h.cli("accept", json.runId);
    expect(refused.code).toBe(1);
    expect(refused.json.refusals[0]).toMatchObject({
      reason: "unapproved",
      stories: [{ story: "b--three", state: "changed", decision: null }],
    });
    expect(refused.json.refusals[0].message).toContain("b--three");

    expect((await h.cli("approve", json.runId, "--story", "b--*")).code).toBe(0);
    expect((await h.cli("accept", json.runId)).code).toBe(0);
  });

  test("a rejection blocks, and blocks accepting until it's changed", async () => {
    const { json } = await review();
    const rejected = await h.cli("reject", json.runId, "--all", "--actor", "agent-7");
    expect(rejected.code).toBe(0);
    expect(rejected.json).toMatchObject({ decision: "rejected", actor: "agent-7" });

    const next = await review();
    expect(next.code).toBe(1);
    expect(next.json.blockers[0]).toEqual({ story: "a--one", reason: "rejected", detail: "agent-7" });
    expect(next.json.differences[0].decision).toMatchObject({ decision: "rejected", actor: "agent-7" });
    expect(next.json.counts.undecided).toBe(0);

    const refused = await h.cli("accept", next.json.runId);
    expect(refused.code).toBe(1);
    expect(refused.json.refusals[0].stories[0]).toEqual({ story: "a--one", state: "changed", decision: "rejected" });

    await h.cli("approve", next.json.runId, "--all");
    expect((await h.cli("accept", next.json.runId)).code).toBe(0);
  });

  test("a decision holds for that image only", async () => {
    const { json } = await review();
    await h.cli("approve", json.runId, "--all");
    h.stories = [{ id: "a--one", color: GREEN }, { id: "a--two", color: BLUE }, { id: "b--three", color: GREEN }];
    const next = await review();
    expect(next.code).toBe(1);
    expect(next.json.blockers.map(({ story }: any) => story)).toEqual(["a--one"]);
  });

  test("a typo in a pattern exits 1, and decides nothing", async () => {
    const { json } = await review();
    const typo = await h.cli("approve", json.runId, "--story", "c--*");
    expect(typo.code).toBe(1);
    expect(typo.json.unmatchedPatterns).toEqual(["c--*"]);
    expect(typo.json.decided).toEqual([]);
  });

  test("needs --all or a pattern, and refuses both", async () => {
    const { json } = await review();
    expect((await h.cli("approve", json.runId)).json.error.code).toBe("usage");
    expect((await h.cli("approve", json.runId, "--all", "--story", "a*")).code).toBe(2);
  });

  test("refuses what isn't a run ID before it reaches a path, and reports an unknown one", async () => {
    const traversal = await h.cli("approve", "../../..", "--all");
    expect(traversal.code).toBe(2);
    expect(traversal.json.error.code).toBe("bad-run-id");
    expect((await h.cli("accept", "../../..")).json.error.code).toBe("bad-run-id");
    const unknown = await h.cli("accept", "00000000-0000-4000-8000-000000000000");
    expect(unknown.code).toBe(2);
    expect(unknown.json.error.code).toBe("unknown-run");
  });
});

describe("dirty trees", () => {
  beforeEach(async () => {
    h.stories = [{ id: "a--one" }];
    await makeGoldens();
    h.stories = [{ id: "a--one", color: BLUE }];
  });

  test("an approval made on a dirty tree holds after the commit", async () => {
    await writeFile(path.join(h.repo, "file.txt"), "edited\n");
    const dirty = await review();
    expect(dirty.code).toBe(1);
    expect(dirty.json.dirtyPaths).toEqual(["file.txt"]);
    expect((await h.cli("approve", dirty.json.runId, "--all")).code).toBe(0);

    const sha = await commit(h.repo, "edited");
    const after = await review();
    expect(after.code).toBe(0);
    expect(after.json.gitSha).toBe(sha);
    expect(after.json.dirtyPaths).toEqual([]);
    expect(after.json.differences[0]).toMatchObject({ state: "changed" });
    expect(after.json.differences[0].decision.decision).toBe("approved");
    expect(after.json.counts).toMatchObject({ undecided: 0 });
    expect(after.json.blockers).toEqual([]);

    expect((await h.cli("accept", after.json.runId)).code).toBe(0);
    const final = await review();
    expect(final.json.baseline.sha).toBe(sha);
    expect(final.json.differences).toEqual([]);
  });

  test("accept refuses a run recorded on a dirty tree, even once the tree is clean", async () => {
    await writeFile(path.join(h.repo, "file.txt"), "edited\n");
    const { json } = await review();
    await h.cli("approve", json.runId, "--all");
    git(h.repo, "checkout", "--", "file.txt");

    const refused = await h.cli("accept", json.runId);
    expect(refused.code).toBe(1);
    expect(reasons(refused.json.refusals)).toEqual(["recorded-on-dirty-tree"]);
    expect(refused.json.refusals[0].message).toContain("approvals carry over");
    expect(refused.stderr).toContain("Not accepted");
  });

  test("accept takes a run recorded clean, whatever the tree holds now", async () => {
    const sha = await commit(h.repo, "second");
    const { json } = await review();
    await h.cli("approve", json.runId, "--all");
    await writeFile(path.join(h.repo, "untracked.txt"), "x");
    const accepted = await h.cli("accept", json.runId);
    expect(accepted.code).toBe(0);
    expect(accepted.json.gitSha).toBe(sha);
  });

  test("accept takes a run recorded clean at an earlier commit, for that commit", async () => {
    const earlier = await commit(h.repo, "second");
    const { json } = await review();
    await h.cli("approve", json.runId, "--all");
    await commit(h.repo, "third");
    const accepted = await h.cli("accept", json.runId);
    expect(accepted.code).toBe(0);
    expect(accepted.json.gitSha).toBe(earlier);
    expect((await h.cli("find-baseline")).json.sha).toBe(earlier);
  });

  test("a HEAD that moves during the render fails the review", async () => {
    h.onRender = () => {
      h.onRender = undefined;
      git(h.repo, "commit", "--quiet", "--allow-empty", "-m", "moved");
    };
    const { code, json } = await review();
    expect(code).toBe(2);
    expect(json.error.code).toBe("head-moved");
  });
});

describe("blockers and advisories", () => {
  test("a failed story blocks, and blocks accepting", async () => {
    h.stories = [{ id: "a--one" }, { id: "a--two", failed: "boom" }];
    const { code, json } = await review();
    expect(code).toBe(1);
    expect(json.blockers).toContainEqual({ story: "a--two", reason: "failed", detail: "render: boom" });

    const approved = await h.cli("approve", json.runId, "--all");
    expect(approved.json.skipped).toEqual([{ story: "a--two", state: "failed" }]);
    const refused = await h.cli("accept", json.runId);
    expect(refused.code).toBe(1);
    expect(refused.json.refusals[0]).toMatchObject({ reason: "run-has-failures", stories: ["a--two"] });
  });

  test("play errors alone exit 0, and stay plainly visible", async () => {
    h.stories = [
      { id: "a--play", errors: [{ source: "play", message: "the play failed" }, { source: "console", message: "noise" }] },
      { id: "a--fine" },
    ];
    const first = await review();
    expect(first.code).toBe(1); // Everything is new, which does block.
    expect(reasons(first.json.blockers)).toEqual(["added-unapproved", "added-unapproved"]);
    expect(first.json.advisories).toEqual([
      { story: "a--play", reason: "play-error", detail: "the play failed" },
    ]);
    expect(first.json.counts.advisories).toBe(1);
    expect(first.json.playErrors[0]).toMatchObject({ story: "a--play", playError: "the play failed" });
    expect(await exists(first.json.playErrors[0].current)).toBe(true);

    await h.cli("approve", first.json.runId, "--all");
    const accepted = await h.cli("accept", first.json.runId);
    expect(accepted.code).toBe(0);
    expect(reasons(accepted.json.advisories)).toEqual(["play-error"]);

    // Unchanged, so nothing blocks, and they're still reported.
    const next = await review();
    expect(next.code).toBe(0);
    expect(next.json.blockers).toEqual([]);
    expect(next.json.differences).toEqual([]);
    expect(next.json.counts.advisories).toBe(1);
    expect(next.json.playErrors[0].story).toBe("a--play");
  });

  test("a PNG the store refuses fails that story alone", async () => {
    const alpha = await encodePng(solid(4, 4, RED));
    alpha[25] = 0; // IHDR color type, so its checksum no longer matches
    h.stories = [{ id: "a--one" }, { id: "a--bad", rawPng: alpha }];
    const { code, json } = await review();
    expect(code).toBe(1);
    expect(json.blockers[0]).toMatchObject({ story: "a--bad", reason: "failed" });
    expect(json.blockers[0].detail).toContain("The store refused its image");
    expect(json.counts).toMatchObject({ stories: 2, added: 1 });
  });
});

describe("a run pruned from disk", () => {
  test("can still be decided on and accepted, since its facts are in the store", async () => {
    h.stories = [{ id: "a--one" }, { id: "a--two" }];
    await makeGoldens();
    h.stories = [{ id: "a--one", color: BLUE }];
    await commit(h.repo, "second");
    const { json } = await review();
    const [difference] = json.differences;
    const runDir = path.join(await projectDirectory(), "runs", json.runId);
    expect(await exists(path.join(runDir, "review.json"))).toBe(true);
    await rm(runDir, { recursive: true });

    // The reviewer's baseline, the removal count, and the decisions all survive.
    const refused = await h.cli("accept", json.runId);
    expect(refused.code).toBe(1);
    expect(refused.json.baselineSha).toBe(json.baseline.sha);
    expect(reasons(refused.json.refusals)).toEqual(["unapproved", "removed-unacknowledged"]);

    const approved = await h.cli("approve", json.runId, "--all");
    expect(approved.code).toBe(0);
    expect(approved.json.decided[0].imageHash).toBe(difference.imageHash);
    expect((await h.cli("accept", json.runId, "--removed", "1")).code).toBe(0);
    expect((await h.cli("find-baseline")).json.sha).toBe(json.gitSha);
  });

  test("still refuses if it was recorded dirty, with no file to say so", async () => {
    h.stories = [{ id: "a--one" }];
    await writeFile(path.join(h.repo, "file.txt"), "edited\n");
    const { json } = await review();
    await h.cli("approve", json.runId, "--all");
    git(h.repo, "checkout", "--", "file.txt");
    await rm(path.join(await projectDirectory(), "runs", json.runId), { recursive: true });
    const refused = await h.cli("accept", json.runId);
    expect(reasons(refused.json.refusals)).toEqual(["recorded-on-dirty-tree"]);
  });

  test("still knows its filter", async () => {
    h.stories = [{ id: "a--one" }, { id: "b--two" }];
    await makeGoldens();
    const { json } = await review("--story", "a--*");
    await rm(path.join(await projectDirectory(), "runs", json.runId), { recursive: true });
    const refused = await h.cli("accept", json.runId);
    expect(refused.json.refusals[0]).toMatchObject({ reason: "removed-unacknowledged", outsideFilter: 1 });
  });
});

describe("untrusted names", () => {
  const isInside = (root: string, file: string) => path.resolve(file).startsWith(`${path.resolve(root)}${path.sep}`);

  test.each(["../../../../escape", "..", "a/b/../../c", "x\\y", ".hidden", `${"z".repeat(400)}--long`, "%2e%2e%2fup", "Same", "same"])(
    "story ID %j lands inside the run's directory",
    async (id) => {
      h.stories = [{ id: "plain", color: BLUE }];
      const baselineStories = [{ id, color: RED }];
      await makeGoldens();
      h.stories = [...h.stories, ...baselineStories];
      // The stand-in writes under the same encoding as the renderer. A name too long for a file
      // can't come from the renderer either, since it would be a failed story there.
      if (encodeURIComponent(id).length > 240) h.stories = [{ id: "plain", color: BLUE }, { id, failed: "too long" }];
      const { json } = await review();
      const runsRoot = path.join(await projectDirectory(), "runs", json.runId);
      for (const { current, golden, diff } of json.differences) {
        for (const file of [current, golden, diff]) {
          if (file !== null) expect(isInside(runsRoot, file)).toBe(true);
        }
      }
      expect(await readdir(h.scratch)).toEqual(expect.arrayContaining(["home", "repo"]));
      expect(await readdir(h.scratch)).toHaveLength(2);
    },
  );

  test("IDs differing only by case get different directories", async () => {
    h.stories = [{ id: "Same", color: RED }, { id: "same-other", color: BLUE }];
    const { json } = await review();
    const directories = json.differences.map(({ current }: any) => path.dirname(current));
    expect(new Set(directories).size).toBe(2);
  });

  test("a manifest path outside the render fails that story, and nothing outside is read", async () => {
    const secret = path.join(h.scratch, "secret.png");
    await writeFile(secret, await encodePng(solid(2, 2, GREEN)));
    h.stories = [
      { id: "a--escape", fileOverride: path.relative(path.join(h.home, "x", "render", "y"), secret) },
      { id: "a--absolute", fileOverride: secret },
      { id: "a--fine" },
    ];
    const { code, json } = await review();
    expect(code).toBe(1);
    const failed = json.blockers.filter(({ reason }: any) => reason === "failed");
    expect(failed.map(({ story }: any) => story)).toEqual(["a--absolute", "a--escape"]);
    for (const { detail } of failed) expect(detail).toContain("The render is unusable");
    expect(json.counts.added).toBe(1);
  });

  test("a symlink in place of an image fails that story", async () => {
    const secret = path.join(h.scratch, "secret.png");
    await writeFile(secret, await encodePng(solid(2, 2, GREEN)));
    h.stories = [{ id: "a--link", symlinkTo: secret }];
    const { json } = await review();
    expect(json.blockers[0].detail).toContain("isn't a regular file");
  });
});

describe("local data", () => {
  test("never touches d1.env beside the project directories, and keeps to one project directory", async () => {
    await mkdir(h.home, { recursive: true });
    const tokenFile = path.join(h.home, "d1.env");
    await writeFile(tokenFile, "TOKEN=secret\n");
    h.stories = [{ id: "a--one" }];
    const { stdout } = await review();
    expect(stdout).not.toContain("secret");
    expect(await readFile(tokenFile, "utf8")).toBe("TOKEN=secret\n");
    const entries = await readdir(h.home);
    expect(entries.sort()).toEqual(["d1.env", expect.stringMatching(/^local-[0-9a-f]{16}$/)]);
  });

  test("keeps the newest 20 run directories, and leaves no render directory behind", async () => {
    h.stories = [{ id: "a--one" }];
    const first = await review();
    let last = first;
    for (let i = 0; i < 21; i++) last = await review();
    const projectDir = await projectDirectory();
    const runs = await readdir(path.join(projectDir, "runs"));
    expect(runs).toHaveLength(20);
    expect(runs).toContain(last.json.runId);
    expect(runs).not.toContain(first.json.runId);
    expect(await readdir(path.join(projectDir, "render"))).toEqual([]);

    // The oldest was pruned, and can still be acted on.
    expect((await h.cli("approve", first.json.runId, "--all")).code).toBe(0);
    expect((await h.cli("accept", first.json.runId)).code).toBe(0);
  });

  test("leaves no render directory behind when the render fails", async () => {
    const context = {
      cwd: h.repo,
      env: { SELFIE_HOME: h.home },
      stdout: () => {},
      stderr: () => {},
      render: async () => {
        throw new Error("Docker is unavailable");
      },
    };
    const { runCli } = await import("../src/cli.ts");
    expect(await runCli(["review"], context)).toBe(2);
    expect(await readdir(path.join(await projectDirectory(), "render")).catch(() => [])).toEqual([]);
  });
});

describe("the build command", () => {
  test("runs first, in a shell, and a failure stops the review with exit 2", async () => {
    h.stories = [{ id: "a--one" }];
    const failed = await review("--build-command", "exit 3");
    expect(failed.code).toBe(2);
    expect(failed.json.error).toMatchObject({ code: "build-failed", message: expect.stringContaining("exit code 3") });

    const ok = await review("--build-command", `echo built > "${path.join(h.scratch, "marker")}"`);
    expect(ok.code).toBe(1);
    expect(await readFile(path.join(h.scratch, "marker"), "utf8")).toBe("built\n");
  });
});
