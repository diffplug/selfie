import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { decodeImage } from "./support.ts";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { diffImages } from "../src/diff.ts";
import { assertRunId, normalizeOrigin, projectSlug, regularFileInside, resolveInside, selfieHome, storyDirName } from "../src/paths.ts";
import { encodePng } from "../src/png.ts";
import { BLUE, GREEN, RED, solid, type Color } from "./support.ts";

const slug = (origin: string) => projectSlug({ origin, commonDir: "/unused" });

describe("projectSlug", () => {
  test("gives every spelling of one remote one slug", () => {
    const spellings = [
      "git@github.com:DiffPlug/Selfie.git",
      "https://github.com/diffplug/selfie.git",
      "https://github.com/diffplug/selfie",
      "https://github.com/diffplug/selfie/",
      "ssh://git@github.com/diffplug/selfie.git",
      "ssh://git@github.com:22/diffplug/selfie.git",
      "https://oauth2:ghp_secret@github.com/diffplug/selfie.git",
    ];
    expect(new Set(spellings.map(slug)).size).toBe(1);
    expect(slug(spellings[0]!)).toMatch(/^github-com-diffplug-selfie-[0-9a-f]{8}$/);
  });

  test("never holds credentials", () => {
    for (const origin of [
      "https://user:hunter2@github.com/a/b.git",
      "https://hunter2@github.com/a/b.git",
      "https://user:hunter2@[not a url/a/b.git",
    ]) {
      expect(slug(origin)).not.toContain("hunter2");
      expect(normalizeOrigin(origin)).not.toContain("hunter2");
    }
  });

  test("keeps apart remotes that read the same once slugified", () => {
    expect(slug("https://github.com/a/b-c")).not.toBe(slug("https://github.com/a-b/c"));
  });

  test.each([
    "d1.env",
    "./d1.env",
    "/d1.env",
    "../../..",
    "..",
    ".",
    "/",
    "https://github.com/../../../etc",
    "https://github.com/%2e%2e/%2e%2e",
    "git@host:../../up",
    "..\\..\\up",
    "a\nb",
    "\u0000",
    "",
    `https://github.com/${"x".repeat(5000)}`,
  ])("%j gives one safe directory name that can't be d1.env", (origin) => {
    const name = slug(origin);
    expect(name).toMatch(/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/);
    expect(name).not.toBe("d1.env");
    expect(name.length).toBeLessThan(100);
    expect(path.dirname(path.join("/home", name))).toBe("/home");
  });

  test("falls back to the Git directory with no origin, which every worktree shares", () => {
    const a = projectSlug({ origin: null, commonDir: "/a/.git" });
    expect(a).toMatch(/^local-[0-9a-f]{16}$/);
    expect(a).toBe(projectSlug({ origin: null, commonDir: "/a/.git" }));
    expect(a).not.toBe(projectSlug({ origin: null, commonDir: "/b/.git" }));
  });
});

test("selfieHome is SELFIE_HOME, or ~/.config/selfie", () => {
  expect(selfieHome({ SELFIE_HOME: "/x/y" })).toBe("/x/y");
  expect(selfieHome({})).toBe(path.join(homedir(), ".config", "selfie"));
  expect(selfieHome({ SELFIE_HOME: "" })).toBe(path.join(homedir(), ".config", "selfie"));
});

describe("storyDirName", () => {
  test.each(["../../etc/passwd", "..", ".", "", "a/b", "a\\b", "\u0000", "%2F", `${"z".repeat(5000)}`, "é✓"])(
    "%j is one path segment with no dots",
    (id) => {
      const name = storyDirName(id);
      expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(name.length).toBeLessThan(100);
    },
  );

  test("stays readable, and apart for IDs that differ only by case or punctuation", () => {
    expect(storyDirName("app-wall--drop")).toMatch(/^app-wall--drop-[0-9a-f]{10}$/);
    expect(storyDirName("Same")).not.toBe(storyDirName("same"));
    expect(storyDirName("a/b")).not.toBe(storyDirName("a-b"));
  });
});

