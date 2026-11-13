import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { isHosted } from "./base.ts";
import type { ApprovedSinceView, SinceBaseView, DecisionKind, DecisionTarget, FeedbackView, StoriesView, NewNote, BatchView, SendVia, RenderProgress, RenderRow } from "../shared/api.ts";
import { deleteNote, fetchApprovedSince, fetchSinceBase, fetchFeedback, fetchRenderProgress, fetchStories, fetchBatch, fetchUnchanged, postAnswer, postRender, postDecision, postNote, postResolve, postSendNotes, RequestError } from "./api.ts";
import { reuseRows, withDecisionsOf } from "./filter.ts";
import { toggled } from "./selection.ts";

export interface BatchState {
  readonly view: BatchView | null;
  /** Why the batch couldn't be read. */
  readonly loadError: RequestError | null;
  /** Why the last action didn't happen. */
  readonly actionError: RequestError | null;
  readonly busy: boolean;
  readonly unchanged: readonly RenderRow[] | null;
  /** What's been approved since this batch's base, once it's read. */
  readonly approvedSince: ApprovedSinceView | null;
  /** What this batch changed since its base, approved or not, once it's read, with each decision as `view` last said. */
  readonly sinceBase: SinceBaseView | null;
  readonly loadUnchanged: () => void;
  readonly clearActionError: () => void;
  /** True if the decision was recorded. */
  readonly decide: (decision: DecisionKind, targets: readonly DecisionTarget[]) => Promise<boolean>;
}

const asRequestError = (error: unknown) =>
  error instanceof RequestError ? error : new RequestError("unexpected", (error as Error).message);

/**
 * One batch as the server last described it. Every action answers with a new description, and the
 * page reads again whenever it regains focus, since a CLI or another tab may have decided too.
 */
export function useBatch(batchId: string): BatchState {
  const [view, setView] = useState<BatchView | null>(null);
  const [loadError, setLoadError] = useState<RequestError | null>(null);
  const [actionError, setActionError] = useState<RequestError | null>(null);
  const [busy, setBusy] = useState(false);
  const [unchanged, setUnchanged] = useState<readonly RenderRow[] | null>(null);
  const [approvedSince, setApprovedSince] = useState<ApprovedSinceView | null>(null);
  const [sinceBaseRead, setSinceBaseRead] = useState<SinceBaseView | null>(null);
  // At most one read is on its way, and a newer read or an action's answer aborts it, so a slow read
  // can't undo either.
  const reading = useRef<AbortController | null>(null);

  const apply = useCallback((next: BatchView) => {
    setView((previous) => (previous === null ? next : { ...next, rows: reuseRows(previous.rows, next.rows) }));
    setLoadError(null);
  }, []);

  const read = useCallback(() => {
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    fetchBatch(batchId, controller.signal).then(apply, (error: unknown) => {
      if (!controller.signal.aborted) setLoadError(asRequestError(error));
    });
  }, [batchId, apply]);

  useEffect(() => {
    read();
    window.addEventListener("focus", read);
    return () => {
      window.removeEventListener("focus", read);
      reading.current?.abort();
    };
  }, [read]);

  // Once, since what it says of history seldom changes while someone's here, and nothing's decided by it.
  useEffect(() => {
    const controller = new AbortController();
    fetchApprovedSince(batchId, controller.signal).then(setApprovedSince, (error: unknown) => {
      if (!controller.signal.aborted) setActionError(asRequestError(error));
    });
    fetchSinceBase(batchId, controller.signal).then(setSinceBaseRead, (error: unknown) => {
      if (!controller.signal.aborted) setActionError(asRequestError(error));
    });
    return () => controller.abort();
  }, [batchId]);

  // Read once, and kept up to date with decisions from what every action answers, so it costs no reads.
  const sinceBase = useMemo(() => (sinceBaseRead === null ? null : { ...sinceBaseRead, rows: withDecisionsOf(sinceBaseRead.rows, view?.rows ?? []) }), [sinceBaseRead, view?.rows]);

  const loadUnchanged = useCallback(() => {
    fetchUnchanged(batchId).then(setUnchanged, (error: unknown) => setActionError(asRequestError(error)));
  }, [batchId]);

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
    approvedSince,
    sinceBase,
    loadUnchanged,
    clearActionError: useCallback(() => setActionError(null), []),
    decide: async (decision, targets) => {
      const next = await act(() => postDecision(batchId, decision, targets));
      if (next !== null) apply(next);
      return next !== null;
    },
  };
}

