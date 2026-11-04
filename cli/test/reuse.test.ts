// Skipping the render of a built Storybook that already rendered, against real Git, a real store, real
// files, and only the browser replaced. `render/test/identity.test.ts` covers what makes two
// builds the same.
import { writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineEnvironment, renderIdentity } from "selfie-render";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openProject } from "../src/project.ts";
import { BLUE, commit, createHarness, git, type Harness, TEST_CONFIG, writeTestConfig } from "./support.ts";

let h: Harness;
let build: string;
let renders: number;

/** Runs a command on the built Storybook, and says whether it rendered. */
async function onBuild(command: "render" | "review", flags: string[]) {
  const before = renders;
  const result = await h.cli(command, ...flags);
  return { ...result, rendered: renders > before };
}
const review = (...flags: string[]) => onBuild("review", flags);
const record = (...flags: string[]) => onBuild("render", flags);
let commits = 0;
/** A new commit the built Storybook doesn't hold, since a batch is per commit. */
const newCommit = () => commit(h.repo, `elsewhere ${++commits}`);
const writeConfig = (config: object) => writeTestConfig(h.repo, config);
const inBuild = (file: string) => path.join(build, file);
const reasons = (list: readonly any[]) => list.map(({ reason }) => reason);
const pruneBatches = async () => rm(path.join(h.home, (await readdir(h.home))[0]!, "batches"), { recursive: true });

beforeEach(async () => {
  h = await createHarness();
  build = path.join(h.repo, TEST_CONFIG.storybookDir);
  await mkdir(path.join(build, "assets"), { recursive: true });
  await writeFile(inBuild("iframe.html"), "<html></html>");
  await writeFile(inBuild("index.json"), '{"entries":{}}');
  await writeFile(inBuild("assets/app.css"), ".a{color:red}");
  h.stories = [{ id: "a--one" }, { id: "a--two", color: BLUE }];
  renders = 0;
  h.onRender = () => {
    renders += 1;
  };
});
afterEach(async () => {
  await h.destroy();
});

describe("an unchanged build", () => {
  test("at this commit, shows the batch that's already there and records nothing", async () => {
    const first = await review();
    expect(first.rendered).toBe(true);

    const second = await review();
    expect(second.rendered).toBe(false);
    expect(second.json.batchId).toBe(first.json.batchId);
    expect(second.json.reusedFromBatch).toBeNull();
    expect(second.stderr).toContain(`Batch ${first.json.batchId} already describes this built Storybook`);
    expect(second.json.counts).toEqual(first.json.counts);
    expect(second.code).toBe(first.code);

    const project = await openProject({ cwd: h.repo, env: { SELFIE_HOME: h.home } });
    expect(await project.batches.batchesAt(first.json.gitSha, first.json.environment)).toHaveLength(1);
    project.close();
  });

  test.each([
    ["the tree is now dirty", () => writeFile(path.join(h.repo, "untracked.txt"), "changed")],
    ["the baseline moved", null],
  ])("at this commit, records a new batch if %s", async (_, change) => {
    const first = await review();
    if (change === null) {
      await h.cli("approve", first.json.batchId, "--all");
      await h.cli("accept", first.json.batchId);
    } else {
      await change();
    }
    const second = await review();
    expect(second.rendered).toBe(false);
    expect(second.json.batchId).not.toBe(first.json.batchId);
    expect(second.json.reusedFromBatch).toBe(first.json.batchId);
    // And now that one is what's already there.
    expect((await review()).json.batchId).toBe(second.json.batchId);
  });

  test("at a new commit, skips render, and records the same images in a new batch", async () => {
    const first = await review();
    expect(first.json.reusedFromBatch).toBeNull();

    await newCommit();
    const second = await review();
    expect(second.rendered).toBe(false);
    expect(second.json.reusedFromBatch).toBe(first.json.batchId);
    expect(second.json.batchId).not.toBe(first.json.batchId);
    expect(second.stderr).toContain(`Reused the images of batch ${first.json.batchId}`);
    expect(second.json.differences.map(({ imageHash }: any) => imageHash)).toEqual(
      first.json.differences.map(({ imageHash }: any) => imageHash),
    );
    expect(second.json.counts).toEqual(first.json.counts);
    expect(second.code).toBe(first.code);
  });

  test("always names the batch that really rendered, not another reuse", async () => {
    const first = await review();
    await newCommit();
    await review();
    await newCommit();
    expect((await review()).json.reusedFromBatch).toBe(first.json.batchId);
  });

  test("still hits after every exported file is pruned", async () => {
    const first = await review();
    await pruneBatches();
    const again = await review();
    expect(again.rendered).toBe(false);
    expect(again.json.batchId).toBe(first.json.batchId);
    await stat(again.json.differences[0].current);
  });

  test("runs a build command first, and hits if it wrote the same bytes", async () => {
    const buildWriting = async (css: string) => {
      await writeConfig({ buildCommand: `printf '${css}' > ${inBuild("assets/app.css")}` });
      return review("--build");
    };
    await buildWriting(".a{color:red}");
    expect((await buildWriting(".a{color:red}")).rendered).toBe(false);
    expect((await buildWriting(".a{color:tan}")).rendered).toBe(true);
  });
});

