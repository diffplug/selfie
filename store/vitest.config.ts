import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { CONTRACT_DATABASE_ID, loadD1Credentials } from "./test/support/d1-credentials.ts";

const realD1InWorkerd = process.env.SELFIE_D1_WORKERD === "1";

// Here rather than in the test files, since vitest hides the output of a skipped file.
// Vitest loads this config once per project, and the flag keeps the report to one.
if (process.env.SELFIE_SKIPS_REPORTED !== "1") {
  process.env.SELFIE_SKIPS_REPORTED = "1";
  if (process.env.SELFIE_D1_CONTRACT !== "1") {
    console.log("Skipping the real-D1 contract suite. Run it with `pnpm test:d1`.");
  }
  if (!realD1InWorkerd) {
    console.log("Skipping the real-D1 tests inside workerd. Run them with `pnpm test:d1:workerd`.");
  }
}

// Only when asked, so `pnpm test` reads no credentials. The token reaches workerd as
// a binding, which is the only place it goes.
const realD1Bindings = realD1InWorkerd
  ? await loadD1Credentials().then(({ accountId, token }) => ({
      D1_ACCOUNT_ID: accountId,
      D1_DATABASE_ID: CONTRACT_DATABASE_ID,
      D1_TOKEN: token,
    }))
  : {};

// Nothing in these tests may reach for a Cloudflare account except the real-D1 test's own fetch.
process.env.WRANGLER_SEND_METRICS = "false";

export default defineConfig({
  test: {
    testTimeout: 60_000,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["test/**/*.test.ts"],
          exclude: ["test/workerd/**"],
        },
      },
      {
        extends: true,
        plugins: [
          cloudflareTest({
            // Local R2 only. There is no Wrangler config, so no account or login is involved.
            remoteBindings: false,
            miniflare: {
              // The plugin's test runner needs nodejs_compat. `tsconfig.core.json` is
              // what keeps Node APIs out of the adapters.
              compatibilityDate: "2026-10-01",
              compatibilityFlags: ["nodejs_compat"],
              r2Buckets: ["BLOBS"],
              // Otherwise Miniflare downloads request metadata when it starts.
              cf: false,
              bindings: realD1Bindings,
            },
          }),
        ],
        test: {
          name: "workerd",
          include: ["test/workerd/**/*.test.ts"],
        },
      },
    ],
  },
});
