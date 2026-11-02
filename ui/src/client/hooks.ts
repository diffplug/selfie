import { useCallback, useEffect, useRef, useState } from "react";
import type { DecisionKind, DecisionTarget, RunView, SnapshotRow } from "../shared/api.ts";
import { fetchRun, fetchUnchanged, postAccept, postDecision, RequestError } from "./api.ts";

export interface RunState {
  readonly view: RunView | null;
  /** Why the run couldn't be read at all. */
  readonly loadError: RequestError | null;
  /** Why the last action didn't happen. */
  readonly actionError: RequestError | null;
  readonly busy: boolean;
  readonly unchanged: readonly SnapshotRow[] | null;
  readonly reload: () => void;
  readonly loadUnchanged: () => void;
  readonly clearActionError: () => void;
  /** True if the decision was recorded. */
  readonly decide: (decision: DecisionKind, targets: readonly DecisionTarget[]) => Promise<boolean>;
  /** The refusals, or null if the request never got an answer. */
  readonly accept: (removedSeen: number | undefined) => Promise<{ accepted: boolean; refusals: RunView["refusals"] } | null>;
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
  // An answer applies only if no newer request has been sent, so a slow read can't undo an action.
  const latest = useRef(0);

  const reload = useCallback(() => {
    const ticket = ++latest.current;
    fetchRun(runId).then(
      (next) => {
        if (ticket !== latest.current) return;
        setView(next);
        setLoadError(null);
      },
      (error: unknown) => {
        if (ticket === latest.current) setLoadError(asRequestError(error));
      },
    );
  }, [runId]);

  useEffect(() => {
    setView(null);
    setLoadError(null);
    setActionError(null);
    setUnchanged(null);
    reload();
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [reload]);

  const loadUnchanged = useCallback(() => {
    fetchUnchanged(runId).then(setUnchanged, (error: unknown) => setActionError(asRequestError(error)));
  }, [runId]);

  const act = async <T,>(work: () => Promise<T>): Promise<T | null> => {
    const ticket = ++latest.current;
    setBusy(true);
    setActionError(null);
    try {
      return await work();
    } catch (error) {
      setActionError(asRequestError(error));
      // Whatever was refused, the screen may be out of date, which may be why.
      if (ticket === latest.current) reload();
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
    reload,
    loadUnchanged,
    clearActionError: useCallback(() => setActionError(null), []),
    decide: async (decision, targets) => {
      const next = await act(() => postDecision(runId, decision, targets));
      if (next === null) return false;
      setView(next);
      return true;
    },
    accept: async (removedSeen) => {
      const outcome = await act(() => postAccept(runId, removedSeen));
      if (outcome === null) return null;
      setView(outcome.view);
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
export function useFetched<T>(key: string | null, load: () => Promise<T>): { data: T | null; error: RequestError | null } {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: RequestError | null }>({
    key: null,
    data: null,
    error: null,
  });
  useEffect(() => {
    if (key === null) return;
    let live = true;
    load().then(
      (data) => {
        if (live) setState({ key, data, error: null });
      },
      (error: unknown) => {
        if (live) setState({ key, data: null, error: asRequestError(error) });
      },
    );
    return () => {
      live = false;
    };
    // `load` is a function of `key`.
  }, [key]);
  return state.key === key ? state : { data: null, error: null };
}
