// Seeing the change. Side by side gives the shape of it, and flip gives one pixel at a time:
// all three layers stay stacked and loaded, so switching costs no scroll and no flash. How someone
// is looking stays the same from story to story, since this stays mounted across them.
import { Button, SegmentedControl, Stack, Text } from "@primer/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactEventHandler, type ReactNode } from "react";
import type { BoundingBox, Note, PixelDiff, RenderRow } from "../shared/api.ts";
import { comparedImage, isOpenNote, newestNotedImage } from "../shared/notes.ts";
import { hull, type HunkGroup } from "../shared/hunks.ts";
import { diffImageUrl, imageUrl } from "./api.ts";
import { useDevicePixelRatio, useHotkeys, type FeedbackState, type HunkSelection } from "./hooks.ts";
import { Keys } from "./Keys.tsx";
import { NotesPanel } from "./NotesPanel.tsx";
import { plural } from "../shared/plural.ts";
import { HunkList } from "./HunkList.tsx";
import { stepped } from "./selection.ts";
import { useDrawnBox } from "./useDrawnBox.ts";

/** `"size"` is the size the page really was. A number is how many device pixels show one image pixel. */
const ZOOMS = ["size", 1, 2, 4, 8] as const;
type Zoom = (typeof ZOOMS)[number];
const zoomWords = (zoom: Zoom) => (zoom === "size" ? "Actual size" : `${zoom}×`);
type Layer = "current" | "golden" | "diff" | "noted";

export const LAYER_WORDS: Readonly<Record<Layer, string>> = { current: "Current", golden: "Golden", diff: "Diff", noted: "When noted" };

/** How each image is spoken of when a note is on it. */
const LAYER_IMAGE_WORDS: Readonly<Record<Layer, string>> = { current: "the current image", golden: "the golden", diff: "the current image", noted: "the image when noted" };

interface Source {
  readonly name: Layer;
  readonly src: string;
  /** The image a note written on this layer is about. */
  readonly hash: string | null;
}

function sourcesOf({ imageHash, goldenHash }: RenderRow, hasDiffImage: boolean, noted: string | null, compared: string | null): readonly Source[] {
  const sources: Source[] = [];
  if (noted !== null && noted !== imageHash && noted !== goldenHash) sources.push({ name: "noted", src: imageUrl(noted), hash: noted });
  if (goldenHash !== null) sources.push({ name: "golden", src: imageUrl(goldenHash), hash: goldenHash });
  if (imageHash !== null) sources.push({ name: "current", src: imageUrl(imageHash), hash: imageHash });
  if (hasDiffImage && imageHash !== null && compared !== null) sources.push({ name: "diff", src: diffImageUrl(imageHash, compared), hash: imageHash });
  return sources;
}

/**
 * Where a hunk is in whichever image is showing, where the diff is drawn on the current one. A
 * hunk is between those two images, so on any other it isn't anywhere.
 */
const boxOn = ({ current, golden }: HunkGroup, layer: Layer): BoundingBox | null => (layer === "noted" ? null : layer === "golden" ? golden : current);

/** So a hunk too big to center doesn't sit right against the edge. */
const MARGIN = 16;

type Size = { readonly width: number; readonly height: number };

