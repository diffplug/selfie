// push and pull between two machines and a cloud store, on real Git and real stores, with a stand-in
// for GitHub. See docs/specs/sync.md.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { createSyncApi, type SyncAccess } from "selfie-ui/sync";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { runCli } from "../src/cli.ts";
import { encodePng } from "../src/png.ts";
import { openProject, type Project } from "../src/project.ts";
import { commit, createHarness, fakeRender, git, GREEN, RED, solid, type FakeStory, type Harness, writeTestConfig } from "./support.ts";

const REMOTE = "http://127.0.0.1:9";
/** What the cloud would answer, in the shape the client calls it. */
const toCloud = (async (url: string, init?: RequestInit) => app.request(new URL(url).pathname.replace(/^\/api/, "") + new URL(url).search, init)) as typeof fetch;

const ACCESS: Readonly<Record<string, SyncAccess>> = {
  writer: { view: true, upload: true, decider: "writer-login" },
  ci: { view: false, upload: true, decider: null },
  reader: { view: true, upload: false, decider: null },
};

let h: Harness;
let cloudHome: string;
let cloud: Project;
let pushedCommits: Set<string> | null;
let app: ReturnType<typeof createSyncApi>;

/** Runs a command on a machine, as a token, against the cloud. */
function machine(repo: string, home: string, fetchWith: () => typeof fetch = () => toCloud) {
  const render = fakeRender(() => stories, () => undefined);
  return async (token: string | null, ...argv: string[]) => {
    let stdout = "";
    const code = await runCli(argv, {
      cwd: repo,
      env: { SELFIE_HOME: home, SELFIE_REMOTE: REMOTE, ...(token === null ? {} : { SELFIE_TOKEN: token }) },
      stdout: (text) => {
        stdout += text;
      },
      stderr: () => undefined,
      render,
      fetch: fetchWith(),
    });
    return { code, json: JSON.parse(stdout) };
  };
}

const headOf = () => git(h.repo, "rev-parse", "HEAD");

let laptop: ReturnType<typeof machine>;
let stories: readonly FakeStory[];

const record = async (run = laptop) => (await run("writer", "render")).json.batchId as string;
/** A batch on the laptop, approved, and accepted as HEAD's goldens. */
async function accepted() {
  const batchId = await record();
  await laptop(null, "approve", batchId, "--all");
  expect((await laptop(null, "accept", batchId)).code).toBe(0);
  return batchId;
}

/** The image hashes of a batch on the laptop. */
async function imagesOf(batchId: string) {
  const local = await openProject({ cwd: h.repo, env: { SELFIE_HOME: h.home } });
  try {
    return (await local.batches.readBatch(batchId)).renders.map(({ imageHash }) => imageHash);
  } finally {
    local.close();
  }
}

beforeEach(async () => {
  h = await createHarness();
  git(h.repo, "remote", "add", "origin", "https://github.com/diffplug/selfie.git");
  stories = [{ id: "a", color: RED }, { id: "b", color: GREEN }];
  laptop = machine(h.repo, h.home);
  cloudHome = await mkdtemp(path.join(tmpdir(), "selfie-cloud-"));
  cloud = await openProject({ cwd: h.repo, env: { SELFIE_HOME: cloudHome } });
  pushedCommits = null;
  app = createSyncApi({
    open: async (project, token) => {
      const access = project === "42" && token !== null ? ACCESS[token] : undefined;
      return access === undefined ? null : { access, batches: cloud.batches, store: cloud.store, hasCommit: async (sha) => pushedCommits === null || pushedCommits.has(sha) };
    },
    findProject: async (owner, name) => (owner === "diffplug" && name === "selfie" ? "42" : null),
  });
});
afterEach(async () => {
  cloud.close();
  await rm(cloudHome, { recursive: true, force: true });
  await h.destroy();
});

