// The review UI's routes over the real library, a real store, and real Git, with no socket and no
// browser, plus `selfie ui` itself on a real socket. Only the capture is a stand-in.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { decodeImage } from "./support.ts";
import { REQUEST_HEADER_VALUE, type StoriesView } from "selfie-ui/app";
import { createLocalApp, createStorybookApp, serveLocal, serveStorybook, type LocalServer } from "selfie-ui/local";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { runCli } from "../src/cli.ts";
import { openProject, type Project } from "../src/project.ts";
import { localReviewSource, type StoryRecorder } from "../src/ui.ts";
import { BLUE, commit, createHarness, git, GREEN, RED, type Harness } from "./support.ts";

const PORT = 4173;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;
const UNKNOWN_HASH = "0".repeat(64);
const UNKNOWN_RUN = "00000000-0000-4000-8000-000000000000";

let h: Harness;
let project: Project;
let clientDir: string;
let app: ReturnType<typeof createLocalApp>;

beforeEach(async () => {
  h = await createHarness();
  project = await openProject({ cwd: h.repo, env: { SELFIE_HOME: h.home } });
  clientDir = path.join(h.scratch, "client");
  await mkdir(path.join(clientDir, "assets"), { recursive: true });
  await writeFile(path.join(clientDir, "index.html"), "<!doctype html><title>the client</title>");
  await writeFile(path.join(clientDir, "assets", "a.js"), "export {};");
  await writeFile(path.join(h.scratch, "secret.txt"), "not for serving");
  app = createLocalApp({ source: localReviewSource(project), port: () => PORT, clientDir });
});
afterEach(async () => {
  project.close();
  await h.destroy();
});

const review = (...flags: string[]) => h.cli("review", "--storybook-dir", "ignored", ...flags);

const get = (url: string, headers: Record<string, string> = {}) => app.request(url, { headers: { host: HOST, ...headers } });

const change = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(url, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      host: HOST,
      origin: ORIGIN,
      "content-type": "application/json",
      "x-selfie-request": REQUEST_HEADER_VALUE,
      ...headers,
    },
  });

const decideOn = (runId: string, decision: string, snapshots: unknown) => change(`/api/runs/${runId}/decisions`, { decision, snapshots });
const acceptRun = (runId: string, body: unknown = {}) => change(`/api/runs/${runId}/accept`, body);
const viewOf = async (runId: string) => (await (await get(`/api/runs/${runId}`)).json()) as any;

/** `h.stories` as the goldens of HEAD. */
async function makeGoldens() {
  const { json } = await review();
  const view = await viewOf(json.runId);
  const targets = view.rows.map(({ story, imageHash }: any) => ({ story, imageHash }));
  expect((await decideOn(json.runId, "approved", targets)).status).toBe(200);
  expect((await acceptRun(json.runId)).status).toBe(200);
  return json.runId as string;
}

describe("who may ask", () => {
  test("refuses any Host but its own loopback address and port, on every route", async () => {
    const refused = ["evil.example", `evil.example:${PORT}`, "127.0.0.1", "127.0.0.1:1", "0.0.0.0:4173", "[::1]:1"];
    for (const host of refused) {
      for (const url of ["/api/stories", "/", `/api/images/${UNKNOWN_HASH}`, "/assets/a.js"]) {
        const response = await app.request(url, { headers: { host } });
        expect(response.status, `${host} ${url}`).toBe(403);
        expect(await response.json()).toMatchObject({ error: { code: "bad-host" } });
      }
    }
    expect((await app.request("/api/stories")).status).toBe(403);
    expect((await get("/api/stories", { host: `localhost:${PORT}` })).status).toBe(200);
    expect((await get("/api/stories", { host: HOST })).status).toBe(200);
  });

  describe("a change from another site", () => {
    let runId: string;
    let target: { story: string; imageHash: string };
    beforeEach(async () => {
      h.stories = [{ id: "a" }];
      ({ runId } = (await review()).json);
      const [{ story, imageHash }] = (await viewOf(runId)).rows;
      target = { story, imageHash };
    });
    const body = () => ({ decision: "approved", snapshots: [target] });
    const nothingDecided = async () => expect((await viewOf(runId)).counts.undecided).toBe(1);

    test("is refused for a foreign Origin, even with the header and the type", async () => {
      for (const origin of ["https://evil.example", "null", `http://localhost:${PORT}`, "http://127.0.0.1:1"]) {
        const response = await change(`/api/runs/${runId}/decisions`, body(), { origin });
        expect(response.status, origin).toBe(403);
      }
      await nothingDecided();
    });

    test("is refused as a form could send it", async () => {
      for (const contentType of ["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"]) {
        const response = await app.request(`/api/runs/${runId}/decisions`, {
          method: "POST",
          body: JSON.stringify(body()),
          headers: { host: HOST, "content-type": contentType },
        });
        expect(response.status, contentType).toBe(403);
      }
      await nothingDecided();
    });

    test("is refused without the custom header, or with the wrong type, whatever the Origin", async () => {
      const noHeader = await app.request(`/api/runs/${runId}/decisions`, {
        method: "POST",
        body: JSON.stringify(body()),
        headers: { host: HOST, origin: ORIGIN, "content-type": "application/json" },
      });
      expect(noHeader.status).toBe(403);
      const wrongType = await change(`/api/runs/${runId}/decisions`, body(), { "content-type": "text/plain" });
      expect(wrongType.status).toBe(403);
      const accepting = await app.request(`/api/runs/${runId}/accept`, { method: "POST", body: "{}", headers: { host: HOST } });
      expect(accepting.status).toBe(403);
      await nothingDecided();
    });

    test("gets no CORS answer to a preflight", async () => {
      const response = await app.request(`/api/runs/${runId}/decisions`, {
        method: "OPTIONS",
        headers: {
          host: HOST,
          origin: "https://evil.example",
          "access-control-request-method": "POST",
          "access-control-request-headers": "x-selfie-request,content-type",
        },
      });
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("access-control-allow-headers")).toBeNull();
    });

    test("can't be read or framed", async () => {
      expect((await get("/api/stories", { origin: "https://evil.example" })).status).toBe(403);
      const refused = await get("/api/stories", { host: "evil.example" });
      for (const response of [await get("/"), await get("/api/stories"), refused]) {
        expect(response.headers.get("content-security-policy")).toBe(
          "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        );
        expect(response.headers.get("x-frame-options")).toBe("DENY");
        expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("access-control-allow-origin")).toBeNull();
      }
    });

    test("succeeds from the page itself, by either name", async () => {
      expect((await change(`/api/runs/${runId}/decisions`, body())).status).toBe(200);
      const fromLocalhost = await change(`/api/runs/${runId}/decisions`, body(), {
        host: `localhost:${PORT}`,
        origin: `http://localhost:${PORT}`,
      });
      expect(fromLocalhost.status).toBe(200);
    });
  });
});

