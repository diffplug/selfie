import { createHash } from "node:crypto";
import os from "node:os";
import { DEFAULT_RECIPE, PLAYWRIGHT_VERSION, type RecipeOverrides, type RenderRecipe } from "./worker/protocol.ts";

const DEFAULT_IMAGE =
  "mcr.microsoft.com/playwright@sha256:a0f4498920a5dbac63196d9140ed738ef00470f27e2e74029abd8850b7bd5717";
const DEFAULT_PLATFORM = "linux/arm64";
const DEFAULT_BROWSER_FLAGS: readonly string[] = [
  "--disable-lcd-text",
  "--font-render-hinting=none",
  "--disable-partial-raster",
];

/** On every browser launch, so nothing prompts for the macOS keychain. They don't affect pixels, so they stay out of the environment. */
const HOUSEKEEPING_FLAGS: readonly string[] = ["--use-mock-keychain", "--password-store=basic"];

export interface ContainerRunner {
  kind: "container";
  /** `name@sha256:<digest>`. A tag is refused. */
  image: string;
  /** Docker's platform string, like `linux/arm64`. */
  platform: string;
}

export interface NativeRunner {
  kind: "native";
  os: string;
  osRelease: string;
  arch: string;
}

export interface RenderEnvironment {
  runner: ContainerRunner | NativeRunner;
  browserFlags: string[];
  viewport: { width: number; height: number };
  scale: number;
  recipe: RenderRecipe;
}

export interface EnvironmentOverrides extends Partial<Omit<RenderEnvironment, "runner" | "recipe">> {
  recipe?: RecipeOverrides;
  /** `{ kind: "native" }` means this machine: what it records can't be chosen. */
  runner?: ContainerRunner | NativeRunner | { kind: "native" };
}

export class EnvironmentError extends Error {
  override name = "EnvironmentError";
}

/** The runner this machine is, for a native environment. */
export function currentNativeRunner(): NativeRunner {
  return { kind: "native", os: process.platform, osRelease: os.release(), arch: process.arch };
}

/** The pinned default with `overrides` applied. Throws an `EnvironmentError` on anything invalid. */
export function defineEnvironment(overrides: EnvironmentOverrides = {}): RenderEnvironment {
  const runner = overrides.runner ?? { kind: "container", image: DEFAULT_IMAGE, platform: DEFAULT_PLATFORM };
  const environment: RenderEnvironment = {
    runner:
      runner.kind === "native" && !("os" in runner)
        ? currentNativeRunner()
        : (runner as RenderEnvironment["runner"]),
    browserFlags: [...(overrides.browserFlags ?? DEFAULT_BROWSER_FLAGS)],
    viewport: { width: 1200, height: 900, ...overrides.viewport },
    scale: overrides.scale ?? 1,
    recipe: recipeFrom(overrides.recipe),
  };
  validateEnvironment(environment);
  return environment;
}

const ONE_OF = (...values: readonly unknown[]) => (value: unknown) => values.includes(value);
const NON_EMPTY = (value: unknown) => typeof value === "string" && value !== "";
const NOT_NEGATIVE = (value: unknown) => Number.isInteger(value) && (value as number) >= 0;
const BOOLEAN = ONE_OF(true, false);

const RECIPE_RULES: Readonly<Record<string, { check: (value: unknown) => boolean; expected: string }>> = {
  origin: {
    check: (value) => {
      try {
        const { origin, protocol } = new URL(String(value));
        return origin === value && (protocol === "http:" || protocol === "https:");
      } catch {
        return false;
      }
    },
    expected: "an http or https origin, like http://localhost:6006",
  },
  renderGlobal: { check: (value) => typeof value === "string" && /^[A-Za-z_$][\w$]*$/.test(value), expected: "a JavaScript identifier" },
  locale: { check: NON_EMPTY, expected: "a locale, like de-DE" },
  timezoneId: { check: NON_EMPTY, expected: "a time zone, like Europe/Berlin" },
  colorScheme: { check: ONE_OF("light", "dark", "no-preference"), expected: 'one of "light", "dark", "no-preference"' },
  reducedMotion: { check: ONE_OF("reduce", "no-preference"), expected: 'one of "reduce", "no-preference"' },
  forcedColors: { check: ONE_OF("none", "active"), expected: 'one of "none", "active"' },
  fixedTime: { check: (value) => value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value))), expected: "a date and time, or null for the real time" },
  networkQuietMs: { check: NOT_NEGATIVE, expected: "a whole number of milliseconds" },
  networkQuietBoundMs: { check: NOT_NEGATIVE, expected: "a whole number of milliseconds" },
  loadImages: { check: BOOLEAN, expected: "true or false" },
};

const SCREENSHOT_RULES: Readonly<Record<string, { check: (value: unknown) => boolean; expected: string }>> = {
  animations: { check: ONE_OF("disabled", "allow"), expected: 'one of "disabled", "allow"' },
  caret: { check: ONE_OF("hide", "initial"), expected: 'one of "hide", "initial"' },
  scale: { check: ONE_OF("device", "css"), expected: 'one of "device", "css"' },
  fullPage: { check: BOOLEAN, expected: "true or false" },
};

