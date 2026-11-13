// What a commit's status says, from what its batch reads as. See docs/specs/cloud.md -> Commit status.
import { summarizeBatch, type ComparedRender, type Comparison } from "selfie-store";
import { plural } from "./plural.ts";

export type CommitState = "success" | "pending" | "failure";

export interface CommitStatus {
  readonly state: CommitState;
  /** GitHub takes at most 140 characters. */
  readonly description: string;
}

/** A batch's base on the default branch, and how the batch compares with its images. */
export interface SinceBase {
  /** The default branch's name, as the description says it. */
  readonly branch: string;
  /** From `RenderBatches.compareWithBaseReached`: what differs from the base, and nothing else. */
  readonly comparison: Comparison;
}

const MAX_DESCRIPTION = 140;

/**
 * Red if someone has to change the code, yellow if someone has to look, and green if neither. Given its base, what waits
 * for approval is told apart: what the branch changed, and what it inherited, where the base has the very same image.
 */
export function commitStatusOf(comparison: Comparison, base?: SinceBase): CommitStatus {
  const { failed, unapproved, undecided, counts } = summarizeBatch(comparison);
  const rejected = unapproved.length - undecided.length;
  if (failed.length > 0 || rejected > 0) {
    const parts = [failed.length > 0 ? `${plural(failed.length, "story", "stories")} failed` : null, rejected > 0 ? `${plural(rejected, "change")} rejected` : null];
    return { state: "failure", description: parts.filter((part) => part !== null).join(", ") };
  }
  if (undecided.length > 0) {
    if (base === undefined) return { state: "pending", description: `${byState(undecided)}, waiting for approval` };
    const differs = new Set(base.comparison.renders.map(({ story }) => story));
    const own = undecided.filter(({ story }) => differs.has(story));
    const inherited = undecided.length - own.length;
    const description = (branch: string) =>
      own.length === 0
        ? `Changes nothing from ${branch}; ${inherited} inherited ${inherited === 1 ? "change waits" : "changes wait"} for approval`
        : inherited === 0
          ? `${byState(own)} by this branch, waiting for approval`
          : `${byState(own)} by this branch, and ${inherited} inherited from ${branch}, waiting for approval`;
    const named = description(base.branch);
    return { state: "pending", description: named.length <= MAX_DESCRIPTION ? named : description("the default branch") };
  }
  return { state: "success", description: counts.stories === 1 ? "1 story matches what's approved" : `${plural(counts.stories, "story", "stories")} match what's approved` };
}

/** "21 changed, 11 added", leaving out a state with none. */
function byState(renders: readonly ComparedRender[]): string {
  const states = (state: string) => renders.filter((render) => render.state === state).length;
  const parts = [["changed", states("changed")], ["added", states("added")], ["removed", states("removed")]] as const;
  return parts
    .filter(([, n]) => n > 0)
    .map(([word, n]) => `${n} ${word}`)
    .join(", ");
}
