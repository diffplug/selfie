// Runs inside workerd, since `Store` decodes there and inflating is the platform's own.

import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { R2BlobStorage } from "selfie-store/adapters/r2";
import { Blobs, Sql, Store } from "../../src/core/index.ts";
import { describePngContract } from "../contract/png-contract.ts";
import { bucket, emptyBucket } from "./bucket.ts";

function fixture(name: string): Uint8Array {
  const base64 = env.PNG_FIXTURES[name];
  if (base64 === undefined) throw new Error(`No fixture named ${name}`);
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

describePngContract("workerd", fixture);

describe("Store with image files over the R2 binding", () => {
  afterEach(() => emptyBucket());

  // Answers every statement with one row, since SQL isn't what this tests. The row
  // names no hash, so a lookup finds nothing.
  const sql = new Sql({ execute: async (statements) => statements.map(() => [{ key: 1 }]) });
  const store = new Store({ sql, blob: new Blobs(new R2BlobStorage({ bucket, project: "alpha" })) });

  it("serves a screenshot's own bytes, which decode to what was hashed", async () => {
    const png = fixture("chromium-update-banner.png");
    const { hash } = await store.putImage(png);
    expect(hash).toBe("24c5c371fd3c5bddca4d968b613dfd5e0c3efb6dca7b893e7c8bebb762d13559");
    expect(await store.getImage(hash)).toEqual(png);
  });
});
