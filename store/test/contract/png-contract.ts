import { describe, expect, it } from "vitest";
import {
  decodePng,
  encodePam,
  encodePng,
  ImageDecodeError,
  imageMediaType,
  sha256,
  toHex,
  type RawImage,
} from "../../src/core/index.ts";
import {
  buildPng,
  chunk,
  chunkOf,
  concat,
  GRAY,
  GRAY_ALPHA,
  idat,
  iend,
  ihdr,
  PALETTE,
  pngFile,
  RGB,
  RGBA,
  withoutChunks,
  zlibStored,
  type HeaderFields,
  type PngSpec,
} from "../support/png-builder.ts";

const hashOf = async (image: RawImage) => toHex(await sha256(encodePam(image)));

/** Every sample of a picture, from a function giving each pixel's RGB. */
function picture(width: number, height: number, rgb: (x: number, y: number) => number[]): RawImage {
  const pixels: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels.push(...rgb(x, y));
  }
  return { width, height, pixels: new Uint8Array(pixels) };
}

const WIDTH = 9;
const HEIGHT = 7;
const color = (x: number, y: number) => [x * 28, y * 40, (x * y * 13 + 5) % 256];
const COLOR = picture(WIDTH, HEIGHT, color);
const size = { width: WIDTH, height: HEIGHT };

// Every distinct color the picture uses, as a palette.
const colorKey = (x: number, y: number) => color(x, y).join();
const paletteKeys = [
  ...new Set(
    Array.from({ length: WIDTH * HEIGHT }, (_, i) => colorKey(i % WIDTH, Math.floor(i / WIDTH))),
  ),
];
const PLTE = chunk("PLTE", ...paletteKeys.flatMap((key) => key.split(",").map(Number)));
const paletted = { colorType: PALETTE, bitDepth: 8, before: [PLTE] };
const paletteIndex = (x: number, y: number) => [paletteKeys.indexOf(colorKey(x, y))];

const asRgb8: PngSpec = { ...size, colorType: RGB, bitDepth: 8, sample: color };
const asRgba8: PngSpec = { ...size, colorType: RGBA, bitDepth: 8, sample: (x, y) => [...color(x, y), 255] };
const to16 = (samples: number[]) => samples.map((sample) => sample * 257);
const asRgb16: PngSpec = { ...size, colorType: RGB, bitDepth: 16, sample: (x, y) => to16(color(x, y)) };
const asRgba16: PngSpec = {
  ...size,
  colorType: RGBA,
  bitDepth: 16,
  sample: (x, y) => to16([...color(x, y), 255]),
};
const asPalette: PngSpec = { ...size, ...paletted, sample: paletteIndex };

const ALL_FILTERS = [0, 1, 2, 3, 4];
// RGB `1, 2, 3` appears nowhere in the picture.
const UNUSED_RGB_KEY = chunk("tRNS", 0, 1, 0, 2, 0, 3);

const COLOR_ENCODINGS: readonly (readonly [string, PngSpec])[] = [
  ["8-bit RGB", asRgb8],
  ...ALL_FILTERS.map((filter): [string, PngSpec] => [
    `8-bit RGB with filter ${filter} on every row`,
    { ...asRgb8, filters: [filter] },
  ]),
  ["8-bit RGB with each filter in turn", { ...asRgb8, filters: ALL_FILTERS }],
  ["8-bit RGB across three IDAT chunks", { ...asRgb8, idatCount: 3 }],
  ["interlaced 8-bit RGB", { ...asRgb8, interlaced: true }],
  ["interlaced 8-bit RGB with each filter in turn", { ...asRgb8, interlaced: true, filters: ALL_FILTERS }],
  ["8-bit RGBA with alpha all 255", asRgba8],
  ["8-bit RGBA with alpha all 255 and each filter in turn", { ...asRgba8, filters: ALL_FILTERS }],
  ["interlaced 8-bit RGBA with alpha all 255", { ...asRgba8, interlaced: true }],
  ["16-bit RGB of exact values", asRgb16],
  ["16-bit RGB with each filter in turn", { ...asRgb16, filters: ALL_FILTERS }],
  ["interlaced 16-bit RGB", { ...asRgb16, interlaced: true }],
  ["16-bit RGBA with alpha all 65535", asRgba16],
  ["interlaced 16-bit RGBA", { ...asRgba16, interlaced: true }],
  ["8-bit palette", asPalette],
  ["interlaced 8-bit palette", { ...asPalette, interlaced: true }],
  ["8-bit RGB whose tRNS color no pixel uses", { ...asRgb8, before: [UNUSED_RGB_KEY] }],
  [
    "16-bit RGB whose tRNS color is no 8-bit value",
    { ...asRgb16, before: [chunk("tRNS", 0x12, 0x34, 0x12, 0x34, 0x12, 0x34)] },
  ],
  [
    "palette with a tRNS chunk of all 255",
    { ...asPalette, before: [PLTE, chunk("tRNS", 255, 255, 255)] },
  ],
  [
    "palette whose only transparent entry no pixel uses",
    {
      ...asPalette,
      before: [
        // A 65th entry, past every index the picture uses, is the transparent one.
        chunk("PLTE", ...paletteKeys.flatMap((key) => key.split(",").map(Number)), 9, 9, 9),
        chunkOf("tRNS", new Uint8Array(paletteKeys.length + 1).fill(255).fill(0, paletteKeys.length)),
      ],
    },
  ],
  ["RGB with a suggested palette", { ...asRgb8, before: [chunk("PLTE", 1, 2, 3)] }],
  [
    "8-bit RGB with metadata that doesn't change colors",
    {
      ...asRgb8,
      before: [
        chunk("sRGB", 0),
        chunk("pHYs", 0, 0, 0, 1, 0, 0, 0, 1, 0),
        chunk("bKGD", 0, 9, 0, 9, 0, 9),
        chunk("prVt", 1, 2, 3),
      ],
      after: [chunkOf("tEXt", new TextEncoder().encode("Title\0Hello")), chunk("tIME", 7, 234, 11, 1, 0, 0, 0)],
    },
  ],
];

