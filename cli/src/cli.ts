// Arguments in, one document and an exit code out. The work is the library's.
import { parseArgs, type ParseArgsConfig } from "node:util";
import type { capture } from "selfie-render";
import { resolveCaptureSettings } from "./config.ts";
import { accept, decide } from "./decisions.ts";
import { buildAcceptDocument, buildRecordDocument, buildReviewDocument } from "./document.ts";
import { SelfieError } from "./errors.ts";
import { gitUserEmail } from "./git.ts";
import { compareAsReviewed, findBaseline, openProject, type Project } from "./project.ts";
import { record, review, replyToNote } from "./review.ts";
import { summarizeRun } from "./summary.ts";
import { isNoteId, isNoteText, MAX_NOTE_CHARACTERS } from "selfie-ui/notes";
import { awaitFeedback, notesForAgent } from "./notes.ts";

const EXIT_OK = 0;
const EXIT_NEEDS_ATTENTION = 1;
const EXIT_COULD_NOT_RUN = 2;
const EXIT_TIMED_OUT = 3;
const EXIT_STOPPED = 130;

const USAGE = `Usage: selfie <command>

  record [--storybook-dir <dir>] [--build-command <cmd>] [--story <pattern>]... [--native]
      Always renders a built Storybook, and records a run. Prints what it recorded, and judges
      nothing. Exits 0 once a run is recorded, even with failed stories, or 2 if it couldn't run.

  review [<run>] [--baseline <commit-or-run>] [--storybook-dir <dir>] [--build-command <cmd>]
         [--story <pattern>]... [--native]
      Prints a JSON diff of a run against its baseline. With no <run>, uses the run for this
      exact build, and records one only if there's none yet, so call record first to render
      again. --baseline compares with those goldens or that run for this review alone, and is
      how to look for flakiness: record twice, then review the second --baseline the first.
      If the default branch has no goldens yet, it compares with the nearest on this branch and
      says so, which accept doesn't rely on. Exits 0 if nothing blocks it, 1 if something does or
      anything differs from a --baseline, 2 if the review couldn't run. Play errors are advisories, and don't change the exit code.

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
      else the newest at HEAD. It shows what's recorded, and never renders. Opens no
      browser by itself.

  notes [--all]
      Prints the open notes a person has sent to an agent from this folder's review UI, each with
      a picture of what it's about, and with --all the resolved ones too. Never their drafts. Each
      worktree's folder has its own notes.

  reply <note> <text> [--run <run>]
      Answers a note, on the newest run recorded from this folder if --run doesn't say. Prints
      whether the note's image changed in that run. Only a person closes a note.

  agent-await-feedback [--timeout <seconds>]
      Blocks until a person sends notes from this folder's review UI, and prints them as notes
      does, with what's new marked. While it runs, the UI says an agent is waiting. Exits 0 with
      notes, 3 if --timeout passed first so it's worth asking again, 130 if stopped by a signal, or
      2 if another agent is already waiting here.

Local data lives under ~/.config/selfie/<git-origin-slugified>/, or $SELFIE_HOME instead of
~/.config/selfie. A project configures Selfie in selfie.config.json at its Git top level:
environment, initScript, regionMergeDistance, and storybookDir, which --storybook-dir overrides. A build command
is never read from a file. A story pattern matches IDs, where * matches any run of characters.
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

/** What says how to get a run from a build, for `record` and for a `review` that may need one. */
const BUILD_OPTIONS = {
  "storybook-dir": { type: "string" },
  "build-command": { type: "string" },
  native: { type: "boolean" },
  story: { type: "string", multiple: true },
} as const;

function recordOptions(values: ReturnType<typeof parse<typeof BUILD_OPTIONS>>["values"], context: Context) {
  return {
    storybookDir: values["storybook-dir"],
    buildCommand: values["build-command"],
    native: values.native,
    stories: values.story,
    capture: context.capture,
    signal: context.signal,
    log: (line: string) => context.stderr(`${line}\n`),
  };
}

function printTimings(context: Context, timings: Readonly<Record<string, number>>): void {
  const phases = Object.entries(timings).map(([phase, ms]) => `${phase.replace(/Ms$/, "")} ${ms} ms`);
  context.stderr(`Timings: ${phases.join(", ")}\n`);
}

async function dispatch(command: string | undefined, args: string[], context: Context): Promise<number> {
  switch (command) {
    case "record": {
      const { values, positionals } = parse(args, BUILD_OPTIONS);
      noPositionals(command, positionals);
      return withProject(context, async (project) => {
        const result = await record(project, recordOptions(values, context));
        printTimings(context, result.timings);
        printJson(context, buildRecordDocument(result));
        return EXIT_OK;
      });
    }
    case "review": {
      const { values, positionals } = parse(args, { ...BUILD_OPTIONS, baseline: { type: "string" } });
      const [run, ...extra] = positionals;
      if (extra.length > 0) throw new SelfieError("usage", "Expected at most one run ID. A baseline goes in --baseline.");
      if (run !== undefined) {
        const given = Object.keys(BUILD_OPTIONS).filter((flag) => values[flag as keyof typeof BUILD_OPTIONS] !== undefined);
        if (given.length > 0) {
          throw new SelfieError("usage", `${run} is already recorded, so --${given.join(", --")} can't apply. Call selfie record first.`);
        }
      }
      return withProject(context, async (project) => {
        const baseline = values.baseline;
        const result = await review(
          project,
          run === undefined ? { ...recordOptions(values, context), baseline } : { run, baseline },
        );
        printTimings(context, result.timings);
        const document = buildReviewDocument(result);
        printJson(context, document);
        const differs = result.given !== null && document.differences.length > 0;
        return document.blockers.length > 0 || differs ? EXIT_NEEDS_ATTENTION : EXIT_OK;
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
            `Accepted. ${document.gitSha} isn't on the default branch's first-parent history, so only later reviews on this branch will compare with these goldens.\n`,
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
    case "notes": {
      const { values, positionals } = parse(args, { all: { type: "boolean" } });
      noPositionals(command, positionals);
      return withProject(context, async (project) => {
        printJson(context, await notesForAgent(project, { all: values.all ?? false }));
        return EXIT_OK;
      });
    }
    case "reply": {
      const { values, positionals } = parse(args, { run: { type: "string" } });
      const [note, text, ...extra] = positionals;
      const id = Number(note);
      if (!isNoteId(id) || !isNoteText(text) || extra.length > 0) {
        throw new SelfieError("usage", `Expected a note number and what to say, in at most ${MAX_NOTE_CHARACTERS} characters: selfie reply 12 "Made it bigger".`);
      }
      return withProject(context, async (project) => {
        printJson(context, await replyToNote(project, id, text, values.run));
        return EXIT_OK;
      });
    }
    case "agent-await-feedback": {
      const { values, positionals } = parse(args, { timeout: { type: "string" } });
      noPositionals(command, positionals);
      const seconds = values.timeout === undefined ? Infinity : Number(values.timeout);
      if (values.timeout !== undefined && !(Number.isFinite(seconds) && seconds >= 0)) {
        throw new SelfieError("usage", `--timeout must be a number of seconds, got "${values.timeout}".`);
      }
      return withProject(context, async (project) => {
        context.stderr("Waiting for feedback. The review UI now offers Send to agent.\n");
        const result = await awaitFeedback(project, { timeoutMs: seconds * 1000, signal: context.signal });
        printJson(context, result);
        return result.outcome === "notes" ? EXIT_OK : result.outcome === "timed-out" ? EXIT_TIMED_OUT : EXIT_STOPPED;
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
