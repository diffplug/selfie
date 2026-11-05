# Chat

> Status: built, and deployed at `hackathon.selfie.dev`, on one story at a time.
>
> - See `docs/specs/glossary.md` for story, batch, render, and reference.
> - Owns asking a model about a story's change: what it reads, what it says it read, and what it may do. `docs/specs/cloud.md` owns the Worker it's in, and `docs/specs/access.md` the GitHub App it reads through.

Source of truth: `ui/src/worker/chat.ts`, `compare` in `ui/src/worker/github.ts`, `ui/src/shared/chat.ts`, `ui/src/client/ChatPanel.tsx`; tests in `ui/test/workerd/cloud.workerd.test.ts`, with stand-ins for GitHub and the model, and stories in `Parts/Chat`.

## Asking

`POST /:owner/:repo/api/batches/:batchId/chat`, among the review routes but not on `ReviewSource`, takes `{ story, messages }`, with `messages` as `[{ from: "person" | "model", text }]`, taking turns, starting and ending with the person.

- **Must answer anyone, signed in or not**, since every project here is public (rationale).
- **Must keep `pageHeaders` and `sameOriginWrites` on it**, as on any review route (`docs/specs/cloud.md` → Pages).
- **Must ask the `CHAT_LIMIT` binding, set to 10 questions a minute from one address, and answer 429 `too-many-questions` when it refuses.** It's a loose limit, and never a cap on spending (rationale).
- **Must take at most 40 messages, with at most 4,000 characters in a question and 40,000 in an answer, in at most 1 MB**, and answer 400 `bad-request` otherwise.
- **Must offer it only on a hosted story that isn't unchanged.** `selfie ui` has no chat. Any other story is 404 `unknown-story`.

## What the model reads

Each question is worked out afresh, and nothing of a conversation is kept here or at Meta (`store: false`).

- **Must send, in this order, so that the model's cache can match it from one question to the next:** the story, its state, and why it failed if it did; the commits and code; the image last approved, the batch's image, and the stored diff image, as whichever exist, in `data:` URLs; the stored measurements of their differences; and then the conversation.
- **Must read the code since the commit of the batch whose approval made the image the reference**, through `goldenBatchId`.
- **Must read a story with no reference from where its commit left the default branch, or if that's empty, what its commit itself changed.**
- **May keep what it worked out of the code for as long as a Worker lives, for at most 16 pairs of a reference and a commit, least recently used going first.** A story with no reference reads a moving branch through this as well, which at worst shows an earlier merge base.
- **Must leave out lockfiles, generated files, and `dist/`, and what has no text to show, and show the smallest files first, up to 160,000 characters of patches**, so one huge file can't push out many.
- **Must tell the model everything it wasn't shown, by name**, and that GitHub may list no more than 300 files.
- **Must still answer if GitHub can't say**, from the images alone, and tell both the model and the reader so.

## What it says

The body is lines of JSON, as `ChatEvent` in `ui/src/shared/chat.ts`: one `code`, then any number of `text`, and then `done` or `failed`.

- **Must say what code was read**, from which commit to which and how many files, with what was left out, wherever an answer is shown, so nobody takes it for more than it read.
- **Must show a failure before the first piece of an answer as a JSON error**, 502 `model-failed`, and one part way through as `failed`, and never what the model or GitHub said about it, which stays in the log.
- **Must treat a body that ends with neither `done` nor `failed` as a failure**, and go back to before the question, with it ready to ask again, since a conversation goes on only from a whole answer.
- **Must stop reading from the model when whoever asked has gone**, so nothing's paid for that nobody will read.
- **Must log the tokens each question used**, since anyone can spend this key.

## What it may do

- **Must use `muse-spark-1.3`, never a `-contributor` model** (rationale).
- **Must keep `MODEL_API_KEY` only in Worker secrets.**
- **Never give the model a tool.** What it reads is a branch's own code and pixels, so an instruction written there must have nothing to act with (rationale).
- **Must show an answer as plain text**, with no links or images, so an answer can't send anything anywhere when it's shown.
- **Never let an answer approve, reject, or block anything.** What decides doesn't know chat exists.

## Future

**Scope: change-grouping** (`docs/specs/system.md` → Build order) goes on from here. What's left:

- Asking about a whole batch rather than a story, for grouping changed stories by the code that caused them, and flagging what nobody asked for.
- Keeping a conversation, or sharing one by a link.
- Private repositories, which wait for **Scope: github-access**, and a decision on consent (`docs/specs/access.md` → Open questions).
- Chat in `selfie ui`, which has Git, and so doesn't need GitHub.