// Black and white, which every bit depth and color type can hold exactly.
const isWhite = (x: number, y: number) => (x + y * 3) % 2;
const BLACK_AND_WHITE = picture(WIDTH, HEIGHT, (x, y) => {
  const value = isWhite(x, y) * 255;
  return [value, value, value];
});
const BLACK_WHITE_PLTE = chunk("PLTE", 0, 0, 0, 255, 255, 255);

const BLACK_AND_WHITE_ENCODINGS: readonly (readonly [string, PngSpec])[] = [
  ...[1, 2, 4, 8, 16].map((bitDepth): [string, PngSpec] => [
    `${bitDepth}-bit grayscale`,
    {
      ...size,
      colorType: GRAY,
      bitDepth,
      sample: (x, y) => [isWhite(x, y) * (2 ** bitDepth - 1)],
    },
  ]),
  ...[1, 2, 4, 8].map((bitDepth): [string, PngSpec] => [
    `${bitDepth}-bit palette`,
    { ...size, colorType: PALETTE, bitDepth, before: [BLACK_WHITE_PLTE], sample: (x, y) => [isWhite(x, y)] },
  ]),
  ...[8, 16].map((bitDepth): [string, PngSpec] => {
    const max = 2 ** bitDepth - 1;
    return [
      `${bitDepth}-bit grayscale with alpha all ${max}`,
      { ...size, colorType: GRAY_ALPHA, bitDepth, sample: (x, y) => [isWhite(x, y) * max, max] },
    ];
  }),
  ...[8, 16].map((bitDepth): [string, PngSpec] => {
    const max = 2 ** bitDepth - 1;
    return [
      `${bitDepth}-bit RGB`,
      {
        ...size,
        colorType: RGB,
        bitDepth,
        sample: (x, y) => [isWhite(x, y) * max, isWhite(x, y) * max, isWhite(x, y) * max],
      },
    ];
  }),
];

// Below 8 bits, the PNG spec scales grayscale to fill the range.
const GRAY_LEVELS: readonly (readonly [number, readonly number[]])[] = [
  [1, [0, 255]],
  [2, [0, 85, 170, 255]],
  [4, [0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255]],
];

const rgbaWith = (alpha: number, bitDepth = 8) =>
  buildPng({
    width: 2,
    height: 2,
    colorType: RGBA,
    bitDepth,
    sample: (x, y) => [
      ...[1, 2, 3].map((value) => (bitDepth === 16 ? value * 257 : value)),
      x === 1 && y === 1 ? alpha : 2 ** bitDepth - 1,
    ],
  });

const scanlinesOf = (...bytes: readonly number[]) => zlibStored(new Uint8Array(bytes));
const withHeader = (fields: HeaderFields, ...rest: readonly Uint8Array[]) =>
  pngFile(ihdr(fields), ...rest);
const headerOnly = (fields: HeaderFields) => withHeader(fields, idat(1, 2, 3), iend());
const VALID = pngFile(ihdr(), idat(1, 2, 3), iend());

/** The file with one byte flipped, this far from its end. */
function withBadChecksum(png: Uint8Array, fromEnd: number): Uint8Array {
  const bad = png.slice();
  bad[bad.length - fromEnd]! ^= 1;
  return bad;
}

