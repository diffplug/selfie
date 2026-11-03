# Feedback

> How a person tells a coding agent what they see, on the images themselves.
>
> - Owns notes and sessions. `docs/specs/ui.md` owns the routes and the screens they sit on, and `docs/specs/access.md` who may reach them.

Source of truth: `cli/src/notes.ts`, `ui/src/client/Feedback.tsx`, and `ui/src/client/NotesPanel.tsx`; tests in `cli/test/notes.test.ts`, and stories in `Screens/Feedback` and `Screens/Snapshot`.

## Sessions

A session is whose notes these are.

- **Must key a local session on the Git worktree's top folder**, so parallel worktrees sharing a store never see or change each other's notes, and a subfolder is the same session as its worktree (rationale).
- **Must keep notes out of the store's schema**, in the project's `store.db` beside `render_keys`, since nothing else needs them to reach D1 yet. Reserved: **Scope: remote-notes**.

## Notes

A note is where something is. Its messages are the conversation about it.

| Note | Is |
|---|---|
| `id` | A number across the project's store, short enough to say |
| `story` | The story's name, so a note follows it into later runs |
| `runId` | The run it was written on |
| `imageHash` | The image it's about, or null for a story with no image, such as one that failed |
| `box` | The part of that image, in its pixels, or null for all of it |
| `state` | `draft` until its first message is sent, then `sent` |
| `messages` | Oldest first |

| Message | Is |
|---|---|
| `sender` | `person` or `agent` |
| `author`, `at` | Who according to Git, and when |
| `text` | What was said |
| `runId` | The run it was written on |
| `sent` | Whether it's the agent's yet |

- **Must let a note be on any story with any state**, not only on one that changed, since most feedback is that something looks wrong (rationale).
- **Must take a note's box from what someone drew on a stacked image, or else the box around the regions they selected, or else all of the image**, on whichever image is showing, where the diff image counts as the current one.
- **Must draw a note's box on the image it's about, and on no other**, since a box is only meaningful on the pixels it was drawn on.
- **Must never let a note approve, reject, or block anything.** `selfie accept` doesn't know notes exist (rationale).
- **Must keep whether something's been sent on the message, and not on the note**, so an answer to a note that's already been read can be a draft (rationale).
- **May delete only what hasn't been sent**, since what has been sent has been read. A note goes when nothing's left of it.

## Handing notes to an agent

**The default is to copy and paste**, since it needs nothing of the agent but that it can read.

- **Must show nothing about notes on a run's screens until there's at least one, or an agent is waiting**, so someone not using an agent never sees any of this.
- **Must offer Copy for agent on every screen of a run, which sends every draft, and gives text with all that's been sent**, so copying again loses nothing.
- **Must show that text as well as copying it**, since a browser can refuse the clipboard.
- **Must never name a path in that text**, since a response never does (`docs/specs/access.md`). It names the folder, and tells the agent to run `selfie notes` there.

`selfie notes` prints `{ folder, notes[] }`, oldest first, where each note is as above, plus `image`.

- **Must not print a draft, or a message of a note that's still one**, which someone may still be writing. One rule decides what an agent may see, for all that shows it.
- **Must give each note's `image` as the path to a PNG with its box drawn just outside what it's about**, or null if it's about no image, so an agent can see what the person saw.

## Waiting for feedback

`selfie agent-await-feedback [--timeout <seconds>]` blocks until the person sends notes, and prints `{ outcome, folder, notes[] }`, with each note as `selfie notes` prints it, and `new` on each message. Its exit codes are in `docs/specs/cli.md` → Commands.

- **Must offer Send to agent as the primary button only while one is waiting, and say so**, with Copy for agent still offered.
- **Must write a heartbeat to the store while waiting, and treat one older than 6 seconds as nobody waiting**, so the UI goes back to Copy for agent within seconds of an agent dying, and never says someone is listening when nobody is (rationale).
- **Must refuse a second one in the same folder**, and let the next one take over from one that's died.
- **Must refuse to send to an agent that's stopped waiting, and send nothing**, so a person who pressed Send knows.
- **Must give an agent each note with something new once, whole, with what's new marked**, so it has the conversation and can tell what it hasn't seen. An agent's own messages never count as new.
- **Must count a message as received only once it's ready to print**, so what a waiter didn't collect goes to the next one. What's been copied has been handed over, so it goes to nobody.
- **Must exit differently for a timeout and for a signal**, so that something asking again after a timeout can still be stopped (rationale).

## Future

### Replies, and what a new run does

`selfie reply <note> "..." [--run <run>]` answers a note, and the person resolves it or replies. Only a person closes a note. A person's reply is a draft message, which goes with the next batch.

**There's no stacking: the UI shows one run, the newest in this session.**

- When a new run appears, a banner says so and offers to go there. It never switches by itself, so an image can't change while someone is looking at it.
- The diff is still current against golden, and only the newest run shows it.
- Open notes follow their story into the new run, whether or not they've been replied to.
- A story with a note gets one extra layer, **When noted**: the image the note was written on, with its box. That's the one comparison per note. There's no history to step through.
- If a note's image is identical to the new run's, the note says so, so a claimed fix that moved nothing shows at once.
- Decisions need nothing new, since they're on image hashes.

### Scope: remote-notes

Notes in the cloud service, keyed on the pull request and not a folder, and copy and paste only at first. The pasted text has image URLs in place of `selfie notes`. A private repository's only work for someone with access.

Notes are instructions to an agent, so only someone with write access to the repository may send them, since anyone can view a public repository's snapshots.

### Run history

Stepping through a session's earlier runs. They're reachable by URL.
