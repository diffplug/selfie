// Every story of the hosted Storybook, each with its newest capture at HEAD, whichever run that was.
// A story's page is its run's, so looking at one here and in that run's review is the same screen.
import { ArrowLeftIcon, SearchIcon } from "@primer/octicons-react";
import { Banner, Button, FormControl, Heading, RelativeTime, Stack, Text, TextInput } from "@primer/react";
import { Blankslate, ScrollableRegion, Table } from "@primer/react/experimental";
import { useMemo, useRef, useState } from "react";
import type { ListedStory, StoriesView } from "../shared/api.ts";
import { DetailScreen, StoryPager, type StoryNavigation } from "./DetailScreen.tsx";
import { FeedbackBar } from "./Feedback.tsx";
import { filterQuery, matchesText, neighbors, NO_FILTER, parseFilter, positionWords } from "./filter.ts";
import { useFeedback, useHotkeys, useRun, useStories, useStoryListKeys, useTitle, type FeedbackState, type RunState } from "./hooks.ts";
import { Keys } from "./Keys.tsx";
import { OpenInStorybook, StoryFrame, storyFrameUrl } from "./LiveStories.tsx";
import { plural } from "./plural.ts";
import { anyStoryPath, AppLink, followLink, navigate, runPath, storiesPath } from "./router.tsx";
import { LoadFailure, Loading } from "./Status.tsx";
import { DecisionLabel, shortSha, StateLabel } from "./words.tsx";

const matching = (stories: readonly ListedStory[], text: string) => stories.filter(({ story }) => matchesText(story, text));

/** What a capture can't be relied on for, in words, or nothing if it can. */
function captureCaveats({ capture }: ListedStory): string {
  if (capture === null) return "";
  return [capture.dirty && "Uncommitted changes", capture.fromHostedBuild === false && "From another build"].filter(Boolean).join(", ");
}

function StoryRow({ entry, search }: { entry: ListedStory; search: string }) {
  const href = anyStoryPath(entry.story, search);
  const { capture } = entry;
  return (
    <Table.Row>
      <Table.Cell>
        <a href={href} data-story={entry.story} onClick={(event) => followLink(event, href)}>
          {entry.story}
        </a>
      </Table.Cell>
      <Table.Cell>{capture === null ? <span className="selfie-muted">Not captured</span> : <StateLabel state={capture.state} />}</Table.Cell>
      <Table.Cell>{capture !== null && <DecisionLabel row={capture} />}</Table.Cell>
      <Table.Cell>{capture !== null && <RelativeTime date={new Date(capture.capturedAt)} />}</Table.Cell>
      <Table.Cell>
        <span className="selfie-muted">{captureCaveats(entry)}</span>
      </Table.Cell>
    </Table.Row>
  );
}

export function StoriesScreen({ view, search }: { view: StoriesView; search: string }) {
  useTitle("Every story");
  const filter = useMemo(() => parseFilter(search), [search]);
  const input = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => matching(view.stories, filter.text), [view.stories, filter.text]);
  const captured = view.stories.filter(({ capture }) => capture !== null).length;

  useStoryListKeys(input);

  return (
    <Stack gap="normal">
      <Stack direction="horizontal" align="center" justify="space-between" wrap="wrap" gap="condensed">
        <Heading as="h2" variant="medium">
          Every story
          {view.head !== null && (
            <>
              {" "}
              at <code title={view.head}>{shortSha(view.head)}</code>
            </>
          )}
        </Heading>
        {view.newestRunId !== null && <AppLink href={runPath(view.newestRunId)}>Review the newest run</AppLink>}
      </Stack>
      {view.storybookUrl === null && (
        <Banner
          variant="warning"
          title="There's no built Storybook here"
          description="Only what's been captured is listed. Build one, or point selfie ui at it with --storybook-dir, to see every story running."
        />
      )}
      <Text as="p" className="selfie-muted" role="status">
        {captured.toLocaleString()} of {plural(view.stories.length, "story", "stories")} captured at this commit. <Keys keys="j" /> and <Keys keys="k" /> move through the list, <Keys keys="/" /> searches.
      </Text>
      <FormControl>
        <FormControl.Label>Filter by story</FormControl.Label>
        <TextInput
          ref={input}
          leadingVisual={SearchIcon}
          value={filter.text}
          placeholder="Press / to search"
          onChange={(event) => navigate(storiesPath(filterQuery({ ...NO_FILTER, text: event.target.value })), { replace: true })}
        />
      </FormControl>
      {shown.length > 0 ? (
        <ScrollableRegion aria-label="Stories">
          <Table aria-label="Stories" cellPadding="condensed" gridTemplateColumns="minmax(240px, 1fr) 130px 130px 130px minmax(120px, 200px)">
            <Table.Head>
              <Table.Row>
                <Table.Header>Story</Table.Header>
                <Table.Header>State</Table.Header>
                <Table.Header>Decision</Table.Header>
                <Table.Header>Captured</Table.Header>
                <Table.Header>Caveats</Table.Header>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {shown.map((entry) => (
                <StoryRow key={entry.story} entry={entry} search={search} />
              ))}
            </Table.Body>
          </Table>
        </ScrollableRegion>
      ) : (
        <Blankslate border>
          <Blankslate.Heading as="h3">{filter.text === "" ? "No stories yet" : "Nothing matches this filter"}</Blankslate.Heading>
          {filter.text !== "" && (
            <Stack direction="horizontal" justify="center">
              <Button onClick={() => navigate(storiesPath())}>Clear the filter</Button>
            </Stack>
          )}
        </Blankslate>
      )}
    </Stack>
  );
}