const TRANSPARENCY: readonly (readonly [string, Uint8Array])[] = [
  ["RGBA alpha 254", rgbaWith(254)],
  ["RGBA alpha 0", rgbaWith(0)],
  ["16-bit RGBA alpha 65278, an exact 254", rgbaWith(65278, 16)],
  [
    "interlaced RGBA",
    buildPng({
      width: 2,
      height: 2,
      colorType: RGBA,
      bitDepth: 8,
      interlaced: true,
      sample: (x) => [1, 2, 3, x === 0 ? 255 : 128],
    }),
  ],
  [
    "grayscale alpha 128",
    buildPng({ width: 1, height: 1, colorType: GRAY_ALPHA, bitDepth: 8, sample: () => [9, 128] }),
  ],
  [
    "16-bit grayscale alpha 0",
    buildPng({ width: 1, height: 1, colorType: GRAY_ALPHA, bitDepth: 16, sample: () => [0x0909, 0] }),
  ],
  [
    "a palette entry with alpha 128, in use",
    buildPng({
      width: 1,
      height: 1,
      colorType: PALETTE,
      bitDepth: 8,
      before: [chunk("PLTE", 1, 2, 3), chunk("tRNS", 128)],
      sample: () => [0],
    }),
  ],
  [
    "a palette entry with alpha 0, past the first, at a low bit depth",
    buildPng({
      width: 2,
      height: 1,
      colorType: PALETTE,
      bitDepth: 2,
      before: [chunk("PLTE", 1, 2, 3, 4, 5, 6), chunk("tRNS", 255, 0)],
      sample: (x) => [x],
    }),
  ],
  [
    "8-bit grayscale matching its tRNS value",
    buildPng({ width: 1, height: 1, colorType: GRAY, bitDepth: 8, before: [chunk("tRNS", 0, 9)], sample: () => [9] }),
  ],
  [
    "1-bit grayscale matching its tRNS value",
    buildPng({ width: 1, height: 1, colorType: GRAY, bitDepth: 1, before: [chunk("tRNS", 0, 1)], sample: () => [1] }),
  ],
  [
    "16-bit grayscale matching its tRNS value",
    buildPng({
      width: 1,
      height: 1,
      colorType: GRAY,
      bitDepth: 16,
      before: [chunk("tRNS", 9, 9)],
      sample: () => [0x0909],
    }),
  ],
  [
    "8-bit RGB matching its tRNS color",
    buildPng({ ...asRgb8, width: 1, height: 1, before: [chunk("tRNS", 0, 0, 0, 0, 0, 5)], sample: () => [0, 0, 5] }),
  ],
  [
    "16-bit RGB matching its tRNS color",
    buildPng({
      width: 1,
      height: 1,
      colorType: RGB,
      bitDepth: 16,
      before: [chunk("tRNS", 1, 1, 2, 2, 3, 3)],
      sample: () => [0x0101, 0x0202, 0x0303],
    }),
  ],
];

const INEXACT_SAMPLES: readonly (readonly [string, Uint8Array])[] = [
  ["16-bit RGB", buildPng({ width: 1, height: 1, colorType: RGB, bitDepth: 16, sample: () => [0x0101, 0x0203, 0x0303] })],
  ["16-bit grayscale", buildPng({ width: 1, height: 1, colorType: GRAY, bitDepth: 16, sample: () => [1] })],
  ["16-bit RGBA alpha 65534", rgbaWith(65534, 16)],
];

