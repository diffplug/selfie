// A temp Git repository and Selfie home, and a stand-in for `capture` that writes what a test
// says, so everything but the browser runs with no Docker. `review.container.test.ts` runs the
// real one.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  defineEnvironment,
  environmentId,
  filterStories,
  type capture,
  type CaptureOptions,
  type Manifest,
  type ManifestStory,
  type StoryError,
  unmatchedPatternWarning,
} from "selfie-render";
import { STORIES_DIR, storyFileName, totalsOf, writeManifest } from "selfie-render/testing";
import { runCli } from "../src/cli.ts";
import { encodePng } from "../src/png.ts";

export type Color = readonly [number, number, number];

export const RED: Color = [200, 30, 30];
export const BLUE: Color = [30, 30, 200];
export const GREEN: Color = [30, 200, 30];

export function solid(width: number, height: number, [r, g, b]: Color) {
  const pixels = new Uint8Array(width * height * 3);
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
  }
  return { width, height, pixels };
}

export interface FakeStory {
  readonly id: string;
  readonly color?: Color;
  readonly width?: number;
  readonly height?: number;
  /** Changes one region of the solid color: x, y, width, height, and its color. */
  readonly patch?: readonly [number, number, number, number, Color];
  readonly failed?: string;
  readonly errors?: readonly StoryError[];
  /** A warning from the capture itself, in the manifest. */
  readonly warning?: string;
  /** Replaces the manifest's path to the image, to test what an unsafe one does. */
  readonly fileOverride?: string;
  /** Replaces the PNG, to test what a refused one does. */
  readonly rawPng?: Uint8Array;
  /** Replaces the file with a symlink to this target. */
  readonly symlinkTo?: string;
}

/** Writes what `capture` writes for these stories. */
export function fakeCapture(
  stories: () => readonly FakeStory[],
  onCapture?: (options: CaptureOptions) => void,
): typeof capture {
  return async (options: CaptureOptions) => {
    onCapture?.(options);
    const environment = options.environment ?? defineEnvironment();
    const filtered = options.stories ? filterStories(stories(), options.stories) : null;
    const selected = filtered?.stories ?? stories();

    await mkdir(path.join(options.outDir, STORIES_DIR), { recursive: true });
    const manifestStories: ManifestStory[] = [];
    for (const story of selected) {
      const fileName = storyFileName(story.id);
      const file = path.posix.join(STORIES_DIR, fileName);
      const width = story.width ?? 8;
      const height = story.height ?? 8;
      if (story.failed === undefined && story.fileOverride === undefined) {
        const target = path.join(options.outDir, file);
        if (story.symlinkTo !== undefined) {
          await symlink(story.symlinkTo, target);
        } else {
          const image = solid(width, height, story.color ?? RED);
          if (story.patch !== undefined) {
            const [px, py, pw, ph, [r, g, b]] = story.patch;
            for (let y = py; y < py + ph; y++) {
              for (let x = px; x < px + pw; x++) {
                const at = (y * width + x) * 3;
                image.pixels[at] = r;
                image.pixels[at + 1] = g;
                image.pixels[at + 2] = b;
              }
            }
          }
          await writeFile(target, story.rawPng ?? (await encodePng(image)));
        }
      }
      manifestStories.push({
        id: story.id,
        title: "",
        name: "",
        status: story.failed === undefined ? "ok" : "failed",
        file: story.failed === undefined ? (story.fileOverride ?? file) : null,
        width,
        height,
        pngSha256: null,
        errors: [...(story.errors ?? []), ...(story.failed === undefined ? [] : [{ source: "render" as const, message: story.failed }])],
        durationMs: 1,
      });
    }
    const manifest: Manifest = {
      schemaVersion: 1,
      environmentId: environmentId(environment),
      environment,
      recipe: {} as Manifest["recipe"],
      settleMs: 100,
      initScriptSha256: null,
      runtime: null,
      startedAt: new Date().toISOString(),
      durationMs: 1,
      warnings: [
        ...(filtered?.unmatched.map(unmatchedPatternWarning) ?? []),
        ...selected.flatMap(({ warning }) => (warning === undefined ? [] : [warning])),
      ],
      totals: totalsOf(manifestStories),
      stories: manifestStories,
    };
    await writeManifest(options.outDir, manifest);
    return manifest;
  };
}

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A new repository on `main` with one commit, and its identity set for this repository only. */
export async function createRepo(parent: string, name = "repo"): Promise<string> {
  const repo = path.join(parent, name);
  await mkdir(repo, { recursive: true });
  git(repo, "init", "--quiet", "--initial-branch=main");
  git(repo, "config", "user.email", "tester@example.com");
  git(repo, "config", "user.name", "Tester");
  git(repo, "config", "commit.gpgsign", "false");
  await commit(repo, "first");
  return repo;
}

/** Commits a change to one file, and returns the new SHA. */
export async function commit(repo: string, message: string, file = "file.txt"): Promise<string> {
  await writeFile(path.join(repo, file), `${message}\n`);
  git(repo, "add", file);
  git(repo, "commit", "--quiet", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

export interface Harness {
  readonly scratch: string;
  readonly repo: string;
  readonly home: string;
  /** What the next capture renders. */
  stories: readonly FakeStory[];
  /** Runs a command in-process. `json` is stdout parsed, which fails if it isn't one document. */
  cli: (...argv: string[]) => Promise<{ code: number; json: any; stdout: string; stderr: string }>;
  /** The capture to hand to the library directly. */
  capture: typeof capture;
  /** Called at the start of each capture. */
  onCapture?: (options: CaptureOptions) => void;
  destroy: () => Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const scratch = await mkdtemp(path.join(tmpdir(), "selfie-cli-test-"));
  const repo = await createRepo(scratch);
  const home = path.join(scratch, "home");
  const fake = fakeCapture(
    () => harness.stories,
    (options) => harness.onCapture?.(options),
  );
  const harness: Harness = {
    scratch,
    repo,
    home,
    stories: [],
    capture: fake,
    cli: async (...argv) => {
      let stdout = "";
      let stderr = "";
      const code = await runCli(argv, {
        cwd: repo,
        env: { SELFIE_HOME: home },
        stdout: (text) => {
          stdout += text;
        },
        stderr: (text) => {
          stderr += text;
        },
        capture: fake,
      });
      return { code, stdout, stderr, json: JSON.parse(stdout) };
    },
    destroy: () => rm(scratch, { recursive: true, force: true }),
  };
  return harness;
}
