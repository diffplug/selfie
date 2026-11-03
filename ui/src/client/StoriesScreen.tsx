// Every story of the hosted Storybook, each with its newest render at HEAD, whichever run that was.
// A story's page is its run's, so looking at one here and in that run's review is the same screen.
import { Banner, Button, Heading, RelativeTime, Stack, Text } from "@primer/react";
import { useState, type ReactNode } from "react";
import type { ListedStory, StoriesView } from "../shared/api.ts";
import { DetailScreen, StoryPager, type StoryNavigation } from "./DetailScreen.tsx";
import { FeedbackBar } from "./Feedback.tsx";
import { neighbors, parseFilter, positionWords } from "./filter.ts";
import { useRender, useFeedback, useHotkeys, useRun, useStories, useStoryFocusKeys, useTitle, type RenderState, type FeedbackState, type RunState } from "./hooks.ts";
import { Keys } from "./Keys.tsx";
import { usePageFacts } from "./PageFacts.tsx";
import { OpenInStorybook, StoryFrame, storyFrameUrl } from "./LiveStories.tsx";
import { plural } from "./plural.ts";
import { ActionFailedBanner } from "./RunNotes.tsx";
import { anyStoryPath, navigate, storiesPath } from "./router.tsx";
import { matchingStories, StoryNavLayout } from "./StoryNav.tsx";
import { Checklist } from "./Checklist.tsx";
import { LoadFailure, Loading } from "./Status.tsx";

/** Every story at the left and whatever's being looked at on the right. */
export function StoriesLayout({ view, story, search, children }: { view: StoriesView; story: string | null; search: string; children: ReactNode }) {
  return (
    <StoryNavLayout stories={view.stories} story={story} search={search} hrefOf={anyStoryPath}>
      {children}
    </StoryNavLayout>
  );
}

/** What's said while a render runs, or why the last one didn't. */
export function RenderStatus({ renders }: { renders: RenderState }) {
  return (
    <>
      {renders.error !== null && <ActionFailedBanner error={renders.error} onDismiss={renders.clearError} />}
      {renders.rendering > 0 && (
        <Banner variant="info" title={`Rendering ${plural(renders.rendering, "story", "stories")}`} description="It renders in the same browser as any other run, so it can take a moment." />
      )}
    </>
  );
}

/** What's on the right with no story picked. */
export function StoriesOverview({ view, renders, recheck }: { view: StoriesView; renders: RenderState; recheck: () => void }) {
  useTitle("Every story");
  useStoryFocusKeys();
  return (
    <Stack gap="normal">
      <Checklist view={view} renders={renders} recheck={recheck} />
      {view.stories.length > 0 && (
        <Text as="p" className="selfie-muted">
          Pick a story from the list to look at it. <Keys keys="j" /> and <Keys keys="k" /> move through the list, <Keys keys="/" /> searches.
        </Text>
      )}
    </Stack>
  );
}

/** Next and previous through this list, whichever runs they're from. */
export function navigationIn(view: StoriesView, story: string, search: string): StoryNavigation {
  const shown = matchingStories(view.stories, parseFilter(search).text);
  const { previous, next } = neighbors(view.stories, shown, story);
  const hrefOf = (entry: ListedStory | null) => (entry === null ? null : anyStoryPath(entry.story, search));
  return {
    previous: hrefOf(previous),
    next: hrefOf(next),
    list: storiesPath(search),
    position: positionWords(shown.findIndex((entry) => entry.story === story), shown.length),
  };
}

/** A story's page, which is its run's, moving through every story rather than that run's. */
function RenderedStory({
  runId,
  story,
  feedback,
  navigation,
  liveStories,
  renders,
  entry,
  startNote,
  onDecided,
}: {
  runId: string;
  story: string;
  feedback: FeedbackState;
  navigation: StoryNavigation;
  liveStories: readonly [boolean, (open: boolean) => void];
  renders: RenderState;
  entry: ListedStory;
  startNote: boolean;
  onDecided: () => void;
}) {
  const state = useRun(runId);
  if (state.view === null) return state.loadError !== null ? <LoadFailure error={state.loadError} /> : <Loading label="Reading this story" />;
  const deciding: RunState = {
    ...state,
    decide: async (...args) => {
      const recorded = await state.decide(...args);
      onDecided();
      return recorded;
    },
  };
  return (
    <Stack gap="condensed">
      {renders.can && (
        <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
          <Button disabled={renders.rendering > 0} onClick={() => void renders.render([story])}>
            Render again
          </Button>
          {entry.render !== null && (
            <Text className="selfie-muted">
              Rendered <RelativeTime date={new Date(entry.render.renderedAt)} />.{entry.render.dirty && " It has uncommitted changes in it."}
              {entry.render.fromHostedStorybook === false && " This image is from another built Storybook than the one being hosted."}
            </Text>
          )}
        </Stack>
      )}
      <DetailScreen state={deciding} view={state.view} story={story} search="" feedback={feedback} navigation={navigation} liveStories={liveStories} startNote={startNote} />
    </Stack>
  );
}

