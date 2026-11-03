// Notes, through the review routes and `selfie notes`, on a real store and real Git.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { decodeImage } from "selfie-store";
import { REQUEST_HEADER_VALUE } from "selfie-ui/app";
import { createLocalApp } from "selfie-ui/local";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { textForAgent, withBoxDrawn } from "../src/notes.ts";
import { openProject, type Project } from "../src/project.ts";
import { localReviewSource } from "../src/ui.ts";
import { createHarness, git, type Harness } from "./support.ts";

const PORT = 4173;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;

let h: Harness;
let project: Project;
let app: ReturnType<typeof createLocalApp>;
let runId: string;
let imageHash: string;

const appFor = (forProject: Project) => createLocalApp({ source: localReviewSource(forProject), port: () => PORT, clientDir: h.scratch });

function send(onApp: typeof app, method: string, url: string, body?: unknown) {
  return onApp.request(url, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { host: HOST, origin: ORIGIN, "content-type": "application/json", "x-selfie-request": REQUEST_HEADER_VALUE },
  });
}

const feedback = async (onApp = app) => (await (await onApp.request("/api/feedback", { headers: { host: HOST } })).json()) as any;
const writeNote = (overrides: Record<string, unknown> = {}, onApp = app) =>
  send(onApp, "POST", "/api/notes", { story: "a", runId, imageHash, box: null, text: "Too quiet", ...overrides });

beforeEach(async () => {
  h = await createHarness();
  project = await openProject({ cwd: h.repo, env: { SELFIE_HOME: h.home } });
  app = appFor(project);
  h.stories = [{ id: "a" }];
  ({ runId } = (await h.cli("review", "--storybook-dir", "ignored")).json);
  const view = (await (await app.request(`/api/runs/${runId}`, { headers: { host: HOST } })).json()) as any;
  imageHash = view.rows[0].imageHash;
});
afterEach(async () => {
  project.close();
  await h.destroy();
});

