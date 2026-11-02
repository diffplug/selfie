import { Heading } from "@primer/react";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { fetchCurrent } from "./api.ts";
import { AcceptScreen } from "./AcceptScreen.tsx";
import { DetailScreen } from "./DetailScreen.tsx";
import { useFetched, useRun, useTitle } from "./hooks.ts";
import { AppLink, navigate, parseRoute, runPath, useLocation, type Route } from "./router.tsx";
import { RunScreen } from "./RunScreen.tsx";
import { LoadFailure, Loading, NoRuns, NotFound } from "./Status.tsx";

function Home() {
  useTitle("Newest run");
  const { data: current, error } = useFetched("current", fetchCurrent);
  useEffect(() => {
    if (current?.runId) navigate(runPath(current.runId), { replace: true });
  }, [current?.runId]);
  if (error !== null) return <LoadFailure error={error} />;
  if (current === null || current.runId !== null) return <Loading label="Finding the newest run" />;
  return <NoRuns current={current} />;
}

/** Holds the run across its screens, so moving between them doesn't read it again. */
function RunRoutes({ runId, route, search }: { runId: string; route: Route; search: string }) {
  const state = useRun(runId);
  // Where to put focus on coming back to the list.
  const lastStory = useRef<string | null>(null);
  if (state.view === null) {
    return state.loadError !== null ? <LoadFailure error={state.loadError} /> : <Loading label="Reading this run" />;
  }
  switch (route.kind) {
    case "story":
      lastStory.current = route.story;
      return <DetailScreen state={state} view={state.view} story={route.story} search={search} />;
    case "accept":
      return <AcceptScreen state={state} view={state.view} />;
    default:
      return <RunScreen state={state} view={state.view} search={search} returningFrom={lastStory} />;
  }
}

/** Around every screen. */
export function Page({ children }: { readonly children: ReactNode }) {
  return (
    <div className="selfie-page">
      <header className="selfie-header">
        <Heading as="h1" className="selfie-brand">
          <AppLink href="/" muted>
            Selfie review
          </AppLink>
        </Heading>
      </header>
      <main className="selfie-main">{children}</main>
    </div>
  );
}

export function App() {
  const { pathname, search } = useLocation();
  const route = parseRoute(pathname);
  // A new page starts at the top, and a filter changing the query isn't one. A layout effect, so a
  // screen's own effects can still move focus somewhere further down.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <Page>
      {route.kind === "home" && <Home />}
      {route.kind === "missing" && <NotFound />}
      {(route.kind === "run" || route.kind === "story" || route.kind === "accept") && (
        <RunRoutes key={route.runId} runId={route.runId} route={route} search={search} />
      )}
    </Page>
  );
}
