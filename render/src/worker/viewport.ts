// What a story's viewport declaration comes to in pixels, which is Storybook's manager's job when it
// resizes its iframe. The worker opens iframe.html directly, so there's no manager to do it.
import type { Viewport } from "./protocol.ts";

/** A story's `globals.viewport` and `parameters.viewport`, the latter holding the project's too. */
export interface DeclaredViewport {
  global: unknown;
  parameter: unknown;
}

interface ViewportOption {
  styles?: { width?: unknown; height?: unknown };
}

/** Storybook's `MINIMAL_VIEWPORTS`, which only its manager's bundle has, for a project with no options of its own. */
export const STORYBOOK_VIEWPORTS: Readonly<Record<string, ViewportOption>> = {
  mobile1: { styles: { width: "320px", height: "568px" } },
  mobile2: { styles: { width: "414px", height: "896px" } },
  tablet: { styles: { width: "834px", height: "1112px" } },
  desktop: { styles: { width: "1280px", height: "1024px" } },
};

/** What the manager's toolbar writes for a size typed in, like `390-844` or `50pct-100pct`. */
const TYPED_SIZE = /^([0-9]{1,4})([a-z]{0,4})-([0-9]{1,4})([a-z]{0,4})$/;
const TYPED_SIZE_MINIMUM = 40;

const asObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};

function fromOption(option: ViewportOption | undefined): Viewport | null {
  const side = (length: unknown) => {
    const pixels = /^([0-9]+)(px)?$/.exec(String(length))?.[1];
    return pixels === undefined || Number(pixels) === 0 ? null : Number(pixels);
  };
  const [width, height] = [side(option?.styles?.width), side(option?.styles?.height)];
  return width === null || height === null ? null : { width, height };
}

function fromTyped([, width, widthUnit, height, heightUnit]: RegExpExecArray): Viewport | null {
  const inPixels = (unit: string | undefined) => unit === "" || unit === "px";
  if (!inPixels(widthUnit) || !inPixels(heightUnit)) return null;
  return { width: Math.max(Number(width), TYPED_SIZE_MINIMUM), height: Math.max(Number(height), TYPED_SIZE_MINIMUM) };
}

/**
 * The size a story declares, or null if it declares none, or else what's wrong with what it declares.
 * Newer Storybooks declare in `globals`, and older ones in `parameters.viewport.defaultViewport`.
 */
export function resolveViewport({ global, parameter }: DeclaredViewport): { size: Viewport } | { problem: string } | null {
  const declared = asObject(typeof global === "string" ? { value: global } : global);
  const parameters = asObject(parameter);
  const inGlobals = declared.value !== undefined && declared.value !== null && declared.value !== "";
  const value = inGlobals ? declared.value : parameters.defaultViewport;
  if (value === undefined || value === null || value === "") return null;

  const name = String(value);
  const options = asObject(parameters.options ?? parameters.viewports ?? STORYBOOK_VIEWPORTS) as Record<string, ViewportOption>;
  const typed = TYPED_SIZE.exec(name);
  let size: Viewport | null;
  if (typed !== null) {
    size = fromTyped(typed);
    if (size === null) return { problem: `Its viewport "${name}" isn't a size in pixels.` };
  } else {
    if (!Object.hasOwn(options, name)) return { problem: `Its viewport "${name}" isn't one of its options: ${Object.keys(options).join(", ") || "it has none"}.` };
    size = fromOption(options[name]);
    if (size === null) return { problem: `Its viewport "${name}" isn't a size in pixels: ${JSON.stringify(options[name]?.styles)}.` };
  }
  const rotated = inGlobals ? declared.isRotated === true : parameters.defaultOrientation === "landscape";
  return { size: rotated ? { width: size.height, height: size.width } : size };
}
