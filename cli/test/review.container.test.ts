// The real binary, real Chromium in the real pinned container, and the renderer's fixture
// Storybook. vitest.config.ts decides whether these run, and says why if they don't.
import { spawn } from "node:child_process";
import { access, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeImage } from "./support.ts";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { openProject } from "../src/project.ts";
import { commit, createRepo } from "./support.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const STORYBOOK = fileURLToPath(new URL("../../render/test/fixtures/storybook", import.meta.url));
const STORIES = ["--story", "basic--detail", "--story", "timers--frozen-by-selfie"];

let scratch: string;
let repo: string;
let home: string;

/** Spawned asynchronously, so a slow render doesn't block the test runner's timers. */
function selfie(...args: string[]): Promise<{ status: number | null; json: any; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MAIN, ...args], {
      cwd: repo,
      env: { ...process.env, SELFIE_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, json: JSON.parse(stdout), stderr }));
  });
}
const review = (...args: string[]) => selfie("review", "--storybook-dir", STORYBOOK, ...args);

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "selfie-review-test-"));
  repo = await createRepo(scratch);
  home = path.join(scratch, "home");
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe.runIf(process.env.SELFIE_CLI_CONTAINER === "1")("in the pinned container", () => {
  test("the whole loop: new, approved, accepted, unchanged, then changed with a diff", async () => {
    const first = await review(...STORIES);
    expect(first.status).toBe(1);
    expect(first.json.counts).toMatchObject({ stories: 2, new: 2, undecided: 2 });
    expect(first.json.blockers).toHaveLength(2);
    expect(first.json.environment).toMatch(/^container-linux-arm64-/);
    expect(first.stderr).toContain("render 2/2");

    expect((await selfie("approve", first.json.runId, "--all")).status).toBe(0);
    expect((await selfie("accept", first.json.runId)).status).toBe(0);

    const same = await review(...STORIES);
    expect(same.status).toBe(0);
    expect(same.json.baseline.sha).toBe(first.json.gitSha);
    expect(same.json.differences).toEqual([]);
    expect(same.json.counts.unchanged).toBe(2);
    // A filtered render is never remembered, so this one rendered again.
    expect(same.json.reusedFromRun).toBeNull();
    expect(same.stderr).toContain("render 2/2");

    // An init script is project input, so it reports a change rather than starting new goldens.
    await writeFile(
      path.join(repo, "paint.js"),
      `addEventListener("DOMContentLoaded", () => { document.documentElement.style.filter = "invert(1)"; });`,
    );
    await writeFile(path.join(repo, "selfie.config.json"), JSON.stringify({ initScript: "paint.js" }));
    const changed = await review(...STORIES);
    expect(changed.status).toBe(1);
    expect(changed.json.counts.changed).toBe(2);
    expect(changed.json.dirtyPaths).toContain("selfie.config.json");
    for (const { current, golden, diff, pixelDiff } of changed.json.differences) {
      expect(pixelDiff.changedPixels).toBeGreaterThan(0);
      expect(pixelDiff.maxChannelDelta).toBeGreaterThan(0);
      const images = await Promise.all([current, golden, diff].map(async (file) => decodeImage(await readFile(file))));
      for (const image of images) expect(image).toMatchObject({ width: 1200, height: 900 });
    }
  }, 120_000);

  test("reuses a whole run with no failures, and its images match a real render's", async () => {
    // The fixture's other stories fail on purpose, and a run with a failure is never reused.
    const build = path.join(scratch, "passing");
    await cp(STORYBOOK, build, { recursive: true });
    const index = JSON.parse(await readFile(path.join(build, "index.json"), "utf8"));
    const kept = Object.entries(index.entries).filter(([id]) => ["basic--detail", "timers--frozen-by-selfie"].includes(id));
    await writeFile(path.join(build, "index.json"), JSON.stringify({ ...index, entries: Object.fromEntries(kept) }));
    await rm(path.join(repo, "selfie.config.json"), { force: true });
    const reviewBuild = (...args: string[]) => selfie("review", "--storybook-dir", build, ...args);

    const first = await reviewBuild();
    expect(first.stderr).toContain("render 2/2");
    expect(first.json.reusedFromRun).toBeNull();

    const same = await reviewBuild();
    expect(same.json.runId).toBe(first.json.runId);
    expect(same.stderr).not.toContain("render 2/2");

    await commit(repo, "elsewhere");
    const reused = await reviewBuild();
    expect(reused.json.reusedFromRun).toBe(first.json.runId);
    expect(reused.stderr).not.toContain("render 2/2");

    const filtered = await reviewBuild("--story", "basic--detail");
    expect(filtered.json.reusedFromRun).toBe(first.json.runId);
    expect(filtered.json.counts.stories).toBe(1);

    const rendered = await selfie("record", "--storybook-dir", build);
    expect(rendered.stderr).toContain("render 2/2");
    expect((await reviewBuild()).json.runId).toBe(rendered.json.runId);

    const compared = await selfie("review", rendered.json.runId, "--baseline", first.json.runId);
    expect(compared.status).toBe(0);
    expect(compared.json.differences).toEqual([]);
    // From the store, since `differences` is empty for images that match the goldens.
    const project = await openProject({ cwd: repo, env: { SELFIE_HOME: home } });
    const images = async ({ json }: { json: any }) =>
      (await project.snapshots.compareRun(json.runId, null, { includeUnchanged: true })).snapshots.map(({ story, imageHash }) => [story, imageHash]);
    try {
      const firstImages = await images(first);
      expect(firstImages).toHaveLength(2);
      expect(firstImages.every(([, hash]) => hash !== null)).toBe(true);
      expect(await images(reused)).toEqual(firstImages);
      expect(await images(rendered)).toEqual(firstImages);
    } finally {
      project.close();
    }
  }, 120_000);

  test("failures block, and play errors are advisories", async () => {
    const { status, json } = await review("--story", "broken--throws", "--story", "play--fails");
    expect(status).toBe(1);
    expect(json.blockers.filter(({ reason }: any) => reason === "failed").map(({ story }: any) => story)).toEqual([
      "broken--throws",
    ]);
    expect(json.playErrors.map(({ story }: any) => story)).toEqual(["play--fails"]);
    expect(json.advisories.map(({ reason }: any) => reason)).toEqual(["play-error"]);
    expect(json.counts.advisories).toBe(1);
  }, 120_000);
});
