# Glossary

> Canonical vocabulary for Selfie. Every other spec defers here when naming a concept; pick names from here first.

| Term | Meaning |
|---|---|
| **Image** | One rendered, fully opaque picture, identified by its image hash. Knows nothing about which story produced it. Transparency is never allowed (`docs/specs/store.md`). |
| **Image hash** | The full SHA256 that identifies an image in every store (`docs/specs/store.md`). |
| **Image key** | A store's private integer for an image. Meaningless to any other store. |
| **Snapshot** | A named test case bound to an image: which story was rendered, under which conditions, and what image resulted. |
| **Run** | One recording of a set of snapshots against a Git sha. |
| **Golden** | The snapshot accepted as correct for its name. |
| **Baseline** | The Git sha a run is compared against: the nearest merge-base with a complete set of goldens. |
| **Approval** | A person's or agent's acceptance of a snapshot change. May be made before the change is pushed (`docs/specs/system.md`). |
| **Rejection** | A person's or agent's refusal of a snapshot change. |
| **Decision** | An approval or a rejection, recorded against a snapshot name and an image hash (`docs/specs/snapshots.md`). |
| **Snapshot name** | What identifies a snapshot across runs and stores: its story ID, with any render variant in it, and its environment ID. |
| **Snapshot state** | How a run's snapshot compares with the baseline's goldens: unchanged, changed, new, removed, or failed (`docs/specs/snapshots.md`). |
| **Project** | One GitHub repository's cloud snapshot data, held in its own D1 database. Exists once the GitHub App is installed on that repository (`docs/specs/access.md`). |
| **Store** | One place that holds images and their metadata: a local store on a machine, or a project's cloud store. |
