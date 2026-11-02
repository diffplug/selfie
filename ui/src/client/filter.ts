// Which rows a filter shows, and where next and previous go. Pure, so a test needs no browser.
import type { DecisionTarget, SnapshotRow } from "../shared/api.ts";

export const SHOW_OPTIONS = [
  ["all", "All differences"],
  ["undecided", "Needs a decision"],
  ["changed", "Changed"],
  ["new", "New"],
  ["removed", "Removed"],
  ["failed", "Failed"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
  ["advisory", "Has an advisory"],
  ["unchanged", "Unchanged"],
] as const;

export type Show = (typeof SHOW_OPTIONS)[number][0];

export interface RowFilter {
  readonly text: string;
  readonly show: Show;
}

export const NO_FILTER: RowFilter = { text: "", show: "all" };

export const isDecidable = ({ state }: SnapshotRow) => state === "changed" || state === "new";

const isDifference = ({ state }: SnapshotRow) => state !== "unchanged";
const hasAdvisory = ({ playError, unstable }: SnapshotRow) => playError !== null || unstable === true;

function inShow(row: SnapshotRow, show: Show): boolean {
  switch (show) {
    case "all":
      return isDifference(row) || hasAdvisory(row);
    case "undecided":
      return isDecidable(row) && row.decision === null;
    case "approved":
    case "rejected":
      return isDecidable(row) && row.decision?.decision === show;
    case "advisory":
      return hasAdvisory(row);
    default:
      return row.state === show;
  }
}

/** Every word of the text must appear in the story's ID, in any order, ignoring case. */
export function applyFilter(rows: readonly SnapshotRow[], { text, show }: RowFilter): SnapshotRow[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (!inShow(row, show)) return false;
    const story = row.story.toLowerCase();
    return words.every((word) => story.includes(word));
  });
}

/** What a decision on these rows would decide on: only what has an image to approve. */
export const decisionTargets = (rows: readonly SnapshotRow[]): DecisionTarget[] =>
  rows.filter(isDecidable).map(({ story, imageHash }) => ({ story, imageHash: imageHash! }));

/**
 * The shown rows on either side of a story, by position in `all`, so a story a decision just took
 * out of the filter still has neighbors.
 */
export function neighbors(
  all: readonly SnapshotRow[],
  shown: readonly SnapshotRow[],
  story: string,
): { readonly previous: SnapshotRow | null; readonly next: SnapshotRow | null } {
  const position = new Map(all.map((row, index) => [row.story, index]));
  const here = position.get(story) ?? -1;
  let previous: SnapshotRow | null = null;
  let next: SnapshotRow | null = null;
  for (const row of shown) {
    const at = position.get(row.story) ?? -1;
    if (at < here) previous = row;
    else if (at > here) {
      next = row;
      break;
    }
  }
  return { previous, next };
}

/** A filter as the query of a URL, so going back and reloading both keep it. */
export function filterQuery({ text, show }: RowFilter): string {
  const params = new URLSearchParams();
  if (text !== "") params.set("q", text);
  if (show !== "all") params.set("show", show);
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

export function parseFilter(search: string): RowFilter {
  const params = new URLSearchParams(search);
  const show = params.get("show");
  return {
    text: params.get("q") ?? "",
    show: SHOW_OPTIONS.some(([value]) => value === show) ? (show as Show) : "all",
  };
}
