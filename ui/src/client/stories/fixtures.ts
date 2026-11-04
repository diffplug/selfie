// A batch's description as the server would give it, for stories. Screens are all props, so this is
// the one thing they need. The rules for blockers really live in `summarizeBatch` in `selfie-cli`,
// so these are only as faithful as a story needs.
import { isDecidable } from "selfie-store";
import { fn } from "storybook/test";
import type {
  Attention,
  ComparedRender,
  Note,
  RenderBatch,
  BatchView,
  RenderRow,
} from "../../shared/api.ts";
import type { FeedbackState, BatchState } from "../hooks.ts";
import { RequestError } from "../api.ts";
import { HASHES, PIXEL_DIFFS } from "./images.generated.ts";

export const BATCH_ID = "4f8c2a10-7d3e-4b6a-9c11-2e5f0a7b8c9d";
export const OTHER_BATCH_ID = "b1d7e3f4-1a2b-4c3d-8e5f-6a7b8c9d0e1f";
export const SHA = "c2a01c2f9d8e7b6a5c4d3e2f1a0b9c8d7e6f5a4b";

// The renderer fixes the clock at this time, so a relative date always reads the same there.
const NOW = Date.UTC(2026, 0, 15, 12);
const STARTED = NOW - 2 * 60 * 60 * 1000;

const decision = (kind: "approved" | "rejected", actor = "ned@example.com") => ({ decision: kind, actor, at: NOW - 60 * 60 * 1000 });

type Extras = Partial<Pick<RenderRow, "decision">>;

const render = (fields: Pick<ComparedRender, "story" | "state"> & Partial<RenderRow>): RenderRow => ({
  imageHash: null,
  goldenHash: null,
  failure: null,
  decision: null,
  pixelDiff: null,
  goldenStorybookUrl: null,
  goldenViewport: null,
  ...fields,
});

/** Between the two images a generated diff is named for. */
const changedBetween = (pair: keyof typeof PIXEL_DIFFS) => {
  const [current, golden] = pair.split("-") as [keyof typeof HASHES, keyof typeof HASHES];
  return (story: string, extras: Extras = {}) =>
    render({ story, state: "changed", imageHash: HASHES[current], goldenHash: HASHES[golden], pixelDiff: PIXEL_DIFFS[pair], ...extras });
};

export const rows = {
  changed: changedBetween("changed-golden"),
  tall: changedBetween("tallChanged-tallGolden"),
  taller: changedBetween("taller-golden"),
  shorter: changedBetween("golden-taller"),
  spaced: changedBetween("spaced-golden"),
  moved: changedBetween("moved-golden"),
  mixed: changedBetween("mixed-golden"),
  several: changedBetween("several-golden"),
  pushed: changedBetween("pushed-long"),
  double: changedBetween("doubleChanged-doubleGolden"),
  fresh: (story: string, extras: Extras = {}) => render({ story, state: "added", imageHash: HASHES.fresh, ...extras }),
  removed: (story: string) => render({ story, state: "removed", goldenHash: HASHES.gone }),
  failed: (story: string) =>
    render({ story, state: "failed", goldenHash: HASHES.golden, failure: "Render threw: Cannot read properties of undefined (reading 'name')" }),
  playFailed: (story: string) =>
    render({ story, state: "failed", imageHash: HASHES.fresh, goldenHash: HASHES.golden, failure: "play: expected a dialog to open" }),
};

export const approved = (actor?: string) => ({ decision: decision("approved", actor) });
export const rejected = (actor?: string) => ({ decision: decision("rejected", actor) });

export function batchOf(overrides: Partial<RenderBatch> = {}): RenderBatch {
  return {
    id: BATCH_ID,
    gitSha: SHA,
    environment: "container-linux-arm64-eb95931ecc85e990",
    status: "complete",
    startedAt: STARTED,
    finishedAt: STARTED + 90_000,
    failedCount: 0,
    dirty: false,
    branch: "main",
    storyFilter: null,
    reusedFromBatch: null,
    scale: 1,
    viewport: { width: 1200, height: 900 },
    ...overrides,
  };
}

