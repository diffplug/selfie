import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Nothing in these tests may reach for a Cloudflare account.
process.env.WRANGLER_SEND_METRICS = "false";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: { name: "node", include: ["test/**/*.test.ts"], exclude: ["test/workerd/**"] },
      },
      {
        extends: true,
        plugins: [
          cloudflareTest({
            // Local D1 and R2 only. There is no Wrangler config, so no account or login is involved.
            remoteBindings: false,
            miniflare: {
              compatibilityDate: "2026-10-01",
              compatibilityFlags: ["nodejs_compat"],
              r2Buckets: ["BLOBS"],
              d1Databases: ["DB"],
              // Otherwise Miniflare downloads request metadata when it starts.
              cf: false,
            },
          }),
        ],
        test: { name: "workerd", include: ["test/workerd/**/*.test.ts"] },
      },
    ],
  },
});
