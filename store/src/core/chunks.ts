// The most statements in one request, as `docs/specs/renders.md` -> Requests says. It holds 19,600 renders, so a batch of up to that many costs one.
export const STATEMENTS_PER_REQUEST = 400;

/** Splits items into groups of at most `size`, in order. */
export function chunks<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

/**
 * Runs `work` on each item, at most `limit` at a time, and returns the results in order. After one
 * fails, nothing new starts, and it throws that first failure once what's already running has
 * finished, so nothing is still going on behind a failed call.
 */
export async function mapConcurrently<Item, Result>(
  items: readonly Item[],
  limit: number,
  work: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = new Array(items.length);
  let next = 0;
  let failure: { readonly error: unknown } | null = null;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && failure === null) {
        const at = next;
        next += 1;
        try {
          results[at] = await work(items[at]!);
        } catch (error) {
          failure ??= { error };
        }
      }
    }),
  );
  if (failure !== null) throw (failure as { readonly error: unknown }).error;
  return results;
}
