// Renders a built Storybook several times and says what wasn't the same each time. It records no
// run and stores nothing, so it can't change a review. See docs/specs/cli.md -> Flakes.
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { render as realRender, type Manifest, type ManifestStory, type StoryError } from "selfie-render";
import { decodeImage } from "selfie-store";
import { sharpCodec } from "selfie-store/adapters/sharp-codec";
import { resolveRenderSettings, resolveStorybookDir } from "./config.ts";
import { diffToPng, type PixelDiff } from "./diff.ts";
import { SelfieError } from "./errors.ts";
import { regularFileInside } from "./paths.ts";
import type { Project } from "./project.ts";
import { buildIfAsked } from "./review.ts";

/** What can vary about a story from one render to the next, or shouldn't happen in any of them. */
export type FlakeKind = "pixels" | "failed" | "timeout" | "request" | "errors";

export interface FlakyStory {
  readonly story: string;
  readonly kinds: readonly FlakeKind[];
  /** How many different images the renders made. */
  readonly distinctImages: number;
  /** The biggest difference from the first render, without its regions. */
  readonly worst: Omit<PixelDiff, "regions"> | null;
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
  /** Holds every render's images until the next time this runs. */
  readonly directory: string;
}

export interface FlakeOptions {
  readonly storybookDir?: string | undefined;
  readonly native?: boolean | undefined;
  readonly stories?: readonly string[] | undefined;
  readonly runs: number;
  readonly concurrency?: number | undefined;
  readonly buildCommand?: string | undefined;
  readonly buildFromConfig?: boolean | undefined;
  readonly render?: typeof realRender | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly log?: ((line: string) => void) | undefined;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Other sources are the project's own code, which is only a flake if it comes and goes. */
const ALWAYS_WORTH_SAYING: Readonly<Partial<Record<StoryError["source"], FlakeKind>>> = { timeout: "timeout", request: "request" };

function kindsOfErrors(perRender: readonly (readonly StoryError[])[]): { kinds: FlakeKind[]; errors: (StoryError & { renders: number })[] } {
  const seen = new Map<string, StoryError & { renders: number }>();
  for (const errors of perRender) {
    for (const key of new Set(errors.map((error) => `${error.source}\n${error.message}`))) {
      const [source, ...message] = key.split("\n");
      const known = seen.get(key);
      if (known === undefined) seen.set(key, { source: source as StoryError["source"], message: message.join("\n"), renders: 1 });
      else known.renders += 1;
    }
  }
  const errors = [...seen.values()];
  const kinds = new Set<FlakeKind>();
  for (const { source, renders } of errors) {
    const always = ALWAYS_WORTH_SAYING[source];
    if (always !== undefined) kinds.add(always);
    else if (renders < perRender.length) kinds.add("errors");
  }
  return { kinds: [...kinds], errors };
}

async function compare(
  id: string,
  directory: string,
  rendered: readonly { readonly render: number; readonly story: ManifestStory }[],
): Promise<Pick<FlakyStory, "distinctImages" | "worst" | "images">> {
  // The worker can write here, so a manifest's path is checked as a review checks it.
  const images = (
    await Promise.all(
      rendered.map(async ({ render, story }) => {
        if (story.file === null) return [];
        const checked = await regularFileInside(path.join(directory, String(render)), story.file);
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
  let worst: { diff: PixelDiff; png: Uint8Array; other: string } | null = null;
  for (const other of distinct.slice(1)) {
    const { diff, png } = await diffToPng(await decodeImage(other.bytes, sharpCodec), firstPixels);
    if (worst === null || diff.changedPixels > worst.diff.changedPixels) worst = { diff, png, other: other.file };
  }
  const diffFile = path.join(directory, "diffs", `${encodeURIComponent(id)}.png`);
  await mkdir(path.dirname(diffFile), { recursive: true });
  await writeFile(diffFile, worst!.png);
  const { regions: _regions, ...summary } = worst!.diff;
  return { distinctImages: distinct.length, worst: summary, images: { first: first.file, other: worst!.other, diff: diffFile } };
}

export async function findFlakes(project: Project, options: FlakeOptions): Promise<FlakeReport> {
  const { repo } = project;
  const log = options.log ?? (() => {});
  const render = options.render ?? realRender;
  const settings = await resolveRenderSettings(repo, { native: options.native });
  if (options.buildFromConfig === true) {
    if (settings.buildCommand === undefined) throw new SelfieError("usage", "--build runs the config's buildCommand, and selfie.config.json has none.");
    await buildIfAsked(settings.buildCommand, repo.root, options.signal, log);
  } else {
    await buildIfAsked(options.buildCommand, project.cwd, options.signal, log);
  }

  const directory = path.join(project.directory, "flakes");
  await rm(directory, { recursive: true, force: true });
  const manifests: Manifest[] = [];
  for (let at = 0; at < options.runs; at++) {
    log(`Render ${at + 1} of ${options.runs}`);
    manifests.push(
      await render({
        storybookDir: resolveStorybookDir(project.cwd, options.storybookDir, settings),
        outDir: path.join(directory, String(at)),
        environment: settings.environment,
        log: () => {},
        ...(options.stories === undefined ? {} : { stories: [...options.stories] }),
        ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
        ...(settings.initScript === undefined ? {} : { initScript: settings.initScript }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    );
  }

  const ids = new Set(manifests.flatMap(({ stories }) => stories.map(({ id }) => id)));
  const flaky: FlakyStory[] = [];
  for (const id of ids) {
    const rendered = manifests.flatMap(({ stories }, render) => stories.filter((story) => story.id === id).map((story) => ({ render, story })));
    const { kinds, errors } = kindsOfErrors(rendered.map(({ story }) => story.errors));
    const compared = await compare(id, directory, rendered);
    if (rendered.some(({ story }) => story.status === "failed")) kinds.unshift("failed");
    if ((compared.worst?.changedPixels ?? 0) > 0) kinds.unshift("pixels");
    if (kinds.length > 0) flaky.push({ story: id, kinds, ...compared, errors });
  }
  flaky.sort((a, b) => (b.worst?.changedPixels ?? 0) - (a.worst?.changedPixels ?? 0) || a.story.localeCompare(b.story));
  return {
    environment: settings.environmentId,
    renders: options.runs,
    stories: ids.size,
    flaky,
    warnings: [...new Set(manifests.flatMap(({ warnings }) => warnings))],
    directory,
  };
}
