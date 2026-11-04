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

/** Reviews and approves all, so `h.stories` are what a later batch compares with. */
async function approveAll(): Promise<void> {
  const { json } = await review();
  expect((await h.cli("approve", json.batchId, "--all")).code).toBe(0);
}

describe("a first review, with nothing approved", () => {
  beforeEach(() => {
    h.stories = [{ id: "a--one" }, { id: "a--two", color: BLUE }];
  });

  test("reports every story as new, with a current image, and exits 1", async () => {
    const { code, json, stderr } = await review();
    expect(code).toBe(1);
    expect(json.schemaVersion).toBe(1);
    expect(json.comparedWith).toEqual({ source: "approvals", sha: null, batch: null });
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
    expect(stderr).toContain("Recorded batch");
    expect(stderr).toMatch(/Timings: render \d+ ms, store \d+ ms, compare \d+ ms, diff \d+ ms, total \d+ ms/);
  });

  test("leaves out what the document no longer carries", async () => {
    const { json } = await review();
    for (const key of ["failures", "status", "storybookDir", "outputDir", "initScriptSha256", "timings", "baseline", "baselineSha", "needsAttention"]) {
      expect(json).not.toHaveProperty(key);
    }
  });

  test("approve --all leaves a later batch nothing to report", async () => {
    const first = await review();
    const approved = await h.cli("approve", first.json.batchId, "--all");
    expect(approved.code).toBe(0);
    expect(approved.json.actor).toBe("tester@example.com");
    expect(approved.json.decided.map(({ story }: any) => story)).toEqual(["a--one", "a--two"]);
    expect(approved.json.undecided).toEqual([]);

    const second = await review();
    expect(second.code).toBe(0);
    expect(second.json.differences).toEqual([]);
    expect(second.json.counts).toMatchObject({ stories: 2, unchanged: 2, undecided: 0 });
    expect(second.json.blockers).toEqual([]);
    expect(second.json.next).toEqual([]);
  });

  test("the next step is to look, and approve or reject", async () => {
    const { json } = await review();
    expect(json.next.join(" ")).toContain(`selfie approve ${json.batchId}`);
    expect(json.next.join(" ")).toContain("selfie reject");
  });
});

