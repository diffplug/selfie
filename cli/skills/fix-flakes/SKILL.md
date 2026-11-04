---
name: fix-flakes
description: Make every Storybook story render the same image every time, using `selfie flakes`. Use when a Selfie review shows a story changed with no change to its code, when `selfie flakes` reports anything, when a play function fails only sometimes, or when a render warns "network not quiet".
---

# Fix flaky stories

A flaky story costs more than one false diff: people stop trusting the review. So the goal is a Storybook that renders identically every time, and the only fix that counts is removing the cause. **Never** add a tolerance, a retry, a longer sleep, or a blanket approval.

Fix what's wrong, and don't change how the product really works to suit a screenshot. The renderer already loads and decodes every image, however lazily, and freezes the clock and CSS animations. If a project needs it to render differently, such as in dark mode or another locale, that's `environment.recipe` in `selfie.config.json`, and `settleMs` and `storyTimeoutMs` beside it. Changing the recipe starts new goldens.

Always work from a built Storybook, and rebuild after every change. `selfie flakes` renders what's on disk, so without a rebuild it re-measures your old code.

## 1. Measure

```sh
selfie flakes --build --times 3
```

Use `--storybook-dir <dir>` if `selfie.config.json` doesn't say how to build. It renders every story that many times, records no batch, and stores nothing, so it's safe to run at any time. It exits 0 if everything held still, 1 if not, and prints one JSON document:

```json
{
  "renders": 3, "stories": 134, "directory": "...",
  "flaky": [{
    "story": "pages-home--default",
    "kinds": ["pixels"],
    "distinctImages": 2,
    "worst": { "changedPixels": 210858, "maxChannelDelta": 255, "boundingBox": { "x": 224, "y": 41, "width": 952, "height": 875 } },
    "images": { "first": "....png", "other": "....png", "diff": "....png" },
    "errors": [{ "source": "play", "message": "...", "renders": 2 }]
  }]
}
```

Worst first. `kinds` says what varied: `pixels`, `failed`, `errors` (a play, console, or page error that came and went), `timeout` and `request`. `timeout` and `request` count even when they happen every time, since waiting on the network is what makes a render unreliable.

Three renders only catch what's frequent. Measure with more before calling anything fixed (step 4).

## 2. Find the shared cause before fixing anything

Most flakes in one Storybook share a few causes, and fixing the biggest usually clears most of the list. So don't start with the first story's code.

1. **Look at the pictures.** Open `first` and `other` for the worst story, side by side, and `diff`. Do this before forming a theory. Compare what's around the difference as well: a layout that shifted looks like a change to everything right of or below it.
2. **Group the list** by `maxChannelDelta`, by the shape of `boundingBox`, and by `changedPixels`. Many stories with the same box, or the same handful of pixels, are one cause.
3. **Suspect what they share**, such as a layout or a shared component, and ask what changed recently. Then fix only the biggest group, and measure again before going on.

## 3. Diagnose by symptom

| What you see | Likely cause | The fix |
|---|---|---|
| Huge box, delta near 255, and everything beside or below one element moved | Something's size is decided by timing, like a pane that measures the window as it loads | Give it a fixed size. Look for what reads `innerWidth`, measures on mount, or restores a saved size |
| Huge box, delta low, a band at the top and bottom of something that scrolls | A scroll position decided before everything's size is known | Wait until every size is known before scrolling. It's a bug for real users too |
| Huge box inside something a play function opened | The wait ended before it had content | In the play function, wait for the thing itself, such as an iframe's document having content, not a sleep |
| A few pixels, delta 1 or 2, exactly at the corners of something | A background showing through the antialiased edge of a rounded border, around something that covers it | Remove the background, which nothing sees once the content's there. Don't square the corner |
| Text, a date, or a number differs | The current time, a random value, or an ID generated at render | A fixed value in the story's args. The renderer already fixes the page's clock, so look for a server's time or a seeded generator |
| Something's caught part way through moving | A JavaScript animation or a timer. CSS animations are already stopped | Have the code test `window.__SELFIE_RENDER__`, which is true before story code runs. `recipe.renderGlobal` can rename it, to reach a freeze the project already has |
| `errors` with a play message like "not visible" | An assertion that only checks once, while something's still opening | Retry it: `await waitFor(() => expect(canvas.getByRole(...)).toBeVisible())`. `findBy*` retries finding it, and not what you then assert about it |
| `timeout`: "network not quiet", in every render | A request nobody answers, or a repeating poll. The message names what was in flight | Look at that URL. The render has no network, so stub what's external, and stop any poll in a render |
| `request` errors | A request leaving the Storybook, which is aborted | Serve it from `staticDirs`, or stub it |
| `failed` in some renders | A real intermittent crash, or a story near its time limit | Read `errors`. Treat a crash as a bug in the component, not in the story |
| Only fails with many stories rendering at once | The story depends on timing, and load exposes it | Same fixes. Confirm with `--concurrency 1`, then keep the fix and measure at the default |

If a symptom points at Selfie's renderer rather than the project, such as a request Selfie itself never answers, say so and report it, rather than working around it in stories.

## 4. Prove it

Rebuild, and measure the same stories with more renders:

```sh
selfie flakes --build --times 8 --story 'pages-home--*'
```

Then, once a group looks fixed, measure the whole Storybook:

```sh
selfie flakes --build --times 5
```

Done means exit 0. It doesn't prove there's no flake left, only that none showed in that many renders, so say how many you ran. A flake seen in 1 of 5 renders would slip past 5 clean renders about a third of the time, so use more renders for a rare one.

## 5. Report

Say what the causes were, how many stories each one explained, what you changed, and how many clean renders you ended on. Fixing flakes changes images, so a review afterward will show real differences, which a person needs to approve: **never** approve them for someone in order to make a review pass.

## What not to do

- Don't add a sleep, or lengthen `settleMs`, to make a difference go away. It hides the race, and it comes back under load.
- Don't delete or skip a story because it flakes, unless a person agrees that it isn't worth keeping.
- Don't call something flaky just because it changed once. A real change is the same in every render, so `selfie flakes` won't list it.
