// The real stories behind the images: each built Storybook's, running, opened only when someone asks, since
// most reviews don't need them and each one is a whole page to load.
import { ChevronDownIcon, ChevronRightIcon, LinkExternalIcon } from "@primer/octicons-react";
import { Button, Heading, Link, Text } from "@primer/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RunView, RenderRow } from "../shared/api.ts";
import { LAYER_WORDS } from "./ImageCompare.tsx";
import { Keys } from "./Keys.tsx";

const storyPageUrl = (build: string, story: string) => `${build}?path=/story/${encodeURIComponent(story)}`;
export const storyFrameUrl = (build: string, story: string) => `${build}iframe.html?id=${encodeURIComponent(story)}&viewMode=story`;

export function OpenInStorybook({ url, story }: { url: string; story: string }) {
  return (
    <Link href={storyPageUrl(url, story)} target="_blank" rel="noreferrer noopener">
      Open in Storybook <LinkExternalIcon />
    </Link>
  );
}

/** The page, on the Storybook's own origin, saying if it may not be what rendered this image. */
export function StorybookLinkTo({ row, view }: { row: RenderRow; view: RunView }) {
  const { storybook } = view;
  if (storybook === null || row.state === "removed") return null;
  return (
    <>
      <OpenInStorybook url={storybook.url} story={row.story} />
      {!storybook.exactStorybook && <Text className="selfie-muted">This run&apos;s own build wasn&apos;t kept, so it&apos;s the latest, which may not match.</Text>}
    </>
  );
}

// For a run from before its viewport was recorded, which is laid out at this column's own width.
const UNKNOWN_SIZE_HEIGHT = 600;

/** Lays a story out at the size it was rendered at, and scales it to fit, as an image is. */
export function StoryFrame({ title, url, viewport }: { title: string; url: string; viewport: RunView["viewport"] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(box.current!);
    return () => observer.disconnect();
  }, []);
  const scale = viewport === null ? 1 : width / viewport.width;

  // A story may focus itself as it loads, as a terminal does, and then this page's keys would go to
  // it. A frame gets the keyboard only by being clicked, which the pointer being over it tells.
  const pointerInside = useRef(false);
  useEffect(() => {
    const takeBack = () => {
      const focused = document.activeElement;
      if (!pointerInside.current && focused instanceof HTMLIFrameElement && box.current?.contains(focused)) focused.blur();
    };
    // After the event, since the browser only says which element has focus once it's moved.
    const onBlur = () => setTimeout(takeBack);
    window.addEventListener("blur", onBlur);
    takeBack();
    return () => window.removeEventListener("blur", onBlur);
  }, [url]);

  return (
    <div
      ref={box}
      className="selfie-live-frame"
      onPointerEnter={() => {
        pointerInside.current = true;
      }}
      onPointerLeave={() => {
        pointerInside.current = false;
      }}
      style={{ height: viewport === null ? UNKNOWN_SIZE_HEIGHT : viewport.height * scale }}>
      {/* A new element per story, since moving one frame along would add to the browser's history. */}
      <iframe
        key={url}
        title={title}
        src={url}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        style={viewport === null ? { width: "100%", height: UNKNOWN_SIZE_HEIGHT } : { width: viewport.width, height: viewport.height, transform: `scale(${scale})` }}
      />
    </div>
  );
}

export function LiveStories({ row, view, open, onToggle }: { row: RenderRow; view: RunView; open: boolean; onToggle: () => void }) {
  const current = row.state === "removed" ? null : (view.storybook?.url ?? null);
  const golden = row.state === "added" ? null : view.goldenStorybookUrl;
  if (current === null && golden === null) return null;
  const side = (layer: "golden" | "current", url: string | null, missing: string) => (
    <div className="selfie-live-side">
      <Heading as="h3" variant="small">
        {LAYER_WORDS[layer]}
      </Heading>
      {url === null ? (
        <Text className="selfie-muted">{missing}</Text>
      ) : (
        <StoryFrame title={`${row.story}, ${layer}, running`} url={storyFrameUrl(url, row.story)} viewport={view.viewport} />
      )}
    </div>
  );
  return (
    <div className="selfie-live">
      <Button aria-expanded={open} leadingVisual={open ? ChevronDownIcon : ChevronRightIcon} trailingVisual={() => <Keys keys="l" />} onClick={onToggle}>
        Live stories
      </Button>
      {open && (
        <>
          <Text as="p" className="selfie-muted">
            These run for real, so time and animation aren&apos;t frozen as they are in an image. Once you click in one, keys go to the story.
            {view.viewport === null && " This run didn't record the size it rendered at, so these may lay out differently."}
          </Text>
          <div className="selfie-live-sides">
            {side("golden", golden, row.state === "added" ? "An added story has no golden." : "The golden's built Storybook wasn't kept.")}
            {side("current", current, "A removed story isn't in this run.")}
          </div>
        </>
      )}
    </div>
  );
}
