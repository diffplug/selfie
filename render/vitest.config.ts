import { defineConfig } from "vitest/config";
import { defineEnvironment, type ContainerRunner } from "./src/environment.ts";
import { ensureImage } from "./src/runners.ts";

// Here rather than in the test file, since vitest hides the output of a skipped file.
if (process.env.SELFIE_RENDER_CONTAINER === undefined) {
  try {
    await ensureImage(defineEnvironment().runner as ContainerRunner);
    process.env.SELFIE_RENDER_CONTAINER = "1";
  } catch (error) {
    process.env.SELFIE_RENDER_CONTAINER = "0";
    console.log(
      `Skipping the container capture tests. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
