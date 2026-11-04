// Arguments in, one document and an exit code out. The work is the library's.
import { parseArgs, type ParseArgsConfig } from "node:util";
import type { render } from "selfie-render";
import { resolveRenderSettings, resolveStorybookDir } from "./config.ts";
import { accept, decide } from "./decisions.ts";
import { buildAcceptDocument, buildRenderDocument, buildReviewDocument } from "./document.ts";
import { SelfieError } from "./errors.ts";
import { gitUserEmail, resolveCommit } from "./git.ts";
import { compareAsReviewed, findBaseline, openProject, type Project } from "./project.ts";
import { buildIfAsked, renderBatch, review, replyToNote } from "./review.ts";
import { summarizeBatch } from "./summary.ts";
import { findBaselineWithRemote, pull, push, requireRemote, resolveRemote, type Fetch } from "./sync.ts";
import { isNoteId, isNoteText, MAX_NOTE_CHARACTERS } from "selfie-ui/notes";
import { awaitFeedback, notesForAgent } from "./notes.ts";

const EXIT_OK = 0;
const EXIT_NEEDS_ATTENTION = 1;
const EXIT_COULD_NOT_RUN = 2;
const EXIT_TIMED_OUT = 3;
const EXIT_STOPPED = 130;

const USAGE = `Usage: selfie [--port <n>] [--storybook-dir <dir>] [--native] [--no-build] [--no-open]
       selfie <command>

  With no command, opens every story of a built Storybook, running, to look at and write notes
  on, and serves it until stopped. With no built Storybook yet, the page says what to do. It first runs the
  config's buildCommand, unless --no-build, and opens a browser if it's at a terminal, unless
  --no-open.

  render [--storybook-dir <dir>] [--build | --build-command <cmd>] [--story <pattern>]... [--native]
      Always renders a built Storybook, and records a batch. Prints what it recorded, and judges
      nothing. Exits 0 once a batch is recorded, even with failed stories, or 2 if it couldn't run.

  review [<batch>] [--baseline <commit-or-batch>] [--storybook-dir <dir>] [--build | --build-command <cmd>]
         [--story <pattern>]... [--native]
      Prints a JSON diff of a batch against its baseline. With no <batch>, uses the batch for this
      exact built Storybook, and records one only if there's none yet, so call render first to render
      again. --baseline compares with those goldens or that batch for this review alone, and is
      how to look for flakiness: render twice, then review the second --baseline the first.
      If the default branch has no goldens yet, it compares with the nearest on this branch and
      says so, which accept doesn't rely on. Exits 0 if nothing blocks it, 1 if something does or
      anything differs from a --baseline, 2 if the review couldn't run. Play errors are advisories, and don't change the exit code.

  flakes [--times <n>] [--concurrency <n>] [--storybook-dir <dir>] [--build | --build-command <cmd>]
         [--story <pattern>]... [--native]
      Renders a built Storybook --times times, 3 by default, and prints what wasn't the same each
      time, biggest difference first, with the images to look at. Records no batch and stores
      nothing. Exits 0 if every story held still, 1 if any didn't, 2 if it couldn't run.

  skill <name>
      Prints a guide for a coding agent, in the format of an agent skill. selfie skill quickstart
      sets Selfie up in a repository, and selfie skill fix-flakes makes every story render the same
      way every time.

  approve <batch> (--all | --story <pattern>...) [--actor <who>]
  reject <batch> (--all | --story <pattern>...) [--actor <who>]
      Decides on a batch's changed and added images. Works on a dirty tree.

  accept <batch> [--removed <n>]
      Makes a batch the goldens of its Git SHA. Needs a batch recorded on a clean tree, every
      changed or added image approved, and --removed <n> if the baseline has stories this batch
      lacks.

  find-baseline [--native]
      Prints the nearest SHA at or before the merge-base with complete goldens, or null.

  ui [<batch>] [--port <n>] [--storybook-dir <dir>] [--native]
      Serves the review UI on loopback until stopped, and prints its URL. Opens at this batch, or
      else every story, each with its newest render. It renders only when someone asks it to on
      the page. Opens no browser by itself. Hosts the built Storybook on a port of its own, so a
      story's page links to the real thing.

  notes [--all]
      Prints the open notes a person has sent to an agent from this folder's review UI, each with
      a picture of what it's about, and with --all the resolved ones too. Never their drafts. Each
      worktree's folder has its own notes.

  reply <note> <text> [--batch <batch>]
      Answers a note, on the newest batch recorded from this folder if --batch doesn't say. Prints
      whether the note's image changed in that batch. Only a person closes a note.

  agent-await-feedback [--timeout <seconds>]
      Blocks until a person sends notes from this folder's review UI, and prints them as notes
      does, with what's new marked. While it runs, the UI says an agent is waiting. Exits 0 with
      notes, 3 if --timeout passed first so it's worth asking again, 130 if stopped by a signal, or
      2 if another agent is already waiting here.

  push [<batch>] [--accept] [--remote <url>] [--native]
      Sends a batch to the remote, by default the newest from a clean tree at HEAD, and its goldens
      if it's accepted here or --accept asks, which is what CI uses after render. Needs its commit
      on GitHub. Safe to run again. Exits 1 if its goldens were refused or there's a different batch
      there already.

  pull [<commit>] [--remote <url>] [--native]
      Takes a commit's goldens from the remote, by default the nearest baseline it has, replacing
      any here. Exits 1 if it has none.

Local data lives under ~/.config/selfie/<git-origin-slugified>/, or $SELFIE_HOME instead of
~/.config/selfie. A project configures Selfie in selfie.config.json at its Git top level:
environment, initScript, hunkMergeDistance, storybookDir, which --storybook-dir overrides, and
buildCommand, which only selfie alone and --build run, and which runs from that top level. A story pattern matches IDs, where * matches any batch of characters.
`;

