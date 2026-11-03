// One snapshot: its images, its numbers, and its decision, with the keyboard doing most of the work.
import { ArrowLeftIcon, CheckIcon, XIcon } from "@primer/octicons-react";
import { Banner, Button, Dialog, Heading, RelativeTime, Stack, Text } from "@primer/react";
import { AriaStatus } from "@primer/react/experimental";
import { useCallback, useEffect, useMemo, useState } from "react";
import { findRenames } from "../shared/renames.ts";
import { isDecidable } from "selfie-store";
import type { DecisionKind, PixelDiff, RunView, SnapshotRow } from "../shared/api.ts";
import { diffImageUrl, fetchDiff, imageUrl } from "./api.ts";
import { applyFilter, neighbors, parseFilter, positionWords, targetsOf } from "./filter.ts";
import { useFetched, useHotkeys, useRegionSelection, useTitle, type FeedbackState, type RunState } from "./hooks.ts";
import { ImageCompare } from "./ImageCompare.tsx";
import { Keys } from "./Keys.tsx";
import { acceptPath, AppLink, navigate, runPath, storyPath } from "./router.tsx";
import { ActionFailure } from "./RunNotes.tsx";
import { LiveStories, StorybookLinkTo } from "./LiveStories.tsx";
import { LoadFailure, Loading } from "./Status.tsx";
import { describeBox, groupRegions, isLayoutOnly } from "../shared/regions.ts";
import { comparedImage, newestNotedImage } from "../shared/notes.ts";
import { plural } from "./plural.ts";
import { AdvisoryLabels, DecisionLabel, describePixels, sizeChanged, StateLabel } from "./words.tsx";

const SHORTCUTS: readonly (readonly [string, string])[] = [
  ["j", "Next story"],
  ["k", "Previous story"],
  ["a", "Approve, then go to the next"],
  ["r", "Reject, then go to the next"],
  ["s", "Side by side"],
  ["f", "Stacked at the current zoom, then flip between current and golden"],
  ["d", "Show the diff"],
  ["z", "Next zoom: actual size, 1×, 2×, 4×, 8×"],
  ["c", "Center on the region being looked at, or else the change"],
  ["l", "Open or close the live stories"],
  ["m", "Write a note for your agent"],
  ["w", "Show the image a note was written on"],
  ["n", "Next region"],
  ["p", "Previous region"],
  ["x", "Select the region being looked at, or the first"],
  ["u", "Up to the run, or to where this commit stands"],
  ["?", "This list"],
];

