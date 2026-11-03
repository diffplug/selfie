// What crosses between the browser and the server, and what the server needs from its platform.
// Types only, so the client's bundle holds none of the server, and the server none of the client.
// `selfie-cli` takes its own result types from here, so each has one definition.
import type { ComparedSnapshot, DecisionKind, Run } from "selfie-store";

export type { ComparedSnapshot, DecisionKind, Run, SnapshotState } from "selfie-store";

export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Rectangles of each image that correspond. */
export interface BoxPair {
  readonly current: BoundingBox;
  readonly golden: BoundingBox;
}

/** What a region's difference is. Anything not accounted for by moves and spacing is `changed`. */
export type RegionKind = "changed" | "moved" | "spacing";

/** Boxes that differ. Everything outside a region matches. */
export interface ChangedRegion extends BoxPair {
  readonly kind: RegionKind;
  /** What moves and spacing don't account for. */
  readonly changedPixels: number;
  /** What landed here, identical to what was elsewhere in the golden. A region that only lost something to another region is `moved` with none of these. */
  readonly moved: readonly BoxPair[];
}

export interface PixelDiff {
  readonly current: { readonly width: number; readonly height: number };
  readonly golden: { readonly width: number; readonly height: number };
  /** Top to bottom. */
  readonly regions: readonly ChangedRegion[];
  /** What moves and spacing don't account for, including what only the golden has, which isn't in `boundingBox`. */
  readonly changedPixels: number;
  /** Of blocks that are identical, but elsewhere. */
  readonly movedPixels: number;
  /** Of bands of the surrounding color that grew or shrank. */
  readonly spacingPixels: number;
  /** The larger image's. */
  readonly totalPixels: number;
  /** In the current image, around what changed, or else what moved or grew. If something was only removed, the row marking where. Null only if the images are identical, which a `changed` snapshot never is. */
  readonly boundingBox: BoundingBox | null;
  /** Where to look first, in reading order, which `boundingBox`'s center need not be. */
  readonly firstChanged: { readonly x: number; readonly y: number } | null;
  /** The largest difference in any one changed channel where both images have a pixel, 0 to 255. */
  readonly maxChannelDelta: number;
}

export type BlockerReason =
  | "failed"
  | "changed-unapproved"
  | "new-unapproved"
  | "rejected"
  | "removed"
  | "pattern-unmatched";

export type AdvisoryReason = "play-error";

export interface Attention<Reason extends string> {
  /** Null only for `pattern-unmatched`. */
  readonly story: string | null;
  readonly reason: Reason;
  /** The fact behind it, if there's more than its name: a message, an actor, or a pattern. */
  readonly detail: string | null;
}

export type AcceptRefusal =
  | { readonly reason: "recorded-on-dirty-tree"; readonly gitSha: string }
  | { readonly reason: "run-has-failures"; readonly stories: readonly string[] }
  | {
      readonly reason: "unapproved";
      readonly stories: readonly {
        readonly story: string;
        readonly state: string;
        readonly decision: DecisionKind | null;
      }[];
    }
  | {
      readonly reason: "removed-unacknowledged";
      readonly stories: readonly string[];
      /** How many of `stories` are gone only because the run's filter left them out. */
      readonly outsideFilter: number;
    }
  | {
      readonly reason: "wrong-removed-count";
      readonly stories: readonly string[];
      readonly outsideFilter: number;
      /** The count the caller gave. */
      readonly seen: number;
    };

/** A compared snapshot, with the pixel stats its review exported, if they're still on disk. */
export interface SnapshotRow extends ComparedSnapshot {
  readonly pixelDiff: PixelDiff | null;
}

/** The baseline a review would use, and why there's none, if that's so. */
export interface BaselineNote {
  readonly sha: string | null;
  readonly message: string | null;
}

export type RunListing = Pick<Run, "id" | "startedAt" | "status" | "dirty">;

/** Where a kept build is, on a hosted Storybook's origin, ending in a slash. Crosses into `selfie-cli` from here. */
export const keptBuildPath = (build: string) => `/storybook-builds/${build}/`;

/** A Storybook to open a run's stories in, on an origin of its own. */
export interface StorybookLink {
  /** Ending in a slash. */
  readonly url: string;
  /** Whether it's the very build that rendered this run. If it isn't, a story may not look like its image. */
  readonly exactBuild: boolean;
}

