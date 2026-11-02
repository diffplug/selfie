import { env } from "cloudflare:workers";

export const bucket = env.BLOBS;

export async function objectKeys(prefix = "projects/"): Promise<string[]> {
  const { objects } = await bucket.list({ prefix });
  return objects.map((object) => object.key);
}

export async function emptyBucket(prefix = "projects/"): Promise<void> {
  const keys = await objectKeys(prefix);
  if (keys.length > 0) await bucket.delete(keys);
}
