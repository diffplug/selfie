import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { defineEnvironment, type ContainerRunner } from "../src/environment.ts";
import { prepareRunner } from "../src/runners.ts";
import { RenderError } from "../src/storybook.ts";

const runner = defineEnvironment().runner as ContainerRunner;

// A stand-in for the Docker CLI: `local` is the platform of the image on disk (empty if absent), and
// `pulled` is what a pull leaves there. Like Docker 28, it has no `image inspect --platform`.
const FAKE_DOCKER = `#!/bin/sh
echo "$*" >> "$FAKE_DIR/calls"
LOCAL=$(cat "$FAKE_DIR/local")
case "$1 $2" in
  "version --format") echo 29.0.0 ;;
  "pull --platform") cat "$FAKE_DIR/pulled" > "$FAKE_DIR/local" ;;
  "image inspect")
    [ "$3" = "--platform" ] && { echo "unknown flag: --platform" >&2; exit 125; }
    [ -n "$LOCAL" ] || { echo "No such image" >&2; exit 1; }
    echo "$LOCAL"
    ;;
  *) echo "unexpected: $*" >&2; exit 2 ;;
esac
`;

describe("prepareRunner with a container", () => {
  let dir: string;
  const savedPath = process.env["PATH"];

  const fake = async (options: { local: string; pulled?: string }) => {
    await writeFile(path.join(dir, "local"), options.local);
    await writeFile(path.join(dir, "pulled"), options.pulled ?? options.local);
  };
  const pulls = async () =>
    (await readFile(path.join(dir, "calls"), "utf8")).split("\n").filter((call) => call.startsWith("pull "));

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "selfie-fake-docker-"));
    await writeFile(path.join(dir, "docker"), FAKE_DOCKER);
    await chmod(path.join(dir, "docker"), 0o755);
    process.env["PATH"] = `${dir}${path.delimiter}${savedPath}`;
    process.env["FAKE_DIR"] = dir;
  });

  afterEach(async () => {
    process.env["PATH"] = savedPath;
    delete process.env["FAKE_DIR"];
    await rm(dir, { recursive: true, force: true });
  });

  test("uses an image on the declared platform without pulling", async () => {
    await fake({ local: runner.platform });
    await prepareRunner(runner);
    expect(await pulls()).toEqual([]);
  });

  test("pulls an absent image once", async () => {
    await fake({ local: "", pulled: runner.platform });
    await prepareRunner(runner);
    expect(await pulls()).toHaveLength(1);
  });

  test("refuses a digest that is for another platform", async () => {
    await fake({ local: "linux/amd64" });
    const refused = prepareRunner(runner);
    await expect(refused).rejects.toBeInstanceOf(RenderError);
    await expect(refused).rejects.toThrow("The image is for linux/amd64.");
  });
});
