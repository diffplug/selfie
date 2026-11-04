import { describe, expect, test } from "vitest";
import type { RenderProgress } from "../src/shared/api.ts";
import { describeRenderProgress, estimateRemainingMs, formatDuration, spokenStretch } from "../src/shared/renderProgress.ts";

const ASKED = 1_000_000;
/** The browser took 10 seconds to start, which no estimate may count. */
const FIRST_STORY = ASKED + 10_000;
const progress = (overrides: Partial<RenderProgress> = {}): RenderProgress => ({ total: 568, finished: 0, startedAtMs: ASKED, firstStoryStartedAtMs: FIRST_STORY, ...overrides });

describe("estimateRemainingMs", () => {
  test("has nothing to say before the first story starts", () => {
    expect(estimateRemainingMs(progress({ firstStoryStartedAtMs: null, finished: 5 }), ASKED + 60_000)).toBeNull();
  });

  test("has nothing to say under 3 seconds after the first story started, and does at 3", () => {
    expect(estimateRemainingMs(progress({ finished: 5 }), FIRST_STORY + 2_999)).toBeNull();
    expect(estimateRemainingMs(progress({ finished: 5 }), FIRST_STORY + 3_000)).not.toBeNull();
  });

  test("has nothing to say until a story has finished", () => {
    expect(estimateRemainingMs(progress(), FIRST_STORY + 60_000)).toBeNull();
  });

  test("is the stories left over the rate since the first story started", () => {
    // 10 stories in 20 seconds is 2 seconds a story, and the 10 seconds before them count for nothing.
    expect(estimateRemainingMs(progress({ total: 110, finished: 10 }), FIRST_STORY + 20_000)).toBe(200_000);
  });

  test("moves as time passes, with no new story to go on", () => {
    expect(estimateRemainingMs(progress({ total: 11, finished: 10 }), FIRST_STORY + 30_000)).toBe(3_000);
  });
});

describe("formatDuration", () => {
  test("is minutes and seconds, and hours only past an hour", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(14_999)).toBe("0:14");
    expect(formatDuration(220_000)).toBe("3:40");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
  });

  test("rounds as it's told, and is never negative", () => {
    expect(formatDuration(14_001, Math.ceil)).toBe("0:15");
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("describeRenderProgress", () => {
  test("says only what's elapsed before the first story starts", () => {
    expect(describeRenderProgress(progress({ firstStoryStartedAtMs: null }), ASKED + 4_000)).toBe("0:04 elapsed");
  });

  test("counts elapsed from when it was asked for, not from the first story", () => {
    expect(describeRenderProgress(progress({ finished: 3 }), FIRST_STORY + 2_000)).toBe("0:12 elapsed");
  });

  test("says only what's elapsed until a story has finished", () => {
    expect(describeRenderProgress(progress(), FIRST_STORY + 30_000)).toBe("0:40 elapsed");
  });

  test("says how far, how long, and about how much longer", () => {
    expect(describeRenderProgress(progress({ total: 110, finished: 10 }), FIRST_STORY + 20_000)).toBe("10 of 110 stories, 0:30 elapsed, about 3:20 left");
  });

  test("says one story as one", () => {
    expect(describeRenderProgress(progress({ total: 2, finished: 1 }), FIRST_STORY + 4_000)).toBe("1 of 2 stories, 0:14 elapsed, about 0:04 left");
    expect(describeRenderProgress(progress({ total: 1, finished: 1 }), FIRST_STORY + 4_000)).toBe("1 of 1 story, 0:14 elapsed, saving the batch");
  });

  test("never says a story still to come has 0:00 left", () => {
    expect(describeRenderProgress(progress({ total: 11, finished: 10 }), FIRST_STORY + 4_000)).toBe("10 of 11 stories, 0:14 elapsed, about 0:01 left");
  });

  test("has no time left to estimate once every story is done, only the batch to save", () => {
    expect(describeRenderProgress(progress({ total: 3, finished: 3 }), FIRST_STORY + 20_000)).toBe("3 of 3 stories, 0:30 elapsed, saving the batch");
  });
});

describe("spokenStretch", () => {
  test("changes every 30 seconds from when the render was asked for, and not with each tick", () => {
    expect(spokenStretch(progress(), ASKED - 5)).toBe(0);
    expect(spokenStretch(progress(), ASKED + 29_999)).toBe(0);
    expect(spokenStretch(progress(), ASKED + 30_000)).toBe(1);
    expect(spokenStretch(progress({ finished: 100 }), ASKED + 59_999)).toBe(1);
    expect(spokenStretch(progress(), ASKED + 60_000)).toBe(2);
  });
});