/** Next and previous through this list, whichever runs they're from. */
export function navigationIn(view: StoriesView, story: string, search: string): StoryNavigation {
  const shown = matching(view.stories, parseFilter(search).text);
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
function CapturedStory({
  runId,
  story,
  feedback,
  navigation,
  liveStories,
  onDecided,
}: {
  runId: string;
  story: string;
  feedback: FeedbackState;
  navigation: StoryNavigation;
  liveStories: readonly [boolean, (open: boolean) => void];
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
  return <DetailScreen state={deciding} view={state.view} story={story} search="" feedback={feedback} navigation={navigation} liveStories={liveStories} />;
}

/** A story with no image yet, which is still a real story to look at. */
export function UncapturedStory({ view, story, navigation }: { view: StoriesView; story: string; navigation: StoryNavigation }) {
  useTitle(story);
  const go = (href: string | null) => {
    if (href !== null) navigate(href, { replace: true });
  };
  useHotkeys({ j: () => go(navigation.next), k: () => go(navigation.previous), u: () => navigate(navigation.list) });
  const { storybookUrl } = view;
  return (
    <Stack gap="condensed">
      <Stack direction="horizontal" align="center" justify="space-between" wrap="wrap" gap="condensed">
        <AppLink href={navigation.list}>
          <ArrowLeftIcon /> Back to the list <Keys keys="u" />
        </AppLink>
        <Stack direction="horizontal" align="center" gap="condensed">
          <StoryPager previous={navigation.previous} next={navigation.next} position={navigation.position} />
        </Stack>
      </Stack>
      <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
        <Heading as="h2" variant="small" className="selfie-story-title">
          {story}
        </Heading>
        {storybookUrl !== null && <OpenInStorybook url={storybookUrl} story={story} />}
      </Stack>
      <Banner
        variant="info"
        title="Not captured yet"
        description={
          <>
            No run at this commit has an image of this story. <code>selfie record --story {story}</code> captures one.
          </>
        }
      />
      {storybookUrl !== null && <StoryFrame title={`${story}, running`} url={storyFrameUrl(storybookUrl, story)} viewport={view.viewport} />}
    </Stack>
  );
}

function OneStory({ view, story, search, feedback, liveStories, onDecided }: { view: StoriesView; story: string; search: string; feedback: FeedbackState; liveStories: readonly [boolean, (open: boolean) => void]; onDecided: () => void }) {
  const navigation = navigationIn(view, story, search);
  const entry = view.stories.find((candidate) => candidate.story === story);
  if (entry === undefined) return <Banner variant="warning" title="This Storybook has no such story" description={<AppLink href={navigation.list}>Back to the list</AppLink>} />;
  if (entry.capture === null) return <UncapturedStory view={view} story={story} navigation={navigation} />;
  return <CapturedStory key={entry.capture.runId} runId={entry.capture.runId} story={story} feedback={feedback} navigation={navigation} liveStories={liveStories} onDecided={onDecided} />;
}

export function StoriesRoutes({ story, search }: { story: string | null; search: string }) {
  const feedback = useFeedback();
  const stories = useStories(feedback.view?.latestRunId);
  // Here, since each run a story is from has a page of its own.
  const liveStories = useState(false);
  if (stories.view === null) return stories.error !== null ? <LoadFailure error={stories.error} /> : <Loading label="Reading every story" />;
  return (
    <>
      <FeedbackBar feedback={feedback} storyHref={(name) => anyStoryPath(name)} showList={story === null} />
      {story === null ? (
        <StoriesScreen view={stories.view} search={search} />
      ) : (
        <OneStory view={stories.view} story={story} search={search} feedback={feedback} liveStories={liveStories} onDecided={stories.reload} />
      )}
    </>
  );
}
