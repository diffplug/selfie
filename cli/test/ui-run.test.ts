import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { decodeImage } from "./support.ts";
import { type StoriesView } from "selfie-ui/app";
import { describe, expect, test } from "vitest";
import { BLUE, commit, git } from "./support.ts";
import { UNKNOWN_HASH, UNKNOWN_RUN, h, project, review, get, decideOn, acceptRun, viewOf, makeGoldens } from "./ui-support.ts";

describe("which run", () => {
  test("says where a run stands against this checkout, and what its baseline is to it", async () => {
    h.stories = [{ id: "a" }];
    const { runId } = (await review()).json;
    const head = git(h.repo, "rev-parse", "HEAD");
    expect(await (await get(`/api/runs/${runId}/context`)).json()).toEqual({ head, branch: "main", mergeBase: head, defaultBranch: "main" });
    git(h.repo, "checkout", "--quiet", "-b", "topic");
    const moved = await commit(h.repo, "on a branch");
    expect(await (await get(`/api/runs/${runId}/context`)).json()).toEqual({ head: moved, branch: "topic", mergeBase: head, defaultBranch: "main" });
    expect((await get(`/api/runs/${UNKNOWN_RUN}/context`)).status).toBe(404);
  });

  const newest = async () => ((await (await get("/api/stories")).json()) as StoriesView);

  test("says the commit, with no run yet", async () => {
    expect(await newest()).toMatchObject({ head: git(h.repo, "rev-parse", "HEAD"), newestRunId: null });
  });

  test("is the newest finished one at HEAD, in this environment", async () => {
    h.stories = [{ id: "a" }];
    const { environment } = (await review()).json;
    const second = (await review()).json.runId;
    expect((await newest()).newestRunId).toBe(second);

    // A review still recording, or crashed, can't be compared.
    const recording = await project.snapshots.beginRun({
      gitSha: git(h.repo, "rev-parse", "HEAD"),
      environment,
      scale: 1,
      dirty: false,
      baselineSha: null,
    });
    expect((await newest()).newestRunId).toBe(second);
    const unfinished = await get(`/api/runs/${recording.id}`);
    expect(unfinished.status).toBe(409);
    expect(await unfinished.json()).toMatchObject({ error: { code: "run-not-finished" } });

    await commit(h.repo, "moved on");
    expect((await newest()).newestRunId).toBeNull();
    // Though a run of an earlier commit is still there to view.
    expect((await get(`/api/runs/${second}`)).status).toBe(200);
  });

  test("refuses a bad run ID and an unknown one, with distinct answers, on every run route", async () => {
    for (const [run, status, code] of [
      ["not-a-run", 400, "bad-run-id"],
      ["..%2f..", 400, "bad-run-id"],
      [UNKNOWN_RUN, 404, "unknown-run"],
    ] as const) {
      for (const response of [
        await get(`/api/runs/${run}`),
        await get(`/api/runs/${run}/unchanged`),
        await get(`/api/runs/${run}/baseline`),
        await acceptRun(run),
        await decideOn(run, "approved", [{ story: "a", imageHash: UNKNOWN_HASH }]),
      ]) {
        expect(response.status, run).toBe(status);
        expect(await response.json()).toMatchObject({ error: { code } });
      }
    }
  });
});

