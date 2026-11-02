import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { defineEnvironment, renderIdentity } from "../src/index.ts";

const GENERATED = (at: number) => `{"generatedAt":${at},"userSince":1,"storybookVersion":"10.6.5"}`;
const TIMING = (seconds: string) => `<p>Generation took <strong>${seconds}s</strong>.</p>`;

let build: string;
const inBuild = (file: string) => path.join(build, file);
const environment = defineEnvironment();
const identity = () => renderIdentity({ storybookDir: build, environment });

beforeEach(async () => {
  build = await mkdtemp(path.join(tmpdir(), "selfie-identity-"));
  await mkdir(inBuild("assets/deep"), { recursive: true });
  await mkdir(inBuild("manifests"));
  await writeFile(inBuild("iframe.html"), "<html></html>");
  await writeFile(inBuild("project.json"), GENERATED(1));
  await writeFile(inBuild("assets/app.css"), ".a{color:red}");
  await writeFile(inBuild("assets/deep/chunk.js"), "export default 1");
  await writeFile(inBuild("manifests/components.html"), TIMING("0.0"));
});
afterEach(async () => {
  await rm(build, { recursive: true, force: true });
});

describe("the build", () => {
  test("is the same for the same bytes, whatever their times", async () => {
    const before = await identity();
    expect(before).toMatch(/^[0-9a-f]{64}$/);
    await utimes(inBuild("assets/app.css"), new Date(0), new Date(0));
    expect(await identity()).toBe(before);
  });

  test.each(["iframe.html", "project.json", "assets/app.css", "assets/deep/chunk.js", "manifests/components.html"])(
    "changes with one byte of %s, at the same size and time",
    async (file) => {
      const before = await identity();
      const { atime, mtime, size } = await stat(inBuild(file));
      const bytes = await readFile(inBuild(file));
      bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
      await writeFile(inBuild(file), bytes);
      await utimes(inBuild(file), atime, mtime);
      expect((await stat(inBuild(file))).size).toBe(size);
      expect(await identity()).not.toBe(before);
    },
  );

  test("changes with a file added, even empty, removed, or renamed", async () => {
    const before = await identity();
    await writeFile(inBuild("assets/empty.txt"), "");
    const added = await identity();
    expect(added).not.toBe(before);
    await unlink(inBuild("assets/empty.txt"));
    expect(await identity()).toBe(before);

    await writeFile(inBuild("assets/renamed.js"), await readFile(inBuild("assets/deep/chunk.js")));
    await unlink(inBuild("assets/deep/chunk.js"));
    expect(await identity()).not.toBe(before);
  });

  test("can't confuse where one file ends and the next starts", async () => {
    await writeFile(inBuild("x"), "y");
    await writeFile(inBuild("z"), "");
    const before = await identity();
    await writeFile(inBuild("x"), "");
    await writeFile(inBuild("z"), "y");
    expect(await identity()).not.toBe(before);
  });
});

describe("what two builds of one source differ in", () => {
  test("project.json's leading generatedAt doesn't count", async () => {
    const before = await identity();
    await writeFile(inBuild("project.json"), GENERATED(1793616231907));
    expect(await identity()).toBe(before);
  });

  test("the components manifest's generation time doesn't count", async () => {
    const before = await identity();
    await writeFile(inBuild("manifests/components.html"), TIMING("12.3"));
    expect(await identity()).toBe(before);
  });

  test("anything else in those two files counts", async () => {
    const before = await identity();
    await writeFile(inBuild("project.json"), GENERATED(1).replace("10.6.5", "10.6.6"));
    expect(await identity()).not.toBe(before);
    await writeFile(inBuild("project.json"), GENERATED(1));
    await writeFile(inBuild("manifests/components.html"), `${TIMING("0.0")}!`);
    expect(await identity()).not.toBe(before);
  });

  test("the same text in any other file counts", async () => {
    await writeFile(inBuild("assets/project.json"), GENERATED(1));
    await writeFile(inBuild("assets/components.html"), TIMING("0.0"));
    const before = await identity();
    await writeFile(inBuild("assets/project.json"), GENERATED(2));
    const nested = await identity();
    expect(nested).not.toBe(before);
    await writeFile(inBuild("assets/components.html"), TIMING("0.1"));
    expect(await identity()).not.toBe(nested);
  });

  test("a file that isn't valid text keeps its every other byte", async () => {
    await writeFile(inBuild("project.json"), Buffer.from([0x7b, 0xff, 0x41]));
    const before = await identity();
    await writeFile(inBuild("project.json"), Buffer.from([0x7b, 0xfe, 0x41]));
    expect(await identity()).not.toBe(before);
  });
});

describe("what else decides pixels", () => {
  test("the environment", async () => {
    const other = defineEnvironment({ viewport: { width: 800, height: 600 } });
    expect(await renderIdentity({ storybookDir: build, environment: other })).not.toBe(await identity());
  });

  test("the init script, by its contents, and an empty one isn't none", async () => {
    const script = (initScript: string) => renderIdentity({ storybookDir: build, environment, initScript });
    expect(await script("a")).toBe(await script("a"));
    expect(await script("a")).not.toBe(await script("b"));
    expect(await script("")).not.toBe(await identity());
  });

  test("the renderer's own code, by one byte of the worker", async () => {
    // Real copies of the source, each a renderer of its own, since it hashes wherever it lives.
    const src = fileURLToPath(new URL("../src", import.meta.url));
    const copies = await mkdtemp(path.join(fileURLToPath(new URL(".", import.meta.url)), ".identity-"));
    try {
      const copyOf = async (name: string) => {
        await cp(src, path.join(copies, name), { recursive: true });
        return path.join(copies, name);
      };
      const same = await copyOf("same");
      const edited = await copyOf("edited");
      const worker = path.join(edited, "worker", "worker.ts");
      await writeFile(worker, `${await readFile(worker, "utf8")} `);
      const identityFrom = async (dir: string): Promise<string | null> => {
        const module = (await import(/* @vite-ignore */ path.join(dir, "identity.ts"))) as {
          renderIdentity: typeof renderIdentity;
        };
        return module.renderIdentity({ storybookDir: build, environment });
      };
      expect(await identityFrom(same)).toBe(await identity());
      expect(await identityFrom(edited)).not.toBe(await identity());
    } finally {
      await rm(copies, { recursive: true, force: true });
    }
  });
});

describe("what can't be recognized", () => {
  test("a build holding a symlink, whose target isn't hashed", async () => {
    await symlink(inBuild("iframe.html"), inBuild("assets/link.html"));
    expect(await identity()).toBeNull();
  });

  test("a missing build", async () => {
    await rm(build, { recursive: true });
    expect(await identity()).toBeNull();
  });

  test("a native environment", async () => {
    const native = defineEnvironment({ runner: { kind: "native" } });
    expect(await renderIdentity({ storybookDir: build, environment: native })).toBeNull();
  });
});
