# Sync: why

## What goes

**Why not a run from a dirty tree.** Its images may show work that's in no commit, which on a public repository would publish it. It also can't become goldens, so there's little to gain.

**Why the server checks the commit.** The client could check, but a check on the client doesn't hold for every client, and this one exists to stop something leaking. It's also the simplest answer to what anonymous viewers may see of unpushed work: anyone can already see what GitHub has.

**Why the server names a decision's author.** The local `actor` is whatever Git's config says, and on the server, that would be anyone's claim about who approved something. The push is authenticated, so that's who is known to be vouching for it.

## Goldens

**Why CI can make goldens.** A merge commit's run happens on CI, which can't decide, so if making goldens took Decide, no merge commit would get any without a person re-rendering it, and the next branch's baseline would drift ever further back. With nothing removed, `acceptRun` makes no judgment of its own: every image already matches the baseline, or has an approval from someone who could give one.
