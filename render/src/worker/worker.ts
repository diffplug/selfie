// Screenshots one Storybook build's stories, answering the browser's requests from the build
// directory. Runs the same way inside the container and natively. See protocol.ts for what
// it may depend on.
import { createHash } from "node:crypto";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Route } from "playwright-core";
import {
  CAPTURE_RECIPE,
  PLAYWRIGHT_VERSION,
  type StoryError,
  type WorkerEvent,
  type WorkerJob,
  type WorkerStory,
  type WorkerStoryResult,
} from "./protocol.ts";

const LAUNCH_TIMEOUT_MS = 60_000;
const CLOSE_TIMEOUT_MS = 5_000;
const MAX_ERRORS_PER_STORY = 20;
const MAX_ERROR_LENGTH = 400;

const { origin: ORIGIN } = CAPTURE_RECIPE;

class TimeoutError extends Error {}

function emit(event: WorkerEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** The dimensions from a PNG's IHDR, which the format fixes at the start of the file. */
function pngDimensions(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** The file a build-relative URL path names, or null if it is outside the build or absent. */
async function resolveBuildFile(root: string, pathname: string): Promise<string | null> {
  let file: string;
  try {
    file = path.join(root, decodeURIComponent(pathname));
  } catch {
    return null;
  }
  if (!file.startsWith(root + path.sep)) return null;
  const found = await stat(file).catch(() => null);
  if (found?.isDirectory()) file = path.join(file, "index.html");
  return found ? file : null;
}

/**
 * Answers a request from the build, and aborts any that leaves the origin. That abort is
 * only needed natively, since the container has no network. A failure here means the context
 * has closed, so there is nothing left to answer.
 */
async function answerFromBuild(route: Route, root: string): Promise<void> {
  const url = new URL(route.request().url());
  try {
    if (url.origin !== ORIGIN) return await route.abort();
    const file = await resolveBuildFile(root, url.pathname);
    await (file
      ? route.fulfill({ path: file, headers: { "cache-control": "no-store" } })
      : route.fulfill({ status: 404 }));
  } catch {}
}

/**
 * Storybook logs a play function's failure and completes the render, when the build sets
 * `throwPlayFunctionExceptions: false`. Its channel is the one signal that isn't log text.
 * It must be subscribed before the preview starts, so this catches the channel on assignment.
 */
function watchPlayFailures(): void {
  const failures: string[] = [];
  (window as unknown as { __SELFIE_PLAY_FAILURES__: string[] }).__SELFIE_PLAY_FAILURES__ = failures;
  type Channel = { on(event: string, listener: (error?: { message?: string }) => void): void };
  let channel: Channel | undefined;
  Object.defineProperty(globalThis, "__STORYBOOK_ADDONS_CHANNEL__", {
    configurable: true,
    get: () => channel,
    set: (next: Channel) => {
      if (next !== channel) {
        next.on("playFunctionThrewException", (error) => failures.push(String(error?.message)));
      }
      channel = next;
    },
  });
}

async function prepareContext(browser: Browser, job: WorkerJob): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: job.viewport,
    deviceScaleFactor: job.scale,
    locale: CAPTURE_RECIPE.locale,
    timezoneId: CAPTURE_RECIPE.timezoneId,
    colorScheme: CAPTURE_RECIPE.colorScheme,
    reducedMotion: CAPTURE_RECIPE.reducedMotion,
    forcedColors: CAPTURE_RECIPE.forcedColors,
    serviceWorkers: CAPTURE_RECIPE.serviceWorkers,
  });
  // Date only: timers still run, which is why a project may need its own freeze.
  await context.clock.setFixedTime(new Date(CAPTURE_RECIPE.fixedTime));
  await context.addInitScript(`window.${CAPTURE_RECIPE.snapshotGlobal} = true;`);
  await context.addInitScript(watchPlayFailures);
  if (job.initScript !== null) await context.addInitScript({ content: job.initScript });
  await context.route("**/*", (route) => answerFromBuild(route, path.resolve(job.buildDir)));
  return context;
}