/** Over one image, as shares of its size, so at any zoom. The list says the same to assistive technology. */
function HunkOutlines({ groups, layer, size, selection }: { groups: readonly HunkGroup[]; layer: Layer; size: Size; selection: HunkSelection }) {
  const { selected, focused, toggle, setFocused } = selection;
  return (
    <div className="selfie-outlines" aria-hidden="true">
      {groups.map((group, index) => {
        const box = boxOn(group, layer);
        return (
          box !== null && <div
            key={index}
            className="selfie-hunk"
            data-hunk={index}
            data-kind={group.kind}
            data-selected={selected.has(index) || undefined}
            data-focused={focused === index || undefined}
            style={placed(box, size)}
            onClick={() => {
              toggle(index);
              setFocused(index);
            }}
          >
            <span className="selfie-hunk-number" data-kind={group.kind}>
              {index + 1}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const share = (part: number, whole: number) => `${(part / whole) * 100}%`;
const placed = ({ x, y, width, height }: BoundingBox, size: Size) => ({
  left: share(x, size.width),
  top: share(y, size.height),
  width: share(width, size.width),
  height: share(height, size.height),
});

/** What's being said about this image. They're never in the way of clicking or drawing on it. */
function NoteBoxes({ notes, drawn, size }: { notes: readonly Note[]; drawn: BoundingBox | null; size: Size }) {
  return (
    <div className="selfie-outlines" aria-hidden="true">
      {notes.map(
        ({ id, box }) =>
          box !== null && (
            <div key={id} className="selfie-note-box" style={placed(box, size)}>
              <span className="selfie-note-chip">Note {id}</span>
            </div>
          ),
      )}
      {drawn !== null && <div className="selfie-note-box" data-drawing style={placed(drawn, size)} />}
    </div>
  );
}

function Pane({ layer, src, story, onOpen, onLoad, children }: { layer: Layer; src: string; story: string; onOpen: () => void; onLoad: ReactEventHandler<HTMLImageElement>; children: ReactNode }) {
  return (
    <figure className="selfie-pane">
      <figcaption>{LAYER_WORDS[layer]}</figcaption>
      <div className="selfie-pane-image">
        <button type="button" className="selfie-pane-button" onClick={onOpen} aria-label={`Show the ${layer} image stacked`}>
          <img src={src} alt={`${LAYER_WORDS[layer]} image of ${story}`} loading="lazy" decoding="async" onLoad={onLoad} />
        </button>
        {children}
      </div>
    </figure>
  );
}

interface ImageCompareProps {
  readonly row: RenderRow;
  readonly diff: PixelDiff | null;
  readonly scale: number;
  readonly groups: readonly HunkGroup[];
  readonly selection: HunkSelection;
  readonly batchId: string;
  readonly feedback: FeedbackState;
  /** Puts someone in the note box from the start, having just asked to write one. */
  readonly startNote?: boolean;
}

export function ImageCompare({ row, diff, scale, groups, selection, batchId, feedback, startNote = false }: ImageCompareProps) {
  const { story, imageHash, goldenHash } = row;
  const allNotes = feedback.view?.notes ?? [];
  const storyNotes = allNotes.filter((note) => note.story === story);
  const openNotes = storyNotes.filter(isOpenNote);
  const notedImage = newestNotedImage(allNotes, story);
  const compared = comparedImage(row, notedImage);
  const sources = sourcesOf(row, diff !== null, notedImage, compared?.hash ?? null);
  const canFlip = compared !== null;
  // Hunks are between the current image and what it's compared with, whichever image that is.
  const hunkLayer = (on: Layer): Layer => (on === "noted" && compared?.layer === "noted" ? "golden" : on);
  const box = diff?.boundingBox ?? null;
  const firstChanged = diff?.firstChanged ?? null;

  const [mode, setMode] = useState<"side" | "flip">("side");
  const [wantedLayer, setLayer] = useState<Layer>("current");
  // The layer someone asked for, or, in a story without it, the one it has.
  const shown = sources.find(({ name }) => name === wantedLayer) ?? sources.find(({ name }) => name === "current") ?? sources[0];
  const layer = shown?.name ?? "current";
  const [zoom, setZoom] = useState<Zoom>("size");
  const deviceRatio = useDevicePixelRatio();
  const devicePixels = zoom === "size" ? deviceRatio / scale : zoom;
  // CSS pixels per image pixel, which everything drawn over or scrolled to is measured in.
  const cssPixels = devicePixels / deviceRatio;
  const [outlined, setOutlined] = useState(true);
  const { selected, focused, toggle, setSelected, setFocused } = selection;
  const writing = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (startNote) writing.current?.focus();
  }, [startNote]);
  const [sizes, setSizes] = useState<Readonly<Record<string, Size>>>({});
  const viewport = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLDivElement>(null);

  const rememberSize =
    (src: string): ReactEventHandler<HTMLImageElement> =>
    (event) => {
      const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
      setSizes((known) => (known[src] === undefined ? { ...known, [src]: { width, height } } : known));
    };

  const shownSize = shown === undefined ? undefined : sizes[shown.src];
  const { drawn, clear: clearDrawn, handlers: drawing } = useDrawnBox({ story, cssPixels, size: shownSize, onDrawn: () => writing.current?.focus() });
  // Every image, since flipping between different heights moves what scrolling can reach, so
  // otherwise where this lands depends on which one loaded first.
  const allSized = sources.every(({ src }) => sizes[src] !== undefined);

  const focusedGroup = focused === null ? null : (groups[focused] ?? null);

  const fits = ({ width, height }: BoundingBox) => {
    const element = viewport.current;
    return element !== null && width * cssPixels <= element.clientWidth && height * cssPixels <= element.clientHeight;
  };

  const goToBox = (target: BoundingBox) => {
    const { x, y, width, height } = target;
    const element = viewport.current;
    if (element === null) return;
    element.scrollTo(
      fits(target)
        ? { left: (x + width / 2) * cssPixels - element.clientWidth / 2, top: (y + height / 2) * cssPixels - element.clientHeight / 2 }
        : { left: x * cssPixels - MARGIN, top: y * cssPixels - MARGIN },
    );
  };

  const center = () => {
    if (box === null) return;
    // A box too big for the viewport may show nothing changed at its center, as when two distant
    // pixels changed, so go to a pixel that certainly did.
    const whole = fits(box) || firstChanged === null ? box : { ...firstChanged, width: 1, height: 1 };
    goToBox((focusedGroup === null ? null : boxOn(focusedGroup, hunkLayer(layer))) ?? whole);
  };

  // A small change is usually off-screen when zoomed, so go to it whenever the zoom changes, and as
  // soon as the image and the change are known. Never on just looking at another hunk or layer.
  useLayoutEffect(() => {
    if (mode === "flip" && allSized) center();
  }, [mode, allSized, cssPixels, box, firstChanged]);

  // A hunk can be somewhere else in the golden, so keep the one being looked at still when flipping,
  // which is what makes a flip show it changing and not the page jumping.
  const flippedFrom = useRef(layer);
  useLayoutEffect(() => {
    const from = flippedFrom.current;
    flippedFrom.current = layer;
    if (from === layer || focusedGroup === null) return;
    const [was, now] = [boxOn(focusedGroup, hunkLayer(from)), boxOn(focusedGroup, hunkLayer(layer))];
    if (was !== null && now !== null) viewport.current?.scrollBy((now.x - was.x) * cssPixels, (now.y - was.y) * cssPixels);
  }, [layer]);

  const goToHunk = (index: number | null) => {
    if (index === null) return;
    setFocused(index);
    const box = boxOn(groups[index]!, hunkLayer(layer));
    if (mode === "flip") {
      if (box !== null) goToBox(box);
    } else section.current?.querySelector(`[data-hunk="${index}"]`)?.scrollIntoView({ block: "center" });
  };

  const hashOn = (on: Layer) => sources.find(({ name }) => name === on)?.hash ?? null;

  const outlinesOn = (on: Layer, size: Size | undefined) =>
    size !== undefined && (
      <>
        {outlined && <HunkOutlines groups={groups} layer={hunkLayer(on)} size={size} selection={selection} />}
        <NoteBoxes notes={openNotes.filter(({ imageHash: noted }) => noted === hashOn(on))} drawn={mode === "flip" ? drawn : null} size={size} />
      </>
    );

  const selectedBoxes = [...selected].flatMap((index) => boxOn(groups[index]!, hunkLayer(layer)) ?? []);
  const noteBox = drawn ?? (selectedBoxes.length === 0 ? null : selectedBoxes.reduce(hull));
  const imageWords = hashOn(layer) === null ? "this story" : LAYER_IMAGE_WORDS[layer];
  const noteTarget = drawn !== null ? `on the box you drew on ${imageWords}` : selectedBoxes.length > 0 ? `on ${plural(selectedBoxes.length, "selected hunk")} of ${imageWords}` : `on all of ${imageWords}`;

  const addNote = async (text: string) => {
    const saved = await feedback.add({ story, batchId, imageHash: hashOn(layer), box: noteBox, text });
    if (saved) {
      clearDrawn();
      setSelected(new Set());
    }
    return saved;
  };

  const hasDiffLayer = sources.some(({ name }) => name === "diff");
  const hasNotedLayer = sources.some(({ name }) => name === "noted");

  useHotkeys({
    s: () => setMode("side"),
    f: () => {
      if (mode === "side") setMode("flip");
      else if (compared !== null) setLayer(layer === "current" ? compared.layer : "current");
    },
    d: () => {
      if (!hasDiffLayer) return;
      setMode("flip");
      setLayer("diff");
    },
    z: () => {
      setMode("flip");
      setZoom((value) => ZOOMS[(ZOOMS.indexOf(value) + 1) % ZOOMS.length]!);
    },
    c: center,
    m: () => writing.current?.focus(),
    w: () => {
      if (!hasNotedLayer) return;
      setMode("flip");
      setLayer(layer === "noted" ? "current" : "noted");
    },
    n: () => goToHunk(stepped(focused, groups.length, 1)),
    p: () => goToHunk(stepped(focused, groups.length, -1)),
    x: () => {
      if (groups.length === 0) return;
      toggle(focused ?? 0);
      if (focused === null) goToHunk(0);
    },
  });

  if (sources.length === 0) {
    return (
      <Text as="p" className="selfie-muted">
        There's no image to show.
      </Text>
    );
  }

  return (
    <Stack as="section" aria-label="Images" gap="condensed" ref={section}>
      {groups.length > 0 && <HunkList groups={groups} selection={selection} onGo={goToHunk} outlined={outlined} onOutlined={setOutlined} />}
      <NotesPanel
        notes={storyNotes}
        batchId={batchId}
        currentImage={imageHash}
        target={noteTarget}
        onAdd={addNote}
        onRemove={(id) => void feedback.remove(id)}
        onAnswer={(id, text) => feedback.answer(id, text, batchId)}
        onResolve={(id) => void feedback.resolve(id)}
        writing={writing}
      />
      <Stack direction="horizontal" wrap="wrap" align="end" gap="normal">
        <SegmentedControl aria-label="How to compare the images" onChange={(index) => setMode(index === 0 ? "side" : "flip")}>
          <SegmentedControl.Button selected={mode === "side"}>Side by side</SegmentedControl.Button>
          <SegmentedControl.Button selected={mode === "flip"}>Stacked</SegmentedControl.Button>
        </SegmentedControl>
        {mode === "flip" && (
          <>
            {sources.length > 1 && (
              <SegmentedControl aria-label="Which image to show" onChange={(index) => setLayer(sources[index]!.name)}>
                {sources.map(({ name }) => (
                  <SegmentedControl.Button key={name} selected={layer === name}>
                    {LAYER_WORDS[name]}
                  </SegmentedControl.Button>
                ))}
              </SegmentedControl>
            )}
            <SegmentedControl aria-label="Zoom" onChange={(index) => setZoom(ZOOMS[index]!)}>
              {ZOOMS.map((value) => (
                <SegmentedControl.Button key={value} selected={zoom === value}>
                  {zoomWords(value)}
                </SegmentedControl.Button>
              ))}
            </SegmentedControl>
            {box !== null && (
              <Button onClick={center} trailingVisual={() => <Keys keys="c" />}>
                Center on the change
              </Button>
            )}
          </>
        )}
      </Stack>
      <Text as="p" className="selfie-muted selfie-small">
        {mode === "flip" ? (
          <>
            Showing <strong>{LAYER_WORDS[layer].toLowerCase()}</strong>
            {shownSize === undefined ? "" : `, ${shownSize.width}×${shownSize.height}`} rendered at {scale}×,{" "}
            {zoom === "size" ? "at its actual size." : `with one image pixel ${zoom} device ${zoom === 1 ? "pixel" : "pixels"} wide.`}{" "}
            {canFlip && (
              <>
                <Keys keys="f" /> flips current and {LAYER_WORDS[compared!.layer].toLowerCase()}.{" "}
              </>
            )}
            {hasDiffLayer && (
              <>
                <Keys keys="d" /> shows the diff.{" "}
              </>
            )}
            {hasNotedLayer && (
              <>
                <Keys keys="w" /> shows the image when noted.{" "}
              </>
            )}
            <Keys keys="z" /> zooms. <Keys keys="s" /> goes back.
          </>
        ) : (
          <>
            Scaled to fit. Pick an image, or press <Keys keys="f" />, to stack them.
          </>
        )}
      </Text>
      {mode === "side" ? (
        <div className="selfie-panes" data-count={sources.length}>
          {/* Keyed by image, so an added story never shows the last one's image while its own loads. */}
          {sources.map(({ name, src }) => (
            <Pane
              key={src}
              layer={name}
              src={src}
              story={story}
              onOpen={() => {
                setLayer(name);
                setMode("flip");
              }}
              onLoad={rememberSize(src)}
            >
              {outlinesOn(name, sizes[src])}
            </Pane>
          ))}
        </div>
      ) : (
        <div className="selfie-viewport" ref={viewport} tabIndex={0} role="group" aria-label={`${LAYER_WORDS[layer]} image, ${zoomWords(zoom).toLowerCase()}. Scroll to pan.`}>
          <div className="selfie-stack" {...drawing} style={shownSize === undefined ? undefined : { width: shownSize.width * cssPixels, height: shownSize.height * cssPixels }}>
            {sources.map(({ name, src }) => {
              const size = sizes[src];
              return (
                <img
                  key={src}
                  src={src}
                  alt={name === layer ? `${LAYER_WORDS[name]} image of ${story}` : ""}
                  className="selfie-layer"
                  draggable={false}
                  style={{
                    visibility: name === layer ? "visible" : "hidden",
                    // Blocks stay even only at a whole number of device pixels, so anything else is smoothed.
                    imageRendering: Number.isInteger(devicePixels) ? "pixelated" : "auto",
                    ...(size === undefined ? {} : { width: size.width * cssPixels, height: size.height * cssPixels }),
                  }}
                  onLoad={rememberSize(src)}
                />
              );
            })}
            {outlinesOn(layer, shownSize)}
          </div>
        </div>
      )}
    </Stack>
  );
}
