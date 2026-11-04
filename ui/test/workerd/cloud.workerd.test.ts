// The whole cloud service inside workerd, on its local D1 and R2, with a stand-in for GitHub. Nothing
// crosses to Node, and no account is involved. These run in order, each on what the last left.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { R2BucketLike } from "selfie-store/adapters/r2";
import { createCloudApp } from "../../src/worker/app.ts";
import type { CommitStatus } from "../../src/shared/commit-status.ts";

const ORIGIN = "https://review.test";
const STORYBOOKS = "https://storybooks.test";
const PASSWORD = "the-password";
const UPLOAD = "the-upload-token";
const ENV = "container-linux-arm64-0123456789abcdef";
const FIRST_SHA = "a".repeat(40);
const NEXT_SHA = "b".repeat(40);
const UNPUSHED = "c".repeat(40);
const FIRST = "11111111-1111-4111-8111-111111111111";
const NEXT = "22222222-2222-4222-8222-222222222222";
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const png = fromBase64("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4XmM4IScHRwzEcQCxYxBBF7FZ1QAAAABJRU5ErkJggg==");
const hash = "6fc35503986a1b85896ca807408798a0bbbf1ad557fd91ee6d19f5ba0469e636";

const statuses: { sha: string; status: CommitStatus; url: string }[] = [];
let app: ReturnType<typeof createCloudApp>;
let cookie = "";

const api = (method: string, route: string, token: string | null, body?: unknown) =>
  app.request(`${ORIGIN}/api/projects/42${route}`, {
    method,
    headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: body instanceof Uint8Array ? (body as Uint8Array<ArrayBuffer>) : JSON.stringify(body) }),
  });

