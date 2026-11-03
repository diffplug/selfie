import { writeFileSync } from "node:fs";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLocalApp, createStorybookApp, serveLocal, serveStorybook } from "selfie-ui/local";
import { beforeEach, describe, expect, test } from "vitest";
import { openProject } from "../src/project.ts";
import { localReviewSource, type StoryRecorder } from "../src/ui.ts";
import { commit, git } from "./support.ts";
import { PORT, HOST, ORIGIN, h, project, clientDir, app, review, get, change } from "./ui-support.ts";

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

    test("says where a first render stands", async () => {
      const setup = async () => (await live()).setup;
      expect(await setup()).toEqual({ storybookDir: expect.any(String), buildCommand: null, uncommitted: [], builtFrom: null, usesDocker: true });
      expect((await live()).branch).toBe("main");
      await writeFile(path.join(h.repo, "selfie.config.json"), JSON.stringify({ buildCommand: "make stories" }));
      expect(await setup()).toMatchObject({ buildCommand: "make stories", uncommitted: ["selfie.config.json"] });
    });

    test("says a build is clean only with nothing uncommitted, and built since HEAD moved here", async () => {
      await withStories("a");
      const builtFrom = async () => (await live()).setup?.builtFrom;
      expect(await builtFrom()).toBe("clean");
      await writeFile(path.join(h.repo, "changed.txt"), "not committed");
      expect(await builtFrom()).toBe("uncommitted");
      await rm(path.join(h.repo, "changed.txt"));
      const longAgo = new Date("2020-01-01");
      await utimes(path.join(dir, "iframe.html"), longAgo, longAgo);
      expect(await builtFrom()).toBe("before-head");
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
