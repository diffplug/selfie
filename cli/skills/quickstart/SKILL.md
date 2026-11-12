---
name: quickstart
description: Set up Selfie in a repository with a Storybook, get a person to their first rendered story, and offer commit statuses on GitHub. Use when someone asks to set up, install, or try Selfie. Works out the configuration, checks it really renders, and warns about anything that will get in their way.
---

# Set up Selfie

Get this repository to where a person can open Selfie and see their stories. Work it out yourself and don't ask for what you can find. Say what you found and every warning at the end, in plain words.

Never commit, stash, delete, or install a Storybook without asking. Those are the person's to decide. Writing `selfie.config.json` is the one change you're here to make, until the person asks for [commit statuses](#6-offer-commit-statuses).

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

- **Uncommitted changes:** `git status --porcelain`, which counts untracked files, and now includes `selfie.config.json`. Rendering still works, but every render is marked as uncommitted, so what it shows may not match the commit, and `selfie push` won't send it. Say that a folder that's always there, such as one of worktrees, belongs in `.gitignore`. List the files, and separate the config you just wrote from what was already there. Don't touch them: say what to commit or ignore.
- **The built Storybook isn't ignored:** `git check-ignore <storybookDir>`. If it isn't, the built Storybook itself makes every render uncommitted. Say to add it to `.gitignore`.
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

If `selfie flakes` reported anything, mention `selfie skill fix-flakes`. Say that a story whose play function throws reads as failed, and can't be approved until it's fixed, so a project with some will show them on its first full render.

Approvals made here stay here until they're pushed, so someone who goes on to step 6 approves on the site.

## 6. Offer commit statuses

Selfie can give every pushed commit a `selfie` status on GitHub, linked to its renders and its Storybook: red if a story failed or a change was rejected, yellow if something's undecided, green if it all matches what's approved. Offer this at the end, and do it only if the person says yes, since it commits a workflow and needs them to act on GitHub.

Say first what it asks of them, then go through these in order, and stop and say so if one fails.

1. **Check the service hosts this repository**, from the owner and name in its `origin`:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' https://app.selfie.dev/api/repositories/<owner>/<name>
   ```

   200 means it does. 404 means it doesn't, since the service only hosts the public repositories written into `ui/src/worker/index.ts`, so stop here and say so.

2. **Have the person install the GitHub App on this repository.** It's theirs to do, at <https://github.com/apps/selfie-hackathon/installations/new>. It only writes statuses and reads commits. Wait until they say it's done.

3. **Set the upload token as a repository secret**, which can upload and can't approve anything. It's kept in a file, so never print it:

   ```sh
   gh secret set SELFIE_UPLOAD_TOKEN -R <owner>/<name> < ~/.config/selfie-cloud/upload-token
   ```

   If that file isn't there, stop, and ask the person for the token.

4. **Write `.github/workflows/selfie.yml`**, and fill in the step that installs the repository's dependencies, using its package manager at the version it pins:

   ```yaml
   name: Selfie
   on:
     push:
       branches: ["**"]
   jobs:
     selfie:
       runs-on: ubuntu-24.04-arm
       steps:
         - uses: actions/checkout@v4
           with:
             # What a commit reaches is what its approvals come from, so this needs all of its history.
             fetch-depth: 0
         - uses: actions/setup-node@v4
           with:
             node-version: 26
         # Install the repository's dependencies here, such as `npm ci`, or `pnpm/action-setup` then `pnpm install --frozen-lockfile`.
         - uses: diffplug/selfie/.github/actions/selfie@main
           with:
             upload-token: ${{ secrets.SELFIE_UPLOAD_TOKEN }}
   ```

   It needs Node 26 for Selfie, and arm64 so that its images match the pinned environment. If the repository pins another Node for its own scripts, leave that as it is, and say that this combination hasn't been tried if it's the first.

5. **Ask before committing and pushing** `selfie.config.json`, the workflow, and any `.gitignore` change, on a branch or wherever the person says. Pushing starts the first run, which takes a few minutes, and more for a big Storybook.

6. **Check the run**, with `gh run list --branch <branch>` and `gh run view <id> --log-failed`. Once it's done, the commit has a status:

   ```sh
   gh api repos/<owner>/<name>/commits/<sha>/status --jq '.statuses[] | [.context, .state, .description] | join(" | ")'
   ```

Then tell them:

- Every story reads as added at first, so the status is yellow, or red if any story failed.
- To approve, follow the status's **Details** link, sign in with the writer's GitHub account, and **Approve all**. That's what later commits compare with, and a merge commit reaches it by itself, as long as the repository merges with merge commits rather than squashing or rebasing.
- To see those approvals locally: `SELFIE_REMOTE=https://app.selfie.dev selfie pull`.
- The `selfie` status only blocks merging if they make it a required check in branch protection.
