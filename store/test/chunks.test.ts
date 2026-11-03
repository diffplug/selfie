import { describe, expect, it } from "vitest";
import { mapConcurrently } from "../src/core/index.ts";

describe("mapConcurrently", () => {
  it("returns results in order, at most so many at a time", async () => {
    let running = 0;
    let most = 0;
    const results = await mapConcurrently([1, 2, 3, 4, 5], 2, async (item) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return item * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(most).toBe(2);
  });

  it("starts nothing new after one fails", async () => {
    const started: number[] = [];
    await expect(
      mapConcurrently([1, 2, 3, 4, 5], 2, async (item) => {
        started.push(item);
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (item === 1) throw new Error("no");
      }),
    ).rejects.toThrow("no");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toEqual([1, 2]);
  });
});
