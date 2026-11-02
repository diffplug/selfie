// Recognizing a build that already rendered, so a review can skip capture and record that run's
// images again. See docs/specs/cli.md -> Recording only if necessary.
import { createHash } from "node:crypto";
import {
  DEFAULT_SETTLE_MS,
  filterStories,
  hashTree,
  rendererIdentity,
  type Manifest,
  type StoryError,
} from "selfie-render";
import type { RecordedSnapshot, Run, Sql } from "selfie-store";
import type { CaptureSettings } from "./config.ts";
import type { Project } from "./project.ts";

/** Local only: in the project's `store.db`, and not in the store's schema, which D1 also has. */
const CREATE_REUSE_TABLES = [
  "CREATE TABLE IF NOT EXISTS render_keys (key TEXT PRIMARY KEY, run_id TEXT NOT NULL) WITHOUT ROWID",
  "CREATE TABLE IF NOT EXISTS reused_runs (run_id TEXT PRIMARY KEY, from_run_id TEXT NOT NULL) WITHOUT ROWID",
];

export const initReuseTables = (sql: Sql) => sql.batch(CREATE_REUSE_TABLES.map((text) => ({ sql: text })));

/**
 * What differs between two builds of the same source, and which nothing in a build loads, so it
 * can't change a pixel: docs/specs/cli.rationale.md -> Recording only if necessary. Exact paths
 * and exact text: a build where these don't match just hashes differently, which only renders.
 */
const VOLATILE_TEXT = new Map([
  ["project.json", /^\{"generatedAt":\d+,/],
  ["manifests/components.html", /Generation took <strong>[\d.]+s<\/strong>/],
]);

/** The bytes of a build's file that count, with its volatile text gone. */
export function bytesToHash(file: string, bytes: Buffer): Uint8Array {
  const volatile = VOLATILE_TEXT.get(file);
  // latin1 keeps every byte as one character, so nothing else about the file can change here.
  return volatile === undefined ? bytes : Buffer.from(bytes.toString("latin1").replace(volatile, ""), "latin1");
}

export interface KeyInputs {
  readonly build: string;
  readonly environment: string;
  readonly settleMs: number;
  readonly initScriptSha256: string | null;
  readonly renderer: string;
  readonly stability: boolean;
  /** Sorted `--story` patterns, or null for every story. */
  readonly stories: readonly string[] | null;
}

export const renderKey = (inputs: KeyInputs): string =>
  createHash("sha256")
    .update(
      JSON.stringify([
        inputs.build,
        inputs.environment,
        inputs.settleMs,
        inputs.initScriptSha256,
        inputs.renderer,
        inputs.stability,
        inputs.stories,
      ]),
    )
    .digest("hex");

/**
 * The key a render here would be remembered under, and those that could answer this request: its
 * own, and for a filtered one, the same build's whole run. Null if it can't take part: a native
 * machine's ID doesn't describe all of it, and a build that's missing or holds a symlink can't
 * be hashed.
 */
export async function renderKeys(
  storybookDir: string,
  { environment, environmentId, initScript }: CaptureSettings,
  { stability, stories }: { readonly stability: boolean; readonly stories: readonly string[] | undefined },
): Promise<{ readonly record: string; readonly lookup: readonly string[] } | null> {
  if (environment.runner.kind !== "container") return null;
  const build = await hashTree(storybookDir, bytesToHash).catch(() => null);
  if (build === null) return null;
  const shared = {
    build,
    environment: environmentId,
    settleMs: DEFAULT_SETTLE_MS,
    initScriptSha256: initScript === undefined ? null : createHash("sha256").update(initScript).digest("hex"),
    renderer: await rendererIdentity(),
    stability,
  };
  const whole = renderKey({ ...shared, stories: null });
  if (stories === undefined) return { record: whole, lookup: [whole] };
  const record = renderKey({ ...shared, stories: [...new Set(stories)].sort() });
  return { record, lookup: [record, whole] };
}

/** Project facts, the same every time the same build renders. Anything else might not recur. */
const REPEATABLE_ERRORS: ReadonlySet<StoryError["source"]> = new Set(["play", "console", "page"]);

/** Why this render mustn't answer a later review, or null if it may. */
export function whyNotReusable(manifest: Manifest, run: Run): string | null {
  if (run.status !== "complete") return "a story failed";
  const sources = new Set(
    manifest.stories.flatMap(({ errors }) => errors.map(({ source }) => source)).filter((source) => !REPEATABLE_ERRORS.has(source)),
  );
  if (sources.size > 0) return `stories had errors that might not recur (${[...sources].sort().join(", ")})`;
  const unmatched = run.storyFilter?.unmatched.length ?? 0;
  return manifest.warnings.length > unmatched ? "the capture warned about itself" : null;
}

/** Remembers the newest real render of a key, or forgets the key if that render can't be reused. */
export async function rememberRender(project: Project, key: string, runId: string | null): Promise<void> {
  await project.sql.run(
    runId === null
      ? { sql: "DELETE FROM render_keys WHERE key = ?1", params: [key], idempotent: true }
      : {
          sql: `INSERT INTO render_keys(key, run_id) VALUES (?1, ?2)
ON CONFLICT(key) DO UPDATE SET run_id = excluded.run_id`,
          params: [key, runId],
          idempotent: true,
        },
  );
}

/** A remembered run's rows, narrowed to this request's patterns, ready to record in a new run. */
export async function findReusableRender(
  project: Project,
  keys: readonly string[],
  patterns: readonly string[] | undefined,
): Promise<{ readonly runId: string; readonly records: readonly RecordedSnapshot[] } | null> {
  for (const key of keys) {
    const [row] = await project.sql.run({
      sql: "SELECT run_id FROM render_keys WHERE key = ?1",
      params: [key],
      idempotent: true,
    });
    if (row === undefined) continue;
    const runId = row.run_id as string;
    if ((await project.snapshots.getRun(runId))?.status !== "complete") continue;

    const { snapshots } = await project.snapshots.compareRun(runId, null, { includeUnchanged: true });
    const stories = snapshots.map((snapshot) => ({ id: snapshot.story, snapshot }));
    const chosen = patterns === undefined ? stories : filterStories(stories, patterns).stories;
    return {
      runId,
      records: chosen.map(({ snapshot: { story, imageHash, unstable, playError } }) => ({
        story,
        // A `complete` run's every row has one.
        imageHash: imageHash!,
        unstable,
        playError,
      })),
    };
  }
  return null;
}

export async function markReused(project: Project, runId: string, fromRunId: string): Promise<void> {
  await project.sql.run({
    sql: "INSERT INTO reused_runs(run_id, from_run_id) VALUES (?1, ?2) ON CONFLICT(run_id) DO NOTHING",
    params: [runId, fromRunId],
    idempotent: true,
  });
}

/** The run that really rendered this one's images, if this one didn't. */
export async function reusedFrom(project: Project, runId: string): Promise<string | null> {
  const [row] = await project.sql.run({
    sql: "SELECT from_run_id FROM reused_runs WHERE run_id = ?1",
    params: [runId],
    idempotent: true,
  });
  return (row?.from_run_id as string | undefined) ?? null;
}
