// Every story of the hosted Storybook, each with its newest capture at HEAD, whichever run that was.
// A story's page is its run's, so looking at one here and in that run's review is the same screen.
import { ArrowLeftIcon, SearchIcon } from "@primer/octicons-react";
import { BookmarkHollowIcon, ChevronSmallDownIcon, ChevronSmallRightIcon, ComponentIcon, FolderIcon } from "@storybook/icons";
import { Banner, Button, FormControl, Heading, RelativeTime, Stack, Text, TextInput } from "@primer/react";
import { Blankslate, ScrollableRegion, Table } from "@primer/react/experimental";
import { useMemo, useRef, useState } from "react";
import type { ListedStory, StoriesView } from "../shared/api.ts";
import { DetailScreen, StoryPager, type StoryNavigation } from "./DetailScreen.tsx";
import { FeedbackBar } from "./Feedback.tsx";
import { filterQuery, matchesText, neighbors, NO_FILTER, parseFilter, positionWords } from "./filter.ts";
import { useCapture, useFeedback, useHotkeys, useRun, useStories, useStoryListKeys, useTitle, type CaptureState, type FeedbackState, type RunState } from "./hooks.ts";
import { Keys } from "./Keys.tsx";
import { OpenInStorybook, StoryFrame, storyFrameUrl } from "./LiveStories.tsx";
import { plural } from "./plural.ts";
import { ActionFailedBanner } from "./RunNotes.tsx";
import { anyStoryPath, AppLink, followLink, navigate, runPath, storiesPath } from "./router.tsx";
import { LoadFailure, Loading } from "./Status.tsx";
import { buildStoryTree, isSection, storiesIn, visibleRows, type StoryFolder } from "./storyTree.ts";
import { DecisionLabel, shortSha, StateLabel } from "./words.tsx";

const matching = (stories: readonly ListedStory[], text: string) => stories.filter(({ story, title, name }) => matchesText(`${story} ${title} ${name}`, text));

/** What a capture can't be relied on for, in words, or nothing if it can. */
function captureCaveats({ capture }: ListedStory): string {
  if (capture === null) return "";
  return [capture.dirty && "Uncommitted changes", capture.fromHostedBuild === false && "From another build"].filter(Boolean).join(", ");
}

/** Indents a row by how deep it is, as the Storybook's sidebar does. */
const indented = (depth: number) => ({ paddingLeft: `calc(${depth} * var(--base-size-20))` });