describe("pages", () => {
  test("any page is the client's one document, and an unknown API route isn't", async () => {
    for (const url of ["/", `/runs/${UNKNOWN_RUN}`, `/runs/${UNKNOWN_RUN}/accept`, `/runs/${UNKNOWN_RUN}/stories/a%20story%2Fone`]) {
      const response = await get(url);
      expect(await response.text(), url).toContain("the client");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    const unknown = await get("/api/nothing");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "not-found" } });
    expect((await change("/api/nothing", {})).status).toBe(404);
  });

  test("serves assets, but nothing outside the client", async () => {
    const asset = await get("/assets/a.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect((await get("/assets/missing.js")).status).toBe(404);
    for (const url of ["/assets/../../secret.txt", "/assets/..%2f..%2fsecret.txt", "/assets/%2e%2e/%2e%2e/secret.txt", "/..%2fsecret.txt"]) {
      expect(await (await get(url)).text(), url).not.toContain("not for serving");
    }
  });
});

describe("which run", () => {
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

describe("approve and reject", () => {
  let runId: string;
  let rows: any[];
  const target = (story: string) => {
    const { imageHash } = rows.find((row) => row.story === story);
    return { story, imageHash };
  };
  beforeEach(async () => {
    h.stories = [{ id: "a" }, { id: "b", color: BLUE }, { id: "c", color: GREEN }];
    await makeGoldens();
    await commit(h.repo, "next");
    h.stories = [{ id: "a", color: GREEN }, { id: "b", color: RED }, { id: "c", failed: "broke" }, { id: "d" }];
    ({ runId } = (await review()).json);
    ({ rows } = await viewOf(runId));
  });

  test("records exactly the images asked for, as Git's user, and answers with the run recomputed", async () => {
    const before = await viewOf(runId);
    expect(before.counts.undecided).toBe(3);

    const response = await decideOn(runId, "approved", [target("a")]);
    expect(response.status).toBe(200);
    const after = (await response.json()) as any;
    expect(after.counts.undecided).toBe(2);
    expect(after.rows.find(({ story }: any) => story === "a").decision).toMatchObject({ decision: "approved", actor: "tester@example.com" });
    expect(after.rows.find(({ story }: any) => story === "b").decision).toBeNull();
    expect(after.blockers.find(({ story }: any) => story === "a")).toBeUndefined();
    expect(await viewOf(runId)).toEqual(after);
  });

  test("reject blocks, and a later approval replaces it", async () => {
    const rejected = (await (await decideOn(runId, "rejected", [target("a")])).json()) as any;
    expect(rejected.blockers.find(({ story }: any) => story === "a")).toMatchObject({ reason: "rejected", detail: "tester@example.com" });
    const approved = (await (await decideOn(runId, "approved", [target("a")])).json()) as any;
    expect(approved.blockers.find(({ story }: any) => story === "a")).toBeUndefined();
  });

  test("decides on many at once, or refuses them all if one isn't what the run holds", async () => {
    const stale = await decideOn(runId, "approved", [target("a"), { story: "b", imageHash: UNKNOWN_HASH }]);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "stale-decision" } });
    expect((await viewOf(runId)).counts.undecided).toBe(3);

    const all = (await (await decideOn(runId, "approved", [target("a"), target("b"), target("d")])).json()) as any;
    expect(all.counts.undecided).toBe(0);
  });

  test("refuses what has no image to decide on, and what the run doesn't have", async () => {
    const failed = await decideOn(runId, "approved", [{ story: "c", imageHash: rows.find(({ story }) => story === "c").goldenHash }]);
    expect(failed.status).toBe(409);
    expect((await decideOn(runId, "approved", [{ story: "nobody", imageHash: target("a").imageHash }])).status).toBe(409);
  });

  test("compares at most twice, and never reads the unchanged rows", async () => {
    const compareRun = project.snapshots.compareRun.bind(project.snapshots);
    const options: unknown[] = [];
    project.snapshots.compareRun = (id, baseline, compareOptions) => {
      options.push(compareOptions);
      return compareRun(id, baseline, compareOptions);
    };
    expect((await decideOn(runId, "approved", [target("a")])).status).toBe(200);
    expect(options).toEqual([{ includeUnchanged: false }, undefined]);
    options.length = 0;
    await viewOf(runId);
    expect(options).toHaveLength(1);
    options.length = 0;
    await acceptRun(runId);
    expect(options).toHaveLength(1);
  });

  test("takes a story ID as itself, never as a pattern", async () => {
    h.stories = [{ id: "a*", color: BLUE }, { id: "ab", color: BLUE }];
    const { runId: starred } = (await review()).json;
    const { rows: starredRows } = await viewOf(starred);
    const star = starredRows.find(({ story }: any) => story === "a*");
    const after = (await (await decideOn(starred, "approved", [{ story: "a*", imageHash: star.imageHash }])).json()) as any;
    expect(after.rows.find(({ story }: any) => story === "a*").decision).toMatchObject({ decision: "approved" });
    expect(after.rows.find(({ story }: any) => story === "ab").decision).toBeNull();
  });

  test("refuses a malformed request", async () => {
    for (const body of [
      "not json",
      "[]",
      {},
      { decision: "maybe", snapshots: [target("a")] },
      { decision: "approved" },
      { decision: "approved", snapshots: [] },
      { decision: "approved", snapshots: "all" },
      { decision: "approved", snapshots: [{ story: "a" }] },
      { decision: "approved", snapshots: [{ story: "", imageHash: target("a").imageHash }] },
      { decision: "approved", snapshots: [{ story: "a", imageHash: "nope" }] },
      { decision: "approved", snapshots: [null] },
    ]) {
      const response = await change(`/api/runs/${runId}/decisions`, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "bad-request" } });
    }
    expect((await viewOf(runId)).counts.undecided).toBe(3);
  });

  test("refuses with no actor, in words, and records nothing", async () => {
    git(h.repo, "config", "user.email", "");
    const response = await decideOn(runId, "approved", [target("a")]);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "no-actor", message: expect.stringContaining("user.email") } });
    expect((await viewOf(runId)).actor).toBeNull();
    expect((await viewOf(runId)).counts.undecided).toBe(3);
  });

  test("holds at a later commit in the same store", async () => {
    await decideOn(runId, "approved", [target("a")]);
    await commit(h.repo, "again");
    const later = await viewOf((await review()).json.runId);
    expect(later.rows.find(({ story }: any) => story === "a").decision).toMatchObject({ decision: "approved" });
  });
});

