#!/usr/bin/env node
// Stdout is always exactly one JSON document. Human progress goes to stderr.
// Exit codes: 0 everything rendered (and stable), 1 the run finished but a story failed,
// was unstable, or none were selected, 2 the run couldn't happen or the usage was wrong.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  capture,
  defineEnvironment,
  environmentId,
  MANIFEST_FILE,
  type EnvironmentOverrides,
  type RenderEnvironment,
} from "./index.ts";

const USAGE = `Usage:
  selfie-render capture <storybook-dir> --out <dir> [options]
  selfie-render environment [--native] [--environment <file>]

Options for capture:
  --story <pattern>       Story ID pattern, * is a wildcard. Repeatable. Default: all.
  --stories-file <file>   Story ID patterns, one per line.
  --stability             Render twice and flag stories whose PNG differs.
  --concurrency <n>       Stories rendered at once. Default: CPUs, at most 4.
  --story-timeout-ms <n>  Bound on one story. Default: 60000.
  --init-script <file>    JavaScript to run before story code loads.
  --init-css <file>       CSS to add before story code loads.

Environment:
  --native                Use this machine instead of the container. For experiments only.
  --environment <file>    JSON overrides of the default environment.
`;

class UsageError extends Error {}

const OPTIONS = {
  out: { type: "string" },
  story: { type: "string", multiple: true },
  "stories-file": { type: "string" },
  stability: { type: "boolean" },
  concurrency: { type: "string" },
  "story-timeout-ms": { type: "string" },
  "init-script": { type: "string" },
  "init-css": { type: "string" },
  native: { type: "boolean" },
  environment: { type: "string" },
  help: { type: "boolean" },
} as const;

async function loadEnvironment(
  file: string | undefined,
  native: boolean | undefined,
): Promise<RenderEnvironment> {
  const overrides =
    file === undefined ? {} : (JSON.parse(await readFile(file, "utf8")) as EnvironmentOverrides);
  return defineEnvironment(native ? { ...overrides, runner: { kind: "native" } } : overrides);
}

function integerOption(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new UsageError(`--${name} must be an integer, got "${value}".`);
  return parsed;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({ options: OPTIONS, allowPositionals: true });
  const [command, ...rest] = positionals;
  if (values.help || command === undefined) {
    process.stderr.write(USAGE);
    return values.help ? 0 : 2;
  }

  if (command === "environment") {
    const environment = await loadEnvironment(values.environment, values.native);
    process.stdout.write(`${JSON.stringify({ environmentId: environmentId(environment), environment })}\n`);
    return 0;
  }
  if (command !== "capture") throw new UsageError(`Unknown command "${command}".`);

  const [storybookDir] = rest;
  if (storybookDir === undefined || values.out === undefined)
    throw new UsageError("capture needs a Storybook directory and --out.");
  const fromFile =
    values["stories-file"] === undefined
      ? []
      : (await readFile(values["stories-file"], "utf8"))
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
  const patterns = [...(values.story ?? []), ...fromFile];

  const concurrency = integerOption("concurrency", values.concurrency);
  const storyTimeoutMs = integerOption("story-timeout-ms", values["story-timeout-ms"]);
  const abort = new AbortController();
  process.once("SIGINT", () => abort.abort());
  process.once("SIGTERM", () => abort.abort());

  const manifest = await capture({
    storybookDir,
    outDir: values.out,
    environment: await loadEnvironment(values.environment, values.native),
    ...(patterns.length > 0 ? { stories: patterns } : {}),
    ...(values.stability ? { stability: true } : {}),
    ...(concurrency === undefined ? {} : { concurrency }),
    ...(storyTimeoutMs === undefined ? {} : { storyTimeoutMs }),
    ...(values["init-script"] === undefined
      ? {}
      : { initScript: await readFile(values["init-script"], "utf8") }),
    ...(values["init-css"] === undefined ? {} : { initCss: await readFile(values["init-css"], "utf8") }),
    signal: abort.signal,
  });
  process.stdout.write(
    `${JSON.stringify({
      manifest: path.resolve(values.out, MANIFEST_FILE),
      environmentId: manifest.environmentId,
      totals: manifest.totals,
      warnings: manifest.warnings,
    })}\n`,
  );
  const { stories, failed, unstable } = manifest.totals;
  return stories === 0 || failed > 0 || unstable > 0 ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stdout.write(
      `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`,
    );
    process.exitCode = 2;
  },
);
