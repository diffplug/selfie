export interface RawImage {
  readonly width: number;
  readonly height: number;
  /** Decoded RGB, 8 bits per channel, row by row: width × height × 3 bytes. Images have no alpha. */
  readonly pixels: Uint8Array;
}

const BYTES_PER_PIXEL = 3;

export function assertRawImage({ width, height, pixels }: RawImage): void {
  for (const [name, value] of [["width", width], ["height", height]] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`Image ${name} must be a positive integer, got ${value}`);
    }
  }
  const expected = width * height * BYTES_PER_PIXEL;
  if (pixels.length !== expected) {
    throw new RangeError(
      `A ${width}x${height} RGB image has ${expected} bytes of pixels, got ${pixels.length}`,
    );
  }
}

/**
 * Encodes pixels as the one canonical PAM file for them. The image hash covers
 * these exact bytes, so changing a single header byte changes every image hash.
 */
export function encodePam(image: RawImage): Uint8Array<ArrayBuffer> {
  assertRawImage(image);
  const { width, height, pixels } = image;
  const header = new TextEncoder().encode(
    `P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH ${BYTES_PER_PIXEL}\nMAXVAL 255\nTUPLTYPE RGB\nENDHDR\n`,
  );
  const pam = new Uint8Array(header.length + pixels.length);
  pam.set(header);
  pam.set(pixels, header.length);
  return pam;
}
