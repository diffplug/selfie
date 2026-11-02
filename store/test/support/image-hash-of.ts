import { encodePam, sha256, toHex, type RawImage } from "../../src/core/index.ts";

/** The real image hash of decoded pixels, as lowercase hex. */
export const imageHashOf = async (image: RawImage): Promise<string> =>
  toHex(await sha256(encodePam(image)));
