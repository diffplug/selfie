import { describe, expect, test } from "vitest";
import { DEFAULT_IMAGE, DEFAULT_PLATFORM } from "../src/environment.ts";
import { containerArgs, platformMismatch } from "../src/runners.ts";

const args = containerArgs(
  { kind: "container", image: DEFAULT_IMAGE, platform: DEFAULT_PLATFORM },
  "selfie-render-x",
  {
    buildDir: "/host/build",
    outDir: "/host/out",
    runLabel: "/host/out",
    uid: 501,
    gid: 20,
  },
);

describe("platformMismatch", () => {
  const runtime = { browser: "", playwright: "", node: "", platform: "linux", arch: "arm64" };
  const runner = (platform: string) => ({ kind: "container" as const, image: DEFAULT_IMAGE, platform });

  test("accepts the declared platform, with Docker's and Node's names for x86-64", () => {
    expect(platformMismatch(runner("linux/arm64"), runtime)).toBeNull();
    expect(platformMismatch(runner("linux/amd64"), { ...runtime, arch: "x64" })).toBeNull();
  });

  test("names a difference", () => {
    expect(platformMismatch(runner("linux/amd64"), runtime)).toContain("linux/arm64");
  });
});

describe("containerArgs", () => {
  test("cuts the container off from the network and the host", () => {
    expect(args).toContain("--network=none");
    expect(args).toContain("--read-only");
    expect(args).toContain("--cap-drop=ALL");
    expect(args).toContain("--rm");
    expect(args).toContain("--pull=never");
    expect(args).toEqual(expect.arrayContaining(["--user", "501:20"]));
  });

  test("passes no host environment", () => {
    const envs = args.flatMap((arg, index) => (arg === "--env" || arg === "-e" ? [args[index + 1]] : []));
    expect(envs).toEqual(["HOME=/tmp"]);
    expect(args.join(" ")).not.toContain("--env-file");
  });

  test("mounts everything read-only except the output directory", () => {
    const mounts = args.flatMap((arg, index) => (arg === "--mount" ? [args[index + 1] as string] : []));
    expect(mounts.length).toBeGreaterThan(1);
    expect(mounts.filter((mount) => !mount.endsWith(",readonly"))).toEqual([
      "type=bind,src=/host/out,dst=/selfie/out",
    ]);
    expect(mounts).toContain("type=bind,src=/host/build,dst=/selfie/build,readonly");
  });

  test("quotes a path holding a comma, which --mount would otherwise split on", () => {
    const quoted = containerArgs(
      { kind: "container", image: DEFAULT_IMAGE, platform: DEFAULT_PLATFORM },
      "x",
      {
        buildDir: "/host/a,b",
        outDir: "/host/out",
        runLabel: "l",
      },
    );
    expect(quoted).toContain('type=bind,"src=/host/a,b",dst=/selfie/build,readonly');
  });

  test("runs the image by digest, so a local tag can't substitute", () => {
    expect(args).toContain(DEFAULT_IMAGE);
  });
});
