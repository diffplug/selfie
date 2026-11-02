import { execFileSync } from "node:child_process";
import { defineEnvironment } from "selfie-render";
import { defineConfig } from "vitest/config";

// Here rather than in the test file, since vitest hides the output of a skipped file. Asked
// without pulling, since a test shouldn't start a large download on its own.
if (process.env.SELFIE_CLI_CONTAINER === undefined) {
  const { runner } = defineEnvironment();
  try {
    if (runner.kind === "container") {
      execFileSync("docker", ["image", "inspect", "--platform", runner.platform, runner.image], {
        stdio: "ignore",
        timeout: 15_000,
      });
    }
    process.env.SELFIE_CLI_CONTAINER = "1";
  } catch {
    process.env.SELFIE_CLI_CONTAINER = "0";
    console.log("Skipping the container review tests: Docker or the pinned image is unavailable.");
  }
}

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