/** Everything a screen shows about a run, recomputed from `summarizeRun` after every action. */
export interface RunView {
  readonly run: Run;
  /** Null if there's no built Storybook to host. */
  readonly storybook: StorybookLink | null;
  /** The kept build of the goldens this run is compared with, or null if there's none. */
  readonly goldenStorybookUrl: string | null;
  /** The size this run's stories rendered at, so a live one lays out as its image did. Null if that wasn't recorded. */
  readonly viewport: { readonly width: number; readonly height: number } | null;
  /** With no baseline, the nearest goldens on the run's branch, which `rows` compares with. Only to look at. */
  readonly branchGoldens: string | null;
  /** How close a diff's regions group here, in CSS pixels. */
  readonly regionMergeDistance: number;
  /** The run whose images are the goldens of this run's Git SHA, which may be this one. */
  readonly acceptedRunId: string | null;
  /** Who a decision made here is recorded as, or null if Git doesn't say. */
  readonly actor: string | null;
  readonly blockers: readonly Attention<BlockerReason>[];
  readonly advisories: readonly Attention<AdvisoryReason>[];
  readonly counts: {
    readonly stories: number;
    readonly unchanged: number;
    readonly changed: number;
    readonly new: number;
    readonly removed: number;
    readonly failed: number;
    readonly undecided: number;
    readonly advisories: number;
  };
  /** Everything that isn't unchanged, and anything with an advisory, in name order. */
  readonly rows: readonly SnapshotRow[];
  /** What `accept` would refuse now, were no removals acknowledged. */
  readonly refusals: readonly AcceptRefusal[];
  /**
   * Every golden accepting would drop, and how many only the run's filter left out, which aren't in
   * `rows`. Acknowledging means passing the length of `stories`.
   */
  readonly removals: { readonly stories: readonly string[]; readonly outsideFilter: number };
  readonly usableAsBaseline: boolean;
  /** Every run at this SHA and environment, newest first, this one included. */
  readonly siblings: readonly RunListing[];
}

/** A story's newest image at HEAD, from whichever run took it. */
export interface StoryCaptureInfo {
  readonly runId: string;
  readonly state: SnapshotRow["state"];
  readonly decision: SnapshotRow["decision"];
  readonly capturedAt: number;
  /** Recorded with uncommitted changes, so it can't become a golden. */
  readonly dirty: boolean;
  /** Whether the hosted build rendered it, or null if that's not known. If not, it may be out of date. */
  readonly fromHostedBuild: boolean | null;
}

export interface ListedStory {
  readonly story: string;
  /** Its path in the Storybook's sidebar, such as `Screens/Accept`, or nothing if that's not known. */
  readonly title: string;
  /** What the sidebar calls it, or its ID if that's not known. */
  readonly name: string;
  /** Null if no run at HEAD has captured it. */
  readonly capture: StoryCaptureInfo | null;
}

/** What a server that hosts a Storybook can say about it. */
export interface StorySetup {
  /** Where it looks for a build, from the Git top level. */
  readonly storybookDir: string;
  /** How the config says to build one, if it does. */
  readonly buildCommand: string | null;
  /** What differs from HEAD now, as Git names it, which a render now would be marked with. */
  readonly uncommitted: readonly string[];
  /** What the hosted build reads as: nothing uncommitted and built since HEAD last moved, or which of those it isn't. Null with no build or commit. */
  readonly builtFrom: "clean" | "uncommitted" | "before-head" | null;
  /** Renders in the pinned container, and not in this machine's browser. */
  readonly usesDocker: boolean;
}

/** Every story of the hosted Storybook, each with its newest capture, which a single run is a special case of. */
export interface StoriesView {
  readonly head: string | null;
  /** The branch HEAD is on, or null if it's detached. */
  readonly branch: string | null;
  /** The hosted Storybook as it stands, or null if there's no build there. */
  readonly storybookUrl: string | null;
  /** The size a story renders at here now. */
  readonly viewport: { readonly width: number; readonly height: number };
  /** In the order the Storybook's sidebar shows them. */
  readonly stories: readonly ListedStory[];
  /** The newest finished run at HEAD, to review and accept. */
  readonly newestRunId: string | null;
  /** Whether this server can capture a story when asked, which takes a commit, a build, and a browser to do it with. */
  readonly canCapture: boolean;
  /** Null if this server hosts no Storybook. */
  readonly setup: StorySetup | null;
}

