// What a screen says when something it asked for did not happen.
import { Banner } from "@primer/react";
import type { BatchState } from "./hooks.ts";

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
