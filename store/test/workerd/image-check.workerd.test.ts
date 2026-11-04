// Batches inside workerd, since a Worker checks a file's form and stores it without decoding it.

import { afterEach, describe, expect, it } from "vitest";
import { R2BlobStorage } from "selfie-store/adapters/r2";
import { Blobs, ImageDecodeError, ReceivingStore, Sql } from "../../src/core/index.ts";
import { describeImageCheckContract } from "../contract/image-check-contract.ts";
import { idat, iend, ihdr, pngFile } from "../support/png-builder.ts";
import { bucket, emptyBucket } from "./bucket.ts";

describeImageCheckContract("workerd");

describe("ReceivingStore over the R2 binding", () => {
  afterEach(() => emptyBucket());

  // Answers every statement with one row, since SQL isn't what this tests. The row
  // names no hash, so a lookup finds nothing.
  const sql = new Sql({ execute: async (statements) => statements.map(() => [{ key: 1 }]) });
  const store = new ReceivingStore({ sql, blob: new Blobs(new R2BlobStorage({ bucket, project: "alpha" })) });
  const hash = "a".repeat(64);
  const png = pngFile(ihdr(), idat(1, 2, 3), iend());

  it("keeps a file's own bytes under the hash it was sent with", async () => {
    expect(await store.receiveImage(png, hash)).toEqual({ hash, key: 1 });
    expect(await bucket.head(`projects/alpha/images/${hash}`)).not.toBeNull();
  });

  it("refuses a file no store keeps", async () => {
    await expect(store.receiveImage(new Uint8Array([1, 2, 3]), hash)).rejects.toBeInstanceOf(ImageDecodeError);
  });
});
