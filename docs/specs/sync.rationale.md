# Sync: why

## What a store takes

**Why the server takes a client's hash.** It first decoded every image to check its hash, so that a hash named one image everywhere. That guards against someone who can upload, and they're already trusted with more: approving and uploading both take write access (`docs/specs/access.md` → Who can do what), the server can't tell a real render from a forged one, and blobs are per project, so nothing crosses to another. The attack it stopped is someone with write access showing a reviewer a false picture under another image's hash. They could approve the real one themselves.

It also cost a lot. A Worker can't run `sharp`, and hashing whole pixels in Wasm wouldn't fit tall pages in its 128 MB: `@jsquash/webp` 1.5.0 decoded real images correctly in local `workerd`, but one 2400×9898 peaked at 531 MB of process memory, in a prototype that never returned any. Hashing rows as they decode would have meant writing a WebP decoder of our own.

What's given up: wrong bytes under a hash stay, a browser won't notice, and a pull fails on them with nothing to fix them yet. A sender's check before upload catches an honest client's corruption, for about 13 ms an image at 2×.

**Why a Storybook file is checked as it streams.** Unlike an image's, a file's hash is of its bytes, so checking it is cheap, and it stops one file standing in for another. But a server takes 64 MB, a Worker has 128 MB, and gzip can hold far more than it's sent as, so decompressing a file whole to hash it could run a Worker out. Web Crypto hashes only bytes held whole, so the check hashes each piece as it decompresses, by `node:crypto`, which a Worker has with `nodejs_compat`, and holds only what was sent.

**Why not a batch from a dirty tree.** Its images may show work that's in no commit, which on a public repository would publish it.

**Why the batch goes before its images.** Images went first in the first design, since a batch refers to them. But a batch is refused for its commit, and an image isn't, so a forgotten `git push` would have uploaded everything to be told no, and left those images where anyone holding a hash could read them. Sending the batch first costs nothing, since it refers to no image until its renders.

**Why the server checks the commit.** The client could check, but a check on the client doesn't hold for every client, and this one exists to stop something leaking. It's also the simplest answer to what anonymous viewers may see of unpushed work: anyone can already see what GitHub has.

**Why the server names a decision's author.** The local `actor` is whatever Git's config says, and on the server, that would be anyone's claim about who approved something. The push is authenticated, so that's who is known to be vouching for it.

## Pushing and pulling

**Decisions rather than a batch.** A pull used to fetch one commit's goldens, a whole batch that CI had to make. What a review reads is decisions, so those are what it brings, which also means no walk for a commit to hold to.

**Back through the second approval.** Older decisions can't change what a story reads as, since its reference is its newest approval. The second is there because an approval made on a batch isn't what that batch compares with, so that batch falls back on the one before.
