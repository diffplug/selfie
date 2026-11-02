import { useCallback, useEffect, useRef, useState } from "react";
import type { AcceptRefusal, DecisionKind, DecisionTarget, RunView, SnapshotRow } from "../shared/api.ts";
import { fetchRun, fetchUnchanged, postAccept, postDecision, RequestError } from "./api.ts";
import { reuseRows } from "./filter.ts";

export interface RunState {
  readonly view: RunView | null;
  /** Why the run couldn't be read. */
  readonly loadError: RequestError | null;
  /** Why the last action didn't happen. */
  readonly actionError: RequestError | null;
  readonly busy: boolean;
  readonly unchanged: readonly SnapshotRow[] | null;
  readonly loadUnchanged: () => void;
  readonly clearActionError: () => void;
  /** True if the decision was recorded. */
  readonly decide: (decision: DecisionKind, targets: readonly DecisionTarget[]) => Promise<boolean>;
  /** The refusals, or null if the request never got an answer. */
  readonly accept: (removedSeen: number | undefined) => Promise<{ accepted: boolean; refusals: readonly AcceptRefusal[] } | null>;
}

const asRequestError = (error: unknown) =>
  error instanceof RequestError ? error : new RequestError("unexpected", (error as Error).message);

/**
 * One run as the server last described it. Every action answers with a new description, and the
 * page reads again whenever it regains focus, since a CLI or another tab may have decided too.
 */
export function useRun(runId: string): RunState {
  const [view, setView] = useState<RunView | null>(null);
  const [loadError, setLoadError] = useState<RequestError | null>(null);
  const [actionError, setActionError] = useState<RequestError | null>(null);
  const [busy, setBusy] = useState(false);
  const [unchanged, setUnchanged] = useState<readonly SnapshotRow[] | null>(null);
  // At most one read is on its way, and a newer read or an action's answer aborts it, so a slow read
  // can't undo either.
  const reading = useRef<AbortController | null>(null);

  const apply = useCallback((next: RunView) => {
    setView((previous) => (previous === null ? next : { ...next, rows: reuseRows(previous.rows, next.rows) }));
    setLoadError(null);
  }, []);

  const read = useCallback(() => {
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    fetchRun(runId, controller.signal).then(apply, (error: unknown) => {
      if (!controller.signal.aborted) setLoadError(asRequestError(error));
    });
  }, [runId, apply]);

  useEffect(() => {
    read();
    window.addEventListener("focus", read);
    return () => {
      window.removeEventListener("focus", read);
      reading.current?.abort();
    };
  }, [read]);

  const loadUnchanged = useCallback(() => {
    fetchUnchanged(runId).then(setUnchanged, (error: unknown) => setActionError(asRequestError(error)));
  }, [runId]);

  const act = async <T,>(work: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setActionError(null);
    try {
      const answer = await work();
      reading.current?.abort();
      return answer;
    } catch (error) {
      setActionError(asRequestError(error));
      // Whatever was refused, the screen may be out of date, which may be why.
      read();
      return null;
    } finally {
      setBusy(false);
    }
  };

  return {
    view,
    loadError,
    actionError,
    busy,
    unchanged,
    loadUnchanged,
    clearActionError: useCallback(() => setActionError(null), []),
    decide: async (decision, targets) => {
      const next = await act(() => postDecision(runId, decision, targets));
      if (next !== null) apply(next);
      return next !== null;
    },
    accept: async (removedSeen) => {
      const outcome = await act(() => postAccept(runId, removedSeen));
      if (outcome === null) return null;
      apply(outcome.view);
      return { accepted: outcome.accepted, refusals: outcome.refusals };
    },
  };
}

/** Calls these for single-key presses, unless someone is typing or a dialog has the keyboard. */
export function useHotkeys(keys: Readonly<Record<string, () => void>>): void {
  const current = useRef(keys);
  current.current = keys;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never a held key, which would approve one image after another with nobody looking.
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || event.repeat) return;
      const target = event.target as Element | null;
      if (target?.closest("input, textarea, select, [contenteditable], [role=dialog], [role=alertdialog]")) return;
      const handler = current.current[event.key];
      if (handler === undefined) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

export function useTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} - Selfie review`;
  }, [title]);
}

/** Runs once on mount and again when `key` changes, for data a screen fetches for itself. */
export function useFetched<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>): { data: T | null; error: RequestError | null } {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: RequestError | null }>({
    key: null,
    data: null,
    error: null,
  });
  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    load(controller.signal).then(
      (data) => setState({ key, data, error: null }),
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ key, data: null, error: asRequestError(error) });
      },
    );
    return () => controller.abort();
    // `load` is a function of `key`.
  }, [key]);
  return state.key === key ? state : { data: null, error: null };
}
