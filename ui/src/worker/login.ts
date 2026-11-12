// Signing in through GitHub, by pgstencil's Better Auth adapter, for one writer. The Worker drives the
// adapter from the server, so the sign-in page needs no script, and only GitHub's callback reaches the
// adapter from outside. See docs/specs/access.md -> Who can do what.

/** What a request to the auth adapter gets back. */
export type AuthFetch = (request: Request) => Promise<Response>;

export interface Login {
  /** Starts signing in: GitHub's authorization page, with the cookies the adapter set to finish it. */
  begin(request: Request, next: string): Promise<Response>;
  /** GitHub's redirect back, which the adapter turns into a session cookie. */
  callback(request: Request): Promise<Response>;
  /** Where the adapter sends a browser after signing in: on to `next` for the writer, and signed out for anyone else. */
  landed(request: Request): Promise<Response>;
  /** Ends this browser's session. */
  signOut(request: Request): Promise<Response>;
  /** The writer, if this request's cookie is their session, or else nobody. */
  writerOf(request: Request): Promise<string | null>;
}

export interface LoginConfig {
  /** `APP_ORIGIN`, which the adapter holds every write to. */
  readonly origin: string;
  readonly auth: AuthFetch;
  /** The one GitHub account that can sign in, by its numeric user ID, since a login can be renamed and reused. */
  readonly writerGithubId: string;
  /** What decisions record as their decider. */
  readonly writerName: string;
}

export const SUCCESS_PATH = "/signed-in";
export const ERROR_PATH = "/sign-in?failed=1";

const SECURE = (origin: string) => origin.startsWith("https:");
const NEXT_COOKIE = (origin: string) => (SECURE(origin) ? "__Host-selfie-next" : "selfie-next");

/** Only somewhere on this site, so a link can't send someone off it after signing in. */
export const localPath = (next: unknown) => (typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/");

function cookieValues(header: string | null): Map<string, string> {
  const values = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) values.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return values;
}

/** The `name=value` of each cookie a response sets. */
const setCookiePairs = (response: Response) => response.headers.getSetCookie().map((line) => line.split(";")[0]!.trim());

/** Only what the adapter reads: the browser's cookies, and the address its rate limits count. */
function forwarded(request: Request, extraCookies: readonly string[] = []): Headers {
  const headers = new Headers();
  const cookies = [request.headers.get("cookie"), ...extraCookies].filter((cookie): cookie is string => !!cookie);
  if (cookies.length > 0) headers.set("cookie", cookies.join("; "));
  const ip = request.headers.get("cf-connecting-ip");
  if (ip !== null) headers.set("cf-connecting-ip", ip);
  return headers;
}

/** A redirect carrying every cookie `from` set. */
function redirect(location: string, from: readonly Response[], extra: readonly string[] = []): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const response of from) for (const line of response.headers.getSetCookie()) headers.append("set-cookie", line);
  for (const line of extra) headers.append("set-cookie", line);
  return new Response(null, { status: 303, headers });
}

/** A cookie's value as it was set, or nothing if someone set one that doesn't decode. */
const decoded = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

const hasSession = (request: Request) => [...cookieValues(request.headers.get("cookie")).keys()].some((name) => name.endsWith(".session_token"));

export function pgstencilLogin({ origin, auth, writerGithubId, writerName }: LoginConfig): Login {
  const nextCookie = NEXT_COOKIE(origin);
  const secure = SECURE(origin) ? "; Secure" : "";

  /** A write the adapter takes: from this origin, with its CSRF token, as JSON. */
  async function write(request: Request, path: string, body: unknown): Promise<{ response: Response; csrf: Response }> {
    const csrf = await auth(new Request(`${origin}/api/auth/csrf`, { headers: forwarded(request) }));
    if (!csrf.ok) throw new Error(`The adapter's CSRF token answered ${csrf.status}`);
    const { csrf: token } = (await csrf.json()) as { csrf: string };
    const headers = forwarded(request, setCookiePairs(csrf));
    headers.set("origin", origin);
    headers.set("x-csrf-token", token);
    headers.set("content-type", "application/json");
    const response = await auth(new Request(`${origin}/api/auth${path}`, { method: "POST", headers, body: JSON.stringify(body) }));
    return { response, csrf };
  }

  async function signOutCookies(request: Request): Promise<Response[]> {
    const { response, csrf } = await write(request, "/sign-out", {});
    return [csrf, response];
  }

  async function writerOf(request: Request): Promise<string | null> {
    // Most people looking have no session, and asking the adapter costs a database connection.
    if (!hasSession(request)) return null;
    const response = await auth(new Request(`${origin}/api/auth/list-accounts`, { headers: forwarded(request) }));
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(`The adapter's account list answered ${response.status}`);
    const accounts = (await response.json()) as readonly { providerId?: unknown; accountId?: unknown }[];
    return accounts.some(({ providerId, accountId }) => providerId === "github" && String(accountId) === writerGithubId) ? writerName : null;
  }

  return {
    async begin(request, next) {
      const { response, csrf } = await write(request, "/sign-in/social", { provider: "github" });
      if (!response.ok) throw new Error(`The adapter's GitHub sign-in answered ${response.status}`);
      const { url } = (await response.json()) as { url: string };
      if (new URL(url).origin !== "https://github.com") throw new Error("The adapter sent sign-in somewhere other than GitHub");
      return redirect(url, [csrf, response], [`${nextCookie}=${encodeURIComponent(localPath(next))}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax${secure}`]);
    },

    callback: (request) => auth(new Request(request.url, { headers: forwarded(request) })),

    async landed(request) {
      const next = localPath(decoded(cookieValues(request.headers.get("cookie")).get(nextCookie) ?? "/"));
      const forget = `${nextCookie}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
      if ((await writerOf(request)) !== null) return redirect(next, [], [forget]);
      // Someone else's GitHub account: their session goes at once, so for now only the writer is ever signed in.
      return redirect("/sign-in?refused=1", hasSession(request) ? await signOutCookies(request) : [], [forget]);
    },

    async signOut(request) {
      return redirect("/", hasSession(request) ? await signOutCookies(request) : []);
    },

    writerOf,
  };
}
