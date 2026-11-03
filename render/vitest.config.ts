import { defineConfig } from "vitest/config";
import { defineEnvironment } from "./src/environment.ts";
import { prepareRunner } from "./src/runners.ts";

// Here rather than in the test file, since vitest hides the output of a skipped file.
if (process.env.SELFIE_RENDER_CONTAINER === undefined) {
  try {
    await prepareRunner(defineEnvironment().runner);
    process.env.SELFIE_RENDER_CONTAINER = "1";
  } catch (error) {
    process.env.SELFIE_RENDER_CONTAINER = "0";
    console.log(
      `Skipping the container render tests. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
