// Every request the page makes. Image URLs are built here too, so screens never spell out a route.
import {
  REQUEST_HEADER,
  REQUEST_HEADER_VALUE,
  type ApiError,
  type ApprovedSinceView,
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
import { linesOf, type ChatEvent, type ChatMessage, type ChatUpdate } from "../shared/chat.ts";
import { BASE, isHosted } from "./base.ts";

/** What went wrong, in words a screen can show. `code` tells the cases apart, and `id` is the code the server logged it under, if it did. */
export class RequestError extends Error {
  readonly code: string;
  readonly id: string | null;

  constructor(code: string, message: string, id: string | null = null) {
    super(message);
    this.code = code;
    this.id = id;
  }
}

/** An answer that's OK, or else an error saying why not. */
async function respond(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/api${path}`, init);
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new RequestError("unreachable", isHosted ? "Can't reach Selfie. Check your connection, and try again." : "Can't reach the Selfie server. Is selfie ui still running?");
  }
  if (response.ok) return response;
  const error = ((await response.json().catch(() => null)) as ApiError | null)?.error;
  throw new RequestError(error?.code ?? "bad-response", error?.message ?? `The server answered ${response.status}.`, error?.id ?? null);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await respond(path, init);
  const body = (await response.json().catch(() => null)) as T | null;
  if (body === null) throw new RequestError("bad-response", `The server answered ${response.status}.`);
  return body;
}

const WRITE_HEADERS = { "Content-Type": "application/json", [REQUEST_HEADER]: REQUEST_HEADER_VALUE };

const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", headers: WRITE_HEADERS, body: JSON.stringify(body) });

const batchRoute = (batchId: string) => `/batches/${encodeURIComponent(batchId)}`;

export const fetchBatch = (batchId: string, signal: AbortSignal) => request<BatchView>(batchRoute(batchId), { signal });
export const fetchBatchContext = (batchId: string, signal: AbortSignal) => request<BatchContext>(`/batches/${encodeURIComponent(batchId)}/context`, { signal });
export const fetchUnchanged = async (batchId: string) => (await request<{ rows: readonly RenderRow[] }>(`${batchRoute(batchId)}/unchanged`)).rows;
export const fetchDiff = (current: string, golden: string, signal: AbortSignal | null = null) => request<PixelDiff>(`/diffs/${current}/${golden}`, { signal });

export const fetchApprovedSince = (batchId: string, signal: AbortSignal) => request<ApprovedSinceView>(`${batchRoute(batchId)}/approved-since`, { signal });

export const postDecision = (batchId: string, decision: DecisionKind, renders: readonly DecisionTarget[]) =>
  post<BatchView>(`${batchRoute(batchId)}/decisions`, { decision, renders });

/** Hands over each piece of the answer as it comes, and throws if it doesn't finish. */
export async function askAboutStory(batchId: string, question: { readonly story: string; readonly messages: readonly ChatMessage[] }, onUpdate: (update: ChatUpdate) => void, signal: AbortSignal): Promise<void> {
  const response = await respond(`${batchRoute(batchId)}/chat`, { method: "POST", headers: WRITE_HEADERS, body: JSON.stringify(question), signal });
  for await (const line of linesOf(response.body!)) {
    const event = JSON.parse(line) as ChatEvent;
    if (event.type === "done") return;
    if (event.type === "failed") throw new RequestError("model-failed", event.message, event.id);
    onUpdate(event);
  }
  throw new RequestError("model-failed", "The answer stopped before it finished. Try asking again.");
}

export const fetchStories = (signal: AbortSignal) => request<StoriesView>("/stories", { signal });
export const postRender = (stories: readonly string[]) => post<{ readonly batchId: string }>("/renders", { stories });
export const fetchRenderProgress = (signal: AbortSignal) => request<{ readonly progress: RenderProgress | null }>("/renders/progress", { signal });
export const fetchFeedback = (signal: AbortSignal) => request<FeedbackView>("/feedback", { signal });
export const postNote = (note: NewNote) => post<FeedbackView>("/notes", note);
export const postSendNotes = (via: SendVia) => post<{ readonly feedback: FeedbackView; readonly text: string }>("/notes/send", { via });
export const postAnswer = (id: number, text: string, batchId: string) => post<FeedbackView>(`/notes/${id}/answers`, { text, batchId });
export const postResolve = (id: number) => post<FeedbackView>(`/notes/${id}/resolve`, {});
export const deleteNote = (id: number) => request<FeedbackView>(`/notes/${id}`, { method: "DELETE", headers: WRITE_HEADERS });

export const imageUrl = (hash: string) => `${BASE}/api/images/${hash}`;
export const diffImageUrl = (current: string, golden: string) => `${BASE}/api/diffs/${current}/${golden}/image`;