describe("accept", () => {
  const refusalReasons = (list: readonly any[]) => list.map(({ reason }) => reason);

  test("a view says what stops it before anyone asks, and asking accepts nothing", async () => {
    h.stories = [{ id: "a" }, { id: "b", failed: "broke" }];
    const { runId } = (await review()).json;
    const view = await viewOf(runId);
    expect(refusalReasons(view.refusals)).toEqual(["run-has-failures", "unapproved"]);
    expect(view.acceptedRunId).toBeNull();
    const { accepted, refusals, view: after } = (await (await acceptRun(runId)).json()) as any;
    expect(accepted).toBe(false);
    expect(refusalReasons(refusals)).toEqual(["run-has-failures", "unapproved"]);
    expect(after.acceptedRunId).toBeNull();
  });

  test("refuses a run recorded on a dirty tree, even once the tree is clean", async () => {
    h.stories = [{ id: "a" }];
    await writeFile(path.join(h.repo, "scratch.txt"), "dirty");
    const { runId } = (await review()).json;
    await rm(path.join(h.repo, "scratch.txt"));
    const view = await viewOf(runId);
    expect(view.run.dirty).toBe(true);
    await decideOn(runId, "approved", [{ story: "a", imageHash: view.rows[0].imageHash }]);
    const outcome = (await (await acceptRun(runId)).json()) as any;
    expect(outcome.accepted).toBe(false);
    expect(outcome.refusals).toEqual([{ reason: "recorded-on-dirty-tree", gitSha: view.run.gitSha }]);
  });

  test("accepts once approved, recomputed, and the next review reads it as a baseline", async () => {
    h.stories = [{ id: "a" }];
    const { runId } = (await review()).json;
    const { rows } = await viewOf(runId);
    await decideOn(runId, "approved", [{ story: "a", imageHash: rows[0].imageHash }]);
    expect((await viewOf(runId)).refusals).toEqual([]);
    const outcome = (await (await acceptRun(runId)).json()) as any;
    expect(outcome).toMatchObject({ accepted: true, refusals: [] });
    expect(outcome.view.acceptedRunId).toBe(runId);
    const later = (await review()).json;
    expect(later.counts).toMatchObject({ unchanged: 1, new: 0 });
  });

  test("a removal must be acknowledged, with the count there is", async () => {
    h.stories = [{ id: "a" }, { id: "b" }];
    await makeGoldens();
    await commit(h.repo, "drop b");
    h.stories = [{ id: "a" }];
    const { runId } = (await review()).json;
    const view = await viewOf(runId);
    expect(view.removals).toEqual({ stories: ["b"], outsideFilter: 0 });
    expect(view.rows).toMatchObject([{ story: "b", state: "removed", imageHash: null }]);
    expect(refusalReasons(view.refusals)).toEqual(["removed-unacknowledged"]);

    const unacknowledged = (await (await acceptRun(runId)).json()) as any;
    expect(unacknowledged.accepted).toBe(false);
    expect(unacknowledged.refusals).toMatchObject([{ reason: "removed-unacknowledged", stories: ["b"], outsideFilter: 0 }]);

    const wrong = (await (await acceptRun(runId, { removedSeen: 2 })).json()) as any;
    expect(wrong.accepted).toBe(false);
    expect(wrong.refusals).toMatchObject([{ reason: "wrong-removed-count", seen: 2, stories: ["b"] }]);
    expect(wrong.view.acceptedRunId).toBeNull();

    const zero = (await (await acceptRun(runId, { removedSeen: 0 })).json()) as any;
    expect(zero.accepted).toBe(false);

    const right = (await (await acceptRun(runId, { removedSeen: 1 })).json()) as any;
    expect(right).toMatchObject({ accepted: true, refusals: [] });
    expect(right.view.acceptedRunId).toBe(runId);
  });

  test("a filtered run lists what it would drop, and says which is only outside the filter", async () => {
    h.stories = [{ id: "a" }, { id: "b" }];
    await makeGoldens();
    await commit(h.repo, "next");
    const { runId } = (await review("--story", "a")).json;
    const view = await viewOf(runId);
    expect(view.removals).toEqual({ stories: ["b"], outsideFilter: 1 });
    expect(view.rows).toEqual([]);
    expect(view.counts.removed).toBe(0);
    expect(view.refusals).toMatchObject([{ reason: "removed-unacknowledged", outsideFilter: 1 }]);
  });

  test("shows a run with no baseline against its branch's goldens, and accepts by its own rules", async () => {
    h.stories = [{ id: "a" }, { id: "b" }];
    git(h.repo, "switch", "--quiet", "-c", "feature");
    await commit(h.repo, "on a branch");
    const first = (await review()).json;
    await h.cli("approve", first.runId, "--all");
    await h.cli("accept", first.runId);
    await commit(h.repo, "more on the branch");
    h.stories = [{ id: "a", color: BLUE }, { id: "b" }];
    const { runId } = (await review()).json;
    const view = await viewOf(runId);
    expect(view.run.baselineSha).toBeNull();
    expect(view.branchGoldens).toBe(first.gitSha);
    expect(view.rows.map(({ story, state }: any) => [story, state])).toEqual([["a", "changed"]]);
    expect(view.counts).toMatchObject({ unchanged: 1, changed: 1 });
    expect(view.refusals).toEqual([{ reason: "unapproved", stories: [{ story: "a", state: "new", decision: null }] }]);
    const unchanged = (await (await get(`/api/runs/${runId}/unchanged`)).json()) as any;
    expect(unchanged.rows.map(({ story }: any) => story)).toEqual(["b"]);

    const after = (await (await change(`/api/runs/${runId}/decisions`, { decision: "approved", snapshots: view.rows.map(({ story, imageHash }: any) => ({ story, imageHash })) })).json()) as any;
    expect(after.branchGoldens).toBe(first.gitSha);
    expect(after.refusals).toEqual([]);
  });

  test("says when a commit can't be a baseline, and still accepts", async () => {
    h.stories = [{ id: "a" }];
    await makeGoldens();
    git(h.repo, "switch", "--quiet", "-c", "feature");
    await commit(h.repo, "on a branch");
    const { runId } = (await review()).json;
    const view = await viewOf(runId);
    expect(view.usableAsBaseline).toBe(false);
    const outcome = (await (await acceptRun(runId)).json()) as any;
    expect(outcome.accepted).toBe(true);
    expect(outcome.view.usableAsBaseline).toBe(false);
  });

  test("refuses a bad count outright", async () => {
    h.stories = [{ id: "a" }];
    const { runId } = (await review()).json;
    for (const removedSeen of [-1, 1.5, "1", null]) {
      expect((await acceptRun(runId, { removedSeen })).status, String(removedSeen)).toBe(400);
    }
  });
});

