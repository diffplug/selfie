// Serves one Storybook build on loopback and screenshots its stories. Runs the same way
// inside the container and natively. See protocol.ts for what it may depend on.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import {
  CAPTURE_RECIPE,
  SNAPSHOT_GLOBAL,
  type StoryError,
  type WorkerEvent,
  type WorkerJob,
  type WorkerStory,
  type WorkerStoryResult,
} from "./protocol.ts";

const LAUNCH_TIMEOUT_MS = 60_000;
const NETWORK_IDLE_TIMEOUT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 5_000;
const MAX_ERRORS_PER_STORY = 20;
const MAX_ERROR_LENGTH = 400;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

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

function serve(buildDir: string, port: number): Promise<{ server: Server; origin: string }> {
  const root = path.resolve(buildDir);
  const server = createServer((req, res) => {
    const reject = (code: number) => {
      res.writeHead(code);
      res.end();
    };
    void (async () => {
      if (req.method !== "GET" && req.method !== "HEAD") return reject(405);
      let file: string;
      try {
        file = path.join(root, decodeURIComponent(new URL(req.url ?? "/", "http://loopback").pathname));
      } catch {
        return reject(400);
      }
      if (file !== root && !file.startsWith(root + path.sep)) return reject(403);
      const found = await stat(file).catch(() => null);
      if (found?.isDirectory()) file = path.join(file, "index.html");
      else if (!found) return reject(404);
      const stream = createReadStream(file);
      stream.once("error", () => (res.headersSent ? res.destroy() : reject(404)));
      stream.once("open", () => {
        res.writeHead(200, {
          "content-type": CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
          "cache-control": "no-store",
        });
        if (req.method === "HEAD") {
          stream.destroy();
          res.end();
        } else {
          stream.pipe(res);
        }
      });
    })();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    });
  });
}

/** The dimensions from a PNG's IHDR, which the format fixes at the start of the file. */
function pngDimensions(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function prepareContext(browser: Browser, job: WorkerJob, origin: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: job.viewport,
    deviceScaleFactor: job.scale,
    locale: CAPTURE_RECIPE.locale,
    timezoneId: CAPTURE_RECIPE.timezoneId,
    colorScheme: CAPTURE_RECIPE.colorScheme,
    reducedMotion: CAPTURE_RECIPE.reducedMotion,
    forcedColors: CAPTURE_RECIPE.forcedColors,
    serviceWorkers: "block",
  });
  // Date only: timers still run, which is why a project may need its own freeze.
  await context.clock.setFixedTime(new Date(CAPTURE_RECIPE.fixedTime));
  await context.addInitScript(`window.${SNAPSHOT_GLOBAL} = true;`);
  if (job.initCss !== null) {
    await context.addInitScript((css: string) => {
      const add = () => {
        if (!document.documentElement) return false;
        const style = document.createElement("style");
        style.textContent = css;
        document.documentElement.appendChild(style);
        return true;
      };
      if (add()) return;
      const observer = new MutationObserver(() => {
        if (add()) observer.disconnect();
      });
      observer.observe(document, { childList: true });
    }, job.initCss);
  }
  if (job.initScript !== null) await context.addInitScript({ content: job.initScript });
  // The container has no network anyway. This makes a native run fail the same way.
  await context.route(
    (url) => url.origin !== origin,
    (route) => route.abort(),
  );
  return context;
}

/** Waits through Storybook's loaders, render, and play function, then takes the screenshot. */
async function screenshotStory(
  context: BrowserContext,
  job: WorkerJob,
  origin: string,
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

  await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`, {
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
    if (phase === "errored" || phase === "aborted") return { error: `Storybook render phase: ${phase}` };
    return false;
  });
  const { error } = (await state.jsonValue()) as { error: string | null };
  if (error !== null) throw new Error(error);

  await page
    .waitForLoadState("networkidle", { timeout: Math.min(NETWORK_IDLE_TIMEOUT_MS, job.storyTimeoutMs) })
    .catch(() => {
      record({
        source: "timeout",
        message: `network not idle after ${NETWORK_IDLE_TIMEOUT_MS}ms; captured anyway`,
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
  origin: string,
  story: WorkerStory,
): Promise<WorkerStoryResult> {
  const started = Date.now();
  const errors: StoryError[] = [];
  const record = (error: StoryError) => {
    if (errors.length < MAX_ERRORS_PER_STORY)
      errors.push({ source: error.source, message: error.message.slice(0, MAX_ERROR_LENGTH) });
  };
  let context: BrowserContext | undefined;
  const failed = (): WorkerStoryResult => ({
    id: story.id,
    status: "failed",
    width: null,
    height: null,
    pngSha256: null,
    errors,
    durationMs: Date.now() - started,
  });
  try {
    const work = async () => {
      context = await prepareContext(await browser(), job, origin);
      return screenshotStory(context, job, origin, story, record);
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
    return failed();
  } finally {
    await withTimeout(Promise.resolve(context?.close()), CLOSE_TIMEOUT_MS, "context close").catch(() => {});
  }
}

async function main(): Promise<void> {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const job = JSON.parse(input) as WorkerJob;
  setTimeout(() => process.exit(3), job.runTimeoutMs).unref();

  const launch = () => chromium.launch({ headless: true, args: job.launchArgs, timeout: LAUNCH_TIMEOUT_MS });
  let launched = launch();
  const first = await launched;
  // A crash takes out the stories in flight, not the ones still queued.
  const liveBrowser = async (): Promise<Browser> => {
    const held = launched;
    if ((await held).isConnected()) return held;
    if (launched === held) launched = launch();
    return launched;
  };

  const { server, origin } = await serve(job.buildDir, job.port);
  emit({
    type: "ready",
    runtime: {
      browser: first.version(),
      playwright: (createRequire(import.meta.url)("playwright-core/package.json") as { version: string })
        .version,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  });

  const queue = [...job.stories];
  await Promise.all(
    Array.from({ length: job.concurrency }, async () => {
      for (let story = queue.shift(); story; story = queue.shift()) {
        emit({ type: "story", result: await captureStory(liveBrowser, job, origin, story) });
      }
    }),
  );

  await withTimeout(
    launched.then((browser) => browser.close()),
    CLOSE_TIMEOUT_MS,
    "browser close",
  ).catch(() => {});
  server.closeAllConnections();
  server.close();
  emit({ type: "done" });
  process.exit(0);
}

main().catch((error: unknown) => {
  emit({ type: "fatal", message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
