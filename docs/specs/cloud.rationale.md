# Cloud: rationale

## Projects

**Written down in code.** There are only ever going to be a few, all public, and all one person's, so a table to manage them would have one user and no screen. Neon stays where `docs/specs/system.md` → Cloud data puts it, for when there are accounts.

**A binding, not REST.** The REST API shares one limit across a whole account, needs a token, and adds a hop, and none of that buys anything with a few projects. A binding needs no secret and no migration later: both reach the same SQL through `Sql`.

## Origins

**Another site for Storybooks.** Another subdomain of `selfie.dev` would be the same site, so a branch's Storybook could set cookies the app reads and send requests `SameSite` doesn't stop. A different registrable domain, `selfieusercontent.com`, gets neither, as `dormouseusercontent.com` does for Dormouse. The hackathon used the Worker's workers.dev name, which the Public Suffix List made a site of its own.

**A landing page on another origin.** The landing page loads third-party things, a mailing-list form and video thumbnails, and may load analytics. On its own origin none of it can read the app's pages or ride its cookie. The two are still the same site, so the app's routes keep their own `Origin` checks.

## Without Git or a decoder

**A graph, not a list per batch.** Sending what a batch reaches with each batch would store 40 KB per batch, and each commit only adds an edge or two. The graph also lets a later approval be found without asking CI anything, and any cache of references could be built from it.

**Diffs from whoever pushed.** Decoding in a Worker needs a WebP decoder and a request's CPU for each pair, and in a browser it needs the diff's hashing rewritten. The machine that pushed has both images' decoder already, and `docs/specs/ui.md` → Future had already asked for diffs stored at review time.

**A branch's earlier batches from a time its pusher says.** Following them needs the earliest author time of a branch's own commits, which needs Git, so the push says it. The cloud finds the batches itself, since it's the only store holding them all: CI renders on a fresh machine whose store has only the batch it's pushing, so a list of commits from the pusher would be empty. It keeps one time per batch, and the walk reads the branch's batches when it's asked, just as `selfie review` does, so a batch pushed late still counts for a later one that started after it. Edges from a commit to the old commits would be shared by every batch at that commit, in every environment, and carried on through any commit whose history holds it, so the cloud would reach what a review here doesn't. The old commits' own history isn't walked either, for the same reason. Without the time, a rebase or a force-push asks again, which never passes anything unseen, so an older CLI is safe.

## Commit status

**A status and not a check run.** A status is one call, with a yellow state that means what's meant here. `action_required` on a check run isn't yellow, and a run left `in_progress` goes stale.

**Rejected is red.** Someone looked and said no, so the next thing that happens is a code change, which is what red means for a failure too.
