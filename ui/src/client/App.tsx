import { Heading } from "@primer/react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { AcceptScreen } from "./AcceptScreen.tsx";
import { DetailScreen } from "./DetailScreen.tsx";
import { FeedbackBar, NewerRunBanner } from "./Feedback.tsx";
import { useFeedback, useRun } from "./hooks.ts";
import { StoriesRoutes } from "./StoriesScreen.tsx";
import { AppLink, parseRoute, storyPath, useLocation, type Route } from "./router.tsx";
import { RunScreen } from "./RunScreen.tsx";
import { LoadFailure, Loading, NotFound } from "./Status.tsx";

/** Holds the run across its screens, so moving between them doesn't read it again. */
function RunRoutes({ runId, route, search }: { runId: string; route: Route; search: string }) {
  const state = useRun(runId);
  const feedback = useFeedback();
  // Where to put focus on coming back to the list.
  const lastStory = useRef<string | null>(null);
  if (state.view === null) {
    return state.loadError !== null ? <LoadFailure error={state.loadError} /> : <Loading label="Reading this run" />;
  }
  if (route.kind === "story") lastStory.current = route.story;
  return (
    <>
      {/* The run's screen has its own banner for the newest at its commit, so this one isn't said twice. */}
      {(route.kind !== "run" || feedback.view?.latestRunId !== state.view.siblings.find(({ status }) => status !== "recording")?.id) && (
        <NewerRunBanner latestRunId={feedback.view?.latestRunId} runId={runId} story={route.kind === "story" ? route.story : null} />
      )}
      <FeedbackBar feedback={feedback} storyHref={(story) => storyPath(runId, story, "")} showList={route.kind === "run"} />
      {route.kind === "story" ? (
        <DetailScreen state={state} view={state.view} story={route.story} search={search} feedback={feedback} />
      ) : route.kind === "accept" ? (
        <AcceptScreen state={state} view={state.view} />
      ) : (
        <RunScreen state={state} view={state.view} search={search} returningFrom={lastStory} />
      )}
    </>
  );
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
      {route.kind === "missing" && <NotFound />}
      {(route.kind === "stories" || route.kind === "anyStory") && <StoriesRoutes story={route.kind === "anyStory" ? route.story : null} search={search} />}
      {(route.kind === "run" || route.kind === "story" || route.kind === "accept") && (
        <RunRoutes key={route.runId} runId={route.runId} route={route} search={search} />
      )}
    </Page>
  );
}
