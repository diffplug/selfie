import { describe, expect, test } from "vitest";
import { defineEnvironment, type ContainerRunner } from "../src/environment.ts";
import { containerArgs } from "../src/runners.ts";

const runner = defineEnvironment().runner as ContainerRunner;
const args = containerArgs(runner, "selfie-render-x", "/host/build", "/host/out");

describe("containerArgs", () => {
  test("cuts the container off from the network and the host", () => {
    expect(args).toContain("--network=none");
    expect(args).toContain("--read-only");
    expect(args).toContain("--cap-drop=ALL");
    expect(args).toContain("--rm");
    expect(args).toContain("--pull=never");
    expect(args).toEqual(expect.arrayContaining(["--user", `${process.getuid?.()}:${process.getgid?.()}`]));
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
    const quoted = containerArgs(runner, "x", "/host/a,b", "/host/out");
    expect(quoted).toContain('type=bind,"src=/host/a,b",dst=/selfie/build,readonly');
  });

  test("runs the image by digest, so a local tag can't substitute", () => {
    expect(args).toContain(runner.image);
  });
});
