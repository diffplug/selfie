// The library behind the `selfie` CLI, for any caller that wants results rather than a process:
// plain data, with no printing and no exit codes. See `docs/specs/cli.md` -> Library.
export { resolveCaptureSettings, type CaptureSettings } from "./config.ts";
export {
  accept,
  checkAccept,
  decide,
  type AcceptCheck,
  type AcceptRefusal,
  type AcceptRequest,
  type AcceptResult,
  type DecideRequest,
  type DecideResult,
} from "./decisions.ts";
export type { BoundingBox, PixelDiff } from "./diff.ts";
export { SelfieError, type SelfieErrorCode } from "./errors.ts";
export { gitUserEmail, type Baseline, type BaselineSearch, type NoBaselineReason } from "./git.ts";
export {
  compareAsReviewed,
  findBaseline,
  openProject,
  readReviewCache,
  type Project,
  type ReviewCache,
} from "./project.ts";
export { review, type Difference, type ReviewOptions, type ReviewResult } from "./review.ts";
export {
  isDecidable,
  summarizeRun,
  type AdvisoryReason,
  type Attention,
  type BlockerReason,
  type RunSummary,
} from "./summary.ts";
