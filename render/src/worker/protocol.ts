// What crosses from the host process to the worker process: a job on stdin, events on
// stdout. The worker runs on the container image's own Node, so this file and the
// worker use only Node builtins, playwright-core, and erasable TypeScript.
import { createRequire } from "node:module";

export const PLAYWRIGHT_VERSION = (
  createRequire(import.meta.url)("playwright-core/package.json") as { version: string }
).version;

/** How a story is rendered, past what the environment's other fields say. All of it can decide pixels, so it's in the environment's ID. */
export interface RenderRecipe {
  /** Bumped when the order of waits in `worker.ts` changes. Not a project's to set. */
  waitSequence: number;
  /** No server listens here: the worker answers every request itself. */
  origin: string;
  /** Set to `true` before any story code loads, so a project can freeze its own timers. */
  renderGlobal: string;
  /** A container has no display. Not a project's to set. */
  headless: true;
  /** One could answer requests that the worker has to. Not a project's to set. */
  serviceWorkers: "block";
  locale: string;
  timezoneId: string;
  colorScheme: "light" | "dark" | "no-preference";
  reducedMotion: "reduce" | "no-preference";
  forcedColors: "none" | "active";
  /** What `Date` says, or null for the real time, which a story showing it can't hold still under. */
  fixedTime: string | null;
  networkQuietMs: number;
  networkQuietBoundMs: number;
  /** Load every image in the page, however lazily, and decode it, so a screenshot never races one. */
  loadImages: boolean;
  screenshot: {
    animations: "disabled" | "allow";
    caret: "hide" | "initial";
    scale: "device" | "css";
    fullPage: boolean;
  };
}

/** What a project may set. Everything's optional, and the rest comes from `DEFAULT_RECIPE`. */
export type RecipeOverrides = Partial<Omit<RenderRecipe, "waitSequence" | "headless" | "serviceWorkers" | "screenshot">> & {
  screenshot?: Partial<RenderRecipe["screenshot"]>;
};

export const DEFAULT_RECIPE: RenderRecipe = {
  waitSequence: 3,
  origin: "http://127.0.0.1:6199",
  renderGlobal: "__SELFIE_RENDER__",
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
  loadImages: true,
  screenshot: { animations: "disabled", caret: "hide", scale: "device", fullPage: true },
};

/** A browser window's size, in CSS pixels. */
export interface Viewport {
  width: number;
  height: number;
}

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
  viewport: Viewport;
  scale: number;
  recipe: RenderRecipe;
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
  | "viewport"
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
  /** The window it laid out in: what it declared, or else the environment's. */
  viewport: Viewport;
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
  /** Once, as the first story starts, which is after the browser is up. */
  | { type: "started" }
  | { type: "story"; result: WorkerStoryResult }
  | { type: "fatal"; message: string }
  | { type: "done" };
