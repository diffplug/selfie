// Skipping the render of a build that already rendered, against real Git, a real store, real
// files, and only the browser replaced. `render/test/identity.test.ts` covers what makes two
// builds the same.
import { writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineEnvironment, renderIdentity } from "selfie-render";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openProject } from "../src/project.ts";
import { BLUE, commit, createHarness, git, type Harness } from "./support.ts";

let h: Harness;
let build: string;
let renders: number;

/** Runs a command on the build, and says whether it rendered. */
async function onBuild(command: "record" | "review", flags: string[]) {
  const before = renders;
  const result = await h.cli(command, "--storybook-dir", build, ...flags);
  return { ...result, rendered: renders > before };
}
const review = (...flags: string[]) => onBuild("review", flags);
const record = (...flags: string[]) => onBuild("record", flags);
let commits = 0;
/** A new commit the build doesn't hold, since a run is per commit. */
const newCommit = () => commit(h.repo, `elsewhere ${++commits}`);
const writeConfig = (config: unknown) => writeFile(path.join(h.repo, "selfie.config.json"), JSON.stringify(config));
const inBuild = (file: string) => path.join(build, file);
const reasons = (list: readonly any[]) => list.map(({ reason }) => reason);
const pruneRuns = async () => rm(path.join(h.home, (await readdir(h.home))[0]!, "runs"), { recursive: true });

beforeEach(async () => {
  h = await createHarness();
  build = path.join(h.scratch, "build");
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
  test("at this commit, shows the run that's already there and records nothing", async () => {
    const first = await review();
    expect(first.rendered).toBe(true);

    const second = await review();
    expect(second.rendered).toBe(false);
    expect(second.json.runId).toBe(first.json.runId);
    expect(second.json.reusedFromRun).toBeNull();
    expect(second.stderr).toContain(`Run ${first.json.runId} already describes this built Storybook`);
    expect(second.json.counts).toEqual(first.json.counts);
    expect(second.code).toBe(first.code);

    const project = await openProject({ cwd: h.repo, env: { SELFIE_HOME: h.home } });
    expect(await project.batches.runsAt(first.json.gitSha, first.json.environment)).toHaveLength(1);
    project.close();
  });

  test.each([
    ["the tree is now dirty", () => writeFile(path.join(h.repo, "untracked.txt"), "changed")],
    ["the baseline moved", null],
  ])("at this commit, records a new run if %s", async (_, change) => {
    const first = await review();
    if (change === null) {
      await h.cli("approve", first.json.runId, "--all");
      await h.cli("accept", first.json.runId);
    } else {
      await change();
    }
    const second = await review();
    expect(second.rendered).toBe(false);
    expect(second.json.runId).not.toBe(first.json.runId);
    expect(second.json.reusedFromRun).toBe(first.json.runId);
    // And now that one is what's already there.
    expect((await review()).json.runId).toBe(second.json.runId);
  });

  test("at a new commit, skips render, and records the same images in a new run", async () => {
    const first = await review();
    expect(first.json.reusedFromRun).toBeNull();

    await newCommit();
    const second = await review();
    expect(second.rendered).toBe(false);
    expect(second.json.reusedFromRun).toBe(first.json.runId);
    expect(second.json.runId).not.toBe(first.json.runId);
    expect(second.stderr).toContain(`Reused the images of run ${first.json.runId}`);
    expect(second.json.differences.map(({ imageHash }: any) => imageHash)).toEqual(
      first.json.differences.map(({ imageHash }: any) => imageHash),
    );
    expect(second.json.counts).toEqual(first.json.counts);
    expect(second.code).toBe(first.code);
  });

  test("always names the run that really rendered, not another reuse", async () => {
    const first = await review();
    await newCommit();
    await review();
    await newCommit();
    expect((await review()).json.reusedFromRun).toBe(first.json.runId);
  });

  test("still hits after every exported file is pruned", async () => {
    const first = await review();
    await pruneRuns();
    const again = await review();
    expect(again.rendered).toBe(false);
    expect(again.json.runId).toBe(first.json.runId);
    await stat(again.json.differences[0].current);
  });

  test("runs a build command first, and hits if it wrote the same bytes", async () => {
    await review("--build-command", `printf '.a{color:red}' > ${inBuild("assets/app.css")}`);
    expect((await review("--build-command", `printf '.a{color:red}' > ${inBuild("assets/app.css")}`)).rendered).toBe(false);
    expect((await review("--build-command", `printf '.a{color:tan}' > ${inBuild("assets/app.css")}`)).rendered).toBe(true);
  });
});

