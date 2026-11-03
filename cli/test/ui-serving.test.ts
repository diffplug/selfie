import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import { type StoriesView } from "selfie-ui/app";
import { serveLocal, type LocalServer } from "selfie-ui/local";
import { beforeEach, describe, expect, test } from "vitest";
import { runCli } from "../src/cli.ts";
import { localReviewSource } from "../src/ui.ts";
import { UNKNOWN_RUN, h, project, clientDir, review } from "./ui-support.ts";

describe("selfie ui", () => {
  const serve = async (command: string, ...argv: string[]) => {
    const stop = new AbortController();
    let stdout = "";
    let stderr = "";
    let onPrinted: () => void;
    const printed = new Promise<void>((resolve) => {
      onPrinted = resolve;
    });
    const exit = runCli([command, ...argv], {
      cwd: h.repo,
      env: { SELFIE_HOME: h.home },
      stdout: (text) => {
        stdout += text;
        onPrinted();
      },
      stderr: (text) => {
        stderr += text;
      },
      signal: stop.signal,
      uiClientDir: clientDir,
    });
    await Promise.race([printed, exit]);
    return { stop, exit, json: () => JSON.parse(stdout), stderr: () => stderr };
  };
  const start = (...argv: string[]) => serve("ui", ...argv);

  describe("selfie, with no command", () => {
    const opened: string[] = [];
    const bare = async (...argv: string[]) => {
      const stop = new AbortController();
      let stdout = "";
      let stderr = "";
      let onPrinted: () => void;
      const printed = new Promise<void>((resolve) => {
        onPrinted = resolve;
      });
      const exit = runCli(argv, {
        cwd: h.repo,
        env: { SELFIE_HOME: h.home },
        stdout: (text) => {
          stdout += text;
          onPrinted();
        },
        stderr: (text) => {
          stderr += text;
        },
        openBrowser: (url) => opened.push(url),
        signal: stop.signal,
        uiClientDir: clientDir,
      });
      await Promise.race([printed, exit]);
      return { stop, exit, json: () => JSON.parse(stdout), stderr: () => stderr };
    };
    const dir = () => path.join(h.scratch, "a-storybook");
    const writeBuild = async () => {
      await mkdir(dir(), { recursive: true });
      await writeFile(path.join(dir(), "iframe.html"), "<!doctype html><title>the preview</title>");
      await writeFile(path.join(dir(), "index.json"), JSON.stringify({ entries: { a: { type: "story", id: "a" } } }));
    };
    const config = (fields: Record<string, unknown>) => writeFile(path.join(h.repo, "selfie.config.json"), JSON.stringify(fields));
    /** A build the config says how to run, which leaves a mark at the top level it ran from. */
    const buildScript = async () => {
      const script = path.join(h.scratch, "build.mjs");
      await writeFile(script, `import { mkdirSync, writeFileSync } from "node:fs"; writeFileSync("built-here", ""); mkdirSync(${JSON.stringify(dir())}, { recursive: true }); writeFileSync(${JSON.stringify(path.join(dir(), "iframe.html"))}, "built"); writeFileSync(${JSON.stringify(path.join(dir(), "index.json"))}, '{"entries":{}}');`);
      return `node ${script}`;
    };

    beforeEach(() => {
      opened.length = 0;
    });

    test("opens at every story, in a browser, and says where", async () => {
      await writeBuild();
      const { stop, exit, json, stderr } = await bare("--storybook-dir", dir());
      const { url, port, storybookUrl, runId } = json();
      expect(url).toBe(`http://127.0.0.1:${port}/`);
      expect(runId).toBeNull();
      expect(stderr()).toContain(url);
      expect(opened).toEqual([url]);
      const { stories, canCapture } = (await (await fetch(`http://127.0.0.1:${port}/api/stories`)).json()) as StoriesView;
      expect(stories).toEqual([{ story: "a", title: "", name: "", capture: null }]);
      expect(canCapture).toBe(true);
      expect(await (await fetch(`${storybookUrl}iframe.html`)).text()).toContain("the preview");
      stop.abort();
      expect(await exit).toBe(0);
    });

    test("--no-open leaves the browser alone", async () => {
      await writeBuild();
      const { stop, exit } = await bare("--storybook-dir", dir(), "--no-open");
      expect(opened).toEqual([]);
      stop.abort();
      expect(await exit).toBe(0);
    });

    test("runs the config's build command first, from the Git top level, saying what it is", async () => {
      const command = await buildScript();
      await config({ buildCommand: command });
      const { stop, exit, json, stderr } = await bare("--storybook-dir", dir());
      expect(stderr()).toContain(`Building: ${command}`);
      expect(await (await fetch(`${json().storybookUrl}iframe.html`)).text()).toBe("built");
      await expect(readdir(h.repo)).resolves.toContain("built-here");
      stop.abort();
      expect(await exit).toBe(0);
    });

    test("--no-build doesn't run it", async () => {
      await writeBuild();
      await config({ buildCommand: await buildScript() });
      const { stop, exit, stderr } = await bare("--storybook-dir", dir(), "--no-build");
      expect(stderr()).not.toContain("Building:");
      await expect(readdir(h.repo)).resolves.not.toContain("built-here");
      stop.abort();
      expect(await exit).toBe(0);
    });

    test("with no build yet, still serves, for the page to say what to do", async () => {
      const { stop, exit, json, stderr } = await bare("--storybook-dir", path.join(h.scratch, "nothing-here"));
      expect(stderr()).toContain("There's no built Storybook");
      expect(opened).toEqual([json().url]);
      const { canCapture, setup } = (await (await fetch(`${json().url}api/stories`)).json()) as StoriesView;
      expect(canCapture).toBe(false);
      expect(setup?.buildCommand).toBeNull();
      stop.abort();
      expect(await exit).toBe(0);
    });

    test("says so if the build fails", async () => {
      await config({ buildCommand: "exit 3" });
      const failing = await bare();
      expect(await failing.exit).toBe(2);
      expect(failing.json().error.code).toBe("build-failed");
    });

    test("doesn't spend a build finding out the config is bad", async () => {
      await config({ buildCommand: await buildScript(), notAKey: true });
      const refused = await bare();
      expect(await refused.exit).toBe(2);
      expect(refused.json().error.code).toBe("bad-config");
      await expect(readdir(h.repo)).resolves.not.toContain("built-here");
    });

    test.each([[""], ["  "], [3]])("refuses a build command of %j", async (buildCommand) => {
      await config({ buildCommand });
      const refused = await bare("--no-build");
      expect(await refused.exit).toBe(2);
      expect(refused.json().error.code).toBe("bad-config");
    });

    test("refuses a bad port, an argument, and takes an unknown word for a command", async () => {
      const port = await bare("--port", "http");
      expect(await port.exit).toBe(2);
      expect(port.json().error.code).toBe("usage");
      const unknown = await bare("frobnicate");
      expect(await unknown.exit).toBe(2);
      expect(unknown.json().error.message).toContain("Unknown command");
    });

    test("record and review never run the config's build, unless told to", async () => {
      h.stories = [{ id: "a" }];
      await writeBuild();
      await config({ buildCommand: await buildScript() });
      for (const command of ["record", "review"]) {
        expect((await h.cli(command, "--storybook-dir", dir())).code, command).not.toBe(2);
        await expect(readdir(h.repo)).resolves.not.toContain("built-here");
      }
      await rm(path.join(h.repo, "built-here"), { force: true });
      const built = await h.cli("record", "--storybook-dir", dir(), "--build");
      expect(built.code).toBe(0);
      await expect(readdir(h.repo)).resolves.toContain("built-here");
    });

    test("--build says so if the config has no build command", async () => {
      const refused = await h.cli("record", "--storybook-dir", "ignored", "--build");
      expect(refused.code).toBe(2);
      expect(refused.json.error).toMatchObject({ code: "usage", message: expect.stringContaining("buildCommand") });
    });
  });

  test("hosts a Storybook on a port of its own, saying where, and --storybook-dir picks which", async () => {
    const dir = path.join(h.scratch, "a-storybook");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "iframe.html"), "<!doctype html><title>the preview</title>");
    const { stop, exit, json } = await start("--storybook-dir", dir);
    const { port, storybookUrl, url } = json();
    expect(new URL(storybookUrl).port).not.toBe(String(port));
    const frame = await fetch(`${storybookUrl}iframe.html`);
    expect(await frame.text()).toContain("the preview");
    // They're each told about the other, whichever name the review page is open under.
    expect(frame.headers.get("content-security-policy")).toBe(`frame-ancestors 'self' http://127.0.0.1:${port} http://localhost:${port}`);
    expect((await fetch(url)).headers.get("content-security-policy")).toContain(`frame-src ${new URL(storybookUrl).origin};`);
    stop.abort();
    expect(await exit).toBe(0);
    await expect(fetch(storybookUrl)).rejects.toThrow();
  });

  test("prints one document with its URL, serves on it, and stops when told", async () => {
    const { stop, exit, json, stderr } = await start();
    const { url, port, runId } = json();
    expect(url).toBe(`http://127.0.0.1:${port}/`);
    expect(runId).toBeNull();
    expect(stderr()).toContain("Serving");
    const page = await fetch(url);
    expect(await page.text()).toContain("the client");
    expect((await fetch(`${url}api/stories`)).status).toBe(200);
    stop.abort();
    expect(await exit).toBe(0);
    await expect(fetch(url)).rejects.toThrow();
  });

  test("opens at a run if it's given one, and refuses one it doesn't know", async () => {
    h.stories = [{ id: "a" }];
    const { runId } = (await review()).json;
    const { stop, exit, json } = await start(runId);
    expect(json().url).toMatch(new RegExp(`/runs/${runId}$`));
    expect(json().runId).toBe(runId);
    stop.abort();
    expect(await exit).toBe(0);

    for (const [run, code] of [
      [UNKNOWN_RUN, "unknown-run"],
      ["nope", "bad-run-id"],
    ] as const) {
      const refused = await start(run);
      expect(await refused.exit).toBe(2);
      expect(refused.json().error.code).toBe(code);
    }
  });

  test("refuses a bad port or extra arguments", async () => {
    for (const argv of [["--port", "99999"], ["--port", "http"], [UNKNOWN_RUN, UNKNOWN_RUN]]) {
      const refused = await start(...argv);
      expect(await refused.exit, argv.join(" ")).toBe(2);
      expect(refused.json().error.code).toBe("usage");
    }
  });

  test("says how to build the client if it isn't built", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "selfie-ui-empty-"));
    try {
      let stdout = "";
      const code = await runCli(["ui"], {
        cwd: h.repo,
        env: { SELFIE_HOME: h.home },
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {},
        uiClientDir: empty,
      });
      expect(code).toBe(2);
      expect(JSON.parse(stdout).error).toMatchObject({ code: "ui-not-built", message: expect.stringContaining("pnpm") });
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  test("listens only on loopback", async () => {
    const source = localReviewSource(project);
    const server: LocalServer = await serveLocal({ source, port: 0, clientDir });
    try {
      expect((await fetch(`${server.url}api/stories`)).status).toBe(200);
      const external = Object.values(networkInterfaces())
        .flat()
        .filter((address) => address !== undefined && !address.internal && address.family === "IPv4");
      for (const address of external) {
        await expect(fetch(`http://${address!.address}:${server.port}/api/stories`)).rejects.toThrow();
      }
    } finally {
      await server.close();
    }
  });
});
