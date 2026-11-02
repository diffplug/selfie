import { parseArgs, type ParseArgsConfig } from "node:util";
import { resolveCaptureSettings } from "./config.ts";
import { acceptCommand, decideCommand } from "./decisions.ts";
import { DEFAULT_MAX_COMMITS, findBaseline } from "./git.ts";
import { CliError, EXIT_COULD_NOT_RUN, EXIT_OK, printJson, type Context } from "./output.ts";
import { openProject } from "./project.ts";
import { reviewCommand } from "./review.ts";

const USAGE = `Usage: selfie <command>

  review [--storybook-dir <dir>] [--build-command <cmd>] [--story <pattern>]...
         [--init-script <file>] [--config <file>] [--native] [--stability] [--human]
      Renders a built Storybook, records a run, and prints a JSON diff against the baseline.
      Exits 0 if nothing needs attention, 1 if something does, 2 if the review couldn't run.

  approve <run> (--all | --story <pattern>...) [--actor <who>]
  reject <run> (--all | --story <pattern>...) [--actor <who>]
      Decides on a run's changed and new images. Works on a dirty tree.

  accept <run> [--removed <n>]
      Makes a run the goldens of its Git SHA. Needs a clean tree and a run recorded on one,
      every changed or new image approved, and --removed <n> if the baseline has stories this
      run lacks.

  find-baseline [--config <file>] [--native] [--max-commits <n>]
      Prints the nearest SHA at or before the merge-base with complete goldens, or null.

Local data lives under ~/.config/selfie/<git-origin-slugified>/, or $SELFIE_HOME instead of
~/.config/selfie. A story pattern matches IDs, where * matches any run of characters.
`;

const parse = <Options extends NonNullable<ParseArgsConfig["options"]>>(args: string[], options: Options) => {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new CliError((error as Error).message);
  }
};

function onePositional(positionals: readonly string[], what: string): string {
  const [first, ...rest] = positionals;
  if (first === undefined || rest.length > 0) throw new CliError(`Expected exactly one ${what}.`);
  return first;
}

function nonNegativeInteger(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new CliError(`${flag} must be a non-negative integer, got "${value}".`);
  return Number(value);
}

async function dispatch(command: string | undefined, args: string[], context: Context): Promise<number> {
  switch (command) {
    case "review": {
      const { values, positionals } = parse(args, {
        "storybook-dir": { type: "string", default: "storybook-static" },
        "build-command": { type: "string" },
        config: { type: "string" },
        native: { type: "boolean" },
        story: { type: "string", multiple: true },
        "init-script": { type: "string" },
        stability: { type: "boolean" },
        human: { type: "boolean" },
      });
      if (positionals.length > 0) throw new CliError(`review takes no arguments, got "${positionals[0]}".`);
      return reviewCommand(
        {
          storybookDir: values["storybook-dir"] as string,
          buildCommand: values["build-command"],
          config: values.config,
          native: values.native,
          story: values.story,
          initScript: values["init-script"],
          stability: values.stability,
          human: values.human,
        },
        context,
      );
    }
    case "approve":
    case "reject": {
      const { values, positionals } = parse(args, {
        all: { type: "boolean" },
        story: { type: "string", multiple: true },
        actor: { type: "string" },
      });
      return decideCommand(
        {
          run: onePositional(positionals, "run ID"),
          decision: command === "approve" ? "approved" : "rejected",
          all: values.all,
          story: values.story,
          actor: values.actor,
        },
        context,
      );
    }
    case "accept": {
      const { values, positionals } = parse(args, { removed: { type: "string" } });
      return acceptCommand(
        { run: onePositional(positionals, "run ID"), removed: nonNegativeInteger(values.removed, "--removed") },
        context,
      );
    }
    case "find-baseline": {
      const { values, positionals } = parse(args, {
        config: { type: "string" },
        native: { type: "boolean" },
        "max-commits": { type: "string" },
      });
      if (positionals.length > 0) throw new CliError(`find-baseline takes no arguments, got "${positionals[0]}".`);
      const maxCommits = nonNegativeInteger(values["max-commits"], "--max-commits") ?? DEFAULT_MAX_COMMITS;
      if (maxCommits === 0) throw new CliError("--max-commits must be at least 1.");
      const project = await openProject(context);
      try {
        const { environmentId } = await resolveCaptureSettings(values, context.cwd, project.repo);
        const found = await findBaseline(
          project.repo,
          environmentId,
          (sha) => project.snapshots.hasCompleteGoldens(sha, environmentId),
          maxCommits,
        );
        printJson(context, found);
        return EXIT_OK;
      } finally {
        project.close();
      }
    }
    default:
      throw new CliError(
        command === undefined ? "No command given." : `Unknown command "${command}". See selfie --help.`,
      );
  }
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
    const { name, message } = error as Error;
    context.stderr(`selfie: ${message}\n`);
    printJson(context, { error: { name, message } });
    return EXIT_COULD_NOT_RUN;
  }
}
