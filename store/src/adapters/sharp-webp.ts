import sharp from "sharp";
import type { WebpCodec } from "../core/index.ts";

/**
 * Lossless WebP through `sharp`, for Node. It's native, so a Worker needs a different
 * codec. No pixel limit here, since `decodeImage` has already applied its own.
 */
export const sharpWebp: WebpCodec = {
  async encode({ width, height, pixels }) {
    const raw = { width, height, channels: 3 } as const;
    const file = await sharp(pixels, { raw, limitInputPixels: false }).webp({ lossless: true, effort: 4 }).toBuffer();
    return new Uint8Array(file.buffer, file.byteOffset, file.length);
  },
  async decode(file) {
    const { data, info } = await sharp(file, { limitInputPixels: false }).raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) throw new Error(`It has ${info.channels} channels rather than RGB`);
    return { width: info.width, height: info.height, pixels: new Uint8Array(data.buffer, data.byteOffset, data.length) };
  },
};