export interface AcceptOutcome {
  readonly accepted: boolean;
  /** Empty if accepted. These include any about the count this request passed. */
  readonly refusals: readonly AcceptRefusal[];
  readonly view: RunView;
}

export interface ApiError {
  readonly error: { readonly code: string; readonly message: string };
}

export interface DecisionTarget {
  readonly story: string;
  readonly imageHash: string;
}

/** `draft` is still the person's, `sent` is the agent's to act on, and `replied` and `resolved` are the person's to look at, or done. */
export type NoteState = "draft" | "sent" | "replied" | "resolved";

/** One thing said about a note, which is a draft until it's sent. */
export interface NoteMessage {
  readonly id: number;
  readonly sender: "person" | "agent";
  readonly author: string;
  readonly text: string;
  readonly runId: string | null;
  readonly at: number;
  readonly sent: boolean;
}

/** Where something a person wants to talk about is: on a story, on an image, and maybe a box of it. */
export interface Note {
  readonly id: number;
  readonly story: string;
  readonly runId: string;
  /** The image it's about, or null for a story with no image, such as one that failed. */
  readonly imageHash: string | null;
  /** Null for all of the image. */
  readonly box: BoundingBox | null;
  readonly state: NoteState;
  readonly messages: readonly NoteMessage[];
}

export type NewNote = Pick<Note, "story" | "runId" | "imageHash" | "box"> & { readonly text: string };

/** One session's notes, which is one local folder's. */
export interface FeedbackView {
  /** Only its name, since a response never holds a path. */
  readonly folder: string;
  readonly notes: readonly Note[];
  /** Whether `selfie agent-await-feedback` is running in this folder now. */
  readonly agentWaiting: boolean;
  /** The newest run recorded from this folder, which is the one to look at, if it's known. */
  readonly latestRunId: string | null;
}

/** `agent` to a waiting agent, or `copy` if the person is pasting them somewhere themselves. */
export type SendVia = "agent" | "copy";

/**
 * The seam between the routes and a platform: how they reach a project's data. `cli/src/ui.ts`
 * implements it for a local repository. An error with a `code` from `ERROR_STATUS` becomes that
 * status with its message.
 */
export interface ReviewSource {
  storiesView(): Promise<StoriesView>;
  /** Records a run of just these stories from the hosted Storybook, one at a time. */
  capture(stories: readonly string[]): Promise<{ readonly runId: string }>;
  runView(runId: string): Promise<RunView>;
  /** Why the run has no baseline: only a screen showing that asks. */
  baseline(runId: string): Promise<BaselineNote>;
  unchanged(runId: string): Promise<readonly SnapshotRow[]>;
  /** Decides on exactly these images, or refuses all of them if one isn't what the run holds. */
  decide(runId: string, decision: DecisionKind, targets: readonly DecisionTarget[]): Promise<RunView>;
  accept(runId: string, removedSeen: number | undefined): Promise<AcceptOutcome>;
  feedback(): Promise<FeedbackView>;
  addNote(note: NewNote): Promise<FeedbackView>;
  removeNote(id: number): Promise<FeedbackView>;
  answerNote(id: number, text: string, runId: string): Promise<FeedbackView>;
  resolveNote(id: number): Promise<FeedbackView>;
  /** Sends every draft, and answers with all that's been sent, as text to paste into an agent. */
  sendNotes(via: SendVia): Promise<{ readonly feedback: FeedbackView; readonly text: string }>;
  /** The stored bytes, or null if this store doesn't hold it. */
  image(hash: string): Promise<Uint8Array | null>;
  /** Null if the store doesn't hold both. */
  diff(current: string, golden: string): Promise<{ diff: PixelDiff; png: Uint8Array } | null>;
}

/** The custom header every state-changing request needs, since a form on another site can't send one. */
export const REQUEST_HEADER = "x-selfie-request";
export const REQUEST_HEADER_VALUE = "review-ui";
