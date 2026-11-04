// What the top bar says this page is looking at. Screens below it know, so they tell it.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { RenderBatch, BatchContext, StoriesView } from "../shared/api.ts";
import { Sha } from "./words.tsx";

export type PageFacts =
  | { readonly kind: "view"; readonly view: Pick<StoriesView, "head" | "branch" | "storybookUrl" | "setup"> }
  | { readonly kind: "diff"; readonly batch: Pick<RenderBatch, "gitSha" | "dirty">; readonly context: BatchContext | null };

function ofHead(branch: string | null): ReactNode {
  return branch === null ? ", HEAD" : <>, HEAD of <code>{branch}</code></>;
}

function ViewFacts({ view: { head, branch, storybookUrl, setup } }: { view: Extract<PageFacts, { kind: "view" }>["view"] }) {
  if (head === null) return branch === null ? <>No commits yet</> : <>No commits yet on <code>{branch}</code></>;
  const at = (
    <>
      <Sha sha={head} />
      {ofHead(branch)}
    </>
  );
  if (storybookUrl === null) return <>No built Storybook for {at}</>;
  return (
    <>
      Built Storybook {setup?.builtBeforeHead === true ? "from before" : "for"} {at}
      {(setup?.uncommitted.length ?? 0) > 0 && ", with uncommitted changes"}
    </>
  );
}

export function PageFactsLine({ facts }: { facts: PageFacts }) {
  if (facts.kind === "view") return <ViewFacts view={facts.view} />;
  const { batch, context } = facts;
  return (
    <>
      Built Storybook diff between <Sha sha={batch.gitSha} />
      {context?.head === batch.gitSha && ofHead(context.branch)}
      {batch.dirty && ", with uncommitted changes"}
      , and what its history has approved
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