describe("pushing", () => {
  test("sends a batch, its images, its decisions, and its goldens", async () => {
    const batchId = await accepted();
    const { code, json } = await laptop("writer", "push");
    expect(code).toBe(0);
    expect(json).toMatchObject({ batchId, images: { sent: 2, alreadyThere: 0 }, decisions: 2, goldens: { outcome: "accepted", acceptedBatchId: batchId } });
    const head = headOf();
    const held = await cloud.batches.getBatch(batchId);
    expect(held).toMatchObject({ id: batchId, gitSha: head, status: "complete" });
    expect(await cloud.batches.acceptedBatchAt(head, held!.environment)).toBe(batchId);
  });

  test("names who pushed as a decision's author, not what the laptop says", async () => {
    const batchId = await accepted();
    await laptop("writer", "push");
    const { renders } = await cloud.batches.readBatch(batchId);
    expect(renders.map(({ decision }) => decision?.actor)).toEqual(["writer-login", "writer-login"]);
  });

  test("is safe to run again, and sends nothing twice", async () => {
    await accepted();
    await laptop("writer", "push");
    expect((await laptop("writer", "push")).json).toMatchObject({ images: { sent: 0, alreadyThere: 2 }, goldens: { outcome: "already" } });
  });

  test("a batch that isn't accepted here goes with no goldens", async () => {
    await record();
    const { code, json } = await laptop("writer", "push");
    expect(code).toBe(0);
    expect(json).toMatchObject({ decisions: 0, goldens: null });
  });

  test("sends only the images the cloud lacks", async () => {
    await accepted();
    await laptop("writer", "push");
    await commit(h.repo, "second");
    stories = [{ id: "a", color: RED }, { id: "b", color: [1, 2, 3] }];
    await record();
    expect((await laptop("writer", "push")).json.images).toEqual({ sent: 1, alreadyThere: 1 });
  });

  test("a commit GitHub doesn't have costs nothing", async () => {
    pushedCommits = new Set();
    const batchId = await accepted();
    const { code, json } = await laptop("writer", "push");
    expect(code).toBe(2);
    expect(json.error.code).toBe("commit-not-pushed");
    expect(await cloud.batches.getBatch(batchId)).toBeNull();
    const [{ imageHash }] = (await laptop(null, "review", batchId)).json.differences;
    expect(await cloud.store.missingImages([imageHash])).toEqual([imageHash]);
  });

  test("CI uploads with no decisions, and is refused goldens nobody approved", async () => {
    await record();
    const { code, json } = await laptop("ci", "push", "--accept");
    expect(code).toBe(1);
    expect(json).toMatchObject({ decisions: null, goldens: { outcome: "refused", refusal: { code: "not-approved" } } });
  });

  test("CI makes a merge commit's goldens from a person's approvals, with no re-render", async () => {
    // A person approves these images on a branch, and pushes.
    const onBranch = await record();
    await laptop(null, "approve", onBranch, "--all");
    await laptop("writer", "push", onBranch);
    // The same images at the merge commit, rendered by CI.
    const merge = await commit(h.repo, "merge");
    const onMerge = await record();
    const { code, json } = await laptop("ci", "push", onMerge, "--accept");
    expect(code).toBe(0);
    expect(json.goldens).toMatchObject({ outcome: "accepted", acceptedBatchId: onMerge });
    const { environment } = (await cloud.batches.getBatch(onMerge))!;
    expect(await cloud.batches.acceptedBatchAt(merge, environment)).toBe(onMerge);
  });

  test("CI on a fresh machine, which has never pulled and can't, holds an unchanged batch to the cloud's goldens", async () => {
    await accepted();
    await laptop("writer", "push");
    const merge = await commit(h.repo, "merge");
    // Nothing here but the checkout, so this batch records no baseline.
    const fresh = machine(h.repo, path.join(h.scratch, "ci-home"));
    const batchId = (await fresh("ci", "render")).json.batchId;
    const { code, json } = await fresh("ci", "push", "--accept");
    expect(code).toBe(0);
    expect(json).toMatchObject({ batchId, decisions: null, images: { sent: 0 }, goldens: { outcome: "accepted", acceptedBatchId: batchId } });
    expect(await cloud.batches.acceptedBatchAt(merge, (await cloud.batches.getBatch(batchId))!.environment)).toBe(batchId);
  });

  test("the default is the newest from a clean tree, and skips a dirty one", async () => {
    const clean = await record();
    await writeFile(path.join(h.repo, "file.txt"), "uncommitted\n");
    stories = [{ id: "a", color: GREEN }, { id: "b", color: GREEN }];
    await record();
    expect((await laptop("writer", "push")).json.batchId).toBe(clean);
  });

  test.each([
    ["another image", (other: Uint8Array) => other],
    ["bytes that don't decode", (other: Uint8Array) => other.subarray(0, other.length - 1)],
  ])("won't send a copy holding %s, and says which", async (_, damage) => {
    const batchId = await accepted();
    const [hash, other] = await imagesOf(batchId);
    const local = await openProject({ cwd: h.repo, env: { SELFIE_HOME: h.home } });
    const blobs = path.join(local.directory, "blobs", "images");
    local.close();
    await writeFile(path.join(blobs, hash!), damage(await readFile(path.join(blobs, other!))));
    const { code, json } = await laptop("writer", "push");
    expect(code).toBe(2);
    expect(json.error.code).toBe("corrupt-image");
    expect(json.error.message).toContain(hash);
    expect(await cloud.store.lookupKey(hash!)).toBeNull();
  });

  test("a batch from a dirty tree is refused, by name, and stores nothing", async () => {
    await writeFile(path.join(h.repo, "file.txt"), "uncommitted\n");
    const dirty = await record();
    const { code, json } = await laptop("writer", "push", dirty);
    expect(code).toBe(2);
    expect(json.error.code).toBe("batch-dirty");
    expect(await cloud.batches.getBatch(dirty)).toBeNull();
  });

  test("a push that dies partway is finished by pushing again", async () => {
    const batchId = await accepted();
    let imagesLeft = 1;
    const flaky = machine(h.repo, h.home, () => (async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT" && url.includes("/images/") && imagesLeft-- <= 0) throw new Error("connection lost");
      return toCloud(url, init);
    }) as typeof fetch);
    expect((await flaky("writer", "push")).code).toBe(2);
    expect((await cloud.batches.getBatch(batchId))?.status).toBe("recording");
    const { code, json } = await laptop("writer", "push");
    expect(code).toBe(0);
    expect(json).toMatchObject({ images: { sent: 1, alreadyThere: 1 }, goldens: { outcome: "accepted" } });
  });

  test("a different batch never replaces the cloud's goldens", async () => {
    const first = await accepted();
    await laptop("writer", "push");
    stories = [{ id: "a", color: GREEN }, { id: "b", color: GREEN }];
    await accepted();
    const { code, json } = await laptop("writer", "push");
    expect(code).toBe(1);
    expect(json.goldens).toMatchObject({ outcome: "conflict", acceptedBatchId: first });
  });

  test("says when there's nothing at HEAD to push", async () => {
    const { code, json } = await laptop("writer", "push");
    expect(code).toBe(2);
    expect(json.error.code).toBe("unknown-batch");
  });

  test("someone who can't upload gets a clear refusal", async () => {
    await record();
    const { code, json } = await laptop("reader", "push");
    expect(code).toBe(2);
    expect(json.error.code).toBe("not-allowed");
  });

  test("someone who can't see it learns nothing", async () => {
    await record();
    const { code, json } = await laptop("stranger", "push");
    expect(code).toBe(2);
    expect(json.error.code).toBe("not-found");
  });
});

