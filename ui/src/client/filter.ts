// Which rows a filter shows, and where next and previous go. Pure, so a test needs no browser.
import { isDecidable } from "selfie-store";
import type { DecisionTarget, RenderRow } from "../shared/api.ts";
import { isLayoutOnly } from "../shared/hunks.ts";
import { plural } from "./plural.ts";

export const SHOW_OPTIONS = [
  ["all", "All differences"],
  ["undecided", "Needs a decision"],
  ["changed", "Changed"],
  ["layout", "Moved and spacing only"],
  ["added", "Added"],
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

export const hasAdvisory = ({ playError }: RenderRow) => playError !== null;

function inShow(row: RenderRow, show: Show): boolean {
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
    case "layout":
      return row.state === "changed" && row.pixelDiff !== null && isLayoutOnly(row.pixelDiff);
    default:
      return row.state === show;
  }
}

/** Every word of the text must appear in the story's ID, in any order, ignoring case. */
export function matchesText(story: string, text: string): boolean {
  const lowered = story.toLowerCase();
  return text.toLowerCase().split(/\s+/).filter(Boolean).every((word) => lowered.includes(word));
}

/** Where a story is in what's shown, in words. */
export const positionWords = (at: number, shown: number) => (at === -1 ? `Not in this filter, which shows ${plural(shown, "other")}` : `${at + 1} of ${shown}`);

export function applyFilter(rows: readonly RenderRow[], { text, show }: RowFilter): RenderRow[] {
  return rows.filter((row) => inShow(row, show) && matchesText(row.story, text));
}

/** What these rows have to decide on. */
export const decidableIn = (rows: readonly RenderRow[]) => rows.filter(({ state }) => isDecidable(state));

export const targetsOf = (rows: readonly RenderRow[]): DecisionTarget[] =>
  rows.map(({ story, imageHash }) => ({ story, imageHash: imageHash! }));

/** Where the keys go from a story, and how far along it is. */
export interface StoryNavigation {
  readonly previous: string | null;
  readonly next: string | null;
  /** The story `next` goes to, to have its images ready if this page knows them. */
  readonly nextStory: string | null;
  readonly list: string;
  readonly position: string;
}

/**
 * Through `shown`, as the list beside a story's page has it. `all` is the same list with no filter,
 * so a story a decision just took out of the filter still has neighbors.
 */
export function navigationThrough<Row extends { readonly story: string }>(
  all: readonly Row[],
  shown: readonly Row[],
  story: string,
  hrefOf: (story: string) => string,
  list: string,
): StoryNavigation {
  const { previous, next } = neighbors(all, shown, story);
  return {
    previous: previous === null ? null : hrefOf(previous.story),
    next: next === null ? null : hrefOf(next.story),
    nextStory: next?.story ?? null,
    list,
    position: positionWords(shown.findIndex((row) => row.story === story), shown.length),
  };
}

/**
 * The shown rows on either side of a story, by position in `all`, so a story a decision just took
 * out of the filter still has neighbors.
 */
export function neighbors<Row extends { readonly story: string }>(
  all: readonly Row[],
  shown: readonly Row[],
  story: string,
): { readonly previous: Row | null; readonly next: Row | null } {
  const position = new Map(all.map((row, index) => [row.story, index]));
  const here = position.get(story) ?? -1;
  let previous: Row | null = null;
  let next: Row | null = null;
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
export function reuseRows(previous: readonly RenderRow[], next: readonly RenderRow[]): readonly RenderRow[] {
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