const review = (method: string, route: string, { body, signedIn = false }: { body?: unknown; signedIn?: boolean } = {}) =>
  app.request(`${ORIGIN}/diffplug/selfie/api${route}`, {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json", "x-selfie-request": "review-ui", ...(signedIn ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const facts = (gitSha: string) => ({ gitSha, environment: ENV, startedAt: 500, dirty: false, storyFilter: null, reusedFromBatch: null, scale: 1, viewport: { width: 1200, height: 900 }, branch: "main" });

async function pushBatch(id: string, sha: string) {
  expect((await api("PUT", `/batches/${id}`, UPLOAD, facts(sha))).status).toBe(200);
  expect((await api("POST", `/batches/${id}/renders`, UPLOAD, { renders: [{ story: "a", imageHash: hash }] })).status).toBe(200);
  expect((await api("POST", `/batches/${id}/finish`, UPLOAD, { count: 1, finishedAt: 600 })).status).toBe(200);
  expect((await api("POST", `/batches/${id}/status`, UPLOAD, {})).status).toBe(200);
}

beforeAll(() => {
  app = createCloudApp({
    projects: [{ id: "42", owner: "diffplug", name: "selfie", defaultBranch: "main", db: env.DB as never }],
    bucket: env.BLOBS as R2BucketLike,
    reviewOrigin: ORIGIN,
    storybookOrigin: STORYBOOKS,
    password: PASSWORD,
    uploadToken: UPLOAD,
    now: () => 1_000_000,
    github: {
      hasCommit: async (_repository, sha) => sha !== UNPUSHED,
      postStatus: async (_repository, sha, status, url) => void statuses.push({ sha, status, url }),
    },
    assets: { fetch: async () => new Response("<!doctype html><html><head><title>Selfie</title></head></html>", { headers: { "content-type": "text/html" } }) },
  });
});

describe("the cloud service", () => {
  it("tells a page which project it's in, and lets anyone look", async () => {
    const page = await app.request(`${ORIGIN}/diffplug/selfie/batches/${FIRST}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<meta name="selfie-base" content="/diffplug/selfie">');
    expect(page.headers.get("content-security-policy")).toContain(`frame-src ${STORYBOOKS}`);
    expect((await app.request(`${ORIGIN}/someone/else`)).status).toBe(404);
  });

  it("takes a batch from CI's token, and from nobody else", async () => {
    expect((await api("PUT", `/batches/${FIRST}`, null, facts(FIRST_SHA))).status).toBe(403);
    expect((await api("PUT", `/batches/${FIRST}`, "wrong", facts(FIRST_SHA))).status).toBe(403);
    expect((await api("PUT", `/batches/${FIRST}`, UPLOAD, facts(UNPUSHED))).status).toBe(409);
    expect((await api("PUT", `/images/${hash}`, UPLOAD, png)).status).toBe(200);
    await pushBatch(FIRST, FIRST_SHA);
  });

  it("says a new story waits for someone, with a link to the batch", async () => {
    expect(statuses.at(-1)).toEqual({
      sha: FIRST_SHA,
      status: { state: "pending", description: "1 added, waiting for approval" },
      url: `${ORIGIN}/diffplug/selfie/batches/${FIRST}`,
    });
  });

  it("shows anyone the batch, and refuses a decision from CI's token or someone signed out", async () => {
    const view = (await (await review("GET", `/batches/${FIRST}`)).json()) as { actor: string | null; counts: { added: number } };
    expect(view).toMatchObject({ actor: null, counts: { added: 1 } });
    const target = { decision: "approved", renders: [{ story: "a", imageHash: hash }] };
    expect((await review("POST", `/batches/${FIRST}/decisions`, { body: target })).status).toBe(401);
    expect((await api("POST", "/decisions", UPLOAD, { environment: ENV, decisions: [] })).status).toBe(403);
    expect((await (await review("GET", "/images/" + hash)).arrayBuffer()).byteLength).toBe(png.length);
  });

  it("signs in with the password only, and only sends you back to this site", async () => {
    const signIn = (password: string, next = "/diffplug/selfie") =>
      app.request(`${ORIGIN}/sign-in`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ password, next }).toString() });
    expect((await signIn("wrong")).status).toBe(401);
    expect((await signIn(PASSWORD, "https://evil.test/")).headers.get("location")).toBe("/");
    expect((await signIn(PASSWORD, "//evil.test/")).headers.get("location")).toBe("/");
    const response = await signIn(PASSWORD);
    expect(response.status).toBe(303);
    const set = response.headers.get("set-cookie")!;
    expect(set).toMatch(/^__Host-selfie-session=.*HttpOnly; Secure; SameSite=Strict$/);
    cookie = set.split(";")[0]!;
    const tampered = await review("GET", `/batches/${FIRST}`, { signedIn: false });
    expect(((await tampered.json()) as { actor: string | null }).actor).toBeNull();
    const view = await review("GET", `/batches/${FIRST}`, { signedIn: true });
    expect(((await view.json()) as { actor: string | null }).actor).toBe("nedtwigg");
  });

  it("turns green when the writer approves, and red when they reject", async () => {
    const decide = (decision: string) => review("POST", `/batches/${FIRST}/decisions`, { signedIn: true, body: { decision, renders: [{ story: "a", imageHash: hash }] } });
    expect((await decide("rejected")).status).toBe(200);
    expect(statuses.at(-1)!.status).toEqual({ state: "failure", description: "1 change rejected" });
    expect((await decide("approved")).status).toBe(200);
    expect(statuses.at(-1)!.status.state).toBe("success");
  });

  it("carries an approval to a later commit that reaches it, by the graph CI sent", async () => {
    expect((await api("POST", "/commits", UPLOAD, { commits: [{ sha: NEXT_SHA, parents: [FIRST_SHA] }, { sha: FIRST_SHA, parents: [] }] })).status).toBe(200);
    await pushBatch(NEXT, NEXT_SHA);
    expect(statuses.at(-1)).toMatchObject({ sha: NEXT_SHA, status: { state: "success", description: "1 story matches what's approved" } });
  });

  it("says a commit's status only at the end of a push, or on a decision made here", async () => {
    const posted = statuses.length;
    const decision = { story: "a", imageHash: hash, decision: "approved", at: 900, gitSha: FIRST_SHA, batchId: FIRST };
    expect((await api("POST", "/decisions", PASSWORD, { environment: ENV, decisions: [decision] })).status).toBe(200);
    expect(statuses.length).toBe(posted);
    expect((await api("POST", `/batches/${NEXT}/status`, null, {})).status).toBe(403);
    expect((await api("POST", `/batches/${NEXT}/status`, UPLOAD, {})).status).toBe(200);
    expect(statuses.slice(posted).map(({ sha }) => sha)).toEqual([NEXT_SHA]);
  });

  it("serves a kept built Storybook only from its own origin", async () => {
    const file = new TextEncoder().encode("<html>story</html>");
    const fileHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", file))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const build = "d".repeat(64);
    expect(((await (await api("POST", "/storybooks/files/missing", UPLOAD, { hashes: [fileHash] })).json()) as { missing: string[] }).missing).toEqual([fileHash]);
    expect((await api("PUT", `/storybooks/${build}`, UPLOAD, { files: [{ path: "index.html", fileHash }] })).status).toBe(409);
    expect((await api("PUT", `/storybooks/files/${"e".repeat(64)}`, UPLOAD, file)).status).toBe(400);
    expect((await api("PUT", `/storybooks/files/${fileHash}`, UPLOAD, file)).status).toBe(200);
    expect((await api("PUT", `/storybooks/${build}`, UPLOAD, { files: [{ path: "index.html", fileHash }] })).status).toBe(200);
    expect((await api("POST", `/batches/${FIRST}/storybook`, UPLOAD, { build })).status).toBe(200);

    const served = await app.request(`${STORYBOOKS}/42/built-storybooks/${build}/`);
    expect(await served.text()).toBe("<html>story</html>");
    expect(served.headers.get("content-security-policy")).toContain(`frame-ancestors 'self' ${ORIGIN}`);
    expect((await app.request(`${STORYBOOKS}/42/api/projects/42`)).status).toBe(404);
    expect((await app.request(`${STORYBOOKS}/api/projects/42`)).status).toBe(404);
    expect((await app.request(`${STORYBOOKS}/sign-in`)).status).toBe(404);

    const view = (await (await review("GET", `/batches/${FIRST}`)).json()) as { storybook: { url: string; exactStorybook: boolean } };
    expect(view.storybook).toEqual({ url: `${STORYBOOKS}/42/built-storybooks/${build}/`, exactStorybook: true });
  });

  it("keeps a diff a client worked out, for showing", async () => {
    const other = "9".repeat(64);
    const stats = { hunks: [], changedPixels: 1 };
    expect((await api("PUT", `/diffs/${hash}/${other}/image`, null, png)).status).toBe(403);
    expect((await api("PUT", `/diffs/${hash}/${other}`, null, stats)).status).toBe(403);
    expect((await api("PUT", `/diffs/${hash}/${other}/image`, UPLOAD, png)).status).toBe(200);
    expect((await api("PUT", `/diffs/${hash}/${other}`, UPLOAD, stats)).status).toBe(200);
    expect(await (await review("GET", `/diffs/${hash}/${other}`)).json()).toEqual(stats);
    expect(await (await review("GET", `/diffs/${hash}/${other}/image`)).status).toBe(200);
    expect((await review("POST", "/notes", { signedIn: true, body: { story: "a", batchId: FIRST, imageHash: hash, box: null, text: "hi" } })).status).toBe(403);
    expect((await review("POST", "/renders", { signedIn: true, body: { stories: ["a"] } })).status).toBe(403);
  });
});