export function viewOf(
  list: readonly RenderRow[],
  { batch: batchOverrides, unchanged = 512, ...overrides }: Partial<Omit<BatchView, "batch">> & { readonly batch?: Partial<RenderBatch>; readonly unchanged?: number } = {},
): BatchView {
  const inState = (state: RenderRow["state"]) => list.filter((row) => row.state === state);
  const undecided = list.filter((row) => isDecidable(row.state) && row.decision === null);
  const unapproved = list.filter((row) => isDecidable(row.state) && row.decision?.decision !== "approved");
  const failed = inState("failed");
  const removed = inState("removed");
  const batch = batchOf({ failedCount: failed.length, status: failed.length > 0 ? "failed" : "complete", ...batchOverrides });

  const blockers: Attention[] = [
    ...failed.map(({ story, failure }) => ({ story, reason: "failed" as const, detail: failure })),
    ...unapproved.map(({ story, state, decision: made }) =>
      made?.decision === "rejected"
        ? { story, reason: "rejected" as const, detail: made.actor }
        : state === "removed"
          ? { story, reason: "removed" as const, detail: null }
          : { story, reason: `${state}-unapproved` as "changed-unapproved" | "added-unapproved", detail: null },
    ),
    ...(batch.storyFilter?.unmatched ?? []).map((pattern) => ({ story: null, reason: "pattern-unmatched" as const, detail: pattern })),
  ];
  return {
    batch,
    storybook: null,
    storyViewports: {},
    storyNames: [],
    hunkMergeDistance: 12,
    actor: "ned@example.com",
    blockers,
    counts: {
      stories: unchanged + list.filter(({ state }) => state !== "removed" && state !== "unchanged").length,
      unchanged,
      changed: inState("changed").length,
      added: inState("added").length,
      removed: removed.length,
      failed: failed.length,
      undecided: undecided.length,
    },
    rows: list,
    outsideFilter: 0,
    siblings: [{ id: batch.id, startedAt: batch.startedAt, status: batch.status, dirty: batch.dirty }],
    ...overrides,
  };
}

export function note(id: number, { text = "This looks a bit quiet next to the heading.", ...overrides }: Partial<Note> & { readonly text?: string } = {}): Note {
  const state = overrides.state ?? "draft";
  return {
    id,
    story: "components-button--primary",
    batchId: BATCH_ID,
    imageHash: null,
    box: null,
    state,
    messages: [{ id, sender: "person", author: "ned@example.com", text, batchId: BATCH_ID, at: id, sent: state !== "draft" }],
    ...overrides,
  };
}

/** The same note, once an agent has answered it. */
export function replied(original: Note, text: string): Note {
  return { ...original, state: "replied", messages: [...original.messages, { id: original.id + 1000, sender: "agent", author: "agent", text, batchId: BATCH_ID, at: 1, sent: true }] };
}

/** A folder's notes, with actions that are recorded but change nothing. */
export function feedbackOf(notes: readonly Note[] = [], overrides: Partial<FeedbackState> = {}, agentWaiting = false, latestBatchId: string | null = BATCH_ID): FeedbackState {
  return {
    view: { folder: "selfie-hackathon", notes, agentWaiting, latestBatchId },
    error: null,
    clearError: fn(),
    add: fn(async () => true),
    remove: fn(async () => undefined),
    answer: fn(async () => true),
    resolve: fn(async () => undefined),
    send: fn(async () => "Feedback on the Storybook stories in the folder `selfie-hackathon`, as 1 note.\n\nNote 1, on components-button--primary:\nThis looks a bit quiet next to the heading."),
    ...overrides,
  };
}

/** A batch's state, with actions that are recorded but change nothing. */
export function stateOf(view: BatchView, overrides: Partial<BatchState> = {}): BatchState {
  return {
    view,
    loadError: null,
    actionError: null,
    busy: false,
    unchanged: null,
    loadUnchanged: fn(),
    clearActionError: fn(),
    decide: fn(async () => true),
    ...overrides,
  };
}

export const failure = (code: string, message: string) => new RequestError(code, message);