test("assertRunId accepts only a UUID", () => {
  expect(() => assertRunId("7f0e6a2e-1234-4abc-8def-0123456789ab")).not.toThrow();
  for (const bad of ["../..", "", "abc", "7f0e6a2e-1234-4abc-8def-0123456789ab/..", "7F0E6A2E-1234-4ABC-8DEF-0123456789AB"]) {
    expect(() => assertRunId(bad)).toThrow(/isn't a run ID/);
  }
});

describe("paths inside a root", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "selfie-paths-test-"));
    await writeFile(path.join(root, "real.png"), "x");
    await symlink(path.join(root, "real.png"), path.join(root, "link.png"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("resolveInside refuses what climbs out, or is the root itself", () => {
    expect(resolveInside("/a/b", "c/d.png")).toBe("/a/b/c/d.png");
    expect(resolveInside("/a/b", "../c")).toBeNull();
    expect(resolveInside("/a/b", "/etc/passwd")).toBeNull();
    expect(resolveInside("/a/b", ".")).toBeNull();
    expect(resolveInside("/a/b", "c/../../b2/x")).toBeNull();
    expect(resolveInside("/a/b", "../b2")).toBeNull();
  });

  test("regularFileInside refuses a symlink, a directory, and a missing file", async () => {
    expect(await regularFileInside(root, "real.png")).toEqual({ file: path.join(root, "real.png") });
    for (const [relative, reason] of [
      ["link.png", "isn't a regular file"],
      ["missing.png", "doesn't exist"],
      ["../real.png", "outside"],
    ] as const) {
      const checked = await regularFileInside(root, relative);
      expect("refused" in checked && checked.refused).toContain(reason);
    }
  });
});

describe("encodePng", () => {
  test("writes what the store's decoder reads back exactly", async () => {
    const pixels = new Uint8Array(3 * 5 * 3);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37) % 256;
    const decoded = await decodeImage(await encodePng({ width: 5, height: 3, pixels }));
    expect(decoded).toMatchObject({ width: 5, height: 3 });
    expect([...decoded.pixels]).toEqual([...pixels]);
  });
});

