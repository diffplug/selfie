// What batch views keep between requests: in a Worker, a request waiting on a read another request
// started waits forever if that one is canceled, so only what's been read is ever shared.
import type { BuiltStorybooks, RenderBatches } from "selfie-store";
import { expect, test } from "vitest";
import { batchViews } from "../src/server/batch-view.ts";

const INDEX = new TextEncoder().encode(JSON.stringify({ entries: { "a--b": { type: "story", id: "a--b", title: "A", name: "B" } } }));

function viewsReading(reads: (() => Promise<Uint8Array | null>)[]) {
  let calls = 0;
  const storybooks = { readFile: () => reads[calls++]!() } as unknown as BuiltStorybooks;
  const views = batchViews({
    batches: {} as RenderBatches,
    storybooks,
    keptStorybookUrl: async () => null,
    storybookFor: async () => null,
    pixelDiffs: async () => new Map(),
    hunkMergeDistance: async () => 12,
  });
  return { views, calls: () => calls };
}

test("never waits on another look's read of a kept Storybook's stories", async () => {
  const { views, calls } = viewsReading([() => new Promise(() => undefined), async () => INDEX]);
  void views.storiesOfKept("h");
  expect(await views.storiesOfKept("h")).toEqual([{ id: "a--b", title: "A", name: "B" }]);
  expect(calls()).toBe(2);
});

test("keeps what it read, and nothing from a read that failed", async () => {
  const { views, calls } = viewsReading([
    async () => {
      throw new Error("R2 is down");
    },
    async () => INDEX,
  ]);
  expect(await views.storiesOfKept("h")).toEqual([]);
  expect(await views.storiesOfKept("h")).toHaveLength(1);
  expect(await views.storiesOfKept("h")).toHaveLength(1);
  expect(calls()).toBe(2);
});
