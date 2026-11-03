import { Heading } from "@primer/react";
import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { findRenames } from "../shared/renames.ts";
import { fetchRunContext } from "./api.ts";
import { AcceptScreen } from "./AcceptScreen.tsx";
import { DetailScreen } from "./DetailScreen.tsx";
import { FeedbackBar, NewerRunBanner } from "./Feedback.tsx";
import { useFeedback, useFetched, useRun } from "./hooks.ts";
import { StoriesRoutes } from "./StoriesScreen.tsx";
import { StoryNavLayout } from "./StoryNav.tsx";
import { differingStories, inTreeOrder } from "./storyTree.ts";
import { AdvisoryLabels, describePixels } from "./words.tsx";
import { applyFilter, NO_FILTER, parseFilter } from "./filter.ts";
import { AppLink, parseRoute, storyPath, useLocation, type Route } from "./router.tsx";
import { PageFactsLine, PageFactsProvider, usePageFacts } from "./PageFacts.tsx";
import { RunScreen } from "./RunScreen.tsx";
import { LoadFailure, Loading, NotFound } from "./Status.tsx";

/** Holds the run across its screens, so moving between them doesn't read it again. */
function RunRoutes({ runId, route, search }: { runId: string; route: Route; search: string }) {
  const state = useRun(runId);
  const feedback = useFeedback();
  const { data: context } = useFetched(runId, (signal) => fetchRunContext(runId, signal));
  const { view } = state;
  usePageFacts(view === null ? null : { kind: "diff", run: view.run, branchGoldens: view.branchGoldens, context });
  const rows = view?.rows;
  const renames = useMemo(() => findRenames(rows ?? []), [rows]);
  // The tree shows what the page's Show says, and its own search does the text.
  const { show } = parseFilter(search);
  const { unchanged } = state;
  const shownRows = useMemo(() => applyFilter(show === "unchanged" ? (unchanged ?? []) : (rows ?? []), { ...NO_FILTER, show }), [show, unchanged, rows]);
  const stories = useMemo(() => (view === null ? [] : differingStories({ ...view, rows: shownRows }, renames, show === "unchanged")), [view, shownRows, renames, show]);
  const treeOrder = useMemo(() => inTreeOrder(stories).map(({ story }) => story), [stories]);
  const rowOf = useMemo(() => new Map(shownRows.map((row) => [row.story, row])), [shownRows]);
  // Where to put focus on coming back to the list.
  const lastStory = useRef<string | null>(null);
  if (state.view === null) {
    return state.loadError !== null ? <LoadFailure error={state.loadError} /> : <Loading label="Reading this run" />;
  }
  if (route.kind === "story") lastStory.current = route.story;
  return (
    <StoryNavLayout
      stories={stories}
      story={route.kind === "story" ? route.story : null}
      search={search}
      hrefOf={(story, query) => storyPath(runId, story, query)}
      renames={renames}
      startOpen
      emptyWords="Nothing differs."
      more={({ story }) => {
        const row = rowOf.get(story);
        if (row === undefined) return null;
        return (
          <>
            <span className="selfie-nav-col" data-size="wide" title={describePixels(row.pixelDiff)}>
              {row.state === "failed" ? "No image" : describePixels(row.pixelDiff)}
            </span>
            <span className="selfie-nav-col">
              <AdvisoryLabels row={row} />
            </span>
          </>
        );
      }}
    >
      {/* The run's screen has its own banner for the newest at its commit, so this one isn't said twice. */}
      {(route.kind !== "run" || feedback.view?.latestRunId !== state.view.siblings.find(({ status }) => status !== "recording")?.id) && (
        <NewerRunBanner latestRunId={feedback.view?.latestRunId} runId={runId} story={route.kind === "story" ? route.story : null} />
      )}
      <FeedbackBar feedback={feedback} storyHref={(story) => storyPath(runId, story, "")} showList={route.kind === "run"} />
      {route.kind === "story" ? (
        <DetailScreen state={state} view={state.view} story={route.story} search={search} feedback={feedback} treeOrder={treeOrder} />
      ) : route.kind === "accept" ? (
        <AcceptScreen state={state} view={state.view} />
      ) : (
        <RunScreen state={state} view={state.view} search={search} returningFrom={lastStory} />
      )}
    </StoryNavLayout>
  );
}

/** Around every screen. */
export function Page({ children }: { readonly children: ReactNode }) {
  return (
    <div className="selfie-page">
      <PageFactsProvider>
        {(facts) => (
          <>
            <header className="selfie-header">
              <Heading as="h1" className="selfie-brand">
                <AppLink href="/" muted>
                  Selfie
                </AppLink>
              </Heading>
              {facts !== null && (
                <span className="selfie-header-facts">
                  <PageFactsLine facts={facts} />
                </span>
              )}
            </header>
            <main className="selfie-main">{children}</main>
          </>
        )}
      </PageFactsProvider>
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
