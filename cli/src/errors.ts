export type SelfieErrorCode =
  | "not-a-repository"
  | "no-commits"
  | "git-failed"
  | "bad-config"
  | "no-config"
  | "old-store"
  | "build-failed"
  | "no-stories"
  | "head-moved"
  | "bad-batch-id"
  | "unknown-batch"
  | "unknown-baseline"
  | "missing-image"
  | "corrupt-image"
  | "no-actor"
  | "stale-decision"
  | "no-remote"
  | "bad-remote"
  | "unknown-note"
  | "unknown-story"
  | "render-busy"
  | "render-failed"
  | "already-waiting"
  | "no-agent-waiting"
  | "usage";

/** The work couldn't be done. `code` says which case this is, for a caller that isn't reading the message. */
export class SelfieError extends Error {
  override readonly name = "SelfieError";
  readonly code: SelfieErrorCode;

  constructor(code: SelfieErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