describe("a change to what decides pixels renders", () => {
  beforeEach(async () => {
    await review();
  });

  test("one byte of the built Storybook, and going back reuses the first render", async () => {
    const before = await readFile(inBuild("assets/app.css"));
    await writeFile(inBuild("assets/app.css"), ".a{color:ted}");
    expect((await review()).rendered).toBe(true);
    expect((await review()).rendered).toBe(false);
    await writeFile(inBuild("assets/app.css"), before);
    expect((await review()).rendered).toBe(false);
  });

  test("the init script, by its contents", async () => {
    await writeFile(path.join(h.repo, "freeze.js"), "window.a = 1;");
    await writeConfig({ initScript: "freeze.js" });
    expect((await review()).rendered).toBe(true);
    expect((await review()).rendered).toBe(false);
    await writeFile(path.join(h.repo, "freeze.js"), "window.a = 2;");
    expect((await review()).rendered).toBe(true);
  });

  test("the environment", async () => {
    await writeConfig({ environment: { viewport: { width: 800, height: 600 } } });
    const { rendered, json } = await review();
    expect(rendered).toBe(true);
    expect(json.reusedFromBatch).toBeNull();
  });
});

describe("a render that isn't reusable", () => {
  test("a failed story is never reused, however often it fails", async () => {
    h.stories = [{ id: "a--one" }, { id: "a--two", failed: "Timed out" }];
    const first = await review();
    expect(first.rendered).toBe(true);
    expect(first.stderr).toContain("won't be reused: a story failed");
    expect((await review()).rendered).toBe(true);

    h.stories = [{ id: "a--one" }, { id: "a--two" }];
    const fixed = await review();
    expect(fixed.rendered).toBe(true);
    expect(reasons(fixed.json.blockers)).not.toContain("failed");
    const next = await review();
    expect(next.rendered).toBe(false);
    expect(next.json.batchId).toBe(fixed.json.batchId);
  });

  test("a failed batch is never replayed, even if it's somehow remembered", async () => {
    h.stories = [{ id: "a--one", failed: "Timed out" }];
    const { json } = await review();
    const project = await openProject({ cwd: h.repo, env: { SELFIE_HOME: h.home } });
    const identity = await renderIdentity({ storybookDir: build, environment: defineEnvironment() });
    await project.renderKeys.remember(identity!, json.batchId);
    project.close();

    h.stories = [{ id: "a--one" }];
    const next = await review();
    expect(next.rendered).toBe(true);
    expect(next.json.reusedFromBatch).toBeNull();
  });

  test("an image the store refused is a failure too", async () => {
    h.stories = [{ id: "a--one", rawPng: new TextEncoder().encode("not a png") }];
    expect((await review()).rendered).toBe(true);
    expect((await review()).rendered).toBe(true);
  });

  test.each(["request", "timeout", "worker"] as const)("%s errors on an ok story, and stderr says which", async (source) => {
    h.stories = [{ id: "a--one", errors: [{ source, message: "it happened\nand more" }] }];
    const { stderr } = await review();
    expect(stderr).toContain(`won't be reused: a--one had a ${source} error, which might not recur: it happened.`);
    expect((await review()).rendered).toBe(true);
  });

  test("a render warning, and stderr says what it was", async () => {
    h.stories = [{ id: "a--one", warning: "The worker stopped early: it crashed" }];
    const { stderr } = await review();
    expect(stderr).toContain("won't be reused: the render warned: The worker stopped early: it crashed.");
    expect((await review()).rendered).toBe(true);
  });

  test("a later render's failure forgets the earlier good one", async () => {
    await review();
    h.stories = [{ id: "a--one", failed: "It really does fail" }];
    expect((await record()).rendered).toBe(true);
    expect((await review()).rendered).toBe(true);
  });

  test("a built Storybook that changed while it rendered isn't remembered", async () => {
    h.onRender = () => {
      renders += 1;
      writeFileSync(inBuild("assets/during.txt"), "written during the render");
    };
    const first = await review();
    expect(first.stderr).toContain("the built Storybook changed while it rendered");
    // The build as it now stands has no render that saw all of it from the start.
    h.onRender = () => {
      renders += 1;
    };
    expect((await review()).rendered).toBe(true);
    await rm(inBuild("assets/during.txt"));
    expect((await review()).rendered).toBe(true);
  });

  test("a built Storybook holding a symlink always renders, and stderr says why", async () => {
    await symlink(path.join(h.scratch, "elsewhere.css"), inBuild("assets/link.css"));
    expect((await review()).stderr).toContain("won't be reused: a native environment, or a built Storybook holding a symlink");
    expect((await review()).rendered).toBe(true);
  });

  test("a native batch always renders", async () => {
    expect((await review("--native")).rendered).toBe(true);
    const second = await review("--native");
    expect(second.rendered).toBe(true);
    expect(second.json.reusedFromBatch).toBeNull();
    expect(second.json.environment).toMatch(/^native-/);
  });
});

