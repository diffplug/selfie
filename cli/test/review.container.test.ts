// The real binary, real Chromium in the real pinned container, and the renderer's fixture
// Storybook. vitest.config.ts decides whether these run, and says why if they don't.
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeImage } from "selfie-store";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createRepo } from "./support.ts";

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
    expect(first.json.counts).toMatchObject({ stories: 2, new: 2, needsAttention: 2 });
    expect(first.json.environment.id).toMatch(/^container-linux-arm64-/);
    expect(first.stderr).toContain("render 2/2");

    expect((await selfie("approve", first.json.runId, "--all")).status).toBe(0);
    expect((await selfie("accept", first.json.runId)).status).toBe(0);

    const same = await review(...STORIES);
    expect(same.status).toBe(0);
    expect(same.json.baselineSha).toBe(first.json.gitSha);
    expect(same.json.differences).toEqual([]);
    expect(same.json.counts.unchanged).toBe(2);

    // An init script is project input, so it reports a change rather than starting new goldens.
    const script = path.join(scratch, "paint.js");
    await writeFile(
      script,
      `addEventListener("DOMContentLoaded", () => { document.documentElement.style.filter = "invert(1)"; });`,
    );
    const changed = await review(...STORIES, "--init-script", script);
    expect(changed.status).toBe(1);
    expect(changed.json.initScriptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(changed.json.counts.changed).toBe(2);
    for (const { current, golden, diff, pixelDiff } of changed.json.differences) {
      expect(pixelDiff.kind).toBe("pixels");
      expect(pixelDiff.changedPixels).toBeGreaterThan(0);
      expect(pixelDiff.maxChannelDelta).toBeGreaterThan(0);
      const images = await Promise.all([current, golden, diff].map(async (file) => decodeImage(await readFile(file))));
      for (const image of images) expect(image).toMatchObject({ width: 1200, height: 900 });
    }
  }, 120_000);

  test("failures, play errors, and unstable stories are all listed, and exit 1", async () => {
    const { status, json } = await review(
      "--stability",
      "--story",
      "broken--throws",
      "--story",
      "play--fails",
      "--story",
      "timers--ticking",
    );
    expect(status).toBe(1);
    expect(json.status).toBe("failed");
    expect(json.stability.checked).toBe(true);
    expect(json.failures.map(({ story }: any) => story)).toEqual(["broken--throws"]);
    expect(json.playErrors.map(({ story }: any) => story)).toEqual(["play--fails"]);
    expect(json.unstable.map(({ story }: any) => story)).toEqual(["timers--ticking"]);
    await access(json.unstable[0].repeat);
    const reasons = json.needsAttention.map(({ reason }: any) => reason);
    expect(reasons).toEqual(expect.arrayContaining(["failed", "play-error", "unstable"]));
  }, 120_000);
});
