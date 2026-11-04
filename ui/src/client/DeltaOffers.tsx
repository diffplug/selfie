// The changes that repeat across stories, to accept once instead of looking at each.
import { Button, Details, Heading, ProgressBar, Stack, Text, useDetails } from "@primer/react";
import { ScrollableRegion } from "@primer/react/experimental";
import { useState, type ReactNode } from "react";
import type { RenderRow } from "../shared/api.ts";
import type { Delta, DeltaSide } from "../shared/deltas.ts";
import { describeBox, isEmptyBox } from "../shared/hunks.ts";
import { plural } from "../shared/plural.ts";
import { imageUrl } from "./api.ts";
import { BulkDialog } from "./BulkDialog.tsx";
import type { DeltaState } from "./deltas.ts";
import { targetsOf } from "./filter.ts";
import type { BatchState } from "./hooks.ts";
import { StoryLinks } from "./StoryLinks.tsx";
import { KindLabel, sizeChangeWords } from "./words.tsx";

/** How much around a change to show, since a few pixels mean nothing by themselves. */
const CONTEXT = 12;
const MAX_WIDTH = 880;
const MAX_HEIGHT = 96;
/** As close as is any use, and past this a crop of a few pixels would be blocks. */
const MAX_SCALE = 4;

function regionOf({ box, image }: DeltaSide) {
  const x = Math.max(box.x - CONTEXT, 0);
  const y = Math.max(box.y - CONTEXT, 0);
  return { x, y, width: Math.min(box.x + box.width + CONTEXT, image.width) - x, height: Math.min(box.y + box.height + CONTEXT, image.height) - y };
}

/** One scale for both sides, so they compare. A whole number when enlarging, so pixels stay even. */
function scaleOf({ golden, current }: Pick<Delta, "golden" | "current">): number {
  const sides = [golden, current].map(regionOf);
  const fit = Math.min(MAX_WIDTH / Math.max(...sides.map(({ width }) => width)), MAX_HEIGHT / Math.max(...sides.map(({ height }) => height)), MAX_SCALE);
  return fit < 1 ? fit : Math.floor(fit);
}

const share = (part: number, whole: number) => `${(part / whole) * 100}%`;

/** As shares of what's shown, so a crop too wide for the page can narrow with it. */
function Crop({ label, side, scale }: { label: string; side: DeltaSide; scale: number }) {
  const { box, image, hash } = side;
  const region = regionOf(side);
  return (
    <figure className="selfie-delta-crop">
      <figcaption className="selfie-muted selfie-small">{label}</figcaption>
      {isEmptyBox(box) ? (
        <Text className="selfie-muted selfie-small">Nothing</Text>
      ) : (
        <div className="selfie-delta-window" style={{ width: region.width * scale, aspectRatio: `${region.width} / ${region.height}` }}>
          <img
            src={imageUrl(hash)}
            alt={`${label}, ${describeBox(box)}`}
            loading="lazy"
            decoding="async"
            style={{
              left: share(-region.x, region.width),
              top: share(-region.y, region.height),
              width: share(image.width, region.width),
              height: share(image.height, region.height),
              imageRendering: scale > 1 ? "pixelated" : "auto",
            }}
          />
          <div className="selfie-delta-box" style={{ left: share(box.x - region.x, region.width), top: share(box.y - region.y, region.height), width: share(box.width, region.width), height: share(box.height, region.height) }} />
        </div>
      )}
    </figure>
  );
}

function DeltaCrops({ delta }: { delta: Delta }) {
  const scale = scaleOf(delta);
  return (
    <div className="selfie-delta-crops">
      <Crop label="Before" side={delta.golden} scale={scale} />
      <Crop label="After" side={delta.current} scale={scale} />
    </div>
  );
}

function WhichStories({ delta, batchId }: { delta: Delta; batchId: string }) {
  const { getDetailsProps } = useDetails({ closeOnOutsideClick: false });
  return (
    <Details {...getDetailsProps()} className="selfie-details">
      <summary>Show which</summary>
      <StoryLinks batchId={batchId} show="changed" stories={delta.stories.map((story) => ({ story }))} />
    </Details>
  );
}

