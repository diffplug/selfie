import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RenderOptions } from "selfie-render";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { runCli } from "../src/cli.ts";
import { openProject } from "../src/project.ts";
import { SKILLS } from "../src/skills.ts";
import { BLUE, createHarness, GREEN, RED, type Harness, writeTestConfig } from "./support.ts";

let h: Harness;
/** What each render makes, in turn. */
let renders: (typeof h.stories)[];

beforeEach(async () => {
  h = await createHarness();
  renders = [];
  let at = 0;
  h.onRender = () => {
    h.stories = renders[Math.min(at++, renders.length - 1)]!;
  };
});
afterEach(() => h.destroy());

const flakes = async (...flags: string[]) => h.cli("flakes", ...flags);

describe("selfie flakes", () => {
  test("exits 0 with nothing to report when every render is the same", async () => {
    renders = [[{ id: "a" }, { id: "b", color: BLUE }]];
    const { code, json } = await flakes();
    expect(code).toBe(0);
    expect(json).toMatchObject({ schemaVersion: 1, renders: 3, stories: 2, flaky: [] });
  });

  test("says which story's pixels differ, biggest first, with the images to look at", async () => {
    renders = [
      [{ id: "small" }, { id: "big" }, { id: "still" }],
      [{ id: "small", patch: [0, 0, 1, 1, GREEN] }, { id: "big", color: BLUE }, { id: "still" }],
    ];
    const { code, json } = await flakes();
    expect(code).toBe(1);
    expect(json.flaky.map(({ story }: { story: string }) => story)).toEqual(["big", "small"]);
    const [big] = json.flaky;
    expect(big).toMatchObject({ kinds: ["pixels"], distinctImages: 2, errors: [] });
    expect(big.worst.changedPixels).toBe(64);
    expect(big.worst.hunks).toBeUndefined();
    for (const file of Object.values(big.images) as string[]) await access(file);
  });

  test("counts how many different images there were", async () => {
    renders = [[{ id: "a", color: RED }], [{ id: "a", color: BLUE }], [{ id: "a", color: GREEN }]];
    expect((await flakes()).json.flaky[0].distinctImages).toBe(3);
  });

  test("says when a story fails only sometimes", async () => {
    renders = [[{ id: "a" }], [{ id: "a", failed: "boom" }]];
    const { code, json } = await flakes("--times", "2");
    expect(code).toBe(1);
    expect(json.flaky[0].kinds).toContain("failed");
  });

  test("says when the project's own error comes and goes, but not when it always happens", async () => {
    const error = { source: "play" as const, message: "not visible" };
    renders = [[{ id: "always", errors: [error] }, { id: "sometimes", errors: [error] }], [{ id: "always", errors: [error] }, { id: "sometimes" }]];
    const { json } = await flakes("--times", "2");
    expect(json.flaky).toHaveLength(1);
    expect(json.flaky[0]).toMatchObject({ story: "sometimes", kinds: ["errors"], errors: [{ source: "play", message: "not visible", renders: 1 }] });
  });

  test("always says when a story waited on the network, since that's what makes a render unreliable", async () => {
    const error = { source: "timeout" as const, message: "network not quiet" };
    renders = [[{ id: "a", errors: [error] }]];
    const { code, json } = await flakes("--times", "2");
    expect(code).toBe(1);
    expect(json.flaky[0]).toMatchObject({ story: "a", kinds: ["timeout"], distinctImages: 1, worst: null, images: null, errors: [{ renders: 2 }] });
  });

  test("records no batch", async () => {
    renders = [[{ id: "a" }]];
    await flakes();
    const { json } = await h.cli("review");
    const project = await openProject({ cwd: h.repo, env: { SELFIE_HOME: h.home } });
    expect((await project.batches.batchesAt(json.gitSha, json.environment)).map(({ id }) => id)).toEqual([json.batchId]);
    project.close();
  });

  test("asks for at least two renders, as a whole number", async () => {
    renders = [[{ id: "a" }]];
    for (const times of ["1", "many", "2.5"]) {
      const { code, json } = await flakes("--times", times);
      expect(code, times).toBe(2);
      expect(json.error.code).toBe("usage");
    }
  });

  test("passes on which stories, and how many at once", async () => {
    renders = [[{ id: "a" }]];
    const asked: unknown[] = [];
    const seen = h.onRender;
    h.onRender = (options) => {
      asked.push([options.stories, options.concurrency]);
      seen?.(options);
    };
    await flakes("--times", "2", "--story", "a*", "--concurrency", "1");
    expect(asked).toEqual([[["a*"], 1], [["a*"], 1]]);
  });
});

describe("selfie skill", () => {
  test.each(SKILLS)("prints %s, in an agent skill's format", async (name) => {
    const lines: string[] = [];
    const code = await runCli(["skill", name], { cwd: h.repo, env: {}, stdout: (text) => lines.push(text), stderr: () => {} });
    expect(code).toBe(0);
    expect(lines.join("")).toMatch(new RegExp(`^---\\nname: ${name}\\n`));
  });

  test("refuses one it doesn't have", async () => {
    const { code, json } = await h.cli("skill", "nope");
    expect(code).toBe(2);
    expect(json.error.code).toBe("usage");
  });
});

describe("a project's recipe and timings", () => {
  const config = (settings: object) => writeTestConfig(h.repo, settings);
  const seen: RenderOptions[] = [];

  beforeEach(() => {
    seen.length = 0;
    h.stories = [{ id: "a" }];
    h.onRender = (options) => void seen.push(options);
  });

  test("reach the render", async () => {
    await config({ environment: { recipe: { colorScheme: "dark" } }, settleMs: 250, storyTimeoutMs: 9000 });
    expect((await h.cli("render")).code).toBe(0);
    expect(seen[0]).toMatchObject({ environment: { recipe: { colorScheme: "dark", locale: "en-US" } }, settleMs: 250, storyTimeoutMs: 9000 });
  });

  test.each([
    [{ environment: { recipe: { colourScheme: "dark" } } }, "colourScheme"],
    [{ environment: { recipe: { headless: false } } }, "headless"],
    [{ settleMs: -1 }, "settleMs"],
    [{ storyTimeoutMs: "soon" }, "storyTimeoutMs"],
  ])("refuses %j as a bad config", async (settings, named) => {
    await config(settings);
    const { code, json } = await h.cli("render");
    expect(code).toBe(2);
    expect(json.error).toMatchObject({ code: "bad-config", message: expect.stringContaining(named) });
  });
});
