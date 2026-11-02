export interface RawImage {
  readonly width: number;
  readonly height: number;
  /** Decoded RGBA, 8 bits per channel, row by row: width × height × 4 bytes. */
  readonly pixels: Uint8Array;
}

const RGBA_BYTES = 4;
const RGB_BYTES = 3;

/**
 * Encodes pixels as the one canonical PAM file for them: RGB if every pixel is fully
 * opaque, or else RGBA. The image hash covers these exact bytes, so changing a single
 * header byte changes every image hash.
 */
export function encodePam({ width, height, pixels }: RawImage): Uint8Array<ArrayBuffer> {
  for (const [name, value] of [["width", width], ["height", height]] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`Image ${name} must be a positive integer, got ${value}`);
    }
  }
  const expected = width * height * RGBA_BYTES;
  if (pixels.length !== expected) {
    throw new RangeError(
      `A ${width}x${height} RGBA image has ${expected} bytes of pixels, got ${pixels.length}`,
    );
  }
  const opaque = isOpaque(pixels);
  const [depth, tupleType] = opaque ? [RGB_BYTES, "RGB"] : [RGBA_BYTES, "RGB_ALPHA"];
  const header = new TextEncoder().encode(
    `P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH ${depth}\nMAXVAL 255\nTUPLTYPE ${tupleType}\nENDHDR\n`,
  );
  const pam = new Uint8Array(header.length + width * height * depth);
  pam.set(header);
  if (opaque) {
    let out = header.length;
    for (let i = 0; i < pixels.length; i += RGBA_BYTES) {
      pam[out++] = pixels[i]!;
      pam[out++] = pixels[i + 1]!;
      pam[out++] = pixels[i + 2]!;
    }
  } else {
    pam.set(pixels, header.length);
  }
  return pam;
}

function isOpaque(pixels: Uint8Array): boolean {
  for (let i = 3; i < pixels.length; i += RGBA_BYTES) {
    if (pixels[i] !== 255) return false;
  }
  return true;
}
