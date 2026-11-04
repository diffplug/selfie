import { CONTRACT_DATABASE_ID, loadD1Credentials } from "./d1-credentials.ts";
import { createD1Harness, type D1Harness } from "./d1-harness.ts";

// The SQL contract sends about 400 requests against Cloudflare's 1,200 per 5 minutes.
const DEFAULT_BUDGET = 600;

let shared: Promise<D1Harness> | undefined;

/** The one harness of this process, so its budget, set by the first call, covers the whole batch. */
export function d1Harness(budget = DEFAULT_BUDGET): Promise<D1Harness> {
  shared ??= loadD1Credentials().then(({ accountId, token }) =>
    createD1Harness({ accountId, token, databaseId: CONTRACT_DATABASE_ID, budget }),
  );
  return shared;
}