/** What a command reaches the outside through, so tests can supply their own. */
interface Context {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /** Results only: exactly one document per command. */
  readonly stdout: (text: string) => void;
  /** Progress and messages for people. */
  readonly stderr: (text: string) => void;
  /** Opens a page for a person at a terminal. Not set for anything else, such as an agent. */
  readonly openBrowser?: ((url: string) => void) | undefined;
  readonly render?: typeof render;
  readonly signal?: AbortSignal;
  /** Defaults to the built client in `selfie-ui`. */
  readonly uiClientDir?: string;
  /** Defaults to the real one. */
  readonly fetch?: Fetch;
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

function positiveInteger(flag: string, value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new SelfieError("usage", `${flag} must be a positive whole number, got ${value}.`);
  return number;
}

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

/** What says how to get a batch from a built Storybook, for `render` and for a `review` that may need one. */
const BUILD_OPTIONS = {
  "storybook-dir": { type: "string" },
  "build-command": { type: "string" },
  build: { type: "boolean" },
  native: { type: "boolean" },
  story: { type: "string", multiple: true },
} as const;

const SERVING_OPTIONS = {
  port: { type: "string", default: "0" },
  native: { type: "boolean" },
  "storybook-dir": { type: "string" },
} as const;

function portFrom(value: string | undefined): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new SelfieError("usage", `--port must be a port number, got "${value}".`);
  return port;
}

/** Serves the review UI and the hosted Storybook until told to stop, saying where. */
async function serveReview(
  context: Context,
  project: Project,
  options: {
    readonly port: number;
    readonly native: boolean | undefined;
    readonly storybookDir: string | undefined;
    /** Which page to say to open. */
    readonly path: string;
    readonly batchId: string | null;
    /** Run the config's `buildCommand` on the way up, and open a browser. */
    readonly forStories?: { readonly build: boolean; readonly open: boolean };
  },
): Promise<number> {
  const { native, forStories } = options;
  // Only here, so that no other command loads a web server.
  const [{ isBuiltStorybook, serveReviewWithStorybook }, { localReviewSource }] = await Promise.all([import("selfie-ui/local"), import("./ui.ts")]);
  const settings = await resolveRenderSettings(project.repo, { native });
  const dir = resolveStorybookDir(project.cwd, options.storybookDir, settings);
  if (forStories !== undefined) {
    if (forStories.build) await buildIfAsked(settings.buildCommand, project.repo.root, context.signal, (line) => context.stderr(`${line}\n`));
    if (!isBuiltStorybook(dir)) context.stderr(`There's no built Storybook at ${dir} yet. The page says what to do.\n`);
  }
  const servers = await serveReviewWithStorybook({
    source: (url) =>
      localReviewSource(project, {
        native,
        storybook: {
          dir,
          url,
          renderStories: async (stories) =>
            (await renderBatch(project, { storybookDir: dir, native, stories, render: context.render, log: (line) => context.stderr(`${line}\n`) })).batch.id,
        },
      }),
    port: options.port,
    clientDir: context.uiClientDir,
    dir,
    readStorybookFile: (build, file) => project.storybooks.readFile(build, file),
  });
  try {
    const url = `${servers.review.url}${options.path}`;
    printJson(context, { url, port: servers.review.port, batchId: options.batchId, storybookUrl: servers.storybook.url });
    context.stderr(`Serving ${url} until this is stopped.\n`);
    if (forStories?.open === true) context.openBrowser?.(url);
    await stopped(context.signal);
  } finally {
    await servers.close();
  }
  return EXIT_OK;
}

