// What a screen says when something it asked for did not happen.
import { Banner } from "@primer/react";
import { RequestError } from "./api.ts";
import type { BatchState } from "./hooks.ts";

/** What went wrong, and on a line of its own the code the server logged it under, so it can be found there. */
export function ErrorText({ error }: { readonly error: Error }) {
  const id = error instanceof RequestError ? error.id : null;
  return (
    <>
      {error.message}
      {id !== null && (
        <>
          <br />
          Error code: {id}
        </>
      )}
    </>
  );
}

export function ActionFailedBanner({ error, onDismiss }: { readonly error: Error; readonly onDismiss: () => void }) {
  return <Banner variant="critical" title="That didn't happen" description={<ErrorText error={error} />} onDismiss={onDismiss} />;
}

export function ActionFailure({ state }: { readonly state: BatchState }) {
  const { actionError, clearActionError, loadError } = state;
  if (actionError !== null) return <ActionFailedBanner error={actionError} onDismiss={clearActionError} />;
  if (loadError !== null) {
    return <Banner variant="warning" title="This may be out of date" description={<ErrorText error={loadError} />} />;
  }
  return null;
}
