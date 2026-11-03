import { useCallback, useEffect, useRef, useState } from "react";
import type { AcceptRefusal, DecisionKind, DecisionTarget, FeedbackView, StoriesView, NewNote, RunView, SendVia, SnapshotRow } from "../shared/api.ts";
import { deleteNote, fetchFeedback, fetchStories, fetchRun, fetchUnchanged, postAccept, postAnswer, postRender, postDecision, postNote, postResolve, postSendNotes, RequestError } from "./api.ts";
import { reuseRows } from "./filter.ts";
import { toggled } from "./selection.ts";

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
      // A checkbox takes no typing, and keeping the keys after clicking one is the point of having them.
      if (target?.closest("input:not([type=checkbox]), textarea, select, [contenteditable], [role=dialog], [role=alertdialog]")) return;
      const handler = current.current[event.key];
      if (handler === undefined) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

export interface FeedbackState {
  readonly view: FeedbackView | null;
  /** Why the last change didn't happen. */
  readonly error: RequestError | null;
  readonly clearError: () => void;
  /** True if the note was saved. */
  readonly add: (note: NewNote) => Promise<boolean>;
  readonly remove: (id: number) => Promise<void>;
  /** True if the answer was saved. */
  readonly answer: (id: number, text: string, runId: string) => Promise<boolean>;
  readonly resolve: (id: number) => Promise<void>;
  /** The text to paste into an agent, or null if the request failed. */
  readonly send: (via: SendVia) => Promise<string | null>;
}

/** How often to look for what an agent or another tab did, since nothing tells this page. */
const FEEDBACK_READ_MS = 2_000;

/** One folder's notes, as the server last described them. */
export function useFeedback(): FeedbackState {
  const [view, setView] = useState<FeedbackView | null>(null);
  const [error, setError] = useState<RequestError | null>(null);
  // At most one read is on its way, and an action's answer aborts it, so a slow read can't undo it.
  const reading = useRef<AbortController | null>(null);
  // Most reads find nothing new, and that shouldn't redraw a page someone is reading.
  const apply = useCallback((next: FeedbackView) => setView((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next)), []);

  useEffect(() => {
    const read = () => {
      reading.current?.abort();
      const controller = new AbortController();
      reading.current = controller;
      // A missed read is made up by the next, and an action says for itself if the server is gone.
      fetchFeedback(controller.signal).then(apply, () => undefined);
    };
    read();
    const timer = setInterval(read, FEEDBACK_READ_MS);
    window.addEventListener("focus", read);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", read);
      reading.current?.abort();
    };
  }, [apply]);

  const act = async <T,>(work: () => Promise<T>, take: (answer: T) => FeedbackView): Promise<T | null> => {
    setError(null);
    try {
      const answer = await work();
      reading.current?.abort();
      apply(take(answer));
      return answer;
    } catch (failure) {
      setError(asRequestError(failure));
      return null;
    }
  };

  return {
    view,
    error,
    clearError: useCallback(() => setError(null), []),
    add: async (note) => (await act(() => postNote(note), (next) => next)) !== null,
    remove: async (id) => void (await act(() => deleteNote(id), (next) => next)),
    answer: async (id, text, runId) => (await act(() => postAnswer(id, text, runId), (next) => next)) !== null,
    resolve: async (id) => void (await act(() => postResolve(id), (next) => next)),
    send: async (via) => (await act(() => postSendNotes(via), ({ feedback }) => feedback))?.text ?? null,
  };
}

export interface RegionSelection {
  readonly selected: ReadonlySet<number>;
  readonly focused: number | null;
  readonly toggle: (index: number) => void;
  readonly setSelected: (selected: ReadonlySet<number>) => void;
  readonly setFocused: (focused: number) => void;
}

