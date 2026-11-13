import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sha256OfGzipped, TooLargeError } from "../src/server/gzipped-hash.ts";

describe("sha256OfGzipped", () => {
  it("hashes what gzip holds, not the gzip", async () => {
    const bytes = new TextEncoder().encode("export const story = 1;\n".repeat(10_000));
    expect(await sha256OfGzipped(gzipSync(bytes), bytes.length)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("stops at the limit, however small what was sent", async () => {
    const bomb = gzipSync(new Uint8Array(8 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(16 * 1024);
    await expect(sha256OfGzipped(bomb, 1024 * 1024)).rejects.toThrow(TooLargeError);
  });

  it("refuses what isn't gzip", async () => {
    await expect(sha256OfGzipped(new TextEncoder().encode("<html>story</html>"), 1024)).rejects.toThrow(RangeError);
  });
});
