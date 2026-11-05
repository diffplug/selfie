// The review routes over a `ReviewSource`, and the protections any deployment of them keeps. Nothing
// here is specific to a platform: Node's serving and the allowed hosts are in `local.ts`, and a
// Worker would bring its own of each, and its own login, without losing these.
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { isImageHash } from "selfie-store";
import { CONTENT_ADDRESSED, failure, imageResponse, INTERNAL_ERROR, noStoreByDefault } from "./http.ts";
import { isNoteId, isNoteText, MAX_NOTE_CHARACTERS } from "../shared/notes.ts";
import { REQUEST_HEADER, REQUEST_HEADER_VALUE, type BoundingBox, type DecisionTarget, type NewNote, type ReviewSource } from "../shared/api.ts";

export type * from "../shared/api.ts";
export { REQUEST_HEADER_VALUE };

/** Far beyond any batch measured, at about 110 bytes a story. */
const MAX_DECISION_TARGETS = 100_000;

/**
 * The errors a request can cause, and their statuses. An error with any other code is ours, so its
 * message stays in the server's log.
 */
const ERROR_STATUS: Readonly<Record<string, ContentfulStatusCode>> = {
  "bad-batch-id": 400,
  "bad-request": 400,
  "bad-config": 500,
  "unknown-batch": 404,
  "unknown-note": 404,
  "unknown-story": 404,
  "render-busy": 409,
  "render-failed": 409,
  "no-agent-waiting": 409,
  "stale-decision": 409,
  "no-actor": 409,
  "not-signed-in": 401,
  "read-only": 403,
  "batch-not-finished": 409,
  "too-many-questions": 429,
  "model-failed": 502,
};

class BadRequest extends Error {
  readonly code = "bad-request";
}


/**
 * Another site can't frame the page to steer a click, or embed an image to learn it exists, and
 * nothing else on the page may load from anywhere else, but for frames of a hosted Storybook.
 */
export const pageHeaders = (storybookOrigin?: string): MiddlewareHandler =>
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      ...(storybookOrigin === undefined ? {} : { frameSrc: [storybookOrigin] }),
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
    crossOriginResourcePolicy: "same-origin",
    referrerPolicy: "no-referrer",
    xFrameOptions: "DENY",
    // Says nothing over plain HTTP. A hosted deployment's edge decides this one.
    strictTransportSecurity: false,
  });

/**
 * Refuses a request from any origin but the one given, and any change a form or another site's page
 * could cause: a form can't send this header or this type, and a page's fetch can't without a
 * preflight, which gets no CORS headers from here.
 */
export function sameOriginWrites(allowedOrigin: (context: Context) => string): MiddlewareHandler {
  const origin = sameOrigin(allowedOrigin);
  return (context, next) =>
    origin(context, async () => {
      if (context.req.method !== "GET" && context.req.method !== "HEAD") {
        const contentType = context.req.header("content-type")?.split(";")[0]?.trim();
        if (context.req.header(REQUEST_HEADER) !== REQUEST_HEADER_VALUE || contentType !== "application/json") {
          context.res = context.json(failure("bad-request-kind", "A change must come from the review page."), 403);
          return;
        }
      }
      await next();
    });
}

/** Refuses a request from any origin but the one given. */
export function sameOrigin(allowedOrigin: (context: Context) => string): MiddlewareHandler {
  return async (context, next) => {
    const origin = context.req.header("origin");
    if (origin !== undefined && origin !== allowedOrigin(context)) {
      return context.json(failure("bad-origin", "This server doesn't answer other sites."), 403);
    }
    await next();
  };
}

/** Content-addressed, so a browser may keep it for good, and only that browser may. */

