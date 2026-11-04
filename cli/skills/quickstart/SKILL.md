---
name: quickstart
description: Set up Selfie in a repository with a Storybook, and get a person to their first rendered story. Use when someone asks to set up, install, or try Selfie. Works out the configuration, checks it really renders, and warns about anything that will get in their way.
---

# Set up Selfie

Get this repository to where a person can open Selfie and see their stories. Work it out yourself and don't ask for what you can find. Say what you found and every warning at the end, in plain words.

Never commit, stash, delete, or install a Storybook without asking. Those are the person's to decide. Writing `selfie.config.json` is the one change you're here to make.

Below, `selfie` means however it runs here: `selfie` if it's on the PATH, or `node --disable-warning=ExperimentalWarning <checkout>/cli/src/main.ts`.

## 1. Check what it needs

- **Node 26 or later**, for `selfie` itself.
- **Docker running**: `docker version`. Stories render in a pinned browser in a container. Without it, stop and say so, or offer `--native`, which uses this machine's browser, and whose images won't match any other machine's.
- **A Git repository with a commit:** `git rev-parse HEAD`. A render is kept with a commit.

## 2. Find the Storybook

If `selfie.config.json` is already at the top of the repository, keep what it says, and go on to step 3.

Otherwise, ask Git, so that dependencies and other worktrees don't count:

```sh
git ls-files '.storybook/main.*' '*/.storybook/main.*'
```

- **None:** stop, and say there's no Storybook here. Offer `npm create storybook@latest`, and don't run it unasked.
- **More than one:** prefer whichever the root `package.json`'s `storybook` script points at. If nothing settles it, ask which one, and say what each is.

Then work out how to build it:

- **The command:** a `build-storybook` script in that package, or a script that runs `storybook build`, or else `npx storybook build`. Use the repository's package manager, by its lockfile.
- **Where the command runs:** always the top of the repository, so a package needs its filter, as in `pnpm --filter <name> build-storybook`, or `npm run build-storybook -w <name>`.
- **Where it writes:** `storybook-static` beside `.storybook`, unless the script passes `-o` or `--output-dir`.

Write `selfie.config.json` at the top of the repository, with the directory relative to there:

```json
{
  "storybookDir": "packages/ui/storybook-static",
  "buildCommand": "pnpm --filter ui build-storybook"
}
```

## 3. Prove it

Make sure the repository's dependencies are installed first, since a fresh clone or worktree has none, and a build then fails on whatever it can't find. If `node_modules` is missing, install them with the repository's package manager, and say that you did. This doesn't change any tracked file, or it shouldn't: if it does, say so. The build may need network access, so if you're in a sandbox and it fails on a fetch or seems to hang, ask for network access rather than killing it and guessing.

Run the build command from the top of the repository. Then confirm `iframe.html` and `index.json` are in `storybookDir`, and count the entries in `index.json` whose `type` is `story`. If the build fails, or there are no stories, stop and show what happened.

Then render one story for real, which records nothing:

```sh
selfie flakes --times 2 --story '<any story ID from index.json>'
```

The first render downloads the browser, which can take minutes, so say that before you start. Exit 0 means it renders. Exit 1 means it rendered and something varied, which is worth reporting and doesn't block anything. Exit 2 means it couldn't run, so stop and show why. If Docker can't get the image for this machine's platform, say so, and that a project can set `environment.runner` in the config.

## 4. Look for what will get in their way

Check each of these, and warn about what applies:

- **Uncommitted changes:** `git status --porcelain`, which counts untracked files, and now includes `selfie.config.json`. Rendering still works, but every render is marked as uncommitted, so what it shows may not match the commit. List the files, and separate the config you just wrote from what was already there. Don't touch them: say what to commit or ignore.
- **The build isn't ignored:** `git check-ignore <storybookDir>`. If it isn't, the build itself makes every render uncommitted. Say to add it to `.gitignore`.
- **A shallow clone:** `git rev-parse --is-shallow-repository`. Approvals from before where its history stops can't be reached, so stories may ask again.
- **A big Storybook:** say how many stories there are, and that rendering them all takes a while. Don't guess how long from one story.

## 5. Hand it over

`selfie` keeps running until it's stopped, so **never wait for it to finish**. It builds, serves, and prints `{ url, ... }` on stdout. If you can start long-running processes, start it there with `--no-build`, since step 3 just built it, and give the person the URL. Otherwise, give them the command to run themselves, which also opens their browser.

Then report, briefly:

- what you found: the Storybook, its build command, how many stories
- what you changed: `selfie.config.json`
- every warning from step 4, and what to do about each. Leave out the project's own build warnings, such as CSS or bundle sizes, which have nothing to do with Selfie
- what's next:
  1. In the browser, pick a story and press `c` to render it.
  2. To set what later renders compare with: **Render all**, **Review the newest batch**, **Approve all**. Any branch will do.
  3. Then change a component, commit, restart `selfie`, and **Render all**. The tree shows only what changed since what was approved.

If `selfie flakes` reported anything, mention `selfie skill fix-flakes`.