function ShortcutsDialog({ onClose }: { readonly onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} width="large">
      <dl className="selfie-shortcuts">
        {SHORTCUTS.map(([key, words]) => (
          <div key={key}>
            <dt>
              <Keys keys={key} />
            </dt>
            <dd>{words}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

function PixelStats({ stats }: { stats: PixelDiff }) {
  const box = stats.boundingBox;
  const account = [
    stats.movedPixels > 0 && `${stats.movedPixels.toLocaleString()} moved`,
    stats.spacingPixels > 0 && `${stats.spacingPixels.toLocaleString()} spacing`,
  ].filter(Boolean);
  return (
    <Text className="selfie-muted">
      <strong>{describePixels(stats)}</strong>
      {!isLayoutOnly(stats) && ` of ${stats.totalPixels.toLocaleString()} changed`}
      {box === null ? "" : `, within ${describeBox(box)}`}.
      {account.length > 0 && ` ${account.join(", ")} pixels.`}
      {stats.maxChannelDelta > 0 && ` The largest difference in a channel is ${stats.maxChannelDelta} of 255.`}
      {account.length > 0 && " In the diff, pink changed, blue moved, and yellow is spacing that grew or shrank."}
    </Text>
  );
}

function Notes({ row, diff, renamedFrom, renamedTo }: { row: SnapshotRow; diff: PixelDiff | null; renamedFrom?: string | undefined; renamedTo?: string | undefined }) {
  return (
    <>
      {row.state === "failed" && (
        <Banner variant="critical" title="This story failed to render" description={<code className="selfie-pre">{row.failure ?? "No message was recorded."}</code>} />
      )}
      {row.state === "new" &&
        (renamedFrom !== undefined ? (
          <Banner
            variant="info"
            title="Renamed story"
            description={
              <>
                This image is the very one <code>{renamedFrom}</code> has as its golden, and this run doesn't have that story. Approving lets this be its first golden under this name. Accepting still asks you to acknowledge that <code>{renamedFrom}</code> is gone.
              </>
            }
          />
        ) : (
          <Banner variant="info" title="New story" description="The baseline has no golden for it, so there's nothing to compare. Approving lets this image become its first golden." />
        ))}
      {row.state === "removed" && renamedTo !== undefined && (
        <Banner variant="info" title="Renamed story" description={<>The new story <code>{renamedTo}</code> has this very image, so it looks to have been renamed.</>} />
      )}
      {row.state === "removed" && (
        <Banner variant="warning" title="Removed story" description="The baseline has this golden, and this run doesn't have the story. There's no image to decide on: accepting asks you to acknowledge the removal." />
      )}
      {row.state === "unchanged" && <Banner variant="info" title="Unchanged" description="This image is the same as the baseline's." />}
      {diff !== null && isLayoutOnly(diff) && (
        <Banner variant="info" title="Moved and spacing only" description="Everything in this image is in the golden too, and only where it sits changed. That can still be a bug, so it needs a decision like any other." />
      )}
      {diff !== null && sizeChanged(diff) && (
        <Banner variant="warning" title="The size changed" description="The images are different sizes, and they're shown from their top left corners, so what's below the change won't line up when flipping." />
      )}
      {row.playError !== null && (
        <Banner variant="warning" title="Its play function threw" description={<code className="selfie-pre">{row.playError}</code>} />
      )}
    </>
  );
}

/** Where the keys go on a story that's part of something larger than its run. By default, its run's list. */
export interface StoryNavigation {
  readonly previous: string | null;
  readonly next: string | null;
  readonly list: string;
  readonly position: string;
}

/** Where this story is, and the way to the ones either side of it. */
export function StoryPager({ previous, next, position }: Pick<StoryNavigation, "previous" | "next" | "position">) {
  const go = (href: string | null) => {
    if (href !== null) navigate(href, { replace: true });
  };
  return (
    <>
      <Text className="selfie-muted">{position}</Text>
      <Button onClick={() => go(previous)} disabled={previous === null} trailingVisual={() => <Keys keys="k" />}>
        Previous
      </Button>
      <Button onClick={() => go(next)} disabled={next === null} trailingVisual={() => <Keys keys="j" />}>
        Next
      </Button>
    </>
  );
}

export function DetailScreen({
  state,
  view,
  story,
  search,
  feedback,
  navigation,
  liveStories,
  startNote = false,
  treeOrder,
}: {
  state: RunState;
  view: RunView;
  story: string;
  search: string;
  feedback: FeedbackState;
  navigation?: StoryNavigation;
  /** Whether the live stories are open, if it's kept above this screen, which a new run starts afresh. */
  liveStories?: readonly [boolean, (open: boolean) => void];
  /** Someone asked to write a note on this story, and it's just been rendered so they can. */
  startNote?: boolean;
  /** The stories of the list beside this page, from the top. */
  treeOrder?: readonly string[];
}) {
  const { unchanged, loadUnchanged } = state;
  const filter = useMemo(() => parseFilter(search), [search]);
  const renames = useMemo(() => findRenames(view.rows), [view.rows]);
  const inRows = view.rows.find((candidate) => candidate.story === story);
  const needsUnchanged = (filter.show === "unchanged" || inRows === undefined) && unchanged === null;
  useEffect(() => {
    if (needsUnchanged) loadUnchanged();
  }, [needsUnchanged, loadUnchanged]);

  const source = filter.show === "unchanged" ? (unchanged ?? []) : view.rows;
  // Next and previous go as the list beside this reads, and through only what's in it.
  const all = useMemo(() => {
    if (treeOrder === undefined) return source;
    const bySource = new Map(source.map((candidate) => [candidate.story, candidate]));
    return treeOrder.flatMap((name) => bySource.get(name) ?? []);
  }, [source, treeOrder]);
  const shown = useMemo(() => applyFilter(all, filter), [all, filter]);
  const row = inRows ?? unchanged?.find((candidate) => candidate.story === story) ?? null;
  const { previous: previousRow, next: nextRow } = useMemo(() => neighbors(all, shown, story), [all, shown, story]);
  const hrefOf = (target: SnapshotRow | null) => (target === null ? null : storyPath(view.run.id, target.story, search));
  const { previous, next, list: listHref, position } = navigation ?? {
    previous: hrefOf(previousRow),
    next: hrefOf(nextRow),
    list: runPath(view.run.id, search),
    position: positionWords(shown.findIndex((candidate) => candidate.story === story), shown.length),
  };

  const [helpOpen, setHelpOpen] = useState(false);
  const [message, setMessage] = useState("");
  // Here, so that it stays as it is from story to story, like how someone's looking at the images.
  const ownLiveOpen = useState(false);
  const [liveOpen, setLiveOpen] = liveStories ?? ownLiveOpen;

  const go = useCallback((href: string | null) => {
    if (href !== null) navigate(href, { replace: true });
  }, []);

  // Its review's stats, if they're still on disk, and otherwise computed from the store.
  const compared = row === null ? null : comparedImage(row, newestNotedImage(feedback.view?.notes ?? [], story));
  const comparedWithNote = compared?.layer === "noted";
  const changedPair = row !== null && row.imageHash !== null && compared !== null && (row.state === "changed" || comparedWithNote);
  const { data: fetched, error: diffError } = useFetched(changedPair && row.pixelDiff === null ? `${row.imageHash}/${compared.hash}` : null, (signal) =>
    fetchDiff(row!.imageHash!, compared!.hash, signal),
  );
  const diff = row?.pixelDiff ?? fetched;
  const mergeDistance = view.regionMergeDistance * view.run.scale;
  const groups = useMemo(() => (diff === null ? [] : groupRegions(diff.regions, mergeDistance)), [diff, mergeDistance]);
  const selection = useRegionSelection(story);

  // The next story's images are likely wanted within seconds, so have them ready. Across many runs,
  // what comes next isn't in this one, so it just loads when it's asked for.
  const preloading = navigation === undefined ? nextRow : null;
  useEffect(() => {
    if (preloading === null) return;
    const urls = [
      preloading.imageHash === null ? null : imageUrl(preloading.imageHash),
      preloading.goldenHash === null ? null : imageUrl(preloading.goldenHash),
      preloading.state === "changed" && preloading.imageHash !== null && preloading.goldenHash !== null ? diffImageUrl(preloading.imageHash, preloading.goldenHash) : null,
    ];
    for (const url of urls) {
      if (url !== null) new Image().src = url;
    }
  }, [preloading]);

  const decide = async (decision: DecisionKind) => {
    if (row === null || state.busy) return;
    if (!isDecidable(row.state)) {
      setMessage(row.state === "unchanged" ? "An unchanged image needs no decision." : "This story has no image to decide on.");
      return;
    }
    const recorded = await state.decide(decision, targetsOf([row]));
    if (!recorded) return;
    const word = decision === "approved" ? "Approved" : "Rejected";
    setMessage(next === null ? `${word} ${row.story}. That's the last one here.` : `${word} ${row.story}.`);
    go(next);
  };

  useTitle(story);
  useHotkeys({
    j: () => go(next),
    k: () => go(previous),
    a: () => void decide("approved"),
    r: () => void decide("rejected"),
    u: () => navigate(listHref),
    l: () => setLiveOpen(!liveOpen),
    "?": () => setHelpOpen(true),
  });

  if (row === null) {
    if (unchanged === null) return state.actionError !== null ? <LoadFailure error={state.actionError} /> : <Loading label="Finding this story" />;
    return <Banner variant="warning" title="This run has no such story" description={<AppLink href={listHref}>Back to the run</AppLink>} />;
  }

  const decidable = isDecidable(row.state);
  const finished = view.counts.undecided === 0 && next === null && filter.show === "undecided";

  return (
    <Stack gap="condensed">
      <Stack direction="horizontal" align="center" justify="space-between" wrap="wrap" gap="condensed">
        <Stack direction="horizontal" align="center" gap="normal">
          {navigation === undefined && (
            <AppLink href={listHref}>
              <ArrowLeftIcon /> Back to the list <Keys keys="u" />
            </AppLink>
          )}
          <AriaStatus className="selfie-muted">{message}</AriaStatus>
        </Stack>
        <Stack direction="horizontal" align="center" gap="condensed">
          <StoryPager previous={previous} next={next} position={position} />
          <Button variant="invisible" onClick={() => setHelpOpen(true)} trailingVisual={() => <Keys keys="?" />}>
            Shortcuts
          </Button>
        </Stack>
      </Stack>

      <Stack direction="horizontal" align="center" justify="space-between" wrap="wrap" gap="condensed">
        <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
          <Heading as="h2" variant="small" className="selfie-story-title">
            {row.story}
          </Heading>
          <StorybookLinkTo row={row} view={view} />
        </Stack>
        {decidable && (
          <Stack direction="horizontal" gap="condensed">
            <Button variant="primary" leadingVisual={CheckIcon} disabled={state.busy} onClick={() => void decide("approved")} trailingVisual={() => <Keys keys="a" onPrimary />}>
              Approve
            </Button>
            <Button variant="danger" leadingVisual={XIcon} disabled={state.busy} onClick={() => void decide("rejected")} trailingVisual={() => <Keys keys="r" />}>
              Reject
            </Button>
          </Stack>
        )}
      </Stack>

      <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
        <StateLabel state={row.state} />
        <DecisionLabel row={row} />
        <AdvisoryLabels row={row} />
        {decidable && row.decision !== null && (
          <Text className="selfie-muted">
            by {row.decision.actor}, <RelativeTime date={new Date(row.decision.at)} />.
          </Text>
        )}
        {diff !== null && <PixelStats stats={diff} />}
        {changedPair && diff === null && diffError === null && <Text className="selfie-muted">Comparing pixels…</Text>}
        {diffError !== null && <Text className="selfie-muted">The pixels couldn't be compared: {diffError.message}</Text>}
      </Stack>

      <ActionFailure state={state} />
      {finished && (
        <Banner
          variant="success"
          title="Every image has a decision"
          description={
            <>
              <AppLink inline href={acceptPath(view.run.id)}>
                Go to accepting this run
              </AppLink>
              , or{" "}
              <AppLink inline href={listHref}>
                back to the list
              </AppLink>
              .
            </>
          }
        />
      )}
      {comparedWithNote ? (
        <Banner variant="info" title="Compared with the image when noted" description="This story has no golden, so what's shown is what's changed since its newest note. Approving lets this image become its first golden." />
      ) : (
        <Notes row={row} diff={diff} renamedFrom={renames.get(row.story)} renamedTo={[...renames].find(([, from]) => from === row.story)?.[0]} />
      )}
      <LiveStories row={row} view={view} open={liveOpen} onToggle={() => setLiveOpen(!liveOpen)} />
      <ImageCompare row={row} diff={diff} scale={view.run.scale} groups={groups} selection={selection} runId={view.run.id} feedback={feedback} startNote={startNote} />
      {helpOpen && <ShortcutsDialog onClose={() => setHelpOpen(false)} />}
    </Stack>
  );
}