describe("the remote", () => {
  const plain = (env: NodeJS.ProcessEnv, ...argv: string[]) => runCli(argv, { cwd: h.repo, env: { SELFIE_HOME: h.home, ...env }, stdout: () => undefined, stderr: () => undefined });

  test("must be said", async () => {
    expect(await plain({}, "push")).toBe(2);
  });

  test("must be https, since a token goes to it, unless it's this machine", async () => {
    expect(await plain({ SELFIE_REMOTE: "http://example.com", SELFIE_TOKEN: "x" }, "push")).toBe(2);
    expect(await plain({ SELFIE_REMOTE: "not a url" }, "push")).toBe(2);
  });

  test("comes from no file in a checkout", async () => {
    await writeTestConfig(h.repo, { remote: "https://evil.example" });
    expect(await plain({ SELFIE_TOKEN: "x" }, "push")).toBe(2);
  });

  test("needs a GitHub origin to find its project", async () => {
    git(h.repo, "remote", "set-url", "origin", "https://gitlab.com/diffplug/selfie.git");
    await record();
    expect((await laptop("writer", "push")).json.error.code).toBe("no-github-origin");
  });
});

describe("another machine", () => {
  let desktopRepo: string;
  let desktopHome: string;
  let desktop: ReturnType<typeof machine>;

  beforeEach(async () => {
    desktopRepo = path.join(h.scratch, "desktop");
    desktopHome = path.join(h.scratch, "desktop-home");
    execFileSync("git", ["clone", "--quiet", h.repo, desktopRepo]);
    git(desktopRepo, "remote", "set-url", "origin", "https://github.com/diffplug/selfie.git");
    git(desktopRepo, "config", "user.email", "desktop@example.com");
    git(desktopRepo, "config", "user.name", "Desktop");
    desktop = machine(desktopRepo, desktopHome);
  });

  test("pulls goldens, and then a review has a baseline", async () => {
    const batchId = await accepted();
    await laptop("writer", "push");
    const head = headOf();
    const { code, json } = await desktop("reader", "pull", head);
    expect(code).toBe(0);
    expect(json).toMatchObject({ sha: head, batchId, images: { received: 2, alreadyHere: 0 }, decisions: 2, replaced: null });

    const local = await openProject({ cwd: desktopRepo, env: { SELFIE_HOME: desktopHome } });
    try {
      expect((await local.batches.getBatch(batchId))?.status).toBe("complete");
      expect(await local.batches.acceptedBatchAt(head, json.environment)).toBe(batchId);
      expect(await local.store.getPixels((await local.batches.readBatch(batchId)).renders[0]!.imageHash!)).not.toBeNull();
    } finally {
      local.close();
    }
    // The same images here are unchanged against what was pulled.
    await commit(desktopRepo, "more");
    const { json: reviewed } = await desktop(null, "review");
    expect(reviewed.counts).toMatchObject({ unchanged: 2, changed: 0, added: 0 });
  });

  test("finds the nearest baseline in the cloud, if it isn't told a commit", async () => {
    const batchId = await accepted();
    await laptop("writer", "push");
    const { json } = await desktop("reader", "pull");
    expect(json).toMatchObject({ batchId });
  });

  test("is safe to run again", async () => {
    await accepted();
    await laptop("writer", "push");
    const head = headOf();
    await desktop("reader", "pull", head);
    // Reading nothing, since a shared limit pays for every pull CI makes.
    let asked = 0;
    const counting = machine(desktopRepo, desktopHome, () => (async (url: string, init?: RequestInit) => {
      if (url.includes("/batches/")) asked += 1;
      return toCloud(url, init);
    }) as typeof fetch);
    expect((await counting("reader", "pull", head)).json).toMatchObject({ batchId: expect.any(String), images: { received: 0, alreadyHere: 0 }, replaced: null });
    expect(asked).toBe(0);
  });

  test("the cloud's goldens replace different ones here, and it says so", async () => {
    const batchId = await accepted();
    await laptop("writer", "push");
    const head = headOf();
    stories = [{ id: "a", color: GREEN }, { id: "b", color: GREEN }];
    const own = await record(desktop);
    await desktop(null, "approve", own, "--all");
    await desktop(null, "accept", own);
    const { json } = await desktop("reader", "pull", head);
    expect(json).toMatchObject({ batchId, replaced: own });
  });

  test("a pull that dies partway is finished by pulling again", async () => {
    const batchId = await accepted();
    await laptop("writer", "push");
    const head = headOf();
    let imagesLeft = 1;
    const flaky = machine(desktopRepo, desktopHome, () => (async (url: string, init?: RequestInit) => {
      if (url.includes("/images/") && imagesLeft-- <= 0) throw new Error("connection lost");
      return toCloud(url, init);
    }) as typeof fetch);
    expect((await flaky("reader", "pull", head)).code).toBe(2);
    // However many had landed when it died.
    const { json } = await desktop("reader", "pull", head);
    expect(json).toMatchObject({ batchId, replaced: null });
    expect(json.images.received + json.images.alreadyHere).toBe(2);
  });

  test.each([
    ["another image", () => encodePng(solid(4, 4, [0, 0, 255]))],
    ["bytes that don't decode", async () => {
      const png = Uint8Array.from(await encodePng(solid(4, 4, [0, 0, 255])));
      const idat = Buffer.from(png).indexOf("IDAT") + 4;
      png.fill(0xff, idat, idat + 8);
      return png;
    }],
  ])("the cloud holding %s under a hash stops a pull, by name, and keeps nothing here", async (_, bytes) => {
    const batchId = await accepted();
    const [hash] = await imagesOf(batchId);
    // A client took it on trust from someone else, and the first bytes stay, so the push doesn't correct it.
    await cloud.store.receiveImage(await bytes(), hash!);
    expect((await laptop("writer", "push")).json.images).toEqual({ sent: 1, alreadyThere: 1 });

    for (let attempt = 0; attempt < 2; attempt++) {
      const { code, json } = await desktop("reader", "pull", headOf());
      expect(code).toBe(2);
      expect(json.error.code).toBe("corrupt-image");
      expect(json.error.message).toContain(hash);
    }
    const here = await openProject({ cwd: desktopRepo, env: { SELFIE_HOME: desktopHome } });
    expect(await here.store.lookupKey(hash!)).toBeNull();
    here.close();
  });

  test("a later decision here isn't undone by an older one pulled", async () => {
    const batchId = await accepted();
    await laptop("writer", "push");
    const head = headOf();
    await desktop("reader", "pull", head);
    await desktop(null, "reject", batchId, "--all");
    await desktop("reader", "pull", head);
    const local = await openProject({ cwd: desktopRepo, env: { SELFIE_HOME: desktopHome } });
    try {
      const { renders } = await local.batches.readBatch(batchId);
      expect(renders.map(({ decision }) => decision?.decision)).toEqual(["rejected", "rejected"]);
    } finally {
      local.close();
    }
  });

  test("a commit with no goldens exits 1", async () => {
    await record();
    const head = headOf();
    const { code, json } = await desktop("reader", "pull", head);
    expect(code).toBe(1);
    expect(json).toMatchObject({ sha: head, batchId: null });
  });

  test("a commit that isn't one is a usage error", async () => {
    expect((await desktop("reader", "pull", "no-such-commit")).code).toBe(2);
  });

  test("CI can't pull a private project", async () => {
    await accepted();
    await laptop("writer", "push");
    const head = headOf();
    const { code, json } = await desktop("ci", "pull", head);
    expect(code).toBe(2);
    expect(json.error.code).toBe("not-allowed");
  });
});

