// What the review server's test files share. Importing this registers the hooks that give each test a
// new repository, project, and app.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { REQUEST_HEADER_VALUE } from "selfie-ui/app";
import { createLocalApp } from "selfie-ui/local";
import { afterEach, beforeEach, expect } from "vitest";
import { openProject, type Project } from "../src/project.ts";
import { localReviewSource } from "../src/ui.ts";
import { createHarness, type Harness } from "./support.ts";

export const PORT = 4173;
export const HOST = `127.0.0.1:${PORT}`;
export const ORIGIN = `http://${HOST}`;
export const UNKNOWN_HASH = "0".repeat(64);
export const UNKNOWN_RUN = "00000000-0000-4000-8000-000000000000";

export let h: Harness;
export let project: Project;
export let clientDir: string;
export let app: ReturnType<typeof createLocalApp>;

beforeEach(async () => {
  h = await createHarness();
  project = await openProject({ cwd: h.repo, env: { SELFIE_HOME: h.home } });
  clientDir = path.join(h.scratch, "client");
  await mkdir(path.join(clientDir, "assets"), { recursive: true });
  await writeFile(path.join(clientDir, "index.html"), "<!doctype html><title>the client</title>");
  await writeFile(path.join(clientDir, "assets", "a.js"), "export {};");
  await writeFile(path.join(h.scratch, "secret.txt"), "not for serving");
  app = createLocalApp({ source: localReviewSource(project), port: () => PORT, clientDir });
});
afterEach(async () => {
  project.close();
  await h.destroy();
});

export const review = (...flags: string[]) => h.cli("review", "--storybook-dir", "ignored", ...flags);

export const get = (url: string, headers: Record<string, string> = {}) => app.request(url, { headers: { host: HOST, ...headers } });

export const change = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(url, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      host: HOST,
      origin: ORIGIN,
      "content-type": "application/json",
      "x-selfie-request": REQUEST_HEADER_VALUE,
      ...headers,
    },
  });

export const decideOn = (runId: string, decision: string, snapshots: unknown) => change(`/api/runs/${runId}/decisions`, { decision, snapshots });
export const acceptRun = (runId: string, body: unknown = {}) => change(`/api/runs/${runId}/accept`, body);
export const viewOf = async (runId: string) => (await (await get(`/api/runs/${runId}`)).json()) as any;

/** `h.stories` as the goldens of HEAD. */
export async function makeGoldens() {
  const { json } = await review();
  const view = await viewOf(json.runId);
  const targets = view.rows.map(({ story, imageHash }: any) => ({ story, imageHash }));
  expect((await decideOn(json.runId, "approved", targets)).status).toBe(200);
  expect((await acceptRun(json.runId)).status).toBe(200);
  return json.runId as string;
}
