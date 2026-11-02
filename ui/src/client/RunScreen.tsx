// The run: its facts, what blocks it, what to look at, and every difference, with bulk decisions.
import { SearchIcon } from "@primer/octicons-react";
import {
  Banner,
  Button,
  ConfirmationDialog,
  CounterLabel,
  Details,
  FormControl,
  Heading,
  Link,
  RelativeTime,
  Select,
  Stack,
  Text,
  TextInput,
  useDetails,
} from "@primer/react";
import { Blankslate, ScrollableRegion, Table } from "@primer/react/experimental";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Attention, BlockerReason, DecisionKind, RunView, SnapshotRow } from "../shared/api.ts";
import { imageUrl } from "./api.ts";
import { applyFilter, decisionTargets, filterQuery, isDecidable, parseFilter, SHOW_OPTIONS, type RowFilter, type Show } from "./filter.ts";
import { useHotkeys, useTitle, type RunState } from "./hooks.ts";
import { Keys } from "./Keys.tsx";
import { acceptPath, AppLink, AppLinkButton, navigate, runPath, storyPath } from "./router.tsx";
import { ActionFailure, RunNotes } from "./RunNotes.tsx";
import { AdvisoryLabels, BLOCKER_WORDS, DecisionLabel, describePixels, plural, shortSha, StateLabel } from "./words.tsx";

/** A longer list is one click away, in the table with its filter set. */
const STORIES_LISTED = 25;
const PATTERNS_LISTED = 3;

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="selfie-fact">
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Facts({ view }: { view: RunView }) {
  const { run, baseline, actor, siblings } = view;
  return (
    <dl className="selfie-facts">
      <Fact term="Commit">
        <code title={run.gitSha}>{shortSha(run.gitSha)}</code>
      </Fact>
      <Fact term="Run">
        <code>{run.id}</code>
      </Fact>
      <Fact term="Working tree">{run.dirty ? "Dirty when recorded" : "Clean when recorded"}</Fact>
      <Fact term="Baseline">
        {baseline.sha === null ? "None" : <code title={baseline.sha}>{shortSha(baseline.sha)}</code>}
      </Fact>
      <Fact term="Environment">
        <code>{run.environment}</code>
      </Fact>
      <Fact term="Recorded">
        <RelativeTime date={new Date(run.startedAt)} />
      </Fact>
      <Fact term="Decisions are by">{actor ?? "Nobody: set git config user.email"}</Fact>
      {run.storyFilter !== null && (
        <Fact term="Story filter">
          {run.storyFilter.patterns.length > PATTERNS_LISTED ? (
            <span title={run.storyFilter.patterns.join(" ")}>{run.storyFilter.patterns.length} patterns</span>
          ) : (
            <code>{run.storyFilter.patterns.join(" ")}</code>
          )}
        </Fact>
      )}
      {siblings.length > 1 && (
        <Fact term="Runs at this commit">
          <Select
            aria-label="Open another run at this commit"
            value={run.id}
            size="small"
            onChange={(event) => navigate(runPath(event.target.value))}
          >
            {siblings.map((sibling, index) => (
              <Select.Option key={sibling.id} value={sibling.id} disabled={sibling.status === "recording"}>
                {`${new Date(sibling.startedAt).toLocaleString()}${index === 0 ? " (newest)" : ""}${sibling.dirty ? " dirty" : ""}${sibling.status === "recording" ? " unfinished" : ""}`}
              </Select.Option>
            ))}
          </Select>
        </Fact>
      )}
    </dl>
  );
}

function Count({ label, count, show, onShow }: { label: string; count: number; show?: Show; onShow: (show: Show) => void }) {
  return (
    <div className="selfie-count">
      {show !== undefined && count > 0 ? (
        <Link as="button" className="selfie-count-number" onClick={() => onShow(show)} aria-label={`Show ${label.toLowerCase()}: ${count}`}>
          {count.toLocaleString()}
        </Link>
      ) : (
        <span className="selfie-count-number">{count.toLocaleString()}</span>
      )}
      <span className="selfie-count-label">{label}</span>
    </div>
  );
}

