// The one PNG encoder Selfie's own code uses, for diff images. It lives here because the store
// must never encode (`docs/specs/store.md` -> Storage): diff images never enter a store.
import { promisify } from "node:util";
import { crc32, deflate } from "node:zlib";
import type { RawImage } from "selfie-store";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const BIT_DEPTH = 8;
const COLOR_TYPE_RGB = 2;
// Diff images are mostly flat and are thrown away within a few runs, so speed wins.
const DEFLATE_LEVEL = 3;

const deflateAsync = promisify(deflate);

function chunk(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length);
  header.write(type, 4, "latin1");
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body, crc32(header.subarray(4))));
  return Buffer.concat([header, body, checksum]);
}

/** An 8-bit RGB PNG of these pixels, in the narrow form `decodeImage` accepts. */
export async function encodePng({ width, height, pixels }: RawImage): Promise<Uint8Array> {
  const rowBytes = width * 3;
  const scanlines = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    // The leading zero byte of each row is filter type None.
    scanlines.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = BIT_DEPTH;
  header[9] = COLOR_TYPE_RGB;
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", await deflateAsync(scanlines, { level: DEFLATE_LEVEL })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