describe("a change to what decides pixels renders", () => {
  beforeEach(async () => {
    await review();
  });

  test("one byte of the build, and going back reuses the first render", async () => {
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
    expect(json.reusedFromRun).toBeNull();
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
    expect(next.json.runId).toBe(fixed.json.runId);
  });

  test("a failed run is never replayed, even if it's somehow remembered", async () => {
    h.stories = [{ id: "a--one", failed: "Timed out" }];
    const { json } = await review();
    const project = await openProject({ cwd: h.repo, env: { SELFIE_HOME: h.home } });
    const identity = await renderIdentity({ storybookDir: build, environment: defineEnvironment() });
    await project.renderKeys.remember(identity!, json.runId);
    project.close();

    h.stories = [{ id: "a--one" }];
    const next = await review();
    expect(next.rendered).toBe(true);
    expect(next.json.reusedFromRun).toBeNull();
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

  test("a build that changed while it rendered isn't remembered", async () => {
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

  test("a build holding a symlink always renders, and stderr says why", async () => {
    await symlink(path.join(h.scratch, "elsewhere.css"), inBuild("assets/link.css"));
    expect((await review()).stderr).toContain("won't be reused: a native environment, or a built Storybook holding a symlink");
    expect((await review()).rendered).toBe(true);
  });

  test("a native run always renders", async () => {
    expect((await review("--native")).rendered).toBe(true);
    const second = await review("--native");
    expect(second.rendered).toBe(true);
    expect(second.json.reusedFromRun).toBeNull();
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
    expect(second.json.reusedFromRun).toBe(first.json.runId);
    expect(second.json.playErrors).toEqual([
      { story: "a--one", playError: "expected a dialog", current: expect.any(String) },
    ]);
    await stat(second.json.playErrors[0].current);
    expect(reasons(second.json.advisories)).toEqual(["play-error"]);
  });
});

describe("a filter", () => {
  test("is answered from the build's whole run", async () => {
    const whole = await review();
    const filtered = await review("--story", "a--one");
    expect(filtered.rendered).toBe(false);
    expect(filtered.json.reusedFromRun).toBe(whole.json.runId);
    expect(filtered.json.counts.stories).toBe(1);
    expect(filtered.json.differences.map(({ story }: any) => story)).toEqual(["a--one"]);
    expect(filtered.json.filter).toEqual({ patterns: ["a--one"], notRendered: 0 });
  });

  test("reports what it left out and what it didn't match, as a render would", async () => {
    const reviewed = await review();
    await h.cli("approve", reviewed.json.runId, "--all");
    expect((await h.cli("accept", reviewed.json.runId)).code).toBe(0);

    const flags = ["--story", "a--one", "--story", "nope--*"];
    const reused = await review(...flags);
    const recorded = await record(...flags);
    const rendered = await h.cli("review", recorded.json.runId);
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

  test("a filtered render's failure leaves the whole run remembered", async () => {
    const whole = await review();
    h.stories = [{ id: "a--one", failed: "Not this time" }, { id: "a--two" }];
    await record("--story", "a--one");
    expect((await review()).json.runId).toBe(whole.json.runId);
  });
});

describe("selfie record", () => {
  test("always renders, and the render answers later reviews", async () => {
    await review();
    const forced = await record();
    expect(forced.rendered).toBe(true);
    expect((await record()).rendered).toBe(true);
    const last = await record();
    const next = await review();
    expect(next.rendered).toBe(false);
    expect(next.json.runId).toBe(last.json.runId);
  });

  test("the config has no key for it", async () => {
    await writeConfig({ reuse: false });
    const { code, json } = await review();
    expect(code).toBe(2);
    expect(json.error.code).toBe("bad-config");
  });
});

describe("a reused run is a real run", () => {
  test("through approve, accept, the exit codes, and the next review", async () => {
    const first = await review();
    expect(first.code).toBe(1);

    await newCommit();
    const reused = await review();
    expect(reused.code).toBe(1);
    expect(reasons(reused.json.blockers)).toEqual(["added-unapproved", "added-unapproved"]);
    expect((await h.cli("accept", reused.json.runId)).code).toBe(1);

    expect((await h.cli("approve", reused.json.runId, "--all")).code).toBe(0);
    const accepted = await h.cli("accept", reused.json.runId);
    expect(accepted.code).toBe(0);
    expect(accepted.json).toMatchObject({ accepted: true, runId: reused.json.runId, reusedFromRun: first.json.runId });
    expect(accepted.stderr).toContain(`This run's pixels came from the render of run ${first.json.runId}`);
    expect((await h.cli("find-baseline")).json.sha).toBe(reused.json.gitSha);

    const next = await review();
    expect(next.rendered).toBe(false);
    expect(next.code).toBe(0);
    expect(next.json.differences).toEqual([]);
    expect(next.json.counts).toMatchObject({ stories: 2, unchanged: 2, undecided: 0 });
  });

  test("accepting a run that rendered says so too", async () => {
    const first = await review();
    await h.cli("approve", first.json.runId, "--all");
    const accepted = await h.cli("accept", first.json.runId);
    expect(accepted.json.reusedFromRun).toBeNull();
    expect(accepted.stderr).not.toContain("pixels came from");
  });

  test("accept still knows after the run's directory is pruned", async () => {
    const first = await review();
    await newCommit();
    const reused = await review();
    await h.cli("approve", reused.json.runId, "--all");
    await pruneRuns();
    expect((await h.cli("accept", reused.json.runId)).json.reusedFromRun).toBe(first.json.runId);
  });

  test("records a new commit and its baseline, not the earlier run's", async () => {
    const first = await review();
    await h.cli("approve", first.json.runId, "--all");
    await h.cli("accept", first.json.runId);

    const sha = await commit(h.repo, "touches nothing the build holds");
    const reused = await review();
    expect(reused.rendered).toBe(false);
    expect(reused.json.gitSha).toBe(sha);
    expect(reused.json.gitSha).not.toBe(first.json.gitSha);
    expect(reused.json.baseline.sha).toBe(first.json.gitSha);
    expect(reused.json.dirtyPaths).toEqual([]);
    expect(reused.code).toBe(0);
    expect((await h.cli("accept", reused.json.runId)).json.gitSha).toBe(sha);
    expect((await h.cli("find-baseline")).json.sha).toBe(sha);
  });

  test("records a dirty tree, and accept refuses it, until a commit makes it clean", async () => {
    const first = await review();
    await h.cli("approve", first.json.runId, "--all");

    await writeFile(path.join(h.repo, "edit.txt"), "not committed\n");
    const dirty = await review();
    expect(dirty.rendered).toBe(false);
    expect(dirty.json.dirtyPaths).toEqual(["edit.txt"]);
    const refused = await h.cli("accept", dirty.json.runId);
    expect(refused.code).toBe(1);
    expect(reasons(refused.json.refusals)).toEqual(["recorded-on-dirty-tree"]);

    git(h.repo, "add", "edit.txt");
    git(h.repo, "commit", "--quiet", "-m", "commit it");
    const clean = await review();
    expect(clean.rendered).toBe(false);
    expect(clean.json.dirtyPaths).toEqual([]);
    expect(clean.json.gitSha).toBe(git(h.repo, "rev-parse", "HEAD"));
    expect((await h.cli("accept", clean.json.runId)).code).toBe(0);
  });

  test("a changed build renders, and reports its change", async () => {
    const first = await review();
    await h.cli("approve", first.json.runId, "--all");
    await h.cli("accept", first.json.runId);

    await writeFile(inBuild("assets/app.css"), ".a{color:tan}");
    h.stories = [{ id: "a--one", color: BLUE }, { id: "a--two", color: BLUE }];
    const changed = await review();
    expect(changed.rendered).toBe(true);
    expect(changed.json.reusedFromRun).toBeNull();
    expect(changed.code).toBe(1);
    expect(changed.json.differences.map(({ story, state }: any) => [story, state])).toEqual([["a--one", "changed"]]);
    expect(changed.json.differences[0].pixelDiff.changedPixels).toBeGreaterThan(0);
  });
});
