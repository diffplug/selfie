import { describe, expect, it } from "vitest";
import type { ComparedRender, Comparison, RenderBatch, RenderState } from "selfie-store";
import { commitStatusOf } from "../src/shared/commit-status.ts";

const batch = { id: "head", storyFilter: null } as RenderBatch;
const render = (story: string, state: RenderState, decision: ComparedRender["decision"] = null): ComparedRender => ({
  story,
  state,
  imageHash: state === "removed" ? null : `${story}-image`,
  goldenHash: state === "added" ? null : `${story}-golden`,
  failure: state === "failed" ? "Boom" : null,
  decision,
});
const comparison = (renders: readonly ComparedRender[], unchangedCount = 0): Comparison => ({ batch, renders, unchangedCount });
/** A base that differs from the head in just these stories. */
const base = (...stories: string[]) => ({ branch: "main", comparison: comparison(stories.map((story) => render(story, "changed"))) });

describe("a commit's status", () => {
  const waiting = comparison([render("a", "changed"), render("b", "changed"), render("c", "added"), render("d", "removed")], 5);

  it("counts what waits by its state, with no base", () => {
    expect(commitStatusOf(waiting)).toEqual({ state: "pending", description: "2 changed, 1 added, 1 removed, waiting for approval" });
  });

  it("says a branch that changes nothing from its base only inherits what waits", () => {
    expect(commitStatusOf(waiting, base())).toEqual({ state: "pending", description: "Changes nothing from main; 4 inherited changes wait for approval" });
    expect(commitStatusOf(comparison([render("a", "added")]), base()).description).toBe("Changes nothing from main; 1 inherited change waits for approval");
  });

  it("counts what the branch changed by its state, apart from what it inherited", () => {
    expect(commitStatusOf(waiting, base("a", "d", "unlisted"))).toEqual({ state: "pending", description: "1 changed, 1 removed by this branch, and 2 inherited from main, waiting for approval" });
  });

  it("leaves out inheriting when everything that waits is the branch's own", () => {
    expect(commitStatusOf(waiting, base("a", "b", "c", "d")).description).toBe("2 changed, 1 added, 1 removed by this branch, waiting for approval");
  });

  it("stays within GitHub's 140 characters, naming the default branch generically if its name is too long", () => {
    const { description } = commitStatusOf(waiting, { ...base("a"), branch: "x".repeat(120) });
    expect(description).toBe("1 changed by this branch, and 3 inherited from the default branch, waiting for approval");
    expect(description.length).toBeLessThanOrEqual(140);
  });

  it("keeps red and green as they are, whatever the base", () => {
    const approved = { decision: "approved", actor: "ned", at: 1 } as const;
    expect(commitStatusOf(comparison([render("a", "failed"), render("b", "changed", { ...approved, decision: "rejected" })]), base())).toEqual({
      state: "failure",
      description: "1 story failed, 1 change rejected",
    });
    expect(commitStatusOf(comparison([render("a", "changed", approved)], 144), base("a"))).toEqual({ state: "success", description: "145 stories match what's approved" });
  });
});
