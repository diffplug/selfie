import { writeFileSync } from "node:fs";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RenderProgress, ReviewSource } from "selfie-ui/app";
import { createLocalApp, createStorybookApp, serveLocal, serveStorybook } from "selfie-ui/local";
import { gunzip } from "selfie-store";
import { beforeEach, describe, expect, test } from "vitest";
import { openProject } from "../src/project.ts";
import { renderBatch } from "../src/review.ts";
import { localReviewSource, type RenderStories } from "../src/ui.ts";
import { BLUE, commit, git, TEST_CONFIG, writeTestConfig } from "./support.ts";
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

  const storybook = () => createStorybookApp({ dir, port: () => STORYBOOK_PORT, readStorybookFile: (build, file) => project.storybooks.readGzippedFile(build, file), reviewOrigins: () => [ORIGIN] });
  const read = (url: string, host = `127.0.0.1:${STORYBOOK_PORT}`) => storybook().request(url, { headers: { host } });

  beforeEach(() => {
    dir = path.join(h.repo, TEST_CONFIG.storybookDir);
  });

  test("is nothing, until it's a built Storybook", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "secret.txt"), "not a built Storybook");
    expect((await read("/secret.txt")).status).toBe(404);
  });

  describe("what it serves", () => {
    beforeEach(built);

    test("is a built Storybook's own files, and nothing is kept", async () => {
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

    test("stays inside the built Storybook", async () => {
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
    const hosted = await serveStorybook({ dir, readStorybookFile: async () => null, reviewOrigins: () => [] });
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

  describe("a kept built Storybook", () => {
    const hash = "a".repeat(64);
    const kept = async () => {
      const files = [
        { path: "index.html", fileHash: await project.storybooks.putFile(new TextEncoder().encode("<!doctype html><title>kept</title>")) },
        { path: "assets/a b.js", fileHash: await project.storybooks.putFile(new TextEncoder().encode("export {};")) },
      ];
      await project.storybooks.putStorybook(hash, files);
    };

    test("serves its files, and a browser may keep them", async () => {
      await kept();
      const page = await read(`/built-storybooks/${hash}/`);
      // Gzipped as it's kept, whatever the request accepts.
      expect(page.headers.get("content-encoding")).toBe("gzip");
      expect(new TextDecoder().decode(await gunzip(new Uint8Array(await page.arrayBuffer())))).toContain("kept");
      expect(page.headers.get("content-type")).toContain("text/html");
      expect(page.headers.get("cache-control")).toContain("immutable");
      expect(page.headers.get("content-security-policy")).toBe(`frame-ancestors 'self' ${ORIGIN}`);
      const script = await read(`/built-storybooks/${hash}/assets/a%20b.js`);
      expect(new TextDecoder().decode(await gunzip(new Uint8Array(await script.arrayBuffer())))).toBe("export {};");
      expect(script.headers.get("content-type")).toContain("javascript");
    });

    test("serves its files over HTTP as a browser reads them", async () => {
      await kept();
      const hosted = await serveStorybook({ dir, readStorybookFile: (build, file) => project.storybooks.readGzippedFile(build, file), reviewOrigins: () => [ORIGIN] });
      try {
        // `fetch` decompresses as a browser does, so this is the bytes as built, arrived whole.
        const script = await fetch(`${hosted.url}built-storybooks/${hash}/assets/a%20b.js`);
        expect(script.headers.get("content-encoding")).toBe("gzip");
        expect(await script.text()).toBe("export {};");
      } finally {
        await hosted.close();
      }
    });

    test.each(["/built-storybooks/nope/", `/built-storybooks/${"b".repeat(64)}/`, `/built-storybooks/${hash}/missing.js`, `/built-storybooks/${hash}/..%2f..%2fsecret.txt`, `/built-storybooks/${hash}/%ff`])(
      "has no such thing as %s",
      async (url) => {
        await kept();
        expect((await read(url)).status).toBe(404);
      },
    );

    test("answers only to its own loopback address, and is only to read", async () => {
      await kept();
      expect((await read(`/built-storybooks/${hash}/`, "evil.example")).status).toBe(403);
      const post = await storybook().request(`/built-storybooks/${hash}/`, { method: "POST", headers: { host: `127.0.0.1:${STORYBOOK_PORT}` } });
      expect(post.status).toBe(405);
    });
  });

  describe("every story, as the newest render of each", () => {
    const live = () => localReviewSource(project, { storybook: { dir, url: hostedAt } }).storiesView();
    const withStories = async (...ids: string[]) => {
      await built();
      await writeFile(path.join(dir, "index.json"), JSON.stringify({ entries: Object.fromEntries(ids.map((id) => [id, { type: "story", id, title: "T", name: id }])) }));
    };
    const recorded = async (...flags: string[]) => (await h.cli("render", ...flags)).json.batchId as string;
    const rendersOf = async () => Object.fromEntries((await live()).stories.map(({ story, render }) => [story, render]));

    beforeEach(() => {
      h.stories = [{ id: "a" }, { id: "b" }, { id: "c" }];
    });

    test("lists what no batch has rendered, with nothing to say of it", async () => {
      await withStories("a", "b");
      const view = await live();
      expect(view.stories).toEqual([
        { story: "a", title: "T", name: "a", render: null },
        { story: "b", title: "T", name: "b", render: null },
      ]);
      expect(view.newestBatchId).toBeNull();
      expect(view.storybookUrl).toBe(hostedAt);
      expect(view.viewport).toEqual({ width: 1200, height: 900 });
    });

    test("merges partial batches, each story from the newest that has it, and never reads a left-out story as removed", async () => {
      await withStories("a", "b", "c");
      const whole = await recorded();
      const partial = await recorded("--story", "b");
      const renders = await rendersOf();
      expect(renders.a).toMatchObject({ batchId: whole, state: "added" });
      expect(renders.b).toMatchObject({ batchId: partial, state: "added", fromHostedStorybook: true, dirty: false });
      expect(renders.c).toMatchObject({ batchId: whole });
      expect((await live()).newestBatchId).toBe(partial);
    });

    test("keeps the order the built Storybook lists them in, and what it calls them", async () => {
      await withStories("z", "a", "m");
      const { stories } = await live();
      expect(stories.map(({ story }) => story)).toEqual(["z", "a", "m"]);
      expect(stories[0]).toMatchObject({ title: "T", name: "z" });
    });

    test("leaves a story out if the built Storybook no longer has it, and lists a new one as not rendered", async () => {
      await withStories("a", "b");
      await recorded();
      await withStories("a", "d");
      const renders = await rendersOf();
      expect(Object.keys(renders)).toEqual(["a", "d"]);
      expect(renders.d).toBeNull();
    });

    test("keeps looking through older batches for a story, even with one rendered that's gone from the built Storybook", async () => {
      await withStories("a", "b", "c");
      const whole = await recorded();
      h.stories = [{ id: "gone" }, { id: "a" }];
      const newer = await recorded();
      await withStories("a", "b", "c");
      const renders = await rendersOf();
      expect(renders.a).toMatchObject({ batchId: newer });
      expect(renders.b).toMatchObject({ batchId: whole });
      expect(renders.c).toMatchObject({ batchId: whole });
    });

    test("doesn't say a render without a recorded build came from another", async () => {
      h.stories = [{ id: "a" }];
      await review();
      await withStories("a");
      expect((await rendersOf()).a).toMatchObject({ fromHostedStorybook: null });
    });

    test("notices any file of the built Storybook changing, not only its index", async () => {
      await withStories("a");
      await recorded();
      const source = localReviewSource(project, { storybook: { dir, url: hostedAt } });
      const fromHosted = async () => (await source.storiesView()).stories[0]!.render?.fromHostedStorybook;
      expect(await fromHosted()).toBe(true);
      await writeFile(path.join(dir, "assets", "story.js"), "export const changed = true;");
      expect(await fromHosted()).toBe(false);
    });

    test("says when a render came from another built Storybook, or uncommitted changes", async () => {
      await withStories("a");
      await recorded();
      await writeFile(path.join(dir, "assets", "story.js"), "export const changed = true;");
      expect((await rendersOf()).a).toMatchObject({ fromHostedStorybook: false, dirty: false });
      await writeFile(path.join(h.repo, "file.txt"), "uncommitted\n");
      await recorded();
      expect((await rendersOf()).a).toMatchObject({ fromHostedStorybook: true, dirty: true });
    });

    test("carries a decision on the image, which can go with it into a clean batch", async () => {
      await withStories("a");
      const batchId = await recorded();
      expect((await rendersOf()).a).toMatchObject({ decision: null });
      await h.cli("approve", batchId, "--all");
      expect((await rendersOf()).a).toMatchObject({ decision: { decision: "approved" } });
    });

    test("with no build, lists what's been rendered, and says there's no build", async () => {
      h.stories = [{ id: "a" }];
      await review();
      const view = await live();
      expect(view.storybookUrl).toBeNull();
      expect(view.stories.map(({ story }) => story)).toEqual(["a"]);
    });

    test("says where a first render stands", async () => {
      const setup = async () => (await live()).setup;
      expect(await setup()).toEqual({ storybookDir: expect.any(String), buildCommand: TEST_CONFIG.buildCommand, uncommitted: [], builtBeforeHead: false, usesDocker: true });
      expect((await live()).branch).toBe("main");
      await writeTestConfig(h.repo, { buildCommand: "make stories" });
      expect(await setup()).toMatchObject({ buildCommand: "make stories", uncommitted: ["selfie.config.json"] });
    });

    test("says a built Storybook is clean only with nothing uncommitted, and built since HEAD moved here", async () => {
      await withStories("a");
      const setup = async () => (await live()).setup;
      expect(await setup()).toMatchObject({ builtBeforeHead: false, uncommitted: [] });
      await writeFile(path.join(h.repo, "changed.txt"), "not committed");
      expect((await setup())?.uncommitted).toEqual(["changed.txt"]);
      await rm(path.join(h.repo, "changed.txt"));
      const longAgo = new Date("2020-01-01");
      await utimes(path.join(dir, "iframe.html"), longAgo, longAgo);
      expect(await setup()).toMatchObject({ builtBeforeHead: true });
    });

    test("can't render with no commit to keep it with, nor say more than a server that hosts nothing knows", async () => {
      expect((await localReviewSource(project).storiesView()).setup).toBeNull();
      await withStories("a");
      const record = async () => "r";
      expect((await localReviewSource(project, { storybook: { dir, url: hostedAt, renderStories: record } }).storiesView()).canRender).toBe(true);
      const empty = path.join(h.scratch, "no-commits");
      git(h.scratch, "init", "--quiet", "--initial-branch=main", empty);
      await writeTestConfig(empty);
      const uncommitted = await openProject({ cwd: empty, env: { SELFIE_HOME: h.home } });
      const view = await localReviewSource(uncommitted, { storybook: { dir, url: hostedAt, renderStories: record } }).storiesView();
      expect(view).toMatchObject({ head: null, canRender: false });
    });

    test("answers at /api/stories", async () => {
      const response = await get("/api/stories");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ stories: [] });
    });
  });

  describe("rendering from the page", () => {
    const withStories = async (...ids: string[]) => {
      await built();
      await writeFile(path.join(dir, "index.json"), JSON.stringify({ entries: Object.fromEntries(ids.map((id) => [id, { type: "story", id }])) }));
    };
    const asked: (readonly string[] | undefined)[] = [];
    const sourceRendering = (record: RenderStories) => localReviewSource(project, { storybook: { dir, url: hostedAt, renderStories: record } });

    beforeEach(() => {
      asked.length = 0;
    });

    test("records just those stories, and says which batch", async () => {
      await withStories("a", "b", "c");
      const source = sourceRendering(async (stories) => {
        asked.push(stories);
        return "the-batch";
      });
      expect(await source.render(["a", "b"])).toEqual({ batchId: "the-batch" });
      expect(asked).toEqual([["a", "b"]]);
    });

    test("asking for every story is a whole batch", async () => {
      await withStories("a", "b");
      const source = sourceRendering(async (stories) => {
        asked.push(stories);
        return "the-batch";
      });
      await source.render(["b", "a"]);
      expect(asked).toEqual([undefined]);
    });

    test("refuses a story the built Storybook doesn't have, or a second render at once", async () => {
      await withStories("a");
      let finish = () => {};
      const blocked = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const source = sourceRendering(async () => {
        await blocked;
        return "the-batch";
      });
      await expect(source.render(["nope"])).rejects.toMatchObject({ code: "unknown-story" });
      const first = source.render(["a"]);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await expect(source.render(["a"])).rejects.toMatchObject({ code: "render-busy" });
      finish();
      await expect(first).resolves.toEqual({ batchId: "the-batch" });
      await expect(source.render(["a"])).resolves.toEqual({ batchId: "the-batch" });
    });

    test("says why it failed, and can render again after", async () => {
      await withStories("a");
      let failing = true;
      const source = sourceRendering(async () => {
        if (failing) throw new Error("Docker is unavailable");
        return "the-batch";
      });
      await expect(source.render(["a"])).rejects.toMatchObject({ code: "render-failed", message: expect.stringContaining("Docker is unavailable") });
      failing = false;
      await expect(source.render(["a"])).resolves.toEqual({ batchId: "the-batch" });
    });

    test("isn't offered with no build, or nothing to record with", async () => {
      expect((await localReviewSource(project, { storybook: { dir, url: hostedAt, renderStories: async () => "r" } }).storiesView()).canRender).toBe(false);
      await withStories("a");
      expect((await localReviewSource(project, { storybook: { dir, url: hostedAt } }).storiesView()).canRender).toBe(false);
      expect((await sourceRendering(async () => "r").storiesView()).canRender).toBe(true);
      await expect(localReviewSource(project).render(["a"])).rejects.toMatchObject({ code: "render-failed" });
    });

    test("answers at /api/renders, only to a change from the page", async () => {
      const refused = await app.request("/api/renders", { method: "POST", headers: { host: HOST, "content-type": "application/json" }, body: JSON.stringify({ stories: ["a"] }) });
      expect(refused.status).toBe(403);
      for (const stories of [undefined, [], [1], [""]]) {
        expect((await change("/api/renders", { stories })).status, JSON.stringify(stories)).toBe(400);
      }
      expect((await change("/api/renders", { stories: ["a"] })).status).toBe(409);
    });

    describe("its progress", () => {
      /** A gate a story waits at, and a way to open it. */
      const gate = () => {
        let open = () => {};
        const shut = new Promise<void>((resolve) => {
          open = resolve;
        });
        return { waitHere: () => shut, open };
      };
      const realRenders = () =>
        localReviewSource(project, {
          storybook: {
            dir,
            url: hostedAt,
            renderStories: async (stories, onProgress) => (await renderBatch(project, { stories, render: h.render, onProgress })).batch.id,
          },
        });
      const until = async (source: ReviewSource, reached: (progress: RenderProgress) => boolean) => {
        await expect.poll(async () => {
          const progress = await source.renderProgress();
          return progress !== null && reached(progress);
        }).toBe(true);
        return (await source.renderProgress())!;
      };

      test("is nothing with no render", async () => {
        await withStories("a");
        await expect(realRenders().renderProgress()).resolves.toBeNull();
      });

      test("has only when it was asked for until the first story starts", async () => {
        await withStories("a", "b", "c");
        const held = gate();
        const before = Date.now();
        const source = sourceRendering(async () => {
          await held.waitHere();
          return "the-batch";
        });
        const render = source.render(["a", "b", "a"]);
        const progress = await until(source, () => true);
        expect(progress).toMatchObject({ total: 2, finished: 0, firstStoryStartedAtMs: null });
        expect(progress.startedAtMs).toBeGreaterThanOrEqual(before);
        held.open();
        await render;
      });

      test("follows the render as its stories start and finish, and is gone with it", async () => {
        await withStories("a", "b");
        const first = gate();
        const second = gate();
        h.stories = [
          { id: "a", beforeRendering: first.waitHere },
          { id: "b", beforeRendering: second.waitHere },
        ];
        const source = realRenders();
        const render = source.render(["a", "b"]);

        const started = await until(source, ({ firstStoryStartedAtMs }) => firstStoryStartedAtMs !== null);
        expect(started).toMatchObject({ total: 2, finished: 0 });
        expect(started.firstStoryStartedAtMs).toBeGreaterThanOrEqual(started.startedAtMs);

        first.open();
        const halfway = await until(source, ({ finished }) => finished === 1);
        expect(halfway).toEqual({ ...started, finished: 1 });

        second.open();
        await render;
        await expect(source.renderProgress()).resolves.toBeNull();
      });

      test("starts again with each render, whether the last worked or not", async () => {
        await withStories("a", "b");
        const source = realRenders();
        h.stories = [{ id: "a" }, { id: "b" }];
        await source.render(["a", "b"]);

        const held = gate();
        h.stories = [{ id: "a", beforeRendering: held.waitHere }];
        const again = source.render(["a"]);
        expect(await until(source, ({ firstStoryStartedAtMs }) => firstStoryStartedAtMs !== null)).toMatchObject({ total: 1, finished: 0 });
        held.open();
        await again;

        h.stories = [
          {
            id: "a",
            beforeRendering: () => {
              throw new Error("Docker is unavailable");
            },
          },
        ];
        await expect(source.render(["a"])).rejects.toMatchObject({ code: "render-failed" });
        await expect(source.renderProgress()).resolves.toBeNull();
      });

      test("isn't anything after refusing a story the build doesn't have", async () => {
        await withStories("a");
        const source = realRenders();
        await expect(source.render(["nope"])).rejects.toMatchObject({ code: "unknown-story" });
        await expect(source.renderProgress()).resolves.toBeNull();
      });

      test("answers a read at /api/renders/progress, and only from the page's own host and origin", async () => {
        await withStories("a");
        const held = gate();
        h.stories = [{ id: "a", beforeRendering: held.waitHere }];
        const source = realRenders();
        const local = createLocalApp({ source, port: () => PORT, clientDir });
        const read = (headers: Record<string, string>) => local.request("/api/renders/progress", { headers: { host: HOST, ...headers } });

        const idle = await read({});
        expect(idle.status).toBe(200);
        expect(idle.headers.get("cache-control")).toBe("no-store");
        expect(await idle.json()).toEqual({ progress: null });

        const render = source.render(["a"]);
        await until(source, ({ firstStoryStartedAtMs }) => firstStoryStartedAtMs !== null);
        const { progress } = (await (await read({ origin: ORIGIN })).json()) as { progress: RenderProgress };
        expect(progress).toEqual(await source.renderProgress());
        expect(Object.keys(progress).sort()).toEqual(["finished", "firstStoryStartedAtMs", "startedAtMs", "total"]);

        expect((await read({ host: "evil.example" })).status).toBe(403);
        expect((await read({ origin: "https://evil.example" })).status).toBe(403);
        expect((await read({ origin: `http://127.0.0.1:${STORYBOOK_PORT}` })).status).toBe(403);
        held.open();
        await render;
      });
    });
  });

  describe("what a batch links to", () => {
    const hosted = () => localReviewSource(project, { storybook: { dir, url: hostedAt } });
    const reviewedBuild = async (...flags: string[]) => (await h.cli("review", ...flags)).json.batchId as string;
    const linkOf = async (batchId: string) => (await hosted().batchView(batchId)).storybook;

    beforeEach(() => {
      h.stories = [{ id: "a" }, { id: "b" }];
    });

    test("nothing, with no build, or nothing hosted", async () => {
      const batchId = (await review()).json.batchId as string;
      expect(await linkOf(batchId)).toBeNull();
      await built();
      expect((await localReviewSource(project).batchView(batchId)).storybook).toBeNull();
    });

    test("the directory, and that it may not match, for a batch whose own build wasn't kept", async () => {
      const batchId = (await review()).json.batchId as string;
      await built();
      expect(await linkOf(batchId)).toEqual({ url: hostedAt, exactStorybook: false });
    });

    test("the very build that rendered it, wherever the directory has gone since", async () => {
      await built();
      const batchId = await reviewedBuild();
      const link = await linkOf(batchId);
      expect(link).toMatchObject({ exactStorybook: true, url: expect.stringContaining(`${hostedAt}built-storybooks/`) });
      await writeFile(path.join(dir, "index.html"), "<!doctype html><title>the next build</title>");
      expect(await linkOf(batchId)).toEqual(link);
      const kept = await read(new URL(link!.url).pathname);
      expect(new TextDecoder().decode(await gunzip(new Uint8Array(await kept.arrayBuffer())))).toContain("the manager");
      expect(await (await read("/")).text()).toContain("the next build");
    });

    test("the same for a batch that reused an earlier render, a filtered one, and one where a story failed", async () => {
      await built();
      const first = await reviewedBuild();
      await commit(h.repo, "something that doesn't change the built Storybook");
      const reused = await reviewedBuild();
      expect(reused).not.toBe(first);
      expect((await linkOf(reused))?.exactStorybook).toBe(true);
      expect((await linkOf(await reviewedBuild("--story", "a")))?.exactStorybook).toBe(true);
      h.stories = [{ id: "a", failed: "it threw" }, { id: "b" }];
      expect((await linkOf(await reviewedBuild()))?.exactStorybook).toBe(true);
    });

    test("each row's reference's own build too, if it's kept", async () => {
      await built();
      const first = await reviewedBuild();
      const rowOf = async (batchId: string) => (await hosted().batchView(batchId)).rows.find(({ story }) => story === "a")!;
      expect((await rowOf(first)).goldenStorybookUrl).toBeNull();
      expect((await h.cli("approve", first, "--all")).code).toBe(0);
      const approved = (await linkOf(first))!.url;

      await commit(h.repo, "the next change");
      await writeFile(path.join(dir, "index.html"), "<!doctype html><title>the next build</title>");
      h.stories = [{ id: "a", color: BLUE }, { id: "b" }];
      const next = await reviewedBuild();
      expect((await rowOf(next)).goldenStorybookUrl).toBe(approved);
      expect((await linkOf(next))?.url).not.toBe(approved);
    });

    test("the size its environment rendered at, whatever the config says now", async () => {
      await built();
      const before = await reviewedBuild();
      expect((await hosted().batchView(before)).batch.viewport).toEqual({ width: 1200, height: 900 });
      await writeTestConfig(h.repo, { environment: { viewport: { width: 640, height: 480 } } });
      expect((await hosted().batchView(before)).batch.viewport).toEqual({ width: 1200, height: 900 });
    });

    describe("a story that declared a size of its own", () => {
      const PHONE = { width: 414, height: 896 };

      test("is the only one with a size of its own, and one declaring the environment's isn't", async () => {
        await built();
        h.stories = [{ id: "a", viewport: PHONE }, { id: "b" }, { id: "c", viewport: { width: 1200, height: 900 } }];
        const view = await hosted().batchView(await reviewedBuild());
        expect(view.storyViewports).toEqual({ a: PHONE });
        expect(view.batch.viewport).toEqual({ width: 1200, height: 900 });
      });

      test("keeps it through a batch that reuses its images", async () => {
        await built();
        h.stories = [{ id: "a", viewport: PHONE }, { id: "b" }];
        const first = await reviewedBuild();
        await commit(h.repo, "something that doesn't change the build");
        const reused = await reviewedBuild();
        expect(reused).not.toBe(first);
        expect((await project.batches.getBatch(reused))?.reusedFromBatch).toBe(first);
        expect((await hosted().batchView(reused)).storyViewports).toEqual({ a: PHONE });
      });

      test("lays out each side as its own image did, once the story declares one where its reference didn't", async () => {
        await built();
        h.stories = [{ id: "a" }, { id: "b", viewport: PHONE }];
        const first = await reviewedBuild();
        expect((await h.cli("approve", first, "--all")).code).toBe(0);

        await commit(h.repo, "the next change");
        await writeFile(path.join(dir, "index.html"), "<!doctype html><title>the next build</title>");
        h.stories = [{ id: "a", viewport: PHONE }, { id: "b" }];
        const next = await reviewedBuild();
        expect((await hosted().batchView(next)).storyViewports).toEqual({ a: PHONE });
        // A fake render's images don't change with the size, so these are the unchanged ones, which is where a size alone would be lost.
        const rows = await hosted().unchanged(next);
        expect(Object.fromEntries(rows.map(({ story, goldenViewport }) => [story, goldenViewport]))).toEqual({ a: null, b: PHONE });
      });
    });

    test("not a built Storybook that changed while it rendered", async () => {
      await built();
      h.onRender = () => writeFileSync(path.join(dir, "index.json"), '{"changed":true}');
      expect((await linkOf(await reviewedBuild()))?.exactStorybook).toBe(false);
    });
  });
});