/** Regions picked out by their place in a story's list, which last only as long as someone stays on `story`. */
export function useRegionSelection(story: string): RegionSelection {
  const nothing = () => ({ story, selected: new Set<number>() as ReadonlySet<number>, focused: null as number | null });
  const [state, setState] = useState(nothing);
  // Forgotten on leaving, and not just hidden, so coming back can't bring it back.
  if (state.story !== story) setState(nothing());
  return {
    selected: state.selected,
    focused: state.focused,
    // From what's latest, since one click can set both.
    toggle: (index) => setState((latest) => ({ ...latest, selected: toggled(latest.selected, index) })),
    setSelected: (selected) => setState((latest) => ({ ...latest, selected })),
    setFocused: (focused) => setState((latest) => ({ ...latest, focused })),
  };
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

/**
 * Every story of the hosted Storybook, as the server last described them. Read again whenever the
 * page regains focus, or something new is recorded, since an agent records from outside this page.
 */
export function useStories(latestRunId: string | null | undefined): { readonly view: StoriesView | null; readonly error: RequestError | null; readonly reload: () => void; readonly recheck: () => void } {
  const [view, setView] = useState<StoriesView | null>(null);
  const [error, setError] = useState<RequestError | null>(null);
  const reading = useRef<AbortController | null>(null);
  const reload = useCallback(() => {
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    fetchStories(controller.signal).then(
      (next) => {
        // Most reads find nothing new, and that shouldn't redraw a list someone is reading.
        setView((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
        setError(null);
      },
      (failed: unknown) => {
        if (!controller.signal.aborted) setError(asRequestError(failed));
      },
    ).finally(() => {
      if (reading.current === controller) reading.current = null;
    });
  }, []);
  /** For a timer: nothing's waiting on it, so it lets a read finish, and rests while nobody's looking. */
  const recheck = useCallback(() => {
    if (!document.hidden && reading.current === null) reload();
  }, [reload]);
  useEffect(() => {
    reload();
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener("focus", reload);
      reading.current?.abort();
    };
  }, [reload]);
  // Not on first learning it, which says nothing has been recorded since this page read.
  const lastRun = useRef(latestRunId);
  useEffect(() => {
    const known = lastRun.current;
    lastRun.current = latestRunId;
    if (known !== undefined && known !== latestRunId) reload();
  }, [latestRunId, reload]);
  return { view, error, reload, recheck };
}

export interface RenderState {
  readonly can: boolean;
  /** How many stories are being rendered right now. */
  readonly rendering: number;
  readonly error: RequestError | null;
  readonly clearError: () => void;
  /** Says whether it worked. If it didn't, `error` says why. */
  readonly render: (stories: readonly string[]) => Promise<boolean>;
}

/** Asks the server to render stories, and reads every story again once it has. */
export function useRender(can: boolean, onRendered: () => void): RenderState {
  const [rendering, setRendering] = useState(0);
  const [error, setError] = useState<RequestError | null>(null);
  return {
    can,
    rendering,
    error,
    clearError: useCallback(() => setError(null), []),
    render: async (stories) => {
      setRendering(stories.length);
      setError(null);
      try {
        await postRender(stories);
        onRendered();
        return true;
      } catch (failed) {
        setError(asRequestError(failed));
        return false;
      } finally {
        setRendering(0);
      }
    },
  };
}

/** Next and previous move focus through a list of stories' links. */
export function useStoryFocusKeys(): void {
  const moveFocus = (delta: number) => {
    const links = [...document.querySelectorAll<HTMLElement>("[data-story]")];
    if (links.length === 0) return;
    const at = links.indexOf(document.activeElement as HTMLElement);
    links[at === -1 ? 0 : Math.max(0, Math.min(links.length - 1, at + delta))]?.focus();
  };
  useHotkeys({ j: () => moveFocus(1), k: () => moveFocus(-1) });
}

/** Device pixels per CSS pixel, which changes with browser zoom or on moving to another display. */
export function useDevicePixelRatio(): number {
  const [ratio, setRatio] = useState(window.devicePixelRatio);
  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${ratio}dppx)`);
    const update = () => setRatio(window.devicePixelRatio);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [ratio]);
  return ratio;
}