const MALFORMED: readonly (readonly [string, Uint8Array, RegExp])[] = [
  ["an empty file", new Uint8Array(0), /signature/],
  ["a file that is not a PNG", new TextEncoder().encode("GIF89a and more bytes"), /signature/],
  ["only a signature", VALID.subarray(0, 8), /before its IEND/],
  ["no IEND chunk", pngFile(ihdr(), idat(1, 2, 3)), /before its IEND/],
  ["a file cut off inside a chunk", VALID.subarray(0, VALID.length - 14), /inside a chunk/],
  ["a chunk whose length runs past the file", pngFile(concat(new Uint8Array([0, 0, 0, 200]), chunk("IDAT"))), /inside a chunk/],
  ["bytes after IEND", concat(VALID, new Uint8Array([0])), /after its IEND/],
  ["a non-empty IEND", pngFile(ihdr(), idat(1, 2, 3), chunk("IEND", 0)), /IEND chunk is not empty/],
  ["a bad IHDR checksum", withBadChecksum(pngFile(ihdr()), 1), /IHDR chunk fails its checksum/],
  ["a bad IDAT checksum", withBadChecksum(pngFile(ihdr(), idat(1, 2, 3)), 1), /IDAT chunk fails its checksum/],
  ["a flipped byte in image data", withBadChecksum(pngFile(ihdr(), idat(1, 2, 3)), 5), /IDAT chunk fails its checksum/],
  ["a bad checksum on an ignorable chunk", withBadChecksum(pngFile(ihdr(), chunk("tEXt", 65, 0, 66)), 1), /tEXt chunk fails its checksum/],
  ["image data before IHDR", pngFile(idat(1, 2, 3), ihdr(), iend()), /first chunk is not IHDR/],
  ["an IHDR chunk that is too short", pngFile(chunk("IHDR", 0, 0, 0, 1), idat(1, 2, 3), iend()), /IHDR chunk is 4 bytes/],
  ["two IHDR chunks", pngFile(ihdr(), ihdr(), idat(1, 2, 3), iend()), /more than one IHDR/],
  ["zero width", headerOnly({ width: 0 }), /it is 0x1/],
  ["zero height", headerOnly({ height: 0 }), /it is 1x0/],
  ["more pixels than the limit", headerOnly({ width: 100_000_001 }), /over the limit/],
  ["dimensions that overflow", headerOnly({ width: 2 ** 31, height: 2 ** 31 }), /over the limit/],
  ["an unknown color type", headerOnly({ colorType: 1 }), /color type 1/],
  ["bit depth 3", headerOnly({ bitDepth: 3 }), /bit depth 3/],
  ["bit depth 4 for RGB", headerOnly({ bitDepth: 4 }), /bit depth 4/],
  ["bit depth 16 for a palette", headerOnly({ bitDepth: 16, colorType: PALETTE }), /bit depth 16/],
  ["bit depth 1 for RGBA", headerOnly({ bitDepth: 1, colorType: RGBA }), /bit depth 1/],
  ["bit depth 4 for grayscale with alpha", headerOnly({ bitDepth: 4, colorType: GRAY_ALPHA }), /bit depth 4/],
  ["an unknown compression method", headerOnly({ compression: 1 }), /compression method 1/],
  ["an unknown filter method", headerOnly({ filterMethod: 1 }), /filter method 1/],
  ["an unknown interlace method", headerOnly({ interlace: 2 }), /interlace method 2/],
  ["no image data", pngFile(ihdr(), iend()), /no IDAT/],
  [
    "separated IDAT chunks",
    pngFile(ihdr(), chunkOf("IDAT", new Uint8Array([0x78])), chunk("tEXt", 65, 0, 66), idat(1, 2, 3), iend()),
    /not consecutive/,
  ],
  ["a palette after the image data", pngFile(ihdr(), idat(1, 2, 3), chunk("PLTE", 1, 2, 3), iend()), /PLTE chunk is misplaced/],
  ["two palettes", pngFile(ihdr(), chunk("PLTE", 1, 2, 3), chunk("PLTE", 1, 2, 3), idat(1, 2, 3), iend()), /PLTE chunk is misplaced/],
  ["a palette on grayscale", withHeader({ colorType: GRAY }, chunk("PLTE", 1, 2, 3), idat(1), iend()), /grayscale with a PLTE/],
  ["a palette on grayscale with alpha", withHeader({ colorType: GRAY_ALPHA }, chunk("PLTE", 1, 2, 3), idat(1), iend()), /grayscale with a PLTE/],
  ["an empty palette", pngFile(ihdr(), chunk("PLTE"), idat(1, 2, 3), iend()), /PLTE chunk has an invalid length of 0/],
  ["a palette of partial colors", pngFile(ihdr(), chunk("PLTE", 1, 2), idat(1, 2, 3), iend()), /PLTE chunk has an invalid length of 2/],
  ["a palette over 256 colors", pngFile(ihdr(), chunkOf("PLTE", new Uint8Array(771)), idat(1, 2, 3), iend()), /PLTE chunk has an invalid length of 771/],
  ["a paletted image with no palette", withHeader({ colorType: PALETTE }, idat(1), iend()), /no PLTE/],
  ["a palette index out of range", withHeader({ colorType: PALETTE }, chunk("PLTE", 1, 2, 3), idat(1), iend()), /palette index 1/],
  ["a low-depth palette index out of range", withHeader({ colorType: PALETTE, bitDepth: 2 }, chunk("PLTE", 1, 2, 3), idat(0b1100_0000), iend()), /palette index 3/],
  ["tRNS after the image data", pngFile(ihdr(), idat(1, 2, 3), chunk("tRNS", 0, 0, 0, 0, 0, 0), iend()), /tRNS chunk is misplaced/],
  ["two tRNS chunks", pngFile(ihdr(), chunk("tRNS", 0, 0, 0, 0, 0, 0), chunk("tRNS", 0, 0, 0, 0, 0, 0), idat(1, 2, 3), iend()), /tRNS chunk is misplaced/],
  ["tRNS before the palette", withHeader({ colorType: PALETTE }, chunk("tRNS", 255), chunk("PLTE", 1, 2, 3), idat(0), iend()), /tRNS chunk comes before/],
  ["tRNS longer than the palette", withHeader({ colorType: PALETTE }, chunk("PLTE", 1, 2, 3), chunk("tRNS", 255, 255), idat(0), iend()), /longer than its palette/],
  ["tRNS on RGBA", withHeader({ colorType: RGBA }, chunk("tRNS", 0, 0, 0, 0, 0, 0), idat(1, 2, 3, 255), iend()), /both an alpha channel and a tRNS/],
  ["tRNS on grayscale with alpha", withHeader({ colorType: GRAY_ALPHA }, chunk("tRNS", 0, 0), idat(1, 255), iend()), /both an alpha channel and a tRNS/],
  ["tRNS of the wrong length on RGB", pngFile(ihdr(), chunk("tRNS", 0, 0), idat(1, 2, 3), iend()), /tRNS chunk has an invalid length of 2/],
  ["tRNS of the wrong length on grayscale", withHeader({ colorType: GRAY }, chunk("tRNS", 0, 0, 0, 0, 0, 0), idat(1), iend()), /tRNS chunk has an invalid length of 6/],
  ...["gAMA", "cHRM", "iCCP", "cICP"].map((type): [string, Uint8Array, RegExp] => [
    `a ${type} chunk`,
    pngFile(ihdr(), chunk(type, 0, 0, 0, 1), idat(1, 2, 3), iend()),
    new RegExp(`its ${type} chunk changes how its colors display`),
  ]),
  ...["acTL", "fcTL", "fdAT"].map((type): [string, Uint8Array, RegExp] => [
    `an ${type} chunk`,
    pngFile(ihdr(), chunk(type, 0, 0, 0, 2, 0, 0, 0, 0), idat(1, 2, 3), iend()),
    /animated/,
  ]),
  ["an unknown critical chunk", pngFile(ihdr(), chunk("CrIt", 1), idat(1, 2, 3), iend()), /CrIt chunk is critical/],
  ["an invalid filter type", pngFile(ihdr(), chunkOf("IDAT", scanlinesOf(5, 1, 2, 3)), iend()), /invalid filter type 5/],
  ["too few image bytes", pngFile(ihdr(), chunkOf("IDAT", scanlinesOf(0, 1, 2)), iend()), /inflates to 3 bytes, not 4/],
  ["no image bytes", pngFile(ihdr(), chunkOf("IDAT", scanlinesOf()), iend()), /inflates to 0 bytes, not 4/],
  ["one image byte too many", pngFile(ihdr(), chunkOf("IDAT", scanlinesOf(0, 1, 2, 3, 4)), iend()), /more than the expected 4/],
  ["a megabyte of image data for one pixel", pngFile(ihdr(), chunkOf("IDAT", zlibStored(new Uint8Array(1 << 20))), iend()), /more than the expected 4/],
  ["an interlaced file one byte short", withHeader({ interlace: 1, width: 2 }, chunkOf("IDAT", scanlinesOf(0, 1, 2, 3)), iend()), /inflates to 4 bytes, not 8/],
  ["an empty IDAT", pngFile(ihdr(), chunk("IDAT"), iend()), /image data is corrupt/],
  ["image data that isn't zlib", pngFile(ihdr(), chunk("IDAT", 1, 2, 3, 4, 5, 6), iend()), /image data is corrupt/],
  ["a zlib stream cut short", pngFile(ihdr(), chunkOf("IDAT", scanlinesOf(0, 1, 2, 3).subarray(0, 9)), iend()), /image data is corrupt/],
  ["a zlib stream with a wrong checksum", pngFile(ihdr(), chunkOf("IDAT", zlibStored(new Uint8Array([0, 1, 2, 3]), 12345)), iend()), /image data is corrupt/],
  ["bytes after the zlib stream", pngFile(ihdr(), chunkOf("IDAT", concat(scanlinesOf(0, 1, 2, 3), new Uint8Array([7]))), iend()), /image data is corrupt/],
];

