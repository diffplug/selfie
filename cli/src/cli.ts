// Arguments in, one document and an exit code out. The work is the library's.
import { parseArgs, type ParseArgsConfig } from "node:util";
import type { capture } from "selfie-render";
import { resolveCaptureSettings } from "./config.ts";
import { accept, decide } from "./decisions.ts";
import { buildAcceptDocument, buildReviewDocument } from "./document.ts";
import { SelfieError } from "./errors.ts";
import { gitUserEmail } from "./git.ts";
import { compareAsReviewed, findBaseline, openProject, type Project } from "./project.ts";
import { review } from "./review.ts";
import { summarizeRun } from "./summary.ts";

const EXIT_OK = 0;
const EXIT_NEEDS_ATTENTION = 1;
const EXIT_COULD_NOT_RUN = 2;

const USAGE = `Usage: selfie <command>

  review [--storybook-dir <dir>] [--build-command <cmd>] [--story <pattern>]... [--native] [--stability] [--no-reuse]
      Renders a built Storybook, records a run, and prints a JSON diff against the baseline. If
      this exact build already rendered, reuses those images and names that run in reusedFromRun,
      unless --no-reuse.
      Exits 0 if nothing blocks it, 1 if something does, 2 if the review couldn't run. Play
      errors and unstable stories are advisories, and don't change the exit code.

  approve <run> (--all | --story <pattern>...) [--actor <who>]
  reject <run> (--all | --story <pattern>...) [--actor <who>]
      Decides on a run's changed and new images. Works on a dirty tree.

  accept <run> [--removed <n>]
      Makes a run the goldens of its Git SHA. Needs a run recorded on a clean tree, every
      changed or new image approved, and --removed <n> if the baseline has stories this run
      lacks.

  find-baseline [--native]
      Prints the nearest SHA at or before the merge-base with complete goldens, or null.

  ui [<run>] [--port <n>] [--native]
      Serves the review UI on loopback until stopped, and prints its URL. Opens at this run, or
      else the newest at HEAD. It shows what selfie review recorded, and never renders. Opens no
      browser by itself.

Local data lives under ~/.config/selfie/<git-origin-slugified>/, or $SELFIE_HOME instead of
~/.config/selfie. A project configures Selfie in selfie.config.json at its Git top level. A
story pattern matches IDs, where * matches any run of characters.
`;

/** What a command reaches the outside through, so tests can supply their own. */
interface Context {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /** Results only: exactly one document per command. */
  readonly stdout: (text: string) => void;
  /** Progress and messages for people. */
  readonly stderr: (text: string) => void;
  readonly capture?: typeof capture;
  readonly signal?: AbortSignal;
  /** Defaults to the built client in `selfie-ui`. */
  readonly uiClientDir?: string;
}

const printJson = (context: Context, document: unknown) => context.stdout(`${JSON.stringify(document, null, 2)}\n`);

/** Until the signal says to stop. */
const stopped = (signal: AbortSignal | undefined) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) resolve();
    signal?.addEventListener("abort", () => resolve(), { once: true });
  });

const parse = <Options extends NonNullable<ParseArgsConfig["options"]>>(args: string[], options: Options) => {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new SelfieError("usage", (error as Error).message);
  }
};

function noPositionals(command: string, positionals: readonly string[]): void {
  if (positionals.length > 0) throw new SelfieError("usage", `${command} takes no arguments, got "${positionals[0]}".`);
}

function onePositional(positionals: readonly string[], what: string): string {
  const [first, ...rest] = positionals;
  if (first === undefined || rest.length > 0) throw new SelfieError("usage", `Expected exactly one ${what}.`);
  return first;
}

async function withProject(context: Context, work: (project: Project) => Promise<number>): Promise<number> {
  const project = await openProject({ cwd: context.cwd, env: context.env });
  try {
    return await work(project);
  } finally {
    project.close();
  }
}

