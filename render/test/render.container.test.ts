// Real Chromium in the real pinned container, against a tiny Storybook-like fixture.
// vitest.config.ts decides whether these run, and says why if they don't.
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { render, type RenderOptions } from "../src/render.ts";
import { type ContainerRunner, defineEnvironment, environmentId } from "../src/environment.ts";
import type { Manifest, ManifestStory } from "../src/manifest.ts";

const STORYBOOK = fileURLToPath(new URL("./fixtures/storybook", import.meta.url));
const quiet = () => {};

let scratch: string;
let dirCounter = 0;
const newOutDir = () => path.join(scratch, `out-${(dirCounter += 1)}`);

const run = (options: Partial<RenderOptions>, outDir = newOutDir()) =>
  render({ storybookDir: STORYBOOK, outDir, log: quiet, ...options });
const story = (manifest: Manifest, id: string): ManifestStory => {
  const found = manifest.stories.find((entry) => entry.id === id);
  if (!found) throw new Error(`no story ${id}`);
  return found;
};

function pngChunkTypes(png: Buffer): string[] {
  const types: string[] = [];
  for (let offset = 8; offset < png.length; offset += 12 + png.readUInt32BE(offset))
    types.push(png.toString("latin1", offset + 4, offset + 8));
  return types;
}