/** Fixtures, with sizes and image hashes as sharp 0.35.5 decodes them, not this decoder. */
const FIXTURES: readonly (readonly [string, number, number, string])[] = [
  ["chromium-header-icon.png", 1200, 900, "64510f4f00686b829f6a4ec51edfb126d08c407a8422e7d453e5d6b5bb37c0b5"],
  ["chromium-update-banner.png", 1200, 900, "24c5c371fd3c5bddca4d968b613dfd5e0c3efb6dca7b893e7c8bebb762d13559"],
  ["pngsuite/basi0g01.png", 32, 32, "4873ca781ee026096717d9eb6644843fdb46b019d1282765d8664861c06bb900"],
  ["pngsuite/basi0g02.png", 32, 32, "e653614e22f6cf899f3bfca0649e2e0952a01c294d6c4e1dcfed4fd7318af2b5"],
  ["pngsuite/basi0g04.png", 32, 32, "521e11b555a4cc6850069c54f6e652c99966678ec9802ac33210c09d6115aea2"],
  ["pngsuite/basi0g08.png", 32, 32, "058ae7e364884cc5c84ff417c0f8bb3dadc017b87136d623286ceed2ed66c866"],
  ["pngsuite/basi2c08.png", 32, 32, "6c5282e6d6159c3b654fecb9e22e6bca88ec41c0b0b752521566ee79d68049aa"],
  ["pngsuite/basi3p01.png", 32, 32, "ad5347967f67dcc91a67e3aea0f9e956d9fc04baaf837dee1d854e1899931b23"],
  ["pngsuite/basi3p02.png", 32, 32, "d03be433f62e0bcdc47485243508dcfd04231d86df314002673870e2df37764b"],
  ["pngsuite/basi3p04.png", 32, 32, "ea0b884c0d86a598057dbb81858564c641845033a404baa5aaa35880484957b3"],
  ["pngsuite/basi3p08.png", 32, 32, "617d9f6909135f0deda53c71bdd843a813df534645c699130175bf3532dfcb53"],
  ["pngsuite/basn0g01.png", 32, 32, "4873ca781ee026096717d9eb6644843fdb46b019d1282765d8664861c06bb900"],
  ["pngsuite/basn0g02.png", 32, 32, "e653614e22f6cf899f3bfca0649e2e0952a01c294d6c4e1dcfed4fd7318af2b5"],
  ["pngsuite/basn0g04.png", 32, 32, "521e11b555a4cc6850069c54f6e652c99966678ec9802ac33210c09d6115aea2"],
  ["pngsuite/basn0g08.png", 32, 32, "058ae7e364884cc5c84ff417c0f8bb3dadc017b87136d623286ceed2ed66c866"],
  ["pngsuite/basn2c08.png", 32, 32, "6c5282e6d6159c3b654fecb9e22e6bca88ec41c0b0b752521566ee79d68049aa"],
  ["pngsuite/basn3p01.png", 32, 32, "ad5347967f67dcc91a67e3aea0f9e956d9fc04baaf837dee1d854e1899931b23"],
  ["pngsuite/basn3p08.png", 32, 32, "617d9f6909135f0deda53c71bdd843a813df534645c699130175bf3532dfcb53"],
  ["pngsuite/f00n2c08.png", 32, 32, "ca6f9679f384eae5399f99503dee8069ceba3006e72fcb72f21faf64e05e0fd5"],
  ["pngsuite/f01n2c08.png", 32, 32, "f0af937d9674bfd107b4dccbfc7a39519fb4fde2eec5159ccd72bba2b4540577"],
  ["pngsuite/f02n2c08.png", 32, 32, "064d4ae2a921c63f643fb4c007396cf95192f6b7effe5de8d92a82ea0ad1d9f2"],
  ["pngsuite/f03n2c08.png", 32, 32, "fc4b8c94a33c7d2162fad29308f978d3cad608f144e91ad9703d3f9b4bb146cf"],
  ["pngsuite/f04n2c08.png", 32, 32, "1edf4359dfff910f39b9b19bed7171c4a4132c23d72bab3d16f1170f89d66144"],
  ["pngsuite/s01i3p01.png", 1, 1, "ed3fea0d297004790c413132e71ffef06cf8183ad84ee8ebb6aab5f435a8b6a6"],
  ["pngsuite/s02i3p01.png", 2, 2, "0ee7d87333214af71e6eef6d13f20b66ac76fabc028ab6261f647c1bd1e768df"],
  ["pngsuite/s03i3p01.png", 3, 3, "85762e7ec5f86ea5d825eb1569a86016097bdbda77959dfcfb5174bf502b7e39"],
  ["pngsuite/s05i3p02.png", 5, 5, "29683c0391290134f79a9b8347bd4739f796f101b464a63cd53868271868594f"],
  ["pngsuite/s07i3p02.png", 7, 7, "f50bf1189409e1a5c3ae857e3d6ef87164864afc842133df56749bebc86ac577"],
  ["pngsuite/s09i3p02.png", 9, 9, "1ca69026d24ed6c5ffa5c32abce66b957e7f42a210f0c9554dd4c8018d37f9ec"],
  ["pngsuite/z00n2c08.png", 32, 32, "2ffb3287b1288ad083a6260def3bcb039b6955d8eb2e2e948dfbaf96289c0f46"],
  ["pngsuite/z09n2c08.png", 32, 32, "2ffb3287b1288ad083a6260def3bcb039b6955d8eb2e2e948dfbaf96289c0f46"],
];

