import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseImage, type ContainerRunner, type RenderEnvironment } from "./environment.ts";
import { RenderError } from "./storybook.ts";
import type { WorkerEvent, WorkerJob, WorkerRuntime, WorkerStoryResult } from "./worker/protocol.ts";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PLAYWRIGHT_ROOT = path.dirname(createRequire(import.meta.url).resolve("playwright-core/package.json"));
const NODE_ARGS = ["--disable-warning=ExperimentalWarning"];

const CONTAINER_ROOT = "/selfie";
const CONTAINER_BUILD = `${CONTAINER_ROOT}/build`;
const CONTAINER_OUT = `${CONTAINER_ROOT}/out`;
/** The container has its own loopback, so a fixed port can't collide and stays out of the pixels. */
const CONTAINER_PORT = 6199;

const DOCKER_QUERY_TIMEOUT_MS = 15_000;
const DOCKER_PULL_TIMEOUT_MS = 15 * 60_000;
const KILL_GRACE_MS = 5_000;

function docker(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("docker", args, { timeout: timeoutMs, killSignal: "SIGKILL" }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout);
    });
  });
}

/** Makes sure Docker answers and holds the image, pulling it once if needed. Works offline once pulled. */
export async function ensureImage(runner: ContainerRunner): Promise<void> {
  const { name, digest } = parseImage(runner.image);
  const pinned = `${name}@${digest}`;
  try {
    await docker(["version", "--format", "{{.Server.Version}}"], DOCKER_QUERY_TIMEOUT_MS);
  } catch (error) {
    throw new RenderError(`Docker is unavailable: ${(error as Error).message}`);
  }
  const held = await docker(["image", "inspect", pinned], DOCKER_QUERY_TIMEOUT_MS).then(
    () => true,
    () => false,
  );
  if (held) return;
  try {
    await docker(["pull", "--platform", runner.platform, pinned], DOCKER_PULL_TIMEOUT_MS);
  } catch (error) {
    throw new RenderError(`Can't pull ${pinned}: ${(error as Error).message}`);
  }
}

export interface ContainerMounts {
  buildDir: string;
  outDir: string;
  /** Identifies this run on the container's labels, so a test can find its own. */
  runLabel: string;
  uid?: number | undefined;
  gid?: number | undefined;
}

/** Everything `docker run` gets: no network, no capabilities, no host environment, one writable directory. */
export function containerArgs(
  runner: ContainerRunner,
  containerName: string,
  mounts: ContainerMounts,
): string[] {
  const { name, digest } = parseImage(runner.image);
  // --mount rather than -v, since -v splits on the colons a path may hold. --mount parses as
  // CSV, so a comma in a path needs quoting.
  const source = (dir: string) => (dir.includes(",") ? `"src=${dir.replaceAll('"', '""')}"` : `src=${dir}`);
  const readOnly = (dir: string, target: string) => [
    "--mount",
    `type=bind,${source(dir)},dst=${target},readonly`,
  ];
  return [
    "run",
    "--rm",
    "--init",
    "--interactive",
    "--name",
    containerName,
    "--label",
    `selfie-render=${mounts.runLabel}`,
    "--pull=never",
    "--platform",
    runner.platform,
    "--network=none",
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--shm-size=2g",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    ...(mounts.uid === undefined || mounts.gid === undefined
      ? []
      : ["--user", `${mounts.uid}:${mounts.gid}`]),
    "--env",
    "HOME=/tmp",
    ...readOnly(mounts.buildDir, CONTAINER_BUILD),
    ...readOnly(path.join(PACKAGE_ROOT, "src", "worker"), `${CONTAINER_ROOT}/src/worker`),
    ...readOnly(path.join(PACKAGE_ROOT, "package.json"), `${CONTAINER_ROOT}/package.json`),
    ...readOnly(PLAYWRIGHT_ROOT, `${CONTAINER_ROOT}/node_modules/playwright-core`),
    "--mount",
    `type=bind,${source(mounts.outDir)},dst=${CONTAINER_OUT}`,
    `${name}@${digest}`,
    "node",
    ...NODE_ARGS,
    `${CONTAINER_ROOT}/src/worker/worker.ts`,
  ];
}

export interface WorkerOutcome {
  runtime: WorkerRuntime;
  results: Map<string, WorkerStoryResult>;
  /** Why the worker stopped before reporting every story, if it did. */
  crash: string | null;
}

export interface WorkerRun {
  environment: RenderEnvironment;
  /** Everything but the runner-specific paths and port. */
  job: Omit<WorkerJob, "buildDir" | "outDir" | "port">;
  buildDir: string;
  outDir: string;
  runLabel: string;
  signal?: AbortSignal | undefined;
  onStory?: ((result: WorkerStoryResult) => void) | undefined;
}

