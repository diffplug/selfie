// The library behind the `selfie` CLI, for any caller that wants results rather than a process:
// plain data, with no printing and no exit codes. See `docs/specs/cli.md` -> Library.
export { resolveRenderSettings, type RenderSettings } from "./config.ts";
export {
  decide,
  type DecideRequest,
  type DecideResult,
} from "./decisions.ts";
export type { BoundingBox, PixelDiff } from "./diff.ts";
export { SelfieError, type SelfieErrorCode } from "./errors.ts";
export { gitUserEmail } from "./git.ts";
export {
  compareAsReviewed,
  openProject,
  readReviewCache,
  type Project,
  type ReviewCache,
} from "./project.ts";
export {
  renderBatch,
  review,
  type Difference,
  type RenderBatchOptions,
  type RenderBatchResult,
  type GivenBaseline,
  type ReviewOptions,
  type ReviewResult,
} from "./review.ts";
export {
  isDecidable,
  summarizeBatch,
  type AdvisoryReason,
  type Attention,
  type BlockerReason,
  type BatchSummary,
} from "./summary.ts";