export async function jsonBody(context: Context): Promise<Record<string, unknown>> {
  const body: unknown = await context.req.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequest("The request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

function decisionTargets(value: unknown): DecisionTarget[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DECISION_TARGETS) {
    throw new BadRequest("renders must list the images to decide on.");
  }
  return value.map((target: unknown) => {
    const { story, imageHash } = (target ?? {}) as Record<string, unknown>;
    if (typeof story !== "string" || story === "" || (imageHash !== null && (typeof imageHash !== "string" || !isImageHash(imageHash)))) {
      throw new BadRequest("Each render needs a story, and an image hash or null.");
    }
    return { story, imageHash };
  });
}

function noteBox(value: unknown): BoundingBox | null {
  if (value === null || value === undefined) return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  const whole = (part: unknown, least: number) => Number.isSafeInteger(part) && (part as number) >= least;
  if (!whole(x, 0) || !whole(y, 0) || !whole(width, 1) || !whole(height, 1)) {
    throw new BadRequest("box must have a whole x and y, and a width and height of at least 1.");
  }
  return { x, y, width, height } as BoundingBox;
}

function noteText(text: unknown): string {
  if (!isNoteText(text)) throw new BadRequest(`text must say something, in at most ${MAX_NOTE_CHARACTERS} characters.`);
  return text;
}

function newNote({ story, batchId, imageHash, box, text }: Record<string, unknown>): NewNote {
  if (typeof story !== "string" || story === "") throw new BadRequest("story must name a story.");
  if (typeof batchId !== "string") throw new BadRequest("batchId must name a batch.");
  if (imageHash !== null && (typeof imageHash !== "string" || !isImageHash(imageHash))) throw new BadRequest("imageHash must be an image hash, or null.");
  return { story, batchId, imageHash, box: noteBox(box), text: noteText(text) };
}

function noteId(value: string): number {
  const id = Number(value);
  if (!isNoteId(id)) throw new BadRequest("That isn't a note.");
  return id;
}

/** The routes under `/api`, which never answer with anything but JSON or an image. */
export { failure };

/** Given one source for a server's whole life, or a way to find the one a request is for, and any routes only this deployment has. */
export function createReviewApi(given: ReviewSource | ((context: Context) => Promise<ReviewSource>), extraRoutes: (api: Hono) => void = () => undefined): Hono {
  const sourceOf = typeof given === "function" ? given : async () => given;
  const api = new Hono();

  api.onError((error, context) => {
    const code = (error as { code?: unknown }).code;
    const status = typeof code === "string" ? ERROR_STATUS[code] : undefined;
    if (status !== undefined) return context.json(failure(code as string, error.message), status);
    console.error(error);
    return context.json(INTERNAL_ERROR, 500);
  });

  api.use(noStoreByDefault);

  api.get("/stories", async (context) => context.json(await (await sourceOf(context)).storiesView()));
  api.post("/renders", async (context) => {
    const { stories } = await jsonBody(context);
    if (!Array.isArray(stories) || stories.length === 0 || stories.length > MAX_DECISION_TARGETS || !stories.every((story) => typeof story === "string" && story !== "")) {
      throw new BadRequest("stories must list the stories to render.");
    }
    return context.json(await (await sourceOf(context)).render(stories as string[]));
  });
  api.get("/renders/progress", async (context) => context.json({ progress: await (await sourceOf(context)).renderProgress() }));
  api.get("/batches/:batchId", async (context) => context.json(await (await sourceOf(context)).batchView(context.req.param("batchId"))));
  api.get("/batches/:batchId/context", async (context) => context.json(await (await sourceOf(context)).batchContext(context.req.param("batchId"))));
  api.get("/batches/:batchId/unchanged", async (context) =>
    context.json({ rows: await (await sourceOf(context)).unchanged(context.req.param("batchId")) }),
  );

  api.get("/batches/:batchId/approved-since", async (context) => context.json(await (await sourceOf(context)).approvedSince(context.req.param("batchId"))));

  api.post("/batches/:batchId/decisions", async (context) => {
    const { decision, renders } = await jsonBody(context);
    if (decision !== "approved" && decision !== "rejected") {
      throw new BadRequest('decision must be "approved" or "rejected".');
    }
    return context.json(await (await sourceOf(context)).decide(context.req.param("batchId"), decision, decisionTargets(renders)));
  });

  api.get("/feedback", async (context) => context.json(await (await sourceOf(context)).feedback()));
  api.post("/notes", async (context) => context.json(await (await sourceOf(context)).addNote(newNote(await jsonBody(context)))));
  api.post("/notes/send", async (context) => {
    const { via } = await jsonBody(context);
    if (via !== "agent" && via !== "copy") throw new BadRequest('via must be "agent" or "copy".');
    return context.json(await (await sourceOf(context)).sendNotes(via));
  });
  api.post("/notes/:id/answers", async (context) => {
    const { text, batchId } = await jsonBody(context);
    if (typeof batchId !== "string") throw new BadRequest("batchId must name a batch.");
    return context.json(await (await sourceOf(context)).answerNote(noteId(context.req.param("id")), noteText(text), batchId));
  });
  api.post("/notes/:id/resolve", async (context) => context.json(await (await sourceOf(context)).resolveNote(noteId(context.req.param("id")))));
  api.delete("/notes/:id", async (context) => context.json(await (await sourceOf(context)).removeNote(noteId(context.req.param("id")))));

  api.get("/images/:hash", async (context) => {
    const hash = context.req.param("hash");
    if (!isImageHash(hash)) return context.json(failure("bad-image-hash", "That isn't an image hash."), 400);
    const bytes = await (await sourceOf(context)).image(hash);
    return bytes === null ? context.json(failure("unknown-image", "This store doesn't hold that image."), 404) : imageResponse(context, bytes);
  });

  api.use("/diffs/:current/:golden/*", async (context, next) => {
    const { current, golden } = context.req.param();
    if (!isImageHash(current ?? "") || !isImageHash(golden ?? "")) {
      return context.json(failure("bad-image-hash", "That isn't an image hash."), 400);
    }
    await next();
  });

  api.get("/diffs/:current/:golden", async (context) => {
    const { current, golden } = context.req.param();
    const diff = await (await sourceOf(context)).diffStats(current, golden);
    if (diff === null) return context.json(failure("unknown-image", "This store doesn't hold those images."), 404);
    context.header("Cache-Control", CONTENT_ADDRESSED);
    return context.json(diff);
  });

  api.get("/diffs/:current/:golden/image", async (context) => {
    const { current, golden } = context.req.param();
    const png = await (await sourceOf(context)).diffImage(current, golden);
    if (png === null) return context.json(failure("unknown-image", "This store doesn't hold those images."), 404);
    return imageResponse(context, png);
  });

  extraRoutes(api);

  // Here rather than `notFound`, which a parent app's own routes would come before.
  api.all("*", (context) => context.json(failure("not-found", "No such route."), 404));

  return api;
}
