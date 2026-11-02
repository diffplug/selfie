// What crosses from the host process to the worker process: a job on stdin, events on
// stdout. The worker runs on the container image's own Node, so this file and the
// worker use only Node builtins, playwright-core, and erasable TypeScript.

/** Set to `true` before any story code loads, so a project can freeze its own timers. */
export const SNAPSHOT_GLOBAL = "__SELFIE_SNAPSHOT__";

/**
 * The fixed part of how a story becomes pixels. It is hashed into the environment ID, so
 * editing a value starts new goldens by itself. Bump `waitSequence` when the order of
 * waits in `worker.ts` changes.
 */
export const CAPTURE_RECIPE = {
  waitSequence: 1,
  locale: "en-US",
  timezoneId: "UTC",
  colorScheme: "light",
  reducedMotion: "reduce",
  forcedColors: "none",
  fixedTime: "2026-01-15T12:00:00.000Z",
  screenshot: { animations: "disabled", caret: "hide", scale: "device", fullPage: false },
} as const;

export interface WorkerStory {
  id: string;
  /** File name inside the job's output directory. */
  file: string;
}

export interface WorkerJob {
  buildDir: string;
  outDir: string;
  /** 0 picks a free port. A container has its own loopback, so it can use a fixed one. */
  port: number;
  stories: WorkerStory[];
  launchArgs: string[];
  viewport: { width: number; height: number };
  scale: number;
  settleMs: number;
  initScript: string | null;
  initCss: string | null;
  concurrency: number;
  storyTimeoutMs: number;
  /** The worker exits on its own after this, so a container outlives no host process. */
  runTimeoutMs: number;
}

export type StoryErrorSource = "render" | "timeout" | "page" | "console" | "request" | "worker" | "repeat";

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
