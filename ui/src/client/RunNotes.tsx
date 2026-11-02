// What a run's screens all say about the run as a whole.
import { Banner } from "@primer/react";
import type { RunView } from "../shared/api.ts";
import type { RunState } from "./hooks.ts";
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

/** Whether these images can ever become goldens, and whether later reviews would read them. */
export function RunNotes({ view }: { readonly view: RunView }) {
  const { run, baseline, usableAsBaseline } = view;
  return (
    <>
      {run.dirty && (
        <Banner
          variant="warning"
          title="Recorded on a dirty tree"
          description={`The tree had uncommitted changes while this rendered, so these images don't describe ${shortSha(run.gitSha)} and can't become its goldens. You can still decide on them. Commit, then run selfie review again: your approvals carry over.`}
        />
      )}
      {baseline.sha === null && (
        <Banner
          variant="info"
          title="No baseline"
          description={`There were no goldens to compare with, so every story reads as new and needs an approval. ${baseline.message ?? ""}`}
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