/** Every module a Node process loads to import this file, by a hook that sees each resolved. */
function modulesLoadedBy(file: string): string[] {
  const script = `
    import { registerHooks } from "node:module";
    const seen = [];
    registerHooks({ resolve(specifier, context, next) { const result = next(specifier, context); seen.push(result.url); return result; } });
    await import(${JSON.stringify(pathToFileURL(file).href)});
    console.log(JSON.stringify(seen));
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }));
}

describe("what each entry point loads", () => {
  const root = path.resolve(import.meta.dirname, "../..");

  test("the CLI loads no web server until a command that serves asks for one", () => {
    const loaded = modulesLoadedBy(path.join(root, "cli/src/cli.ts"));
    expect(loaded.length).toBeGreaterThan(5);
    expect(loaded.filter((url) => url.includes("hono") || url.includes("/ui/src/server/") || url.includes("/ui/src/client/"))).toEqual([]);
  });

  test("the routes and their protections need nothing of a platform", () => {
    const loaded = modulesLoadedBy(path.join(root, "ui/src/server/app.ts"));
    expect(loaded.filter((url) => url.startsWith("node:") || url.includes("/server/local") || url.includes("@hono/node-server"))).toEqual([]);
  });
});

describe("selfie ui", () => {
  const serve = async (command: string, ...argv: string[]) => {
    const stop = new AbortController();
    let stdout = "";
    let stderr = "";
    let onPrinted: () => void;
    const printed = new Promise<void>((resolve) => {
      onPrinted = resolve;
    });
    const exit = runCli([command, ...argv], {
      cwd: h.repo,
      env: { SELFIE_HOME: h.home },
      stdout: (text) => {
        stdout += text;
        onPrinted();
      },
      stderr: (text) => {
        stderr += text;
      },
      signal: stop.signal,
      uiClientDir: clientDir,
    });
    await Promise.race([printed, exit]);
    return { stop, exit, json: () => JSON.parse(stdout), stderr: () => stderr };
  };
  const start = (...argv: string[]) => serve("ui", ...argv);

  describe("selfie, with no command", () => {
    const opened: string[] = [];
    const bare = async (...argv: string[]) => {
      const stop = new AbortController();
      let stdout = "";
      let stderr = "";
      let onPrinted: () => void;
      const printed = new Promise<void>((resolve) => {
        onPrinted = resolve;
      });
      const exit = runCli(argv, {
        cwd: h.repo,
        env: { SELFIE_HOME: h.home },
        stdout: (text) => {
          stdout += text;
          onPrinted();
        },
        stderr: (text) => {
          stderr += text;
        },
        openBrowser: (url) => opened.push(url),
        signal: stop.signal,
        uiClientDir: clientDir,
      });
      await Promise.race([printed, exit]);
      return { stop, exit, json: () => JSON.parse(stdout), stderr: () => stderr };
    };
    const dir = () => path.join(h.scratch, "a-storybook");
    const writeBuild = async () => {
      await mkdir(dir(), { recursive: true });
      await writeFile(path.join(dir(), "iframe.html"), "<!doctype html><title>the preview</title>");
      await writeFile(path.join(dir(), "index.json"), JSON.stringify({ entries: { a: { type: "story", id: "a" } } }));
    };
    const config = (fields: Record<string, unknown>) => writeFile(path.join(h.repo, "selfie.config.json"), JSON.stringify(fields));
    /** A build the config says how to run, which leaves a mark at the top level it ran from. */
    const buildScript = async () => {
      const script = path.join(h.scratch, "build.mjs");
      await writeFile(script, `import { mkdirSync, writeFileSync } from "node:fs"; writeFileSync("built-here", ""); mkdirSync(${JSON.stringify(dir())}, { recursive: true }); writeFileSync(${JSON.stringify(path.join(dir(), "iframe.html"))}, "built"); writeFileSync(${JSON.stringify(path.join(dir(), "index.json"))}, '{"entries":{}}');`);
      return `node ${script}`;
    };

    beforeEach(() => {
      opened.length = 0;
    });

    test("opens at every story, in a browser, and says where", async () => {
      await writeBuild();
      const { stop, exit, json, stderr } = await bare("--storybook-dir", dir());
      const { url, port, storybookUrl, runId } = json();
      expect(url).toBe(`http://127.0.0.1:${port}/`);
      expect(runId).toBeNull();
      expect(stderr()).toContain(url);
      expect(opened).toEqual([url]);
      const { stories, canCapture } = (await (await fetch(`http://127.0.0.1:${port}/api/stories`)).json()) as StoriesView;
      expect(stories).toEqual([{ story: "a", title: "", name: "", capture: null }]);
      expect(canCapture).toBe(true);
      expect(await (await fetch(`${storybookUrl}iframe.html`)).text()).toContain("the preview");
      stop.abort();
      expect(await exit).toBe(0);
    });

    test("--no-open leaves the browser alone", async () => {
      await writeBuild();
      const { stop, exit } = await bare("--storybook-dir", dir(), "--no-open");
      expect(opened).toEqual([]);
      stop.abort();
      expect(await exit).toBe(0);
    });

    test("runs the config's build command first, from the Git top level, saying what it is", async () => {
      const command = await buildScript();
      await config({ buildCommand: command });
      const { stop, exit, json, stderr } = await bare("--storybook-dir", dir());
      expect(stderr()).toContain(`Building: ${command}`);
      expect(await (await fetch(`${json().storybookUrl}iframe.html`)).text()).toBe("built");
      await expect(readdir(h.repo)).resolves.toContain("built-here");
      stop.abort();
      expect(await exit).toBe(0);
    });

    test("--no-build doesn't run it", async () => {
      await writeBuild();
      await config({ buildCommand: await buildScript() });
      const { stop, exit, stderr } = await bare("--storybook-dir", dir(), "--no-build");
      expect(stderr()).not.toContain("Building:");
      await expect(readdir(h.repo)).resolves.not.toContain("built-here");
      stop.abort();
      expect(await exit).toBe(0);
    });

    test("with no build yet, still serves, for the page to say what to do", async () => {
      const { stop, exit, json, stderr } = await bare("--storybook-dir", path.join(h.scratch, "nothing-here"));
      expect(stderr()).toContain("There's no built Storybook");
      expect(opened).toEqual([json().url]);
      const { canCapture, setup } = (await (await fetch(`${json().url}api/stories`)).json()) as StoriesView;
      expect(canCapture).toBe(false);
      expect(setup?.buildCommand).toBeNull();
      stop.abort();
      expect(await exit).toBe(0);
    });

    test("says so if the build fails", async () => {
      await config({ buildCommand: "exit 3" });
      const failing = await bare();
      expect(await failing.exit).toBe(2);
      expect(failing.json().error.code).toBe("build-failed");
    });

    test("doesn't spend a build finding out the config is bad", async () => {
      await config({ buildCommand: await buildScript(), notAKey: true });
      const refused = await bare();
      expect(await refused.exit).toBe(2);
      expect(refused.json().error.code).toBe("bad-config");
      await expect(readdir(h.repo)).resolves.not.toContain("built-here");
    });

    test.each([[""], ["  "], [3]])("refuses a build command of %j", async (buildCommand) => {
      await config({ buildCommand });
      const refused = await bare("--no-build");
      expect(await refused.exit).toBe(2);
      expect(refused.json().error.code).toBe("bad-config");
    });

    test("refuses a bad port, an argument, and takes an unknown word for a command", async () => {
      const port = await bare("--port", "http");
      expect(await port.exit).toBe(2);
      expect(port.json().error.code).toBe("usage");
      const unknown = await bare("frobnicate");
      expect(await unknown.exit).toBe(2);
      expect(unknown.json().error.message).toContain("Unknown command");
    });

    test("record and review never run the config's build, unless told to", async () => {
      h.stories = [{ id: "a" }];
      await writeBuild();
      await config({ buildCommand: await buildScript() });
      for (const command of ["record", "review"]) {
        expect((await h.cli(command, "--storybook-dir", dir())).code, command).not.toBe(2);
        await expect(readdir(h.repo)).resolves.not.toContain("built-here");
      }
      await rm(path.join(h.repo, "built-here"), { force: true });
      const built = await h.cli("record", "--storybook-dir", dir(), "--build");
      expect(built.code).toBe(0);
      await expect(readdir(h.repo)).resolves.toContain("built-here");
    });

    test("--build says so if the config has no build command", async () => {
      const refused = await h.cli("record", "--storybook-dir", "ignored", "--build");
      expect(refused.code).toBe(2);
      expect(refused.json.error).toMatchObject({ code: "usage", message: expect.stringContaining("buildCommand") });
    });
  });

  test("hosts a Storybook on a port of its own, saying where, and --storybook-dir picks which", async () => {
    const dir = path.join(h.scratch, "a-storybook");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "iframe.html"), "<!doctype html><title>the preview</title>");
    const { stop, exit, json } = await start("--storybook-dir", dir);
    const { port, storybookUrl, url } = json();
    expect(new URL(storybookUrl).port).not.toBe(String(port));
    const frame = await fetch(`${storybookUrl}iframe.html`);
    expect(await frame.text()).toContain("the preview");
    // They're each told about the other, whichever name the review page is open under.
    expect(frame.headers.get("content-security-policy")).toBe(`frame-ancestors 'self' http://127.0.0.1:${port} http://localhost:${port}`);
    expect((await fetch(url)).headers.get("content-security-policy")).toContain(`frame-src ${new URL(storybookUrl).origin};`);
    stop.abort();
    expect(await exit).toBe(0);
    await expect(fetch(storybookUrl)).rejects.toThrow();
  });

  test("prints one document with its URL, serves on it, and stops when told", async () => {
    const { stop, exit, json, stderr } = await start();
    const { url, port, runId } = json();
    expect(url).toBe(`http://127.0.0.1:${port}/`);
    expect(runId).toBeNull();
    expect(stderr()).toContain("Serving");
    const page = await fetch(url);
    expect(await page.text()).toContain("the client");
    expect((await fetch(`${url}api/stories`)).status).toBe(200);
    stop.abort();
    expect(await exit).toBe(0);
    await expect(fetch(url)).rejects.toThrow();
  });

  test("opens at a run if it's given one, and refuses one it doesn't know", async () => {
    h.stories = [{ id: "a" }];
    const { runId } = (await review()).json;
    const { stop, exit, json } = await start(runId);
    expect(json().url).toMatch(new RegExp(`/runs/${runId}$`));
    expect(json().runId).toBe(runId);
    stop.abort();
    expect(await exit).toBe(0);

    for (const [run, code] of [
      [UNKNOWN_RUN, "unknown-run"],
      ["nope", "bad-run-id"],
    ] as const) {
      const refused = await start(run);
      expect(await refused.exit).toBe(2);
      expect(refused.json().error.code).toBe(code);
    }
  });

  test("refuses a bad port or extra arguments", async () => {
    for (const argv of [["--port", "99999"], ["--port", "http"], [UNKNOWN_RUN, UNKNOWN_RUN]]) {
      const refused = await start(...argv);
      expect(await refused.exit, argv.join(" ")).toBe(2);
      expect(refused.json().error.code).toBe("usage");
    }
  });

  test("says how to build the client if it isn't built", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "selfie-ui-empty-"));
    try {
      let stdout = "";
      const code = await runCli(["ui"], {
        cwd: h.repo,
        env: { SELFIE_HOME: h.home },
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {},
        uiClientDir: empty,
      });
      expect(code).toBe(2);
      expect(JSON.parse(stdout).error).toMatchObject({ code: "ui-not-built", message: expect.stringContaining("pnpm") });
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  test("listens only on loopback", async () => {
    const source = localReviewSource(project);
    const server: LocalServer = await serveLocal({ source, port: 0, clientDir });
    try {
      expect((await fetch(`${server.url}api/stories`)).status).toBe(200);
      const external = Object.values(networkInterfaces())
        .flat()
        .filter((address) => address !== undefined && !address.internal && address.family === "IPv4");
      for (const address of external) {
        await expect(fetch(`http://${address!.address}:${server.port}/api/stories`)).rejects.toThrow();
      }
    } finally {
      await server.close();
    }
  });
});

