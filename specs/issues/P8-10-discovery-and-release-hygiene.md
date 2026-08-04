---
title: "#P8-10 — Discovery & release hygiene"
labels: phase-8
milestone: Phase 8 — Growth
status: draft
---

Task **#P8-10** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 8.

## Summary

Close the gap between what ships and what is discoverable. `v1.2.0` is live on npm while GitHub releases stop at `v1.1.1`, so the Cache Scorecard (#124) and the Report Card / Cache Scorecard glossary modals (#127) shipped with no tag and no release notes. Runs first in the sequence — #P6-8's relaunch needs a release page to point at.

## Scope

- Tag and publish GitHub releases for every published npm version that lacks one (`v1.2.0` today; audit the rest).
- Release notes for the untagged work: #124 Cache Scorecard, #127 glossary modals.
- npm `keywords` in `package.json` — currently absent; this is the package's only registry-side discovery surface.
- README restructure: lead with the `npx` one-liner and a screenshot/GIF above the fold. The dashboard image exists but sits below the presentation link.
- Write the release process down (in `CLAUDE.md` or a `RELEASING.md`) so the npm-vs-GitHub drift does not recur.

## Acceptance criteria

- Every published npm version has a matching GitHub tag + release notes.
- npm keywords and README lead with the one-line install.
- The release process is written down so this does not drift again.

## Dependencies

- Depends on: none. Runs first.
- Unblocks: #P6-8 (stargazer relaunch needs a release page).

## References

- Absorbs the remaining scope of **#P6-1**, which is otherwise materially complete — see the 2026-08-04 decisions-log row in `specs/claude-lens-plan.md`.
- `package.json`, `README.md`, `CHANGELOG.md`.
