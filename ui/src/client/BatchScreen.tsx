// The batch: its facts, what blocks it, what to look at, and bulk decisions on what differs.
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
import type { BlockerReason, DecisionKind, BatchView, RenderRow } from "../shared/api.ts";
import { applyFilter, decidableIn, filterQuery, NO_FILTER, parseFilter, showQuery, SHOW_OPTIONS, targetsOf, type RowFilter, type Show } from "./filter.ts";
import { useStoryFocusKeys, useTitle, type BatchState } from "./hooks.ts";
import { Keys } from "./Keys.tsx";
import { AppLink, AppLinkButton, navigate, batchPath, storiesPath, storyPath } from "./router.tsx";
import { ActionFailure } from "./ActionFailure.tsx";
import { StoryLinks } from "./StoryLinks.tsx";
import { plural } from "../shared/plural.ts";
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

function Facts({ view }: { view: BatchView }) {
  const { batch, actor, siblings } = view;
  return (
    <dl className="selfie-facts">
      <Fact term="Commit">
        <Sha sha={batch.gitSha} />
      </Fact>
      <Fact term="Batch">
        <code>{batch.id}</code>
      </Fact>
      {batch.reusedFromBatch !== null && (
        <Fact term="Pixels">
          <ReusedPixels from={batch.reusedFromBatch} />
        </Fact>
      )}
      <Fact term="Working tree">{batch.dirty ? "Dirty when recorded" : "Clean when recorded"}</Fact>
      <Fact term="Environment">
        <code>{batch.environment}</code>
      </Fact>
      <Fact term="Recorded">
        <RelativeTime date={new Date(batch.startedAt)} />
      </Fact>
      <Fact term="Decisions are by">{actor ?? "Nobody: set git config user.email"}</Fact>
      {batch.storyFilter !== null && (
        <Fact term="Story filter">
          {batch.storyFilter.patterns.length > PATTERNS_LISTED ? (
            <span title={batch.storyFilter.patterns.join(" ")}>{batch.storyFilter.patterns.length} patterns</span>
          ) : (
            <code>{batch.storyFilter.patterns.join(" ")}</code>
          )}
        </Fact>
      )}
      {siblings.length > 1 && (
        <Fact term="Batches at this commit">
          <Select
            aria-label="Open another batch at this commit"
            value={batch.id}
            size="small"
            onChange={(event) => navigate(batchPath(event.target.value))}
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
  { reason: "added-unapproved", show: "undecided" },
  { reason: "removed", show: "removed" },
  { reason: "pattern-unmatched" },
];

function Blockers({ view, onShow }: { view: BatchView; onShow: (show: Show) => void }) {
  const byReason = Map.groupBy(view.blockers, ({ reason }) => reason);
  const present = BLOCKERS.filter(({ reason }) => byReason.has(reason));
  return (
    <Stack as="section" aria-labelledby="blockers-heading" gap="condensed">
      <Heading as="h3" id="blockers-heading" variant="small">
        Blocking this batch <CounterLabel>{view.blockers.length}</CounterLabel>
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
                    batchId={view.batch.id}
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

interface PendingBulk {
  readonly decision: DecisionKind;
  /** Each decidable, as they were when the dialog opened, which is exactly what gets sent. */
  readonly rows: readonly RenderRow[];
  /** All of the batch, as opposed to what a filter is showing. */
  readonly scope: "all" | "shown";
}

function BulkDialog({ pending, onClose }: { pending: PendingBulk; onClose: (confirmed: boolean) => void }) {
  const { decision, rows, scope } = pending;
  const verb = decision === "approved" ? "Approve" : "Reject";
  const count = (test: (row: RenderRow) => boolean) => rows.filter(test).length;
  const facts = [
    [count(({ state }) => state === "changed"), "changed"],
    [count(({ state }) => state === "added"), "added"],
    [count(({ decision: made }) => made?.decision === "approved"), "already approved"],
    [count(({ decision: made }) => made?.decision === "rejected"), "already rejected"],
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
          {scope === "all" ? "This decides on every image in this batch that has one to decide on." : "This decides on exactly the images the current filter shows."}{" "}
          A decision on an image holds in later batches too, until it's replaced.
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
  rows: readonly RenderRow[];
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
  state: BatchState;
  view: BatchView;
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
          <AppLinkButton variant="primary" href={storyPath(view.batch.id, undecided[0]!.story, showQuery("undecided"))}>
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
            {isFiltered ? "Nothing matches this filter" : "Nothing differs from what's approved"}
          </Blankslate.Heading>
          <Blankslate.Description>
            {isFiltered ? "Clear the filter to see every difference." : `All ${plural(view.counts.unchanged, "story", "stories")} rendered the same images as what's approved.`}
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

export function BatchScreen({
  state,
  view,
  search,
  returningFrom,
}: {
  state: BatchState;
  view: BatchView;
  search: string;
  returningFrom: RefObject<string | null>;
}) {
  const { batch, counts, outsideFilter } = view;
  const filter = useMemo(() => parseFilter(search), [search]);
  const setFilter = (next: RowFilter, replace = false) => navigate(batchPath(batch.id, filterQuery(next)), { replace });
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

  useTitle(`Batch at ${shortSha(batch.gitSha)}`);
  const newest = view.siblings.find(({ status }) => status !== "recording");

  return (
    <Stack gap="normal">
      <Stack direction="horizontal" align="center" justify="space-between" wrap="wrap" gap="condensed">
        <Heading as="h2" variant="medium">
          Batch at <Sha sha={batch.gitSha} />
        </Heading>
        <AppLink href={storiesPath()}>Every story</AppLink>
      </Stack>
      <ActionFailure state={state} />
      {newest !== undefined && newest.id !== batch.id && (
        <Banner
          variant="info"
          title="There's a newer batch at this commit"
          description={<AppLink href={batchPath(newest.id)}>Open the newest batch</AppLink>}
        />
      )}
      <Facts view={view} />
      {batch.dirty && (
        <Banner
          variant="warning"
          title="Recorded on a dirty tree"
          description={`The tree had uncommitted changes while this rendered, so these images may not describe ${shortSha(batch.gitSha)}. What you approve here still counts from that commit on.`}
        />
      )}
      <div className="selfie-counts">
        <Count label="Stories" count={counts.stories} onShow={showInList} />
        <Count label="Unchanged" count={counts.unchanged} show="unchanged" onShow={showInList} />
        <Count label="Changed" count={counts.changed} show="changed" onShow={showInList} />
        <Count label="Added" count={counts.added} show="added" onShow={showInList} />
        <Count label="Removed" count={counts.removed} show="removed" onShow={showInList} />
        <Count label="Failed" count={counts.failed} show="failed" onShow={showInList} />
        <Count label="Undecided" count={counts.undecided} show="undecided" onShow={showInList} />
      </div>
      {outsideFilter > 0 && (
        <Banner
          variant="info"
          title="This batch was filtered"
          description={`${plural(outsideFilter, "approved story", "approved stories")} ${outsideFilter === 1 ? "is" : "are"} outside its --story filter, so ${outsideFilter === 1 ? "it isn't" : "they aren't"} shown here, and ${outsideFilter === 1 ? "it stays" : "they stay"} approved.`}
        />
      )}
      <Blockers view={view} onShow={showInList} />
      <Differences state={state} view={view} filter={filter} setFilter={setFilter} />
    </Stack>
  );
}
