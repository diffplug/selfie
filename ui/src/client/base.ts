import type { BatchView } from "../shared/api.ts";

// Where this page's project is. Locally there's only one, at the root, and in the cloud the Worker says,
// since a project's pages are under its name.
export const BASE = typeof document === "undefined" ? "" : (document.querySelector('meta[name="selfie-base"]')?.getAttribute("content") ?? "");

/** In the cloud: anyone can look, only the writer can decide, and notes and rendering stay on a person's own machine. */
export const isHosted = BASE !== "";

/** Anyone can on someone's own machine, and in the cloud, only whoever's signed in. */
export const canDecide = ({ actor }: Pick<BatchView, "actor">) => !isHosted || actor !== null;

/** Comes back to this page once signed in. */
export const signInHref = () => `/sign-in?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`;
