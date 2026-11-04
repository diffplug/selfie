// What a commit's status says, from what its batch reads as. See docs/specs/cloud.md -> Commit status.
import { summarizeBatch, type Comparison } from "selfie-store";
import { plural } from "./plural.ts";

export type CommitState = "success" | "pending" | "failure";

export interface CommitStatus {
  readonly state: CommitState;
  /** GitHub takes at most 140 characters. */
  readonly description: string;
}

/** Red if someone has to change the code, yellow if someone has to look, and green if neither. */
export function commitStatusOf(comparison: Comparison): CommitStatus {
  const { failed, unapproved, undecided, counts } = summarizeBatch(comparison);
  const rejected = unapproved.length - undecided.length;
  if (failed.length > 0 || rejected > 0) {
    const parts = [failed.length > 0 ? `${plural(failed.length, "story", "stories")} failed` : null, rejected > 0 ? `${plural(rejected, "change")} rejected` : null];
    return { state: "failure", description: parts.filter((part) => part !== null).join(", ") };
  }
  if (undecided.length > 0) {
    const states = (state: string) => undecided.filter((render) => render.state === state).length;
    const parts = [["changed", states("changed")], ["added", states("added")], ["removed", states("removed")]] as const;
    return { state: "pending", description: `${parts.filter(([, n]) => n > 0).map(([word, n]) => `${n} ${word}`).join(", ")}, waiting for approval` };
  }
  return { state: "success", description: counts.stories === 1 ? "1 story matches what's approved" : `${plural(counts.stories, "story", "stories")} match what's approved` };
}
