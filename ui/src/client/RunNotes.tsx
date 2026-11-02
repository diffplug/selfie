// What a run's screens all say about the run as a whole.
import { Banner } from "@primer/react";
import type { RunView } from "../shared/api.ts";
import { fetchBaseline } from "./api.ts";
import { useFetched, type RunState } from "./hooks.ts";
import { shortSha } from "./words.tsx";

export function ActionFailure({ state }: { readonly state: RunState }) {
  const { actionError, clearActionError, loadError } = state;
  if (actionError !== null) {
    return <Banner variant="critical" title="That didn't happen" description={actionError.message} onDismiss={clearActionError} />;
  }
  if (loadError !== null) {
    return <Banner variant="warning" title="This may be out of date" description={loadError.message} />;
  }
  return null;
}

/** Whether later reviews could compare with these images, and what this one compared them with. */
export function RunNotes({ view: { run, usableAsBaseline, branchGoldens } }: { readonly view: RunView }) {
  // Git says why there's no baseline, and only a run without one needs to ask.
  const noBaseline = run.baselineSha === null && branchGoldens === null;
  const { data: baseline } = useFetched(noBaseline ? run.id : null, (signal) => fetchBaseline(run.id, signal));
  return (
    <>
      {branchGoldens !== null && (
        <Banner
          variant="info"
          title="Compared with this branch's goldens"
          description={`The default branch has no goldens, so this shows what changed since ${shortSha(branchGoldens)}, the nearest on this branch. That's only to look at: accepting still needs every image approved, including the ones that match.`}
        />
      )}
      {noBaseline && (
        <Banner
          variant="info"
          title="No baseline"
          description={`There were no goldens to compare with, so every story reads as new and needs an approval. ${baseline?.message ?? ""}`}
        />
      )}
      {!usableAsBaseline && (
        <Banner
          variant="warning"
          title="This commit won't be a baseline"
          description={`${shortSha(run.gitSha)} isn't on the default branch's first-parent history. It can be accepted, and later reviews on this branch will compare with it, but only goldens on the default branch are a baseline. To make one, review and accept on the default branch.`}
        />
      )}
    </>
  );
}