async function dispatch(command: string | undefined, args: string[], context: Context): Promise<number> {
  switch (command) {
    case "review": {
      const { values, positionals } = parse(args, {
        "storybook-dir": { type: "string", default: "storybook-static" },
        "build-command": { type: "string" },
        native: { type: "boolean" },
        story: { type: "string", multiple: true },
        stability: { type: "boolean" },
        "no-reuse": { type: "boolean" },
      });
      noPositionals(command, positionals);
      return withProject(context, async (project) => {
        const result = await review(project, {
          storybookDir: values["storybook-dir"] as string,
          buildCommand: values["build-command"],
          native: values.native,
          stories: values.story,
          stability: values.stability,
          reuse: !values["no-reuse"],
          capture: context.capture,
          signal: context.signal,
          log: (line) => context.stderr(`${line}\n`),
        });
        const { captureMs, storeMs, compareMs, diffMs, totalMs } = result.timings;
        context.stderr(
          `Timings: capture ${captureMs} ms, store ${storeMs} ms, compare ${compareMs} ms, diff ${diffMs} ms, total ${totalMs} ms\n`,
        );
        const document = buildReviewDocument(result);
        printJson(context, document);
        return document.blockers.length > 0 ? EXIT_NEEDS_ATTENTION : EXIT_OK;
      });
    }
    case "approve":
    case "reject": {
      const { values, positionals } = parse(args, {
        all: { type: "boolean" },
        story: { type: "string", multiple: true },
        actor: { type: "string" },
      });
      const runId = onePositional(positionals, "run ID");
      if (Boolean(values.all) === Boolean(values.story?.length)) {
        throw new SelfieError("usage", "Say which snapshots: either --all, or one or more --story patterns.");
      }
      return withProject(context, async (project) => {
        const actor = values.actor ?? (await gitUserEmail(project.repo));
        if (actor === null) throw new SelfieError("usage", "No actor: set git config user.email, or pass --actor.");
        const decision = command === "approve" ? "approved" : "rejected";
        const result = await decide(project, { runId, decision, actor, stories: values.story ?? "all" });
        printJson(context, {
          runId,
          decision,
          actor,
          decided: result.decided.map(({ story, state, imageHash }) => ({ story, state, imageHash })),
          skipped: result.skipped.map(({ story, state }) => ({ story, state })),
          undecided: summarizeRun(result.comparison).undecided.map(({ story, state }) => ({ story, state })),
          unmatchedPatterns: result.unmatchedPatterns,
        });
        return result.unmatchedPatterns.length > 0 ? EXIT_NEEDS_ATTENTION : EXIT_OK;
      });
    }
    case "accept": {
      const { values, positionals } = parse(args, { removed: { type: "string" } });
      const runId = onePositional(positionals, "run ID");
      const { removed } = values;
      if (removed !== undefined && !/^\d+$/.test(removed)) {
        throw new SelfieError("usage", `--removed must be a non-negative integer, got "${removed}".`);
      }
      return withProject(context, async (project) => {
        const result = await accept(project, {
          runId,
          removedSeen: removed === undefined ? undefined : Number(removed),
        });
        const document = buildAcceptDocument(result);
        if (document.reusedFromRun !== null) {
          context.stderr(`This run's pixels came from the render of run ${document.reusedFromRun}.\n`);
        }
        if (!result.accepted) {
          const reasons = document.refusals.map(({ message }) => `  ${message}`).join("\n");
          context.stderr(`Not accepted:\n${reasons}\n`);
        } else if (!result.usableAsBaseline) {
          context.stderr(
            `Accepted, but ${document.gitSha} isn't on the default branch's first-parent history, so later reviews won't read these goldens.\n`,
          );
        }
        printJson(context, document);
        return result.accepted ? EXIT_OK : EXIT_NEEDS_ATTENTION;
      });
    }
    case "find-baseline": {
      const { values, positionals } = parse(args, { native: { type: "boolean" } });
      noPositionals(command, positionals);
      return withProject(context, async (project) => {
        const { environmentId } = await resolveCaptureSettings(project.repo, { native: values.native });
        printJson(context, { ...(await findBaseline(project, environmentId)), environment: environmentId });
        return EXIT_OK;
      });
    }
    case "ui": {
      const { values, positionals } = parse(args, {
        port: { type: "string", default: "0" },
        native: { type: "boolean" },
      });
      const [runId, ...extra] = positionals;
      if (extra.length > 0) throw new SelfieError("usage", "Expected at most one run ID.");
      const port = Number(values.port);
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new SelfieError("usage", `--port must be a port number, got "${values.port}".`);
      }
      return withProject(context, async (project) => {
        if (runId !== undefined) await compareAsReviewed(project, runId);
        // Only here, so that no other command loads a web server.
        const [{ serveLocal }, { localReviewSource }] = await Promise.all([import("selfie-ui/local"), import("./ui.ts")]);
        const server = await serveLocal({
          source: localReviewSource(project, { native: values.native }),
          port,
          ...(context.uiClientDir === undefined ? {} : { clientDir: context.uiClientDir }),
        });
        try {
          printJson(context, {
            url: runId === undefined ? server.url : `${server.url}runs/${runId}`,
            port: server.port,
            runId: runId ?? null,
          });
          context.stderr("Serving the review UI until this is stopped.\n");
          await stopped(context.signal);
        } finally {
          await server.close();
        }
        return EXIT_OK;
      });
    }
    default:
      throw new SelfieError(
        "usage",
        command === undefined ? "No command given." : `Unknown command "${command}". See selfie --help.`,
      );
  }
}

/** A code for whatever went wrong: its own, if it has one, or else its name. */
function errorCode(error: Error): string {
  return "code" in error && typeof error.code === "string" ? error.code : error.name;
}

/** Runs one command to its exit code. Whatever goes wrong still prints one JSON document. */
export async function runCli(argv: readonly string[], context: Context): Promise<number> {
  const [command, ...args] = argv;
  if (command === "--help" || command === "-h" || command === "help") {
    context.stdout(USAGE);
    return EXIT_OK;
  }
  try {
    return await dispatch(command, args, context);
  } catch (error) {
    const { message } = error as Error;
    context.stderr(`selfie: ${message}\n`);
    printJson(context, { error: { code: errorCode(error as Error), message } });
    return EXIT_COULD_NOT_RUN;
  }
}
