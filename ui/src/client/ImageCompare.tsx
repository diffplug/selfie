// Seeing the change. Side by side gives the shape of it, and flip gives one pixel at actual size:
// all three layers stay stacked and loaded, so switching costs no scroll and no flash. How someone
// is looking stays the same from story to story, since this stays mounted across them.
import { Button, Checkbox, FormControl, SegmentedControl, Stack, Text } from "@primer/react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { PixelDiff, SnapshotRow } from "../shared/api.ts";
import { diffImageUrl, imageUrl } from "./api.ts";
import { useHotkeys } from "./hooks.ts";
import { Keys } from "./Keys.tsx";

const ZOOMS = [1, 2, 4, 8] as const;
type Zoom = (typeof ZOOMS)[number];
type Layer = "current" | "golden" | "diff";

const LAYER_WORDS: Readonly<Record<Layer, string>> = { current: "Current", golden: "Golden", diff: "Diff" };

interface Source {
  readonly name: Layer;
  readonly src: string;
}

function sourcesOf({ imageHash, goldenHash }: SnapshotRow, hasDiffImage: boolean): readonly Source[] {
  const sources: Source[] = [];
  if (goldenHash !== null) sources.push({ name: "golden", src: imageUrl(goldenHash) });
  if (imageHash !== null) sources.push({ name: "current", src: imageUrl(imageHash) });
  if (hasDiffImage && imageHash !== null && goldenHash !== null) sources.push({ name: "diff", src: diffImageUrl(imageHash, goldenHash) });
  return sources;
}

function Pane({ layer, src, story, onOpen }: { layer: Layer; src: string; story: string; onOpen: () => void }) {
  return (
    <figure className="selfie-pane">
      <figcaption>{LAYER_WORDS[layer]}</figcaption>
      <button type="button" className="selfie-pane-button" onClick={onOpen} aria-label={`Open the ${layer} image at actual pixels`}>
        <img src={src} alt={`${LAYER_WORDS[layer]} image of ${story}`} loading="lazy" decoding="async" />
      </button>
    </figure>
  );
}

