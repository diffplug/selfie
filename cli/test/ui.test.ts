// The review UI's routes over the real library, a real store, and real Git, with no socket and no
// browser, plus `selfie ui` itself on a real socket. Only the capture is a stand-in.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { decodeImage } from "selfie-store";
import { REQUEST_HEADER_VALUE } from "selfie-ui/app";
import { createLocalApp, serveLocal, type LocalServer } from "selfie-ui/local";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { runCli } from "../src/cli.ts";
import { openProject, type Project } from "../src/project.ts";
import { localReviewSource } from "../src/ui.ts";
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
      for (const url of ["/api/current", "/", `/api/images/${UNKNOWN_HASH}`, "/assets/a.js"]) {
        const response = await app.request(url, { headers: { host } });
        expect(response.status, `${host} ${url}`).toBe(403);
        expect(await response.json()).toMatchObject({ error: { code: "bad-host" } });
      }
    }
    expect((await app.request("/api/current")).status).toBe(403);
    expect((await get("/api/current", { host: `localhost:${PORT}` })).status).toBe(200);
    expect((await get("/api/current", { host: HOST })).status).toBe(200);
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
      expect((await get("/api/current", { origin: "https://evil.example" })).status).toBe(403);
      const refused = await get("/api/current", { host: "evil.example" });
      for (const response of [await get("/"), await get("/api/current"), refused]) {
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
  test("says when there are none yet, and why", async () => {
    const current = (await (await get("/api/current")).json()) as any;
    expect(current).toEqual({
      head: git(h.repo, "rev-parse", "HEAD"),
      runId: null,
      hasUnfinishedRun: false,
      baseline: { sha: null, message: expect.any(String) },
    });
  });

  test("is the newest finished one at HEAD, in this environment", async () => {
    h.stories = [{ id: "a" }];
    const { environment } = (await review()).json;
    const second = (await review()).json.runId;
    const current = async () => (await (await get("/api/current")).json()) as any;
    // With a run to open, nothing asks Git about baselines.
    expect(await current()).toEqual({ head: expect.any(String), runId: second, hasUnfinishedRun: true, baseline: null });

    // A review still recording, or crashed, can't be compared.
    const recording = await project.snapshots.beginRun({
      gitSha: git(h.repo, "rev-parse", "HEAD"),
      environment,
      dirty: false,
      baselineSha: null,
    });
    expect((await current()).runId).toBe(second);
    const unfinished = await get(`/api/runs/${recording.id}`);
    expect(unfinished.status).toBe(409);
    expect(await unfinished.json()).toMatchObject({ error: { code: "run-not-finished" } });

    await commit(h.repo, "moved on");
    expect(await current()).toMatchObject({ runId: null, hasUnfinishedRun: false });
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
    expect(view.rows.find(({ story }: any) => story === "differs").pixelDiff).toMatchObject({ kind: "pixels", changedPixels: 64 });
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

describe("images", () => {
  test("serves a stored PNG, privately, by its hash", async () => {
    h.stories = [{ id: "a" }];
    const view = await viewOf((await review()).json.runId);
    const [{ imageHash }] = view.rows;
    const response = await get(`/api/images/${imageHash}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
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
      kind: "pixels",
      changedPixels: 1,
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

  test("a different size has stats and no diff image", async () => {
    h.stories = [{ id: "a" }];
    await makeGoldens();
    h.stories = [{ id: "a", width: 10, height: 6 }];
    const [row] = (await viewOf((await review()).json.runId)).rows;
    const url = `/api/diffs/${row.imageHash}/${row.goldenHash}`;
    expect(await (await get(url)).json()).toEqual({ kind: "size-differs", current: { width: 10, height: 6 }, golden: { width: 8, height: 8 } });
    expect((await get(`${url}/image`)).status).toBe(404);
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

  test("the CLI loads no web server until selfie ui asks for one", () => {
    const loaded = modulesLoadedBy(path.join(root, "cli/src/cli.ts"));
    expect(loaded.length).toBeGreaterThan(5);
    expect(loaded.filter((url) => url.includes("hono") || url.includes("/ui/src/"))).toEqual([]);
  });

  test("the routes and their protections need nothing of a platform", () => {
    const loaded = modulesLoadedBy(path.join(root, "ui/src/server/app.ts"));
    expect(loaded.filter((url) => url.startsWith("node:") || url.includes("/server/local") || url.includes("@hono/node-server"))).toEqual([]);
  });
});

describe("selfie ui", () => {
  const start = async (...argv: string[]) => {
    const stop = new AbortController();
    let stdout = "";
    let stderr = "";
    let onPrinted: () => void;
    const printed = new Promise<void>((resolve) => {
      onPrinted = resolve;
    });
    const exit = runCli(["ui", ...argv], {
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

  test("prints one document with its URL, serves on it, and stops when told", async () => {
    const { stop, exit, json, stderr } = await start();
    const { url, port, runId } = json();
    expect(url).toBe(`http://127.0.0.1:${port}/`);
    expect(runId).toBeNull();
    expect(stderr()).toContain("Serving");
    const page = await fetch(url);
    expect(await page.text()).toContain("the client");
    expect((await fetch(`${url}api/current`)).status).toBe(200);
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
      expect((await fetch(`${server.url}api/current`)).status).toBe(200);
      const external = Object.values(networkInterfaces())
        .flat()
        .filter((address) => address !== undefined && !address.internal && address.family === "IPv4");
      for (const address of external) {
        await expect(fetch(`http://${address!.address}:${server.port}/api/current`)).rejects.toThrow();
      }
    } finally {
      await server.close();
    }
  });
});