describe("find-baseline with a remote", () => {
  test("finds goldens only the cloud has", async () => {
    await accepted();
    const head = headOf();
    await laptop("writer", "push");
    const otherHome = path.join(h.scratch, "other-home");
    const fresh = machine(h.repo, otherHome);
    expect((await fresh("reader", "find-baseline")).json).toMatchObject({ sha: head, source: "remote", remoteError: null });
  });

  test("prefers what's nearest, and says it was local", async () => {
    await accepted();
    const head = headOf();
    expect((await laptop("reader", "find-baseline")).json).toMatchObject({ sha: head, source: "local", remoteError: null });
  });

  test("answers from local data if the cloud can't be reached, and says so", async () => {
    await accepted();
    const offline = machine(h.repo, h.home, () => (async () => {
      throw new Error("no network");
    }) as typeof fetch);
    const { code, json } = await offline(null, "find-baseline");
    expect(code).toBe(0);
    expect(json).toMatchObject({ sha: headOf(), source: "local", remoteError: expect.stringContaining("no network") });
  });

  test("answers from local data if a proxy answers in its place, and says so", async () => {
    await accepted();
    const portal = machine(h.repo, h.home, () => (async () => new Response("<html>Sign in to this network</html>")) as typeof fetch);
    const { code, json } = await portal(null, "find-baseline");
    expect(code).toBe(0);
    expect(json).toMatchObject({ sha: headOf(), source: "local", remoteError: expect.stringContaining("didn't answer") });
  });

  test("answers from local data in a repository that isn't on GitHub, with a remote set for others", async () => {
    // First, since a store goes by its origin.
    git(h.repo, "remote", "set-url", "origin", "https://gitlab.com/diffplug/selfie.git");
    await accepted();
    const { code, json } = await laptop(null, "find-baseline");
    expect(code).toBe(0);
    expect(json).toMatchObject({ sha: headOf(), source: "local", remoteError: expect.stringContaining("GitHub") });
  });

  test("has no source if nothing has goldens", async () => {
    expect((await laptop("reader", "find-baseline")).json).toMatchObject({ sha: null, source: null });
  });

  test("with no remote set, it's as it was", async () => {
    await accepted();
    const { json } = await h.cli("find-baseline");
    expect(json.source).toBeUndefined();
  });
});

test("over a real socket, with the mount a deployment would use", async () => {
  await accepted();
  // Node's own server, since this package has no web framework of its own, in front of the routes.
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const answer = await app.request((request.url ?? "").replace(/^\/api/, ""), {
      method: request.method!,
      headers: request.headers as Record<string, string>,
      ...(body.length === 0 ? {} : { body }),
    });
    response.writeHead(answer.status, Object.fromEntries(answer.headers));
    response.end(Buffer.from(await answer.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    let stdout = "";
    const code = await runCli(["push"], {
      cwd: h.repo,
      env: { SELFIE_HOME: h.home, SELFIE_REMOTE: `http://127.0.0.1:${address.port}/`, SELFIE_TOKEN: "writer" },
      stdout: (text) => void (stdout += text),
      stderr: () => undefined,
    });
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ images: { sent: 2 }, goldens: { outcome: "accepted" } });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