describe("the hosted Storybook", () => {
  const STORYBOOK_PORT = 51234;
  let dir: string;
  const hostedAt = `http://127.0.0.1:${STORYBOOK_PORT}/`;

  const built = async () => {
    await mkdir(path.join(dir, "assets"), { recursive: true });
    await writeFile(path.join(dir, "index.html"), "<!doctype html><title>the manager</title>");
    await writeFile(path.join(dir, "iframe.html"), "<!doctype html><title>the preview</title>");
    await writeFile(path.join(dir, "index.json"), "{}");
    await writeFile(path.join(dir, "assets", "story.js"), "export {};");
  };

  const storybook = () => createStorybookApp({ dir, port: () => STORYBOOK_PORT, readBuildFile: (build, file) => project.builds.readFile(build, file), reviewOrigins: () => [ORIGIN] });
  const read = (url: string, host = `127.0.0.1:${STORYBOOK_PORT}`) => storybook().request(url, { headers: { host } });

  beforeEach(() => {
    dir = path.join(h.scratch, "storybook-static");
  });

  test("is nothing, until it's a built Storybook", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "secret.txt"), "not a build");
    expect((await read("/secret.txt")).status).toBe(404);
  });

  describe("what it serves", () => {
    beforeEach(built);

    test("is a build's own files, and nothing is kept", async () => {
      const page = await read("/");
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("the manager");
      expect(page.headers.get("cache-control")).toBe("no-store");
      expect(page.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await (await read("/assets/story.js")).text()).toBe("export {};");
    });

    test("lets Storybook and the review page frame it, and nobody else", async () => {
      const { headers } = await read("/iframe.html");
      expect(headers.get("content-security-policy")).toBe(`frame-ancestors 'self' ${ORIGIN}`);
      // It can't name another origin, and would refuse the review page.
      expect(headers.get("x-frame-options")).toBeNull();
    });

    test("stays inside the build", async () => {
      for (const url of ["/..%2fsecret.txt", "/%2e%2e%2fsecret.txt", "/assets/..%2f..%2fsecret.txt"]) {
        expect((await read(url)).status, url).toBe(404);
      }
    });

    test("is only to read", async () => {
      const response = await storybook().request("/index.json", { method: "POST", headers: { host: `127.0.0.1:${STORYBOOK_PORT}` } });
      expect(response.status).toBe(405);
    });

    test("answers only to its own loopback address", async () => {
      expect((await read("/", "evil.example")).status).toBe(403);
      expect((await read("/", HOST)).status).toBe(403);
    });
  });

  test("the review page may frame only the hosted Storybook", async () => {
    const framing = createLocalApp({ source: localReviewSource(project), port: () => PORT, clientDir, storybookOrigin: "http://127.0.0.1:51234" });
    const { headers } = await framing.request("/", { headers: { host: HOST } });
    const policy = headers.get("content-security-policy");
    expect(policy).toContain("frame-src http://127.0.0.1:51234;");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(headers.get("x-frame-options")).toBe("DENY");
  });

  test("the review API refuses a story's page, since it's another origin", async () => {
    await built();
    const hosted = await serveStorybook({ dir, readBuildFile: async () => null, reviewOrigins: () => [] });
    const server = await serveLocal({ source: localReviewSource(project), port: 0, clientDir });
    try {
      expect(new URL(hosted.url).port).not.toBe(String(server.port));
      expect((await fetch(`${hosted.url}api/stories`)).status).toBe(404);
      const fromStory = await fetch(`${server.url}api/stories`, { headers: { origin: hosted.url.slice(0, -1) } });
      expect(fromStory.status).toBe(403);
    } finally {
      await Promise.all([hosted.close(), server.close()]);
    }
  });

  describe("a kept build", () => {
    const hash = "a".repeat(64);
    const kept = async () => {
      const files = [
        { path: "index.html", fileHash: await project.builds.putFile(new TextEncoder().encode("<!doctype html><title>kept</title>")) },
        { path: "assets/a b.js", fileHash: await project.builds.putFile(new TextEncoder().encode("export {};")) },
      ];
      await project.builds.putBuild(hash, files);
    };

    test("serves its files, and a browser may keep them", async () => {
      await kept();
      const page = await read(`/storybook-builds/${hash}/`);
      expect(await page.text()).toContain("kept");
      expect(page.headers.get("content-type")).toContain("text/html");
      expect(page.headers.get("cache-control")).toContain("immutable");
      expect(page.headers.get("content-security-policy")).toBe(`frame-ancestors 'self' ${ORIGIN}`);
      const script = await read(`/storybook-builds/${hash}/assets/a%20b.js`);
      expect(await script.text()).toBe("export {};");
      expect(script.headers.get("content-type")).toContain("javascript");
    });

    test.each(["/storybook-builds/nope/", `/storybook-builds/${"b".repeat(64)}/`, `/storybook-builds/${hash}/missing.js`, `/storybook-builds/${hash}/..%2f..%2fsecret.txt`, `/storybook-builds/${hash}/%ff`])(
      "has no such thing as %s",
      async (url) => {
        await kept();
        expect((await read(url)).status).toBe(404);
      },
    );

    test("answers only to its own loopback address, and is only to read", async () => {
      await kept();
      expect((await read(`/storybook-builds/${hash}/`, "evil.example")).status).toBe(403);
      const post = await storybook().request(`/storybook-builds/${hash}/`, { method: "POST", headers: { host: `127.0.0.1:${STORYBOOK_PORT}` } });
      expect(post.status).toBe(405);
    });
  });

  describe("every story, as the newest capture of each", () => {
    const live = () => localReviewSource(project, { storybook: { dir, url: hostedAt } }).storiesView();
    const withStories = async (...ids: string[]) => {
      await built();
      await writeFile(path.join(dir, "index.json"), JSON.stringify({ entries: Object.fromEntries(ids.map((id) => [id, { type: "story", id, title: "T", name: id }])) }));
    };
    const recorded = async (...flags: string[]) => (await h.cli("record", "--storybook-dir", dir, ...flags)).json.runId as string;
    const capturesOf = async () => Object.fromEntries((await live()).stories.map(({ story, capture }) => [story, capture]));

    beforeEach(() => {
      h.stories = [{ id: "a" }, { id: "b" }, { id: "c" }];
    });

    test("lists what no run has captured, with nothing to say of it", async () => {
      await withStories("a", "b");
      const view = await live();
      expect(view.stories).toEqual([
        { story: "a", title: "T", name: "a", capture: null },
        { story: "b", title: "T", name: "b", capture: null },
      ]);
      expect(view.newestRunId).toBeNull();
      expect(view.storybookUrl).toBe(hostedAt);
      expect(view.viewport).toEqual({ width: 1200, height: 900 });
    });

    test("merges partial runs, each story from the newest that has it, and never reads a left-out story as removed", async () => {
      await withStories("a", "b", "c");
      const whole = await recorded();
      const partial = await recorded("--story", "b");
      const captures = await capturesOf();
      expect(captures.a).toMatchObject({ runId: whole, state: "new" });
      expect(captures.b).toMatchObject({ runId: partial, state: "new", fromHostedBuild: true, dirty: false });
      expect(captures.c).toMatchObject({ runId: whole });
      expect((await live()).newestRunId).toBe(partial);
    });

    test("keeps the order the build lists them in, and what it calls them", async () => {
      await withStories("z", "a", "m");
      const { stories } = await live();
      expect(stories.map(({ story }) => story)).toEqual(["z", "a", "m"]);
      expect(stories[0]).toMatchObject({ title: "T", name: "z" });
    });

    test("leaves a story out if the build no longer has it, and lists a new one as not captured", async () => {
      await withStories("a", "b");
      await recorded();
      await withStories("a", "d");
      const captures = await capturesOf();
      expect(Object.keys(captures)).toEqual(["a", "d"]);
      expect(captures.d).toBeNull();
    });

    test("keeps looking through older runs for a story, even with one captured that's gone from the build", async () => {
      await withStories("a", "b", "c");
      const whole = await recorded();
      h.stories = [{ id: "gone" }, { id: "a" }];
      const newer = await recorded();
      await withStories("a", "b", "c");
      const captures = await capturesOf();
      expect(captures.a).toMatchObject({ runId: newer });
      expect(captures.b).toMatchObject({ runId: whole });
      expect(captures.c).toMatchObject({ runId: whole });
    });

    test("doesn't say a capture without a recorded build came from another", async () => {
      h.stories = [{ id: "a" }];
      await review();
      await withStories("a");
      expect((await capturesOf()).a).toMatchObject({ fromHostedBuild: null });
    });

    test("notices any file of the build changing, not only its index", async () => {
      await withStories("a");
      await recorded();
      const source = localReviewSource(project, { storybook: { dir, url: hostedAt } });
      const fromHosted = async () => (await source.storiesView()).stories[0]!.capture?.fromHostedBuild;
      expect(await fromHosted()).toBe(true);
      await writeFile(path.join(dir, "assets", "story.js"), "export const changed = true;");
      expect(await fromHosted()).toBe(false);
    });

    test("says when a capture came from another build, or uncommitted changes", async () => {
      await withStories("a");
      await recorded();
      await writeFile(path.join(dir, "assets", "story.js"), "export const changed = true;");
      expect((await capturesOf()).a).toMatchObject({ fromHostedBuild: false, dirty: false });
      await writeFile(path.join(h.repo, "file.txt"), "uncommitted\n");
      await recorded();
      expect((await capturesOf()).a).toMatchObject({ fromHostedBuild: true, dirty: true });
    });

    test("carries a decision on the image, which can go with it into a clean run", async () => {
      await withStories("a");
      const runId = await recorded();
      expect((await capturesOf()).a).toMatchObject({ decision: null });
      await h.cli("approve", runId, "--all");
      expect((await capturesOf()).a).toMatchObject({ decision: { decision: "approved" } });
    });

    test("with no build, lists what's been captured, and says there's no build", async () => {
      h.stories = [{ id: "a" }];
      await review();
      const view = await live();
      expect(view.storybookUrl).toBeNull();
      expect(view.stories.map(({ story }) => story)).toEqual(["a"]);
    });

    test("says where saving a first story stands", async () => {
      expect((await live()).setup).toEqual({ storybookDir: expect.any(String), buildCommand: null, uncommitted: [], usesDocker: true });
      await writeFile(path.join(h.repo, "changed.txt"), "not committed");
      expect((await live()).setup?.uncommitted).toEqual(["changed.txt"]);
      await writeFile(path.join(h.repo, "selfie.config.json"), JSON.stringify({ buildCommand: "make stories" }));
      expect((await live()).setup?.buildCommand).toBe("make stories");
    });

    test("can't capture with no commit to keep it with, nor say more than a server that hosts nothing knows", async () => {
      expect((await localReviewSource(project).storiesView()).setup).toBeNull();
      await withStories("a");
      const record = async () => "r";
      expect((await localReviewSource(project, { storybook: { dir, url: hostedAt, record } }).storiesView()).canCapture).toBe(true);
      const empty = path.join(h.scratch, "no-commits");
      git(h.scratch, "init", "--quiet", "--initial-branch=main", empty);
      const uncommitted = await openProject({ cwd: empty, env: { SELFIE_HOME: h.home } });
      const view = await localReviewSource(uncommitted, { storybook: { dir, url: hostedAt, record } }).storiesView();
      expect(view).toMatchObject({ head: null, canCapture: false });
    });

    test("answers at /api/stories", async () => {
      const response = await get("/api/stories");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ stories: [] });
    });
  });

  describe("capturing from the page", () => {
    const withStories = async (...ids: string[]) => {
      await built();
      await writeFile(path.join(dir, "index.json"), JSON.stringify({ entries: Object.fromEntries(ids.map((id) => [id, { type: "story", id }])) }));
    };
    const asked: (readonly string[] | undefined)[] = [];
    const sourceRecording = (record: StoryRecorder) => localReviewSource(project, { storybook: { dir, url: hostedAt, record } });

    beforeEach(() => {
      asked.length = 0;
    });

    test("records just those stories, and says which run", async () => {
      await withStories("a", "b", "c");
      const source = sourceRecording(async (stories) => {
        asked.push(stories);
        return "the-run";
      });
      expect(await source.capture(["a", "b"])).toEqual({ runId: "the-run" });
      expect(asked).toEqual([["a", "b"]]);
    });

    test("asking for every story is a whole run, which can become goldens", async () => {
      await withStories("a", "b");
      const source = sourceRecording(async (stories) => {
        asked.push(stories);
        return "the-run";
      });
      await source.capture(["b", "a"]);
      expect(asked).toEqual([undefined]);
    });

    test("refuses a story the build doesn't have, or a second capture at once", async () => {
      await withStories("a");
      let finish = () => {};
      const blocked = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const source = sourceRecording(async () => {
        await blocked;
        return "the-run";
      });
      await expect(source.capture(["nope"])).rejects.toMatchObject({ code: "unknown-story" });
      const first = source.capture(["a"]);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await expect(source.capture(["a"])).rejects.toMatchObject({ code: "capture-busy" });
      finish();
      await expect(first).resolves.toEqual({ runId: "the-run" });
      await expect(source.capture(["a"])).resolves.toEqual({ runId: "the-run" });
    });

    test("says why it failed, and can capture again after", async () => {
      await withStories("a");
      let failing = true;
      const source = sourceRecording(async () => {
        if (failing) throw new Error("Docker is unavailable");
        return "the-run";
      });
      await expect(source.capture(["a"])).rejects.toMatchObject({ code: "capture-failed", message: expect.stringContaining("Docker is unavailable") });
      failing = false;
      await expect(source.capture(["a"])).resolves.toEqual({ runId: "the-run" });
    });

    test("isn't offered with no build, or nothing to record with", async () => {
      expect((await localReviewSource(project, { storybook: { dir, url: hostedAt, record: async () => "r" } }).storiesView()).canCapture).toBe(false);
      await withStories("a");
      expect((await localReviewSource(project, { storybook: { dir, url: hostedAt } }).storiesView()).canCapture).toBe(false);
      expect((await sourceRecording(async () => "r").storiesView()).canCapture).toBe(true);
      await expect(localReviewSource(project).capture(["a"])).rejects.toMatchObject({ code: "capture-failed" });
    });

    test("answers at /api/captures, only to a change from the page", async () => {
      const refused = await app.request("/api/captures", { method: "POST", headers: { host: HOST, "content-type": "application/json" }, body: JSON.stringify({ stories: ["a"] }) });
      expect(refused.status).toBe(403);
      for (const stories of [undefined, [], [1], [""]]) {
        expect((await change("/api/captures", { stories })).status, JSON.stringify(stories)).toBe(400);
      }
      expect((await change("/api/captures", { stories: ["a"] })).status).toBe(409);
    });
  });

  describe("what a run links to", () => {
    const hosted = () => localReviewSource(project, { storybook: { dir, url: hostedAt } });
    const reviewedBuild = async (...flags: string[]) => (await h.cli("review", "--storybook-dir", dir, ...flags)).json.runId as string;
    const linkOf = async (runId: string) => (await hosted().runView(runId)).storybook;

    beforeEach(() => {
      h.stories = [{ id: "a" }, { id: "b" }];
    });

    test("nothing, with no build, or nothing hosted", async () => {
      const runId = (await review()).json.runId as string;
      expect(await linkOf(runId)).toBeNull();
      await built();
      expect((await localReviewSource(project).runView(runId)).storybook).toBeNull();
    });

    test("the directory, and that it may not match, for a run whose own build wasn't kept", async () => {
      const runId = (await review()).json.runId as string;
      await built();
      expect(await linkOf(runId)).toEqual({ url: hostedAt, exactBuild: false });
    });

    test("the very build that rendered it, wherever the directory has gone since", async () => {
      await built();
      const runId = await reviewedBuild();
      const link = await linkOf(runId);
      expect(link).toMatchObject({ exactBuild: true, url: expect.stringContaining(`${hostedAt}storybook-builds/`) });
      await writeFile(path.join(dir, "index.html"), "<!doctype html><title>the next build</title>");
      expect(await linkOf(runId)).toEqual(link);
      expect(await (await read(new URL(link!.url).pathname)).text()).toContain("the manager");
      expect(await (await read("/")).text()).toContain("the next build");
    });

    test("the same for a run that reused an earlier render, a filtered one, and one where a story failed", async () => {
      await built();
      const first = await reviewedBuild();
      await commit(h.repo, "something that doesn't change the build");
      const reused = await reviewedBuild();
      expect(reused).not.toBe(first);
      expect((await linkOf(reused))?.exactBuild).toBe(true);
      expect((await linkOf(await reviewedBuild("--story", "a")))?.exactBuild).toBe(true);
      h.stories = [{ id: "a", failed: "it threw" }, { id: "b" }];
      expect((await linkOf(await reviewedBuild()))?.exactBuild).toBe(true);
    });

    test("the goldens' own build too, if it's kept, once a later run is compared with them", async () => {
      await built();
      const first = await reviewedBuild();
      expect((await hosted().runView(first)).goldenStorybookUrl).toBeNull();
      expect((await h.cli("approve", first, "--all")).code).toBe(0);
      expect((await h.cli("accept", first)).code).toBe(0);
      const goldens = (await linkOf(first))!.url;

      await commit(h.repo, "the next change");
      await writeFile(path.join(dir, "index.html"), "<!doctype html><title>the next build</title>");
      const view = await hosted().runView(await reviewedBuild());
      expect(view.goldenStorybookUrl).toBe(goldens);
      expect(view.storybook?.url).not.toBe(goldens);
    });

    test("the size its environment rendered at, whatever the config says now", async () => {
      await built();
      const before = await reviewedBuild();
      expect((await hosted().runView(before)).viewport).toEqual({ width: 1200, height: 900 });
      await writeFile(path.join(h.repo, "selfie.config.json"), JSON.stringify({ environment: { viewport: { width: 640, height: 480 } } }));
      expect((await hosted().runView(before)).viewport).toEqual({ width: 1200, height: 900 });
    });

    test("not a build that changed while it rendered", async () => {
      await built();
      h.onCapture = () => writeFileSync(path.join(dir, "index.json"), '{"changed":true}');
      expect((await linkOf(await reviewedBuild()))?.exactBuild).toBe(false);
    });
  });
});
