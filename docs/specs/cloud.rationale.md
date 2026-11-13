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

**What a branch inherited.** A branch's batch is compared with what its history approved, so whatever its base on the default branch still waits for shows on every branch cut from it. Pull requests #70, #71 and #72 each read "21 changed, 11 added, waiting for approval", and each changed none of those 32 images from its base: all were the default branch's own, never approved. Read alone, that can't be told from a branch that changed 32 stories. Telling the two apart needs only the base's images, so it costs one request, and it changes only the words: an inherited change still waits for someone, wherever it's approved. A commit with a batch of the default branch is that branch, which inherits nothing from itself.

**Later commits too.** What a commit is compared with is the newest approval its history reaches, worked out when it's read, so an approval on one pull request already changes how every pull request stacked on it reads, and a merge that has it. Only the status on GitHub stayed behind, yellow until that commit's next push. Saying it again for each later commit that has a batch is what closes that.

**Why 50, and newest first.** What a Worker does after its response gets about 30 seconds, and one invocation has a limit on how many queries and requests it makes, which is lower on the Workers Free plan. Each status here is two queries and a request to GitHub, and GitHub also limits how fast an app may post. Neither limit was measured here. Fifty covers a deep stack with room left, and newest first says it for the work in progress before an old commit that nobody's looking at. A walk past 1,000 commits from the decided one is far from any stack.