/**
 * Runs one worker to its end. Throws a `RenderError` if it never got as far as a browser,
 * since then no story was attempted. After that, a crash is reported in the outcome.
 */
export function runWorker(run: WorkerRun): Promise<WorkerOutcome> {
  const { runner } = run.environment;
  const containerName = `selfie-render-${randomUUID()}`;
  const child =
    runner.kind === "container"
      ? spawn(
          "docker",
          containerArgs(runner, containerName, {
            buildDir: run.buildDir,
            outDir: run.outDir,
            runLabel: run.runLabel,
            uid: process.getuid?.(),
            gid: process.getgid?.(),
          }),
          { stdio: "pipe" },
        )
      : spawn(process.execPath, [...NODE_ARGS, path.join(PACKAGE_ROOT, "src", "worker", "worker.ts")], {
          stdio: "pipe",
        });
  const job: WorkerJob =
    runner.kind === "container"
      ? { ...run.job, buildDir: CONTAINER_BUILD, outDir: CONTAINER_OUT, port: CONTAINER_PORT }
      : { ...run.job, buildDir: run.buildDir, outDir: run.outDir, port: 0 };

  // `rm --force` rather than `kill`, since `--rm` never removes a container that was
  // created but not yet started, which is what an early abort can leave behind.
  const removeContainer = () =>
    runner.kind === "container"
      ? docker(["rm", "--force", containerName], DOCKER_QUERY_TIMEOUT_MS).catch(() => "")
      : Promise.resolve("");
  let stopped = false;
  const stop = () => {
    stopped = true;
    void removeContainer();
    // SIGTERM first, so a native worker's Playwright closes its browser.
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
  };

  return new Promise<WorkerOutcome>((resolve, reject) => {
    const results = new Map<string, WorkerStoryResult>();
    let runtime: WorkerRuntime | undefined;
    let done = false;
    let fatal: string | undefined;
    let mismatch: string | null = null;
    let stderrTail = "";

    // The worker's own deadline is what fires. This one covers a worker that can't.
    const watchdog = setTimeout(
      () => {
        fatal = `worker passed its ${job.runTimeoutMs}ms run timeout`;
        stop();
      },
      job.runTimeoutMs + 2 * KILL_GRACE_MS,
    );
    const onAbort = () => {
      fatal = "aborted";
      stop();
    };
    run.signal?.addEventListener("abort", onAbort, { once: true });
    if (run.signal?.aborted) onAbort();

    createInterface({ input: child.stdout }).on("line", (line) => {
      let event: WorkerEvent;
      try {
        event = JSON.parse(line) as WorkerEvent;
      } catch {
        return;
      }
      if (event.type === "ready") {
        runtime = event.runtime;
        mismatch = runner.kind === "container" ? platformMismatch(runner, event.runtime) : null;
        if (mismatch !== null) stop();
      } else if (event.type === "story") {
        results.set(event.result.id, event.result);
        run.onStory?.(event.result);
      } else if (event.type === "fatal") {
        fatal = event.message;
      } else {
        done = true;
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(job));

    const finish = (exit: string) => {
      clearTimeout(watchdog);
      run.signal?.removeEventListener("abort", onAbort);
      if (run.signal?.aborted) {
        reject(new RenderError("Capture aborted."));
      } else if (mismatch !== null) {
        reject(new RenderError(mismatch));
      } else if (runtime === undefined || (fatal !== undefined && results.size === 0 && !done)) {
        reject(
          new RenderError(
            `The ${runner.kind} worker didn't start: ${fatal ?? exit}${stderrTail ? `\n${stderrTail.trim()}` : ""}`,
          ),
        );
      } else {
        resolve({
          runtime,
          results,
          crash: done ? null : `${fatal ?? exit}${stderrTail ? `: ${stderrTail.trim()}` : ""}`,
        });
      }
    };
    child.once("error", (error) => finish(error.message));
    child.once("close", (code, signal) => {
      // Again now the client is gone, in case it created the container after the first try.
      void (stopped ? removeContainer() : Promise.resolve("")).then(() =>
        finish(`worker exited with ${signal ?? `code ${code}`}`),
      );
    });
  });
}

export function platformMismatch(runner: ContainerRunner, runtime: WorkerRuntime): string | null {
  const [expectedOs, expectedArch] = runner.platform.split("/") as [string, string];
  const arch = expectedArch === "amd64" ? "x64" : expectedArch;
  if (runtime.platform === expectedOs && runtime.arch === arch) return null;
  return `image ${runner.image} runs as ${runtime.platform}/${runtime.arch}, but the environment says ${runner.platform}`;
}
