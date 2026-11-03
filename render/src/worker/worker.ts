// Screenshots one built Storybook's stories, answering the browser's requests from the build
// directory. Runs the same way inside the container and natively. See protocol.ts for what
// it may depend on.
import { createHash } from "node:crypto";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Request, type Route } from "playwright-core";
import {
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

/**
 * Counts a page's requests from the start, and returns a wait for none to have been in flight
 * for a quiet period, which at the bound resolves to what's still in flight, and otherwise to null. Playwright's `networkidle` is the
 * same thing with a fixed 500 ms.
 */
function trackRequests(page: Page): (quietMs: number, boundMs: number) => Promise<readonly string[] | null> {
  const inFlight = new Set<Request>();
  let lastChange = Date.now();
  const started = (request: Request) => {
    inFlight.add(request);
    lastChange = Date.now();
  };
  const ended = (request: Request) => {
    inFlight.delete(request);
    lastChange = Date.now();
  };
  page.on("request", started);
  page.on("requestfinished", ended);
  page.on("requestfailed", ended);
  return async (quietMs, boundMs) => {
    const deadline = Date.now() + boundMs;
    while (inFlight.size > 0 || Date.now() - lastChange < quietMs) {
      if (Date.now() >= deadline) return [...inFlight].map((request) => request.url());
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return null;
  };
}

/** The file a build-relative URL path names, or null if it is outside the build or absent. */
async function resolveStorybookFile(root: string, pathname: string): Promise<string | null> {
  let file: string;
  try {
    file = path.join(root, decodeURIComponent(pathname));
  } catch {
    return null;
  }
  if (!file.startsWith(root + path.sep)) return null;
  const found = await stat(file).catch(() => null);
  if (!found?.isDirectory()) return found ? file : null;
  // A missing one must be a 404: a request that's never answered holds the network wait to its bound.
  const index = path.join(file, "index.html");
  return (await stat(index).catch(() => null)) === null ? null : index;
}

/**
 * Answers a request from the build, and aborts any that leaves the origin. That abort is
 * only needed natively, since the container has no network. A request that can't be answered is
 * aborted, so it's reported rather than holding the network wait to its bound.
 */
async function answerFromStorybook(route: Route, root: string, origin: string): Promise<void> {
  const url = new URL(route.request().url());
  try {
    if (url.origin !== origin) return await route.abort();
    const file = await resolveStorybookFile(root, url.pathname);
    await (file
      ? route.fulfill({ path: file, headers: { "cache-control": "no-store" } })
      : route.fulfill({ status: 404 }));
  } catch {
    // Which only fails if the context has closed, and then there's nothing left to answer.
    await route.abort().catch(() => {});
  }
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
  const { recipe } = job;
  const context = await browser.newContext({
    viewport: job.viewport,
    deviceScaleFactor: job.scale,
    locale: recipe.locale,
    timezoneId: recipe.timezoneId,
    colorScheme: recipe.colorScheme,
    reducedMotion: recipe.reducedMotion,
    forcedColors: recipe.forcedColors,
    serviceWorkers: recipe.serviceWorkers,
  });
  // Date only: timers still run, which is why a project may need its own freeze.
  if (recipe.fixedTime !== null) await context.clock.setFixedTime(new Date(recipe.fixedTime));
  await context.addInitScript(`window.${recipe.snapshotGlobal} = true;`);
  await context.addInitScript(watchPlayFailures);
  if (job.initScript !== null) await context.addInitScript({ content: job.initScript });
  await context.route("**/*", (route) => answerFromStorybook(route, path.resolve(job.buildDir), recipe.origin));
  return context;
}

/** A frame can go away at any moment, and then what it held isn't in the screenshot either. */
async function inEveryFrame(page: Page, work: () => void | Promise<void>): Promise<void> {
  await Promise.all(page.frames().map((frame) => frame.evaluate(work).catch(() => {})));
}

/** Waits through Storybook's loaders, render, and play function, then takes the screenshot. */
async function screenshotStory(
  context: BrowserContext,
  job: WorkerJob,
  story: WorkerStory,
  record: (error: StoryError) => void,
): Promise<Buffer> {
  const { recipe } = job;
  const page = await context.newPage();
  page.setDefaultTimeout(job.storyTimeoutMs);
  const networkQuiet = trackRequests(page);
  page.on("console", (message) => {
    if (message.type() === "error") record({ source: "console", message: message.text() });
  });
  page.on("pageerror", (error) => record({ source: "page", message: String(error) }));
  page.on("requestfailed", (request) => {
    record({ source: "request", message: `${request.url()} ${request.failure()?.errorText ?? ""}`.trim() });
  });

  await page.goto(`${recipe.origin}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`, {
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

  const settleNetwork = async () => {
    const unanswered = await networkQuiet(recipe.networkQuietMs, recipe.networkQuietBoundMs);
    if (unanswered === null) return;
    record({
      source: "timeout",
      message: `network not quiet after ${recipe.networkQuietBoundMs}ms; rendered anyway${unanswered.length === 0 ? "" : `, with these in flight: ${unanswered.join(", ")}`}`,
    });
  };
  await settleNetwork();
  if (recipe.loadImages) {
    // Eager first, since a lazy image below the fold isn't even asked for yet. Sync, since one decoded
    // asynchronously can paint scaled differently from one render to the next.
    await inEveryFrame(page, () => {
      for (const image of document.images) {
        image.loading = "eager";
        image.decoding = "sync";
      }
    });
    await settleNetwork();
    await inEveryFrame(page, () => Promise.all([...document.images].map((image) => image.decode().catch(() => {}))).then(() => undefined));
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(job.settleMs);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  return page.screenshot({ ...recipe.screenshot, type: "png" });
}

async function renderStory(
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
    chromium.launch({ headless: job.recipe.headless, args: job.launchArgs, timeout: LAUNCH_TIMEOUT_MS });
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
        emit({ type: "story", result: await renderStory(liveBrowser, job, story) });
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
