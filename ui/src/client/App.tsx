import { Heading } from "@primer/react";
import logo from "../../../branding/logo-icon.svg";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { fetchBatchContext } from "./api.ts";
import { DetailScreen } from "./DetailScreen.tsx";
import { FeedbackBar, NewerBatchBanner } from "./Feedback.tsx";
import { useFeedback, useFetched, useBatch } from "./hooks.ts";
import { StoriesRoutes } from "./StoriesScreen.tsx";
import { AppLink, parseRoute, storyPath, useLocation, type Route, storiesPath } from "./router.tsx";
import { PageFactsLine, PageFactsProvider } from "./PageFacts.tsx";
import { BatchLayout, useBatchTree } from "./BatchLayout.tsx";
import { BatchScreen } from "./BatchScreen.tsx";
import { LoadFailure, Loading, NotFound } from "./Status.tsx";

/** Holds the batch across its screens, so moving between them doesn't read it again. */
function BatchRoutes({ batchId, route, search }: { batchId: string; route: Route; search: string }) {
  const state = useBatch(batchId);
  const feedback = useFeedback();
  const { data: context } = useFetched(batchId, (signal) => fetchBatchContext(batchId, signal));
  const tree = useBatchTree(state.view, state.unchanged, search, route.kind === "story" ? route.story : null);
  // Where to put focus on coming back to the list.
  const lastStory = useRef<string | null>(null);
  if (state.view === null) {
    return state.loadError !== null ? <LoadFailure error={state.loadError} /> : <Loading label="Reading this batch" />;
  }
  if (route.kind === "story") lastStory.current = route.story;
  return (
    <BatchLayout view={state.view} tree={tree} story={route.kind === "story" ? route.story : null} search={search} context={context}>
      {/* The batch's screen has its own banner for the newest at its commit, so this one isn't said twice. */}
      {(route.kind !== "batch" || feedback.view?.latestBatchId !== state.view.siblings.find(({ status }) => status !== "recording")?.id) && (
        <NewerBatchBanner latestBatchId={feedback.view?.latestBatchId} batchId={batchId} story={route.kind === "story" ? route.story : null} />
      )}
      <FeedbackBar feedback={feedback} storyHref={(story) => storyPath(batchId, story, "")} showList={route.kind === "batch"} />
      {route.kind === "story" && tree.navigation !== null ? (
        <DetailScreen state={state} view={state.view} story={route.story} search={search} feedback={feedback} navigation={tree.navigation} />
      ) : (
        <BatchScreen state={state} view={state.view} search={search} returningFrom={lastStory} />
      )}
    </BatchLayout>
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
                <AppLink href={storiesPath()} muted>
                  <img src={logo} width={32} height={32} alt="" />
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
      {(route.kind === "batch" || route.kind === "story") && (
        <BatchRoutes key={route.batchId} batchId={route.batchId} route={route} search={search} />
      )}
    </Page>
  );
}
