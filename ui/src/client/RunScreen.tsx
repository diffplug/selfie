// The run: its facts, what blocks it, what to look at, and bulk decisions on what differs.
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
  useDetails,
} from "@primer/react";
import { Blankslate, ScrollableRegion } from "@primer/react/experimental";
import { useEffect, useMemo, useState, type ComponentProps, type RefObject } from "react";
import type { AdvisoryReason, BlockerReason, DecisionKind, RunView, SnapshotRow } from "../shared/api.ts";
import { applyFilter, decidableIn, filterQuery, hasAdvisory, NO_FILTER, parseFilter, showQuery, SHOW_OPTIONS, targetsOf, type RowFilter, type Show } from "./filter.ts";
import { useStoryFocusKeys, useTitle, type RunState } from "./hooks.ts";
import { Keys } from "./Keys.tsx";
import { acceptPath, AppLink, AppLinkButton, navigate, runPath, storiesPath, storyPath } from "./router.tsx";
import { ActionFailure, RunNotes } from "./RunNotes.tsx";
import { StoryLinks } from "./StoryLinks.tsx";
import { plural } from "./plural.ts";
import { BLOCKER_WORDS, ReusedPixels, Sha, shortSha } from "./words.tsx";

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
  const { run, actor, siblings, branchGoldens } = view;
  return (
    <dl className="selfie-facts">
      <Fact term="Commit">
        <Sha sha={run.gitSha} />
      </Fact>
      <Fact term="Run">
        <code>{run.id}</code>
      </Fact>
      {run.reusedFromRun !== null && (
        <Fact term="Pixels">
          <ReusedPixels from={run.reusedFromRun} />
        </Fact>
      )}
      <Fact term="Working tree">{run.dirty ? "Dirty when recorded" : "Clean when recorded"}</Fact>
      <Fact term="Baseline">
        {run.baselineSha === null ? "None" : <Sha sha={run.baselineSha} />}
      </Fact>
      {branchGoldens !== null && (
        <Fact term="Compared with">
          <Sha sha={branchGoldens} />, on this branch
        </Fact>
      )}
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

function StoryList(props: ComponentProps<typeof StoryLinks>) {
  const { getDetailsProps } = useDetails({ closeOnOutsideClick: false });
  return (
    <Details {...getDetailsProps()} className="selfie-details">
      <summary>Show which</summary>
      <StoryLinks {...props} />
    </Details>
  );
}

const BLOCKERS: readonly { readonly reason: BlockerReason; readonly show?: Show }[] = [
  { reason: "failed", show: "failed" },
  { reason: "rejected", show: "rejected" },
  { reason: "changed-unapproved", show: "undecided" },
  { reason: "new-unapproved", show: "undecided" },
  { reason: "removed", show: "removed" },
  { reason: "pattern-unmatched" },
];

function Blockers({ view, onShow }: { view: RunView; onShow: (show: Show) => void }) {
  const byReason = Map.groupBy(view.blockers, ({ reason }) => reason);
  const present = BLOCKERS.filter(({ reason }) => byReason.has(reason));
  return (
    <Stack as="section" aria-labelledby="blockers-heading" gap="condensed">
      <Heading as="h3" id="blockers-heading" variant="small">
        Blocking this run <CounterLabel>{view.blockers.length}</CounterLabel>
      </Heading>
      {present.length === 0 ? (
        <Text as="p" className="selfie-muted">
          Nothing in its images: each is approved or unchanged, and nothing failed.
        </Text>
      ) : (
        <ul className="selfie-attention">
          {present.map(({ reason, show }) => {
            const entries = byReason.get(reason)!;
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
                {show === undefined ? (
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
                    show={show}
                    stories={entries.map(({ story, detail }) => ({ story: story!, detail: reason === "failed" ? detail : null }))}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Stack>
  );
}

const ADVISORIES: readonly { readonly reason: AdvisoryReason; readonly words: string }[] = [
  { reason: "play-error", words: "whose play function threw" },
];

function Advisories({ view }: { view: RunView }) {
  if (view.advisories.length === 0) return null;
  return (
    <Stack as="section" aria-labelledby="advisories-heading" gap="condensed">
      <Heading as="h3" id="advisories-heading" variant="small">
        Advisories <CounterLabel>{view.advisories.length}</CounterLabel>
      </Heading>
      <Text as="p" className="selfie-muted">
        These don't stop anything, but their images may not mean what they seem to.
      </Text>
      <ul className="selfie-attention">
        {ADVISORIES.map(({ reason, words }) => {
          const entries = view.advisories.filter((advisory) => advisory.reason === reason);
          if (entries.length === 0) return null;
          return (
            <li key={reason}>
              <Text weight="semibold">
                {plural(entries.length, "story", "stories")} {words}
              </Text>
              <StoryList runId={view.run.id} show="advisory" stories={entries.map(({ story, detail }) => ({ story: story!, detail }))} />
            </li>
          );
        })}
      </ul>
    </Stack>
  );
}

interface PendingBulk {
  readonly decision: DecisionKind;
  /** Each decidable, as they were when the dialog opened, which is exactly what gets sent. */
  readonly rows: readonly SnapshotRow[];
  /** All of the run, as opposed to what a filter is showing. */
  readonly scope: "all" | "shown";
}

function BulkDialog({ pending, onClose }: { pending: PendingBulk; onClose: (confirmed: boolean) => void }) {
  const { decision, rows, scope } = pending;
  const verb = decision === "approved" ? "Approve" : "Reject";
  const count = (test: (row: SnapshotRow) => boolean) => rows.filter(test).length;
  const facts = [
    [count(({ state }) => state === "changed"), "changed"],
    [count(({ state }) => state === "new"), "new"],
    [count(({ decision: made }) => made?.decision === "approved"), "already approved"],
    [count(({ decision: made }) => made?.decision === "rejected"), "already rejected"],
    [count(hasAdvisory), "with an advisory"],
  ] as const;
  return (
    <ConfirmationDialog
      title={`${verb} ${plural(rows.length, "image")}?`}
      confirmButtonContent={`${verb} ${plural(rows.length, "image")}`}
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
        <ScrollableRegion className="selfie-bulk-sample" aria-label="The images this decides on">
          {rows.slice(0, 200).map(({ story }) => (
            <div key={story}>{story}</div>
          ))}
          {rows.length > 200 && <div className="selfie-muted">and {rows.length - 200} more</div>}
        </ScrollableRegion>
      </Stack>
    </ConfirmationDialog>
  );
}

function BulkButton({
  decision,
  scope,
  rows,
  busy,
  onPick,
}: {
  decision: DecisionKind;
  scope: PendingBulk["scope"];
  rows: readonly SnapshotRow[];
  busy: boolean;
  onPick: (pending: PendingBulk) => void;
}) {
  const verb = decision === "approved" ? "Approve" : "Reject";
  const count = rows.length.toLocaleString();
  return (
    <Button
      variant={decision === "rejected" && scope === "all" ? "danger" : "default"}
      disabled={busy || rows.length === 0}
      onClick={() => onPick({ decision, rows, scope })}
    >
      {scope === "all" ? `${verb} all (${count})` : `${verb} ${count} shown`}
    </Button>
  );
}

function Differences({
  state,
  view,
  filter,
  setFilter,
}: {
  state: RunState;
  view: RunView;
  filter: RowFilter;
  setFilter: (filter: RowFilter, replace?: boolean) => void;
}) {
  const [pending, setPending] = useState<PendingBulk | null>(null);

  const { unchanged, loadUnchanged } = state;
  const wantsUnchanged = filter.show === "unchanged";
  useEffect(() => {
    if (wantsUnchanged && unchanged === null) loadUnchanged();
  }, [wantsUnchanged, unchanged, loadUnchanged]);

  const source = filter.show === "unchanged" ? (unchanged ?? []) : view.rows;
  const shown = useMemo(() => applyFilter(source, filter), [source, filter]);
  const allDecidable = useMemo(() => decidableIn(view.rows), [view.rows]);
  const shownDecidable = useMemo(() => decidableIn(shown), [shown]);
  const undecided = useMemo(() => applyFilter(view.rows, { ...NO_FILTER, show: "undecided" }), [view.rows]);
  const isFiltered = filter.text !== "" || filter.show !== "all";
  const loadingUnchanged = wantsUnchanged && unchanged === null;

  const confirm = async (confirmed: boolean) => {
    const decided = pending;
    setPending(null);
    if (confirmed && decided !== null) await state.decide(decided.decision, targetsOf(decided.rows));
  };

  return (
    <Stack as="section" aria-labelledby="differences-heading" gap="condensed">
      <Stack direction="horizontal" align="center" justify="space-between" wrap="wrap" gap="condensed">
        <Heading as="h3" id="differences-heading" variant="small">
          Differences
        </Heading>
        {undecided.length > 0 && (
          <AppLinkButton variant="primary" href={storyPath(view.run.id, undecided[0]!.story, showQuery("undecided"))}>
            Review {plural(undecided.length, "undecided image")}
          </AppLinkButton>
        )}
      </Stack>
      <Stack direction="horizontal" wrap="wrap" align="end" gap="normal">
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
        <Stack direction="horizontal" wrap="wrap" gap="condensed" className="selfie-bulk" role="group" aria-label="Decide on many images">
          {isFiltered && (
            <>
              <BulkButton decision="approved" scope="shown" rows={shownDecidable} busy={state.busy} onPick={setPending} />
              <BulkButton decision="rejected" scope="shown" rows={shownDecidable} busy={state.busy} onPick={setPending} />
            </>
          )}
          <BulkButton decision="approved" scope="all" rows={allDecidable} busy={state.busy} onPick={setPending} />
          <BulkButton decision="rejected" scope="all" rows={allDecidable} busy={state.busy} onPick={setPending} />
        </Stack>
      </Stack>
      <Text as="p" className="selfie-muted" role="status">
        {loadingUnchanged ? "Reading the unchanged stories…" : `Showing ${shown.length.toLocaleString()} of ${source.length.toLocaleString()}.`}{" "}
        <Keys keys="j" /> and <Keys keys="k" /> move through the list, <Keys keys="/" /> searches.
      </Text>
      {shown.length > 0 || loadingUnchanged ? null : (
        <Blankslate border>
          <Blankslate.Heading as="h4">
            {isFiltered ? "Nothing matches this filter" : "Nothing differs from the baseline"}
          </Blankslate.Heading>
          <Blankslate.Description>
            {isFiltered ? "Clear the filter to see every difference." : `All ${plural(view.counts.unchanged, "story", "stories")} rendered the same images as the baseline.`}
          </Blankslate.Description>
          {isFiltered && (
            <Stack direction="horizontal" justify="center">
              <Button onClick={() => setFilter(NO_FILTER)}>Clear the filter</Button>
            </Stack>
          )}
        </Blankslate>
      )}
      {pending !== null && <BulkDialog pending={pending} onClose={(confirmed) => void confirm(confirmed)} />}
    </Stack>
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
  const { run, counts, refusals, acceptedRunId, removals } = view;
  const filter = useMemo(() => parseFilter(search), [search]);
  const setFilter = (next: RowFilter, replace = false) => navigate(runPath(run.id, filterQuery(next)), { replace });
  const showInList = (show: Show) => {
    setFilter({ ...NO_FILTER, show });
  };

  // Coming back from a story, the list picks up where the reviewer left it.
  useEffect(() => {
    const story = returningFrom.current;
    returningFrom.current = null;
    if (story === null) return;
    document.querySelector<HTMLElement>(`[data-story="${CSS.escape(story)}"]`)?.focus();
  }, [returningFrom]);

  useStoryFocusKeys();

  useTitle(`Run at ${shortSha(run.gitSha)}`);
  const newest = view.siblings.find(({ status }) => status !== "recording");
  const stopsAccept = refusals.filter(({ reason }) => reason !== "removed-unacknowledged");
  const ready = stopsAccept.length === 0 && acceptedRunId !== run.id;
  const { outsideFilter } = removals;

  return (
    <Stack gap="normal">
      <Stack direction="horizontal" align="center" justify="space-between" wrap="wrap" gap="condensed">
        <Heading as="h2" variant="medium">
          Run at <Sha sha={run.gitSha} />
        </Heading>
        <AppLink href={storiesPath()}>Every story</AppLink>
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
      {run.dirty && (
        <Banner
          variant="warning"
          title="Recorded on a dirty tree"
          description={`The tree had uncommitted changes while this rendered, so these images don't describe ${shortSha(run.gitSha)} and can't become its goldens. You can still decide on them. Commit, then run selfie review again: your approvals carry over.`}
        />
      )}
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
      {outsideFilter > 0 && (
        <Banner
          variant="info"
          title="This run was filtered"
          description={`${plural(outsideFilter, "golden")} of the baseline ${outsideFilter === 1 ? "is" : "are"} outside its --story filter, so ${outsideFilter === 1 ? "it isn't" : "they aren't"} compared here. Accepting would drop ${outsideFilter === 1 ? "it" : "them"}.`}
        />
      )}
      <Blockers view={view} onShow={showInList} />
      <Advisories view={view} />
      <Differences state={state} view={view} filter={filter} setFilter={setFilter} />
    </Stack>
  );
}
