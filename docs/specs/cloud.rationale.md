# Cloud: rationale

## Projects

**Written down in code.** There are only ever going to be a few, all public, and all one person's, so a table to manage them would have one user and no screen. Neon stays where `docs/specs/system.md` → Cloud data puts it, for when there are accounts.

**A binding, not REST.** The REST API shares one limit across a whole account, needs a token, and adds a hop, and none of that buys anything with a few projects. A binding needs no secret and no migration later: both reach the same SQL through `Sql`.

## Origins

**A workers.dev hostname.** Another subdomain of `selfie.dev` would be the same site, so it needs a cookie and a request guard to hold, where a different site simply gets neither. It also takes no DNS.

## Without Git or a decoder

**A graph, not a list per batch.** Sending what a batch reaches with each batch would store 40 KB per batch, and each commit only adds an edge or two. The graph also lets a later approval be found without asking CI anything, and any cache of references could be built from it.

**Diffs from whoever pushed.** Decoding in a Worker needs a WebP decoder and a request's CPU for each pair, and in a browser it needs the diff's hashing rewritten. The machine that pushed has both images' decoder already, and `docs/specs/ui.md` → Future had already asked for diffs stored at review time.

**Not following a branch's earlier batches.** It needs the earliest author time of a branch's own commits, which needs Git. It's only for a rebase or a force-push, which asks again rather than passing something unseen.

## Commit status

**A status and not a check run.** A status is one call, with a yellow state that means what's meant here. `action_required` on a check run isn't yellow, and a run left `in_progress` goes stale.

**Rejected is red.** Someone looked and said no, so the next thing that happens is a code change, which is what red means for a failure too.
