import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineEnvironment, environmentId, type EnvironmentOverrides, type RenderEnvironment } from "selfie-render";
import type { Repo } from "./git.ts";
import { CliError } from "./output.ts";
import { resolveInside } from "./paths.ts";

/** Found at the Git top level unless `--config` names another. */
const DEFAULT_CONFIG_FILE = "selfie.config.json";
const KNOWN_KEYS = new Set(["environment", "initScript"]);

// There is deliberately no build command here: a checked-out repository must not be able to
// run a shell through a file, only someone passing `--build-command` can.
interface ProjectConfig {
  readonly environment?: EnvironmentOverrides;
  /** A file path, relative to this config file. */
  readonly initScript?: string;
}

export interface EnvironmentFlags {
  readonly config?: string | undefined;
  readonly native?: boolean | undefined;
}

async function readText(file: string, what: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    throw new CliError(`Can't read ${what} at ${file}: ${(error as Error).message}`);
  }
}

async function loadConfig(
  flags: EnvironmentFlags,
  cwd: string,
  repo: Repo,
): Promise<{ config: ProjectConfig; directory: string }> {
  const named = flags.config === undefined ? null : path.resolve(cwd, flags.config);
  const file = named ?? path.join(repo.root, DEFAULT_CONFIG_FILE);
  let text: string;
  if (named === null) {
    const found = await readFile(file, "utf8").catch(() => null);
    if (found === null) return { config: {}, directory: repo.root };
    text = found;
  } else {
    text = await readText(file, "a config file");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CliError(`${file} isn't valid JSON: ${(error as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError(`${file} must hold a JSON object.`);
  }
  for (const key of Object.keys(parsed)) {
    if (!KNOWN_KEYS.has(key)) throw new CliError(`${file} has an unknown key "${key}".`);
  }
  return { config: parsed as ProjectConfig, directory: path.dirname(file) };
}

export interface CaptureSettings {
  readonly environment: RenderEnvironment;
  readonly environmentId: string;
  readonly initScript?: string;
}

/** The environment and init script a command uses: the pinned default, then the config, then flags. */
export async function resolveCaptureSettings(
  flags: EnvironmentFlags & { readonly initScript?: string | undefined },
  cwd: string,
  repo: Repo,
): Promise<CaptureSettings> {
  const { config, directory } = await loadConfig(flags, cwd, repo);
  const overrides: EnvironmentOverrides = {
    ...config.environment,
    ...(flags.native ? { runner: { kind: "native" as const } } : {}),
  };
  const environment = defineEnvironment(overrides);

  // The flag is the user's choice, but a config file arrives with a checkout, so it stays home.
  let scriptFile: string | null = null;
  if (flags.initScript !== undefined) {
    scriptFile = path.resolve(cwd, flags.initScript);
  } else if (config.initScript !== undefined) {
    scriptFile = resolveInside(directory, config.initScript);
    if (scriptFile === null) throw new CliError(`The config's initScript must be inside ${directory}.`);
  }
  return {
    environment,
    environmentId: environmentId(environment),
    ...(scriptFile === null ? {} : { initScript: await readText(scriptFile, "an init script") }),
  };
}
