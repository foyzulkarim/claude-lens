---
title: "#P8-10 — Discovery & release hygiene"
labels: phase-8
milestone: Phase 8 — Growth
status: draft
---

Task **#P8-10** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 8.

## Summary

Keep what ships discoverable. `v1.3.0` restored npm/GitHub release parity and documented the Cache Scorecard (#124) plus Report Card / Cache Scorecard glossary modals (#127). The remaining work improves registry and README discovery and makes that release parity durable. Runs first in the sequence — #P6-8's relaunch needs a credible release page to point at.

## Scope

- Audit and preserve npm/GitHub tag and release-note parity; `v1.3.0` cleared the known backlog.
- Keep major shipped work linked from release notes; `v1.3.0` covers #124 and #127.
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

- Extends the discovery/process work separated from **#P6-1**; #P6-1 closed via #129 and `v1.3.0` no longer contributes release work.
- `package.json`, `README.md`, `CHANGELOG.md`.
