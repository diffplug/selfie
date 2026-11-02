// Puts one large blob, as a separate process for a test to kill mid-write.
// Arguments: root directory, key, size in bytes.

import { FilesystemBlobStorage } from "../../src/adapters/filesystem-blob.ts";

const [root, key, size] = process.argv.slice(2) as [string, string, string];
await new FilesystemBlobStorage(root).put(key, new Uint8Array(Number(size)).fill(7));
