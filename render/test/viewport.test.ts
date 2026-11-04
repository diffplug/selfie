import { describe, expect, test } from "vitest";
import { resolveViewport, STORYBOOK_VIEWPORTS } from "../src/worker/viewport.ts";

const kiosk = { kiosk: { styles: { width: "640px", height: "480px" } } };
const resolve = (global: unknown, parameter: unknown = null) => resolveViewport({ global, parameter });

describe("a story's viewport", () => {
  test.each([
    [null],
    [undefined],
    [{}],
    [{ isRotated: false }],
    [{ value: undefined, isRotated: false }],
    [{ value: "" }],
  ])("isn't declared by %j", (global) => {
    expect(resolve(global)).toBeNull();
  });

  test("resolves Storybook's names, since no project has to list them", () => {
    for (const [name, { styles }] of Object.entries(STORYBOOK_VIEWPORTS)) {
      expect(resolve({ value: name })).toEqual({ size: { width: parseInt(String(styles?.width)), height: parseInt(String(styles?.height)) } });
    }
    expect(resolve({ value: "mobile2" })).toEqual({ size: { width: 414, height: 896 } });
  });

  test("takes a bare name, as an older Storybook's globals have it", () => {
    expect(resolve("mobile1")).toEqual({ size: { width: 320, height: 568 } });
  });

  test("resolves a project's or a story's option, which replace Storybook's as they do in its manager", () => {
    expect(resolve({ value: "kiosk" }, { options: kiosk })).toEqual({ size: { width: 640, height: 480 } });
    expect(resolve({ value: "mobile2" }, { options: kiosk })).toEqual({ problem: `Its viewport "mobile2" isn't one of its options: kiosk.` });
  });

  test("turns a rotated one on its side", () => {
    expect(resolve({ value: "mobile2", isRotated: true })).toEqual({ size: { width: 896, height: 414 } });
    expect(resolve({ value: "390-844", isRotated: true })).toEqual({ size: { width: 844, height: 390 } });
  });

  test.each([
    ["390-844", { width: 390, height: 844 }],
    ["390px-844px", { width: 390, height: 844 }],
    ["10-20", { width: 40, height: 40 }],
  ])("reads a size typed in the toolbar, %s, as its manager does", (value, size) => {
    expect(resolve({ value })).toEqual({ size });
  });

  test("reads what an older Storybook declares in its parameters, and prefers globals", () => {
    const older = { defaultViewport: "kiosk", defaultOrientation: "landscape", viewports: kiosk };
    expect(resolve(null, older)).toEqual({ size: { width: 480, height: 640 } });
    expect(resolve({ isRotated: false }, older)).toEqual({ size: { width: 480, height: 640 } });
    expect(resolve({ value: "mobile1" }, { defaultViewport: "kiosk" })).toEqual({ size: { width: 320, height: 568 } });
  });

  test.each([
    ["an unknown name", { value: "nope" }, null, /"nope" isn't one of its options: mobile1, mobile2, tablet, desktop\./],
    ["a name on Object.prototype", { value: "constructor" }, null, /isn't one of its options/],
    ["no options at all", { value: "nope" }, { options: {} }, /it has none/],
    ["a percentage", { value: "100pct-100pct" }, null, /isn't a size in pixels/],
    ["half a percentage", { value: "390-100pct" }, null, /isn't a size in pixels/],
    ["another unit", { value: "30em-40em" }, null, /isn't a size in pixels/],
    ["an option in percentages", { value: "a" }, { options: { a: { styles: { width: "100%", height: "100%" } } } }, /isn't a size in pixels/],
    ["an option of no size", { value: "a" }, { options: { a: { name: "A" } } }, /isn't a size in pixels/],
    ["an option of zero", { value: "a" }, { options: { a: { styles: { width: "0px", height: "10px" } } } }, /isn't a size in pixels/],
    ["an option with a fraction", { value: "a" }, { options: { a: { styles: { width: "1.5px", height: "10px" } } } }, /isn't a size in pixels/],
  ])("says what's wrong with %s", (_, global, parameter, problem) => {
    const resolved = resolve(global, parameter);
    expect(resolved).toEqual({ problem: expect.stringMatching(problem) });
  });
});
