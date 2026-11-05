// What the stories of a story's page share.
import { expect, userEvent, waitFor } from "storybook/test";
import type { ApprovedRow, Note, BatchView, RenderRow } from "../../shared/api.ts";
import { DetailScreen } from "../DetailScreen.tsx";
import { feedbackOf, rows, stateOf, viewOf } from "./fixtures.ts";
import { BatchFrame } from "./BatchFrame.tsx";

export interface StoryPageArgs {
  readonly row: RenderRow;
  readonly others?: readonly RenderRow[];
  readonly view?: BatchView;
  readonly notes?: readonly Note[];
  readonly accepted?: ReadonlySet<string>;
  /** What's approved since this batch's base, and that it's being looked at. */
  readonly approvedEarlier?: readonly ApprovedRow[];
}

export function StoryPage({ row, others = [], view, notes = [], accepted, approvedEarlier }: StoryPageArgs) {
  const shown = view ?? viewOf(approvedEarlier === undefined ? [row, ...others] : others);
  const state = stateOf(shown, approvedEarlier === undefined ? {} : { approvedSince: { base: null, rows: approvedEarlier } });
  const search = approvedEarlier === undefined ? "" : "?show=approved-earlier";
  return (
    <BatchFrame view={shown} state={state} story={row.story} search={search}>
      {(navigation) => navigation !== null && <DetailScreen state={state} view={shown} story={row.story} search={search} feedback={feedbackOf(notes)} navigation={navigation} {...(accepted === undefined ? {} : { accepted })} />}
    </BatchFrame>
  );
}

export const press = (...keys: readonly string[]) => async () => {
  for (const key of keys) await userEvent.keyboard(key);
};

/** Stacking centers, and outlines are drawn, once every image has a size, so nothing's settled until then. */
export const stackedImagesLoaded = (canvasElement: HTMLElement) =>
  waitFor(() => {
    for (const image of canvasElement.querySelectorAll<HTMLElement>(".selfie-layer")) expect(image.style.width).not.toBe("");
  });

export const SEVERAL = rows.several("pages-home--rearranged");
export const BUTTON = rows.changed("components-button--primary");
export const NEIGHBORS = [rows.fresh("components-badge--new"), rows.tall("pages-settings--account")];