describe("play errors", () => {
  test("are project facts, so they're reused and still listed", async () => {
    h.stories = [
      {
        id: "a--one",
        errors: [
          { source: "play", message: "expected a dialog" },
          { source: "console", message: "expected a dialog" },
          { source: "page", message: "uncaught" },
        ],
      },
    ];
    const first = await review();
    await newCommit();
    const second = await review();
    expect(second.json.reusedFromBatch).toBe(first.json.batchId);
    expect(second.json.playErrors).toEqual([
      { story: "a--one", playError: "expected a dialog", current: expect.any(String) },
    ]);
    await stat(second.json.playErrors[0].current);
    expect(reasons(second.json.advisories)).toEqual(["play-error"]);
  });
});

describe("a filter", () => {
  test("is answered from the built Storybook's whole batch", async () => {
    const whole = await review();
    const filtered = await review("--story", "a--one");
    expect(filtered.rendered).toBe(false);
    expect(filtered.json.reusedFromBatch).toBe(whole.json.batchId);
    expect(filtered.json.counts.stories).toBe(1);
    expect(filtered.json.differences.map(({ story }: any) => story)).toEqual(["a--one"]);
    expect(filtered.json.filter).toEqual({ patterns: ["a--one"], notRendered: 0 });
  });

  test("reports what it left out and what it didn't match, as a render would", async () => {
    const reviewed = await review();
    await h.cli("approve", reviewed.json.batchId, "--all");
    expect((await h.cli("accept", reviewed.json.batchId)).code).toBe(0);

    const flags = ["--story", "a--one", "--story", "nope--*"];
    const reused = await review(...flags);
    const recorded = await record(...flags);
    const rendered = await h.cli("review", recorded.json.batchId);
    expect(reused.rendered).toBe(false);
    expect(recorded.rendered).toBe(true);
    expect(reused.json.filter).toEqual(rendered.json.filter);
    expect(reused.json.filter.notRendered).toBe(1);
    expect(reused.json.warnings).toEqual(rendered.json.warnings);
    expect(reused.json.warnings).toEqual(['Story pattern "nope--*" matched nothing.']);
    expect(reused.json.blockers).toEqual(rendered.json.blockers);
    expect(reused.code).toBe(rendered.code);
    expect(reused.code).toBe(1);
  });

  test("matching nothing can't run, as with a render", async () => {
    await review();
    const { code, json, rendered } = await review("--story", "nope--*");
    expect(rendered).toBe(false);
    expect(code).toBe(2);
    expect(json.error.code).toBe("no-stories");
  });

  test("a filtered render is never remembered, for itself or a wider request", async () => {
    await review("--story", "a--one");
    expect((await review("--story", "a--one")).rendered).toBe(true);
    const wider = await review();
    expect(wider.rendered).toBe(true);
    expect(wider.json.counts.stories).toBe(2);
  });

  test("a filtered render's failure leaves the whole batch remembered", async () => {
    const whole = await review();
    h.stories = [{ id: "a--one", failed: "Not this time" }, { id: "a--two" }];
    await record("--story", "a--one");
    expect((await review()).json.batchId).toBe(whole.json.batchId);
  });
});

describe("selfie render", () => {
  test("always renders, and the render answers later reviews", async () => {
    await review();
    const forced = await record();
    expect(forced.rendered).toBe(true);
    expect((await record()).rendered).toBe(true);
    const last = await record();
    const next = await review();
    expect(next.rendered).toBe(false);
    expect(next.json.batchId).toBe(last.json.batchId);
  });

  test("the config has no key for it", async () => {
    await writeConfig({ reuse: false });
    const { code, json } = await review();
    expect(code).toBe(2);
    expect(json.error.code).toBe("bad-config");
  });
});