/** Fixture files by their path under `test/fixtures/png`, which each runtime loads its own way. */
export type PngFixtures = (name: string) => Uint8Array;

/** Run this in each runtime the store core must work in. */
export function describePngContract(runtime: string, fixture: PngFixtures): void {
  describe(`PNG contract: ${runtime}`, () => {
    describe("normalizing", () => {
      it.each(COLOR_ENCODINGS)("decodes %s to the exact pixels", async (_, spec) => {
        expect(await decodePng(buildPng(spec))).toEqual(COLOR);
      });

      it.each(BLACK_AND_WHITE_ENCODINGS)("decodes %s to the exact pixels", async (_, spec) => {
        expect(await decodePng(buildPng(spec))).toEqual(BLACK_AND_WHITE);
      });

      it.each(BLACK_AND_WHITE_ENCODINGS)("decodes interlaced %s to the exact pixels", async (_, spec) => {
        expect(await decodePng(buildPng({ ...spec, interlaced: true }))).toEqual(BLACK_AND_WHITE);
      });

      it.each(GRAY_LEVELS)("scales %i-bit grayscale to fill the 8-bit range", async (bitDepth, levels) => {
        const png = buildPng({
          width: levels.length,
          height: 1,
          colorType: GRAY,
          bitDepth,
          sample: (x) => [x],
        });
        const { pixels } = await decodePng(png);
        expect([...pixels]).toEqual(levels.flatMap((level) => [level, level, level]));
      });

      it("keeps the bits of a low-depth row that doesn't fill its last byte", async () => {
        const png = buildPng({ width: 3, height: 2, colorType: GRAY, bitDepth: 1, sample: (x, y) => [(x + y) % 2] });
        const { pixels } = await decodePng(png);
        expect([...pixels].filter((_, i) => i % 3 === 0)).toEqual([0, 255, 0, 255, 0, 255]);
      });

      it("gives every size the same pixels interlaced or not, including empty passes", async () => {
        for (const bitDepth of [1, 8]) {
          for (let width = 1; width <= 9; width++) {
            for (let height = 1; height <= 9; height++) {
              const spec: PngSpec = {
                width,
                height,
                colorType: GRAY,
                bitDepth,
                sample: (x, y) => [(x * 3 + y * 5) % 2],
              };
              const interlaced = await decodePng(buildPng({ ...spec, interlaced: true }));
              expect(interlaced).toEqual(await decodePng(buildPng(spec)));
            }
          }
        }
      });

      it("reads a file from any view of its bytes", async () => {
        const png = buildPng(asRgb8);
        const padded = new Uint8Array(png.length + 10);
        padded.set(png, 5);
        expect(await decodePng(padded.subarray(5, 5 + png.length))).toEqual(COLOR);
      });
    });

    describe("one hash for one set of pixels", () => {
      it("gives every encoding of a picture the same hash", async () => {
        const hashes = new Set<string>();
        for (const [, spec] of COLOR_ENCODINGS) hashes.add(await hashOf(await decodePng(buildPng(spec))));
        hashes.add(await hashOf(await decodePng(await encodePng(COLOR))));
        expect([...hashes]).toEqual([await hashOf(COLOR)]);
      });

      it("gives every color type and depth of a picture the same hash", async () => {
        const hashes = new Set<string>();
        for (const [, spec] of BLACK_AND_WHITE_ENCODINGS) {
          hashes.add(await hashOf(await decodePng(buildPng(spec))));
          hashes.add(await hashOf(await decodePng(buildPng({ ...spec, interlaced: true }))));
        }
        expect([...hashes]).toEqual([await hashOf(BLACK_AND_WHITE)]);
      });

      it("hashes the same pixels the same however the file was compressed", async () => {
        const raw = await decodePng(fixture("chromium-update-banner.png"));
        const reencoded = await encodePng(raw);
        expect(reencoded).not.toEqual(fixture("chromium-update-banner.png"));
        expect(await hashOf(await decodePng(reencoded))).toBe(await hashOf(raw));
      });

      it("gives a different hash when one pixel differs", async () => {
        const changed = { ...asRgb8, sample: (x: number, y: number) => (x === 8 && y === 6 ? [1, 2, 3] : color(x, y)) };
        expect(await hashOf(await decodePng(buildPng(changed)))).not.toBe(await hashOf(COLOR));
      });
    });

    describe("fixtures", () => {
      // The suite's files state a gamma, which is refused, so their samples are tested
      // without it. A single refused file is tested as it was distributed.
      it.each(FIXTURES)("decodes %s to the pixels sharp found", async (name, width, height, hash) => {
        const image = await decodePng(withoutChunks(fixture(name), "gAMA"));
        expect({ width: image.width, height: image.height }).toEqual({ width, height });
        expect(await hashOf(image)).toBe(hash);
      });

      it("refuses a suite file for its gamma as distributed", async () => {
        await expect(decodePng(fixture("pngsuite/basn2c08.png"))).rejects.toThrow(/gAMA chunk/);
      });

      it("gives the suite's interlaced and plain forms of a picture one hash", async () => {
        const pixelsOf = (name: string) => decodePng(withoutChunks(fixture(name), "gAMA"));
        for (const form of ["0g01", "0g02", "0g04", "0g08", "2c08", "3p01", "3p08"]) {
          expect(await pixelsOf(`pngsuite/basi${form}.png`)).toEqual(await pixelsOf(`pngsuite/basn${form}.png`));
        }
      });
    });

    describe("round trips", () => {
      const noise = (length: number) => {
        // A fixed sequence, so a failure repeats. It defeats compression, unlike a gradient.
        const pixels = new Uint8Array(length);
        let state = 12345;
        for (let i = 0; i < length; i++) {
          state = (state * 1103515245 + 12345) & 0x7fffffff;
          pixels[i] = state >>> 16;
        }
        return pixels;
      };

      it.each([
        [1, 1],
        [1, 40],
        [40, 1],
        [2, 2],
        [17, 13],
        [300, 200],
      ])("returns the exact pixels of noise at %i×%i", async (width, height) => {
        const image = { width, height, pixels: noise(width * height * 3) };
        expect(await decodePng(await encodePng(image))).toEqual(image);
      });

      it("returns every byte value exactly", async () => {
        const pixels = Uint8Array.from({ length: 768 }, (_, i) => i % 256);
        const image = { width: 256, height: 1, pixels };
        expect(await decodePng(await encodePng(image))).toEqual(image);
      });

      it("returns a real screenshot's exact pixels", async () => {
        const image = await decodePng(fixture("chromium-header-icon.png"));
        expect(await decodePng(await encodePng(image))).toEqual(image);
      });

      it("reads pixels from any view of their bytes", async () => {
        const padded = new Uint8Array([9, 9, 1, 2, 3, 9]);
        const image = { width: 1, height: 1, pixels: padded.subarray(2, 5) };
        expect((await decodePng(await encodePng(image))).pixels).toEqual(new Uint8Array([1, 2, 3]));
      });

      it("writes 8-bit RGB, not interlaced", async () => {
        const png = await encodePng(COLOR);
        expect([...png.subarray(24, 29)]).toEqual([8, RGB, 0, 0, 0]);
        expect(imageMediaType(png)).toBe("image/png");
      });

      it.each([
        [0, 1, 0],
        [1, 0, 0],
        [1.5, 2, 9],
        [1, 1, 2],
        [1, 1, 4],
      ])("refuses to encode a %s×%s image of %s bytes", async (width, height, length) => {
        await expect(encodePng({ width, height, pixels: new Uint8Array(length) })).rejects.toThrow(RangeError);
      });

      it("refuses to encode what it would then refuse to decode", async () => {
        // Sized by a stand-in, since the point is not to allocate these bytes.
        const width = 100_000_001;
        const pixels = { length: width * 3 } as unknown as Uint8Array;
        await expect(encodePng({ width, height: 1, pixels })).rejects.toThrow(/over the limit/);
      });
    });

    describe("media type", () => {
      it("reads a stored file's format from its bytes", () => {
        expect(imageMediaType(VALID)).toBe("image/png");
      });

      it.each([
        ["nothing", new Uint8Array(0)],
        ["a PAM file", encodePam(COLOR)],
      ])("refuses %s", (_, bytes) => {
        expect(() => imageMediaType(bytes)).toThrow(RangeError);
      });
    });

    describe("refusals", () => {
      it("accepts the base file the refusal cases are built on", async () => {
        expect(await decodePng(VALID)).toEqual({ width: 1, height: 1, pixels: new Uint8Array([1, 2, 3]) });
      });

      it.each(TRANSPARENCY)("refuses transparency: %s", async (_, png) => {
        const error = await decodePng(png).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ImageDecodeError);
        expect((error as ImageDecodeError).message).toMatch(/has alpha \d+\. Selfie handles only fully opaque/);
      });

      it("names the transparent pixel", async () => {
        await expect(decodePng(rgbaWith(7))).rejects.toThrow("pixel (1, 1) has alpha 7");
      });

      it.each(INEXACT_SAMPLES)("refuses a sample with no exact 8-bit value: %s", async (_, png) => {
        const error = await decodePng(png).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ImageDecodeError);
        expect((error as ImageDecodeError).message).toMatch(/16-bit sample 0x[0-9a-f]{4} has no exact 8-bit value/);
      });

      it.each(MALFORMED)("refuses %s", async (_, png, message) => {
        const error = await decodePng(png).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ImageDecodeError);
        expect((error as ImageDecodeError).message).toMatch(message);
      });
    });
  });
}
