// The tree of stories at the left, nested as Storybook's sidebar does them, beside whatever's on the right.
import { AlertIcon, ArrowSwitchIcon, SearchIcon, XCircleFillIcon } from "@primer/octicons-react";
import { BookmarkHollowIcon, ChevronSmallDownIcon, ChevronSmallRightIcon, ComponentIcon, FolderIcon } from "@storybook/icons";
import { Button, PageLayout, Stack, Text, TextInput, VisuallyHidden } from "@primer/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ListedStory } from "../shared/api.ts";
import { filterQuery, matchesText, parseFilter } from "./filter.ts";
import { useHotkeys } from "./hooks.ts";
import { plural } from "./plural.ts";
import { followLink, navigate } from "./router.tsx";
import { buildStoryTree, initiallyClosed, isSection, openedAround, storiesIn, visibleRows, type StoryFolder } from "./storyTree.ts";
import { DecisionLabel, StateLabel, StateMark } from "./words.tsx";

export const matchingStories = (stories: readonly ListedStory[], text: string) => stories.filter(({ story, title, name }) => matchesText(`${story} ${title} ${name}`, text));

/** What a render can't be relied on for, in words, or nothing if it can. */
function renderCaveats({ render }: ListedStory): string {
  if (render === null) return "";
  return [render.dirty && "Uncommitted changes", render.fromHostedStorybook === false && "From another built Storybook"].filter(Boolean).join(", ");
}

/** Indents a row by how deep it is, as the Storybook's sidebar does. */
const indented = (depth: number) => ({ paddingLeft: `calc(var(--base-size-8) + ${depth} * var(--base-size-16))` });

function StoryRow({ entry, depth, href, current, renamedFrom, more }: { entry: ListedStory; depth: number; href: string; current: boolean; renamedFrom: string | undefined; more: ReactNode }) {
  const link = useRef<HTMLAnchorElement>(null);
  const caveats = renderCaveats(entry);
  useEffect(() => {
    if (current) link.current?.scrollIntoView({ block: "nearest" });
  }, [current]);
  return (
    <li>
      <a ref={link} className="selfie-nav-row" style={indented(depth)} href={href} data-story={entry.story} title={entry.story} aria-current={current ? "page" : undefined} onClick={(event) => followLink(event, href)}>
        <BookmarkHollowIcon className="selfie-tree-icon" data-kind="story" />
        <span className="selfie-nav-name">{entry.name}</span>
        {entry.render === null ? (
          <VisuallyHidden>, not rendered</VisuallyHidden>
        ) : (
          <>
            {caveats !== "" && (
              <span className="selfie-nav-caveat" title={caveats}>
                <AlertIcon size={12} />
                <VisuallyHidden>{caveats}</VisuallyHidden>
              </span>
            )}
            <span className="selfie-nav-compact">
              {renamedFrom !== undefined ? (
                <span className="selfie-state-mark" data-state="renamed" title={`Renamed from ${renamedFrom}`}>
                  <ArrowSwitchIcon size={12} />
                  <VisuallyHidden>Renamed from {renamedFrom}</VisuallyHidden>
                </span>
              ) : (
                <StateMark state={entry.render.state} />
              )}
            </span>
            <span className="selfie-nav-details">
              <span className="selfie-nav-col" title={renamedFrom === undefined ? undefined : `Renamed from ${renamedFrom}`}>
                {renamedFrom !== undefined ? "Renamed" : <StateLabel state={entry.render.state} />}
              </span>
              <span className="selfie-nav-col">
                <DecisionLabel row={entry.render} />
              </span>
            </span>
            {more !== undefined && <span className="selfie-nav-more">{more}</span>}
          </>
        )}
      </a>
    </li>
  );
}

function FolderRow({ folder, depth, open, onToggle }: { folder: StoryFolder; depth: number; open: boolean; onToggle: () => void }) {
  const stories = storiesIn(folder);
  const rendered = stories.filter(({ render }) => render !== null).length;
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

interface TreeProps {
  readonly stories: readonly ListedStory[];
  readonly story: string | null;
  readonly search: string;
  readonly hrefOf: (story: string, query: string) => string;
  /** Whichever story here took over from a removed one. */
  readonly renames?: ReadonlyMap<string, string> | undefined;
  /** For a short list that's there to be gone through, rather than Storybook's whole sidebar. */
  readonly startOpen?: boolean | undefined;
  /** What else to say of a story, once the sidebar is dragged wide enough. */
  readonly more?: ((entry: ListedStory) => ReactNode) | undefined;
}

function StoryTree({ stories, story, search, hrefOf, renames, startOpen = false, more, filtering }: TreeProps & { filtering: boolean }) {
  const tree = useMemo(() => buildStoryTree(stories), [stories]);
  const entry = stories.find((candidate) => candidate.story === story);
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => (startOpen ? new Set() : openedAround(new Set(initiallyClosed(tree)), entry)));
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
          <StoryRow key={row.entry.story} entry={row.entry} depth={row.depth} href={hrefOf(row.entry.story, search)} current={row.entry.story === story} renamedFrom={renames?.get(row.entry.story)} more={more?.(row.entry)} />
        ) : (
          <FolderRow key={row.path} folder={row} depth={row.depth} open={filtering || !closed.has(row.path)} onToggle={() => toggle(row.path)} />
        ),
      )}
    </ul>
  );
}

function StorySidebar({ emptyWords, ...tree }: TreeProps & { emptyWords: string }) {
  const { stories, search } = tree;
  const filter = useMemo(() => parseFilter(search), [search]);
  const input = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => matchingStories(stories, filter.text), [stories, filter.text]);
  // Stays on this page, with whatever else the query says.
  const setText = (text: string) => navigate(`${window.location.pathname}${filterQuery({ ...filter, text })}`, { replace: true });
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
        onChange={(event) => setText(event.target.value)}
        trailingAction={
          filter.text === "" ? undefined : (
            <TextInput.Action
              icon={XCircleFillIcon}
              aria-label="Clear the search"
              onClick={() => {
                setText("");
                input.current?.focus();
              }}
            />
          )
        }
      />
      {shown.length > 0 ? (
        <StoryTree {...tree} stories={shown} filtering={filter.text !== ""} />
      ) : filter.text === "" ? (
        <Text as="p" className="selfie-muted">
          {emptyWords}
        </Text>
      ) : (
        <Stack gap="condensed" align="start">
          <Text as="p" className="selfie-muted">
            Nothing matches this filter.
          </Text>
          <Button size="small" onClick={() => setText("")}>
            Clear the filter
          </Button>
        </Stack>
      )}
    </nav>
  );
}

/** Stories at the left and whatever's being looked at on the right, as in Storybook. */
export function StoryNavLayout({ children, emptyWords = "No stories yet.", ...tree }: TreeProps & { children: ReactNode; emptyWords?: string }) {
  return (
    <div className="selfie-stories">
      <PageLayout containerWidth="full" padding="none" columnGap="none" rowGap="none">
        <PageLayout.Pane position="start" sticky resizable width="medium" divider="line" widthStorageKey="selfie-story-nav" aria-label="Stories">
          <StorySidebar {...tree} emptyWords={emptyWords} />
        </PageLayout.Pane>
        <PageLayout.Content padding="normal" width="full">
          <Stack gap="normal">{children}</Stack>
        </PageLayout.Content>
      </PageLayout>
    </div>
  );
}