/** The selfie-render containers holding this output directory, so another run's don't count. */
const containersFor = async (outDir: string) => {
  const { stdout } = await promisify(execFile)("docker", [
    "ps",
    "--all",
    "--no-trunc",
    "--filter",
    "label=selfie-render",
    "--format",
    "{{.Mounts}}",
  ]);
  return stdout
    .split("\n")
    .filter((mounts) => mounts.includes(outDir))
    .join("\n");
};

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "selfie-render-test-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe.runIf(process.env.SELFIE_RENDER_CONTAINER === "1")("in the pinned container", () => {
  describe("a full run", () => {
    let outDir: string;
    let manifest: Manifest;

    beforeAll(async () => {
      outDir = newOutDir();
      manifest = await run({ storyTimeoutMs: 5_000 }, outDir);
    }, 120_000);

    test("runs on the image it was told to, and records it", () => {
      expect(manifest.environmentId).toBe(environmentId(defineEnvironment()));
      expect(manifest.environment).toEqual(defineEnvironment());
      expect(manifest.runtime).toMatchObject({ platform: "linux", arch: "arm64", playwright: "1.63.0" });
      expect(manifest.settleMs).toBeGreaterThanOrEqual(0);
    });

    test("answers from the build, and 404s what's missing or outside it", () => {
      const served = story(manifest, "basic--serving");
      expect(served.errors.map((error) => error.message).join()).not.toContain("answered");
      expect(served.status).toBe("ok");
    });

    test("reports a play failure as its own source, without failing the story", () => {
      const played = story(manifest, "play--fails");
      expect(played.status).toBe("ok");
      expect(played.errors).toContainEqual({ source: "play", message: "this play function fails" });
    });

    test("renders every story and leaves out docs", () => {
      expect(manifest.stories.map((entry) => entry.id)).not.toContain("guide--docs");
      expect(manifest.totals.stories).toBe(14);
    });

    test("applies the page conditions before story code runs", () => {
      const { status, errors } = story(manifest, "basic--environment");
      expect(errors).toEqual([]);
      expect(status).toBe("ok");
    });

    test("renders the whole page, not only the viewport", () => {
      const { width, height, status } = story(manifest, "basic--tall");
      expect({ status, width, height }).toEqual({ status: "ok", width: 1200, height: 2000 });
    });

    test("writes real PNGs at the path the manifest names", async () => {
      const { file, width, height, status } = story(manifest, "basic--detail");
      expect({ status, width, height }).toEqual({ status: "ok", width: 1200, height: 900 });
      const png = await readFile(path.join(outDir, file as string));
      expect(png.subarray(1, 4).toString()).toBe("PNG");
    });

    test("reports a failed story and carries on", () => {
      const thrown = story(manifest, "broken--throws");
      expect(thrown).toMatchObject({ status: "failed", file: null });
      expect(thrown.errors).toContainEqual({ source: "render", message: "this story always throws" });
      expect(manifest.totals.failed).toBeLessThan(manifest.totals.stories);
    });

    test("bounds a story that never finishes", () => {
      const hung = story(manifest, "broken--never-finishes");
      expect(hung.status).toBe("failed");
      expect(hung.errors.map((error) => error.source)).toContain("timeout");
      expect(hung.durationMs).toBeLessThan(15_000);
    });

    test("bounds a story that blocks its main thread", () => {
      const blocked = story(manifest, "broken--blocks-main-thread");
      expect(blocked.status).toBe("failed");
      expect(blocked.errors.map((error) => error.source)).toContain("timeout");
      expect(blocked.durationMs).toBeLessThan(15_000);
    });

    test("blocks external requests and reports them without failing the story", () => {
      const external = story(manifest, "basic--external-request");
      expect(external.status).toBe("ok");
      expect(external.errors.map((error) => error.message).join()).toContain("example.invalid");
    });

    test("writes only what it owns", async () => {
      expect((await readdir(outDir)).sort()).toEqual(["manifest.json", "stories"]);
    });

    test("writes the manifest it returns", async () => {
      expect(JSON.parse(await readFile(path.join(outDir, "manifest.json"), "utf8"))).toEqual(manifest);
    });

    test("removes its containers", async () => {
      expect(await containersFor(outDir)).toBe("");
    });
  });

  test("the same render matches byte for byte, except a project's own timers", async () => {
    const same = ["basic--detail", "basic--animation", "basic--environment", "timers--frozen-by-selfie"];
    const options = { stories: [...same, "timers--frozen-by-project"], concurrency: 2 };
    const manifests = [await run(options), await run(options), await run(options)];
    const distinct = (id: string) => new Set(manifests.map((manifest) => story(manifest, id).pngSha256)).size;
    for (const id of same) expect(distinct(id)).toBe(1);
    expect(distinct("timers--frozen-by-project")).toBeGreaterThan(1);
    // A timestamp or text chunk would make equal pixels differ.
    const outDir = newOutDir();
    const manifest = await run({ stories: ["basic--detail"] }, outDir);
    const png = await readFile(path.join(outDir, story(manifest, "basic--detail").file as string));
    expect(pngChunkTypes(png).filter((type) => type !== "IDAT")).toEqual(["IHDR", "IEND"]);
  });

  test("a project's init script runs before story code", async () => {
    const options = { stories: ["timers--frozen-by-project"], initScript: "window.__PROJECT_FREEZE__ = true;" };
    const frozen = await run(options);
    expect(story(frozen, "timers--frozen-by-project").errors).toEqual([]);
    expect(frozen.totals).toEqual({ stories: 1, failed: 0 });
    expect(frozen.initScriptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(story(await run(options), "timers--frozen-by-project").pngSha256).toBe(story(frozen, "timers--frozen-by-project").pngSha256);
  });

  test("a digest for another platform is refused before the output is touched", async () => {
    const outDir = newOutDir();
    await run({ stories: ["basic--detail"] }, outDir);
    const environment = defineEnvironment({
      runner: { ...(defineEnvironment().runner as ContainerRunner), platform: "linux/s390x" },
    });
    await expect(run({ environment, stories: ["basic--detail"] }, outDir)).rejects.toThrow(/linux\/s390x/);
    expect(await readdir(outDir)).toContain("manifest.json");
  });

  test("settling longer doesn't change the environment", async () => {
    const manifest = await run({ stories: ["basic--detail"], settleMs: 1 });
    expect(manifest.settleMs).toBe(1);
    expect(manifest.environmentId).toBe(environmentId(defineEnvironment()));
  });

  test("loads a lazy image below the fold", async () => {
    const manifest = await run({ stories: ["images--lazy"] });
    expect(story(manifest, "images--lazy").errors).toContainEqual({ source: "console", message: "the lazy image loaded" });
  });

  test("a project's recipe reaches the browser", async () => {
    const recipe = { origin: "http://localhost:6006", locale: "de-DE", timezoneId: "Asia/Tokyo", colorScheme: "dark", fixedTime: "2031-03-04T00:00:00.000Z", renderGlobal: "__MY_RENDER__" } as const;
    const environment = defineEnvironment({ recipe });
    const manifest = await run({ environment, stories: ["recipe--says"] });
    const [said] = story(manifest, "recipe--says").errors;
    expect(JSON.parse(said!.message)).toEqual({ origin: recipe.origin, locale: "de-DE", timezone: "Asia/Tokyo", dark: true, year: 2031, flag: true });
    expect(manifest.recipe).toMatchObject(recipe);
    expect(manifest.environmentId).not.toBe(environmentId(defineEnvironment()));
  });

  test("viewport and scale reach the pixels", async () => {
    const environment = defineEnvironment({ viewport: { width: 400, height: 300 }, scale: 2 });
    const manifest = await run({ environment, stories: ["basic--tall", "basic--animation"] });
    expect(story(manifest, "basic--tall")).toMatchObject({ status: "ok", width: 800, height: 4000 });
    expect(story(manifest, "basic--animation")).toMatchObject({ status: "ok", width: 800, height: 600 });
    expect(manifest.environmentId).not.toBe(environmentId(defineEnvironment()));
  });

  test("an abort stops the run and removes its container", async () => {
    const outDir = newOutDir();
    const abort = new AbortController();
    const running = run(
      { stories: ["broken--never-finishes"], storyTimeoutMs: 60_000, signal: abort.signal },
      outDir,
    );
    await expect.poll(() => containersFor(outDir), { timeout: 30_000 }).not.toBe("");
    abort.abort();
    await expect(running).rejects.toThrow("Render aborted.");
    await expect.poll(() => containersFor(outDir), { timeout: 30_000 }).toBe("");
  });

  test("a filter matching nothing is reported, and starts no container", async () => {
    const manifest = await run({ stories: ["nope--*"] });
    expect(manifest.totals.stories).toBe(0);
    expect(manifest.runtime).toBeNull();
    expect(manifest.warnings.join()).toContain("nope--*");
  });
});

