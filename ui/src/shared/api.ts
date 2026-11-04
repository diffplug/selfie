// What crosses between the browser and the server, and what the server needs from its platform.
// Types only, so the client's bundle holds none of the server, and the server none of the client.
// `selfie-cli` takes its own result types from here, so each has one definition.
import type { ComparedRender, DecisionKind, RenderBatch } from "selfie-store";

export type { ComparedRender, DecisionKind, RenderBatch, RenderState } from "selfie-store";

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

/** What a hunk's difference is. Anything not accounted for by moves and spacing is `changed`. */
export type HunkKind = "changed" | "moved" | "spacing";

/** Boxes that differ. Everything outside a hunk matches. */
export interface ChangedHunk extends BoxPair {
  readonly kind: HunkKind;
  /** What moves and spacing don't account for. */
  readonly changedPixels: number;
  /** What landed here, identical to what was elsewhere in the golden. A hunk that only lost something to another hunk is `moved` with none of these. */
  readonly moved: readonly BoxPair[];
}

export interface PixelDiff {
  readonly current: { readonly width: number; readonly height: number };
  readonly golden: { readonly width: number; readonly height: number };
  /** Top to bottom. */
  readonly hunks: readonly ChangedHunk[];
  /** What moves and spacing don't account for, including what only the golden has, which isn't in `boundingBox`. */
  readonly changedPixels: number;
  /** Of blocks that are identical, but elsewhere. */
  readonly movedPixels: number;
  /** Of bands of the surrounding color that grew or shrank. */
  readonly spacingPixels: number;
  /** The larger image's. */
  readonly totalPixels: number;
  /** In the current image, around what changed, or else what moved or grew. If something was only removed, the row marking where. Null only if the images are identical, which a `changed` render never is. */
  readonly boundingBox: BoundingBox | null;
  /** Where to look first, in reading order, which `boundingBox`'s center need not be. */
  readonly firstChanged: { readonly x: number; readonly y: number } | null;
  /** The largest difference in any one changed channel where both images have a pixel, 0 to 255. */
  readonly maxChannelDelta: number;
}

export type BlockerReason =
  | "failed"
  | "changed-unapproved"
  | "added-unapproved"
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

/** A compared render, with the pixel stats its review exported, if they're still on disk. */
export interface RenderRow extends ComparedRender {
  readonly pixelDiff: PixelDiff | null;
  /** The kept built Storybook of the batch whose image this is compared with, or null if there's none. */
  readonly goldenStorybookUrl: string | null;
  /** The size of its own that story declared in that batch, or null if it declared none. */
  readonly goldenViewport: { readonly width: number; readonly height: number } | null;
}

export type BatchListing = Pick<RenderBatch, "id" | "startedAt" | "status" | "dirty">;

/** Where a kept built Storybook is, on a hosted Storybook's origin, ending in a slash. Crosses into `selfie-cli` from here. */
export const keptStorybookPath = (build: string) => `/built-storybooks/${build}/`;

/** Where a batch stands against this checkout, for saying so. */
export interface BatchContext {
  readonly head: string | null;
  /** The branch HEAD is on, or null if it's detached. */
  readonly branch: string | null;
}

/** A Storybook to open a batch's stories in, on an origin of its own. */
export interface StorybookLink {
  /** Ending in a slash. */
  readonly url: string;
  /** Whether it's the very build that rendered this batch. If it isn't, a story may not look like its image. */
  readonly exactStorybook: boolean;
}

/** Everything a screen shows about a batch, recomputed from `summarizeBatch` after every action. */
export interface BatchView {
  readonly batch: RenderBatch;
  /** Null if there's no built Storybook to host. */
  readonly storybook: StorybookLink | null;
  /** The size this batch's stories rendered at, so a live one lays out as its image did. Null if that wasn't recorded. */
  readonly viewport: { readonly width: number; readonly height: number } | null;
  /** The stories that declared a size of their own, and rendered at that instead of `viewport`. */
  readonly storyViewports: Readonly<Record<string, { readonly width: number; readonly height: number }>>;
  /** What its Storybook calls `rows`' stories, in the order its sidebar has them, as far as its kept built Storybooks say. */
  readonly storyNames: readonly { readonly story: string; readonly title: string; readonly name: string }[];
  /** How close a diff's hunks group here, in CSS pixels. */
  readonly hunkMergeDistance: number;
  /** Who a decision made here is recorded as, or null if Git doesn't say. */
  readonly actor: string | null;
  readonly blockers: readonly Attention<BlockerReason>[];
  readonly advisories: readonly Attention<AdvisoryReason>[];
  readonly counts: {
    readonly stories: number;
    readonly unchanged: number;
    readonly changed: number;
    readonly added: number;
    readonly removed: number;
    readonly failed: number;
    readonly undecided: number;
    readonly advisories: number;
  };
  /** Everything that isn't unchanged, and anything with an advisory, in name order. */
  readonly rows: readonly RenderRow[];
  /** How many approved stories the batch's filter left out, which aren't in `rows` and say nothing about being gone. */
  readonly outsideFilter: number;
  /** Every batch at this SHA and environment, newest first, this one included. */
  readonly siblings: readonly BatchListing[];
}

/** A story's newest image at HEAD, from whichever batch took it. */
export interface StoryRenderInfo {
  readonly batchId: string;
  readonly state: RenderRow["state"];
  readonly decision: RenderRow["decision"];
  readonly renderedAt: number;
  /** Recorded with uncommitted changes, so it can't become a golden. */
  readonly dirty: boolean;
  /** Whether the hosted built Storybook rendered it, or null if that's not known. If not, it may be out of date. */
  readonly fromHostedStorybook: boolean | null;
}

