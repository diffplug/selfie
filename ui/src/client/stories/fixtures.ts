// A run's description as the server would give it, for stories. Screens are all props, so this is
// the one thing they need. The rules for blockers and refusals really live in `summarizeRun` and
// `checkAccept` in `selfie-cli`, so these are only as faithful as a story needs.
import { isDecidable } from "selfie-store";
import { fn } from "storybook/test";
import type {
  AcceptRefusal,
  AdvisoryReason,
  Attention,
  BlockerReason,
  ComparedSnapshot,
  Note,
  Run,
  RunView,
  SnapshotRow,
} from "../../shared/api.ts";
import type { FeedbackState, RunState } from "../hooks.ts";
import { RequestError } from "../api.ts";
import { HASHES, PIXEL_DIFFS } from "./images.generated.ts";

export const RUN_ID = "4f8c2a10-7d3e-4b6a-9c11-2e5f0a7b8c9d";
export const OTHER_RUN_ID = "b1d7e3f4-1a2b-4c3d-8e5f-6a7b8c9d0e1f";
export const SHA = "c2a01c2f9d8e7b6a5c4d3e2f1a0b9c8d7e6f5a4b";
export const BASELINE_SHA = "58bfd636768707e03943bcf08a05152f799617bb";

// The renderer fixes the clock at this time, so a relative date always reads the same there.
const NOW = Date.UTC(2026, 0, 15, 12);
const STARTED = NOW - 2 * 60 * 60 * 1000;

const decision = (kind: "approved" | "rejected", actor = "ned@example.com") => ({ decision: kind, actor, at: NOW - 60 * 60 * 1000 });

type Extras = Partial<Pick<SnapshotRow, "decision" | "playError">>;

const snapshot = (fields: Pick<ComparedSnapshot, "story" | "state"> & Partial<SnapshotRow>): SnapshotRow => ({
  imageHash: null,
  goldenHash: null,
  failure: null,
  playError: null,
  decision: null,
  pixelDiff: null,
  ...fields,
});

/** Between the two images a generated diff is named for. */
const changedBetween = (pair: keyof typeof PIXEL_DIFFS) => {
  const [current, golden] = pair.split("-") as [keyof typeof HASHES, keyof typeof HASHES];
  return (story: string, extras: Extras = {}) =>
    snapshot({ story, state: "changed", imageHash: HASHES[current], goldenHash: HASHES[golden], pixelDiff: PIXEL_DIFFS[pair], ...extras });
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
  fresh: (story: string, extras: Extras = {}) => snapshot({ story, state: "added", imageHash: HASHES.fresh, ...extras }),
  removed: (story: string) => snapshot({ story, state: "removed", goldenHash: HASHES.gone }),
  failed: (story: string) =>
    snapshot({ story, state: "failed", goldenHash: HASHES.golden, failure: "Render threw: Cannot read properties of undefined (reading 'name')" }),
  unchangedWithPlayError: (story: string) =>
    snapshot({ story, state: "unchanged", imageHash: HASHES.golden, goldenHash: HASHES.golden, playError: "expected a dialog to open" }),
};

export const approved = (actor?: string) => ({ decision: decision("approved", actor) });
export const rejected = (actor?: string) => ({ decision: decision("rejected", actor) });

export function runOf(overrides: Partial<Run> = {}): Run {
  return {
    id: RUN_ID,
    gitSha: SHA,
    environment: "container-linux-arm64-eb95931ecc85e990",
    status: "complete",
    startedAt: STARTED,
    finishedAt: STARTED + 90_000,
    failedCount: 0,
    dirty: false,
    baselineSha: BASELINE_SHA,
    storyFilter: null,
    reusedFromRun: null,
    scale: 1,
    ...overrides,
  };
}

