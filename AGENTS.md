# Selfie

Distributed Storybook snapshot testing and agent control surface. See `README.md` for the pitch.

## Specs

A spec is the accurate reference for the current code: it states the invariants and edge cases the code alone does not show. To modify a feature, read its spec first, and when code covered by a spec changes, change the spec.

- **`docs/specs/glossary.md`** — Canonical vocabulary: image, snapshot, run, golden, baseline. Read first; every spec defers to it for names.
- **`docs/specs/system.md`** — The whole system's staged build order, and the behavior that spans the local app and the cloud.
- **`docs/specs/access.md`** — The GitHub App, who can see and change a project, and how images are served. Read first for anything touching auth or visibility.
- **`docs/specs/store.md`** — Image storage: image identity, decoding, keys, hash collisions, and the SQL and blob adapters.

### Conventions

- **What, not why.** A spec says what the code is: each rule once, as a bolded imperative (**Must …**, **Never …**, **May …**), in the spec that owns it. Other mentions are bare pointers to the spec and heading. The why goes in `docs/specs/<foo>.rationale.md`, keyed by the spec's headings and marked `(rationale)` at the rule it backs.
- **What stays.** Keep contracts: what crosses a module, process, or host boundary, and the semantics a caller relies on. Mechanism and presentation live at the code as comments, tests, or stories.
- **The fold.** Everything above `## Future` describes the code as it is, in present tense. Everything unbuilt lives under `## Future`, always the last section.
- **Design-stage specs.** A spec for a component that does not exist yet keeps its whole design under `## Future` and opens with `> Status: design — nothing here is implemented yet.`
- **Named scopes.** A cut is recorded as a named scope in `## Future` (`**Scope: store**`). A scope is defined in exactly one spec; others link it by name.
- **Reservations.** Unbuilt design that constrains present code is stated in the body, marked `Reserved:`, pointing at the `## Future` item it serves.
- **Promotion is part of done.** A staged item is finished only when its text moves above the fold, rewritten to present tense, and the built portion is deleted from `## Future`.
