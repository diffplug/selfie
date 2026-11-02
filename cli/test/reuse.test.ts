// Skipping the render of a build that already rendered, against real Git, a real store, real
// files, and only the browser replaced.
import { writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, symlink, unlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Manifest } from "selfie-render";
import type { Run } from "selfie-store";
import { bytesToHash, renderKey, whyNotReusable, type KeyInputs } from "../src/reuse.ts";
import { BLUE, commit, createHarness, git, type Harness } from "./support.ts";

let h: Harness;
let build: string;
let captures: number;

/** Reviews, and says whether it rendered. */
async function review(...flags: string[]) {
  const before = captures;
  const result = await h.cli("review", "--storybook-dir", build, ...flags);
  return { ...result, rendered: captures > before };
}
const writeConfig = (config: unknown) => writeFile(path.join(h.repo, "selfie.config.json"), JSON.stringify(config));
const inBuild = (file: string) => path.join(build, file);
const reasons = (list: readonly any[]) => list.map(({ reason }) => reason);

const GENERATED = (at: number) => `{"generatedAt":${at},"userSince":1,"storybookVersion":"10.6.5"}`;

beforeEach(async () => {
  h = await createHarness();
  build = path.join(h.scratch, "build");
  await mkdir(path.join(build, "assets", "deep"), { recursive: true });
  await mkdir(path.join(build, "manifests"));
  await writeFile(inBuild("iframe.html"), "<html></html>");
  await writeFile(inBuild("index.json"), '{"entries":{}}');
  await writeFile(inBuild("project.json"), GENERATED(1));
  await writeFile(inBuild("assets/app.css"), ".a{color:red}");
  await writeFile(inBuild("assets/deep/chunk.js"), "export default 1");
  await writeFile(inBuild("manifests/components.html"), "Generation took <strong>0.0s</strong>.");
  h.stories = [{ id: "a--one" }, { id: "a--two", color: BLUE }];
  captures = 0;
  h.onCapture = () => {
    captures += 1;
  };
});
afterEach(async () => {
  await h.destroy();
});

describe("an unchanged build", () => {
  test("skips capture, and records the same images in a new run", async () => {
    const first = await review();
    expect(first.rendered).toBe(true);
    expect(first.json.reusedFromRun).toBeNull();

    const second = await review();
    expect(second.rendered).toBe(false);
    expect(second.json.reusedFromRun).toBe(first.json.runId);
    expect(second.json.runId).not.toBe(first.json.runId);
    expect(second.stderr).toContain(`Reused the images of run ${first.json.runId}`);
    expect(second.stderr).toMatch(/Timings: hash \d+ ms, capture 0 ms/);
    expect(second.json.differences.map(({ imageHash }: any) => imageHash)).toEqual(
      first.json.differences.map(({ imageHash }: any) => imageHash),
    );
    expect(second.json.counts).toEqual(first.json.counts);
    expect(second.code).toBe(first.code);
  });

  test("always names the run that really rendered, not another reuse", async () => {
    const first = await review();
    await review();
    expect((await review()).json.reusedFromRun).toBe(first.json.runId);
  });

  test("still hits after every exported file is pruned", async () => {
    const first = await review();
    const slug = (await readdir(h.home))[0]!;
    await rm(path.join(h.home, slug, "runs"), { recursive: true });
    expect((await review()).json.reusedFromRun).toBe(first.json.runId);
  });

  test("runs a build command first, and hits if it wrote the same bytes", async () => {
    await review("--build-command", `printf '.a{color:red}' > ${inBuild("assets/app.css")}`);
    expect((await review("--build-command", `printf '.a{color:red}' > ${inBuild("assets/app.css")}`)).rendered).toBe(false);
    expect((await review("--build-command", `printf '.a{color:tan}' > ${inBuild("assets/app.css")}`)).rendered).toBe(true);
  });
});

