import sharp from "sharp";
import type { ImageCodec } from "../core/index.ts";

/**
 * PNG and lossless WebP through `sharp`, for Node. It's native, so a Worker doesn't decode.
 * No pixel limit here, since `checkImageFile` has already applied its own.
 */
export const sharpCodec: ImageCodec = {
  async decode(file) {
    const { data, info } = await sharp(file, { limitInputPixels: false }).raw().toBuffer({ resolveWithObject: true });
    return {
      width: info.width,
      height: info.height,
      pixels: new Uint8Array(data.buffer, data.byteOffset, data.length),
    };
  },
  async encodeWebp({ width, height, pixels }) {
    const raw = { width, height, channels: 3 } as const;
    const file = await sharp(pixels, { raw, limitInputPixels: false }).webp({ lossless: true, effort: 4 }).toBuffer();
    return new Uint8Array(file.buffer, file.byteOffset, file.length);
  },
};
