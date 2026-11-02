// Finds two real images whose image hashes collide at 53 bits, and writes them to
// test/fixtures/collision-53bit/. Run by hand with `pnpm find-collision`; the test
// suite only reads the result and recomputes both hashes.
//
// Method: parallel collision search with distinguished points (van Oorschot and
// Wiener). Define f(x) as the truncated image hash of the image generated from x.
// Each worker walks x → f(x) → f(f(x)) … from a random start until it reaches a
// distinguished point, a value whose low bits are all zero, and reports only the
// trail's start, end, and length. Two trails ending at the same point have merged,
// and replaying both finds where. Memory stays at one small entry per trail, rather
// than one per hash as a table of every value would need. The birthday bound
// predicts about 1.2 × 10^8 hashes for a 53-bit range.

import { hash, randomBytes } from "node:crypto";
import { availableParallelism } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { encodePam, truncateHash } from "../src/core/index.ts";

const MAX_MINUTES = 20;
const IMAGE_SIZE = 4;
const DISTINGUISHED_BITS = 16;
const DISTINGUISHED = 2 ** DISTINGUISHED_BITS;
// A trail this long has almost certainly entered a cycle with no distinguished point.
const MAX_TRAIL = 20 * DISTINGUISHED;
const TWO_32 = 2 ** 32;

interface Trail {
  readonly start: number;
  readonly end: number | null;
  readonly length: number;
}

/**
 * An opaque 4×4 image. Its first seven color channels hold x, big-endian, so
 * different values of x always make different images. The rest is a fixed gradient.
 */
function pixelsFor(x: number): Uint8Array {
  const pixels = new Uint8Array(IMAGE_SIZE * IMAGE_SIZE * 4);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = i % 4 === 3 ? 255 : i * 3;
  }
  writeSeed(pixels, 0, x);
  return pixels;
}

// Skips each pixel's alpha, at offsets 3 and 7.
const SEED_OFFSETS = [0, 1, 2, 4, 5, 6, 8] as const;

function writeSeed(bytes: Uint8Array, base: number, x: number): void {
  const high = Math.floor(x / TWO_32);
  const low = x >>> 0;
  const seed = [high >>> 16, high >>> 8, high, low >>> 24, low >>> 16, low >>> 8, low];
  SEED_OFFSETS.forEach((offset, i) => {
    bytes[base + offset] = seed[i]! & 255;
  });
}

function createStep(): (x: number) => number {
  const pam = encodePam({
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    pixels: pixelsFor(0),
  });
  const pixelStart = pam.length - IMAGE_SIZE * IMAGE_SIZE * 4;
  return (x) => {
    writeSeed(pam, pixelStart, x);
    return truncateHash(hash("sha256", pam, "buffer"));
  };
}

function randomSeed(): number {
  return Number(randomBytes(8).readBigUInt64BE() >> 11n);
}

function runWorker(): void {
  const step = createStep();
  for (;;) {
    const start = randomSeed();
    let x = start;
    let length = 0;
    do {
      x = step(x);
      length++;
    } while (x % DISTINGUISHED !== 0 && length < MAX_TRAIL);
    const trail: Trail = { start, end: x % DISTINGUISHED === 0 ? x : null, length };
    parentPort!.postMessage(trail);
  }
}

/** Replays two trails with the same end and returns the two seeds where they merge. */
function findMerge(
  step: (x: number) => number,
  one: Trail,
  other: Trail,
): readonly [number, number] | null {
  let a = one.start;
  let b = other.start;
  for (let i = one.length; i > other.length; i--) a = step(a);
  for (let i = other.length; i > one.length; i--) b = step(b);
  // Equal here means one trail started on the other, so there is no collision.
  while (a !== b) {
    const nextA = step(a);
    const nextB = step(b);
    if (nextA === nextB) return [a, b];
    a = nextA;
    b = nextB;
  }
  return null;
}

async function search(maxMinutes: number): Promise<void> {
  const threads = availableParallelism();
  const step = createStep();
  const startedAt = performance.now();
  const trails = new Map<number, Trail>();
  let hashes = 0;
  let abandoned = 0;
  let falseMerges = 0;

  const rate = () => Math.round(hashes / ((performance.now() - startedAt) / 1000));
  console.log(`${threads} threads, ${DISTINGUISHED_BITS} distinguished bits`);

  const workers = Array.from(
    { length: threads },
    () => new Worker(fileURLToPath(import.meta.url)),
  );

  const pair = await new Promise<readonly [number, number] | null>((resolve, reject) => {
    const done = (result: readonly [number, number] | null) => {
      clearTimeout(deadline);
      clearInterval(progress);
      resolve(result);
    };
    const deadline = setTimeout(() => done(null), maxMinutes * 60_000);
    const progress = setInterval(() => {
      console.log(`${hashes} hashes, ${rate()}/s, ${trails.size} trails`);
    }, 10_000);
    for (const worker of workers) {
      worker.on("error", (error) => {
        clearTimeout(deadline);
        clearInterval(progress);
        reject(error);
      });
      worker.on("message", (trail: Trail) => {
        hashes += trail.length;
        if (trail.end === null) {
          abandoned++;
          return;
        }
        const earlier = trails.get(trail.end);
        if (earlier === undefined) {
          trails.set(trail.end, trail);
          return;
        }
        const merge = findMerge(step, earlier, trail);
        // A pair colliding on 0 would both take negative keys, with no positive key to collide with.
        if (merge !== null && step(merge[0]) !== 0) {
          done(merge);
        } else {
          falseMerges++;
        }
      });
    }
  });
  await Promise.all(workers.map((worker) => worker.terminate()));

  const seconds = (performance.now() - startedAt) / 1000;
  const summary = `${hashes} hashes in ${seconds.toFixed(1)}s (${rate()}/s), ${trails.size} trails, ${abandoned} abandoned, ${falseMerges} false merges`;
  if (pair === null) {
    console.error(`No collision within ${maxMinutes} minutes: ${summary}`);
    process.exitCode = 1;
    return;
  }

  const directory = join(
    dirname(fileURLToPath(import.meta.url)),
    "../test/fixtures/collision-53bit",
  );
  mkdirSync(directory, { recursive: true });
  pair.forEach((seed, i) => {
    const pam = encodePam({ width: IMAGE_SIZE, height: IMAGE_SIZE, pixels: pixelsFor(seed) });
    const name = i === 0 ? "a.pam" : "b.pam";
    writeFileSync(join(directory, name), pam);
    console.log(`${name}: seed ${seed}, sha256 ${hash("sha256", pam, "hex")}`);
  });
  console.log(`Collision found at truncated value ${step(pair[0])}: ${summary}`);
}

if (isMainThread) {
  await search(MAX_MINUTES);
} else {
  runWorker();
}
