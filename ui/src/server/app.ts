// The review routes, over a `ReviewSource`. Nothing here is specific to a platform: Node's serving
// and the local-only guard are in `local.ts`, and a Worker would bring its own of each.
import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { imageMediaType } from "selfie-store";
import type { ApiError, DecisionTarget, DiffView, ReviewSource } from "../shared/api.ts";

/** An image hash is the lowercase hex of a SHA256. Anything else never reaches the store. */
const IMAGE_HASH = /^[0-9a-f]{64}$/;
/** Far beyond any run measured, at about 110 bytes a story. */
const MAX_DECISION_TARGETS = 100_000;

/**
 * The errors a request can cause, and their statuses. An error with any other code is ours, so its
 * message stays in the server's log.
 */
const ERROR_STATUS: Readonly<Record<string, ContentfulStatusCode>> = {
  "bad-run-id": 400,
  "bad-request": 400,
  "bad-config": 500,
  "unknown-run": 404,
  "stale-decision": 409,
  "no-actor": 409,
  "run-not-finished": 409,
  "no-goldens": 409,
  "run-dirty": 409,
  "run-has-failures": 409,
  "wrong-removed-count": 409,
};

class BadRequest extends Error {
  readonly code = "bad-request";
}

const failure = (code: string, message: string): ApiError => ({ error: { code, message } });

/** Content-addressed, so a browser may keep it for good, and only that browser may. */
const IMAGE_CACHE = "private, max-age=31536000, immutable";

function png(context: Context, bytes: Uint8Array) {
  return context.body(bytes as Uint8Array<ArrayBuffer>, 200, {
    "Content-Type": imageMediaType(bytes),
    "Cache-Control": IMAGE_CACHE,
  });
}

async function jsonBody(context: Context): Promise<Record<string, unknown>> {
  const body: unknown = await context.req.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequest("The request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

function decisionTargets(value: unknown): DecisionTarget[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DECISION_TARGETS) {
    throw new BadRequest("snapshots must list the images to decide on.");
  }
  return value.map((target: unknown) => {
    const { story, imageHash } = (target ?? {}) as Record<string, unknown>;
    if (typeof story !== "string" || story === "" || typeof imageHash !== "string" || !IMAGE_HASH.test(imageHash)) {
      throw new BadRequest("Each snapshot needs a story and an image hash.");
    }
    return { story, imageHash };
  });
}

/** The routes under `/api`, which never answer with anything but JSON or an image. */
export function createReviewApi(source: ReviewSource): Hono {
  const api = new Hono();

  api.onError((error, context) => {
    const code = (error as { code?: unknown }).code;
    const status = typeof code === "string" ? ERROR_STATUS[code] : undefined;
    if (status !== undefined) return context.json(failure(code as string, error.message), status);
    console.error(error);
    return context.json(failure("internal", "Something went wrong in the Selfie server. Its log says what."), 500);
  });

  api.use(async (context, next) => {
    await next();
    if (!context.res.headers.has("Cache-Control")) context.res.headers.set("Cache-Control", "no-store");
  });

  api.get("/current", async (context) => context.json(await source.current()));
  api.get("/runs/:runId", async (context) => context.json(await source.runView(context.req.param("runId"))));
  api.get("/runs/:runId/unchanged", async (context) =>
    context.json({ rows: await source.unchanged(context.req.param("runId")) }),
  );

  api.post("/runs/:runId/decisions", async (context) => {
    const { decision, snapshots } = await jsonBody(context);
    if (decision !== "approved" && decision !== "rejected") {
      throw new BadRequest('decision must be "approved" or "rejected".');
    }
    return context.json(await source.decide(context.req.param("runId"), decision, decisionTargets(snapshots)));
  });

  api.post("/runs/:runId/accept", async (context) => {
    const { removedSeen } = await jsonBody(context);
    if (removedSeen !== undefined && !(Number.isSafeInteger(removedSeen) && (removedSeen as number) >= 0)) {
      throw new BadRequest("removedSeen must be a non-negative integer.");
    }
    return context.json(await source.accept(context.req.param("runId"), removedSeen as number | undefined));
  });

  api.get("/images/:hash", async (context) => {
    const hash = context.req.param("hash");
    if (!IMAGE_HASH.test(hash)) return context.json(failure("bad-image-hash", "That isn't an image hash."), 400);
    const bytes = await source.image(hash);
    return bytes === null ? context.json(failure("unknown-image", "This store doesn't hold that image."), 404) : png(context, bytes);
  });

  api.use("/diffs/:current/:golden/*", async (context, next) => {
    const { current, golden } = context.req.param();
    if (!IMAGE_HASH.test(current ?? "") || !IMAGE_HASH.test(golden ?? "")) {
      return context.json(failure("bad-image-hash", "That isn't an image hash."), 400);
    }
    await next();
  });

  api.get("/diffs/:current/:golden", async (context) => {
    const { current, golden } = context.req.param();
    const result = await source.diff(current, golden);
    if (result === null) return context.json(failure("unknown-image", "This store doesn't hold those images."), 404);
    const view: DiffView = { diff: result.diff, hasImage: result.png !== null };
    return context.json(view);
  });

  api.get("/diffs/:current/:golden/image", async (context) => {
    const { current, golden } = context.req.param();
    const result = await source.diff(current, golden);
    if (result?.png == null) return context.json(failure("no-diff-image", "There's no diff image for these."), 404);
    return png(context, result.png);
  });

  // Here rather than `notFound`, which a parent app's own routes would come before.
  api.all("*", (context) => context.json(failure("not-found", "No such route."), 404));

  return api;
}
