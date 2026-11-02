// The commands against real Git, a real store, and real files, with only the browser replaced.
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { decodeImage } from "selfie-store";
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
const reasons = (json: any) => json.needsAttention.map(({ reason }: any) => reason);
const review = (...flags: string[]) => h.cli("review", "--storybook-dir", "ignored", ...flags);

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
    expect(json.baselineSha).toBeNull();
    expect(json.baseline.reason).toBe("no-goldens");
    expect(json.gitSha).toBe(git(h.repo, "rev-parse", "HEAD"));
    expect(json.dirty).toBe(false);
    expect(json.status).toBe("complete");
    expect(json.counts).toMatchObject({ stories: 2, new: 2, changed: 0, unchanged: 0, undecided: 2, needsAttention: 2 });
    expect(reasons(json)).toEqual(["new-unapproved", "new-unapproved"]);
    for (const difference of json.differences) {
      expect(difference.state).toBe("new");
      expect(await exists(difference.current)).toBe(true);
      expect(difference.golden).toBeNull();
      expect(difference.diff).toBeNull();
      expect((await decodeImage(await readFile(difference.current))).width).toBe(8);
    }
    expect(stderr).toContain("Recorded run");
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
    expect(accepted.json).toMatchObject({ accepted: true, gitSha: first.json.gitSha, removed: [] });

    const second = await review();
    expect(second.code).toBe(0);
    expect(second.json.baselineSha).toBe(first.json.gitSha);
    expect(second.json.differences).toEqual([]);
    expect(second.json.counts).toMatchObject({ unchanged: 2, needsAttention: 0 });

    const found = await h.cli("find-baseline");
    expect(found.code).toBe(0);
    expect(found.json.baselineSha).toBe(first.json.gitSha);
  });

  test("says when stability wasn't checked, and not when it was", async () => {
    const { json } = await review();
    expect(json.stability.checked).toBe(false);
    expect(json.stability.note).toContain("--stability");
    expect(json.counts.unstable).toBeNull();

    h.stories = [{ id: "a--one", stability: "stable" }];
    const checked = await review("--stability");
    expect(checked.json.stability).toEqual({ checked: true, note: null });
    expect(checked.json.counts.unstable).toBe(0);
  });

  test("the human mode prints a summary instead of JSON", async () => {
    const { code, stdout } = await review("--human");
    expect(code).toBe(1);
    expect(stdout).toContain("2 stories: 0 unchanged, 0 changed, 2 new");
    expect(stdout).toContain("new-unapproved: a--one");
    expect(() => JSON.parse(stdout)).toThrow();
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
    expect(json.counts).toMatchObject({ changed: 1, unchanged: 2, needsAttention: 1 });
    expect(reasons(json)).toEqual(["changed-unapproved"]);

    const [difference] = json.differences;
    expect(difference.pixelDiff).toEqual({
      kind: "pixels",
      changedPixels: 8,
      totalPixels: 64,
      boundingBox: { x: 2, y: 3, width: 4, height: 2 },
      maxChannelDelta: 110,
    });
    expect((await decodeImage(await readFile(difference.current))).pixels[(3 * 8 + 2) * 3]).toBe(90);
    expect((await decodeImage(await readFile(difference.golden))).pixels[(3 * 8 + 2) * 3]).toBe(200);
    const diff = await decodeImage(await readFile(difference.diff));
    expect([...diff.pixels.subarray((3 * 8 + 2) * 3, (3 * 8 + 2) * 3 + 3)]).toEqual([255, 0, 80]);
    expect(diff.pixels[0]).toBe(diff.pixels[1]);

    expect(await readdir(path.join(json.outputDir, "stories"))).toHaveLength(1);
  });

  test("reports images of different sizes without a diff image", async () => {
    h.stories = [{ id: "a--one", width: 10, height: 4 }, { id: "a--two" }, { id: "b--three" }];
    const { code, json } = await review();
    expect(code).toBe(1);
    const [difference] = json.differences;
    expect(difference.pixelDiff).toEqual({
      kind: "size-differs",
      current: { width: 10, height: 4 },
      golden: { width: 8, height: 8 },
    });
    expect(difference.diff).toBeNull();
    expect(await exists(difference.current)).toBe(true);
    expect(await exists(difference.golden)).toBe(true);
    expect(reasons(json)).toEqual(["changed-unapproved"]);
  });

  test("shows removals, and requires the count to accept them", async () => {
    h.stories = [{ id: "a--one" }, { id: "a--two" }];
    await commit(h.repo, "second");
    const { code, json } = await review();
    expect(code).toBe(1);
    expect(reasons(json)).toEqual(["removed"]);
    expect(json.differences[0]).toMatchObject({ story: "b--three", state: "removed", current: null });
    expect(await exists(json.differences[0].golden)).toBe(true);
    expect(json.counts.removed).toBe(1);

    const unacknowledged = await h.cli("accept", json.runId);
    expect(unacknowledged.code).toBe(1);
    expect(unacknowledged.json.accepted).toBe(false);
    expect(unacknowledged.json.removed).toEqual(["b--three"]);
    expect(unacknowledged.json.refusals[0].reason).toBe("removed-unacknowledged");
    expect(unacknowledged.json.refusals[0].message).toContain("b--three");
    expect(unacknowledged.json.refusals[0].message).toContain("--removed 1");

    const wrong = await h.cli("accept", json.runId, "--removed", "2");
    expect(wrong.code).toBe(1);
    expect(wrong.json.refusals[0].reason).toBe("wrong-removed-count");

    const right = await h.cli("accept", json.runId, "--removed", "1");
    expect(right.code).toBe(0);
    expect(right.json.removed).toEqual(["b--three"]);
    expect((await review()).json.differences).toEqual([]);
  });

  test("a filter limits what's rendered, and doesn't call the rest removed", async () => {
    const { code, json } = await review("--story", "a--*");
    expect(code).toBe(0);
    expect(json.counts).toMatchObject({ stories: 2, removed: 0, needsAttention: 0 });
    expect(json.filter).toEqual({ patterns: ["a--*"], notRendered: 1 });
    expect(json.differences).toEqual([]);

    // Accepting it would still drop that golden, so that needs the acknowledgment.
    const refused = await h.cli("accept", json.runId);
    expect(refused.code).toBe(1);
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
    expect(none.json.error.message).toContain("nope--*");

    const some = await review("--story", "a--*", "--story", "nope--*");
    expect(some.code).toBe(1);
    expect(reasons(some.json)).toEqual(["pattern-unmatched"]);
  });

  test("baselines don't cross environments", async () => {
    await writeFile(path.join(h.repo, "other.json"), JSON.stringify({ environment: { viewport: { width: 640, height: 480 } } }));
    git(h.repo, "add", "other.json");
    git(h.repo, "commit", "--quiet", "-m", "config");
    const { json } = await h.cli("find-baseline", "--config", "other.json");
    expect(json.baselineSha).toBeNull();
    const reviewed = await review("--config", "other.json");
    expect(reviewed.json.baselineSha).toBeNull();
    expect(reviewed.json.counts.new).toBe(3);
    expect(reviewed.json.environment.definition.viewport).toEqual({ width: 640, height: 480 });
    // The default environment still finds them.
    expect((await h.cli("find-baseline")).json.baselineSha).not.toBeNull();
  });

  test("selfie.config.json at the top level applies without being named", async () => {
    await writeFile(path.join(h.repo, "selfie.config.json"), JSON.stringify({ environment: { scale: 2 } }));
    git(h.repo, "add", "selfie.config.json");
    git(h.repo, "commit", "--quiet", "-m", "config");
    const { json } = await review();
    expect(json.environment.definition.scale).toBe(2);
    expect(json.baselineSha).toBeNull();
  });

  test("a config's init script is read from beside it, and a flag wins", async () => {
    await writeFile(path.join(h.repo, "freeze.js"), "fromConfig();");
    await writeFile(path.join(h.scratch, "flag.js"), "fromFlag();");
    await writeFile(path.join(h.repo, "selfie.config.json"), JSON.stringify({ initScript: "freeze.js" }));
    expect((await review()).json.initScriptSha256).toBe("fromConfig();");
    expect((await review("--init-script", path.join(h.scratch, "flag.js"))).json.initScriptSha256).toBe("fromFlag();");
  });

  test("a config's init script can't be outside the config's directory", async () => {
    await writeFile(path.join(h.repo, "selfie.config.json"), JSON.stringify({ initScript: "../outside.js" }));
    const { code, json } = await review();
    expect(code).toBe(2);
    expect(json.error.message).toContain("must be inside");
  });

  test("a config with an unknown key is refused, so a typo doesn't pass silently", async () => {
    await writeFile(path.join(h.repo, "bad.json"), JSON.stringify({ buildCommand: "rm -rf /" }));
    const { code, json } = await review("--config", "bad.json");
    expect(code).toBe(2);
    expect(json.error.message).toContain('unknown key "buildCommand"');
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
    expect(refused.json.unapproved).toEqual([{ story: "b--three", state: "changed", decision: null }]);
    expect(refused.json.refusals[0].message).toContain("b--three");

    expect((await h.cli("approve", json.runId, "--story", "b--*")).code).toBe(0);
    expect((await h.cli("accept", json.runId)).code).toBe(0);
  });

  test("a rejection needs attention and blocks accepting until it's changed", async () => {
    const { json } = await review();
    const rejected = await h.cli("reject", json.runId, "--all", "--actor", "agent-7");
    expect(rejected.code).toBe(0);
    expect(rejected.json).toMatchObject({ decision: "rejected", actor: "agent-7" });

    const next = await review();
    expect(next.code).toBe(1);
    expect(reasons(next.json)).toEqual(["rejected", "rejected", "rejected"]);
    expect(next.json.differences[0].decision).toMatchObject({ decision: "rejected", actor: "agent-7" });
    expect(next.json.counts.rejected).toBe(3);

    const refused = await h.cli("accept", next.json.runId);
    expect(refused.code).toBe(1);
    expect(refused.json.unapproved[0]).toEqual({ story: "a--one", state: "changed", decision: "rejected" });

    await h.cli("approve", next.json.runId, "--all");
    expect((await h.cli("accept", next.json.runId)).code).toBe(0);
  });

  test("a decision holds for that image only", async () => {
    const { json } = await review();
    await h.cli("approve", json.runId, "--all");
    h.stories = [{ id: "a--one", color: GREEN }, { id: "a--two", color: BLUE }, { id: "b--three", color: GREEN }];
    const next = await review();
    expect(next.code).toBe(1);
    expect(next.json.needsAttention.map(({ story }: any) => story)).toEqual(["a--one"]);
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
    expect((await h.cli("approve", json.runId)).code).toBe(2);
    expect((await h.cli("approve", json.runId, "--all", "--story", "a*")).code).toBe(2);
  });

  test("refuses what isn't a run ID before it reaches a path, and reports an unknown one", async () => {
    const traversal = await h.cli("approve", "../../..", "--all");
    expect(traversal.code).toBe(2);
    expect(traversal.json.error.message).toContain("isn't a run ID");
    expect((await h.cli("accept", "../../..")).code).toBe(2);
    const unknown = await h.cli("accept", "00000000-0000-4000-8000-000000000000");
    expect(unknown.code).toBe(2);
    expect(unknown.json.error.message).toContain("No run");
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
    expect(dirty.json.dirty).toBe(true);
    expect(dirty.json.dirtyPaths).toEqual(["file.txt"]);
    expect((await h.cli("approve", dirty.json.runId, "--all")).code).toBe(0);

    const sha = await commit(h.repo, "edited");
    const after = await review();
    expect(after.code).toBe(0);
    expect(after.json.gitSha).toBe(sha);
    expect(after.json.dirty).toBe(false);
    expect(after.json.differences[0]).toMatchObject({ state: "changed" });
    expect(after.json.differences[0].decision.decision).toBe("approved");
    expect(after.json.counts).toMatchObject({ approved: 1, undecided: 0, needsAttention: 0 });

    expect((await h.cli("accept", after.json.runId)).code).toBe(0);
    const final = await review();
    expect(final.json.baselineSha).toBe(sha);
    expect(final.json.differences).toEqual([]);
  });

  test("accept refuses a dirty tree, and says what's dirty", async () => {
    await commit(h.repo, "second");
    const { json } = await review();
    await h.cli("approve", json.runId, "--all");
    await writeFile(path.join(h.repo, "untracked.txt"), "x");
    const refused = await h.cli("accept", json.runId);
    expect(refused.code).toBe(1);
    expect(refused.json.refusals[0].reason).toBe("dirty-tree");
    expect(refused.json.refusals[0].message).toContain("untracked.txt");
    expect(refused.stderr).toContain("Not accepted");
  });

  test("accept refuses a run recorded on a dirty tree, even once the tree is clean", async () => {
    await writeFile(path.join(h.repo, "file.txt"), "edited\n");
    const { json } = await review();
    await h.cli("approve", json.runId, "--all");
    git(h.repo, "checkout", "--", "file.txt");

    const refused = await h.cli("accept", json.runId);
    expect(refused.code).toBe(1);
    expect(refused.json.refusals.map(({ reason }: any) => reason)).toEqual(["recorded-on-dirty-tree"]);
    expect(refused.json.refusals[0].message).toContain("approvals carry over");
    expect((await h.cli("find-baseline")).json.baselineSha).not.toBeNull();
  });

  test("accept takes a run recorded clean at an earlier commit, for that commit", async () => {
    const earlier = await commit(h.repo, "second");
    const { json } = await review();
    await h.cli("approve", json.runId, "--all");
    await commit(h.repo, "third");
    const accepted = await h.cli("accept", json.runId);
    expect(accepted.code).toBe(0);
    expect(accepted.json.gitSha).toBe(earlier);
    expect((await h.cli("find-baseline")).json.baselineSha).toBe(earlier);
  });

  test("a HEAD that moves during the render fails the review", async () => {
    h.onCapture = () => {
      h.onCapture = undefined;
      git(h.repo, "commit", "--quiet", "--allow-empty", "-m", "moved");
    };
    const { code, json } = await review();
    expect(code).toBe(2);
    expect(json.error.message).toContain("HEAD moved");
  });
});

