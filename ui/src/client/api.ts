// Every request the page makes. Image URLs are built here too, so screens never spell out a route.
import {
  REQUEST_HEADER,
  REQUEST_HEADER_VALUE,
  type AcceptOutcome,
  type ApiError,
  type BaselineNote,
  type BatchContext,
  type DecisionKind,
  type DecisionTarget,
  type FeedbackView,
  type NewNote,
  type PixelDiff,
  type BatchView,
  type RenderProgress,
  type SendVia,
  type RenderRow,
  type StoriesView,
} from "../shared/api.ts";

/** What went wrong, in words a screen can show. `code` tells the cases apart. */
export class RequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new RequestError("unreachable", "Can't reach the Selfie server. Is selfie ui still running?");
  }
  const body = (await response.json().catch(() => null)) as T | ApiError | null;
  if (!response.ok || body === null) {
    const error = (body as ApiError | null)?.error;
    throw new RequestError(error?.code ?? "bad-response", error?.message ?? `The server answered ${response.status}.`);
  }
  return body as T;
}

const WRITE_HEADERS = { "Content-Type": "application/json", [REQUEST_HEADER]: REQUEST_HEADER_VALUE };

const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", headers: WRITE_HEADERS, body: JSON.stringify(body) });

const batchRoute = (batchId: string) => `/batches/${encodeURIComponent(batchId)}`;

export const fetchBatch = (batchId: string, signal: AbortSignal) => request<BatchView>(batchRoute(batchId), { signal });
export const fetchBatchContext = (batchId: string, signal: AbortSignal) => request<BatchContext>(`/batches/${encodeURIComponent(batchId)}/context`, { signal });
export const fetchBaseline = (batchId: string, signal: AbortSignal) => request<BaselineNote>(`${batchRoute(batchId)}/baseline`, { signal });
export const fetchUnchanged = async (batchId: string) => (await request<{ rows: readonly RenderRow[] }>(`${batchRoute(batchId)}/unchanged`)).rows;
export const fetchDiff = (current: string, golden: string, signal: AbortSignal) => request<PixelDiff>(`/diffs/${current}/${golden}`, { signal });

export const postDecision = (batchId: string, decision: DecisionKind, renders: readonly DecisionTarget[]) =>
  post<BatchView>(`${batchRoute(batchId)}/decisions`, { decision, renders });
export const postAccept = (batchId: string, removedSeen: number | undefined) =>
  post<AcceptOutcome>(`${batchRoute(batchId)}/accept`, removedSeen === undefined ? {} : { removedSeen });

export const fetchStories = (signal: AbortSignal) => request<StoriesView>("/stories", { signal });
export const postRender = (stories: readonly string[]) => post<{ readonly batchId: string }>("/renders", { stories });
export const fetchRenderProgress = (signal: AbortSignal) => request<{ readonly progress: RenderProgress | null }>("/renders/progress", { signal });
export const fetchFeedback = (signal: AbortSignal) => request<FeedbackView>("/feedback", { signal });
export const postNote = (note: NewNote) => post<FeedbackView>("/notes", note);
export const postSendNotes = (via: SendVia) => post<{ readonly feedback: FeedbackView; readonly text: string }>("/notes/send", { via });
export const postAnswer = (id: number, text: string, batchId: string) => post<FeedbackView>(`/notes/${id}/answers`, { text, batchId });
export const postResolve = (id: number) => post<FeedbackView>(`/notes/${id}/resolve`, {});
export const deleteNote = (id: number) => request<FeedbackView>(`/notes/${id}`, { method: "DELETE", headers: WRITE_HEADERS });

export const imageUrl = (hash: string) => `/api/images/${hash}`;
export const diffImageUrl = (current: string, golden: string) => `/api/diffs/${current}/${golden}/image`;