/** Waits through Storybook's loaders, render, and play function, then takes the screenshot. */
async function screenshotStory(
  context: BrowserContext,
  job: WorkerJob,
  story: WorkerStory,
  record: (error: StoryError) => void,
): Promise<Buffer> {
  const page = await context.newPage();
  page.setDefaultTimeout(job.storyTimeoutMs);
  page.on("console", (message) => {
    if (message.type() === "error") record({ source: "console", message: message.text() });
  });
  page.on("pageerror", (error) => record({ source: "page", message: String(error) }));
  page.on("requestfailed", (request) => {
    record({ source: "request", message: `${request.url()} ${request.failure()?.errorText ?? ""}`.trim() });
  });

  await page.goto(`${ORIGIN}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`, {
    waitUntil: "load",
  });
  const state = await page.waitForFunction(() => {
    type Preview = { currentRender?: { phase?: string } };
    const body = document.body;
    if (body?.classList.contains("sb-show-errordisplay")) {
      return {
        error:
          document.querySelector("#error-message")?.textContent?.trim() ||
          "Storybook showed its error display",
      };
    }
    if (body?.classList.contains("sb-show-nopreview"))
      return { error: "Storybook found no preview for this story" };
    const phase = (window as unknown as { __STORYBOOK_PREVIEW__?: Preview }).__STORYBOOK_PREVIEW__
      ?.currentRender?.phase;
    if (phase === "completed" || phase === "finished") return { error: null };
    // Not `errored`: a play failure passes through it on the way to `completed`, so seeing it
    // would depend on timing. A render that really ended there shows the error display.
    if (phase === "aborted") return { error: "Storybook aborted the render" };
    return false;
  });
  const { error } = (await state.jsonValue()) as { error: string | null };
  if (error !== null) throw new Error(error);
  const playFailures = await page.evaluate(
    () => (window as unknown as { __SELFIE_PLAY_FAILURES__: string[] }).__SELFIE_PLAY_FAILURES__,
  );
  for (const message of playFailures) record({ source: "play", message });

  await page.waitForLoadState("networkidle", { timeout: CAPTURE_RECIPE.networkIdleBoundMs }).catch(() => {
    record({
      source: "timeout",
      message: `network not idle after ${CAPTURE_RECIPE.networkIdleBoundMs}ms; captured anyway`,
    });
  });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(job.settleMs);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  return page.screenshot({ ...CAPTURE_RECIPE.screenshot, type: "png" });
}

async function captureStory(
  browser: () => Promise<Browser>,
  job: WorkerJob,
  story: WorkerStory,
): Promise<WorkerStoryResult> {
  const started = Date.now();
  const errors: StoryError[] = [];
  const record = (error: StoryError) => {
    if (errors.length < MAX_ERRORS_PER_STORY)
      errors.push({ source: error.source, message: error.message.slice(0, MAX_ERROR_LENGTH) });
  };
  let context: BrowserContext | undefined;
  try {
    const work = async () => {
      context = await prepareContext(await browser(), job);
      return screenshotStory(context, job, story, record);
    };
    // A fresh context per story, so no storage or cache carries over. The outer bound
    // covers what Playwright won't time out, like an evaluate on a page that never answers.
    const png = await withTimeout(
      work(),
      job.storyTimeoutMs,
      `story did not finish within ${job.storyTimeoutMs}ms`,
    );
    await writeFile(path.join(job.outDir, story.file), png);
    return {
      id: story.id,
      status: "ok",
      ...pngDimensions(png),
      pngSha256: createHash("sha256").update(png).digest("hex"),
      errors,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const timedOut =
      error instanceof TimeoutError || (error instanceof Error && error.name === "TimeoutError");
    record({
      source: timedOut ? "timeout" : "render",
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      id: story.id,
      status: "failed",
      width: null,
      height: null,
      pngSha256: null,
      errors,
      durationMs: Date.now() - started,
    };
  } finally {
    await withTimeout(Promise.resolve(context?.close()), CLOSE_TIMEOUT_MS, "context close").catch(() => {});
  }
}

async function main(): Promise<void> {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const job = JSON.parse(input) as WorkerJob;
  setTimeout(() => process.exit(3), job.runTimeoutMs).unref();

  const launch = () =>
    chromium.launch({ headless: CAPTURE_RECIPE.headless, args: job.launchArgs, timeout: LAUNCH_TIMEOUT_MS });
  let launched = launch();
  const first = await launched;
  // A crash takes out the stories in flight, not the ones still queued.
  const liveBrowser = async (): Promise<Browser> => {
    const held = launched;
    if ((await held).isConnected()) return held;
    if (launched === held) launched = launch();
    return launched;
  };

  emit({
    type: "ready",
    runtime: {
      browser: first.version(),
      playwright: PLAYWRIGHT_VERSION,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  });

  const queue = [...job.stories];
  await Promise.all(
    Array.from({ length: job.concurrency }, async () => {
      for (let story = queue.shift(); story; story = queue.shift()) {
        emit({ type: "story", result: await captureStory(liveBrowser, job, story) });
      }
    }),
  );

  await withTimeout(
    launched.then((browser) => browser.close()),
    CLOSE_TIMEOUT_MS,
    "browser close",
  ).catch(() => {});
  emit({ type: "done" });
  process.exit(0);
}

main().catch((error: unknown) => {
  emit({ type: "fatal", message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