describe("stories needing attention", () => {
  test("a failed story is listed, exits 1, and blocks accepting", async () => {
    h.stories = [{ id: "a--one" }, { id: "a--two", failed: "boom" }];
    const { code, json } = await review();
    expect(code).toBe(1);
    expect(json.status).toBe("failed");
    expect(json.failures).toEqual([{ story: "a--two", failure: "render: boom", goldenHash: null }]);
    expect(reasons(json)).toContain("failed");
    expect(json.counts.failed).toBe(1);

    const approved = await h.cli("approve", json.runId, "--all");
    expect(approved.json.skipped[0]).toMatchObject({ story: "a--two", state: "failed" });
    const refused = await h.cli("accept", json.runId);
    expect(refused.code).toBe(1);
    expect(refused.json.refusals[0].reason).toBe("run-has-failures");
    expect(refused.json.refusals[0].message).toContain("a--two");
  });

  test("play errors and unstable stories need attention, but acceptRun's gate is the only one", async () => {
    h.stories = [
      { id: "a--play", errors: [{ source: "play", message: "the play failed" }, { source: "console", message: "noise" }] },
      { id: "a--wobbly", stability: "unstable", repeatColor: BLUE },
      { id: "a--fine", stability: "stable" },
    ];
    const { code, json } = await review("--stability");
    expect(code).toBe(1);
    expect(json.playErrors).toHaveLength(1);
    expect(json.playErrors[0].errors).toEqual([{ source: "play", message: "the play failed" }]);
    expect(await exists(json.playErrors[0].current)).toBe(true);
    expect(json.unstable[0].story).toBe("a--wobbly");
    expect(await exists(json.unstable[0].current)).toBe(true);
    expect(await exists(json.unstable[0].repeat)).toBe(true);
    expect(json.counts).toMatchObject({ playErrors: 1, unstable: 1 });
    expect(reasons(json)).toEqual(expect.arrayContaining(["play-error", "unstable"]));

    await h.cli("approve", json.runId, "--all");
    const accepted = await h.cli("accept", json.runId);
    expect(accepted.code).toBe(0);
    expect(accepted.json.playErrors[0].story).toBe("a--play");
    expect(accepted.json.unstable[0].story).toBe("a--wobbly");

    // Unchanged, and still needing attention.
    const next = await review("--stability");
    expect(next.code).toBe(1);
    expect(next.json.differences).toEqual([]);
    expect(next.json.playErrors[0].story).toBe("a--play");
    expect(next.json.unstable[0].story).toBe("a--wobbly");
  });

  test("a PNG the store refuses fails that story alone", async () => {
    const alpha = await encodePng(solid(4, 4, RED));
    alpha[25] = 0; // IHDR color type, so its checksum no longer matches
    h.stories = [{ id: "a--one" }, { id: "a--bad", rawPng: alpha }];
    const { code, json } = await review();
    expect(code).toBe(1);
    expect(json.failures[0].story).toBe("a--bad");
    expect(json.failures[0].failure).toContain("The store refused its image");
    expect(json.counts).toMatchObject({ stories: 2, new: 1, failed: 1 });
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
      const fileName = encodeURIComponent(id);
      // The stand-in writes under the same encoding as the renderer. A name too long for a file
      // can't come from the renderer either, since it would be a failed story there.
      if (fileName.length > 240) h.stories = [{ id: "plain", color: BLUE }, { id, failed: "too long" }];
      const { json } = await review();
      for (const { current, golden, diff } of json.differences) {
        for (const file of [current, golden, diff]) {
          if (file !== null) expect(isInside(json.outputDir, file)).toBe(true);
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

  test("a manifest path outside the capture fails that story, and nothing outside is read", async () => {
    const secret = path.join(h.scratch, "secret.png");
    await writeFile(secret, await encodePng(solid(2, 2, GREEN)));
    h.stories = [
      { id: "a--escape", fileOverride: path.relative(path.join(h.home, "x", "capture", "y"), secret) },
      { id: "a--absolute", fileOverride: secret },
      { id: "a--fine" },
    ];
    const { code, json } = await review();
    expect(code).toBe(1);
    expect(json.failures.map(({ story }: any) => story)).toEqual(["a--absolute", "a--escape"]);
    for (const { failure } of json.failures) expect(failure).toContain("The capture is unusable");
    expect(json.counts.new).toBe(1);
  });

  test("a symlink in place of an image fails that story", async () => {
    const secret = path.join(h.scratch, "secret.png");
    await writeFile(secret, await encodePng(solid(2, 2, GREEN)));
    h.stories = [{ id: "a--link", symlinkTo: secret }];
    const { json } = await review();
    expect(json.failures[0].failure).toContain("isn't a regular file");
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

  test("keeps the newest 20 run directories, and leaves no capture directory behind", async () => {
    h.stories = [{ id: "a--one" }];
    const first = await review();
    let last = first;
    for (let i = 0; i < 21; i++) last = await review();
    const projectDir = path.dirname(path.dirname(last.json.outputDir));
    const runs = await readdir(path.join(projectDir, "runs"));
    expect(runs).toHaveLength(20);
    expect(runs).toContain(last.json.runId);
    expect(runs).not.toContain(first.json.runId);
    expect(await readdir(path.join(projectDir, "capture"))).toEqual([]);

    // A pruned run can't be acted on, and says why, and the store still knows it.
    const old = await h.cli("accept", first.json.runId);
    expect(old.code).toBe(2);
    expect(old.json.error.message).toContain("no review record");
  });

  test("leaves no capture directory behind when the capture fails", async () => {
    const context = {
      cwd: h.repo,
      env: { SELFIE_HOME: h.home },
      stdout: () => {},
      stderr: () => {},
      capture: async () => {
        throw new Error("Docker is unavailable");
      },
    };
    const { runCli } = await import("../src/cli.ts");
    expect(await runCli(["review"], context)).toBe(2);
    const [project] = await readdir(h.home);
    expect(await readdir(path.join(h.home, project!, "capture")).catch(() => [])).toEqual([]);
  });
});

describe("the build command", () => {
  test("runs first, in a shell, and a failure stops the review with exit 2", async () => {
    h.stories = [{ id: "a--one" }];
    const failed = await review("--build-command", "exit 3");
    expect(failed.code).toBe(2);
    expect(failed.json.error.message).toContain("exit code 3");

    const ok = await review("--build-command", `echo built > "${path.join(h.scratch, "marker")}"`);
    expect(ok.code).toBe(1);
    expect(await readFile(path.join(h.scratch, "marker"), "utf8")).toBe("built\n");
  });
});
