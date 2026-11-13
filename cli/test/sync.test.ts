// push and pull between two machines and a cloud store, on real Git and real stores, with a stand-in
// for GitHub. See docs/specs/sync.md.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { createLocalApp } from "selfie-ui/local";
import { createSyncApi, type SyncAccess } from "selfie-ui/sync";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { runCli } from "../src/cli.ts";
import { encodePng } from "../src/png.ts";
import { openProject, type Project } from "../src/project.ts";
import { localReviewSource } from "../src/ui.ts";
import { BLUE, commit, createHarness, fakeRender, git, GREEN, RED, solid, type FakeStory, type Harness, writeTestConfig } from "./support.ts";

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
/** A batch on the laptop with every image approved. */
async function approved() {
  const batchId = await record();
  await laptop(null, "approve", batchId, "--all");
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

/** Does this with a machine's store, which is closed again after. */
async function withStore<T>(repo: string, home: string, work: (project: Project) => Promise<T>): Promise<T> {
  const project = await openProject({ cwd: repo, env: { SELFIE_HOME: home } });
  try {
    return await work(project);
  } finally {
    project.close();
  }
}

/** An approval or a rejection of every image of a batch, as someone decides it on the remote itself. */
async function decideOnCloud(batchId: string, decision: "approved" | "rejected" = "approved") {
  const { batch, renders } = await cloud.batches.readBatch(batchId);
  await cloud.batches.decide({ environment: batch.environment, decision, actor: "someone-on-the-remote", renders: renders.map(({ story, imageHash }) => ({ story, imageHash: imageHash! })), on: { batchId, gitSha: batch.gitSha } });
  return batch;
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
      return access === undefined ? null : { access, defaultBranch: "main", batches: cloud.batches, store: cloud.store, storybooks: cloud.storybooks, diffs: cloud.diffs, hasCommit: async (sha) => pushedCommits === null || pushedCommits.has(sha) };
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
  test("sends a batch, its images, and its decisions", async () => {
    const batchId = await approved();
    const { code, json } = await laptop("writer", "push");
    expect(code).toBe(0);
    expect(json).toMatchObject({ batchId, images: { sent: 2, alreadyThere: 0 }, decisions: 2 });
    expect(json).not.toHaveProperty("goldens");
    const head = headOf();
    const held = await cloud.batches.getBatch(batchId);
    expect(held).toMatchObject({ id: batchId, gitSha: head, status: "complete" });
    expect(await cloud.batches.decisionsAt(held!.environment, [head])).toHaveLength(2);
  });

  test("keeps the comparison of what a branch approved with what its base had, which no one commit compared", async () => {
    const before = (await imagesOf(await approved()))[0]!;
    await laptop("writer", "push");
    git(h.repo, "checkout", "-b", "feature");
    for (const color of [BLUE, [1, 2, 3]] as const) {
      await commit(h.repo, `makes it ${color}`);
      stories = [{ id: "a", color }, { id: "b", color: GREEN }];
      await approved();
      await laptop("writer", "push");
    }
    await commit(h.repo, "changes nothing");
    const after = (await imagesOf(await record()))[0]!;
    await laptop("writer", "push");
    expect(await cloud.diffs.has(after, before)).toBe(true);
  });

  test("sends the diff of what a branch changed since its base, approved or not", async () => {
    await approved();
    await laptop("writer", "push");
    // main makes `a` blue, and nobody approves it, so what's approved and what main renders differ.
    await commit(h.repo, "makes it blue");
    stories = [{ id: "a", color: BLUE }, { id: "b", color: GREEN }];
    const base = (await imagesOf(await record()))[0]!;
    await laptop("ci", "push");
    git(h.repo, "checkout", "-b", "feature");
    await commit(h.repo, "makes it another color");
    stories = [{ id: "a", color: [1, 2, 3] }, { id: "b", color: GREEN }];
    const after = (await imagesOf(await record()))[0]!;
    await laptop("ci", "push");
    expect(await cloud.diffs.has(after, base)).toBe(true);
  });

  test("names who pushed as a decision's author, not what the laptop says", async () => {
    const batchId = await approved();
    await laptop("writer", "push");
    const { batch } = await cloud.batches.readBatch(batchId);
    const decisions = await cloud.batches.decisionsAt(batch.environment, [batch.gitSha]);
    expect(decisions.map(({ actor }) => actor)).toEqual(["writer-login", "writer-login"]);
  });

  test("is safe to run again, and sends nothing twice", async () => {
    await approved();
    await laptop("writer", "push");
    expect((await laptop("writer", "push")).json).toMatchObject({ images: { sent: 0, alreadyThere: 2 } });
  });

  test("takes no --accept any more", async () => {
    await approved();
    expect((await laptop("writer", "push", "--accept")).code).toBe(2);
  });

  test("sends only the images the cloud lacks", async () => {
    await approved();
    await laptop("writer", "push");
    await commit(h.repo, "second");
    stories = [{ id: "a", color: RED }, { id: "b", color: [1, 2, 3] }];
    await record();
    expect((await laptop("writer", "push")).json.images).toEqual({ sent: 1, alreadyThere: 1 });
  });

  test("a commit GitHub doesn't have costs nothing", async () => {
    pushedCommits = new Set();
    const batchId = await approved();
    const { code, json } = await laptop("writer", "push");
    expect(code).toBe(2);
    expect(json.error.code).toBe("commit-not-pushed");
    expect(await cloud.batches.getBatch(batchId)).toBeNull();
    const [{ imageHash }] = (await laptop(null, "review", batchId)).json.differences;
    expect(await cloud.store.missingImages([imageHash])).toEqual([imageHash]);
  });

  test("CI uploads with no decisions", async () => {
    const batchId = await record();
    const { code, json } = await laptop("ci", "push");
    expect(code).toBe(0);
    expect(json).toMatchObject({ decisions: null, images: { sent: 2 } });
    const held = (await cloud.batches.getBatch(batchId))!;
    expect(held.status).toBe("complete");
    expect(await cloud.batches.decisionsAt(held.environment, [held.gitSha])).toEqual([]);
  });

  test("a person's approvals hold for what CI renders at a merge commit, with nothing decided there", async () => {
    // A person approves these images on a branch, and pushes.
    const onBranch = await record();
    await laptop(null, "approve", onBranch, "--all");
    await laptop("writer", "push", onBranch);
    // The same images at the merge commit, rendered by CI.
    await commit(h.repo, "merge");
    const onMerge = await record();
    const { code, json } = await laptop("ci", "push", onMerge);
    expect(code).toBe(0);
    expect(json).toMatchObject({ batchId: onMerge, decisions: null });
    expect(await cloud.batches.compareReached(onMerge)).toMatchObject({ renders: [], unchangedCount: 2 });
  });

  test("CI on a fresh machine, which has never pulled, has its unchanged batch read by the cloud's approvals", async () => {
    await approved();
    await laptop("writer", "push");
    await commit(h.repo, "merge");
    // Nothing here but the checkout.
    const fresh = machine(h.repo, path.join(h.scratch, "ci-home"));
    const batchId = (await fresh("ci", "render")).json.batchId;
    const { code, json } = await fresh("ci", "push");
    expect(code).toBe(0);
    expect(json).toMatchObject({ batchId, decisions: null, images: { sent: 0 } });
    expect(await cloud.batches.compareReached(batchId)).toMatchObject({ renders: [], unchangedCount: 2 });
  });

  describe("after a rebase leaves a branch's approvals out of its history", () => {
    /** Says the batch's facts with `change` made to them, as a CLI of another version would. */
    const stating = (change: (facts: Record<string, unknown>) => void) =>
      machine(h.repo, h.home, () => (async (url: string, init?: RequestInit) => {
        if (init?.method !== "PUT" || !/\/batches\/[^/]+$/.test(new URL(url).pathname)) return toCloud(url, init);
        const facts = JSON.parse(init.body as string) as Record<string, unknown>;
        change(facts);
        return toCloud(url, { ...init, body: JSON.stringify(facts) });
      }) as typeof fetch);

    /** Approves a batch at a commit and pushes it, then amends that commit so HEAD's history no longer has it, and renders again. */
    async function amended() {
      const before = await commit(h.repo, "the work");
      await approved();
      await laptop("writer", "push");
      git(h.repo, "commit", "--quiet", "--amend", "-m", "the work, amended");
      expect(() => git(h.repo, "merge-base", "--is-ancestor", before, "HEAD")).toThrow();
      const batchId = await record();
      const local = (await laptop(null, "review", batchId)).json.differences.map(({ story, state }: { story: string; state: string }) => [story, state]);
      return { batchId, local };
    }
    const onCloud = async (batchId: string) => (await cloud.batches.compareReached(batchId)).renders.map(({ story, state }) => [story, state]);

    test("the cloud still counts them on that branch, as a review here does", async () => {
      git(h.repo, "checkout", "-b", "feature");
      const { batchId, local } = await amended();
      expect(local).toEqual([]);
      expect((await laptop("ci", "push", batchId)).code).toBe(0);
      expect(await cloud.batches.compareReached(batchId)).toMatchObject({ renders: [], unchangedCount: 2 });
    });

    test("a CLI that doesn't say when its branch began leaves the cloud reaching only history, as before", async () => {
      git(h.repo, "checkout", "-b", "feature");
      const { batchId } = await amended();
      expect((await stating((facts) => void delete facts.branchBegan)("ci", "push", batchId)).code).toBe(0);
      expect(await onCloud(batchId)).toEqual([["a", "added"], ["b", "added"]]);
    });

    test("on the default branch, only history counts, whatever a CLI says", async () => {
      const { batchId, local } = await amended();
      expect(local).toEqual([["a", "added"], ["b", "added"]]);
      expect((await stating((facts) => void (facts.branchBegan = 0))("ci", "push", batchId)).code).toBe(0);
      expect(await onCloud(batchId)).toEqual(local);
    });
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
    const batchId = await approved();
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
    const batchId = await approved();
    let imagesLeft = 1;
    const flaky = machine(h.repo, h.home, () => (async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT" && url.includes("/images/") && imagesLeft-- <= 0) throw new Error("connection lost");
      return toCloud(url, init);
    }) as typeof fetch);
    expect((await flaky("writer", "push")).code).toBe(2);
    expect((await cloud.batches.getBatch(batchId))?.status).toBe("recording");
    const { code, json } = await laptop("writer", "push");
    expect(code).toBe(0);
    expect(json).toMatchObject({ images: { sent: 1, alreadyThere: 1 } });
    expect((await cloud.batches.getBatch(batchId))?.status).toBe("complete");
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

  test("says the code a remote logged its error under", async () => {
    await record();
    let stdout = "";
    let stderr = "";
    const failing = async () => Response.json({ error: { code: "not-allowed", message: "This token can't upload.", id: "7K3MQ9XP" } }, { status: 403 });
    const code = await runCli(["push"], {
      cwd: h.repo,
      env: { SELFIE_HOME: h.home, SELFIE_REMOTE: REMOTE, SELFIE_TOKEN: "writer" },
      stdout: (text) => void (stdout += text),
      stderr: (text) => void (stderr += text),
      fetch: failing as typeof fetch,
    });
    expect(code).toBe(2);
    expect(stderr).toBe("selfie: This token can't upload.\nError code: 7K3MQ9XP\n");
    expect(JSON.parse(stdout).error).toEqual({ code: "not-allowed", message: "This token can't upload.", id: "7K3MQ9XP" });
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

  test("takes the decisions a commit reaches, and their images, and no batch", async () => {
    const batchId = await approved();
    await laptop("writer", "push");
    const head = headOf();
    const hashes = await imagesOf(batchId);
    const { code, json } = await desktop("reader", "pull", head);
    expect(code).toBe(0);
    expect(json).toEqual({ sha: head, environment: expect.any(String), images: { received: 2, alreadyHere: 0 }, decisions: 2 });

    await withStore(desktopRepo, desktopHome, async (local) => {
      expect(await local.batches.getBatch(batchId)).toBeNull();
      const decisions = await local.batches.decisionsAt(json.environment, [head]);
      expect(decisions.map(({ story, decision, actor, gitSha, batchId: on }) => [story, decision, actor, gitSha, on]).sort()).toEqual([
        ["a", "approved", "writer-login", head, batchId],
        ["b", "approved", "writer-login", head, batchId],
      ]);
      for (const hash of hashes) expect(await local.store.getPixels(hash!)).not.toBeNull();
    });
  });

  test("an approval made on the remote reaches a fresh store, with its image, and a review there reads that story as unchanged", async () => {
    const batchId = await record();
    await laptop("ci", "push");
    const { environment } = await decideOnCloud(batchId);
    const hashes = await imagesOf(batchId);

    const { code, json } = await desktop("reader", "pull");
    expect(code).toBe(0);
    expect(json).toMatchObject({ images: { received: 2, alreadyHere: 0 }, decisions: 2 });
    await withStore(desktopRepo, desktopHome, async (local) => {
      for (const hash of hashes) expect(await local.store.getPixels(hash!)).not.toBeNull();
    });

    const own = await record(desktop);
    const reviewed = await desktop(null, "review", own);
    expect(reviewed.code).toBe(0);
    expect(reviewed.json.differences).toEqual([]);
    expect(reviewed.json.counts).toMatchObject({ unchanged: 2, changed: 0, added: 0, undecided: 0 });
    await withStore(desktopRepo, desktopHome, async (local) => {
      const decisions = await local.batches.decisionsAt(environment, [headOf()]);
      expect((await local.batches.compareFromHistory(own, decisions, { includeUnchanged: true })).renders.map(({ story, state }) => [story, state])).toEqual([["a", "unchanged"], ["b", "unchanged"]]);
    });
  });

  test("a batch already here reads differently once its approvals come, with no image to fetch", async () => {
    const batchId = await record();
    await laptop("ci", "push");
    await decideOnCloud(batchId);
    const own = await record(desktop);
    expect((await desktop(null, "review", own)).json.counts).toMatchObject({ added: 2, unchanged: 0 });
    expect((await desktop("reader", "pull")).json).toMatchObject({ images: { received: 0, alreadyHere: 2 }, decisions: 2 });
    expect((await desktop(null, "review", own)).json.counts).toMatchObject({ added: 0, unchanged: 2 });
  });

  test("an image that comes with an approval is there to show a change against", async () => {
    const batchId = await record();
    await laptop("ci", "push");
    await decideOnCloud(batchId);
    await desktop("reader", "pull");

    stories = [{ id: "a", color: [1, 2, 3] }, { id: "b", color: GREEN }];
    const reviewed = await desktop(null, "review", await record(desktop));
    expect(reviewed.code).toBe(1);
    expect(reviewed.json.counts).toMatchObject({ changed: 1, unchanged: 1 });
    expect(reviewed.json.differences).toMatchObject([{ story: "a", state: "changed" }]);
    expect(await readFile(reviewed.json.differences[0].golden)).not.toHaveLength(0);
  });

  test("the review page shows a change against a reference whose batch never came here", async () => {
    const batchId = await record();
    await laptop("ci", "push");
    await decideOnCloud(batchId);
    await desktop("reader", "pull");
    stories = [{ id: "a", color: [1, 2, 3] }, { id: "b", color: GREEN }];
    const own = await record(desktop);

    await withStore(desktopRepo, desktopHome, async (local) => {
      const page = createLocalApp({ source: localReviewSource(local), port: () => 4173, clientDir: h.scratch });
      const get = (route: string) => page.request(route, { headers: { host: "127.0.0.1:4173" } });
      const response = await get(`/api/batches/${own}`);
      expect(response.status).toBe(200);
      const { rows, counts } = (await response.json()) as any;
      expect(counts).toMatchObject({ changed: 1, added: 0 });
      expect(rows).toMatchObject([{ story: "a", state: "changed", goldenBatchId: batchId, goldenStorybookUrl: null, goldenViewport: null }]);
      expect((await get(`/api/images/${rows[0].goldenHash}`)).status).toBe(200);
      expect((await get("/api/stories")).status).toBe(200);
    });
  });

  test("a commit that hasn't been pushed works from its ancestors", async () => {
    await approved();
    await laptop("writer", "push");
    const unpushed = await commit(desktopRepo, "only here");
    const { code, json } = await desktop("reader", "pull");
    expect(code).toBe(0);
    expect(json).toMatchObject({ sha: unpushed, images: { received: 2 }, decisions: 2 });
    const reviewed = await desktop(null, "review", await record(desktop));
    expect(reviewed.code).toBe(0);
    expect(reviewed.json.counts).toMatchObject({ unchanged: 2, changed: 0, added: 0 });
  });

  test("takes nothing from commits it doesn't reach", async () => {
    const first = await approved();
    await laptop("writer", "push", first);
    const reached = headOf();
    await commit(h.repo, "only there");
    stories = [{ id: "a", color: RED }, { id: "b", color: [1, 2, 3] }];
    await approved();
    await laptop("writer", "push");

    // Still at the commit it was cloned at, which doesn't have that one.
    expect(git(desktopRepo, "rev-parse", "HEAD")).toBe(reached);
    expect((await desktop("reader", "pull")).json).toMatchObject({ images: { received: 2 }, decisions: 2 });
    expect((await desktop("reader", "pull", reached)).json).toMatchObject({ images: { received: 0, alreadyHere: 2 } });
    git(desktopRepo, "pull", "--quiet", h.repo, "main");
    expect((await desktop("reader", "pull")).json).toMatchObject({ images: { received: 1, alreadyHere: 2 }, decisions: 3 });
  });

  test("a decision pulled here counts from its commit, so a later commit asks nothing", async () => {
    await approved();
    await laptop("writer", "push");
    await desktop("reader", "pull", headOf());
    await commit(desktopRepo, "more");
    const { json: reviewed } = await desktop(null, "review");
    expect(reviewed.counts).toMatchObject({ unchanged: 2, changed: 0, added: 0 });
  });

  test("defaults to HEAD, if it isn't told a commit", async () => {
    await approved();
    await laptop("writer", "push");
    expect((await desktop("reader", "pull")).json).toMatchObject({ sha: git(desktopRepo, "rev-parse", "HEAD"), decisions: 2 });
  });

  test("pulling twice changes nothing, and fetches nothing the second time", async () => {
    await approved();
    await laptop("writer", "push");
    const { json: first } = await desktop("reader", "pull");
    expect(first).toMatchObject({ images: { received: 2, alreadyHere: 0 }, decisions: 2 });
    const held = () => withStore(desktopRepo, desktopHome, async ({ batches }) => [...(await batches.decisionsAt(first.environment, [first.sha]))]);
    const before = await held();

    const asked: string[] = [];
    const counting = machine(desktopRepo, desktopHome, () => (async (url: string, init?: RequestInit) => {
      asked.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
      return toCloud(url, init);
    }) as typeof fetch);
    const { code, json: second } = await counting("reader", "pull");
    expect(code).toBe(0);
    expect(second).toEqual({ ...first, images: { received: 0, alreadyHere: 2 } });
    expect(asked.filter((request) => request.includes("/images/") || request.includes("/batches/"))).toEqual([]);
    expect(asked).toEqual(["GET /api/repositories/diffplug/selfie", "POST /api/projects/42/decisions/reached"]);
    expect(await held()).toEqual(before);
  });

  test("a pull that dies partway keeps no decisions, and is finished by pulling again", async () => {
    await approved();
    await laptop("writer", "push");
    const head = headOf();
    let imagesLeft = 1;
    const flaky = machine(desktopRepo, desktopHome, () => (async (url: string, init?: RequestInit) => {
      if (url.includes("/images/") && imagesLeft-- <= 0) throw new Error("connection lost");
      return toCloud(url, init);
    }) as typeof fetch);
    const died = await flaky("reader", "pull", head);
    expect(died.code).toBe(2);
    const environment = (await withStore(h.repo, h.home, ({ batches }) => batches.newestFinished()))!.environment;
    expect(await withStore(desktopRepo, desktopHome, ({ batches }) => batches.decisionsAt(environment, [head]))).toEqual([]);
    // However many had landed when it died.
    const { json } = await desktop("reader", "pull", head);
    expect(json.decisions).toBe(2);
    expect(json.images.received + json.images.alreadyHere).toBe(2);
    expect(await withStore(desktopRepo, desktopHome, ({ batches }) => batches.decisionsAt(environment, [head]))).toHaveLength(2);
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
    const batchId = await approved();
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
    const { environment } = (await cloud.batches.getBatch(batchId))!;
    await withStore(desktopRepo, desktopHome, async (here) => {
      expect(await here.store.lookupKey(hash!)).toBeNull();
      expect(await here.batches.decisionsAt(environment, [headOf()])).toEqual([]);
    });
  });

  test("a later decision here on the same image, at the same commit, isn't undone by an older one pulled", async () => {
    await approved();
    await laptop("writer", "push");
    const head = headOf();
    const own = await record(desktop);
    await desktop(null, "reject", own, "--all");
    const { json } = await desktop("reader", "pull", head);
    expect(json).toMatchObject({ images: { received: 0, alreadyHere: 2 }, decisions: 2 });
    await withStore(desktopRepo, desktopHome, async (local) => {
      const decisions = await local.batches.decisionsAt(json.environment, [head]);
      expect(decisions.map(({ decision, actor }) => [decision, actor])).toEqual([["rejected", "desktop@example.com"], ["rejected", "desktop@example.com"]]);
    });
  });

  test("a later approval here of something else stands after a pull", async () => {
    await approved();
    await laptop("writer", "push");
    await desktop("reader", "pull");

    await commit(desktopRepo, "changes a");
    stories = [{ id: "a", color: [1, 2, 3] }, { id: "b", color: GREEN }];
    const own = await record(desktop);
    await desktop(null, "approve", own, "--all");
    expect((await desktop("reader", "pull")).json).toMatchObject({ images: { received: 0 }, decisions: 2 });

    await commit(desktopRepo, "more");
    const reviewed = await desktop(null, "review", await record(desktop));
    expect(reviewed.code).toBe(0);
    expect(reviewed.json.counts).toMatchObject({ unchanged: 2, changed: 0 });
  });

  test("a later decision on the remote replaces an older one here", async () => {
    const batchId = await record();
    await laptop("ci", "push");
    const own = await record(desktop);
    await desktop(null, "reject", own, "--all");
    await new Promise((resolve) => setTimeout(resolve, 2));
    const { environment, gitSha } = await decideOnCloud(batchId);
    await desktop("reader", "pull");
    await withStore(desktopRepo, desktopHome, async (local) => {
      expect((await local.batches.decisionsAt(environment, [gitSha])).map(({ decision, actor }) => [decision, actor])).toEqual([["approved", "someone-on-the-remote"], ["approved", "someone-on-the-remote"]]);
    });
  });

  describe("a removal", () => {
    /** The laptop approved a and b, then a's story went away, and that's been rendered and pushed. */
    async function dropA(token: string) {
      await approved();
      await laptop("writer", "push");
      await commit(h.repo, "drops a");
      stories = [{ id: "b", color: GREEN }];
      const batchId = await record();
      await laptop(token, "push", batchId);
      return batchId;
    }

    test("approved on the remote comes down, and a review here stops asking about it", async () => {
      const batchId = await dropA("ci");
      const { environment, gitSha } = (await cloud.batches.getBatch(batchId))!;
      git(desktopRepo, "pull", "--quiet", h.repo, "main");

      await desktop("reader", "pull");
      const own = await record(desktop);
      const asked = await desktop(null, "review", own);
      expect(asked.code).toBe(1);
      expect(asked.json.differences).toMatchObject([{ story: "a", state: "removed" }]);

      await cloud.batches.decide({ environment, decision: "approved", actor: "someone-on-the-remote", renders: [{ story: "a", imageHash: null }], on: { batchId, gitSha } });
      const { code, json } = await desktop("reader", "pull");
      expect(code).toBe(0);
      expect(json).toMatchObject({ images: { received: 0 }, decisions: 3 });
      await withStore(desktopRepo, desktopHome, async (local) => {
        expect((await local.batches.decisionsAt(environment, [gitSha])).map(({ story, imageHash, decision, actor }) => [story, imageHash, decision, actor])).toEqual([["a", null, "approved", "someone-on-the-remote"]]);
      });
      const reviewed = await desktop(null, "review", own);
      expect(reviewed.code).toBe(0);
      expect(reviewed.json.differences).toEqual([]);
      expect(reviewed.json.counts).toMatchObject({ removed: 0, unchanged: 1 });
    });

    test("approved here goes up with a push, by a token that may decide", async () => {
      const batchId = await dropA("writer");
      const { environment, gitSha } = (await cloud.batches.getBatch(batchId))!;
      expect(await cloud.batches.decisionsAt(environment, [gitSha])).toEqual([]);
      expect((await cloud.batches.compareReached(batchId)).renders).toMatchObject([{ story: "a", state: "removed" }]);

      await laptop(null, "approve", batchId, "--all");
      const { code, json } = await laptop("writer", "push", batchId);
      expect(code).toBe(0);
      // Its own, and b's approval from the commit before, which is on an image of this batch.
      expect(json.decisions).toBe(2);
      expect((await cloud.batches.decisionsAt(environment, [gitSha])).map(({ story, imageHash, decision, actor, batchId: on }) => [story, imageHash, decision, actor, on])).toEqual([["a", null, "approved", "writer-login", batchId]]);
      expect((await cloud.batches.compareReached(batchId)).renders).toMatchObject([{ story: "a", state: "removed", decision: { decision: "approved" } }]);

      // A later commit doesn't ask about it.
      await commit(h.repo, "later");
      const later = await record();
      await laptop("ci", "push", later);
      expect(await cloud.batches.compareReached(later)).toMatchObject({ renders: [], unchangedCount: 1 });
    });

    test("approved here stays here, for a token that can't decide", async () => {
      const batchId = await dropA("ci");
      const { environment, gitSha } = (await cloud.batches.getBatch(batchId))!;
      await laptop(null, "approve", batchId, "--all");
      const { code, json } = await laptop("ci", "push", batchId);
      expect(code).toBe(0);
      expect(json.decisions).toBeNull();
      expect(await cloud.batches.decisionsAt(environment, [gitSha])).toEqual([]);
    });

    test("is found by what the commit reaches, so it goes up from a later commit's push too", async () => {
      const batchId = await dropA("ci");
      const { environment, gitSha } = (await cloud.batches.getBatch(batchId))!;
      await laptop(null, "approve", batchId, "--all");
      await commit(h.repo, "later");
      await record();
      const { code } = await laptop("writer", "push");
      expect(code).toBe(0);
      expect(await cloud.batches.decisionsAt(environment, [gitSha])).toMatchObject([{ story: "a", imageHash: null, decision: "approved", actor: "writer-login" }]);
    });
  });

  test("with nothing on the remote, takes no decisions and exits 0", async () => {
    const head = git(desktopRepo, "rev-parse", "HEAD");
    const { code, json } = await desktop("reader", "pull");
    expect(code).toBe(0);
    expect(json).toEqual({ sha: head, environment: expect.any(String), images: { received: 0, alreadyHere: 0 }, decisions: 0 });
  });

  test("a batch with nothing decided on it gives no decisions, and exits 0", async () => {
    await record();
    await laptop("ci", "push");
    const head = headOf();
    const { code, json } = await desktop("reader", "pull", head);
    expect(code).toBe(0);
    expect(json).toMatchObject({ sha: head, images: { received: 0, alreadyHere: 0 }, decisions: 0 });
  });

  test("a commit that isn't one is a usage error", async () => {
    expect((await desktop("reader", "pull", "no-such-commit")).code).toBe(2);
  });

  test("a repository with no commits has nothing to ask about", async () => {
    const empty = path.join(h.scratch, "empty");
    git(h.scratch, "init", "--quiet", "--initial-branch=main", empty);
    git(empty, "remote", "add", "origin", "https://github.com/diffplug/selfie.git");
    await writeTestConfig(empty);
    const asked: string[] = [];
    const run = machine(empty, path.join(h.scratch, "empty-home"), () => (async (url: string, init?: RequestInit) => {
      asked.push(url);
      return toCloud(url, init);
    }) as typeof fetch);
    const { code, json } = await run("reader", "pull");
    expect(code).toBe(0);
    expect(json).toEqual({ sha: null, environment: expect.any(String), images: { received: 0, alreadyHere: 0 }, decisions: 0 });
    expect(asked).toEqual([]);
  });

  test("CI can't pull a private project", async () => {
    await approved();
    await laptop("writer", "push");
    const head = headOf();
    const { code, json } = await desktop("ci", "pull", head);
    expect(code).toBe(2);
    expect(json.error.code).toBe("not-allowed");
  });
});

test("over a real socket, with the mount a deployment would use", async () => {
  await approved();
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
    const overSocket = async (argv: string[], home: string) => {
      stdout = "";
      const code = await runCli(argv, {
        cwd: h.repo,
        env: { SELFIE_HOME: home, SELFIE_REMOTE: `http://127.0.0.1:${address.port}/`, SELFIE_TOKEN: "writer" },
        stdout: (text) => void (stdout += text),
        stderr: () => undefined,
      });
      return { code, json: JSON.parse(stdout) };
    };
    expect(await overSocket(["push"], h.home)).toMatchObject({ code: 0, json: { images: { sent: 2 }, decisions: 2 } });
    expect(await overSocket(["pull"], path.join(h.scratch, "fresh-home"))).toMatchObject({ code: 0, json: { images: { received: 2 }, decisions: 2 } });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