function StoryList({ runId, stories, query }: { runId: string; stories: readonly { story: string; detail?: string | null }[]; query: string }) {
  const { getDetailsProps } = useDetails({ closeOnOutsideClick: false });
  const listed = stories.slice(0, STORIES_LISTED);
  return (
    <Details {...getDetailsProps()} className="selfie-details">
      <summary>Show which</summary>
      <ul className="selfie-story-list">
        {listed.map(({ story, detail }) => (
          <li key={story}>
            <AppLink href={storyPath(runId, story, query)}>{story}</AppLink>
            {detail ? <div className="selfie-detail-text">{detail}</div> : null}
          </li>
        ))}
        {stories.length > listed.length && <li className="selfie-muted">and {stories.length - listed.length} more, in the list below</li>}
      </ul>
    </Details>
  );
}

const BLOCKER_ORDER: readonly BlockerReason[] = [
  "failed",
  "rejected",
  "changed-unapproved",
  "new-unapproved",
  "removed",
  "pattern-unmatched",
];

const BLOCKER_SHOW: Readonly<Partial<Record<BlockerReason, Show>>> = {
  failed: "failed",
  rejected: "rejected",
  "changed-unapproved": "undecided",
  "new-unapproved": "undecided",
  removed: "removed",
};

function Blockers({ view, onShow }: { view: RunView; onShow: (show: Show) => void }) {
  const groups = useMemo(() => {
    const byReason = new Map<BlockerReason, Attention<BlockerReason>[]>();
    for (const blocker of view.blockers) {
      byReason.set(blocker.reason, [...(byReason.get(blocker.reason) ?? []), blocker]);
    }
    return BLOCKER_ORDER.flatMap((reason) => {
      const entries = byReason.get(reason);
      return entries === undefined ? [] : [{ reason, entries }];
    });
  }, [view.blockers]);

  return (
    <section aria-labelledby="blockers-heading" className="selfie-section">
      <Heading as="h3" id="blockers-heading" variant="small">
        Blocking this run <CounterLabel>{view.blockers.length}</CounterLabel>
      </Heading>
      {groups.length === 0 ? (
        <Text as="p" className="selfie-muted">
          Nothing in its images: each is approved or unchanged, and nothing failed.
        </Text>
      ) : (
        <ul className="selfie-attention">
          {groups.map(({ reason, entries }) => {
            const show = BLOCKER_SHOW[reason];
            return (
              <li key={reason}>
                <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
                  <Text weight="semibold">{BLOCKER_WORDS[reason](entries.length)}</Text>
                  {show !== undefined && (
                    <Link as="button" className="selfie-inline-link" onClick={() => onShow(show)}>
                      Show in the list
                    </Link>
                  )}
                </Stack>
                {reason === "pattern-unmatched" ? (
                  <ul className="selfie-story-list">
                    {entries.map(({ detail }) => (
                      <li key={detail}>
                        <code>{detail}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <StoryList
                    runId={view.run.id}
                    query={filterQuery({ text: "", show: show ?? "all" })}
                    stories={entries.map(({ story, detail }) => ({
                      story: story!,
                      detail: reason === "failed" ? detail : null,
                    }))}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Advisories({ view }: { view: RunView }) {
  if (view.advisories.length === 0) return null;
  const query = filterQuery({ text: "", show: "advisory" });
  const plays = view.advisories.filter(({ reason }) => reason === "play-error");
  const unstable = view.advisories.filter(({ reason }) => reason === "unstable");
  return (
    <section aria-labelledby="advisories-heading" className="selfie-section">
      <Heading as="h3" id="advisories-heading" variant="small">
        Advisories <CounterLabel>{view.advisories.length}</CounterLabel>
      </Heading>
      <Text as="p" className="selfie-muted">
        These don't stop anything, but their images may not mean what they seem to.
      </Text>
      <ul className="selfie-attention">
        {plays.length > 0 && (
          <li>
            <Text weight="semibold">{plural(plays.length, "story", "stories")} whose play function threw</Text>
            <StoryList runId={view.run.id} query={query} stories={plays.map(({ story, detail }) => ({ story: story!, detail }))} />
          </li>
        )}
        {unstable.length > 0 && (
          <li>
            <Text weight="semibold">{plural(unstable.length, "story", "stories")} that rendered differently twice</Text>
            <StoryList runId={view.run.id} query={query} stories={unstable.map(({ story }) => ({ story: story! }))} />
          </li>
        )}
      </ul>
    </section>
  );
}

const Row = memo(function Row({ row, runId, query }: { row: SnapshotRow; runId: string; query: string }) {
  const thumbnail = row.imageHash ?? row.goldenHash;
  const href = storyPath(runId, row.story, query);
  return (
    <Table.Row>
      <Table.Cell>
        {thumbnail !== null ? (
          <img className="selfie-thumb" src={imageUrl(thumbnail)} alt="" loading="lazy" decoding="async" width={64} height={48} />
        ) : (
          <div className="selfie-thumb selfie-thumb-empty" aria-hidden="true" />
        )}
      </Table.Cell>
      <Table.Cell>
        <AppLink href={href} data-story={row.story} className="selfie-story-link">
          {row.story}
        </AppLink>
      </Table.Cell>
      <Table.Cell>
        <StateLabel state={row.state} />
      </Table.Cell>
      <Table.Cell>
        <DecisionLabel row={row} />
      </Table.Cell>
      <Table.Cell>
        <span className="selfie-nowrap">{row.state === "failed" ? "No image" : describePixels(row.pixelDiff)}</span>
      </Table.Cell>
      <Table.Cell>
        <Stack as="span" direction="horizontal" gap="condensed" wrap="wrap">
          <AdvisoryLabels row={row} />
        </Stack>
      </Table.Cell>
    </Table.Row>
  );
});

function StoriesTable({ rows, runId, query }: { rows: readonly SnapshotRow[]; runId: string; query: string }) {
  return (
    <ScrollableRegion aria-labelledby="differences-heading">
      <Table aria-labelledby="differences-heading" cellPadding="condensed" gridTemplateColumns="80px minmax(200px, 1fr) 120px 170px 190px 130px">
        <Table.Head>
          <Table.Row>
            <Table.Header>
              <span className="selfie-visually-hidden">Preview</span>
            </Table.Header>
            <Table.Header>Story</Table.Header>
            <Table.Header>State</Table.Header>
            <Table.Header>Decision</Table.Header>
            <Table.Header>Pixels</Table.Header>
            <Table.Header>Advisories</Table.Header>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {rows.map((row) => (
            <Row key={row.story} row={row} runId={runId} query={query} />
          ))}
        </Table.Body>
      </Table>
    </ScrollableRegion>
  );
}

interface PendingBulk {
  readonly decision: DecisionKind;
  readonly rows: readonly SnapshotRow[];
  /** All of the run, as opposed to what a filter is showing. */
  readonly scope: "all" | "shown";
}

function BulkDialog({ pending, onClose }: { pending: PendingBulk; onClose: (confirmed: boolean) => void }) {
  const { decision, rows, scope } = pending;
  const verb = decision === "approved" ? "Approve" : "Reject";
  const targets = rows.filter(isDecidable);
  const count = (test: (row: SnapshotRow) => boolean) => targets.filter(test).length;
  const facts = [
    [count(({ state }) => state === "changed"), "changed"],
    [count(({ state }) => state === "new"), "new"],
    [count(({ decision: made }) => made?.decision === "approved"), "already approved"],
    [count(({ decision: made }) => made?.decision === "rejected"), "already rejected"],
    [count(({ playError, unstable }) => playError !== null || unstable === true), "with an advisory"],
  ] as const;
  return (
    <ConfirmationDialog
      title={`${verb} ${plural(targets.length, "image")}?`}
      confirmButtonContent={`${verb} ${plural(targets.length, "image")}`}
      cancelButtonContent="Cancel"
      confirmButtonType="danger"
      width="large"
      onClose={(gesture) => onClose(gesture === "confirm")}
    >
      <Stack gap="condensed">
        <Text as="p">
          {scope === "all" ? "This decides on every image in this run that has one to decide on." : "This decides on exactly the images the current filter shows."}{" "}
          A decision on an image holds in later runs too, until it's replaced.
        </Text>
        <ul className="selfie-bulk-facts">
          {facts
            .filter(([value]) => value > 0)
            .map(([value, words]) => (
              <li key={words}>
                {value.toLocaleString()} {words}
              </li>
            ))}
        </ul>
        <div className="selfie-bulk-sample" tabIndex={0} role="group" aria-label="The images this decides on">
          {targets.slice(0, 200).map(({ story }) => (
            <div key={story}>{story}</div>
          ))}
          {targets.length > 200 && <div className="selfie-muted">and {targets.length - 200} more</div>}
        </div>
      </Stack>
    </ConfirmationDialog>
  );
}

function Differences({
  state,
  view,
  filter,
  setFilter,
  filterInput,
}: {
  state: RunState;
  view: RunView;
  filter: RowFilter;
  setFilter: (filter: RowFilter, replace?: boolean) => void;
  filterInput: RefObject<HTMLInputElement | null>;
}) {
  const [pending, setPending] = useState<PendingBulk | null>(null);
  const [text, setText] = useState(filter.text);
  useEffect(() => setText(filter.text), [filter.text]);

  const { unchanged, loadUnchanged } = state;
  const wantsUnchanged = filter.show === "unchanged";
  useEffect(() => {
    if (wantsUnchanged && unchanged === null) loadUnchanged();
  }, [wantsUnchanged, unchanged, loadUnchanged]);

  const deferredFilter = useDeferredValue(filter);
  const source = deferredFilter.show === "unchanged" ? (unchanged ?? []) : view.rows;
  const shown = useMemo(() => applyFilter(source, deferredFilter), [source, deferredFilter]);
  const query = filterQuery(deferredFilter);
  const allTargets = useMemo(() => decisionTargets(view.rows).length, [view.rows]);
  const shownTargets = useMemo(() => decisionTargets(shown).length, [shown]);
  const isFiltered = filter.text !== "" || filter.show !== "all";
  const loadingUnchanged = wantsUnchanged && unchanged === null;
  const undecided = useMemo(() => applyFilter(view.rows, { text: "", show: "undecided" }), [view.rows]);

  const confirm = async (confirmed: boolean) => {
    const decided = pending;
    setPending(null);
    if (confirmed && decided !== null) await state.decide(decided.decision, decisionTargets(decided.rows));
  };

  return (
    <section aria-labelledby="differences-heading" className="selfie-section">
      <Stack direction="horizontal" align="center" justify="space-between" wrap="wrap" gap="condensed">
        <Heading as="h3" id="differences-heading" variant="small">
          Differences
        </Heading>
        {undecided.length > 0 && (
          <AppLinkButton variant="primary" href={storyPath(view.run.id, undecided[0]!.story, filterQuery({ text: "", show: "undecided" }))}>
            Review {plural(undecided.length, "undecided image")}
          </AppLinkButton>
        )}
      </Stack>
      <div className="selfie-toolbar">
        <FormControl>
          <FormControl.Label>Filter by story</FormControl.Label>
          <TextInput
            ref={filterInput}
            leadingVisual={SearchIcon}
            value={text}
            placeholder="Press / to search"
            onChange={(event) => {
              setText(event.target.value);
              setFilter({ ...filter, text: event.target.value }, true);
            }}
          />
        </FormControl>
        <FormControl>
          <FormControl.Label>Show</FormControl.Label>
          <Select value={filter.show} onChange={(event) => setFilter({ ...filter, show: event.target.value as Show })}>
            {SHOW_OPTIONS.map(([value, words]) => (
              <Select.Option key={value} value={value}>
                {words}
              </Select.Option>
            ))}
          </Select>
        </FormControl>
        <div className="selfie-bulk" role="group" aria-label="Decide on many images">
          {isFiltered && (
            <>
              <Button disabled={state.busy || shownTargets === 0} onClick={() => setPending({ decision: "approved", rows: shown, scope: "shown" })}>
                Approve {shownTargets.toLocaleString()} shown
              </Button>
              <Button disabled={state.busy || shownTargets === 0} onClick={() => setPending({ decision: "rejected", rows: shown, scope: "shown" })}>
                Reject {shownTargets.toLocaleString()} shown
              </Button>
            </>
          )}
          <Button disabled={state.busy || allTargets === 0} onClick={() => setPending({ decision: "approved", rows: view.rows, scope: "all" })}>
            Approve all ({allTargets.toLocaleString()})
          </Button>
          <Button variant="danger" disabled={state.busy || allTargets === 0} onClick={() => setPending({ decision: "rejected", rows: view.rows, scope: "all" })}>
            Reject all ({allTargets.toLocaleString()})
          </Button>
        </div>
      </div>
      <Text as="p" className="selfie-muted" role="status">
        {loadingUnchanged ? "Reading the unchanged stories…" : `Showing ${shown.length.toLocaleString()} of ${source.length.toLocaleString()}.`}{" "}
        <Keys keys="j" /> and <Keys keys="k" /> move through the list, <Keys keys="/" /> searches.
      </Text>
      {shown.length > 0 ? (
        <StoriesTable rows={shown} runId={view.run.id} query={query} />
      ) : loadingUnchanged ? null : (
        <Blankslate border>
          <Blankslate.Heading as="h4">
            {isFiltered ? "Nothing matches this filter" : "Nothing differs from the baseline"}
          </Blankslate.Heading>
          <Blankslate.Description>
            {isFiltered ? "Clear the filter to see every difference." : `All ${plural(view.counts.unchanged, "story", "stories")} rendered the same images as the baseline.`}
          </Blankslate.Description>
          {isFiltered && (
            <Stack direction="horizontal" justify="center">
              <Button onClick={() => setFilter({ text: "", show: "all" })}>Clear the filter</Button>
            </Stack>
          )}
        </Blankslate>
      )}
      {pending !== null && <BulkDialog pending={pending} onClose={(confirmed) => void confirm(confirmed)} />}
    </section>
  );
}

export function RunScreen({
  state,
  view,
  search,
  returningFrom,
}: {
  state: RunState;
  view: RunView;
  search: string;
  returningFrom: RefObject<string | null>;
}) {
  const { run, counts, refusals, acceptedRunId } = view;
  const filter = useMemo(() => parseFilter(search), [search]);
  const filterInput = useRef<HTMLInputElement>(null);
  const setFilter = (next: RowFilter, replace = false) => navigate(runPath(run.id, filterQuery(next)), { replace });
  const showInList = (show: Show) => {
    setFilter({ text: "", show });
    document.getElementById("differences-heading")?.scrollIntoView();
  };

  // Coming back from a story, the list picks up where the reviewer left it.
  useEffect(() => {
    const story = returningFrom.current;
    returningFrom.current = null;
    if (story === null) return;
    document.querySelector<HTMLElement>(`[data-story="${CSS.escape(story)}"]`)?.focus();
  }, [returningFrom]);

  const links = () => [...document.querySelectorAll<HTMLElement>("[data-story]")];
  const moveFocus = (delta: number) => {
    const all = links();
    if (all.length === 0) return;
    const at = all.indexOf(document.activeElement as HTMLElement);
    all[at === -1 ? 0 : Math.max(0, Math.min(all.length - 1, at + delta))]?.focus();
  };
  useHotkeys({
    j: () => moveFocus(1),
    k: () => moveFocus(-1),
    "/": () => filterInput.current?.focus(),
  });

  useTitle(`Run at ${shortSha(run.gitSha)}`);
  const newest = view.siblings.find(({ status }) => status !== "recording");
  const stopsAccept = refusals.filter(({ reason }) => reason !== "removed-unacknowledged");
  const ready = stopsAccept.length === 0 && acceptedRunId !== run.id;

  return (
    <Stack gap="normal">
      <Stack direction="horizontal" align="center" justify="space-between" wrap="wrap" gap="condensed">
        <Heading as="h2" variant="medium">
          Run at <code title={run.gitSha}>{shortSha(run.gitSha)}</code>
        </Heading>
        <AppLinkButton variant={ready ? "primary" : "default"} href={acceptPath(run.id)}>
          {acceptedRunId === run.id ? "Accepted" : ready ? "Accept this run" : "Why can't this be accepted?"}
        </AppLinkButton>
      </Stack>
      <ActionFailure state={state} />
      {newest !== undefined && newest.id !== run.id && (
        <Banner
          variant="info"
          title="There's a newer run at this commit"
          description={<AppLink href={runPath(newest.id)}>Open the newest run</AppLink>}
        />
      )}
      <Facts view={view} />
      <RunNotes view={view} />
      <div className="selfie-counts">
        <Count label="Stories" count={counts.stories} onShow={showInList} />
        <Count label="Unchanged" count={counts.unchanged} show="unchanged" onShow={showInList} />
        <Count label="Changed" count={counts.changed} show="changed" onShow={showInList} />
        <Count label="New" count={counts.new} show="new" onShow={showInList} />
        <Count label="Removed" count={counts.removed} show="removed" onShow={showInList} />
        <Count label="Failed" count={counts.failed} show="failed" onShow={showInList} />
        <Count label="Undecided" count={counts.undecided} show="undecided" onShow={showInList} />
        <Count label="Advisories" count={counts.advisories} show="advisory" onShow={showInList} />
      </div>
      {view.notRendered.length > 0 && (
        <Banner
          variant="info"
          title="This run was filtered"
          description={`${plural(view.notRendered.length, "golden")} of the baseline ${view.notRendered.length === 1 ? "is" : "are"} outside its --story filter, so ${view.notRendered.length === 1 ? "it isn't" : "they aren't"} compared here. Accepting would drop ${view.notRendered.length === 1 ? "it" : "them"}.`}
          hideTitle={false}
        />
      )}
      <Blockers view={view} onShow={showInList} />
      <Advisories view={view} />
      <Differences state={state} view={view} filter={filter} setFilter={setFilter} filterInput={filterInput} />
    </Stack>
  );
}
