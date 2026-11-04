// The page's four places. Small enough not to need a router package.
import { Link, LinkButton, type LinkButtonProps, type LinkProps } from "@primer/react";
import { useSyncExternalStore, type MouseEvent } from "react";

export type Route =
  | { readonly kind: "batch"; readonly batchId: string }
  | { readonly kind: "story"; readonly batchId: string; readonly story: string }
  | { readonly kind: "accept"; readonly batchId: string }
  | { readonly kind: "stories" }
  | { readonly kind: "anyStory"; readonly story: string }
  | { readonly kind: "missing" };

export const batchPath = (batchId: string, query = "") => `/batches/${batchId}${query}`;
export const storyPath = (batchId: string, story: string, query = "") =>
  `/batches/${batchId}/stories/${encodeURIComponent(story)}${query}`;
export const acceptPath = (batchId: string) => `/batches/${batchId}/accept`;
export const storiesPath = (query = "") => `/${query}`;
export const anyStoryPath = (story: string, query = "") => `/stories/${encodeURIComponent(story)}${query}`;

export function parseRoute(pathname: string): Route {
  if (pathname === "/") return { kind: "stories" };
  const listed = /^\/stories\/([^/]+)$/.exec(pathname);
  if (listed !== null) {
    try {
      return { kind: "anyStory", story: decodeURIComponent(listed[1]!) };
    } catch {
      return { kind: "missing" };
    }
  }
  const [, batches, batchId, section, story, ...rest] = pathname.split("/");
  if (batches !== "batches" || batchId === undefined || batchId === "" || rest.length > 0) return { kind: "missing" };
  if (section === undefined) return { kind: "batch", batchId };
  if (section === "accept" && story === undefined) return { kind: "accept", batchId };
  if (section === "stories" && story !== undefined && story !== "") {
    try {
      return { kind: "story", batchId, story: decodeURIComponent(story) };
    } catch {
      return { kind: "missing" };
    }
  }
  return { kind: "missing" };
}

const CHANGED = "selfie:navigate";

const subscribe = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  window.addEventListener(CHANGED, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(CHANGED, listener);
  };
};

const render = () => `${window.location.pathname}${window.location.search}`;

export function useLocation(): { readonly pathname: string; readonly search: string } {
  const href = useSyncExternalStore(subscribe, render);
  const at = href.indexOf("?");
  return at === -1 ? { pathname: href, search: "" } : { pathname: href.slice(0, at), search: href.slice(at) };
}

export function navigate(href: string, { replace = false }: { readonly replace?: boolean } = {}): void {
  if (replace) window.history.replaceState(null, "", href);
  else window.history.pushState(null, "", href);
  window.dispatchEvent(new Event(CHANGED));
}

/** Follows a plain click without reloading, and leaves a modified one to the browser. */
export function followLink(event: MouseEvent, href: string): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault();
  navigate(href);
}

export function AppLink({ href, children, ...rest }: LinkProps & { readonly href: string }) {
  return (
    <Link href={href} onClick={(event: MouseEvent) => followLink(event, href)} {...rest}>
      {children}
    </Link>
  );
}

export function AppLinkButton({ href, children, ...rest }: LinkButtonProps & { readonly href: string }) {
  return (
    <LinkButton href={href} onClick={(event: MouseEvent) => followLink(event, href)} {...rest}>
      {children}
    </LinkButton>
  );
}
