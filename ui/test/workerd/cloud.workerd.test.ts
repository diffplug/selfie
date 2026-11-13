// The whole cloud service inside workerd, on its local D1 and R2, with stand-ins for GitHub and for
// pgstencil's auth adapter. Nothing crosses to Node, and no account is involved. These run in order, each on what the last left.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { R2BucketLike } from "selfie-store/adapters/r2";
import { createCloudApp } from "../../src/worker/app.ts";
import { pgstencilLogin, type AuthFetch } from "../../src/worker/login.ts";
import type { CommitStatus } from "../../src/shared/commit-status.ts";

const ORIGIN = "https://review.test";
const STORYBOOKS = "https://storybooks.test";
const WRITER_TOKEN = "the-writer-token";
const FORMER = "https://hackathon.test";
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

/**
 * pgstencil's adapter, as far as the Worker uses it: a CSRF token, GitHub's authorization URL, a session from
 * GitHub's callback (whose `code` here says whose account it is), the session's accounts, and signing out.
 */
const signedOut: string[] = [];
const fakeAuth: AuthFetch = async (request) => {
  const url = new URL(request.url);
  const cookies = request.headers.get("cookie") ?? "";
  const session = /__Host-pgstencil\.session_token=([^;]+)/.exec(cookies)?.[1];
  const json = (body: unknown, setCookie?: string) => {
    const response = Response.json(body);
    if (setCookie !== undefined) response.headers.append("set-cookie", setCookie);
    return response;
  };
  const csrfOk = () => request.headers.get("origin") === ORIGIN && request.headers.get("x-csrf-token") === "t" && cookies.includes("__Host-pgstencil.csrf=t.sig");
  switch (`${request.method} ${url.pathname}`) {
    case "GET /api/auth/csrf":
      return json({ csrf: "t" }, "__Host-pgstencil.csrf=t.sig; Path=/; HttpOnly; SameSite=Lax; Secure");
    case "POST /api/auth/sign-in/social":
      if (!csrfOk()) return new Response(null, { status: 403 });
      return json({ url: "https://github.com/login/oauth/authorize?state=s", redirect: false }, "__Host-pgstencil.state=s; Path=/; HttpOnly; SameSite=Lax; Secure");
    case "GET /api/auth/callback/github": {
      if (url.searchParams.get("code") === "refused") return new Response(null, { status: 302, headers: { location: `${ORIGIN}/sign-in?failed=1&error=state_mismatch` } });
      if (url.searchParams.get("code") === "crash") return new Response("GitHub identity request failed", { status: 500 });
      const response = new Response(null, { status: 302, headers: { location: `${ORIGIN}/signed-in` } });
      response.headers.append("set-cookie", `__Host-pgstencil.session_token=${url.searchParams.get("code")}; Path=/; HttpOnly; SameSite=Lax; Secure`);
      return response;
    }
    case "GET /api/auth/get-session":
      if (session === "stranger") return json({ user: { email: "new.person+selfie@example.com", emailVerified: true } });
      if (session === "unverified") return json({ user: { email: "maybe@example.com", emailVerified: false } });
      return json(null);
    case "GET /api/auth/list-accounts":
      if (session === "writer") return json([{ providerId: "github", accountId: "2924992" }]);
      if (session === "stranger" || session === "unverified") return json([{ providerId: "github", accountId: "1" }]);
      if (session === "broken") return new Response(null, { status: 500 });
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    case "POST /api/auth/sign-out":
      if (!csrfOk()) return new Response(null, { status: 403 });
      signedOut.push(session ?? "");
      return json({ success: true }, "__Host-pgstencil.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure");
    default:
      return new Response(null, { status: 404 });
  }
};

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
    projects: [{ id: "42", owner: "diffplug", name: "selfie", formerNames: ["selfie-hackathon"], defaultBranch: "main", db: env.DB as never }],
    bucket: env.BLOBS as R2BucketLike,
    reviewOrigin: ORIGIN,
    storybookOrigin: STORYBOOKS,
    formerOrigins: [FORMER],
    login: pgstencilLogin({ origin: ORIGIN, auth: fakeAuth, writerGithubId: "2924992", writerName: "nedtwigg", signupUrl: "https://landing.test/" }),
    writerToken: WRITER_TOKEN,
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

  it("signs in through GitHub, and only sends you back to this site", async () => {
    const begin = (next: string, origin = ORIGIN) =>
      app.request(`${ORIGIN}/sign-in`, { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ next }).toString() });
    const page = await app.request(`${ORIGIN}/sign-in?next=/diffplug/selfie`);
    expect(await page.text()).toContain("Sign in with GitHub");
    expect(page.headers.get("content-security-policy")).toContain("form-action 'self' https://github.com");
    expect((await begin("/diffplug/selfie", "https://evil.test")).status).toBe(403);

    const started = await begin("/diffplug/selfie");
    expect(started.status).toBe(303);
    expect(started.headers.get("location")).toBe("https://github.com/login/oauth/authorize?state=s");
    const set = started.headers.getSetCookie();
    expect(set.map((line) => line.split("=")[0])).toEqual(["__Host-pgstencil.csrf", "__Host-pgstencil.state", "__Host-selfie-next"]);
    expect(set[2]).toBe("__Host-selfie-next=%2Fdiffplug%2Fselfie; Path=/; Max-Age=600; HttpOnly; SameSite=Lax; Secure");
    expect((await begin("//evil.test/")).headers.getSetCookie()[2]).toMatch(/^__Host-selfie-next=%2F;/);

    const back = await app.request(`${ORIGIN}/api/auth/callback/github?code=writer&state=s`);
    expect(back.headers.get("location")).toBe(`${ORIGIN}/signed-in`);
    cookie = back.headers.getSetCookie()[0]!.split(";")[0]!;
    const landed = await app.request(`${ORIGIN}/signed-in`, { headers: { cookie: `${cookie}; __Host-selfie-next=%2Fdiffplug%2Fselfie` } });
    expect(landed.headers.get("location")).toBe("/diffplug/selfie");
    expect(landed.headers.getSetCookie()).toEqual(["__Host-selfie-next=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure"]);
    const sneaky = await app.request(`${ORIGIN}/signed-in`, { headers: { cookie: `${cookie}; __Host-selfie-next=https%3A%2F%2Fevil.test` } });
    expect(sneaky.headers.get("location")).toBe("/");
    const garbled = await app.request(`${ORIGIN}/signed-in`, { headers: { cookie: `${cookie}; __Host-selfie-next=%E0%A4%A` } });
    expect(garbled.headers.get("location")).toBe("/");

    const anonymous = await review("GET", `/batches/${FIRST}`, { signedIn: false });
    expect(((await anonymous.json()) as { actor: string | null }).actor).toBeNull();
    const view = await review("GET", `/batches/${FIRST}`, { signedIn: true });
    expect(((await view.json()) as { actor: string | null }).actor).toBe("nedtwigg");
  });

  it("signs anyone but the writer straight back out, offers them the mailing list, and never lets them decide", async () => {
    const stranger = "__Host-pgstencil.session_token=stranger";
    const landed = await app.request(`${ORIGIN}/signed-in`, { headers: { cookie: `${stranger}; __Host-selfie-next=%2Fdiffplug%2Fselfie` } });
    // In the fragment, which the browser never sends to a server.
    expect(landed.headers.get("location")).toBe("https://landing.test/#join=new.person%2Bselfie%40example.com");
    expect(landed.headers.getSetCookie()).toContain("__Host-pgstencil.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure");
    expect(landed.headers.getSetCookie()).toContain("__Host-selfie-next=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure");
    expect(signedOut).toEqual(["stranger"]);
    const view = await app.request(`${ORIGIN}/diffplug/selfie/api/batches/${FIRST}`, { headers: { origin: ORIGIN, cookie: stranger } });
    expect(((await view.json()) as { actor: string | null }).actor).toBeNull();

    const unverified = await app.request(`${ORIGIN}/signed-in`, { headers: { cookie: "__Host-pgstencil.session_token=unverified" } });
    expect(unverified.headers.get("location")).toBe("https://landing.test/#join=");
    expect(signedOut).toEqual(["stranger", "unverified"]);
    expect((await app.request(`${ORIGIN}/signed-in`)).headers.get("location")).toBe("https://landing.test/#join=");
  });

  it("reaches the auth adapter from outside only through GitHub's callback", async () => {
    for (const [method, path] of [
      ["GET", "/api/auth/csrf"],
      ["GET", "/api/auth/list-accounts"],
      ["POST", "/api/auth/sign-in/social"],
      ["POST", "/api/auth/email-otp/send-verification-otp"],
      ["POST", "/api/auth/sign-in/email-otp"],
      ["GET", "/api/providers"],
    ] as const)
      expect((await app.request(`${ORIGIN}${path}`, { method, headers: { origin: ORIGIN, cookie } })).status, path).toBe(404);
  });

  it("gives every error a code, and logs what went wrong under it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const lineOf = (id: string) => logged.mock.calls.find(([first]) => String(first).startsWith(`Error ${id}: `));
    try {
      const refused = await review("POST", `/batches/${FIRST}/decisions`, { body: { decision: "approved", renders: [{ story: "a", imageHash: hash }] } });
      const { error } = (await refused.json()) as { error: { code: string; id: string } };
      expect(error.code).toBe("not-signed-in");
      expect(error.id).toMatch(/^[0-9A-Z]{8}$/);
      expect(lineOf(error.id)?.[0]).toBe(`Error ${error.id}: 401 for POST /diffplug/selfie/api/batches/${FIRST}/decisions, not-signed-in: Sign in to approve or reject.`);

      const broken = await app.request(`${ORIGIN}/diffplug/selfie/api/batches/${FIRST}`, { headers: { origin: ORIGIN, cookie: "__Host-pgstencil.session_token=broken" } });
      expect(broken.status).toBe(500);
      const internal = ((await broken.json()) as { error: { code: string; id: string } }).error;
      expect(internal.code).toBe("internal");
      // What went wrong stays in the log, under the code the person sees.
      expect((lineOf(internal.id)?.[1] as Error).message).toBe("The adapter's account list answered 500");

      const missing = await app.request(`${ORIGIN}/someone/else`);
      expect(await missing.text()).toMatch(/^No such project\.\nError code: [0-9A-Z]{8}$/);

      for (const how of ["refused", "crash"]) {
        const back = await app.request(`${ORIGIN}/api/auth/callback/github?code=${how}&state=s`);
        expect(back.status).toBe(303);
        const id = /^\/sign-in\?failed=([0-9A-Z]{8})$/.exec(back.headers.get("location") ?? "")?.[1];
        expect(lineOf(id!)?.[0]).toMatch(how === "refused" ? /answered 302, to \/sign-in\?failed=1&error=state_mismatch$/ : /answered 500, GitHub identity request failed$/);
        const page = await app.request(`${ORIGIN}/sign-in?failed=${id}`);
        expect(page.status).toBe(401);
        expect(await page.text()).toContain(`Error code: ${id}`);
      }
      const forged = await (await app.request(`${ORIGIN}/sign-in?failed=%3Cb%3Ehi`)).text();
      expect(forged).toContain("GitHub didn't sign you in.");
      expect(forged).not.toContain("Error code");
    } finally {
      logged.mockRestore();
    }
  });

  it("sends a former origin and a former name to where they are now", async () => {
    const moved = await app.request(`${FORMER}/diffplug/selfie-hackathon/batches/${FIRST}?x=1`);
    expect(moved.status).toBe(308);
    expect(moved.headers.get("location")).toBe(`${ORIGIN}/diffplug/selfie-hackathon/batches/${FIRST}?x=1`);
    const renamed = await app.request(`${ORIGIN}/diffplug/selfie-hackathon/batches/${FIRST}?x=1`);
    expect(renamed.status).toBe(308);
    expect(renamed.headers.get("location")).toBe(`/diffplug/selfie/batches/${FIRST}?x=1`);
    const found = (await (await app.request(`${ORIGIN}/api/repositories/diffplug/selfie-hackathon`)).json()) as { project: string };
    expect(found.project).toBe("42");
    expect((await app.request("https://selfie-app.example.workers.dev/diffplug/selfie")).status).toBe(421);
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
    expect((await api("POST", "/decisions", WRITER_TOKEN, { environment: ENV, decisions: [decision] })).status).toBe(200);
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
