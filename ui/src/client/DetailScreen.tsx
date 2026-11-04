// One render: its images, its numbers, and its decision, with the keyboard doing most of the work.
import { CheckIcon, XIcon } from "@primer/octicons-react";
import { Banner, Button, Dialog, Heading, RelativeTime, Stack, Text } from "@primer/react";
import { AriaStatus } from "@primer/react/experimental";
import { useCallback, useEffect, useMemo, useState } from "react";
import { findRenames } from "../shared/renames.ts";
import { isDecidable } from "selfie-store";
import type { DecisionKind, PixelDiff, BatchView, RenderRow } from "../shared/api.ts";
import { diffImageUrl, fetchDiff, imageUrl } from "./api.ts";
import { parseFilter, targetsOf, type StoryNavigation } from "./filter.ts";
import { useFetched, useHotkeys, useHunkSelection, useTitle, type FeedbackState, type BatchState } from "./hooks.ts";
import { ImageCompare } from "./ImageCompare.tsx";
import { Keys } from "./Keys.tsx";
import { AppLink, navigate } from "./router.tsx";
import { ActionFailure } from "./ActionFailure.tsx";
import { LiveStories, StorybookLinkTo } from "./LiveStories.tsx";
import { LoadFailure, Loading } from "./Status.tsx";
import { describeBox, groupHunks, isLayoutOnly } from "../shared/hunks.ts";
import { comparedImage, newestNotedImage } from "../shared/notes.ts";
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
  ["c", "Center on the hunk being looked at, or else the change"],
  ["l", "Open or close the live stories"],
  ["m", "Write a note for your agent"],
  ["w", "Show the image a note was written on"],
  ["n", "Next hunk"],
  ["p", "Previous hunk"],
  ["x", "Select the hunk being looked at, or the first"],
  ["u", "Up to the batch, or to where this commit stands"],
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

function Notes({ row, diff, renamedFrom, renamedTo }: { row: RenderRow; diff: PixelDiff | null; renamedFrom?: string | undefined; renamedTo?: string | undefined }) {
  return (
    <>
      {row.state === "failed" && (
        <Banner variant="critical" title="This story failed to render" description={<code className="selfie-pre">{row.failure ?? "No message was recorded."}</code>} />
      )}
      {row.state === "added" &&
        (renamedFrom !== undefined ? (
          <Banner
            variant="info"
            title="Renamed story"
            description={
              <>
                This image is the very one approved for <code>{renamedFrom}</code>, and this batch doesn't have that story. Approving this and the removal of that story moves the approval to its new name.
              </>
            }
          />
        ) : (
          <Banner variant="info" title="Added story" description="Nothing has been approved for this story yet, so there's nothing to compare. Approving makes this image what later batches compare with." />
        ))}
      {row.state === "removed" && renamedTo !== undefined && (
        <Banner variant="info" title="Renamed story" description={<>The new story <code>{renamedTo}</code> has this very image, so it looks to have been renamed.</>} />
      )}
      {row.state === "removed" && (
        <Banner variant="warning" title="Removed story" description="This story was approved, and this batch doesn't have it. Approving says it's meant to be gone, so later batches stop asking." />
      )}
      {row.state === "unchanged" && <Banner variant="info" title="Unchanged" description="This image is the same as what's approved." />}
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
}: {
  state: BatchState;
  view: BatchView;
  story: string;
  search: string;
  feedback: FeedbackState;
  navigation: StoryNavigation;
  /** Whether the live stories are open, if it's kept above this screen, which a new batch starts afresh. */
  liveStories?: readonly [boolean, (open: boolean) => void];
  /** Someone asked to write a note on this story, and it's just been rendered so they can. */
  startNote?: boolean;
}) {
  const { unchanged, loadUnchanged } = state;
  const filter = useMemo(() => parseFilter(search), [search]);
  const renames = useMemo(() => findRenames(view.rows), [view.rows]);
  const inRows = view.rows.find((candidate) => candidate.story === story);
  const needsUnchanged = (filter.show === "unchanged" || inRows === undefined) && unchanged === null;
  useEffect(() => {
    if (needsUnchanged) loadUnchanged();
  }, [needsUnchanged, loadUnchanged]);

  const row = inRows ?? unchanged?.find((candidate) => candidate.story === story) ?? null;
  const { previous, next, nextStory, list: listHref, position } = navigation;

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
  const mergeDistance = view.hunkMergeDistance * view.batch.scale;
  const groups = useMemo(() => (diff === null ? [] : groupHunks(diff.hunks, mergeDistance)), [diff, mergeDistance]);
  const selection = useHunkSelection(story);

  // The next story's images are likely wanted within seconds, so have them ready. Across many batches,
  // what comes next may not be in this one, and then it just loads when it's asked for.
  const preloading = useMemo(() => view.rows.find((candidate) => candidate.story === nextStory) ?? null, [view.rows, nextStory]);
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
      setMessage(row.state === "unchanged" ? "An unchanged image needs no decision." : "This story failed to render, so it has no image to decide on.");
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
    return <Banner variant="warning" title="This batch has no such story" description={<AppLink href={listHref}>Back to the batch</AppLink>} />;
  }

  const decidable = isDecidable(row.state);
  const finished = view.counts.undecided === 0 && next === null && filter.show === "undecided";

  return (
    <Stack gap="condensed">
      <Stack direction="horizontal" align="center" justify="space-between" wrap="wrap" gap="condensed">
        <Stack direction="horizontal" align="center" gap="normal">
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
              <AppLink inline href={listHref}>
                Back to the list
              </AppLink>
              .
            </>
          }
        />
      )}
      {comparedWithNote ? (
        <Banner variant="info" title="Compared with the image when noted" description="Nothing has been approved for this story yet, so what's shown is what's changed since its newest note. Approving makes this image what later batches compare with." />
      ) : (
        <Notes row={row} diff={diff} renamedFrom={renames.get(row.story)} renamedTo={[...renames].find(([, from]) => from === row.story)?.[0]} />
      )}
      <LiveStories row={row} view={view} open={liveOpen} onToggle={() => setLiveOpen(!liveOpen)} />
      <ImageCompare row={row} diff={diff} scale={view.batch.scale} groups={groups} selection={selection} batchId={view.batch.id} feedback={feedback} startNote={startNote} />
      {helpOpen && <ShortcutsDialog onClose={() => setHelpOpen(false)} />}
    </Stack>
  );
}
