// What a render's progress comes to in words, for the page and the CLI. The rate is the stories
// finished over the time since the first story started, so starting a browser, or downloading an
// image, doesn't count against it.
import type { RenderProgress } from "./api.ts";

/** How long the first stories get before they say anything about the rest. */
const ESTIMATE_AFTER_MS = 3_000;

/** How often a screen reader hears how a render is going, while the screen changes every second. */
const SPOKEN_EVERY_MS = 30_000;

/** How long a render has left, or null if it's too early to say. */
export function estimateRemainingMs({ total, finished, firstStoryStartedAtMs }: RenderProgress, now: number): number | null {
  if (firstStoryStartedAtMs === null || finished === 0) return null;
  const sinceFirstStory = now - firstStoryStartedAtMs;
  if (sinceFirstStory < ESTIMATE_AFTER_MS) return null;
  return (total - finished) * (sinceFirstStory / finished);
}

/** `0:14`, or `1:02:03` past an hour. */
export function formatDuration(ms: number, round: (seconds: number) => number = Math.floor): string {
  const seconds = round(Math.max(0, ms) / 1000);
  const sixty = (part: number) => String(part).padStart(2, "0");
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return hours > 0 ? `${hours}:${sixty(minutes)}:${sixty(seconds % 60)}` : `${minutes}:${sixty(seconds % 60)}`;
}

/** `12 of 568 stories, 0:14 elapsed, about 3:40 left`, or only what's elapsed until there's an estimate. */
export function describeRenderProgress(progress: RenderProgress, now: number): string {
  const elapsed = `${formatDuration(now - progress.startedAtMs)} elapsed`;
  const remaining = estimateRemainingMs(progress, now);
  if (remaining === null) return elapsed;
  const { total, finished } = progress;
  const count = `${finished.toLocaleString()} of ${total.toLocaleString()} ${total === 1 ? "story" : "stories"}`;
  // Rendering is done by then, but not storing what it made, which has no estimate.
  if (finished === total) return `${count}, ${elapsed}, saving the batch`;
  // Up, so a story still to come never says it has 0:00 left.
  return `${count}, ${elapsed}, about ${formatDuration(remaining, Math.ceil)} left`;
}

/** Which stretch of a render this is. A screen reader hears once of each, so this says when to say it again. */
export const spokenStretch = ({ startedAtMs }: RenderProgress, now: number): number => Math.floor(Math.max(0, now - startedAtMs) / SPOKEN_EVERY_MS);
