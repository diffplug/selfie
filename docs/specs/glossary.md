# Glossary

> Canonical vocabulary for Selfie. Every other spec defers here when naming a concept; pick names from here first.

| Term | Meaning |
|---|---|
| **Image** | The pixel data: one rendered, fully opaque picture, identified by its image hash. Knows nothing about which story produced it. Transparency is never allowed (`docs/specs/store.md`). |
| **Image hash** | The full SHA256 that identifies an image in every store, as far as the clients sending it are honest and working (`docs/specs/store.md` → Image identity). |
| **Image key** | A store's private integer for an image. Meaningless to any other store. |
| **Render** | An image associated with a story, because it was generated for that story in a batch, and making one. A story's newest render is the one from the newest finished batch at HEAD that has it (`docs/specs/ui.md` → Screens). |
| **Environment** | What decides the pixels apart from the project's own input: the runner, its architecture, the browser and its flags, the viewport and scale, and the render recipe (`docs/specs/system.md`). Its ID is part of a render's name. |
| **Render batch** | The record of the process that rendered a set of images, against a Git sha. `batch` for short. |
| **Golden** | The render accepted as correct for its name. |
| **Baseline** | The Git sha whose goldens a batch is held to: the nearest merge-base with a complete set of goldens. |
| **Branch goldens** | With no baseline, the nearest goldens on a batch's own branch, which it's shown against. Only to look at: never a baseline (`docs/specs/cli.md` → Review). |
| **Note** | What a person says about a story, for an agent to act on: on an image, and maybe a box of it (`docs/specs/feedback.md`). |
| **Session** | Whose notes these are: a local Git worktree's top folder (`docs/specs/feedback.md`). |
| **Approval** | A person's or agent's acceptance of a render change. May be made before the change is pushed (`docs/specs/system.md`). |
| **Rejection** | A person's or agent's refusal of a render change. |
| **Decision** | An approval or a rejection, recorded against a render name and an image hash (`docs/specs/renders.md`). |
| **Render name** | What identifies a render across batches and stores: its story ID, with any render variant in it, and its environment ID. |
| **Render state** | How a batch's render compares with the baseline's goldens: unchanged, changed, added, removed, or failed (`docs/specs/renders.md`). |
| **Project** | One GitHub repository's cloud render data, held in its own D1 database. Exists once the GitHub App is installed on that repository (`docs/specs/access.md`). |
| **Store** | One place that holds images, their metadata, and built Storybooks: a local store on a machine, or a project's cloud store. |
| **Hosted Storybook** | The Storybook `selfie ui` serves on an origin of its own: the built directory, and each kept built Storybook (`docs/specs/access.md` → Local review server). |
| **Built Storybook** | The finished output of building a Storybook, which is what Selfie hosts and renders. It's named by the hash of its files, and kept so a batch's stories can still be opened (`docs/specs/store.md` → Built Storybooks). "Build" alone only ever means the verb, or the command that does it. |