describe("comparing with what's approved", () => {
  beforeEach(async () => {
    h.stories = [{ id: "a--one" }, { id: "a--two" }, { id: "b--three" }];
    await approveAll();
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

  test("shows removals, and they block until approved", async () => {
    h.stories = [{ id: "a--one" }, { id: "a--two" }];
    await commit(h.repo, "second");
    const { code, json } = await review();
    expect(code).toBe(1);
    expect(reasons(json.blockers)).toEqual(["removed"]);
    expect(json.differences[0]).toMatchObject({ story: "b--three", state: "removed", current: null });
    expect(await exists(json.differences[0].golden)).toBe(true);
    expect(json.counts.removed).toBe(1);

    const approved = await h.cli("approve", json.batchId, "--all");
    expect(approved.json.decided).toEqual([{ story: "b--three", state: "removed", imageHash: null }]);
    expect((await h.cli("review", json.batchId)).code).toBe(0);
    expect((await review()).json.differences).toEqual([]);
  });

  test("a filter limits what's rendered, and doesn't call the rest removed", async () => {
    const { code, json } = await review("--story", "a--*");
    expect(code).toBe(0);
    expect(json.counts).toMatchObject({ stories: 2, removed: 0 });
    expect(json.filter).toEqual({ patterns: ["a--*"], notRendered: 1 });
    expect(json.differences).toEqual([]);
    expect(json.blockers).toEqual([]);
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

  test("approvals don't cross environments", async () => {
    await writeConfig({ environment: { viewport: { width: 640, height: 480 } } });
    const elsewhere = await review();
    expect(elsewhere.json.counts).toMatchObject({ added: 3, unchanged: 0 });

    await rm(path.join(h.repo, "selfie.config.json"));
    expect((await review()).json.counts).toMatchObject({ added: 0, unchanged: 3 });
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
    await approveAll();
    h.stories = [{ id: "a--one", color: BLUE }, { id: "a--two", color: BLUE }, { id: "b--three", color: GREEN }];
  });

  test("a pattern decides only what it matches", async () => {
    const { json } = await review();
    const approved = await h.cli("approve", json.batchId, "--story", "a--*");
    expect(approved.code).toBe(0);
    expect(approved.json.decided.map(({ story }: any) => story)).toEqual(["a--one", "a--two"]);
    expect(approved.json.undecided).toEqual([{ story: "b--three", state: "changed" }]);

    const partway = await h.cli("review", json.batchId);
    expect(partway.code).toBe(1);
    expect(partway.json.blockers).toEqual([{ story: "b--three", reason: "changed-unapproved", detail: null }]);

    expect((await h.cli("approve", json.batchId, "--story", "b--*")).code).toBe(0);
    expect((await h.cli("review", json.batchId)).code).toBe(0);
  });

  test("a rejection blocks, until an approval replaces it", async () => {
    const { json } = await review();
    const rejected = await h.cli("reject", json.batchId, "--all", "--actor", "agent-7");
    expect(rejected.code).toBe(0);
    expect(rejected.json).toMatchObject({ decision: "rejected", actor: "agent-7" });

    const next = await review();
    expect(next.code).toBe(1);
    expect(next.json.blockers[0]).toEqual({ story: "a--one", reason: "rejected", detail: "agent-7" });
    expect(next.json.differences[0].decision).toMatchObject({ decision: "rejected", actor: "agent-7" });
    expect(next.json.counts.undecided).toBe(0);

    await h.cli("approve", next.json.batchId, "--all");
    expect((await h.cli("review", next.json.batchId)).code).toBe(0);
  });

  test("a decision holds for that image only", async () => {
    const { json } = await review();
    await h.cli("approve", json.batchId, "--all");
    h.stories = [{ id: "a--one", color: GREEN }, { id: "a--two", color: BLUE }, { id: "b--three", color: GREEN }];
    const next = await review();
    expect(next.code).toBe(1);
    expect(next.json.blockers.map(({ story }: any) => story)).toEqual(["a--one"]);
  });

  test("a typo in a pattern exits 1, and decides nothing", async () => {
    const { json } = await review();
    const typo = await h.cli("approve", json.batchId, "--story", "c--*");
    expect(typo.code).toBe(1);
    expect(typo.json.unmatchedPatterns).toEqual(["c--*"]);
    expect(typo.json.decided).toEqual([]);
  });

  test("needs --all or a pattern, and refuses both", async () => {
    const { json } = await review();
    expect((await h.cli("approve", json.batchId)).json.error.code).toBe("usage");
    expect((await h.cli("approve", json.batchId, "--all", "--story", "a*")).code).toBe(2);
  });

  test("refuses what isn't a batch ID before it reaches a path, and reports an unknown one", async () => {
    const traversal = await h.cli("approve", "../../..", "--all");
    expect(traversal.code).toBe(2);
    expect(traversal.json.error.code).toBe("bad-batch-id");
    const unknown = await h.cli("approve", "00000000-0000-4000-8000-000000000000", "--all");
    expect(unknown.code).toBe(2);
    expect(unknown.json.error.code).toBe("unknown-batch");
  });
});

describe("dirty trees", () => {
  beforeEach(async () => {
    h.stories = [{ id: "a--one" }];
    await approveAll();
    h.stories = [{ id: "a--one", color: BLUE }];
  });

  test("an approval made on a dirty tree holds after the commit", async () => {
    await writeFile(path.join(h.repo, "file.txt"), "edited\n");
    const dirty = await review();
    expect(dirty.code).toBe(1);
    expect(dirty.json.dirtyPaths).toEqual(["file.txt"]);
    expect((await h.cli("approve", dirty.json.batchId, "--all")).code).toBe(0);

    const sha = await commit(h.repo, "edited");
    const after = await review();
    expect(after.code).toBe(0);
    expect(after.json.gitSha).toBe(sha);
    expect(after.json.dirtyPaths).toEqual([]);
    expect(after.json.differences).toEqual([]);
    expect(after.json.counts).toMatchObject({ unchanged: 1, undecided: 0 });
    expect(after.json.blockers).toEqual([]);
  });

  test("approving a batch at an earlier commit counts at the commits since", async () => {
    await commit(h.repo, "second");
    const { json } = await review();
    await commit(h.repo, "third");
    await h.cli("approve", json.batchId, "--all");
    const after = await review();
    expect(after.code).toBe(0);
    expect(after.json.gitSha).not.toBe(json.gitSha);
    expect(after.json.differences).toEqual([]);
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
  test("a failed story blocks, and approving everything skips it", async () => {
    h.stories = [{ id: "a--one" }, { id: "a--two", failed: "boom" }];
    const { code, json } = await review();
    expect(code).toBe(1);
    expect(json.blockers).toContainEqual({ story: "a--two", reason: "failed", detail: "render: boom" });

    const approved = await h.cli("approve", json.batchId, "--all");
    expect(approved.json.skipped).toEqual([{ story: "a--two", state: "failed" }]);
    const after = await h.cli("review", json.batchId);
    expect(after.code).toBe(1);
    expect(after.json.blockers).toEqual([{ story: "a--two", reason: "failed", detail: "render: boom" }]);
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

    await h.cli("approve", first.json.batchId, "--all");

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

describe("a batch pruned from disk", () => {
  test("can still be reviewed and decided on, since its facts are in the store", async () => {
    h.stories = [{ id: "a--one" }, { id: "a--two" }];
    await approveAll();
    h.stories = [{ id: "a--one", color: BLUE }];
    await commit(h.repo, "second");
    const { json } = await review();
    const [difference] = json.differences;
    const batchDir = path.join(await projectDirectory(), "batches", json.batchId);
    expect(await exists(path.join(batchDir, "review.json"))).toBe(true);
    await rm(batchDir, { recursive: true });

    const blocked = await h.cli("review", json.batchId);
    expect(blocked.code).toBe(1);
    expect(reasons(blocked.json.blockers)).toEqual(["changed-unapproved", "removed"]);
    await rm(batchDir, { recursive: true });

    const approved = await h.cli("approve", json.batchId, "--all");
    expect(approved.code).toBe(0);
    expect(approved.json.decided[0].imageHash).toBe(difference.imageHash);
    expect((await h.cli("review", json.batchId)).code).toBe(0);
  });

  test("still knows it was recorded dirty, with no file to say so", async () => {
    h.stories = [{ id: "a--one" }];
    await writeFile(path.join(h.repo, "file.txt"), "edited\n");
    const { json } = await review();
    git(h.repo, "checkout", "--", "file.txt");
    await rm(path.join(await projectDirectory(), "batches", json.batchId), { recursive: true });
    expect((await h.cli("review", json.batchId)).json.dirty).toBe(true);
  });

  test("still knows its filter", async () => {
    h.stories = [{ id: "a--one" }, { id: "b--two" }];
    await approveAll();
    const { json } = await review("--story", "a--*");
    await rm(path.join(await projectDirectory(), "batches", json.batchId), { recursive: true });
    const again = await h.cli("review", json.batchId);
    expect(again.code).toBe(0);
    expect(again.json.filter).toEqual({ patterns: ["a--*"], notRendered: 1 });
    expect(again.json.differences).toEqual([]);
  });
});

describe("untrusted names", () => {
  const isInside = (root: string, file: string) => path.resolve(file).startsWith(`${path.resolve(root)}${path.sep}`);

  test.each(["../../../../escape", "..", "a/b/../../c", "x\\y", ".hidden", `${"z".repeat(400)}--long`, "%2e%2e%2fup", "Same", "same"])(
    "story ID %j lands inside the batch's directory",
    async (id) => {
      h.stories = [{ id: "plain", color: BLUE }];
      const baselineStories = [{ id, color: RED }];
      await approveAll();
      h.stories = [...h.stories, ...baselineStories];
      // The stand-in writes under the same encoding as the renderer. A name too long for a file
      // can't come from the renderer either, since it would be a failed story there.
      if (encodeURIComponent(id).length > 240) h.stories = [{ id: "plain", color: BLUE }, { id, failed: "too long" }];
      const { json } = await review();
      const batchesRoot = path.join(await projectDirectory(), "batches", json.batchId);
      for (const { current, golden, diff } of json.differences) {
        for (const file of [current, golden, diff]) {
          if (file !== null) expect(isInside(batchesRoot, file)).toBe(true);
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

  test("keeps the newest 20 batch directories, and leaves no render directory behind", async () => {
    h.stories = [{ id: "a--one" }];
    const first = await review();
    let last = first;
    for (let i = 0; i < 21; i++) last = await review();
    const projectDir = await projectDirectory();
    const batches = await readdir(path.join(projectDir, "batches"));
    expect(batches).toHaveLength(20);
    expect(batches).toContain(last.json.batchId);
    expect(batches).not.toContain(first.json.batchId);
    expect(await readdir(path.join(projectDir, "render"))).toEqual([]);

    // The oldest was pruned, and can still be acted on.
    expect((await h.cli("approve", first.json.batchId, "--all")).code).toBe(0);
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