export function ImageCompare({ row, diff }: { row: SnapshotRow; diff: PixelDiff | null }) {
  const { story, imageHash, goldenHash } = row;
  const sources = sourcesOf(row, diff?.kind === "pixels");
  const canFlip = goldenHash !== null && imageHash !== null;
  const box = diff?.kind === "pixels" ? diff.boundingBox : null;
  const firstChanged = diff?.kind === "pixels" ? diff.firstChanged : null;

  const [mode, setMode] = useState<"side" | "flip">("side");
  const [wantedLayer, setLayer] = useState<Layer>("current");
  // The layer someone asked for, or, in a story without it, the one it has.
  const shown = sources.find(({ name }) => name === wantedLayer) ?? sources.find(({ name }) => name === "current") ?? sources[0];
  const layer = shown?.name ?? "current";
  const [zoom, setZoom] = useState<Zoom>(1);
  const [outline, setOutline] = useState(true);
  const [sizes, setSizes] = useState<Readonly<Record<string, { width: number; height: number }>>>({});
  const viewport = useRef<HTMLDivElement>(null);

  const shownSize = shown === undefined ? undefined : sizes[shown.src];
  const hasSize = shownSize !== undefined;

  const center = useCallback(() => {
    const element = viewport.current;
    if (element === null || box === null) return;
    // A box too big for the viewport may show nothing changed at its center, as when two distant
    // pixels changed, so go to a pixel that certainly did.
    const fits = box.width * zoom <= element.clientWidth && box.height * zoom <= element.clientHeight;
    const x = fits || !firstChanged ? box.x + box.width / 2 : firstChanged.x + 0.5;
    const y = fits || !firstChanged ? box.y + box.height / 2 : firstChanged.y + 0.5;
    element.scrollTo({ left: x * zoom - element.clientWidth / 2, top: y * zoom - element.clientHeight / 2 });
  }, [box, firstChanged, zoom]);

  // A small change is usually off-screen at actual pixels, so go to it whenever the scale changes,
  // and as soon as the image and the change are known.
  useLayoutEffect(() => {
    if (mode === "flip" && hasSize) center();
  }, [mode, center, hasSize]);

  const hasDiffLayer = sources.some(({ name }) => name === "diff");

  useHotkeys({
    s: () => setMode("side"),
    f: () => {
      if (mode === "side") setMode("flip");
      else if (canFlip) setLayer(layer === "current" ? "golden" : "current");
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
  });

  if (sources.length === 0) {
    return (
      <Text as="p" className="selfie-muted">
        There's no image to show.
      </Text>
    );
  }

  return (
    <Stack as="section" aria-label="Images" gap="condensed">
      <Stack direction="horizontal" wrap="wrap" align="end" gap="normal">
        <SegmentedControl aria-label="How to compare the images" onChange={(index) => setMode(index === 0 ? "side" : "flip")}>
          <SegmentedControl.Button selected={mode === "side"}>Side by side</SegmentedControl.Button>
          <SegmentedControl.Button selected={mode === "flip"}>Actual pixels</SegmentedControl.Button>
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
                  {`${value}×`}
                </SegmentedControl.Button>
              ))}
            </SegmentedControl>
            {box !== null && (
              <>
                <Button onClick={center} trailingVisual={() => <Keys keys="c" />}>
                  Center on the change
                </Button>
                <FormControl>
                  <Checkbox checked={outline} onChange={(event) => setOutline(event.target.checked)} />
                  <FormControl.Label>Outline the change</FormControl.Label>
                </FormControl>
              </>
            )}
          </>
        )}
      </Stack>
      <Text as="p" className="selfie-muted selfie-small">
        {mode === "flip" ? (
          <>
            Showing <strong>{LAYER_WORDS[layer].toLowerCase()}</strong>
            {shownSize === undefined ? "" : `, ${shownSize.width}×${shownSize.height}`}, with one image pixel {zoom} screen {zoom === 1 ? "pixel" : "pixels"} wide.{" "}
            {canFlip && (
              <>
                <Keys keys="f" /> flips current and golden.{" "}
              </>
            )}
            {hasDiffLayer && (
              <>
                <Keys keys="d" /> shows the diff.{" "}
              </>
            )}
            <Keys keys="z" /> zooms. <Keys keys="s" /> goes back.
          </>
        ) : (
          <>
            Scaled to fit. Pick an image, or press <Keys keys="f" />, to see it at actual pixels.
          </>
        )}
      </Text>
      {mode === "side" ? (
        <div className="selfie-panes" data-count={sources.length}>
          {/* Keyed by image, so a new story never shows the last one's image while its own loads. */}
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
            />
          ))}
        </div>
      ) : (
        <div className="selfie-viewport" ref={viewport} tabIndex={0} role="group" aria-label={`${LAYER_WORDS[layer]} image at ${zoom}×. Scroll to pan.`}>
          <div className="selfie-stack" style={shownSize === undefined ? undefined : { width: shownSize.width * zoom, height: shownSize.height * zoom }}>
            {sources.map(({ name, src }) => {
              const size = sizes[src];
              return (
                <img
                  key={src}
                  src={src}
                  alt={name === layer ? `${LAYER_WORDS[name]} image of ${story}` : ""}
                  className="selfie-layer"
                  style={{
                    visibility: name === layer ? "visible" : "hidden",
                    ...(size === undefined ? {} : { width: size.width * zoom, height: size.height * zoom }),
                  }}
                  onLoad={(event) => {
                    const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
                    setSizes((known) => (known[src] === undefined ? { ...known, [src]: { width, height } } : known));
                  }}
                />
              );
            })}
            {outline && box !== null && (
              <div
                className="selfie-outline"
                aria-hidden="true"
                style={{ left: box.x * zoom, top: box.y * zoom, width: box.width * zoom, height: box.height * zoom }}
              />
            )}
          </div>
        </div>
      )}
    </Stack>
  );
}
