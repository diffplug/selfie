// What the stories of a story's page share.
import { expect, userEvent, waitFor } from "storybook/test";
import type { Note, BatchView, RenderRow } from "../../shared/api.ts";
import { DetailScreen } from "../DetailScreen.tsx";
import { feedbackOf, rows, stateOf, viewOf } from "./fixtures.ts";
import { BatchFrame } from "./BatchFrame.tsx";

export interface StoryPageArgs {
  readonly row: RenderRow;
  readonly others?: readonly RenderRow[];
  readonly view?: BatchView;
  readonly notes?: readonly Note[];
  readonly accepted?: ReadonlySet<string>;
}

export function StoryPage({ row, others = [], view, notes = [], accepted }: StoryPageArgs) {
  const shown = view ?? viewOf([row, ...others]);
  const state = stateOf(shown);
  return (
    <BatchFrame view={shown} state={state} story={row.story}>
      {(navigation) => navigation !== null && <DetailScreen state={state} view={shown} story={row.story} search="" feedback={feedbackOf(notes)} navigation={navigation} {...(accepted === undefined ? {} : { accepted })} />}
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
