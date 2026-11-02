import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineEnvironment, environmentId, type EnvironmentOverrides, type RenderEnvironment } from "selfie-render";
import { SelfieError } from "./errors.ts";
import type { Repo } from "./git.ts";
import { resolveInside } from "./paths.ts";

/** At the Git top level. It's the only place a project configures Selfie. */
const CONFIG_FILE = "selfie.config.json";
const KNOWN_KEYS = new Set(["environment", "initScript", "reuse"]);

// There is deliberately no build command here: a checked-out repository must not be able to
// run a shell through a file, only someone passing `--build-command` can.
interface ProjectConfig {
  readonly environment?: EnvironmentOverrides;
  /** A file path, inside the Git top level. */
  readonly initScript?: string;
  /** False always renders. */
  readonly reuse?: boolean;
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
  const { reuse } = parsed as ProjectConfig;
  if (reuse !== undefined && typeof reuse !== "boolean") {
    throw new SelfieError("bad-config", `${file}'s "reuse" must be true or false.`);
  }
  return parsed as ProjectConfig;
}

export interface CaptureSettings {
  readonly environment: RenderEnvironment;
  readonly environmentId: string;
  readonly initScript?: string;
  readonly reuse: boolean;
}

/** The environment and init script a project uses: the pinned default, then its config. */
export async function resolveCaptureSettings(
  repo: Repo,
  { native = false }: { readonly native?: boolean | undefined } = {},
): Promise<CaptureSettings> {
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
  return {
    environment,
    environmentId: environmentId(environment),
    reuse: config.reuse ?? true,
    ...(initScript === undefined ? {} : { initScript }),
  };
}
