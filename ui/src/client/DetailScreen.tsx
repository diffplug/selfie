// One snapshot: its images, its numbers, and its decision, with the keyboard doing most of the work.
import { ArrowLeftIcon, CheckIcon, LinkExternalIcon, XIcon } from "@primer/octicons-react";
import { Banner, Button, Dialog, Heading, Link, RelativeTime, Stack, Text } from "@primer/react";
import { AriaStatus } from "@primer/react/experimental";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isDecidable } from "selfie-store";
import type { DecisionKind, PixelDiff, RunView, SnapshotRow, StorybookLink } from "../shared/api.ts";
import { diffImageUrl, fetchDiff, imageUrl } from "./api.ts";
import { applyFilter, neighbors, parseFilter, targetsOf } from "./filter.ts";
import { useFetched, useHotkeys, useRegionSelection, useTitle, type FeedbackState, type RunState } from "./hooks.ts";
import { ImageCompare } from "./ImageCompare.tsx";
import { Keys } from "./Keys.tsx";
import { acceptPath, AppLink, navigate, runPath, storyPath } from "./router.tsx";
import { ActionFailure } from "./RunNotes.tsx";
import { LoadFailure, Loading } from "./Status.tsx";
import { describeBox, groupRegions, isLayoutOnly } from "../shared/regions.ts";
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
  ["m", "Write a note for your agent"],
  ["w", "Show the image a note was written on"],
  ["n", "Next region"],
  ["p", "Previous region"],
  ["x", "Select the region being looked at, or the first"],
  ["u", "Back to the list"],
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

/** The real page, on the Storybook's own origin, saying if it may not be what rendered this image. */
function StorybookLinkTo({ storybook, story }: { storybook: StorybookLink; story: string }) {
  return (
    <>
      <Link href={`${storybook.url}?path=/story/${encodeURIComponent(story)}`} target="_blank" rel="noreferrer noopener">
        Open in Storybook <LinkExternalIcon />
      </Link>
      {!storybook.exactBuild && <Text className="selfie-muted">This run&apos;s own build wasn&apos;t kept, so it&apos;s the latest, which may not match.</Text>}
    </>
  );
}

function Notes({ row, diff }: { row: SnapshotRow; diff: PixelDiff | null }) {
  return (
    <>
      {row.state === "failed" && (
        <Banner variant="critical" title="This story failed to render" description={<code className="selfie-pre">{row.failure ?? "No message was recorded."}</code>} />
      )}
      {row.state === "new" && (
        <Banner variant="info" title="New story" description="The baseline has no golden for it, so there's nothing to compare. Approving lets this image become its first golden." />
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

export function DetailScreen({ state, view, story, search, feedback }: { state: RunState; view: RunView; story: string; search: string; feedback: FeedbackState }) {
  const { unchanged, loadUnchanged } = state;
  const filter = useMemo(() => parseFilter(search), [search]);
  const inRows = view.rows.find((candidate) => candidate.story === story);
  const needsUnchanged = (filter.show === "unchanged" || inRows === undefined) && unchanged === null;
  useEffect(() => {
    if (needsUnchanged) loadUnchanged();
  }, [needsUnchanged, loadUnchanged]);

  const all = filter.show === "unchanged" ? (unchanged ?? []) : view.rows;
  const shown = useMemo(() => applyFilter(all, filter), [all, filter]);
  const row = inRows ?? unchanged?.find((candidate) => candidate.story === story) ?? null;
  const { previous, next } = useMemo(() => neighbors(all, shown, story), [all, shown, story]);
  const position = shown.findIndex((candidate) => candidate.story === story);

  const [helpOpen, setHelpOpen] = useState(false);
  const [message, setMessage] = useState("");

  const go = useCallback(
    (target: SnapshotRow | null) => {
      if (target !== null) navigate(storyPath(view.run.id, target.story, search), { replace: true });
    },
    [view.run.id, search],
  );
  const listHref = runPath(view.run.id, search);

  // Its review's stats, if they're still on disk, and otherwise computed from the store.
  const changedPair = row?.state === "changed" && row.imageHash !== null && row.goldenHash !== null;
  const { data: fetched, error: diffError } = useFetched(changedPair && row.pixelDiff === null ? `${row.imageHash}/${row.goldenHash}` : null, (signal) =>
    fetchDiff(row!.imageHash!, row!.goldenHash!, signal),
  );
  const diff = row?.pixelDiff ?? fetched;
  const mergeDistance = view.regionMergeDistance * view.run.scale;
  const groups = useMemo(() => (diff === null ? [] : groupRegions(diff.regions, mergeDistance)), [diff, mergeDistance]);
  const selection = useRegionSelection(story);

  // The next story's images are likely wanted within seconds, so have them ready.
  useEffect(() => {
    if (next === null) return;
    const urls = [
      next.imageHash === null ? null : imageUrl(next.imageHash),
      next.goldenHash === null ? null : imageUrl(next.goldenHash),
      next.state === "changed" && next.imageHash !== null && next.goldenHash !== null ? diffImageUrl(next.imageHash, next.goldenHash) : null,
    ];
    for (const url of urls) {
      if (url !== null) new Image().src = url;
    }
  }, [next]);

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
          <AppLink href={listHref}>
            <ArrowLeftIcon /> Back to the list <Keys keys="u" />
          </AppLink>
          <AriaStatus className="selfie-muted">{message}</AriaStatus>
        </Stack>
        <Stack direction="horizontal" align="center" gap="condensed">
          <Text className="selfie-muted">{position === -1 ? `Not in this filter, which shows ${plural(shown.length, "other")}` : `${position + 1} of ${shown.length}`}</Text>
          <Button onClick={() => go(previous)} disabled={previous === null} trailingVisual={() => <Keys keys="k" />}>
            Previous
          </Button>
          <Button onClick={() => go(next)} disabled={next === null} trailingVisual={() => <Keys keys="j" />}>
            Next
          </Button>
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
          {view.storybook !== null && row.state !== "removed" && <StorybookLinkTo storybook={view.storybook} story={row.story} />}
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
      <Notes row={row} diff={diff} />
      <ImageCompare row={row} diff={diff} scale={view.run.scale} groups={groups} selection={selection} runId={view.run.id} feedback={feedback} />
      {helpOpen && <ShortcutsDialog onClose={() => setHelpOpen(false)} />}
    </Stack>
  );
}
