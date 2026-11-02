// For a stand-in for `capture`, so one written in another package's tests can't drift from
// what the real one writes.
export { STORIES_DIR, storyFileName, totalsOf, writeManifest } from "./manifest.ts";
