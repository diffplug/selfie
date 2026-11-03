import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineEnvironment, environmentId, type EnvironmentOverrides, type RenderEnvironment } from "selfie-render";
import { SelfieError } from "./errors.ts";
import type { Repo } from "./git.ts";
import { resolveInside } from "./paths.ts";

/** At the Git top level. It's the only place a project configures Selfie. */
const CONFIG_FILE = "selfie.config.json";
const KNOWN_KEYS = new Set(["environment", "initScript", "storybookDir", "buildCommand", "regionMergeDistance"]);

// Never a build command: docs/specs/cli.md → Configuration.
interface ProjectConfig {
  readonly environment?: EnvironmentOverrides;
  /** A file path, inside the Git top level. */
  readonly initScript?: string;
  /** A directory path, inside the Git top level. */
  readonly storybookDir?: string;
  readonly buildCommand?: string;
  /** In CSS pixels. Only groups what's shown. */
  readonly regionMergeDistance?: number;
}

async function loadConfig(repo: Repo): Promise<ProjectConfig> {
  const file = path.join(repo.root, CONFIG_FILE);
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SelfieError("bad-config", `${file} isn't valid JSON: ${(error as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SelfieError("bad-config", `${file} must hold a JSON object.`);
  }
  for (const key of Object.keys(parsed)) {
    if (!KNOWN_KEYS.has(key)) throw new SelfieError("bad-config", `${file} has an unknown key "${key}".`);
  }
  return parsed as ProjectConfig;
}

export interface RenderSettings {
  readonly environment: RenderEnvironment;
  readonly environmentId: string;
  readonly initScript?: string;
  /** Absolute, if the config names one. */
  readonly storybookDir?: string;
  /** How this project builds its Storybook, run from the Git top level, only when a person asks. */
  readonly buildCommand?: string;
}

/** The build a command means: the flag, relative to where it ran, then the config's, then the default. */
export const resolveStorybookDir = (cwd: string, given: string | undefined, { storybookDir }: Pick<RenderSettings, "storybookDir">): string =>
  path.resolve(cwd, given ?? storybookDir ?? "storybook-static");

/** The environment, init script, and Storybook a project uses: the pinned default, then its config. */
export async function resolveRenderSettings(
  repo: Repo,
  { native = false }: { readonly native?: boolean | undefined } = {},
): Promise<RenderSettings> {
  const config = await loadConfig(repo);
  const environment = defineEnvironment({
    ...config.environment,
    ...(native ? { runner: { kind: "native" as const } } : {}),
  });

  let initScript: string | undefined;
  if (config.initScript !== undefined) {
    // A config file arrives with a checkout, so it stays home.
    const file = resolveInside(repo.root, config.initScript);
    if (file === null) throw new SelfieError("bad-config", `The config's initScript must be inside ${repo.root}.`);
    try {
      initScript = await readFile(file, "utf8");
    } catch (error) {
      throw new SelfieError("bad-config", `Can't read the init script at ${file}: ${(error as Error).message}`);
    }
  }
  let storybookDir: string | undefined;
  if (config.storybookDir !== undefined) {
    const inside = resolveInside(repo.root, config.storybookDir);
    if (inside === null) throw new SelfieError("bad-config", `The config's storybookDir must be inside ${repo.root}.`);
    storybookDir = inside;
  }
  if (config.buildCommand !== undefined && (typeof config.buildCommand !== "string" || config.buildCommand.trim() === "")) {
    throw new SelfieError("bad-config", "The config's buildCommand must be a command to run.");
  }
  return {
    environment,
    environmentId: environmentId(environment),
    ...(initScript === undefined ? {} : { initScript }),
    ...(storybookDir === undefined ? {} : { storybookDir }),
    ...(config.buildCommand === undefined ? {} : { buildCommand: config.buildCommand }),
  };
}

/** How close changed regions group, in CSS pixels. A view multiplies it by its run's scale. */
export async function resolveRegionMergeDistance(repo: Repo): Promise<number> {
  const distance = (await loadConfig(repo)).regionMergeDistance ?? 12;
  if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0) {
    throw new SelfieError("bad-config", `The config's regionMergeDistance must be a non-negative number, got ${distance}.`);
  }
  return distance;
}