describe("a key input changing misses", () => {
  beforeEach(async () => {
    await review();
  });

  test.each(["iframe.html", "index.json", "project.json", "assets/app.css", "assets/deep/chunk.js", "manifests/components.html"])(
    "one byte of %s, with the same size and time",
    async (file) => {
      const before = await stat(inBuild(file));
      const bytes = await readFile(inBuild(file));
      bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
      await writeFile(inBuild(file), bytes);
      await utimes(inBuild(file), before.atime, before.mtime);
      expect((await stat(inBuild(file))).size).toBe(before.size);
      expect((await review()).rendered).toBe(true);
    },
  );

  test("a file added, even empty", async () => {
    await writeFile(inBuild("assets/empty.txt"), "");
    expect((await review()).rendered).toBe(true);
  });

  test("a file removed", async () => {
    await unlink(inBuild("assets/deep/chunk.js"));
    expect((await review()).rendered).toBe(true);
  });

  test("a file renamed, with the same bytes", async () => {
    await writeFile(inBuild("assets/renamed.css"), await readFile(inBuild("assets/app.css")));
    await unlink(inBuild("assets/app.css"));
    expect((await review()).rendered).toBe(true);
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

  test.each<[keyof KeyInputs, unknown]>([
    ["build", "b2"],
    ["environment", "e2"],
    ["settleMs", 101],
    ["initScriptSha256", null],
    ["renderer", "r2"],
    ["stability", true],
    ["stories", ["a--*"]],
  ])("%s, in the key itself", (input, value) => {
    const inputs: KeyInputs = {
      build: "b",
      environment: "e",
      settleMs: 100,
      initScriptSha256: "i",
      renderer: "r",
      stability: false,
      stories: null,
    };
    expect(renderKey({ ...inputs, [input]: value })).not.toBe(renderKey(inputs));
    expect(renderKey({ ...inputs })).toBe(renderKey(inputs));
  });
});

describe("what two builds of one source differ in", () => {
  beforeEach(async () => {
    await review();
  });

  test("project.json's generatedAt alone doesn't miss", async () => {
    await writeFile(inBuild("project.json"), GENERATED(1793616231907));
    expect((await review()).rendered).toBe(false);
  });

  test("the manifest's generation time alone doesn't miss", async () => {
    await writeFile(inBuild("manifests/components.html"), "Generation took <strong>12.3s</strong>.");
    expect((await review()).rendered).toBe(false);
  });

  test("anything else in project.json misses", async () => {
    await writeFile(inBuild("project.json"), GENERATED(1).replace("10.6.5", "10.6.6"));
    expect((await review()).rendered).toBe(true);
  });

  test("the same text anywhere else misses", async () => {
    await writeFile(inBuild("assets/project.json"), GENERATED(1));
    expect((await review()).rendered).toBe(true);
    await writeFile(inBuild("assets/project.json"), GENERATED(2));
    expect((await review()).rendered).toBe(true);
    await writeFile(inBuild("assets/components.html"), "Generation took <strong>0.0s</strong>.");
    expect((await review()).rendered).toBe(true);
    await writeFile(inBuild("assets/components.html"), "Generation took <strong>0.1s</strong>.");
    expect((await review()).rendered).toBe(true);
  });

  test("a file that isn't valid text keeps its every other byte", () => {
    const bytes = Buffer.from([0xff, 0xfe, 0x41, 0x80]);
    expect(Buffer.from(bytesToHash("project.json", bytes))).toEqual(bytes);
  });
});

describe("a run that isn't reusable", () => {
  test("a failed story is never reused, however often it fails", async () => {
    h.stories = [{ id: "a--one" }, { id: "a--two", failed: "Timed out" }];
    const first = await review();
    expect(first.rendered).toBe(true);
    expect(first.stderr).toContain("won't be reused: a story failed");
    expect((await review()).rendered).toBe(true);

    h.stories = [{ id: "a--one" }, { id: "a--two" }];
    const fixed = await review();
    expect(fixed.rendered).toBe(true);
    expect(fixed.json.blockers.map(({ reason }: any) => reason)).not.toContain("failed");
    expect((await review()).json.reusedFromRun).toBe(fixed.json.runId);
  });

  test("an image the store refused is a failure too", async () => {
    h.stories = [{ id: "a--one", rawPng: new TextEncoder().encode("not a png") }];
    expect((await review()).rendered).toBe(true);
    expect((await review()).rendered).toBe(true);
  });

  test.each(["request", "timeout", "worker", "repeat"] as const)("%s errors on an ok story aren't reused", async (source) => {
    h.stories = [{ id: "a--one", errors: [{ source, message: "it happened" }] }];
    const first = await review();
    expect(first.stderr).toContain(`might not recur (${source})`);
    expect((await review()).rendered).toBe(true);
  });

  test("a capture warning about itself isn't reused, though an unmatched pattern is", () => {
    const manifest = (warnings: string[]) => ({ stories: [], warnings }) as unknown as Manifest;
    const run = (unmatched: string[]) => ({ status: "complete", storyFilter: { patterns: [], unmatched } }) as unknown as Run;
    expect(whyNotReusable(manifest(["The worker stopped early: it crashed"]), run([]))).toContain("warned");
    expect(whyNotReusable(manifest(['Story pattern "x" matched nothing.']), run(["x"]))).toBeNull();
  });

  test("a later render's failure forgets the earlier good one", async () => {
    await review();
    h.stories = [{ id: "a--one", failed: "It really does fail" }];
    expect((await review("--no-reuse")).rendered).toBe(true);
    expect((await review()).rendered).toBe(true);
  });

  test("a build that changed while it rendered isn't remembered", async () => {
    h.onCapture = () => {
      captures += 1;
      writeFileSync(inBuild("assets/during.txt"), "written during the render");
    };
    const first = await review();
    expect(first.stderr).toContain("the build changed while it rendered");
    // The build as it now stands has no render that saw all of it from the start.
    h.onCapture = () => {
      captures += 1;
    };
    expect((await review()).rendered).toBe(true);
    await rm(inBuild("assets/during.txt"));
    expect((await review()).rendered).toBe(true);
  });

  test("a build holding a symlink always renders", async () => {
    await symlink(path.join(h.scratch, "elsewhere.css"), inBuild("assets/link.css"));
    expect((await review()).rendered).toBe(true);
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
        ],
      },
    ];
    const first = await review();
    const second = await review();
    expect(second.json.reusedFromRun).toBe(first.json.runId);
    expect(second.json.playErrors).toEqual([
      { story: "a--one", playError: "expected a dialog", current: expect.any(String) },
    ]);
    await stat(second.json.playErrors[0].current);
    expect(reasons(second.json.advisories)).toEqual(["play-error"]);
  });
});