describe("a reused batch is a real batch", () => {
  test("through approve, accept, the exit codes, and the next review", async () => {
    const first = await review();
    expect(first.code).toBe(1);

    await newCommit();
    const reused = await review();
    expect(reused.code).toBe(1);
    expect(reasons(reused.json.blockers)).toEqual(["added-unapproved", "added-unapproved"]);
    expect((await h.cli("accept", reused.json.batchId)).code).toBe(1);

    expect((await h.cli("approve", reused.json.batchId, "--all")).code).toBe(0);
    const accepted = await h.cli("accept", reused.json.batchId);
    expect(accepted.code).toBe(0);
    expect(accepted.json).toMatchObject({ accepted: true, batchId: reused.json.batchId, reusedFromBatch: first.json.batchId });
    expect(accepted.stderr).toContain(`This batch's pixels came from the render of batch ${first.json.batchId}`);
    expect((await h.cli("find-baseline")).json.sha).toBe(reused.json.gitSha);

    const next = await review();
    expect(next.rendered).toBe(false);
    expect(next.code).toBe(0);
    expect(next.json.differences).toEqual([]);
    expect(next.json.counts).toMatchObject({ stories: 2, unchanged: 2, undecided: 0 });
  });

  test("accepting a batch that rendered says so too", async () => {
    const first = await review();
    await h.cli("approve", first.json.batchId, "--all");
    const accepted = await h.cli("accept", first.json.batchId);
    expect(accepted.json.reusedFromBatch).toBeNull();
    expect(accepted.stderr).not.toContain("pixels came from");
  });

  test("accept still knows after the batch's directory is pruned", async () => {
    const first = await review();
    await newCommit();
    const reused = await review();
    await h.cli("approve", reused.json.batchId, "--all");
    await pruneBatches();
    expect((await h.cli("accept", reused.json.batchId)).json.reusedFromBatch).toBe(first.json.batchId);
  });

  test("records a new commit and its baseline, not the earlier batch's", async () => {
    const first = await review();
    await h.cli("approve", first.json.batchId, "--all");
    await h.cli("accept", first.json.batchId);

    const sha = await commit(h.repo, "touches nothing the built Storybook holds");
    const reused = await review();
    expect(reused.rendered).toBe(false);
    expect(reused.json.gitSha).toBe(sha);
    expect(reused.json.gitSha).not.toBe(first.json.gitSha);
    expect(reused.json.baseline.sha).toBe(first.json.gitSha);
    expect(reused.json.dirtyPaths).toEqual([]);
    expect(reused.code).toBe(0);
    expect((await h.cli("accept", reused.json.batchId)).json.gitSha).toBe(sha);
    expect((await h.cli("find-baseline")).json.sha).toBe(sha);
  });

  test("records a dirty tree, and accept refuses it, until a commit makes it clean", async () => {
    const first = await review();
    await h.cli("approve", first.json.batchId, "--all");

    await writeFile(path.join(h.repo, "edit.txt"), "not committed\n");
    const dirty = await review();
    expect(dirty.rendered).toBe(false);
    expect(dirty.json.dirtyPaths).toEqual(["edit.txt"]);
    const refused = await h.cli("accept", dirty.json.batchId);
    expect(refused.code).toBe(1);
    expect(reasons(refused.json.refusals)).toEqual(["recorded-on-dirty-tree"]);

    git(h.repo, "add", "edit.txt");
    git(h.repo, "commit", "--quiet", "-m", "commit it");
    const clean = await review();
    expect(clean.rendered).toBe(false);
    expect(clean.json.dirtyPaths).toEqual([]);
    expect(clean.json.gitSha).toBe(git(h.repo, "rev-parse", "HEAD"));
    expect((await h.cli("accept", clean.json.batchId)).code).toBe(0);
  });

  test("a changed build renders, and reports its change", async () => {
    const first = await review();
    await h.cli("approve", first.json.batchId, "--all");
    await h.cli("accept", first.json.batchId);

    await writeFile(inBuild("assets/app.css"), ".a{color:tan}");
    h.stories = [{ id: "a--one", color: BLUE }, { id: "a--two", color: BLUE }];
    const changed = await review();
    expect(changed.rendered).toBe(true);
    expect(changed.json.reusedFromBatch).toBeNull();
    expect(changed.code).toBe(1);
    expect(changed.json.differences.map(({ story, state }: any) => [story, state])).toEqual([["a--one", "changed"]]);
    expect(changed.json.differences[0].pixelDiff.changedPixels).toBeGreaterThan(0);
  });
});
