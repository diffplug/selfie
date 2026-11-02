// Runs inside workerd against its local R2 binding. Nothing here crosses to Node.

import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { R2BlobStorage, type R2BucketLike } from "selfie-store/adapters/r2";
import { describeBlobContract } from "../contract/blob-contract.ts";

const bucket = env.BLOBS;

async function objectKeys(prefix = "projects/"): Promise<string[]> {
  const { objects } = await bucket.list({ prefix });
  return objects.map((object) => object.key);
}

async function emptyBucket(prefix = "projects/"): Promise<void> {
  const keys = await objectKeys(prefix);
  if (keys.length > 0) await bucket.delete(keys);
}

describeBlobContract("R2 in workerd", async () => {
  const project = `contract-${crypto.randomUUID()}`;
  return {
    open: async () => new R2BlobStorage({ bucket, project }),
    destroy: () => emptyBucket(`projects/${project}/`),
  };
});

describe("the runtime these tests run in", () => {
  it("is workerd, with a real R2 binding", () => {
    expect(navigator.userAgent).toBe("Cloudflare-Workers");
    expect(typeof WebSocketPair).toBe("function");
    expect(bucket.constructor.name).toBe("R2Bucket");
  });
});

describe("R2BlobStorage", () => {
  afterEach(() => emptyBucket());

  const storageFor = (project: string) => new R2BlobStorage({ bucket, project });
  const bytes = new Uint8Array([1, 2, 3]);

  describe("project isolation", () => {
    it("keys each object by project and blob key", async () => {
      await storageFor("alpha").put("images/abc", bytes);
      expect(await objectKeys()).toEqual(["projects/alpha/images/abc"]);
    });

    it("gives each project its own object for the same image", async () => {
      await storageFor("alpha").put("images/abc", bytes);
      await storageFor("beta").put("images/abc", new Uint8Array([9]));
      expect(await objectKeys()).toEqual(["projects/alpha/images/abc", "projects/beta/images/abc"]);
      expect(await storageFor("alpha").get("images/abc")).toEqual(bytes);
      expect(await storageFor("beta").get("images/abc")).toEqual(new Uint8Array([9]));
    });

    it("doesn't show one project's objects to another", async () => {
      await storageFor("alpha").put("images/abc", bytes);
      // Including projects whose names start with or extend this one's.
      for (const project of ["beta", "alph", "alpha-2", "alpha.images"]) {
        expect(await storageFor(project).has("images/abc")).toBe(false);
        expect(await storageFor(project).get("images/abc")).toBeNull();
      }
    });

    it("keeps a key that names another project inside its own project", async () => {
      await storageFor("beta").put("images/abc", bytes);
      const attacker = storageFor("alpha");
      for (const key of ["beta/images/abc", "projects/beta/images/abc"]) {
        expect(await attacker.has(key)).toBe(false);
        expect(await attacker.get(key)).toBeNull();
      }
      await attacker.put("beta/images/abc", new Uint8Array([9]));
      expect(await objectKeys()).toEqual([
        "projects/alpha/beta/images/abc",
        "projects/beta/images/abc",
      ]);
      expect(await storageFor("beta").get("images/abc")).toEqual(bytes);
    });

    it.each(["../beta/images/abc", "images/../../beta/images/abc", "./images/abc", "%2e%2e/beta/images/abc"])(
      "refuses the climbing key %j on every operation",
      async (key) => {
        const attacker = storageFor("alpha");
        await expect(attacker.put(key, bytes)).rejects.toThrow(RangeError);
        await expect(attacker.get(key)).rejects.toThrow(RangeError);
        await expect(attacker.has(key)).rejects.toThrow(RangeError);
        expect(await objectKeys()).toEqual([]);
      },
    );

    it.each([
      "",
      ".",
      "..",
      "../beta",
      "alpha/beta",
      "alpha/",
      "/alpha",
      "alpha\\beta",
      "alpha%2fbeta",
      "Alpha",
      "alpha\n",
      ".hidden",
      "-alpha",
      "alpha beta",
      "alphа", // The last letter is Cyrillic.
    ])("refuses the project %j", (project) => {
      expect(() => storageFor(project)).toThrow(RangeError);
    });

    // Each would pass the pattern if coerced to a string.
    it.each([undefined, null, 7, ["alpha"]])("refuses the non-string project %j", (project) => {
      expect(() => storageFor(project as unknown as string)).toThrow(RangeError);
    });

    it("accepts the identifier forms a project could have", async () => {
      for (const project of ["alpha", "a", "7", "my-repo_2.0", "d4872de7-902a-4ce4-bace-a0c8fe0131f9"]) {
        await storageFor(project).put("images/abc", bytes);
        expect(await objectKeys(`projects/${project}/`)).toEqual([`projects/${project}/images/abc`]);
      }
    });
  });

  // Local R2 doesn't enforce R2's limit of one write per second per key, so these
  // raise the error its docs describe over the real binding.
  describe("when R2 limits writes to a key", () => {
    const rateLimited = () => new Error("put: Reduce your concurrent request rate. (10058)");
    const key = "images/abc";
    const objectKey = `projects/alpha/${key}`;

    function setup(failures: number, error: () => Error = rateLimited) {
      const delays: number[] = [];
      let puts = 0;
      const limited: R2BucketLike = {
        put: async (name, value) => {
          if (++puts <= failures) throw error();
          return bucket.put(name, value);
        },
        get: (name) => bucket.get(name),
        head: (name) => bucket.head(name),
      };
      const storage = new R2BlobStorage({
        bucket: limited,
        project: "alpha",
        sleep: async (ms) => {
          delays.push(ms);
        },
      });
      return { storage, delays, puts: () => puts };
    }

    it("is done without resending if another writer's blob is there", async () => {
      const { storage, delays, puts } = setup(1);
      await bucket.put(objectKey, bytes);
      await storage.put(key, bytes);
      expect({ puts: puts(), delays }).toEqual({ puts: 1, delays: [] });
    });

    it("resends after a doubling wait while no blob is there", async () => {
      const { storage, delays, puts } = setup(2);
      await storage.put(key, bytes);
      expect(puts()).toBe(3);
      expect(delays).toHaveLength(2);
      expect(delays[0]).toBeGreaterThanOrEqual(500);
      expect(delays[0]).toBeLessThanOrEqual(1000);
      expect(delays[1]).toBeGreaterThanOrEqual(1000);
      expect(delays[1]).toBeLessThanOrEqual(2000);
      expect(await storage.get(key)).toEqual(bytes);
    });

    it("waits on the runtime's own timers by default", async () => {
      let puts = 0;
      const storage = new R2BlobStorage({
        bucket: {
          put: async (name, value) => {
            if (++puts === 1) throw rateLimited();
            return bucket.put(name, value);
          },
          get: (name) => bucket.get(name),
          head: (name) => bucket.head(name),
        },
        project: "alpha",
        retry: { baseDelayMs: 1 },
      });
      await storage.put(key, bytes);
      expect(puts).toBe(2);
    });

    it("gives up after its attempts with R2's error", async () => {
      const { storage, puts } = setup(Infinity);
      await expect(storage.put(key, bytes)).rejects.toThrow("(10058)");
      expect(puts()).toBe(4);
      expect(await storage.has(key)).toBe(false);
    });

    it("doesn't resend on any other error", async () => {
      const { storage, delays, puts } = setup(1, () => new Error("put: Internal error. (10001)"));
      await expect(storage.put(key, bytes)).rejects.toThrow("(10001)");
      expect({ puts: puts(), delays }).toEqual({ puts: 1, delays: [] });
    });
  });

  it("fails rather than truncates a key longer than R2's 1,024 bytes", async () => {
    const storage = storageFor("a".repeat(1100));
    await expect(storage.put("images/abc", bytes)).rejects.toThrow("(10020)");
    await expect(storage.get("images/abc")).rejects.toThrow("(10020)");
    await expect(storage.has("images/abc")).rejects.toThrow("(10020)");
    expect(await objectKeys()).toEqual([]);
  });
});
