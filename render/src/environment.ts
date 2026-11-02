import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import { CAPTURE_RECIPE } from "./worker/protocol.ts";

export const DEFAULT_IMAGE =
  "mcr.microsoft.com/playwright@sha256:a0f4498920a5dbac63196d9140ed738ef00470f27e2e74029abd8850b7bd5717";
export const DEFAULT_PLATFORM = "linux/arm64";
export const DEFAULT_BROWSER_FLAGS: readonly string[] = ["--disable-lcd-text", "--font-render-hinting=none"];

/** On every browser launch, so nothing prompts for the macOS keychain. They don't affect pixels, so they stay out of the environment. */
export const HOUSEKEEPING_FLAGS: readonly string[] = ["--use-mock-keychain", "--password-store=basic"];

const PLAYWRIGHT_VERSION = (
  createRequire(import.meta.url)("playwright-core/package.json") as { version: string }
).version;

export interface ContainerRunner {
  kind: "container";
  /** `name@sha256:<digest>`, optionally `name:tag@sha256:<digest>`. A bare tag is refused. */
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
  settleMs: number;
}

export interface EnvironmentOverrides extends Partial<Omit<RenderEnvironment, "runner">> {
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
    settleMs: overrides.settleMs ?? 500,
  };
  validateEnvironment(environment);
  return environment;
}

export function validateEnvironment(environment: RenderEnvironment): void {
  const { runner, browserFlags, viewport, scale, settleMs } = environment;
  if (runner.kind === "container") {
    parseImage(runner.image);
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
  if (!Number.isInteger(settleMs) || settleMs < 0)
    throw new EnvironmentError(`settleMs must be a non-negative integer, got ${settleMs}.`);
}

/** Splits a pinned image reference, refusing one with no digest, since a tag can move. */
export function parseImage(image: string): { name: string; digest: string } {
  const match = /^([a-z0-9][^@\s]*)@(sha256:[0-9a-f]{64})$/.exec(image);
  if (!match) {
    throw new EnvironmentError(
      `Container image "${image}" must be pinned as name@sha256:<64 hex digits>. A floating tag can change the pixels without changing the environment ID.`,
    );
  }
  const lastSlash = (match[1] as string).lastIndexOf("/");
  const tagColon = (match[1] as string).indexOf(":", lastSlash + 1);
  return {
    name: tagColon === -1 ? (match[1] as string) : (match[1] as string).slice(0, tagColon),
    digest: match[2] as string,
  };
}

/**
 * A stable ID for everything that decides the pixels, safe in a snapshot's name. The
 * readable prefix keeps a native run visibly apart from the container. The hash takes only
 * an image's digest, so a mirror or tag of the same image is the same environment. Flag
 * order and property order don't matter. Upgrading Playwright changes the ID.
 */
export function environmentId(environment: RenderEnvironment): string {
  validateEnvironment(environment);
  const { runner, browserFlags, viewport, scale, settleMs } = environment;
  const decidesPixels = {
    runner:
      runner.kind === "container"
        ? { kind: runner.kind, digest: parseImage(runner.image).digest, platform: runner.platform }
        : runner,
    browserFlags: [...browserFlags].sort(),
    viewport: { width: viewport.width, height: viewport.height },
    scale,
    settleMs,
    recipe: CAPTURE_RECIPE,
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