export interface ListedStory {
  readonly story: string;
  /** Its path in the Storybook's sidebar, such as `Pages/Batch`, or nothing if that's not known. */
  readonly title: string;
  /** What the sidebar calls it, or its ID if that's not known. */
  readonly name: string;
  /** Null if no batch at HEAD has rendered it. */
  readonly render: StoryRenderInfo | null;
}

/** What a server that hosts a Storybook can say about it. */
export interface StorySetup {
  /** Where it looks for a built Storybook, from the Git top level. */
  readonly storybookDir: string;
  /** How the config says to build one. */
  readonly buildCommand: string;
  /** What differs from HEAD now, as Git names it, which a render now would be marked with. */
  readonly uncommitted: readonly string[];
  /** The hosted built Storybook is older than HEAD's last move, so it can't be of this commit. */
  readonly builtBeforeHead: boolean;
  /** Renders in the pinned container, and not in this machine's browser. */
  readonly usesDocker: boolean;
}

/** Every story of the hosted Storybook, each with its newest render, which a single batch is a special case of. */
export interface StoriesView {
  readonly head: string | null;
  /** The branch HEAD is on, or null if it's detached. */
  readonly branch: string | null;
  /** The hosted Storybook as it stands, or null if there's no built Storybook there. */
  readonly storybookUrl: string | null;
  /** The size a story renders at here now, unless it declares its own, which only rendering it says. */
  readonly viewport: { readonly width: number; readonly height: number };
  /** In the order the Storybook's sidebar shows them. */
  readonly stories: readonly ListedStory[];
  /** The newest finished batch at HEAD, to review. */
  readonly newestBatchId: string | null;
  /** Whether this server can render a story when asked, which takes a commit, a built Storybook, and a browser to do it with. */
  readonly canRender: boolean;
  /** Null if this server hosts no Storybook. */
  readonly setup: StorySetup | null;
}

export interface ApiError {
  readonly error: { readonly code: string; readonly message: string };
}

export interface DecisionTarget {
  readonly story: string;
  /** Null for a story that's gone. */
  readonly imageHash: string | null;
}

/** `draft` is still the person's, `sent` is the agent's to act on, and `replied` and `resolved` are the person's to look at, or done. */
export type NoteState = "draft" | "sent" | "replied" | "resolved";

/** One thing said about a note, which is a draft until it's sent. */
export interface NoteMessage {
  readonly id: number;
  readonly sender: "person" | "agent";
  readonly author: string;
  readonly text: string;
  readonly batchId: string | null;
  readonly at: number;
  readonly sent: boolean;
}

/** Where something a person wants to talk about is: on a story, on an image, and maybe a box of it. */
export interface Note {
  readonly id: number;
  readonly story: string;
  readonly batchId: string;
  /** The image it's about, or null for a story with no image, such as one that failed. */
  readonly imageHash: string | null;
  /** Null for all of the image. */
  readonly box: BoundingBox | null;
  readonly state: NoteState;
  readonly messages: readonly NoteMessage[];
}

export type NewNote = Pick<Note, "story" | "batchId" | "imageHash" | "box"> & { readonly text: string };

/** One session's notes, which is one local folder's. */
export interface FeedbackView {
  /** Only its name, since a response never holds a path. */
  readonly folder: string;
  readonly notes: readonly Note[];
  /** Whether `selfie agent-await-feedback` is running in this folder now. */
  readonly agentWaiting: boolean;
  /** The newest batch recorded from this folder, which is the one to look at, if it's known. */
  readonly latestBatchId: string | null;
}

/** `agent` to a waiting agent, or `copy` if the person is pasting them somewhere themselves. */
export type SendVia = "agent" | "copy";

/** The render running from a page, which `render` holds to one at a time. */
export interface RenderProgress {
  /** Stories this render has to do. */
  readonly total: number;
  /** Stories finished so far, failed or not. */
  readonly finished: number;
  /** When the render was asked for, in milliseconds since the epoch. The page and a local server share a clock. */
  readonly startedAtMs: number;
  /** When its first story started, or null until then. */
  readonly firstStoryStartedAtMs: number | null;
}

/**
 * The seam between the routes and a platform: how they reach a project's data. `cli/src/ui.ts`
 * implements it for a local repository. An error with a `code` from `ERROR_STATUS` becomes that
 * status with its message.
 */
export interface ReviewSource {
  storiesView(): Promise<StoriesView>;
  /** Records a batch of just these stories from the hosted Storybook, one at a time. */
  render(stories: readonly string[]): Promise<{ readonly batchId: string }>;
  /** How the render in flight is going, or null with none. */
  renderProgress(): Promise<RenderProgress | null>;
  batchView(batchId: string): Promise<BatchView>;
  batchContext(batchId: string): Promise<BatchContext>;
  unchanged(batchId: string): Promise<readonly RenderRow[]>;
  /** Decides on exactly these images, or refuses all of them if one isn't what the batch holds. */
  decide(batchId: string, decision: DecisionKind, targets: readonly DecisionTarget[]): Promise<BatchView>;
  feedback(): Promise<FeedbackView>;
  addNote(note: NewNote): Promise<FeedbackView>;
  removeNote(id: number): Promise<FeedbackView>;
  answerNote(id: number, text: string, batchId: string): Promise<FeedbackView>;
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