describe("stability", () => {
  test("a run without it can't answer a request with it, nor the other way", async () => {
    h.stories = [{ id: "a--one", stability: "stable" }];
    await review();
    const checked = await review("--stability");
    expect(checked.rendered).toBe(true);
    expect(checked.json.stabilityChecked).toBe(true);

    const reused = await review("--stability");
    expect(reused.json.reusedFromRun).toBe(checked.json.runId);
    expect(reused.json.stabilityChecked).toBe(true);

    const plain = await review();
    expect(plain.rendered).toBe(false);
    expect(plain.json.stabilityChecked).toBe(false);
    expect(plain.json.reusedFromRun).not.toBe(checked.json.runId);
  });

  test("a stability run with no plain one renders for a plain request", async () => {
    h.stories = [{ id: "a--one", stability: "stable" }];
    await review("--stability");
    expect((await review()).rendered).toBe(true);
  });

  test("keeps unstable flags, and the second render until it is pruned", async () => {
    h.stories = [{ id: "a--one", stability: "unstable", repeatColor: BLUE }];
    const first = await review("--stability");
    expect(first.json.unstable[0].repeat).toEqual(expect.any(String));

    const second = await review("--stability");
    expect(second.json.reusedFromRun).toBe(first.json.runId);
    expect(reasons(second.json.advisories)).toEqual(["unstable"]);
    expect(second.json.unstable[0].repeat).toContain(second.json.runId);
    expect(await readFile(second.json.unstable[0].repeat)).toEqual(await readFile(first.json.unstable[0].repeat));

    const slug = (await readdir(h.home))[0]!;
    await rm(path.join(h.home, slug, "runs", first.json.runId), { recursive: true });
    const pruned = await review("--stability");
    expect(pruned.rendered).toBe(false);
    expect(reasons(pruned.json.advisories)).toEqual(["unstable"]);
    expect(pruned.json.unstable[0].repeat).toBeNull();
  });
});

describe("a filter", () => {
  test("is answered from a whole run", async () => {
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
    const rendered = await review(...flags, "--no-reuse");
    expect(reused.rendered).toBe(false);
    expect(rendered.rendered).toBe(true);
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

  test("a filtered run can't answer a wider request", async () => {
    await review("--story", "a--one");
    const wider = await review();
    expect(wider.rendered).toBe(true);
    expect(wider.json.counts.stories).toBe(2);
    expect((await review("--story", "a--one", "--story", "a--two", "--no-reuse")).rendered).toBe(true);
  });

  test("a filtered run answers the same patterns, in any order", async () => {
    const first = await review("--story", "a--one", "--story", "a--two");
    const again = await review("--story", "a--two", "--story", "a--one");
    expect(again.rendered).toBe(false);
    expect(again.json.reusedFromRun).toBe(first.json.runId);
    expect((await review("--story", "a--one")).rendered).toBe(true);
  });
});

describe("turning it off", () => {
  test("--no-reuse renders, and the render answers later reviews", async () => {
    await review();
    const forced = await review("--no-reuse");
    expect(forced.rendered).toBe(true);
    expect(forced.json.reusedFromRun).toBeNull();
    expect((await review()).json.reusedFromRun).toBe(forced.json.runId);
  });

  test("the config's reuse: false renders", async () => {
    await writeConfig({ reuse: false });
    await review();
    const second = await review();
    expect(second.rendered).toBe(true);
    expect(second.json.reusedFromRun).toBeNull();
  });

  test("the config's reuse must be a boolean", async () => {
    await writeConfig({ reuse: "no" });
    const { code, json } = await review();
    expect(code).toBe(2);
    expect(json.error.code).toBe("bad-config");
  });
});

describe("a reused run is a real run", () => {
  test("through approve, accept, the exit codes, and the next review", async () => {
    const first = await review();
    expect(first.code).toBe(1);

    const reused = await review();
    expect(reused.code).toBe(1);
    expect(reasons(reused.json.blockers)).toEqual(["new-unapproved", "new-unapproved"]);
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
    const reused = await review();
    await h.cli("approve", reused.json.runId, "--all");
    const slug = (await readdir(h.home))[0]!;
    await rm(path.join(h.home, slug, "runs"), { recursive: true });
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
    expect(changed.json.differences[0].pixelDiff.kind).toBe("pixels");
  });
});
