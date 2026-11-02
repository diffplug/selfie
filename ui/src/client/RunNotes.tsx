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
export function RunNotes({ view: { run, usableAsBaseline } }: { readonly view: RunView }) {
  // Git says why there's no baseline, and only a run without one needs to ask.
  const noBaseline = run.baselineSha === null;
  const { data: baseline } = useFetched(noBaseline ? run.id : null, (signal) => fetchBaseline(run.id, signal));
  return (
    <>
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
          title="This commit can't be a baseline"
          description={`${shortSha(run.gitSha)} isn't on the default branch's first-parent history. It can be accepted, but later reviews won't read its goldens. To make a baseline, review and accept on the default branch.`}
        />
      )}
    </>
  );
}
