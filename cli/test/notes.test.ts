// Notes, through the review routes and `selfie notes`, on a real store and real Git.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { REQUEST_HEADER_VALUE } from "selfie-ui/app";
import { createLocalApp } from "selfie-ui/local";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runCli } from "../src/cli.ts";
import { awaitFeedback, textForAgent, WAITER_STALE_MS, withBoxDrawn } from "../src/notes.ts";
import { openProject, type Project } from "../src/project.ts";
import { localReviewSource } from "../src/ui.ts";
import { createHarness, decodeImage, git, GREEN, type Harness } from "./support.ts";

const PORT = 4173;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;

let h: Harness;
let project: Project;
let app: ReturnType<typeof createLocalApp>;
let batchId: string;
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
  send(onApp, "POST", "/api/notes", { story: "a", batchId, imageHash, box: null, text: "Too quiet", ...overrides });

beforeEach(async () => {
  h = await createHarness();
  project = await openProject({ cwd: h.repo, env: { SELFIE_HOME: h.home } });
  app = appFor(project);
  h.stories = [{ id: "a" }];
  ({ batchId } = (await h.cli("review", "--storybook-dir", "ignored")).json);
  const view = (await (await app.request(`/api/batches/${batchId}`, { headers: { host: HOST } })).json()) as any;
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
        batchId,
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

  test("refuses a batch that isn't in the store", async () => {
    expect((await writeNote({ batchId: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);
  });

  test("a change from another site is refused, like any other", async () => {
    const response = await app.request("/api/notes", {
      method: "POST",
      body: JSON.stringify({ story: "a", batchId, imageHash, box: null, text: "Hi" }),
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
    await send(app, "POST", "/api/notes/send", { via: "copy" });
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
    const response = await send(app, "POST", "/api/notes/send", { via: "copy" });
    const { feedback: view, text } = (await response.json()) as any;
    expect(view.notes[0].state).toBe("sent");
    expect(text).toContain(`Note ${view.notes[0].id}, on a, in the box 3×4 at 1, 2:\nToo quiet`);
    expect(text).toContain("`selfie notes`");
    expect(text).toContain(path.basename(h.repo));
  });

  test("includes what was sent before, so copying again loses nothing", async () => {
    await writeNote({ text: "First" });
    await send(app, "POST", "/api/notes/send", { via: "copy" });
    await writeNote({ text: "Second" });
    const { text } = (await (await send(app, "POST", "/api/notes/send", { via: "copy" })).json()) as any;
    expect(text).toContain("First");
    expect(text).toContain("Second");
  });

  test("names no path, since a response never does", async () => {
    await writeNote();
    const { text } = (await (await send(app, "POST", "/api/notes/send", { via: "copy" })).json()) as any;
    expect(text).not.toContain(h.repo);
    expect(text).not.toContain(h.home);
  });

  test("says one note, not one notes", () => {
    const one = { id: 1, story: "a", batchId, imageHash: null, box: null, state: "sent", messages: [] } as const;
    expect(textForAgent([one], "repo")).toContain("as 1 note.");
    expect(textForAgent([one, { ...one, id: 2 }], "repo")).toContain("as 2 notes.");
  });
});

describe("selfie notes", () => {
  test("prints what was sent, never a draft", async () => {
    await writeNote({ text: "Sent one" });
    await send(app, "POST", "/api/notes/send", { via: "copy" });
    await writeNote({ text: "Still writing" });
    const { json, code } = await h.cli("notes");
    expect(code).toBe(0);
    expect(json.notes.map(({ messages }: any) => messages[0].text)).toEqual(["Sent one"]);
    expect(json.folder).toBe(project.repo.root);
  });

  test("with a picture of the note's box drawn on its image", async () => {
    await writeNote({ box: { x: 3, y: 3, width: 2, height: 2 } });
    await send(app, "POST", "/api/notes/send", { via: "copy" });
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
    await send(app, "POST", "/api/notes/send", { via: "copy" });
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
      await send(otherApp, "POST", "/api/notes/send", { via: "copy" });
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

describe("waiting for feedback", () => {
  const waiting = () => feedback().then(({ agentWaiting }) => agentWaiting);
  const untilWaiting = () => vi.waitFor(async () => expect(await waiting()).toBe(true), { timeout: 5_000 });
  const sendTo = (via: string) => send(app, "POST", "/api/notes/send", { via });

  test("nobody is waiting until an agent says so", async () => {
    expect(await waiting()).toBe(false);
  });

  test("the UI says an agent is waiting, and sending to it ends the wait with those notes", async () => {
    await writeNote({ text: "Already here" });
    const wait = h.cli("agent-await-feedback");
    await untilWaiting();
    expect((await sendTo("agent")).status).toBe(200);
    const { code, json } = await wait;
    expect(code).toBe(0);
    expect(json.outcome).toBe("notes");
    expect(json.notes.map(({ messages }: any) => messages[0].text)).toEqual(["Already here"]);
    expect(await waiting()).toBe(false);
  });

  test("only what's new comes back, and not what an agent already received", async () => {
    await writeNote({ text: "First" });
    const first = h.cli("agent-await-feedback");
    await untilWaiting();
    await sendTo("agent");
    await first;

    await writeNote({ text: "Second" });
    const second = h.cli("agent-await-feedback");
    await untilWaiting();
    await sendTo("agent");
    const { json } = await second;
    expect(json.notes.map(({ messages }: any) => messages[0].text)).toEqual(["Second"]);
    // Everything's still there to read.
    expect((await h.cli("notes")).json.notes).toHaveLength(2);
  });

  test("what a waiter didn't collect goes to the next one at once", async () => {
    await writeNote({ text: "Left behind" });
    await project.notes.send();
    const { code, json } = await h.cli("agent-await-feedback");
    expect(code).toBe(0);
    expect(json.notes.map(({ messages }: any) => messages[0].text)).toEqual(["Left behind"]);
  });

  test("what was copied has been handed over, so nothing waits for it", async () => {
    await writeNote({ text: "Pasted" });
    await sendTo("copy");
    const { code, json } = await h.cli("agent-await-feedback", "--timeout", "0");
    expect(code).toBe(3);
    expect(json).toMatchObject({ outcome: "timed-out", notes: [] });
  });

  test("a timeout has its own exit code, and stops saying an agent is waiting", async () => {
    expect((await h.cli("agent-await-feedback", "--timeout", "0")).code).toBe(3);
    expect(await waiting()).toBe(false);
  });

  test("a second agent in one folder is refused, and the first keeps waiting", async () => {
    const stop = new AbortController();
    const first = awaitFeedback(project, { timeoutMs: Infinity, signal: stop.signal });
    await untilWaiting();
    const refused = await h.cli("agent-await-feedback", "--timeout", "0");
    expect(refused.code).toBe(2);
    expect(refused.json.error.code).toBe("already-waiting");
    expect(await waiting()).toBe(true);
    stop.abort();
    expect((await first).outcome).toBe("stopped");
    expect(await waiting()).toBe(false);
  });

  test("an agent that died stops counting, and another can take over", async () => {
    expect(await project.notes.beat("dead")).toBe(true);
    expect(await waiting()).toBe(true);
    expect(await project.notes.beat("alive")).toBe(false);
    const raw = new DatabaseSync(path.join(project.directory, "store.db"));
    raw.prepare("UPDATE note_waiters SET heartbeat_at = ?").run(Date.now() - WAITER_STALE_MS - 1);
    raw.close();
    expect(await waiting()).toBe(false);
    expect(await project.notes.beat("alive")).toBe(true);
  });

  test("sending to an agent that's gone is refused, and sends nothing", async () => {
    await writeNote();
    const response = await sendTo("agent");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "no-agent-waiting" } });
    expect((await feedback()).notes[0].state).toBe("draft");
  });

  test("refuses a way of sending it doesn't know", async () => {
    expect((await sendTo("carrier-pigeon")).status).toBe(400);
  });

  test("an agent in another worktree waits for its own folder's notes", async () => {
    const other = path.join(h.scratch, "another");
    execFileSync("git", ["worktree", "add", "-q", "-b", "another", other], { cwd: h.repo });
    const otherProject = await openProject({ cwd: other, env: { SELFIE_HOME: h.home } });
    try {
      expect(await otherProject.notes.beat("there")).toBe(true);
      expect(await waiting()).toBe(false);
      await writeNote();
      await sendTo("copy");
      expect((await otherProject.notes.undelivered()).size).toBe(0);
    } finally {
      otherProject.close();
    }
  });

  test("marks what's new in what it prints", async () => {
    await writeNote({ text: "Ready" });
    const wait = h.cli("agent-await-feedback");
    await untilWaiting();
    await sendTo("agent");
    expect((await wait).json.notes[0].messages).toMatchObject([{ text: "Ready", new: true }]);
  });

  test("what's been copied isn't received again, even if it was sent to an agent that died", async () => {
    await writeNote({ text: "Sent, and never collected" });
    await project.notes.send();
    await sendTo("copy");
    expect((await project.notes.undelivered()).size).toBe(0);
  });

  test("an agent's own reply doesn't end its wait", async () => {
    await writeNote();
    await sendTo("copy");
    const raw = new DatabaseSync(path.join(project.directory, "store.db"));
    raw.prepare("INSERT INTO note_messages(note_id, sender, author, text, at, sent_at) SELECT id, 'agent', 'agent', 'Done', 1, 1 FROM notes").run();
    raw.close();
    expect((await project.notes.undelivered()).size).toBe(0);
  });

  test("a signal has its own exit code, so asking again on 3 can be stopped", async () => {
    const stop = new AbortController();
    let stdout = "";
    const running = runCli(["agent-await-feedback"], { cwd: h.repo, env: { SELFIE_HOME: h.home }, stdout: (text) => void (stdout += text), stderr: () => undefined, signal: stop.signal });
    await untilWaiting();
    stop.abort();
    expect(await running).toBe(130);
    expect(JSON.parse(stdout)).toMatchObject({ outcome: "stopped", notes: [] });
  });

  test("refuses a timeout that isn't a number", async () => {
    expect((await h.cli("agent-await-feedback", "--timeout", "soon")).code).toBe(2);
  });
});

describe("answers", () => {
  const sendAll = () => send(app, "POST", "/api/notes/send", { via: "copy" });
  const answer = (id: number, text: string) => send(app, "POST", `/api/notes/${id}/answers`, { text, batchId });
  const onlyNote = async () => (await feedback()).notes[0];
  const noteId = async () => (await onlyNote()).id as number;

  beforeEach(async () => {
    await writeNote({ text: "Make it bigger" });
    await sendAll();
  });

  test("an agent's reply shows on the note, and leaves it open", async () => {
    const { code, json } = await h.cli("reply", String(await noteId()), "Made it bigger", "--batch", batchId);
    expect(code).toBe(0);
    expect(json).toMatchObject({ note: await noteId(), batchId });
    expect(await onlyNote()).toMatchObject({ state: "replied", messages: [{ sender: "person" }, { sender: "agent", text: "Made it bigger", batchId, sent: true }] });
  });

  test("says whether the image changed in that batch, so a fix that moved nothing shows at once", async () => {
    expect((await h.cli("reply", String(await noteId()), "Nothing yet", "--batch", batchId)).json.imageChanged).toBe(false);
    h.stories = [{ id: "a", color: GREEN }];
    const newer = (await h.cli("render", "--storybook-dir", "ignored")).json.batchId;
    expect((await h.cli("reply", String(await noteId()), "Fixed", "--batch", newer)).json.imageChanged).toBe(true);
  });

  test("uses the newest batch from this folder if it isn't told one", async () => {
    h.stories = [{ id: "a", color: GREEN }];
    const newer = (await h.cli("render", "--storybook-dir", "ignored")).json.batchId;
    const { json } = await h.cli("reply", String(await noteId()), "Fixed");
    expect(json).toMatchObject({ batchId: newer, imageChanged: true });
    expect((await feedback()).latestBatchId).toBe(newer);
  });

  test("refuses a note this folder doesn't have, and a bad way of asking", async () => {
    expect((await h.cli("reply", "99999", "Hello")).code).toBe(2);
    expect((await h.cli("reply", "99999", "Hello")).json.error.code).toBe("unknown-note");
    expect((await h.cli("reply", "nope", "Hello")).code).toBe(2);
    expect((await h.cli("reply", String(await noteId()))).code).toBe(2);
    expect((await h.cli("reply", String(await noteId()), "   ")).code).toBe(2);
  });

  test("refuses an answer too long for the routes to take", async () => {
    expect((await h.cli("reply", String(await noteId()), "x".repeat(10_001))).code).toBe(2);
    expect((await onlyNote()).messages).toHaveLength(1);
  });

  test("refuses a batch that isn't in the store", async () => {
    expect((await h.cli("reply", String(await noteId()), "Hello", "--batch", "00000000-0000-4000-8000-000000000000")).code).toBe(2);
    expect((await onlyNote()).messages).toHaveLength(1);
  });

  test("a person's answer is a draft, which an agent can't see until it's sent", async () => {
    const id = await noteId();
    await h.cli("reply", String(id), "How much bigger?", "--batch", batchId);
    expect((await answer(id, "About double")).status).toBe(200);
    expect(await onlyNote()).toMatchObject({ state: "replied", messages: [{}, {}, { sender: "person", sent: false }] });
    expect((await h.cli("notes")).json.notes[0].messages).toHaveLength(2);
    await sendAll();
    expect((await onlyNote()).state).toBe("sent");
    expect((await h.cli("notes")).json.notes[0].messages).toHaveLength(3);
  });

  test("a waiting agent gets a person's answer with the whole conversation, and what's new marked", async () => {
    const id = await noteId();
    await h.cli("reply", String(id), "How much bigger?", "--batch", batchId);
    await answer(id, "About double");
    await project.notes.send();
    const { json } = await h.cli("agent-await-feedback");
    expect(json.notes[0].messages.map(({ text, new: isNew }: any) => [text, isNew])).toEqual([
      ["Make it bigger", false],
      ["How much bigger?", false],
      ["About double", true],
    ]);
  });

  test("a draft answer can be taken back, without losing the note", async () => {
    const id = await noteId();
    await answer(id, "Never mind");
    expect((await send(app, "DELETE", `/api/notes/${id}`)).status).toBe(200);
    expect(await onlyNote()).toMatchObject({ state: "sent", messages: [{ text: "Make it bigger" }] });
  });

  test("the text to paste says what to do, and has the whole conversation", async () => {
    const id = await noteId();
    await h.cli("reply", String(id), "How much bigger?", "--batch", batchId);
    const { text } = (await (await sendAll()).json()) as any;
    expect(text).toContain("Person: Make it bigger");
    expect(text).toContain("Agent: How much bigger?");
    expect(text).toContain("selfie reply <note>");
  });

  describe("resolving", () => {
    test("is the person's, and closes it for the agent", async () => {
      const id = await noteId();
      expect((await send(app, "POST", `/api/notes/${id}/resolve`, {})).status).toBe(200);
      expect((await onlyNote()).state).toBe("resolved");
      expect((await h.cli("notes")).json.notes).toEqual([]);
      expect((await h.cli("notes", "--all")).json.notes).toHaveLength(1);
      expect(((await (await sendAll()).json()) as any).text).not.toContain("Make it bigger");
    });

    test("an answer reopens it", async () => {
      const id = await noteId();
      await send(app, "POST", `/api/notes/${id}/resolve`, {});
      await answer(id, "Actually, one more thing");
      expect((await onlyNote()).state).toBe("sent");
    });

    test("an agent can't resolve one, only say what it did", async () => {
      const id = await noteId();
      await send(app, "POST", `/api/notes/${id}/resolve`, {});
      await h.cli("reply", String(id), "Sorry, also this", "--batch", batchId);
      expect((await onlyNote()).state).toBe("resolved");
    });

    test("refuses a note this folder doesn't have", async () => {
      expect((await send(app, "POST", "/api/notes/99999/resolve", {})).status).toBe(404);
      expect((await answer(99999, "Hello")).status).toBe(404);
    });
  });
});

describe("the newest batch from a folder", () => {
  test("is what was last recorded or reviewed there, and not a batch someone named", async () => {
    expect((await feedback()).latestBatchId).toBe(batchId);
    h.stories = [{ id: "a", color: GREEN }];
    const newer = (await h.cli("render", "--storybook-dir", "ignored")).json.batchId;
    expect((await feedback()).latestBatchId).toBe(newer);
    await h.cli("review", batchId);
    expect((await feedback()).latestBatchId).toBe(newer);
  });

  test("is remembered as soon as it's recorded, even if the review after that fails", async () => {
    h.stories = [{ id: "a", color: GREEN }];
    const { code } = await h.cli("review", "--storybook-dir", "ignored", "--baseline", "0".repeat(40));
    expect(code).toBe(2);
    expect((await feedback()).latestBatchId).not.toBe(batchId);
  });

  test("is each folder's own", async () => {
    const other = path.join(h.scratch, "elsewhere");
    execFileSync("git", ["worktree", "add", "-q", "-b", "elsewhere", other], { cwd: h.repo });
    const otherProject = await openProject({ cwd: other, env: { SELFIE_HOME: h.home } });
    try {
      expect((await feedback(appFor(otherProject))).latestBatchId).toBeNull();
    } finally {
      otherProject.close();
    }
  });
});

test("a picture is made once, however many times it's asked for", async () => {
  await writeNote({ box: { x: 3, y: 3, width: 2, height: 2 } });
  await send(app, "POST", "/api/notes/send", { via: "copy" });
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
