import { defineConfig } from "vitest/config";

// Here rather than in the test file, since vitest hides the output of a skipped file.
if (process.env.SELFIE_D1_CONTRACT !== "1") {
  console.log("Skipping the real-D1 contract suite. Run it with `pnpm test:d1`.");
}

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
