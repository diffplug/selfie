// Every request the page makes. Image URLs are built here too, so screens never spell out a route.
import {
  REQUEST_HEADER,
  REQUEST_HEADER_VALUE,
  type AcceptOutcome,
  type ApiError,
  type CurrentView,
  type DecisionKind,
  type DecisionTarget,
  type DiffView,
  type RunView,
  type SnapshotRow,
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
  } catch {
    throw new RequestError("unreachable", "Can't reach the Selfie server. Is selfie ui still running?");
  }
  const body = (await response.json().catch(() => null)) as T | ApiError | null;
  if (!response.ok || body === null) {
    const error = (body as ApiError | null)?.error;
    throw new RequestError(error?.code ?? "bad-response", error?.message ?? `The server answered ${response.status}.`);
  }
  return body as T;
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", [REQUEST_HEADER]: REQUEST_HEADER_VALUE },
    body: JSON.stringify(body),
  });

export const fetchCurrent = () => request<CurrentView>("/current");
export const fetchRun = (runId: string) => request<RunView>(`/runs/${encodeURIComponent(runId)}`);
export const fetchUnchanged = async (runId: string) =>
  (await request<{ rows: readonly SnapshotRow[] }>(`/runs/${encodeURIComponent(runId)}/unchanged`)).rows;
export const fetchDiff = (current: string, golden: string) => request<DiffView>(`/diffs/${current}/${golden}`);

export const postDecision = (runId: string, decision: DecisionKind, snapshots: readonly DecisionTarget[]) =>
  post<RunView>(`/runs/${encodeURIComponent(runId)}/decisions`, { decision, snapshots });
export const postAccept = (runId: string, removedSeen: number | undefined) =>
  post<AcceptOutcome>(`/runs/${encodeURIComponent(runId)}/accept`, removedSeen === undefined ? {} : { removedSeen });

export const imageUrl = (hash: string) => `/api/images/${hash}`;
export const diffImageUrl = (current: string, golden: string) => `/api/diffs/${current}/${golden}/image`;