/** A story with no image yet, which is still a real story to look at. */
export function UnrenderedStory({ view, story, navigation, renders, onWriteNote }: { view: StoriesView; story: string; navigation: StoryNavigation; renders: RenderState; onWriteNote: () => void }) {
  useTitle(story);
  const go = (href: string | null) => {
    if (href !== null) navigate(href, { replace: true });
  };
  const renderNow = () => {
    if (renders.can && renders.rendering === 0) void renders.render([story]);
  };
  const writeNote = () => {
    if (!renders.can || renders.rendering > 0) return;
    onWriteNote();
    void renders.render([story]);
  };
  useHotkeys({ j: () => go(navigation.next), k: () => go(navigation.previous), u: () => navigate(navigation.list), c: renderNow, m: writeNote });
  const { storybookUrl } = view;
  return (
    <Stack gap="condensed">
      <Stack direction="horizontal" align="center" justify="end">
        <StoryPager previous={navigation.previous} next={navigation.next} position={navigation.position} />
      </Stack>
      <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
        <Heading as="h2" variant="small" className="selfie-story-title">
          {story}
        </Heading>
        {storybookUrl !== null && <OpenInStorybook url={storybookUrl} story={story} />}
      </Stack>
      {renders.can ? (
        <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
          <Button variant="primary" disabled={renders.rendering > 0} onClick={writeNote} trailingVisual={() => <Keys keys="m" />}>
            Write a note on this
          </Button>
          <Button disabled={renders.rendering > 0} onClick={renderNow} trailingVisual={() => <Keys keys="c" />}>
            Render it
          </Button>
          <Text className="selfie-muted">A note is written on an image, so writing one renders this story first.</Text>
        </Stack>
      ) : (
        <Banner
          variant="info"
          title="Not rendered yet"
          description={
            <>
              No run at this commit has an image of this story. <code>selfie record --story {story}</code> renders one.
            </>
          }
        />
      )}
      {storybookUrl !== null && <StoryFrame title={`${story}, running`} url={storyFrameUrl(storybookUrl, story)} viewport={view.viewport} />}
    </Stack>
  );
}

function OneStory({
  view,
  story,
  search,
  feedback,
  liveStories,
  renders,
  onDecided,
}: {
  view: StoriesView;
  story: string;
  search: string;
  feedback: FeedbackState;
  liveStories: readonly [boolean, (open: boolean) => void];
  renders: RenderState;
  onDecided: () => void;
}) {
  // Which story someone asked to write on, whose note box opens once it's been rendered.
  const [noteOn, setNoteOn] = useState<string | null>(null);
  const navigation = navigationIn(view, story, search);
  const entry = view.stories.find((candidate) => candidate.story === story);
  if (entry === undefined) return <Banner variant="warning" title="This Storybook has no such story" description="Pick one from the list." />;
  if (entry.render === null) return <UnrenderedStory view={view} story={story} navigation={navigation} renders={renders} onWriteNote={() => setNoteOn(story)} />;
  return (
    <RenderedStory
      key={entry.render.runId}
      runId={entry.render.runId}
      story={story}
      feedback={feedback}
      navigation={navigation}
      liveStories={liveStories}
      renders={renders}
      entry={entry}
      startNote={noteOn === story}
      onDecided={onDecided}
    />
  );
}

export function StoriesRoutes({ story, search }: { story: string | null; search: string }) {
  const feedback = useFeedback();
  const stories = useStories(feedback.view?.latestRunId);
  usePageFacts(stories.view === null ? null : { kind: "view", view: stories.view });
  // Here, since each run a story is from has a page of its own.
  const liveStories = useState(false);
  const renders = useRender(stories.view?.canRender ?? false, stories.reload);
  if (stories.view === null) return stories.error !== null ? <LoadFailure error={stories.error} /> : <Loading label="Reading every story" />;
  return (
    <StoriesLayout view={stories.view} story={story} search={search}>
      <FeedbackBar feedback={feedback} storyHref={(name) => anyStoryPath(name)} showList={story === null} />
      <RenderStatus renders={renders} />
      {story === null ? (
        <StoriesOverview view={stories.view} renders={renders} recheck={stories.reload} />
      ) : (
        <OneStory
          view={stories.view}
          story={story}
          search={search}
          feedback={feedback}
          liveStories={liveStories}
          renders={renders}
          onDecided={stories.reload}
        />
      )}
    </StoriesLayout>
  );
}