export function viewOf(
  list: readonly SnapshotRow[],
  { run: runOverrides, unchanged = 512, ...overrides }: Partial<Omit<RunView, "run">> & { readonly run?: Partial<Run>; readonly unchanged?: number } = {},
): RunView {
  const inState = (state: SnapshotRow["state"]) => list.filter((row) => row.state === state);
  const undecided = list.filter((row) => isDecidable(row.state) && row.decision === null);
  const unapproved = list.filter((row) => isDecidable(row.state) && row.decision?.decision !== "approved");
  const failed = inState("failed");
  const removed = inState("removed");
  const run = runOf({ failedCount: failed.length, status: failed.length > 0 ? "failed" : "complete", ...runOverrides });

  const blockers: Attention<BlockerReason>[] = [
    ...failed.map(({ story, failure }) => ({ story, reason: "failed" as const, detail: failure })),
    ...unapproved.map(({ story, state, decision: made }) =>
      made?.decision === "rejected"
        ? { story, reason: "rejected" as const, detail: made.actor }
        : { story, reason: `${state}-unapproved` as "changed-unapproved" | "added-unapproved", detail: null },
    ),
    ...removed.map(({ story }) => ({ story, reason: "removed" as const, detail: null })),
    ...(run.storyFilter?.unmatched ?? []).map((pattern) => ({ story: null, reason: "pattern-unmatched" as const, detail: pattern })),
  ];
  const advisories: Attention<AdvisoryReason>[] = list.flatMap(({ story, playError }) =>
    playError === null ? [] : [{ story, reason: "play-error" as const, detail: playError }],
  );
  const removals = overrides.removals ?? { stories: removed.map(({ story }) => story), outsideFilter: 0 };
  const refusals: AcceptRefusal[] = [
    ...(run.dirty ? [{ reason: "recorded-on-dirty-tree" as const, gitSha: run.gitSha }] : []),
    ...(failed.length > 0 ? [{ reason: "run-has-failures" as const, stories: failed.map(({ story }) => story) }] : []),
    ...(unapproved.length > 0
      ? [
          {
            reason: "unapproved" as const,
            stories: unapproved.map(({ story, state, decision: made }) => ({ story, state, decision: made?.decision ?? null })),
          },
        ]
      : []),
    ...(removals.stories.length > 0 ? [{ reason: "removed-unacknowledged" as const, ...removals }] : []),
  ];
  return {
    run,
    storybook: null,
    goldenStorybookUrl: null,
    viewport: { width: 1200, height: 900 },
    storyNames: [],
    branchGoldens: null,
    hunkMergeDistance: 12,
    acceptedRunId: null,
    actor: "ned@example.com",
    blockers,
    advisories,
    counts: {
      stories: unchanged + list.filter(({ state }) => state !== "removed" && state !== "unchanged").length,
      unchanged,
      changed: inState("changed").length,
      added: inState("added").length,
      removed: removed.length,
      failed: failed.length,
      undecided: undecided.length,
      advisories: advisories.length,
    },
    rows: list,
    refusals,
    removals,
    usableAsBaseline: true,
    siblings: [{ id: run.id, startedAt: run.startedAt, status: run.status, dirty: run.dirty }],
    ...overrides,
  };
}

export function note(id: number, { text = "This looks a bit quiet next to the heading.", ...overrides }: Partial<Note> & { readonly text?: string } = {}): Note {
  const state = overrides.state ?? "draft";
  return {
    id,
    story: "components-button--primary",
    runId: RUN_ID,
    imageHash: null,
    box: null,
    state,
    messages: [{ id, sender: "person", author: "ned@example.com", text, runId: RUN_ID, at: id, sent: state !== "draft" }],
    ...overrides,
  };
}

/** The same note, once an agent has answered it. */
export function replied(original: Note, text: string): Note {
  return { ...original, state: "replied", messages: [...original.messages, { id: original.id + 1000, sender: "agent", author: "agent", text, runId: RUN_ID, at: 1, sent: true }] };
}

/** A folder's notes, with actions that are recorded but change nothing. */
export function feedbackOf(notes: readonly Note[] = [], overrides: Partial<FeedbackState> = {}, agentWaiting = false, latestRunId: string | null = RUN_ID): FeedbackState {
  return {
    view: { folder: "selfie-hackathon", notes, agentWaiting, latestRunId },
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

/** A run's state, with actions that are recorded but change nothing. */
export function stateOf(view: RunView, overrides: Partial<RunState> = {}): RunState {
  return {
    view,
    loadError: null,
    actionError: null,
    busy: false,
    unchanged: null,
    loadUnchanged: fn(),
    clearActionError: fn(),
    decide: fn(async () => true),
    accept: fn(async () => ({ accepted: true, refusals: [] })),
    ...overrides,
  };
}

export const failure = (code: string, message: string) => new RequestError(code, message);