/** Calls these for single-key presses, unless someone is typing or a dialog has the keyboard. */
export function useHotkeys(keys: Readonly<Record<string, () => void>>): void {
  const current = useRef(keys);
  current.current = keys;
  // As the page commits, so that a key pressed as soon as it's up isn't lost.
  useLayoutEffect(() => {
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
  readonly answer: (id: number, text: string, batchId: string) => Promise<boolean>;
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
    // Notes stay on a person's own machine, so there's nothing to ask for.
    if (isHosted) return;
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
    answer: async (id, text, batchId) => (await act(() => postAnswer(id, text, batchId), (next) => next)) !== null,
    resolve: async (id) => void (await act(() => postResolve(id), (next) => next)),
    send: async (via) => (await act(() => postSendNotes(via), ({ feedback }) => feedback))?.text ?? null,
  };
}

export interface HunkSelection {
  readonly selected: ReadonlySet<number>;
  readonly focused: number | null;
  readonly toggle: (index: number) => void;
  readonly setSelected: (selected: ReadonlySet<number>) => void;
  readonly setFocused: (focused: number) => void;
}

/** Hunks picked out by their place in a story's list, which last only as long as someone stays on `story`. */
export function useHunkSelection(story: string): HunkSelection {
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
    document.title = `${title} - Selfie`;
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
export function useStories(latestBatchId: string | null | undefined): { readonly view: StoriesView | null; readonly error: RequestError | null; readonly reload: () => void; readonly recheck: () => void } {
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
  const lastBatch = useRef(latestBatchId);
  useEffect(() => {
    const known = lastBatch.current;
    lastBatch.current = latestBatchId;
    if (known !== undefined && known !== latestBatchId) reload();
  }, [latestBatchId, reload]);
  return { view, error, reload, recheck };
}

export interface RenderingState {
  readonly can: boolean;
  /** How many stories are being rendered right now. */
  readonly rendering: number;
  readonly error: RequestError | null;
  readonly clearError: () => void;
  /** Says whether it worked. If it didn't, `error` says why. */
  readonly render: (stories: readonly string[]) => Promise<boolean>;
}

/** Asks the server to render stories, and reads every story again once it has. */
export function useRender(can: boolean, onRendered: () => void): RenderingState {
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

const RENDER_PROGRESS_EVERY_MS = 1_000;

/**
 * While a render runs, how it's going and what time it is, once a second. The time moves whatever
 * the server says, so a slow answer doesn't look stuck, and `POST /api/renders` is what says if the
 * server has gone, so a read that fails is just tried again.
 */
export function useRenderProgress(running: boolean): { readonly progress: RenderProgress | null; readonly now: number } {
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return undefined;
    let reading = new AbortController();
    const tick = () => {
      setNow(Date.now());
      if (document.hidden) return;
      reading.abort();
      reading = new AbortController();
      fetchRenderProgress(reading.signal).then(
        (answer) => {
          // Nothing yet can mean this read overtook the request that starts the render.
          if (answer.progress !== null) setProgress(answer.progress);
        },
        () => undefined,
      );
    };
    tick();
    const timer = setInterval(tick, RENDER_PROGRESS_EVERY_MS);
    return () => {
      clearInterval(timer);
      reading.abort();
      setProgress(null);
    };
  }, [running]);
  return { progress, now };
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
