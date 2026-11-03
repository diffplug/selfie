/** Splits items into groups of at most `size`, in order. */
export function chunks<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

/**
 * Runs `work` on each item, at most `limit` at a time, and returns the results in order. After one
 * fails, nothing new starts, though what's already running finishes.
 */
export async function mapConcurrently<Item, Result>(
  items: readonly Item[],
  limit: number,
  work: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = new Array(items.length);
  let next = 0;
  let failed = false;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && !failed) {
        const at = next;
        next += 1;
        try {
          results[at] = await work(items[at]!);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    }),
  );
  return results;
}
