// app.selfie.dev's release steps, for .github/workflows/app-production.yml and for an operator:
//
//   node scripts/production.mjs preflight   the Hyperdrive is uncached, and every Worker secret is set
//   node scripts/production.mjs deploy      builds, and deploys with the real Hyperdrive ID
//   node scripts/production.mjs smoke       the live origins answer as docs/specs/cloud.md says
//
// preflight and deploy need CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and HYPERDRIVE_ID. See OPERATIONS.md.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const WORKER = "selfie-app";
const APP = "https://app.selfie.dev";
const STORYBOOKS = "https://selfieusercontent.com";
const FORMER = "https://hackathon.selfie.dev";
const PLACEHOLDER = "00000000000000000000000000000000";
/** Every secret `ui/src/worker/index.ts` reads. A missing one would fail on the first request that needs it. */
const SECRETS = [
  "AUTH_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "SELFIE_WRITER_TOKEN",
  "SELFIE_UPLOAD_TOKEN",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
];

const need = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}.`);
  return value;
};

function hyperdriveId() {
  const id = need("HYPERDRIVE_ID");
  if (!/^[0-9a-f]{32}$/.test(id) || id === PLACEHOLDER) throw new Error("HYPERDRIVE_ID isn't a Hyperdrive ID.");
  return id;
}

async function cloudflare(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${need("CLOUDFLARE_ACCOUNT_ID")}${path}`, {
    headers: { authorization: `Bearer ${need("CLOUDFLARE_API_TOKEN")}` },
  });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(`Cloudflare answered ${response.status} for ${path}: ${JSON.stringify(body.errors)}`);
  return body.result;
}

async function preflight() {
  const hyperdrive = await cloudflare(`/hyperdrive/configs/${hyperdriveId()}`);
  // A cached read could keep a session alive after its sign-out.
  if (hyperdrive.caching?.disabled !== true) throw new Error(`Hyperdrive ${hyperdrive.name} caches queries; turn caching off.`);
  const present = new Set((await cloudflare(`/workers/scripts/${WORKER}/secrets`)).map(({ name }) => name));
  const missing = SECRETS.filter((name) => !present.has(name));
  if (missing.length > 0) throw new Error(`${WORKER} is missing secrets: ${missing.join(", ")}`);
  console.log(`Hyperdrive ${hyperdrive.name} is uncached, and ${WORKER} has all ${SECRETS.length} secrets.`);
}

function deploy() {
  const config = readFileSync("wrangler.toml", "utf8");
  if (!config.includes(`id = "${PLACEHOLDER}"`)) throw new Error("wrangler.toml no longer has the Hyperdrive placeholder.");
  // Beside wrangler.toml, so its relative paths mean the same; ignored by Git.
  writeFileSync("wrangler.production.toml", config.replace(`id = "${PLACEHOLDER}"`, `id = "${hyperdriveId()}"`));
  const run = (command, args) => execFileSync(command, args, { stdio: "inherit" });
  run("pnpm", ["exec", "vite", "build", "--logLevel", "warn"]);
  run("pnpm", ["exec", "wrangler", "deploy", "--config", "wrangler.production.toml"]);
}

/** A first deploy's custom domains need a minute or two for DNS and certificates, so the checks try for up to 3 minutes. */
async function smoke() {
  for (let attempt = 1; ; attempt++) {
    const failures = await smokeOnce();
    if (failures.length === 0) return;
    if (attempt === 12) throw new Error(`Live checks failed:\n${failures.join("\n")}`);
    console.log(`${failures.length} live checks failed, trying again in 15 seconds`);
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

async function smokeOnce() {
  const failures = [];
  const check = async (what, url, init, expect) => {
    try {
      const response = await fetch(url, { redirect: "manual", ...init });
      const problem = await expect(response);
      if (problem) failures.push(`${what}: ${problem}`);
      else console.log(`ok  ${what}`);
    } catch (error) {
      failures.push(`${what}: ${error.message}`);
    }
  };
  const status = (want) => (response) => (response.status === want ? null : `answered ${response.status}, not ${want}`);

  await check("a project's page", `${APP}/diffplug/selfie`, {}, async (r) =>
    r.status !== 200 ? `answered ${r.status}` : (await r.text()).includes('name="selfie-base"') ? null : "isn't the client's page",
  );
  await check("the sign-in page", `${APP}/sign-in`, {}, async (r) => (r.status === 200 && (await r.text()).includes("Sign in with GitHub") ? null : `answered ${r.status}`));
  // Reaches Postgres through the Hyperdrive, and uses AUTH_SECRET and the GitHub client, so a sign-in can start.
  await check("starting a sign-in", `${APP}/sign-in`, { method: "POST", headers: { origin: APP, "content-type": "application/x-www-form-urlencoded" }, body: "next=%2F" }, (r) => {
    const location = r.headers.get("location") ?? "";
    return r.status === 303 && location.startsWith("https://github.com/login/oauth/authorize?") ? null : `answered ${r.status}, to ${location || "nowhere"}`;
  });
  await check("a sign-in from another site", `${APP}/sign-in`, { method: "POST", headers: { origin: "https://example.com", "content-type": "application/x-www-form-urlencoded" }, body: "next=%2F" }, status(403));
  await check("the adapter's own routes", `${APP}/api/auth/csrf`, {}, status(404));
  await check("the Storybook origin's root", `${STORYBOOKS}/`, {}, status(404));
  await check("the hackathon's origin", `${FORMER}/diffplug/selfie-hackathon`, {}, (r) => {
    const location = r.headers.get("location");
    return r.status === 308 && location === `${APP}/diffplug/selfie-hackathon` ? null : `answered ${r.status}, to ${location}`;
  });
  await check("the repository's former name", `${APP}/diffplug/selfie-hackathon`, {}, (r) =>
    r.status === 308 && r.headers.get("location") === "/diffplug/selfie" ? null : `answered ${r.status}, to ${r.headers.get("location")}`,
  );

  return failures;
}

const steps = { preflight, deploy, smoke };
const step = steps[process.argv[2]];
if (step === undefined) throw new Error(`Say one of: ${Object.keys(steps).join(", ")}`);
await step();