describe("writing a note", () => {
  test("starts as a draft, by whoever Git says you are", async () => {
    const response = await writeNote({ box: { x: 1, y: 2, width: 3, height: 4 } });
    expect(response.status).toBe(200);
    const { folder, notes } = (await response.json()) as any;
    expect(folder).toBe(path.basename(h.repo));
    expect(notes).toMatchObject([
      {
        story: "a",
        runId,
        imageHash,
        box: { x: 1, y: 2, width: 3, height: 4 },
        state: "draft",
        messages: [{ sender: "person", text: "Too quiet", sent: false, author: git(h.repo, "config", "user.email").trim() }],
      },
    ]);
  });

  test("can be on a whole image, or on a story with no image", async () => {
    await writeNote();
    await writeNote({ imageHash: null });
    expect((await feedback()).notes).toMatchObject([{ imageHash, box: null }, { imageHash: null, box: null }]);
  });

  test.each([
    ["no text", { text: "   " }],
    ["no story", { story: "" }],
    ["a bad image hash", { imageHash: "nope" }],
    ["a box with no area", { box: { x: 0, y: 0, width: 0, height: 4 } }],
    ["a box off the image's corner", { box: { x: -1, y: 0, width: 2, height: 4 } }],
    ["a fractional box", { box: { x: 0.5, y: 0, width: 2, height: 4 } }],
    ["too much text", { text: "x".repeat(10_001) }],
  ])("refuses %s", async (_, overrides) => {
    expect((await writeNote(overrides)).status).toBe(400);
    expect((await feedback()).notes).toEqual([]);
  });

  test("refuses a run that isn't in the store", async () => {
    expect((await writeNote({ runId: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);
  });

  test("a change from another site is refused, like any other", async () => {
    const response = await app.request("/api/notes", {
      method: "POST",
      body: JSON.stringify({ story: "a", runId, imageHash, box: null, text: "Hi" }),
      headers: { host: HOST, origin: "https://evil.example", "content-type": "application/json", "x-selfie-request": REQUEST_HEADER_VALUE },
    });
    expect(response.status).toBe(403);
    expect((await feedback()).notes).toEqual([]);
  });

  test("a draft can be deleted, and a sent note can't", async () => {
    await writeNote();
    const [{ id }] = (await feedback()).notes;
    expect(await (await send(app, "DELETE", `/api/notes/${id}`)).json()).toMatchObject({ notes: [] });

    await writeNote();
    const [{ id: sent }] = (await feedback()).notes;
    await send(app, "POST", "/api/notes/send", {});
    expect((await send(app, "DELETE", `/api/notes/${sent}`)).status).toBe(404);
    expect((await feedback()).notes).toHaveLength(1);
  });

  test("refuses to delete what isn't a note", async () => {
    expect((await send(app, "DELETE", "/api/notes/nope")).status).toBe(400);
  });
});

describe("copying for an agent", () => {
  test("sends the drafts, and answers with the text to paste", async () => {
    await writeNote({ box: { x: 1, y: 2, width: 3, height: 4 } });
    const response = await send(app, "POST", "/api/notes/send", {});
    const { feedback: view, text } = (await response.json()) as any;
    expect(view.notes[0].state).toBe("sent");
    expect(text).toContain(`Note ${view.notes[0].id}, on a, in the box 3×4 at 1, 2:\nToo quiet`);
    expect(text).toContain("`selfie notes`");
    expect(text).toContain(path.basename(h.repo));
  });

  test("includes what was sent before, so copying again loses nothing", async () => {
    await writeNote({ text: "First" });
    await send(app, "POST", "/api/notes/send", {});
    await writeNote({ text: "Second" });
    const { text } = (await (await send(app, "POST", "/api/notes/send", {})).json()) as any;
    expect(text).toContain("First");
    expect(text).toContain("Second");
  });

  test("names no path, since a response never does", async () => {
    await writeNote();
    const { text } = (await (await send(app, "POST", "/api/notes/send", {})).json()) as any;
    expect(text).not.toContain(h.repo);
    expect(text).not.toContain(h.home);
  });

  test("says one note, not one notes", () => {
    const one = { id: 1, story: "a", runId, imageHash: null, box: null, state: "sent", messages: [] } as const;
    expect(textForAgent([one], "repo")).toContain("as 1 note.");
    expect(textForAgent([one, { ...one, id: 2 }], "repo")).toContain("as 2 notes.");
  });
});

describe("selfie notes", () => {
  test("prints what was sent, never a draft", async () => {
    await writeNote({ text: "Sent one" });
    await send(app, "POST", "/api/notes/send", {});
    await writeNote({ text: "Still writing" });
    const { json, code } = await h.cli("notes");
    expect(code).toBe(0);
    expect(json.notes.map(({ messages }: any) => messages[0].text)).toEqual(["Sent one"]);
    expect(json.folder).toBe(project.repo.root);
  });

  test("with a picture of the note's box drawn on its image", async () => {
    await writeNote({ box: { x: 3, y: 3, width: 2, height: 2 } });
    await send(app, "POST", "/api/notes/send", {});
    const { json } = await h.cli("notes");
    const picture = await decodeImage(await readFile(json.notes[0].image));
    const original = await project.store.getPixels(imageHash);
    expect(picture.width).toBe(original!.width);
    expect([...picture.pixels.subarray(((3 - 1) * picture.width + 3) * 3, ((3 - 1) * picture.width + 3) * 3 + 3)]).toEqual([191, 0, 255]);
    // What the note is about stays uncovered.
    const inside = (3 * picture.width + 3) * 3;
    expect([...picture.pixels.subarray(inside, inside + 3)]).toEqual([...original!.pixels.subarray(inside, inside + 3)]);
  });

  test("has no picture for a note on no image", async () => {
    await writeNote({ imageHash: null });
    await send(app, "POST", "/api/notes/send", {});
    expect((await h.cli("notes")).json.notes[0].image).toBeNull();
  });

  test("takes no arguments", async () => {
    expect((await h.cli("notes", "extra")).code).toBe(2);
  });
});

describe("a session is a folder", () => {
  test("two worktrees of one repository share a store, and never each other's notes", async () => {
    const other = path.join(h.scratch, "other-worktree");
    execFileSync("git", ["worktree", "add", "-q", "-b", "other", other], { cwd: h.repo });
    const otherProject = await openProject({ cwd: other, env: { SELFIE_HOME: h.home } });
    try {
      expect(otherProject.directory).toBe(project.directory);
      const otherApp = appFor(otherProject);
      await writeNote({ text: "From here" });
      await writeNote({ text: "From there" }, otherApp);
      const said = async (onApp: typeof app) => (await feedback(onApp)).notes.map(({ messages }: any) => messages[0].text);
      expect(await said(app)).toEqual(["From here"]);
      expect(await said(otherApp)).toEqual(["From there"]);

      // Nor can one touch the other's.
      const [{ id }] = (await feedback()).notes;
      expect((await send(otherApp, "DELETE", `/api/notes/${id}`)).status).toBe(404);
      await send(otherApp, "POST", "/api/notes/send", {});
      expect((await feedback()).notes[0].state).toBe("draft");
    } finally {
      otherProject.close();
    }
  });

  test("a subfolder is the same session as its worktree", async () => {
    const subfolder = path.join(h.repo, "packages", "app");
    await mkdir(subfolder, { recursive: true });
    const inside = await openProject({ cwd: subfolder, env: { SELFIE_HOME: h.home } });
    try {
      await writeNote();
      expect((await feedback(appFor(inside))).notes).toHaveLength(1);
    } finally {
      inside.close();
    }
  });
});

test("a picture is made once, however many times it's asked for", async () => {
  await writeNote({ box: { x: 3, y: 3, width: 2, height: 2 } });
  await send(app, "POST", "/api/notes/send", {});
  const first = (await h.cli("notes")).json.notes[0].image;
  const { mtimeMs } = await stat(first);
  const second = (await h.cli("notes")).json.notes[0].image;
  expect(second).toBe(first);
  expect((await stat(second)).mtimeMs).toBe(mtimeMs);
});

test("withBoxDrawn clips at the image's edges, and leaves its input alone", () => {
  const image = { width: 4, height: 4, pixels: new Uint8Array(4 * 4 * 3).fill(255) };
  const drawn = withBoxDrawn(image, { x: 0, y: 0, width: 2, height: 2 });
  expect(drawn.pixels.length).toBe(image.pixels.length);
  expect(image.pixels.every((value) => value === 255)).toBe(true);
  expect([...drawn.pixels.subarray(0, 3)]).toEqual([255, 255, 255]);
  expect([...drawn.pixels.subarray(2 * 3, 2 * 3 + 3)]).toEqual([191, 0, 255]);
});
