// Renders a built Storybook several times and says what wasn't the same each time. It records no
// run and stores nothing, so it can't change a review. See docs/specs/cli.md -> Flakes.
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { render as realRender, type Manifest, type ManifestStory, type RenderProgressEvent, type StoryError } from "selfie-render";
import { decodeImage } from "selfie-store";
import { sharpCodec } from "selfie-store/adapters/sharp-codec";
import { describeRenderProgress } from "selfie-ui/render-progress";
import { resolveRenderSettings, resolveStorybookDir } from "./config.ts";
import { diffImages, type PixelDiff } from "./diff.ts";
import { regularFileInside, storyDirName } from "./paths.ts";
import type { Project } from "./project.ts";
import { encodePng } from "./png.ts";
import { buildAsAsked, renderInput, type RenderBatchOptions } from "./review.ts";

/** What can vary about a story from one render to the next, or shouldn't happen in any of them. */
export type FlakeKind = "pixels" | "failed" | "timeout" | "request" | "errors";

export interface FlakyStory {
  readonly story: string;
  readonly kinds: readonly FlakeKind[];
  /** How many different images the renders made. */
  readonly distinctImages: number;
  /** The biggest difference from the first render, without its hunks. */
  readonly worst: Omit<PixelDiff, "hunks"> | null;
  /** That pair, and a picture of what differs. */
  readonly images: { readonly first: string; readonly other: string; readonly diff: string } | null;
  /** Each different error, and in how many of the renders. */
  readonly errors: readonly (StoryError & { readonly renders: number })[];
}

export interface FlakeReport {
  readonly environment: string;
  readonly renders: number;
  readonly stories: number;
  /** Biggest pixel difference first, so what most likely has one big cause comes first. */
  readonly flaky: readonly FlakyStory[];
  readonly warnings: readonly string[];
  /** Holds every render's images until the next time this batches. */
  readonly directory: string;
}

export interface FlakeOptions extends RenderBatchOptions {
  readonly times: number;
  readonly concurrency?: number | undefined;
}

/** Often enough that a long render doesn't look stuck, and few enough to read. */
const PROGRESS_LINE_EVERY_MS = 10_000;

/** Says how one render is going, with whatever `prefix` says about which it is. */
function progressLines(log: (line: string) => void, prefix: string): (progress: RenderProgressEvent) => void {
  const startedAtMs = Date.now();
  let firstStoryStartedAtMs: number | null = null;
  let saidAt = startedAtMs;
  return ({ event, finished, total }) => {
    const now = Date.now();
    if (event === "started") firstStoryStartedAtMs = now;
    if (now - saidAt < PROGRESS_LINE_EVERY_MS) return;
    saidAt = now;
    log(`${prefix}: ${describeRenderProgress({ total, finished, startedAtMs, firstStoryStartedAtMs }, now)}`);
  };
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function kindsOfErrors(perRender: readonly (readonly StoryError[])[]): { kinds: FlakeKind[]; errors: (StoryError & { renders: number })[] } {
  const seen = new Map<string, StoryError & { renders: number }>();
  for (const errors of perRender) {
    for (const [key, error] of new Map(errors.map((error) => [`${error.source}\n${error.message}`, error]))) {
      const known = seen.get(key);
      if (known === undefined) seen.set(key, { ...error, renders: 1 });
      else known.renders += 1;
    }
  }
  const errors = [...seen.values()];
  const kinds = new Set<FlakeKind>();
  for (const { source, renders } of errors) {
    // Waiting on the network always counts. Anything else is the project's own code, which is only
    // a flake if it comes and goes.
    if (source === "timeout" || source === "request") kinds.add(source);
    else if (renders < perRender.length) kinds.add("errors");
  }
  return { kinds: [...kinds], errors };
}

async function compare(
  id: string,
  directory: string,
  rendered: readonly { readonly at: number; readonly story: ManifestStory }[],
): Promise<Pick<FlakyStory, "distinctImages" | "worst" | "images">> {
  // The worker can write here, so a manifest's path is checked as a review checks it.
  const images = (
    await Promise.all(
      rendered.map(async ({ at, story }) => {
        if (story.file === null) return [];
        const checked = await regularFileInside(path.join(directory, String(at)), story.file);
        if ("refused" in checked) return [];
        const bytes = await readFile(checked.file);
        return [{ file: checked.file, bytes, hash: sha256(bytes) }];
      }),
    )
  ).flat();
  const first = images[0];
  const distinct = [...new Map(images.map((image) => [image.hash, image])).values()];
  if (first === undefined || distinct.length < 2) return { distinctImages: distinct.length, worst: null, images: null };

  const firstPixels = await decodeImage(first.bytes, sharpCodec);
  let worst: (ReturnType<typeof diffImages> & { other: string }) | null = null;
  for (const other of distinct.slice(1)) {
    const compared = diffImages(await decodeImage(other.bytes, sharpCodec), firstPixels);
    if (worst === null || compared.diff.changedPixels > worst.diff.changedPixels) worst = { ...compared, other: other.file };
  }
  const diffFile = path.join(directory, "diffs", `${storyDirName(id)}.png`);
  await mkdir(path.dirname(diffFile), { recursive: true });
  await writeFile(diffFile, await encodePng(worst!.highlighted));
  const { hunks: _hunks, ...summary } = worst!.diff;
  return { distinctImages: distinct.length, worst: summary, images: { first: first.file, other: worst!.other, diff: diffFile } };
}

export async function findFlakes(project: Project, options: FlakeOptions): Promise<FlakeReport> {
  const { repo } = project;
  const log = options.log ?? (() => {});
  const render = options.render ?? realRender;
  const settings = await resolveRenderSettings(repo, { native: options.native });
  await buildAsAsked(project, settings, options, log);

  const directory = path.join(project.directory, "flakes");
  await rm(directory, { recursive: true, force: true });
  const storybookDir = resolveStorybookDir(project.cwd, options.storybookDir, settings);
  const manifests: Manifest[] = [];
  for (let at = 0; at < options.times; at++) {
    log(`Render ${at + 1} of ${options.times}`);
    const onProgress = progressLines(log, `Render ${at + 1} of ${options.times}`);
    const input = renderInput({ storybookDir, outDir: path.join(directory, String(at)), log: () => {} }, settings, { ...options, onProgress });
    manifests.push(await render(options.concurrency === undefined ? input : { ...input, concurrency: options.concurrency }));
  }

  const ids = new Set(manifests.flatMap(({ stories }) => stories.map(({ id }) => id)));
  const flaky: FlakyStory[] = [];
  for (const id of ids) {
    const rendered = manifests.flatMap(({ stories }, at) => stories.filter((story) => story.id === id).map((story) => ({ at, story })));
    const { kinds, errors } = kindsOfErrors(rendered.map(({ story }) => story.errors));
    const compared = await compare(id, directory, rendered);
    if (rendered.some(({ story }) => story.status === "failed")) kinds.unshift("failed");
    if ((compared.worst?.changedPixels ?? 0) > 0) kinds.unshift("pixels");
    if (kinds.length > 0) flaky.push({ story: id, kinds, ...compared, errors });
  }
  flaky.sort((a, b) => (b.worst?.changedPixels ?? 0) - (a.worst?.changedPixels ?? 0) || a.story.localeCompare(b.story));
  return {
    environment: settings.environmentId,
    renders: options.times,
    stories: ids.size,
    flaky,
    warnings: [...new Set(manifests.flatMap(({ warnings }) => warnings))],
    directory,
  };
}
