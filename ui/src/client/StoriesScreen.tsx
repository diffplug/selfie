// Every story of the hosted Storybook, each with its newest render at HEAD, whichever batch that was.
// A story's page is its batch's, so looking at one here and in that batch's review is the same screen.
import { Banner, Button, Heading, RelativeTime, Stack, Text, VisuallyHidden } from "@primer/react";
import { useMemo, useState, type ReactNode } from "react";
import type { ListedStory, RenderProgress, StoriesView } from "../shared/api.ts";
import { describeRenderProgress, spokenStretch } from "../shared/renderProgress.ts";
import { DetailScreen, StoryPager } from "./DetailScreen.tsx";
import { FeedbackBar } from "./Feedback.tsx";
import { navigationThrough, parseFilter, type StoryNavigation } from "./filter.ts";
import { useRender, useRenderProgress, useFeedback, useHotkeys, useBatch, useStories, useStoryFocusKeys, useTitle, type RenderingState, type FeedbackState, type BatchState } from "./hooks.ts";
import { Keys } from "./Keys.tsx";
import { usePageFacts } from "./PageFacts.tsx";
import { OpenInStorybook, StoryFrame, storyFrameUrl } from "./LiveStories.tsx";
import { plural } from "./plural.ts";
import { ActionFailedBanner } from "./ActionFailure.tsx";
import { anyStoryPath, navigate, storiesPath } from "./router.tsx";
import { matchingStories, StoryNavLayout } from "./StoryNav.tsx";
import { inTreeOrder } from "./storyTree.ts";
import { Checklist } from "./Checklist.tsx";
import { LoadFailure, Loading } from "./Status.tsx";

/** Every story at the left and whatever's being looked at on the right. */
export function StoriesLayout({ view, story, search, children }: { view: StoriesView; story: string | null; search: string; children: ReactNode }) {
  const { head, branch, storybookUrl, setup } = view;
  usePageFacts({ kind: "view", view: { head, branch, storybookUrl, setup } });
  return (
    <StoryNavLayout
      stories={view.stories}
      story={story}
      search={search}
      hrefOf={anyStoryPath}
      more={({ render }) =>
        render !== null && (
          <span className="selfie-nav-col">
            <RelativeTime date={new Date(render.renderedAt)} />
          </span>
        )
      }
    >
      {children}
    </StoryNavLayout>
  );
}

/**
 * What's said while a render runs, or why the last one didn't. The banner changes every second, so a
 * screen reader follows a separate status, which changes far less often. That's always there, since
 * one is only heard when what's in it changes.
 */
export function RenderingStatus({ renders, progress, now }: { renders: RenderingState; progress: RenderProgress | null; now: number }) {
  const { rendering } = renders;
  const title = `Rendering ${plural(rendering, "story", "stories")}`;
  const shown = progress ?? { total: rendering, finished: 0, startedAtMs: now, firstStoryStartedAtMs: null };
  const description = describeRenderProgress(shown, now);

  const stretch = spokenStretch(shown, now);
  const spokenFor = `${rendering} ${stretch}`;
  const [spoken, setSpoken] = useState({ spokenFor, text: title });
  if (spoken.spokenFor !== spokenFor) setSpoken({ spokenFor, text: stretch === 0 ? title : description });

  return (
    <>
      {renders.error !== null && <ActionFailedBanner error={renders.error} onDismiss={renders.clearError} />}
      {rendering > 0 && <Banner variant="info" title={title} description={<span className="selfie-render-progress">{description}</span>} />}
      <VisuallyHidden role="status">{rendering > 0 ? spoken.text : ""}</VisuallyHidden>
    </>
  );
}

/** Holds a render's progress here, so that each second renders this banner again, and not the list of every story. */
function LiveRenderingStatus({ renders }: { renders: RenderingState }) {
  const { progress, now } = useRenderProgress(renders.rendering > 0);
  return <RenderingStatus renders={renders} progress={progress} now={now} />;
}

/** What's on the right with no story picked. */
export function StoriesOverview({ view, renders, recheck }: { view: StoriesView; renders: RenderingState; recheck: () => void }) {
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

/** Next and previous through this list, whichever batches they're from. */
export function navigationIn(view: StoriesView, story: string, search: string): StoryNavigation {
  const ordered = inTreeOrder(view.stories);
  return navigationThrough(ordered, matchingStories(ordered, parseFilter(search).text), story, (name) => anyStoryPath(name, search), storiesPath(search));
}

/** A story's page, which is its batch's, moving through every story rather than that batch's. */
function RenderedStory({
  batchId,
  story,
  feedback,
  navigation,
  liveStories,
  renders,
  entry,
  startNote,
  onDecided,
}: {
  batchId: string;
  story: string;
  feedback: FeedbackState;
  navigation: StoryNavigation;
  liveStories: readonly [boolean, (open: boolean) => void];
  renders: RenderingState;
  entry: ListedStory;
  startNote: boolean;
  onDecided: () => void;
}) {
  const state = useBatch(batchId);
  if (state.view === null) return state.loadError !== null ? <LoadFailure error={state.loadError} /> : <Loading label="Reading this story" />;
  const deciding: BatchState = {
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
export function UnrenderedStory({ view, story, navigation, renders, onWriteNote }: { view: StoriesView; story: string; navigation: StoryNavigation; renders: RenderingState; onWriteNote: () => void }) {
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
              No batch at this commit has an image of this story. <code>selfie render --story {story}</code> renders one.
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
  renders: RenderingState;
  onDecided: () => void;
}) {
  // Which story someone asked to write on, whose note box opens once it's been rendered.
  const [noteOn, setNoteOn] = useState<string | null>(null);
  const navigation = useMemo(() => navigationIn(view, story, search), [view, story, search]);
  const entry = view.stories.find((candidate) => candidate.story === story);
  if (entry === undefined) return <Banner variant="warning" title="This Storybook has no such story" description="Pick one from the list." />;
  if (entry.render === null) return <UnrenderedStory view={view} story={story} navigation={navigation} renders={renders} onWriteNote={() => setNoteOn(story)} />;
  return (
    <RenderedStory
      key={entry.render.batchId}
      batchId={entry.render.batchId}
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
  const stories = useStories(feedback.view?.latestBatchId);
  // Here, since each batch a story is from has a page of its own.
  const liveStories = useState(false);
  const renders = useRender(stories.view?.canRender ?? false, stories.reload);
  if (stories.view === null) return stories.error !== null ? <LoadFailure error={stories.error} /> : <Loading label="Reading every story" />;
  return (
    <StoriesLayout view={stories.view} story={story} search={search}>
      <FeedbackBar feedback={feedback} storyHref={(name) => anyStoryPath(name)} showList={story === null} />
      <LiveRenderingStatus renders={renders} />
      {story === null ? (
        <StoriesOverview view={stories.view} renders={renders} recheck={stories.recheck} />
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