function StoryRow({ entry, depth, search }: { entry: ListedStory; depth: number; search: string }) {
  const href = anyStoryPath(entry.story, search);
  const { capture } = entry;
  return (
    <Table.Row>
      <Table.Cell>
        <span className="selfie-tree-label" style={indented(depth)}>
          <BookmarkHollowIcon className="selfie-tree-icon" data-kind="story" />
          <a href={href} data-story={entry.story} title={entry.story} onClick={(event) => followLink(event, href)}>
            {entry.name}
          </a>
        </span>
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

function FolderRow({ folder, depth, open, onToggle }: { folder: StoryFolder; depth: number; open: boolean; onToggle: () => void }) {
  const stories = storiesIn(folder);
  const captured = stories.filter(({ capture }) => capture !== null).length;
  const section = isSection(folder, depth);
  const isComponent = folder.children.every((child) => child.kind === "story");
  const Icon = isComponent ? ComponentIcon : FolderIcon;
  return (
    <Table.Row className="selfie-tree-folder">
      <Table.Cell style={{ gridColumn: "1 / -1" }}>
        <span className="selfie-tree-label" style={indented(depth)}>
          <button type="button" className="selfie-tree-toggle" aria-expanded={open} onClick={onToggle}>
            {open ? <ChevronSmallDownIcon /> : <ChevronSmallRightIcon />}
            {!section && <Icon className="selfie-tree-icon" data-kind={isComponent ? "component" : "folder"} />}
            <span className={section ? "selfie-tree-section" : undefined}>{folder.name}</span>
          </button>
          <span className="selfie-muted">
            {captured.toLocaleString()} of {plural(stories.length, "story", "stories")} captured
          </span>
        </span>
      </Table.Cell>
    </Table.Row>
  );
}

function StoryTree({ stories, search, filtering }: { stories: readonly ListedStory[]; search: string; filtering: boolean }) {
  const tree = useMemo(() => buildStoryTree(stories), [stories]);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  // A filter means looking for something, so nothing it found stays folded away.
  const rows = useMemo(() => visibleRows(tree, filtering ? new Set() : closed), [tree, filtering, closed]);
  const toggle = (path: string) =>
    setClosed((previous) => {
      const next = new Set(previous);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  return (
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
          {rows.map((row) =>
            row.kind === "story" ? (
              <StoryRow key={row.entry.story} entry={row.entry} depth={row.depth} search={search} />
            ) : (
              <FolderRow key={row.path} folder={row} depth={row.depth} open={filtering || !closed.has(row.path)} onToggle={() => toggle(row.path)} />
            ),
          )}
        </Table.Body>
      </Table>
    </ScrollableRegion>
  );
}

/** What's said while a capture runs, or why the last one didn't. */
export function CaptureStatus({ capture }: { capture: CaptureState }) {
  return (
    <>
      {capture.error !== null && <ActionFailedBanner error={capture.error} onDismiss={capture.clearError} />}
      {capture.capturing > 0 && (
        <Banner variant="info" title={`Capturing ${plural(capture.capturing, "story", "stories")}`} description="It renders in the same browser as any other run, so it can take a moment." />
      )}
    </>
  );
}

/** Whether a capture is missing or known to be out of date, which is what's left to fan out to. */
const needsCapture = ({ capture }: ListedStory) => capture === null || capture.fromHostedBuild === false;

export function StoriesScreen({ view, search, capture }: { view: StoriesView; search: string; capture: CaptureState }) {
  useTitle("Every story");
  const filter = useMemo(() => parseFilter(search), [search]);
  const input = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => matching(view.stories, filter.text), [view.stories, filter.text]);
  const captured = view.stories.filter((entry) => entry.capture !== null).length;
  const rest = view.stories.filter(needsCapture);

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
        <Stack direction="horizontal" align="center" gap="condensed">
          {view.newestRunId !== null && <AppLink href={runPath(view.newestRunId)}>Review the newest run</AppLink>}
          {capture.can && rest.length > 0 && (
            <Button variant="primary" disabled={capture.capturing > 0} onClick={() => void capture.capture(rest.map(({ story }) => story))}>
              {`Capture the rest (${rest.length.toLocaleString()})`}
            </Button>
          )}
        </Stack>
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
        <StoryTree stories={shown} search={search} filtering={filter.text !== ""} />
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
  capture,
  outOfDate,
  startNote,
  onDecided,
}: {
  runId: string;
  story: string;
  feedback: FeedbackState;
  navigation: StoryNavigation;
  liveStories: readonly [boolean, (open: boolean) => void];
  capture: CaptureState;
  outOfDate: boolean;
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
      {capture.can && (
        <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
          <Button disabled={capture.capturing > 0} onClick={() => void capture.capture([story])}>
            Capture again
          </Button>
          {outOfDate && <Text className="selfie-muted">This image is from another build than the one being hosted.</Text>}
        </Stack>
      )}
      <DetailScreen state={deciding} view={state.view} story={story} search="" feedback={feedback} navigation={navigation} liveStories={liveStories} startNote={startNote} />
    </Stack>
  );
}

/** A story with no image yet, which is still a real story to look at. */
export function UncapturedStory({ view, story, navigation, capture, onWriteNote }: { view: StoriesView; story: string; navigation: StoryNavigation; capture: CaptureState; onWriteNote: () => void }) {
  useTitle(story);
  const go = (href: string | null) => {
    if (href !== null) navigate(href, { replace: true });
  };
  const captureNow = () => {
    if (capture.can && capture.capturing === 0) void capture.capture([story]);
  };
  const writeNote = () => {
    if (!capture.can || capture.capturing > 0) return;
    onWriteNote();
    void capture.capture([story]);
  };
  useHotkeys({ j: () => go(navigation.next), k: () => go(navigation.previous), u: () => navigate(navigation.list), c: captureNow, m: writeNote });
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
      {capture.can ? (
        <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
          <Button variant="primary" disabled={capture.capturing > 0} onClick={writeNote} trailingVisual={() => <Keys keys="m" />}>
            Write a note on this
          </Button>
          <Button disabled={capture.capturing > 0} onClick={captureNow} trailingVisual={() => <Keys keys="c" />}>
            Capture it
          </Button>
          <Text className="selfie-muted">A note is written on an image, so writing one captures this story first.</Text>
        </Stack>
      ) : (
        <Banner
          variant="info"
          title="Not captured yet"
          description={
            <>
              No run at this commit has an image of this story. <code>selfie record --story {story}</code> captures one.
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
  capture,
  onDecided,
}: {
  view: StoriesView;
  story: string;
  search: string;
  feedback: FeedbackState;
  liveStories: readonly [boolean, (open: boolean) => void];
  capture: CaptureState;
  onDecided: () => void;
}) {
  // Which story someone asked to write on, whose note box opens once it's been captured.
  const [noteOn, setNoteOn] = useState<string | null>(null);
  const navigation = navigationIn(view, story, search);
  const entry = view.stories.find((candidate) => candidate.story === story);
  if (entry === undefined) return <Banner variant="warning" title="This Storybook has no such story" description={<AppLink href={navigation.list}>Back to the list</AppLink>} />;
  if (entry.capture === null) return <UncapturedStory view={view} story={story} navigation={navigation} capture={capture} onWriteNote={() => setNoteOn(story)} />;
  return (
    <CapturedStory
      key={entry.capture.runId}
      runId={entry.capture.runId}
      story={story}
      feedback={feedback}
      navigation={navigation}
      liveStories={liveStories}
      capture={capture}
      outOfDate={entry.capture.fromHostedBuild === false}
      startNote={noteOn === story}
      onDecided={onDecided}
    />
  );
}

export function StoriesRoutes({ story, search }: { story: string | null; search: string }) {
  const feedback = useFeedback();
  const stories = useStories(feedback.view?.latestRunId);
  // Here, since each run a story is from has a page of its own.
  const liveStories = useState(false);
  const capture = useCapture(stories.view?.canCapture ?? false, stories.reload);
  if (stories.view === null) return stories.error !== null ? <LoadFailure error={stories.error} /> : <Loading label="Reading every story" />;
  return (
    <>
      <FeedbackBar feedback={feedback} storyHref={(name) => anyStoryPath(name)} showList={story === null} />
      <CaptureStatus capture={capture} />
      {story === null ? (
        <StoriesScreen view={stories.view} search={search} capture={capture} />
      ) : (
        <OneStory
          view={stories.view}
          story={story}
          search={search}
          feedback={feedback}
          liveStories={liveStories}
          capture={capture}
          onDecided={stories.reload}
        />
      )}
    </>
  );
}