describe("the run view", () => {
  test("gives counts, blockers, advisories, and states, and never a file path", async () => {
    h.stories = [{ id: "same" }, { id: "differs" }, { id: "gone" }, { id: "breaks" }];
    await makeGoldens();
    h.stories = [
      { id: "same", errors: [{ source: "play", message: "It threw" }] },
      { id: "differs", color: BLUE },
      { id: "fresh" },
      { id: "breaks", failed: "It broke" },
    ];
    const { json } = await review();
    const response = await get(`/api/runs/${json.runId}`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const view = (await response.json()) as any;
    expect(view.counts).toEqual({ stories: 4, unchanged: 1, changed: 1, new: 1, removed: 1, failed: 1, undecided: 2, advisories: 1 });
    expect(view.rows.map(({ story, state }: any) => [story, state])).toEqual([
      ["breaks", "failed"],
      ["differs", "changed"],
      ["fresh", "new"],
      ["same", "unchanged"],
      ["gone", "removed"],
    ]);
    expect(view.blockers.map(({ reason }: any) => reason).sort()).toEqual(["changed-unapproved", "failed", "new-unapproved", "removed"]);
    expect(view.advisories).toEqual([{ story: "same", reason: "play-error", detail: "It threw" }]);
    expect(view.rows.find(({ story }: any) => story === "breaks")).toMatchObject({ failure: "render: It broke", imageHash: null });
    expect(view.rows.find(({ story }: any) => story === "differs").pixelDiff).toMatchObject({ changedPixels: 64 });
    expect(view.removals).toEqual({ stories: ["gone"], outsideFilter: 0 });
    expect(view.run.baselineSha).toBe(json.baseline.sha);
    expect(view.actor).toBe("tester@example.com");
    expect(view.siblings.map(({ id }: any) => id)).toContain(json.runId);

    const text = JSON.stringify(view);
    expect(text).not.toContain(h.home);
    expect(text).not.toContain(h.repo);
  });

  test("lists unchanged stories only when asked", async () => {
    h.stories = [{ id: "same" }, { id: "also-same" }];
    const goldens = await makeGoldens();
    const { json } = await review();
    expect((await viewOf(json.runId)).rows).toEqual([]);
    const { rows } = (await (await get(`/api/runs/${json.runId}/unchanged`)).json()) as any;
    expect(rows.map(({ story, state }: any) => [story, state])).toEqual([
      ["also-same", "unchanged"],
      ["same", "unchanged"],
    ]);
    expect(goldens).not.toBe(json.runId);
  });

  test("explains a run with no baseline", async () => {
    h.stories = [{ id: "a" }];
    const { runId } = (await review()).json;
    expect((await viewOf(runId)).run.baselineSha).toBeNull();
    const baseline = await get(`/api/runs/${runId}/baseline`);
    expect(await baseline.json()).toEqual({ sha: null, message: expect.any(String) });
    expect(baseline.headers.get("cache-control")).toBe("no-store");
  });

  test("says whose goldens a commit has, including another run's", async () => {
    h.stories = [{ id: "a" }];
    const { runId: first } = (await review()).json;
    expect((await viewOf(first)).acceptedRunId).toBeNull();
    const [{ story, imageHash }] = (await viewOf(first)).rows;
    await decideOn(first, "approved", [{ story, imageHash }]);
    await acceptRun(first);
    expect((await viewOf(first)).acceptedRunId).toBe(first);
    const { runId: second } = (await review()).json;
    expect((await viewOf(second)).acceptedRunId).toBe(first);
  });
});

describe("a run's scale", () => {
  test("comes from the project's environment and reaches the view", async () => {
    h.stories = [{ id: "a--one" }];
    const standard = (await review()).json;
    expect((await viewOf(standard.runId)).run.scale).toBe(1);
    await writeFile(path.join(h.repo, "selfie.config.json"), JSON.stringify({ environment: { scale: 1.5 } }));
    const scaled = (await review()).json;
    expect(scaled.environment).not.toBe(standard.environment);
    expect((await viewOf(scaled.runId)).run.scale).toBe(1.5);
  });
});

describe("a run that reused an earlier render", () => {
  test("its view says which run really rendered it, and a rendered run's says none", async () => {
    const build = path.join(h.scratch, "build");
    await mkdir(build);
    await writeFile(path.join(build, "iframe.html"), "<html></html>");
    h.stories = [{ id: "a--one" }];
    const rendered = (await h.cli("review", "--storybook-dir", build)).json;
    await commit(h.repo, "elsewhere");
    const reused = (await h.cli("review", "--storybook-dir", build)).json;
    expect(reused.reusedFromRun).toBe(rendered.runId);
    expect((await viewOf(rendered.runId)).run.reusedFromRun).toBeNull();
    expect((await viewOf(reused.runId)).run.reusedFromRun).toBe(rendered.runId);
  });
});

describe("images", () => {
  test("serves a stored image, privately, by its hash", async () => {
    h.stories = [{ id: "a" }];
    const view = await viewOf((await review()).json.runId);
    const [{ imageHash }] = view.rows;
    const response = await get(`/api/images/${imageHash}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toMatch(/^private\b/);
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const image = await decodeImage(new Uint8Array(await response.arrayBuffer()));
    expect(image).toMatchObject({ width: 8, height: 8 });
  });

  test("refuses anything but a hash before it reaches the store", async () => {
    const bad = ["abc", UNKNOWN_HASH.toUpperCase().replace(/0/g, "A"), `${UNKNOWN_HASH}0`, "z".repeat(64), "..%2f..%2fstore.db", "%2e%2e%2f%2e%2e%2fsecret.txt"];
    for (const hash of bad) {
      const response = await get(`/api/images/${hash}`);
      expect(response.status, hash).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "bad-image-hash" } });
    }
    expect((await get(`/api/images/${UNKNOWN_HASH}`)).status).toBe(404);
    expect((await get(`/api/diffs/nope/${UNKNOWN_HASH}`)).status).toBe(400);
    expect((await get(`/api/diffs/${UNKNOWN_HASH}/nope/image`)).status).toBe(400);
    expect((await get(`/api/diffs/${UNKNOWN_HASH}/${UNKNOWN_HASH}`)).status).toBe(404);
    expect((await get(`/api/diffs/${UNKNOWN_HASH}/${UNKNOWN_HASH}/image`)).status).toBe(404);
  });

  test("computes a diff on demand, and still works once the run's directory is pruned", async () => {
    h.stories = [{ id: "a" }];
    await makeGoldens();
    h.stories = [{ id: "a", patch: [1, 2, 1, 1, BLUE] }];
    const { runId } = (await review()).json;
    const runs = path.join(project.directory, "runs");
    expect(await readdir(runs)).toContain(runId);
    await rm(path.join(runs, runId), { recursive: true });

    const [row] = (await viewOf(runId)).rows;
    // Pixel stats in a list are a cache's. The detail's are computed, so they survive it.
    expect(row.pixelDiff).toBeNull();
    const url = `/api/diffs/${row.imageHash}/${row.goldenHash}`;
    const stats = await get(url);
    expect(await stats.json()).toEqual({
      current: { width: 8, height: 8 },
      golden: { width: 8, height: 8 },
      regions: [{ current: { x: 1, y: 2, width: 1, height: 1 }, golden: { x: 1, y: 2, width: 1, height: 1 }, kind: "changed", changedPixels: 1, moved: [] }],
      changedPixels: 1,
      movedPixels: 0,
      spacingPixels: 0,
      totalPixels: 64,
      boundingBox: { x: 1, y: 2, width: 1, height: 1 },
      firstChanged: { x: 1, y: 2 },
      maxChannelDelta: 170,
    });
    // Addressed by content, as the image is, so a browser needn't ask twice.
    expect(stats.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    const image = await get(`${url}/image`);
    expect(image.status).toBe(200);
    expect(image.headers.get("cache-control")).toMatch(/^private\b/);
    const { pixels, width } = await decodeImage(new Uint8Array(await image.arrayBuffer()));
    expect([...pixels.subarray((2 * width + 1) * 3, (2 * width + 1) * 3 + 3)]).toEqual([255, 0, 80]);
    expect((await get(`/api/images/${row.goldenHash}`)).status).toBe(200);
    expect((await get(`/api/images/${row.imageHash}`)).status).toBe(200);
  });

  test("a diff's stats and image asked for together both answer", async () => {
    h.stories = [{ id: "a" }];
    await makeGoldens();
    h.stories = [{ id: "a", color: BLUE }];
    const [row] = (await viewOf((await review()).json.runId)).rows;
    const url = `/api/diffs/${row.imageHash}/${row.goldenHash}`;
    const [stats, image] = await Promise.all([get(url), get(`${url}/image`)]);
    expect([stats.status, image.status]).toEqual([200, 200]);
    expect((await get(`/api/diffs/${UNKNOWN_HASH}/${row.goldenHash}`)).status).toBe(404);
    expect((await get(`/api/diffs/${UNKNOWN_HASH}/${row.goldenHash}/image`)).status).toBe(404);
  });

  test("a different size has stats and a diff image", async () => {
    h.stories = [{ id: "a" }];
    await makeGoldens();
    h.stories = [{ id: "a", width: 10, height: 6 }];
    const [row] = (await viewOf((await review()).json.runId)).rows;
    const url = `/api/diffs/${row.imageHash}/${row.goldenHash}`;
    expect(await (await get(url)).json()).toMatchObject({ current: { width: 10, height: 6 }, golden: { width: 8, height: 8 } });
    expect((await get(`${url}/image`)).status).toBe(200);
  });
});
