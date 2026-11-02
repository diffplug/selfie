// Writes the images the review UI's stories show, at the paths the server would answer, and their
// real hashes and pixel diffs. Here, since `selfie-cli` may depend on `selfie-ui` and never the
// reverse. Run it by hand if they need to change: node cli/scripts/generate-storybook-fixtures.ts
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePam, sha256, toHex, type RawImage } from "selfie-store";
import { diffImages } from "../src/diff.ts";
import { encodePng } from "../src/png.ts";

type Color = readonly [number, number, number];

const PAPER: Color = [255, 255, 255];
const INK: Color = [36, 41, 47];
const MUTED: Color = [208, 215, 222];
const ACCENT: Color = [9, 105, 218];
const GREEN: Color = [26, 127, 55];

function canvas(width: number, height: number) {
  const pixels = new Uint8Array(width * height * 3).fill(255);
  const box = (x: number, y: number, w: number, h: number, color: Color) => {
    for (let row = y; row < Math.min(y + h, height); row++) {
      for (let column = x; column < Math.min(x + w, width); column++) {
        pixels.set(color, (row * width + column) * 3);
      }
    }
  };
  return { box, image: (): RawImage => ({ width, height, pixels }) };
}

interface Page {
  readonly height?: number;
  readonly button?: Color;
  readonly footer?: Color;
  /** Rows of content, in rows of about 90 px. */
  readonly cards?: number;
  readonly scale?: number;
}

/** Something that reads as a page: a header, some text and cards, a button, and a footer. */
function page({ height = 900, button = ACCENT, footer = MUTED, cards = 3, scale = 1 }: Page): RawImage {
  const at = (value: number) => value * scale;
  const { box, image } = canvas(at(1200), at(height));
  box(0, 0, at(1200), at(56), INK);
  box(at(32), at(20), at(120), at(16), PAPER);
  box(at(32), at(88), at(420), at(24), INK);
  box(at(32), at(124), at(640), at(12), MUTED);
  for (let row = 0; row < cards; row++) {
    const y = 164 + row * 90;
    box(at(32), at(y), at(1136), at(74), [246, 248, 250]);
    box(at(48), at(y + 18), at(280), at(12), INK);
    box(at(48), at(y + 42), at(520), at(10), MUTED);
  }
  const below = 164 + cards * 90 + 16;
  box(at(32), at(below), at(160), at(36), button);
  box(at(32), at(height - 48), at(1136), at(16), footer);
  return image();
}

const IMAGES = {
  golden: page({}),
  changed: page({ button: GREEN }),
  tallGolden: page({ height: 2400, cards: 24 }),
  tallChanged: page({ height: 2400, cards: 24, button: GREEN, footer: ACCENT }),
  taller: page({ height: 990, cards: 4 }),
  fresh: page({ cards: 2, button: GREEN }),
  gone: page({ cards: 5, button: INK }),
  doubleGolden: page({ scale: 2 }),
  doubleChanged: page({ scale: 2, button: GREEN }),
} satisfies Record<string, RawImage>;

const DIFFS = [
  ["changed", "golden"],
  ["tallChanged", "tallGolden"],
  ["taller", "golden"],
  ["doubleChanged", "doubleGolden"],
] as const satisfies readonly (readonly [keyof typeof IMAGES, keyof typeof IMAGES])[];

const ui = fileURLToPath(new URL("../../ui/", import.meta.url));
const output = path.join(ui, "storybook-fixtures/api");
// These stay in Git history, so they get the smallest deflate.
const png = (image: RawImage) => encodePng(image, 9);
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "images"), { recursive: true });

const hashes: Record<string, string> = {};
for (const [name, image] of Object.entries(IMAGES)) {
  const hash = toHex(await sha256(encodePam(image)));
  hashes[name] = hash;
  await writeFile(path.join(output, "images", hash), await png(image));
}

const pixelDiffs: Record<string, unknown> = {};
for (const [current, golden] of DIFFS) {
  const { diff, highlighted } = diffImages(IMAGES[current], IMAGES[golden]);
  pixelDiffs[current] = diff;
  if (highlighted !== null) {
    const directory = path.join(output, "diffs", hashes[current]!, hashes[golden]!);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "image"), await png(highlighted));
  }
}

await writeFile(
  path.join(ui, "src/client/stories/images.generated.ts"),
  `// Written by cli/scripts/generate-storybook-fixtures.ts.
import type { PixelDiff } from "../../shared/api.ts";

export const HASHES = ${JSON.stringify(hashes, null, 2)} as const;

export const PIXEL_DIFFS = ${JSON.stringify(pixelDiffs, null, 2)} satisfies Record<string, PixelDiff>;
`,
);