/** A delta, what to say about it, and what can be done with it. */
function DeltaRow({ delta, extra, children }: { delta: Delta; extra?: ReactNode; children: ReactNode }) {
  return (
    <li>
      <Stack gap="condensed">
        <Stack direction="horizontal" align="start" justify="space-between" wrap="wrap" gap="condensed">
          <Stack gap="none" align="start">
            <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
              <Text weight="semibold">{plural(delta.stories.length, "snapshot")}</Text>
              <KindLabel kind={delta.kind} />
              <Text className="selfie-muted selfie-small">{sizeChangeWords(delta.golden.box, delta.current.box)}</Text>
            </Stack>
            {extra}
          </Stack>
          {children}
        </Stack>
        <DeltaCrops delta={delta} />
      </Stack>
    </li>
  );
}

function AcceptedDeltas({ deltas }: { deltas: DeltaState }) {
  const { getDetailsProps } = useDetails({ closeOnOutsideClick: false });
  return (
    <Details {...getDetailsProps()} className="selfie-details">
      <summary>{plural(deltas.taken.length, "delta")} accepted in this browser</summary>
      <Text as="p" className="selfie-muted selfie-small">
        Undoing one brings its hunks back. Any approval it led to stays, and rejecting that image is how to take one back.
      </Text>
      <ul className="selfie-attention">
        {deltas.taken.map((delta) => (
          <DeltaRow key={delta.key} delta={delta}>
            <Button size="small" onClick={() => deltas.undo(delta)}>
              Undo
            </Button>
          </DeltaRow>
        ))}
      </ul>
    </Details>
  );
}

export function DeltaOffers({ deltas, state, batchId }: { deltas: DeltaState; state: BatchState; batchId: string }) {
  const [pending, setPending] = useState<{ readonly delta: Delta; readonly rows: readonly RenderRow[] } | null>(null);
  const { progress, offers, taken } = deltas;

  if (progress !== null) {
    return (
      <Stack gap="condensed" role="status">
        <Text className="selfie-muted">Looking for changes that repeat across stories.</Text>
        <ProgressBar progress={progress} aria-label="Looking for changes that repeat across stories" />
      </Stack>
    );
  }
  if (offers.length === 0 && taken.length === 0) return null;

  const pick = (delta: Delta) => {
    const rows = deltas.finishes(delta);
    if (rows.length === 0) deltas.accept(delta);
    else setPending({ delta, rows });
  };

  const confirm = async (confirmed: boolean) => {
    const chosen = pending;
    setPending(null);
    if (!confirmed || chosen === null) return;
    deltas.accept(chosen.delta);
    await state.decide("approved", targetsOf(chosen.rows));
  };

  return (
    <Stack as="section" aria-labelledby="deltas-heading" gap="condensed">
      <Heading as="h3" id="deltas-heading" variant="small">
        Repeated changes
      </Heading>
      {offers.length > 0 && (
        <>
          <Text as="p" className="selfie-muted">
            These are the same pixels, changed the same way, in several stories. Accepting one draws it onto each golden in this browser, so what's left is less to look at, and approves any image with nothing left.
          </Text>
          <ScrollableRegion className="selfie-deltas" aria-label="Changes that repeat across stories">
            <ul className="selfie-attention">
              {offers.map((delta) => (
                <DeltaRow key={delta.key} delta={delta} extra={<WhichStories delta={delta} batchId={batchId} />}>
                  <Button disabled={state.busy} onClick={() => pick(delta)}>
                    Accept this delta to all affected snapshots
                  </Button>
                </DeltaRow>
              ))}
            </ul>
          </ScrollableRegion>
        </>
      )}
      {taken.length > 0 && <AcceptedDeltas deltas={deltas} />}
      {pending !== null && (
        <BulkDialog
          decision="approved"
          rows={pending.rows}
          why={
            <>
              Accepting this delta leaves nothing different in these images, which approves them.
              {pending.delta.stories.length > pending.rows.length && ` The other ${plural(pending.delta.stories.length - pending.rows.length, "snapshot")} will just show less.`}
            </>
          }
          onClose={(confirmed) => void confirm(confirmed)}
        />
      )}
    </Stack>
  );
}
