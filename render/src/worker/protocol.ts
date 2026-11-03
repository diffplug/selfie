// What crosses from the host process to the worker process: a job on stdin, events on
// stdout. The worker runs on the container image's own Node, so this file and the
// worker use only Node builtins, playwright-core, and erasable TypeScript.
import { createRequire } from "node:module";

export const PLAYWRIGHT_VERSION = (
  createRequire(import.meta.url)("playwright-core/package.json") as { version: string }
).version;

/**
 * Everything fixed that can decide pixels. It is hashed into the environment ID, so editing
 * a value starts new goldens by itself. Bump `waitSequence` when the order of waits in
 * `worker.ts` changes.
 */
export const RENDER_RECIPE = {
  waitSequence: 2,
  /** No server listens here: the worker answers every request itself. */
  origin: "http://127.0.0.1:6199",
  /** Set to `true` before any story code loads, so a project can freeze its own timers. */
  snapshotGlobal: "__SELFIE_SNAPSHOT__",
  headless: true,
  serviceWorkers: "block",
  locale: "en-US",
  timezoneId: "UTC",
  colorScheme: "light",
  reducedMotion: "reduce",
  forcedColors: "none",
  fixedTime: "2026-01-15T12:00:00.000Z",
  networkQuietMs: 100,
  networkQuietBoundMs: 15_000,
  screenshot: { animations: "disabled", caret: "hide", scale: "device", fullPage: true },
} as const;

export interface WorkerStory {
  id: string;
  /** File name inside the job's output directory. */
  file: string;
}

export interface WorkerJob {
  buildDir: string;
  outDir: string;
  stories: WorkerStory[];
  launchArgs: string[];
  viewport: { width: number; height: number };
  scale: number;
  settleMs: number;
  initScript: string | null;
  concurrency: number;
  storyTimeoutMs: number;
  /** The worker exits on its own after this, so a container outlives no host process. */
  runTimeoutMs: number;
}

export type StoryErrorSource =
  | "render"
  | "timeout"
  | "play"
  | "page"
  | "console"
  | "request"
  | "worker";

export interface StoryError {
  source: StoryErrorSource;
  message: string;
}

export interface WorkerStoryResult {
  id: string;
  status: "ok" | "failed";
  width: number | null;
  height: number | null;
  pngSha256: string | null;
  errors: StoryError[];
  durationMs: number;
}

export interface WorkerRuntime {
  browser: string;
  playwright: string;
  node: string;
  platform: string;
  arch: string;
}

export type WorkerEvent =
  | { type: "ready"; runtime: WorkerRuntime }
  | { type: "story"; result: WorkerStoryResult }
  | { type: "fatal"; message: string }
  | { type: "done" };
