import { sharpCodec } from "../../src/adapters/sharp-codec.ts";
import { decodeImage as decodeWith, type RawImage } from "../../src/core/index.ts";

/** Decoding as a client does, for tests that only need the pixels. */
export const decodeImage = (file: Uint8Array): Promise<RawImage> => decodeWith(file, sharpCodec);