describe("diffImages", () => {
  test("finds the count, bounding box, and largest channel delta", () => {
    const golden = solid(4, 3, [10, 20, 30]);
    const current = solid(4, 3, [10, 20, 30]);
    current.pixels.set([10, 25, 30], (1 * 4 + 1) * 3);
    current.pixels.set([200, 20, 30], (2 * 4 + 3) * 3);
    const { diff, highlighted } = diffImages(current, golden);
    expect(diff).toEqual({
      current: { width: 4, height: 3 },
      golden: { width: 4, height: 3 },
      hunks: [{ current: { x: 1, y: 1, width: 3, height: 2 }, golden: { x: 1, y: 1, width: 3, height: 2 }, kind: "changed", changedPixels: 2, moved: [] }],
      changedPixels: 2,
      movedPixels: 0,
      spacingPixels: 0,
      totalPixels: 12,
      boundingBox: { x: 1, y: 1, width: 3, height: 2 },
      firstChanged: { x: 1, y: 1 },
      maxChannelDelta: 190,
    });
    expect([...highlighted.pixels.subarray((1 * 4 + 1) * 3, (1 * 4 + 1) * 3 + 3)]).toEqual([255, 0, 80]);
    // An unchanged pixel fades to gray.
    const [r, g, b] = highlighted.pixels;
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r!).toBeGreaterThanOrEqual(190);
  });

  /** A hunk as wide as each image, as today's are. */
  const rowHunk = (width: number, current: [number, number], golden: [number, number], goldenWidth = width) => ({
    current: { x: 0, y: current[0], width, height: current[1] },
    golden: { x: 0, y: golden[0], width: goldenWidth, height: golden[1] },
  });
  /** Rows of solid color, from one letter each. */
  const rowsOf = (width: number, colors: string) => {
    const palette: Record<string, Color> = { r: RED, g: GREEN, b: BLUE, k: [0, 0, 0] };
    const pixels = new Uint8Array(width * colors.length * 3);
    [...colors].forEach((color, y) => pixels.set(solid(width, 1, palette[color]!).pixels, y * width * 3));
    return { width, height: colors.length, pixels };
  };
  const HIGHLIGHT = [255, 0, 80];
  const highlightedRows = ({ width, height, pixels }: { width: number; height: number; pixels: Uint8Array }) =>
    Array.from({ length: height }, (_, y) => y).filter((y) => [...pixels.subarray(y * width * 3, y * width * 3 + 3)].join() === HIGHLIGHT.join());

  test("adding a row marks only that row", () => {
    const { diff, highlighted } = diffImages(rowsOf(2, "rgkb"), rowsOf(2, "rgb"));
    expect(diff).toMatchObject({
      current: { width: 2, height: 4 },
      golden: { width: 2, height: 3 },
      hunks: [rowHunk(2, [2, 1], [2, 0])],
      changedPixels: 2,
      totalPixels: 8,
      boundingBox: { x: 0, y: 2, width: 2, height: 1 },
      firstChanged: { x: 0, y: 2 },
      maxChannelDelta: 0,
    });
    expect(highlightedRows(highlighted)).toEqual([2]);
  });

  test("removing a row counts what's gone, and marks the seam it left", () => {
    const { diff, highlighted } = diffImages(rowsOf(2, "rgb"), rowsOf(2, "rgkb"));
    expect(diff).toMatchObject({
      hunks: [rowHunk(2, [2, 0], [2, 1])],
      changedPixels: 2,
      totalPixels: 8,
      boundingBox: { x: 0, y: 2, width: 2, height: 1 },
      firstChanged: { x: 0, y: 2 },
    });
    expect(highlightedRows(highlighted)).toEqual([2]);
  });

  test("removing the last rows leaves a seam inside the image", () => {
    const { diff, highlighted } = diffImages(rowsOf(2, "rg"), rowsOf(2, "rgbk"));
    expect(diff.boundingBox).toEqual({ x: 0, y: 1, width: 2, height: 1 });
    expect(diff.changedPixels).toBe(4);
    expect(highlightedRows(highlighted)).toEqual([1]);
  });

  test("a changed band of a different height compares from its top, and the rest is changed", () => {
    const { diff, highlighted } = diffImages(rowsOf(1, "rkkkb"), rowsOf(1, "rgb"));
    expect(diff).toMatchObject({ hunks: [rowHunk(1, [1, 3], [1, 1])], changedPixels: 3 });
    expect(diff.maxChannelDelta).toBeGreaterThan(0);
    expect(highlightedRows(highlighted)).toEqual([1, 2, 3]);
  });

  test("repeated rows can't match twice over", () => {
    const { diff } = diffImages(rowsOf(1, "rrr"), rowsOf(1, "rr"));
    expect(diff).toMatchObject({ hunks: [rowHunk(1, [2, 1], [2, 0])], changedPixels: 0, spacingPixels: 1 });
    expect(diffImages(rowsOf(1, "rr"), rowsOf(1, "rrr")).diff).toMatchObject({ hunks: [rowHunk(1, [2, 0], [2, 1])], changedPixels: 0, spacingPixels: 1 });
  });

  test("identical images change nothing", () => {
    const { diff, highlighted } = diffImages(rowsOf(2, "rgb"), rowsOf(2, "rgb"));
    expect(diff).toMatchObject({ hunks: [], changedPixels: 0, boundingBox: null, firstChanged: null });
    expect(highlightedRows(highlighted)).toEqual([]);
  });

  test("different widths match from the sides", () => {
    const wider = diffImages(rowsOf(3, "rg"), rowsOf(2, "rg")).diff;
    expect(wider).toMatchObject({
      hunks: [{ current: { x: 2, y: 0, width: 1, height: 2 }, golden: { x: 2, y: 0, width: 0, height: 2 } }],
      changedPixels: 2,
      totalPixels: 6,
      boundingBox: { x: 2, y: 0, width: 1, height: 2 },
    });
    const narrower = diffImages(rowsOf(2, "rg"), rowsOf(3, "rg")).diff;
    expect(narrower).toMatchObject({ changedPixels: 2, totalPixels: 6 });
    // Nothing visible changed here, so it marks where.
    expect(narrower.boundingBox).toEqual({ x: 0, y: 0, width: 2, height: 1 });
  });

  test("different sizes in both directions still give a diff", () => {
    const { diff, highlighted } = diffImages(solid(4, 3, RED), solid(3, 4, BLUE));
    expect(diff).toMatchObject({ current: { width: 4, height: 3 }, golden: { width: 3, height: 4 }, hunks: [rowHunk(4, [0, 3], [0, 4], 3)] });
    expect(highlighted.height).toBe(3);
  });

  test("the highlight image encodes and decodes", async () => {
    const { highlighted } = diffImages(solid(4, 3, RED), solid(4, 3, BLUE));
    const decoded = await decodeImage(await encodePng(highlighted));
    expect([...decoded.pixels]).toEqual([...highlighted.pixels]);
  });
});
