// Drawing a box on a stacked image, for a note to be about.
import { useRef, useState, type PointerEvent } from "react";
import type { BoundingBox } from "../shared/api.ts";

type Point = { readonly x: number; readonly y: number };

/** Less than this is a click, or a slip. */
const MIN_DRAWN_PIXELS = 4;

/** The whole pixels between two points, inside an image. */
export function boxBetween(from: Point, to: Point, size: { readonly width: number; readonly height: number }): BoundingBox {
  const x = Math.floor(Math.max(Math.min(from.x, to.x), 0));
  const y = Math.floor(Math.max(Math.min(from.y, to.y), 0));
  return {
    x,
    y,
    width: Math.ceil(Math.min(Math.max(from.x, to.x), size.width)) - x,
    height: Math.ceil(Math.min(Math.max(from.y, to.y), size.height)) - y,
  };
}

/** What's drawn on this story, which is forgotten on leaving it. `onDrawn` runs when a real box is finished. */
export function useDrawnBox({
  story,
  cssPixels,
  size,
  onDrawn,
}: {
  readonly story: string;
  readonly cssPixels: number;
  readonly size: { readonly width: number; readonly height: number } | undefined;
  readonly onDrawn: () => void;
}) {
  const [drawnOn, setDrawnOn] = useState<{ readonly story: string; readonly box: BoundingBox } | null>(null);
  const from = useRef<Point | null>(null);
  const drawn = drawnOn?.story === story ? drawnOn.box : null;

  const pointOn = (event: PointerEvent<HTMLElement>): Point => {
    const { left, top } = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - left) / cssPixels, y: (event.clientY - top) / cssPixels };
  };

  return {
    drawn,
    clear: () => setDrawnOn(null),
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        // A region's outline is for selecting it.
        if (event.button !== 0 || (event.target as Element).closest(".selfie-region") !== null) return;
        from.current = pointOn(event);
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        if (from.current === null || size === undefined) return;
        setDrawnOn({ story, box: boxBetween(from.current, pointOn(event), size) });
      },
      onPointerUp: () => {
        if (from.current === null) return;
        from.current = null;
        if (drawn !== null && Math.max(drawn.width, drawn.height) * cssPixels >= MIN_DRAWN_PIXELS) onDrawn();
        else setDrawnOn(null);
      },
    },
  };
}
