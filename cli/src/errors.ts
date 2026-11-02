export type SelfieErrorCode =
  | "not-a-repository"
  | "no-commits"
  | "git-failed"
  | "bad-config"
  | "build-failed"
  | "no-stories"
  | "head-moved"
  | "bad-run-id"
  | "unknown-run"
  | "missing-image"
  | "no-actor"
  | "stale-decision"
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
