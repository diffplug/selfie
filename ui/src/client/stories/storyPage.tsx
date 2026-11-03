// What the stories of a story's page share.
import { expect, userEvent, waitFor } from "storybook/test";
import type { Note, RunView, SnapshotRow } from "../../shared/api.ts";
import { DetailScreen } from "../DetailScreen.tsx";
import { feedbackOf, rows, stateOf, viewOf } from "./fixtures.ts";
import { RunFrame } from "./RunFrame.tsx";

export interface StoryPageArgs {
  readonly row: SnapshotRow;
  readonly others?: readonly SnapshotRow[];
  readonly view?: RunView;
  readonly notes?: readonly Note[];
}

export function StoryPage({ row, others = [], view, notes = [] }: StoryPageArgs) {
  const shown = view ?? viewOf([row, ...others]);
  const state = stateOf(shown);
  return (
    <RunFrame view={shown} state={state} story={row.story}>
      {(treeOrder) => <DetailScreen state={state} view={shown} story={row.story} search="" feedback={feedbackOf(notes)} treeOrder={treeOrder} />}
    </RunFrame>
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
