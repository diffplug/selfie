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

Run the build command from the top of the repository. Then confirm `iframe.html` and `index.json` are in `storybookDir`, and count the entries in `index.json` whose `type` is `story`. If the build fails, or there are no stories, stop and show what happened.

Then render one story for real, which records nothing:

```sh
selfie flakes --runs 2 --story '<any story ID from index.json>'
```

The first run downloads the browser, which can take minutes, so say that before you start. Exit 0 means it renders. Exit 1 means it rendered and something varied, which is worth reporting and doesn't block anything. Exit 2 means it couldn't run, so stop and show why. If Docker can't get the image for this machine's platform, say so, and that a project can set `environment.runner` in the config.

## 4. Look for what will get in their way

Check each of these, and warn about what applies:

- **Uncommitted changes:** `git status --porcelain`, which counts untracked files, and now includes `selfie.config.json`. Rendering still works, but every render is marked as uncommitted, and **no run can be accepted as goldens until the tree is clean**. List the files, and separate the config you just wrote from what was already there. Don't touch them: say what to commit or ignore.
- **The build isn't ignored:** `git check-ignore <storybookDir>`. If it isn't, the build itself makes every render uncommitted. Say to add it to `.gitignore`.
- **Not on the default branch:** only goldens on the default branch's history become a baseline for others. `selfie find-baseline` says what this branch would compare with. Say so if a person making their first goldens here should switch branch.
- **A shallow clone:** `git rev-parse --is-shallow-repository`. Finding a baseline may stop early.
- **A big Storybook:** rendering every story can take a while. If there are many, say roughly how long the one story took, and that a whole run takes longer.

## 5. Hand it over

`selfie` keeps running until it's stopped, so **never wait for it to finish**. It builds, serves, and prints `{ url, ... }` on stdout. If you can start long-running processes, start it there with `--no-build`, since step 3 just built it, and give the person the URL. Otherwise, give them the command to run themselves, which also opens their browser.

Then report, briefly:

- what you found: the Storybook, its build command, how many stories
- what you changed: `selfie.config.json`
- every warning from step 4, and what to do about each
- what's next:
  1. In the browser, pick a story and press `c` to render it.
  2. To make goldens, on a clean tree on the default branch: **Render all**, **Review the newest run**, **Approve all**, **Accept this run**.
  3. Then change a component on a branch, commit, restart `selfie`, and **Render all**. The tree shows only what changed.

If `selfie flakes` reported anything, mention `selfie skill fix-flakes`.
