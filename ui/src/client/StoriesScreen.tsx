// Every story of the hosted Storybook, each with its newest capture at HEAD, whichever run that was.
// A story's page is its run's, so looking at one here and in that run's review is the same screen.
import { AlertIcon, SearchIcon } from "@primer/octicons-react";
import { BookmarkHollowIcon, ChevronSmallDownIcon, ChevronSmallRightIcon, ComponentIcon, FolderIcon } from "@storybook/icons";
import { Banner, Button, Heading, PageLayout, RelativeTime, Stack, Text, TextInput, VisuallyHidden } from "@primer/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ListedStory, StoriesView } from "../shared/api.ts";
import { DetailScreen, StoryPager, type StoryNavigation } from "./DetailScreen.tsx";
import { FeedbackBar } from "./Feedback.tsx";
import { filterQuery, matchesText, neighbors, NO_FILTER, parseFilter, positionWords } from "./filter.ts";
import { useCapture, useFeedback, useHotkeys, useRun, useStories, useStoryFocusKeys, useTitle, type CaptureState, type FeedbackState, type RunState } from "./hooks.ts";
import { Keys } from "./Keys.tsx";
import { OpenInStorybook, StoryFrame, storyFrameUrl } from "./LiveStories.tsx";
import { plural } from "./plural.ts";
import { ActionFailedBanner } from "./RunNotes.tsx";
import { anyStoryPath, followLink, navigate, storiesPath } from "./router.tsx";
import { Checklist } from "./Checklist.tsx";
import { LoadFailure, Loading } from "./Status.tsx";
import { buildStoryTree, initiallyClosed, isSection, openedAround, storiesIn, visibleRows, type StoryFolder } from "./storyTree.ts";
import { StateMark } from "./words.tsx";

const matching = (stories: readonly ListedStory[], text: string) => stories.filter(({ story, title, name }) => matchesText(`${story} ${title} ${name}`, text));

/** What a capture can't be relied on for, in words, or nothing if it can. */
function captureCaveats({ capture }: ListedStory): string {
  if (capture === null) return "";
  return [capture.dirty && "Uncommitted changes", capture.fromHostedBuild === false && "From another build"].filter(Boolean).join(", ");
}

/** Indents a row by how deep it is, as the Storybook's sidebar does. */
const indented = (depth: number) => ({ paddingLeft: `calc(var(--base-size-8) + ${depth} * var(--base-size-16))` });

function StoryRow({ entry, depth, search, current }: { entry: ListedStory; depth: number; search: string; current: boolean }) {
  const href = anyStoryPath(entry.story, search);
  const link = useRef<HTMLAnchorElement>(null);
  const caveats = captureCaveats(entry);
  useEffect(() => {
    if (current) link.current?.scrollIntoView({ block: "nearest" });
  }, [current]);
  return (
    <li>
      <a ref={link} className="selfie-nav-row" style={indented(depth)} href={href} data-story={entry.story} title={entry.story} aria-current={current ? "page" : undefined} onClick={(event) => followLink(event, href)}>
        <BookmarkHollowIcon className="selfie-tree-icon" data-kind="story" />
        <span className="selfie-nav-name">{entry.name}</span>
        {entry.capture === null ? (
          <VisuallyHidden>, not rendered</VisuallyHidden>
        ) : (
          <>
            {caveats !== "" && (
              <span className="selfie-nav-caveat" title={caveats}>
                <AlertIcon size={12} />
                <VisuallyHidden>{caveats}</VisuallyHidden>
              </span>
            )}
            <StateMark state={entry.capture.state} />
          </>
        )}
      </a>
    </li>
  );
}

function FolderRow({ folder, depth, open, onToggle }: { folder: StoryFolder; depth: number; open: boolean; onToggle: () => void }) {
  const stories = storiesIn(folder);
  const rendered = stories.filter(({ capture }) => capture !== null).length;
  const section = isSection(folder, depth);
  const isComponent = folder.children.every((child) => child.kind === "story");
  const Icon = isComponent ? ComponentIcon : FolderIcon;
  return (
    <li>
      <button type="button" className="selfie-nav-row" style={indented(depth)} aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronSmallDownIcon /> : <ChevronSmallRightIcon />}
        {!section && <Icon className="selfie-tree-icon" data-kind={isComponent ? "component" : "folder"} />}
        <span className={section ? "selfie-nav-name selfie-tree-section" : "selfie-nav-name"}>{folder.name}</span>
        <span className="selfie-muted selfie-small" title={`${rendered.toLocaleString()} of ${plural(stories.length, "story", "stories")} rendered`}>
          {rendered.toLocaleString()}/{stories.length.toLocaleString()}
        </span>
      </button>
    </li>
  );
}

