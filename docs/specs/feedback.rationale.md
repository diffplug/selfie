# Feedback: why

## Sessions

**Why the worktree's top folder.** Each worktree is one agent working on one thing, and two of them sharing a store is the normal case here, so the session can't be the store. It isn't the exact working directory, so that running from `cli/` joins the same session, and that's also where `selfie.config.json` lives. Separate Selfie projects in subfolders of one repository would need more, and nobody has that yet.

## Notes

**Why any story.** The first thing a person wants to say to an agent while dogfooding Selfie's own UI is "this looks wrong", usually on a story that didn't change, or that's added because nothing has a golden yet. Notes only on changes would miss most of it.

**Why notes don't decide anything.** A decision is a claim about whether an image is right, and a note is a request. Keeping them apart means what blocks has nothing new to reason about, and a person can write "make this bigger" on an image they'd still approve.

**Why being sent is on the message.** The first design had one state on a note. A person answering a note that had already been read would have made the note a draft again, so it could have been deleted with its whole conversation, and it would have disappeared from what the agent could read. It also couldn't say which notes a waiting agent has already received.

## Waiting for feedback

**Why a heartbeat in the store, and not a socket.** The command and the UI's server are separate processes, and either may start first or not at all. The store is what they already share, and a row that goes stale needs no cleanup when a process dies.

**Why a timeout and a signal each have an exit code.** Some agents can't leave a command running for hours, so they need to tell "nothing yet, ask again" from "something went wrong". A signal means someone wants it to stop, so a loop that asks again on a timeout mustn't ask again on that.

## Answers

**Why only a person closes a note.** It's the same reason moved stories need a decision: the agent is the one claiming it's fixed, so it can't also be the one saying so.

## A new batch

**Comparing with a note, with no golden.** The loop this exists for often starts on a story with no golden: someone looks at a live story, notes what's wrong, and an agent changes it. Without this, both images would read as added, with nothing to compare, which is the one moment a person most wants a diff.

**Why no stacking.** Stepping through diffs from run to run raises what each is against, and how to show it, before anyone has needed it. One batch, one diff, and one image per note answers "did this get fixed?" with a single flip. Earlier batches are still reachable by URL.

**Why a banner, and not switching.** A person reading an image shouldn't have it change under them because an agent finished. Whether someone actively waiting would rather it switched is an open question for using it.

**Why say when nothing moved.** An agent can sincerely believe it fixed something, when its change didn't reach the story. `imageChanged` tells the agent before it replies, and the note tells the person.
