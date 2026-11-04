// What a batch's screens all say about the batch as a whole.
import { Banner } from "@primer/react";
import type { BatchView } from "../shared/api.ts";
import { fetchBaseline } from "./api.ts";
import { useFetched, type BatchState } from "./hooks.ts";
import { shortSha } from "./words.tsx";

export function ActionFailedBanner({ error, onDismiss }: { readonly error: Error; readonly onDismiss: () => void }) {
  return <Banner variant="critical" title="That didn't happen" description={error.message} onDismiss={onDismiss} />;
}

export function ActionFailure({ state }: { readonly state: BatchState }) {
  const { actionError, clearActionError, loadError } = state;
  if (actionError !== null) return <ActionFailedBanner error={actionError} onDismiss={clearActionError} />;
  if (loadError !== null) {
    return <Banner variant="warning" title="This may be out of date" description={loadError.message} />;
  }
  return null;
}

/** Whether later reviews could compare with these images, and what this one compared them with. */
export function BatchNotes({ view: { batch, usableAsBaseline, branchGoldens } }: { readonly view: BatchView }) {
  // Git says why there's no baseline, and only a batch without one needs to ask.
  const noBaseline = batch.baselineSha === null && branchGoldens === null;
  const { data: baseline } = useFetched(noBaseline ? batch.id : null, (signal) => fetchBaseline(batch.id, signal));
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
          description={`There were no goldens to compare with, so every story reads as added and needs an approval. ${baseline?.message ?? ""}`}
        />
      )}
      {!usableAsBaseline && (
        <Banner
          variant="warning"
          title="This commit won't be a baseline"
          description={`${shortSha(batch.gitSha)} isn't on the default branch's first-parent history. It can be accepted, and later reviews on this branch will compare with it, but only goldens on the default branch are a baseline. To make one, review and accept on the default branch.`}
        />
      )}
    </>
  );
}
