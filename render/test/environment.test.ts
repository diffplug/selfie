import { describe, expect, test } from "vitest";
import {
  DEFAULT_IMAGE,
  defineEnvironment,
  environmentId,
  EnvironmentError,
  parseImage,
  type RenderEnvironment,
} from "../src/environment.ts";

const DIGEST = `sha256:${"a".repeat(64)}`;
const OTHER_DIGEST = `sha256:${"b".repeat(64)}`;
const container = (image: string, platform = "linux/arm64") =>
  defineEnvironment({ runner: { kind: "container", image, platform } });

describe("defaults", () => {
  test("pin the arm64 Playwright image and the measured settings", () => {
    expect(defineEnvironment()).toEqual({
      runner: {
        kind: "container",
        image:
          "mcr.microsoft.com/playwright@sha256:a0f4498920a5dbac63196d9140ed738ef00470f27e2e74029abd8850b7bd5717",
        platform: "linux/arm64",
      },
      browserFlags: ["--disable-lcd-text", "--font-render-hinting=none"],
      viewport: { width: 1200, height: 900 },
      scale: 1,
      settleMs: 500,
    });
  });
});

describe("environmentId", () => {
  test("is pinned for the default environment", () => {
    // Changing this literal restarts every project's goldens. Upgrading Playwright is the
    // one expected reason, since the ID includes its version.
    expect(environmentId(defineEnvironment())).toBe("container-linux-arm64-53eae0047730e724");
  });

  test("is deterministic and safe in a snapshot name", () => {
    expect(environmentId(defineEnvironment())).toBe(environmentId(defineEnvironment()));
    expect(environmentId(defineEnvironment())).toMatch(/^[a-z0-9-]+$/);
  });

  test.each<[string, RenderEnvironment]>([
    ["image digest", container(`mcr.microsoft.com/playwright@${OTHER_DIGEST}`)],
    ["platform", container(DEFAULT_IMAGE, "linux/amd64")],
    ["a flag", defineEnvironment({ browserFlags: ["--disable-lcd-text"] })],
    [
      "a flag value",
      defineEnvironment({ browserFlags: ["--disable-lcd-text", "--font-render-hinting=full"] }),
    ],
    ["viewport width", defineEnvironment({ viewport: { width: 1201, height: 900 } })],
    ["viewport height", defineEnvironment({ viewport: { width: 1200, height: 901 } })],
    ["scale", defineEnvironment({ scale: 2 })],
    ["settle time", defineEnvironment({ settleMs: 501 })],
  ])("changes with %s", (_label, changed) => {
    expect(environmentId(changed)).not.toBe(environmentId(defineEnvironment()));
  });

  test("ignores what can't change pixels: flag order, property order, an image's tag and mirror", () => {
    const base = environmentId(container(`mcr.microsoft.com/playwright@${DIGEST}`));
    expect(environmentId(container(`mcr.microsoft.com/playwright:v1.63.0-noble@${DIGEST}`))).toBe(base);
    expect(environmentId(container(`mirror.example:5000/playwright@${DIGEST}`))).toBe(base);

    const reordered: RenderEnvironment = {
      settleMs: 500,
      scale: 1,
      viewport: { height: 900, width: 1200 },
      browserFlags: ["--font-render-hinting=none", "--disable-lcd-text"],
      runner: { platform: "linux/arm64", image: `mcr.microsoft.com/playwright@${DIGEST}`, kind: "container" },
    };
    expect(environmentId(reordered)).toBe(base);
  });

  test("refuses an invalid environment rather than naming it", () => {
    const unpinned = {
      ...defineEnvironment(),
      runner: { kind: "container" as const, image: "playwright:latest", platform: "linux/arm64" },
    };
    expect(() => environmentId(unpinned)).toThrow(EnvironmentError);
  });
});

describe("native runner", () => {
  const native = (os: string, arch: string, osRelease = "1.0") =>
    environmentId(defineEnvironment({ runner: { kind: "native", os, osRelease, arch } }));

  test("records the OS and architecture in the ID, and never matches the container", () => {
    expect(native("darwin", "arm64")).toMatch(/^native-darwin-arm64-[0-9a-f]{16}$/);
    expect(native("darwin", "arm64")).not.toBe(environmentId(defineEnvironment()));
  });

  test("changes with the OS, its release, and the architecture", () => {
    const ids = [
      native("darwin", "arm64"),
      native("linux", "arm64"),
      native("darwin", "x64"),
      native("darwin", "arm64", "2.0"),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("{ kind: 'native' } records this machine", () => {
    const { runner } = defineEnvironment({ runner: { kind: "native" } });
    expect(runner).toMatchObject({ kind: "native", os: process.platform, arch: process.arch });
  });
});

describe("validation", () => {
  test.each([
    "mcr.microsoft.com/playwright",
    "mcr.microsoft.com/playwright:v1.63.0-noble",
    "playwright:latest",
    "playwright@sha256:abc",
    `playwright@sha512:${"a".repeat(64)}`,
    `playwright@sha256:${"A".repeat(64)}`,
  ])("refuses the image %s", (image) => {
    expect(() => container(image)).toThrow(/must be pinned/);
  });

  test("parseImage strips a tag but keeps a registry port", () => {
    expect(parseImage(`registry.example:5000/a/b:tag@${DIGEST}`)).toEqual({
      name: "registry.example:5000/a/b",
      digest: DIGEST,
    });
    expect(parseImage(`registry.example:5000/a/b@${DIGEST}`)).toEqual({
      name: "registry.example:5000/a/b",
      digest: DIGEST,
    });
  });

  test.each([
    ["a bad platform", { runner: { kind: "container", image: DEFAULT_IMAGE, platform: "arm64" } }],
    ["a flag with no dashes", { browserFlags: ["disable-lcd-text"] }],
    ["a repeated flag", { browserFlags: ["--font-render-hinting=none", "--font-render-hinting=full"] }],
    ["a housekeeping flag", { browserFlags: ["--use-mock-keychain"] }],
    ["a fractional viewport", { viewport: { width: 1.5, height: 900 } }],
    ["a zero viewport", { viewport: { width: 0, height: 900 } }],
    ["a zero scale", { scale: 0 }],
    ["a negative settle time", { settleMs: -1 }],
  ] as const)("refuses %s", (_label, overrides) => {
    expect(() => defineEnvironment(overrides as never)).toThrow(EnvironmentError);
  });
});
