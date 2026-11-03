// What the top bar says this page is looking at. Screens below it know, so they tell it.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Run, RunContext, StoriesView } from "../shared/api.ts";
import { shortSha } from "./words.tsx";

export type PageFacts =
  | { readonly kind: "view"; readonly view: Pick<StoriesView, "head" | "branch" | "storybookUrl" | "setup"> }
  | { readonly kind: "diff"; readonly run: Pick<Run, "gitSha" | "dirty" | "baselineSha">; readonly branchGoldens: string | null; readonly context: RunContext | null };

const Sha = ({ sha }: { sha: string }) => <code title={sha}>{shortSha(sha)}</code>;

function ofHead(sha: string, head: string | null, branch: string | null): ReactNode {
  if (sha !== head) return null;
  return branch === null ? ", HEAD" : <>, HEAD of <code>{branch}</code></>;
}

function ViewFacts({ view: { head, branch, storybookUrl, setup } }: { view: Extract<PageFacts, { kind: "view" }>["view"] }) {
  if (head === null) return branch === null ? <>No commits yet</> : <>No commits yet on <code>{branch}</code></>;
  const at = (
    <>
      <Sha sha={head} />
      {ofHead(head, head, branch)}
    </>
  );
  if (storybookUrl === null) return <>No built Storybook for {at}</>;
  if (setup?.builtFrom === "before-head") return <>Built Storybook from before {at}</>;
  return (
    <>
      Built Storybook for {at}
      {setup?.builtFrom === "uncommitted" && ", with uncommitted changes"}
    </>
  );
}

function Against({ run, branchGoldens, context }: Omit<Extract<PageFacts, { kind: "diff" }>, "kind">) {
  const sha = branchGoldens ?? run.baselineSha;
  if (sha === null) return <>, with no goldens to compare with</>;
  const relation =
    branchGoldens !== null ? (
      "the nearest goldens on its branch"
    ) : context === null ? null : context.defaultBranch === null ? (
      "the nearest goldens"
    ) : sha === context.mergeBase ? (
      <>the merge base with <code>{context.defaultBranch}</code></>
    ) : (
      <>the nearest goldens before the merge base with <code>{context.defaultBranch}</code></>
    );
  return (
    <>
      , and <Sha sha={sha} />
      {relation !== null && <>, {relation}</>}
    </>
  );
}

export function PageFactsLine({ facts }: { facts: PageFacts }) {
  if (facts.kind === "view") return <ViewFacts view={facts.view} />;
  const { run, branchGoldens, context } = facts;
  const hasGoldens = (branchGoldens ?? run.baselineSha) !== null;
  return (
    <>
      {hasGoldens ? "Built Storybook diff between" : "Built Storybook for"} <Sha sha={run.gitSha} />
      {context !== null && ofHead(run.gitSha, context.head, context.branch)}
      {run.dirty && ", with uncommitted changes"}
      <Against {...facts} />
    </>
  );
}

const Tell = createContext<(facts: PageFacts | null) => void>(() => undefined);

export function PageFactsProvider({ children }: { children: (facts: PageFacts | null) => ReactNode }) {
  const [facts, setFacts] = useState<PageFacts | null>(null);
  return <Tell.Provider value={setFacts}>{children(facts)}</Tell.Provider>;
}

/** Says what the top bar should, for as long as this screen is up. */
export function usePageFacts(facts: PageFacts | null): void {
  const tell = useContext(Tell);
  // By value, since a screen makes a new object on every read of the same thing.
  const key = JSON.stringify(facts);
  useEffect(() => {
    tell(facts);
    return () => tell(null);
  }, [key, tell]);
}
