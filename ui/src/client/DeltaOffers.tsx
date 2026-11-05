// The changes that repeat across stories, to accept once instead of looking at each.
import { Button, Details, Heading, ProgressBar, Stack, Text, useDetails } from "@primer/react";
import { ScrollableRegion } from "@primer/react/experimental";
import { useState, type ReactNode } from "react";
import type { RenderRow } from "../shared/api.ts";
import type { Delta, DeltaExample, DeltaSide } from "../shared/deltas.ts";
import { describeBox, isEmptyBox } from "../shared/hunks.ts";
import { plural } from "../shared/plural.ts";
import { imageUrl } from "./api.ts";
import { BulkDialog } from "./BulkDialog.tsx";
import type { DeltaState } from "./deltas.ts";
import { showQuery, targetsOf } from "./filter.ts";
import type { BatchState } from "./hooks.ts";
import { Pane, placed, share } from "./ImageCompare.tsx";
import { AppLink, navigate, storyPath } from "./router.tsx";
import { stepped } from "./selection.ts";
import { KindLabel, sizeChangeWords } from "./words.tsx";

/** How much around a change to show, since a few pixels mean nothing by themselves. */
const CONTEXT = 12;
const MAX_WIDTH = 880;
const MAX_HEIGHT = 96;
/** As close as is any use, and past this a crop of a few pixels would be blocks. */
const MAX_SCALE = 4;

/** Where a crop looks: the first place, since a delta's pixels are the same in all of them. */
const firstBox = ({ boxes }: DeltaSide) => boxes[0]!;

function regionOf(side: DeltaSide) {
  const { image } = side;
  const box = firstBox(side);
  const x = Math.max(box.x - CONTEXT, 0);
  const y = Math.max(box.y - CONTEXT, 0);
  return { x, y, width: Math.min(box.x + box.width + CONTEXT, image.width) - x, height: Math.min(box.y + box.height + CONTEXT, image.height) - y };
}

/** One scale for both sides, so they compare. A whole number when enlarging, so pixels stay even. */
function scaleOf({ golden, current }: DeltaExample): number {
  const sides = [golden, current].map(regionOf);
  const fit = Math.min(MAX_WIDTH / Math.max(...sides.map(({ width }) => width)), MAX_HEIGHT / Math.max(...sides.map(({ height }) => height)), MAX_SCALE);
  return fit < 1 ? fit : Math.floor(fit);
}

/** As shares of what's shown, so a crop too wide for the page can narrow with it. */
function Crop({ label, side, scale }: { label: string; side: DeltaSide; scale: number }) {
  const { image, hash } = side;
  const box = firstBox(side);
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
          <div className="selfie-delta-box" style={placed({ ...box, x: box.x - region.x, y: box.y - region.y }, region)} />
        </div>
      )}
    </figure>
  );
}

function DeltaCrops({ example }: { example: DeltaExample }) {
  const scale = scaleOf(example);
  return (
    <div className="selfie-delta-crops">
      <Crop label="Before" side={example.golden} scale={scale} />
      <Crop label="After" side={example.current} scale={scale} />
    </div>
  );
}

/** Through the stories a delta would touch, as they really look, before saying yes to all of them. */
function DeltaExamples({ delta, batchId }: { delta: Delta; batchId: string }) {
  const { examples, kind } = delta;
  const [wanted, setWanted] = useState<string | null>(null);
  // Deciding on an image takes it out of here, so this may not find it any more.
  const at = Math.max(examples.findIndex(({ story }) => story === wanted), 0);
  const example = examples[at]!;
  const href = storyPath(batchId, example.story, showQuery("changed"));
  const step = (by: 1 | -1) => setWanted(examples[stepped(at, examples.length, by)!]!.story);

  return (
    <Stack gap="condensed">
      <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap" role="group" aria-label="The snapshots this delta is in">
        <Button size="small" onClick={() => step(-1)}>
          Previous
        </Button>
        <Button size="small" onClick={() => step(1)}>
          Next
        </Button>
        <Text className="selfie-muted selfie-small">
          {at + 1} of {examples.length}
        </Text>
        <AppLink href={href}>{example.story}</AppLink>
      </Stack>
      <DeltaCrops example={example} />
      <div className="selfie-delta-whole">
        {(
          [
            ["Before", example.golden],
            ["After", example.current],
          ] as const
        ).map(([label, side]) => (
          <Pane key={`${label}-${side.hash}`} words={label} src={imageUrl(side.hash)} story={example.story} captioned openLabel={`Open ${example.story}`} onOpen={() => navigate(href)}>
            <div className="selfie-outlines" aria-hidden="true">
              {side.boxes.map((box) => (
                <div key={`${box.x},${box.y}`} className="selfie-hunk" data-kind={kind} style={placed(box, side.image)} />
              ))}
            </div>
          </Pane>
        ))}
      </div>
    </Stack>
  );
}

/** A delta that isn't the one open, with a way to open it. */
function ClosedDelta({ delta, onOpen }: { delta: Delta; onOpen: () => void }) {
  return (
    <Stack gap="condensed">
      <DeltaCrops example={delta.examples[0]!} />
      <div>
        <Button size="small" onClick={onOpen}>
          Look through {plural(delta.examples.length, "snapshot")}
        </Button>
      </div>
    </Stack>
  );
}

/** A delta, and what can be done with it. */
function DeltaRow({ delta, children, more }: { delta: Delta; children: ReactNode; more: ReactNode }) {
  const { golden, current } = delta.examples[0]!;
  return (
    <li>
      <Stack gap="condensed">
        <Stack direction="horizontal" align="start" justify="space-between" wrap="wrap" gap="condensed">
          <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
            <Text weight="semibold">{plural(delta.examples.length, "snapshot")}</Text>
            <KindLabel kind={delta.kind} />
            <Text className="selfie-muted selfie-small">{sizeChangeWords(firstBox(golden), firstBox(current))}</Text>
          </Stack>
          {children}
        </Stack>
        {more}
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
          <DeltaRow key={delta.key} delta={delta} more={<DeltaCrops example={delta.examples[0]!} />}>
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
  const [openKey, setOpenKey] = useState<string | null>(null);
  const { progress, offers, taken } = deltas;
  // One's always open, so accepting one moves on to the next to look at.
  const open = offers.find(({ key }) => key === openKey) ?? offers[0];

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
                <DeltaRow key={delta.key} delta={delta} more={delta === open ? <DeltaExamples delta={delta} batchId={batchId} /> : <ClosedDelta delta={delta} onOpen={() => setOpenKey(delta.key)} />}>
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
              {pending.delta.examples.length > pending.rows.length && ` The other ${plural(pending.delta.examples.length - pending.rows.length, "snapshot")} will just show less.`}
            </>
          }
          onClose={(confirmed) => void confirm(confirmed)}
        />
      )}
    </Stack>
  );
}