function checkAgainst(rules: typeof RECIPE_RULES, prefix: string, given: object): void {
  for (const [key, value] of Object.entries(given)) {
    const rule = rules[key];
    // Refused, so a typo or a key a project can't set doesn't quietly render the default.
    if (rule === undefined) throw new EnvironmentError(`The recipe has no setting "${prefix}${key}" to change. It has ${Object.keys(rules).join(", ")}.`);
    if (!rule.check(value)) throw new EnvironmentError(`The recipe's ${prefix}${key} must be ${rule.expected}, got ${JSON.stringify(value)}.`);
  }
}

function recipeFrom(overrides: RecipeOverrides = {}): RenderRecipe {
  const { screenshot = {}, ...rest } = overrides;
  checkAgainst(RECIPE_RULES, "", rest);
  checkAgainst(SCREENSHOT_RULES, "screenshot.", screenshot);
  return { ...DEFAULT_RECIPE, ...rest, screenshot: { ...DEFAULT_RECIPE.screenshot, ...screenshot } };
}

function validateEnvironment(environment: RenderEnvironment): void {
  const { runner, browserFlags, viewport, scale } = environment;
  if (runner.kind === "container") {
    imageDigest(runner.image);
    if (!/^[a-z0-9]+\/[a-z0-9]+(\/[a-z0-9]+)?$/.test(runner.platform)) {
      throw new EnvironmentError(
        `Invalid container platform "${runner.platform}". Expected a form like linux/arm64.`,
      );
    }
  } else if (runner.kind === "native") {
    if (!runner.os || !runner.osRelease || !runner.arch) {
      throw new EnvironmentError("A native runner must record its OS, OS release, and architecture.");
    }
  } else {
    throw new EnvironmentError(`Unknown runner kind "${(runner as { kind: string }).kind}".`);
  }

  const switches = new Set<string>();
  for (const flag of browserFlags) {
    if (!/^--[a-zA-Z0-9][a-zA-Z0-9-]*(=.*)?$/.test(flag))
      throw new EnvironmentError(`Invalid browser flag "${flag}". Expected --name or --name=value.`);
    if (HOUSEKEEPING_FLAGS.includes(flag))
      throw new EnvironmentError(`Browser flag "${flag}" is already applied to every launch.`);
    // Refused because Chromium's last duplicate wins, and the ID sorts flags.
    const name = flag.split("=", 1)[0] as string;
    if (switches.has(name)) throw new EnvironmentError(`Browser flag "${name}" appears twice.`);
    switches.add(name);
  }

  if (
    !Number.isInteger(viewport.width) ||
    !Number.isInteger(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    throw new EnvironmentError(
      `Viewport must be positive integers, got ${viewport.width}x${viewport.height}.`,
    );
  }
  if (!Number.isFinite(scale) || scale <= 0)
    throw new EnvironmentError(`Scale must be a positive number, got ${scale}.`);
}

/** The digest of a pinned image, refusing a reference with a tag or no digest, since a tag can move. */
function imageDigest(image: string): string {
  const match = /^[a-z0-9][^@\s]*@(sha256:[0-9a-f]{64})$/.exec(image);
  if (
    !match ||
    image
      .slice(image.lastIndexOf("/") + 1)
      .split("@", 1)[0]
      ?.includes(":")
  ) {
    throw new EnvironmentError(
      `Container image "${image}" must be pinned as name@sha256:<64 hex digits>, with no tag. A floating tag can change the pixels without changing the environment ID.`,
    );
  }
  return match[1] as string;
}

/** Every flag a browser launches with: the environment's, plus housekeeping. */
export function launchArgs(environment: RenderEnvironment): string[] {
  return [...environment.browserFlags, ...HOUSEKEEPING_FLAGS];
}

/**
 * A stable ID for what decides the pixels independently of the project, safe in a render's
 * name. The readable prefix keeps a native run visibly apart from the container. The hash
 * takes only an image's digest, so a mirror of the same image is the same environment. Flag
 * order and property order don't matter. Upgrading Playwright changes the ID.
 */
export function environmentId(environment: RenderEnvironment): string {
  validateEnvironment(environment);
  const { runner, browserFlags, viewport, scale, recipe } = environment;
  const decidesPixels = {
    runner:
      runner.kind === "container"
        ? { kind: runner.kind, digest: imageDigest(runner.image), platform: runner.platform }
        : runner,
    browserFlags: [...browserFlags].sort(),
    viewport: { width: viewport.width, height: viewport.height },
    scale,
    recipe,
    playwright: PLAYWRIGHT_VERSION,
  };
  const hash = createHash("sha256").update(canonicalJson(decidesPixels)).digest("hex").slice(0, 16);
  const prefix =
    runner.kind === "container"
      ? `container-${runner.platform.replaceAll("/", "-")}`
      : `native-${runner.os}-${runner.arch}`;
  return `${prefix}-${hash}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