/** What `selfie` alone does: every story of the Storybook, to look at and write notes on. */
function openEveryStory(args: string[], context: Context): Promise<number> {
  const { values, positionals } = parse(args, { ...SERVING_OPTIONS, "no-build": { type: "boolean" }, "no-open": { type: "boolean" } });
  noPositionals("selfie", positionals);
  const port = portFrom(values.port);
  return withProject(context, (project) =>
    serveReview(context, project, {
      port,
      native: values.native,
      storybookDir: values["storybook-dir"],
      path: "",
      batchId: null,
      forStories: { build: values["no-build"] !== true, open: values["no-open"] !== true },
    }),
  );
}

function batchOptionsFrom(values: ReturnType<typeof parse<typeof BUILD_OPTIONS>>["values"], context: Context) {
  return {
    storybookDir: values["storybook-dir"],
    buildCommand: values["build-command"],
    buildFromConfig: values.build,
    native: values.native,
    stories: values.story,
    render: context.render,
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
    case "render": {
      const { values, positionals } = parse(args, BUILD_OPTIONS);
      noPositionals(command, positionals);
      return withProject(context, async (project) => {
        const result = await renderBatch(project, batchOptionsFrom(values, context));
        printTimings(context, result.timings);
        printJson(context, buildRenderDocument(result));
        return EXIT_OK;
      });
    }
    case "flakes": {
      const { values, positionals } = parse(args, { ...BUILD_OPTIONS, times: { type: "string", default: "3" }, concurrency: { type: "string" } });
      noPositionals(command, positionals);
      const times = positiveInteger("--times", values.times);
      if (times < 2) throw new SelfieError("usage", "--times must be at least 2, since a flake is a difference between renders.");
      const concurrency = values.concurrency === undefined ? undefined : positiveInteger("--concurrency", values.concurrency);
      return withProject(context, async (project) => {
        const { findFlakes } = await import("./flakes.ts");
        const report = await findFlakes(project, { ...batchOptionsFrom(values, context), times, concurrency });
        printJson(context, { schemaVersion: 1, ...report });
        return report.flaky.length === 0 ? EXIT_OK : EXIT_NEEDS_ATTENTION;
      });
    }
    case "skill": {
      const { positionals } = parse(args, {});
      const [name, ...extra] = positionals;
      if (name === undefined || extra.length > 0) throw new SelfieError("usage", "Expected one skill name, such as fix-flakes.");
      const { readSkill } = await import("./skills.ts");
      context.stdout(await readSkill(name));
      return EXIT_OK;
    }
    case "review": {
      const { values, positionals } = parse(args, { ...BUILD_OPTIONS, baseline: { type: "string" } });
      const [batch, ...extra] = positionals;
      if (extra.length > 0) throw new SelfieError("usage", "Expected at most one batch ID. A baseline goes in --baseline.");
      if (batch !== undefined) {
        const given = Object.keys(BUILD_OPTIONS).filter((flag) => values[flag as keyof typeof BUILD_OPTIONS] !== undefined);
        if (given.length > 0) {
          throw new SelfieError("usage", `${batch} is already recorded, so --${given.join(", --")} can't apply. Call selfie render first.`);
        }
      }
      return withProject(context, async (project) => {
        const baseline = values.baseline;
        const result = await review(
          project,
          batch === undefined ? { ...batchOptionsFrom(values, context), baseline } : { batch, baseline },
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
      const batchId = onePositional(positionals, "batch ID");
      if (Boolean(values.all) === Boolean(values.story?.length)) {
        throw new SelfieError("usage", "Say which renders: either --all, or one or more --story patterns.");
      }
      return withProject(context, async (project) => {
        const actor = values.actor ?? (await gitUserEmail(project.repo));
        if (actor === null) throw new SelfieError("usage", "No actor: set git config user.email, or pass --actor.");
        const decision = command === "approve" ? "approved" : "rejected";
        const result = await decide(project, { batchId, decision, actor, stories: values.story ?? "all" });
        printJson(context, {
          batchId,
          decision,
          actor,
          decided: result.decided.map(({ story, state, imageHash }) => ({ story, state, imageHash })),
          skipped: result.skipped.map(({ story, state }) => ({ story, state })),
          undecided: summarizeBatch(result.comparison).undecided.map(({ story, state }) => ({ story, state })),
          unmatchedPatterns: result.unmatchedPatterns,
        });
        return result.unmatchedPatterns.length > 0 ? EXIT_NEEDS_ATTENTION : EXIT_OK;
      });
    }
    case "accept": {
      const { values, positionals } = parse(args, { removed: { type: "string" } });
      const batchId = onePositional(positionals, "batch ID");
      const { removed } = values;
      if (removed !== undefined && !/^\d+$/.test(removed)) {
        throw new SelfieError("usage", `--removed must be a non-negative integer, got "${removed}".`);
      }
      return withProject(context, async (project) => {
        const result = await accept(project, {
          batchId,
          removedSeen: removed === undefined ? undefined : Number(removed),
        });
        const document = buildAcceptDocument(result);
        if (document.reusedFromBatch !== null) {
          context.stderr(`This batch's pixels came from the render of batch ${document.reusedFromBatch}.\n`);
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
    case "push": {
      const { values, positionals } = parse(args, { accept: { type: "boolean" }, remote: { type: "string" }, native: { type: "boolean" } });
      const [batch, ...extra] = positionals;
      if (extra.length > 0) throw new SelfieError("usage", "Expected at most one batch ID.");
      const remote = requireRemote(values.remote, context.env, context.fetch);
      return withProject(context, async (project) => {
        const result = await push(project, remote, { batch, accept: values.accept, native: values.native });
        printJson(context, result);
        return result.goldens === null || result.goldens.outcome === "accepted" || result.goldens.outcome === "already" ? EXIT_OK : EXIT_NEEDS_ATTENTION;
      });
    }
    case "pull": {
      const { values, positionals } = parse(args, { remote: { type: "string" }, native: { type: "boolean" } });
      const [commit, ...extra] = positionals;
      if (extra.length > 0) throw new SelfieError("usage", "Expected at most one commit.");
      const remote = requireRemote(values.remote, context.env, context.fetch);
      return withProject(context, async (project) => {
        const sha = commit === undefined ? undefined : await resolveCommit(project.repo, commit);
        if (sha === null) throw new SelfieError("usage", `"${commit}" isn't a commit here.`);
        const result = await pull(project, remote, { commit: sha, native: values.native });
        printJson(context, result);
        return result.batchId === null ? EXIT_NEEDS_ATTENTION : EXIT_OK;
      });
    }
    case "find-baseline": {
      const { values, positionals } = parse(args, { native: { type: "boolean" }, remote: { type: "string" } });
      noPositionals(command, positionals);
      const remote = resolveRemote(values.remote, context.env, context.fetch);
      return withProject(context, async (project) => {
        const { environmentId } = await resolveRenderSettings(project.repo, { native: values.native });
        const found = remote === null ? await findBaseline(project, environmentId) : await findBaselineWithRemote(project, remote, environmentId);
        printJson(context, { ...found, environment: environmentId });
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
      const { values, positionals } = parse(args, { batch: { type: "string" } });
      const [note, text, ...extra] = positionals;
      const id = Number(note);
      if (!isNoteId(id) || !isNoteText(text) || extra.length > 0) {
        throw new SelfieError("usage", `Expected a note number and what to say, in at most ${MAX_NOTE_CHARACTERS} characters: selfie reply 12 "Made it bigger".`);
      }
      return withProject(context, async (project) => {
        printJson(context, await replyToNote(project, id, text, values.batch));
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
      const { values, positionals } = parse(args, SERVING_OPTIONS);
      const [batchId, ...extra] = positionals;
      if (extra.length > 0) throw new SelfieError("usage", "Expected at most one batch ID.");
      const port = portFrom(values.port);
      return withProject(context, async (project) => {
        if (batchId !== undefined) await compareAsReviewed(project, batchId);
        return serveReview(context, project, { port, native: values.native, storybookDir: values["storybook-dir"], path: batchId === undefined ? "" : `batches/${batchId}`, batchId: batchId ?? null });
      });
    }
    default:
      throw new SelfieError(
        "usage",
        `Unknown command "${command}". See selfie --help.`,
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
    if (command === undefined || command.startsWith("-")) return await openEveryStory([...argv], context);
    return await dispatch(command, args, context);
  } catch (error) {
    const { message } = error as Error;
    context.stderr(`selfie: ${message}\n`);
    printJson(context, { error: { code: errorCode(error as Error), message } });
    return EXIT_COULD_NOT_RUN;
  }
}
