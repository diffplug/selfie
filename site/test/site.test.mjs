// Checks the site against a running server. By default it starts `wrangler pages dev`.
// After a deploy, point it at the real thing: BASE_URL=https://selfie.dev pnpm test
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";

const LIB = "https://lib.selfie.dev";
const GO = "https://github.com/diffplug/selfie-lib/issues/85";
const JS = "https://github.com/diffplug/selfie-lib/issues/84";
const NOTICE =
  /Looking for the JVM\/Python snapshot testing library \(<code>expectSelfie<\/code>, <code>expect_selfie<\/code>\)\? It moved to <a href="https:\/\/github\.com\/diffplug\/selfie-lib">diffplug\/selfie-lib<\/a>, with docs at <a href="https:\/\/lib\.selfie\.dev">lib\.selfie\.dev<\/a>\./;

const REDIRECTS = {
  "/jvm": `${LIB}/jvm`,
  "/jvm/kotest": `${LIB}/jvm/kotest`, // error messages in released jars link here
  "/jvm/get-started": `${LIB}/jvm/get-started`,
  "/jvm/deeply/nested/page": `${LIB}/jvm/deeply/nested/page`,
  "/py": `${LIB}/py`,
  "/py/get-started": `${LIB}/py/get-started`,
  "/demo-gif": `${LIB}/demo-gif`,
  "/demo-gif/": `${LIB}/demo-gif`,
  "/go": GO,
  "/go/anything": GO,
  "/other-platforms": GO,
  "/other-platforms/anything": GO,
  "/js": JS,
  "/js/anything": JS,
};

let base = process.env.BASE_URL;
let server;

before(async () => {
  if (base) return;
  const port = 8799;
  base = `http://127.0.0.1:${port}`;
  server = spawn("pnpm", ["exec", "wrangler", "pages", "dev", "--port", String(port)], {
    stdio: "ignore",
    detached: true,
  });
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(base);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("wrangler pages dev did not start");
});

after(() => {
  if (server) process.kill(-server.pid);
});

const get = (path) => fetch(base + path, { redirect: "manual" });

for (const [path, target] of Object.entries(REDIRECTS)) {
  test(`${path} is a 301 to ${target}`, async () => {
    const res = await get(path);
    assert.equal(res.status, 301);
    assert.equal(res.headers.get("location"), target);
  });
}

test("the home page sends each audience to the right place", async () => {
  const res = await get("/");
  assert.equal(res.status, 200);
  const html = await res.text();
  for (const href of [
    "https://lib.selfie.dev",
    "https://github.com/diffplug/selfie",
    "https://youtu.be/8B3-v4DTwfU",
    "https://youtu.be/FiGuwfB13b0",
  ]) {
    assert.ok(html.includes(`href="${href}"`), `missing link to ${href}`);
  }
  assert.match(html, NOTICE);
});

test("the signup form posts to the selfie.dev MailerLite form", async () => {
  const html = await (await get("/")).text();
  assert.ok(html.includes('action="https://assets.mailerlite.com/jsonp/2772060/forms/203332822830679835/subscribe"'), "missing MailerLite form action");
  assert.match(html, /name="fields\[email\]"/);
  assert.ok(html.includes('href="#join"'), "the shutter should lead to the signup form");
  assert.ok(!html.includes("nedshed.dev"), "nedshed.dev should no longer be linked");
});

test("the welcome page that MailerLite's confirm link lands on exists", async () => {
  const res = await get("/welcome");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /on<\/em> the list/);
  assert.match(html, /name="robots" content="noindex"/);
});

test("an unknown path is a real 404 that points to the library", async () => {
  const res = await get("/no-such-page");
  assert.equal(res.status, 404);
  assert.match(await res.text(), NOTICE);
});

test("everything the home page loads from this site exists", async () => {
  const html = await (await get("/")).text();
  const css = await (await get("/style.css")).text();
  // The home page and the stylesheet both sit at the site root, so a relative
  // path resolves the same as one starting with "/".
  const local = (path) => (path.startsWith("/") ? path : `/${path}`);
  const paths = [
    ...html.matchAll(/(?:src|href|srcset)="(?!https?:|\/\/|#|mailto:)([^"]+)"/g),
    ...css.matchAll(/url\("(?!https?:|data:)([^"]+)"\)/g),
    ...html.matchAll(/content="https:\/\/selfie\.dev(\/[^"]+\.png)"/g),
  ].map((match) => local(match[1]));
  assert.ok(paths.length > 5);
  for (const path of new Set(paths)) {
    assert.equal((await get(path)).status, 200, path);
  }
});
