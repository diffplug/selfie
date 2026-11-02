// Which rows a filter shows, and where next and previous go. Pure, so a test needs no browser.
import { isDecidable } from "selfie-store";
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

export const hasAdvisory = ({ playError }: SnapshotRow) => playError !== null;

function inShow(row: SnapshotRow, show: Show): boolean {
  switch (show) {
    case "all":
      return row.state !== "unchanged" || hasAdvisory(row);
    case "undecided":
      return isDecidable(row.state) && row.decision === null;
    case "approved":
    case "rejected":
      return isDecidable(row.state) && row.decision?.decision === show;
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

/** What these rows have to decide on. */
export const decidableIn = (rows: readonly SnapshotRow[]) => rows.filter(({ state }) => isDecidable(state));

export const targetsOf = (rows: readonly SnapshotRow[]): DecisionTarget[] =>
  rows.map(({ story, imageHash }) => ({ story, imageHash: imageHash! }));

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

/**
 * Keeps the objects of rows that haven't changed, so a screen memoizing by row re-renders only what
 * did. A run's images never change, so its hashes and its decision are all that can.
 */
export function reuseRows(previous: readonly SnapshotRow[], next: readonly SnapshotRow[]): readonly SnapshotRow[] {
  const known = new Map(previous.map((row) => [row.story, row]));
  return next.map((row) => {
    const old = known.get(row.story);
    const same =
      old !== undefined &&
      old.imageHash === row.imageHash &&
      old.goldenHash === row.goldenHash &&
      old.decision?.decision === row.decision?.decision &&
      old.decision?.actor === row.decision?.actor &&
      old.decision?.at === row.decision?.at;
    return same ? old : row;
  });
}

/** A filter as the query of a URL, so going back and reloading both keep it. */
export function filterQuery({ text, show }: RowFilter): string {
  const params = new URLSearchParams();
  if (text !== "") params.set("q", text);
  if (show !== "all") params.set("show", show);
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

export const showQuery = (show: Show) => filterQuery({ ...NO_FILTER, show });

export function parseFilter(search: string): RowFilter {
  const params = new URLSearchParams(search);
  const show = params.get("show");
  return {
    text: params.get("q") ?? "",
    show: SHOW_OPTIONS.some(([value]) => value === show) ? (show as Show) : "all",
  };
}