function StoryTree({ stories, story, search, filtering }: { stories: readonly ListedStory[]; story: string | null; search: string; filtering: boolean }) {
  const tree = useMemo(() => buildStoryTree(stories), [stories]);
  const entry = stories.find((candidate) => candidate.story === story);
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => openedAround(new Set(initiallyClosed(tree)), entry));
  // Whatever moves to a story opens the way to it, during this render so it's there to scroll to.
  const [shownFor, setShownFor] = useState(story);
  if (shownFor !== story) {
    setShownFor(story);
    setClosed(openedAround(closed, entry));
  }
  // A filter means looking for something, so nothing it found stays folded away.
  const rows = useMemo(() => visibleRows(tree, filtering ? new Set() : closed), [tree, filtering, closed]);
  const toggle = (path: string) =>
    setClosed((previous) => {
      const next = new Set(previous);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  return (
    <ul className="selfie-nav-tree">
      {rows.map((row) =>
        row.kind === "story" ? (
          <StoryRow key={row.entry.story} entry={row.entry} depth={row.depth} search={search} current={row.entry.story === story} />
        ) : (
          <FolderRow key={row.path} folder={row} depth={row.depth} open={filtering || !closed.has(row.path)} onToggle={() => toggle(row.path)} />
        ),
      )}
    </ul>
  );
}

/** The list every story's page stays beside, as in Storybook. */
function StorySidebar({ view, story, search }: { view: StoriesView; story: string | null; search: string }) {
  const filter = useMemo(() => parseFilter(search), [search]);
  const input = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => matching(view.stories, filter.text), [view.stories, filter.text]);
  const filtered = (text: string) => {
    const query = filterQuery({ ...NO_FILTER, text });
    return story === null ? storiesPath(query) : anyStoryPath(story, query);
  };
  useHotkeys({ "/": () => input.current?.focus() });
  return (
    <nav aria-label="Stories" className="selfie-nav">
      <TextInput
        ref={input}
        block
        aria-label="Filter stories"
        leadingVisual={SearchIcon}
        value={filter.text}
        placeholder="Press / to search"
        onChange={(event) => navigate(filtered(event.target.value), { replace: true })}
      />
      {shown.length > 0 ? (
        <StoryTree stories={shown} story={story} search={search} filtering={filter.text !== ""} />
      ) : filter.text === "" ? (
        <Text as="p" className="selfie-muted">
          No stories yet.
        </Text>
      ) : (
        <Stack gap="condensed" align="start">
          <Text as="p" className="selfie-muted">
            Nothing matches this filter.
          </Text>
          <Button size="small" onClick={() => navigate(filtered(""))}>
            Clear the filter
          </Button>
        </Stack>
      )}
    </nav>
  );
}

/** Every story at the left and whatever's being looked at on the right, as in Storybook. */
export function StoriesLayout({ view, story, search, children }: { view: StoriesView; story: string | null; search: string; children: ReactNode }) {
  return (
    <div className="selfie-stories">
      <PageLayout containerWidth="full" padding="none" columnGap="none" rowGap="none">
        <PageLayout.Pane position="start" sticky resizable width="medium" divider="line" widthStorageKey="selfie-story-nav" aria-label="Stories">
          <StorySidebar view={view} story={story} search={search} />
        </PageLayout.Pane>
        <PageLayout.Content padding="normal" width="full">
          <Stack gap="normal">{children}</Stack>
        </PageLayout.Content>
      </PageLayout>
    </div>
  );
}

/** What's said while a capture runs, or why the last one didn't. */
export function CaptureStatus({ capture }: { capture: CaptureState }) {
  return (
    <>
      {capture.error !== null && <ActionFailedBanner error={capture.error} onDismiss={capture.clearError} />}
      {capture.capturing > 0 && (
        <Banner variant="info" title={`Rendering ${plural(capture.capturing, "story", "stories")}`} description="It renders in the same browser as any other run, so it can take a moment." />
      )}
    </>
  );
}

/** What's on the right with no story picked. */
export function StoriesOverview({ view, capture, recheck }: { view: StoriesView; capture: CaptureState; recheck: () => void }) {
  useTitle("Every story");
  useStoryFocusKeys();
  return (
    <Stack gap="normal">
      <Checklist view={view} capture={capture} recheck={recheck} />
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
  entry,
  startNote,
  onDecided,
}: {
  runId: string;
  story: string;
  feedback: FeedbackState;
  navigation: StoryNavigation;
  liveStories: readonly [boolean, (open: boolean) => void];
  capture: CaptureState;
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
      {capture.can && (
        <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
          <Button disabled={capture.capturing > 0} onClick={() => void capture.capture([story])}>
            Render again
          </Button>
          {entry.capture !== null && (
            <Text className="selfie-muted">
              Rendered <RelativeTime date={new Date(entry.capture.capturedAt)} />.{entry.capture.dirty && " It has uncommitted changes in it."}
              {entry.capture.fromHostedBuild === false && " This image is from another build than the one being hosted."}
            </Text>
          )}
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
      <Stack direction="horizontal" align="center" justify="end">
        <StoryPager previous={navigation.previous} next={navigation.next} position={navigation.position} />
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
  if (entry === undefined) return <Banner variant="warning" title="This Storybook has no such story" description="Pick one from the list." />;
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
      entry={entry}
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
    <StoriesLayout view={stories.view} story={story} search={search}>
      <FeedbackBar feedback={feedback} storyHref={(name) => anyStoryPath(name)} showList={story === null} />
      <CaptureStatus capture={capture} />
      {story === null ? (
        <StoriesOverview view={stories.view} capture={capture} recheck={stories.reload} />
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
    </StoriesLayout>
  );
}