test("a build directory that isn't a Storybook is refused", async () => {
  await expect(
    render({ storybookDir: path.join(STORYBOOK, "missing"), outDir: newOutDir(), log: quiet }),
  ).rejects.toThrow(/index/);
});

test("a native runner warns, and its environment never names the container", async (context) => {
  const lines: string[] = [];
  const environment = defineEnvironment({ runner: { kind: "native" } });
  let manifest: Manifest;
  try {
    manifest = await render({
      storybookDir: STORYBOOK,
      outDir: newOutDir(),
      environment,
      stories: ["basic--detail"],
      log: (line) => lines.push(line),
    });
  } catch (error) {
    if (String(error).includes("Executable doesn't exist")) {
      context.skip("Playwright's Chromium isn't installed on this machine.");
    }
    throw error;
  }
  expect(lines.join("\n")).toMatch(/won't match other machines/);
  expect(manifest.warnings.join()).toMatch(/won't match other machines/);
  expect(manifest.environmentId).toMatch(new RegExp(`^native-${process.platform}-${process.arch}-`));
  expect(manifest.runtime).toMatchObject({ platform: process.platform, arch: process.arch });
  expect(story(manifest, "basic--detail").status).toBe("ok");
});

test("a native environment from another machine is refused", async () => {
  const environment = defineEnvironment({
    runner: { kind: "native", os: "plan9", osRelease: "4", arch: "mips" },
  });
  await expect(
    render({ storybookDir: STORYBOOK, outDir: newOutDir(), environment, log: quiet }),
  ).rejects.toThrow(/this machine/);
});
