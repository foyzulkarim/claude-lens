---
title: "#P8-9 — GitHub Action: per-PR token cost comment"
labels: phase-8
milestone: Phase 8 — Growth
status: draft
---

Task **#P8-9** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 8.

## Summary

A published action wrapping #P8-3's headless report that comments a branch's token/cost summary and top levers on a pull request. Org-visible, recurring, and it runs `npx` on every PR.

## Scope

- Action consumes `claude-lens report --format md` (and the versioned `--format json` for any structured output).
- Posts one comment per PR; re-runs **update** the existing comment rather than stacking new ones.
- No-ops cleanly when no transcripts are present in the runner — the common case for a repo whose contributors do not commit transcripts. The action must be a silent pass, not a red X.
- Documented setup that does not require secrets beyond the default `GITHUB_TOKEN`.

## Acceptance criteria

- The action runs on a PR and posts a summary comment sourced from `claude-lens report --format md`.
- Re-runs update the existing comment rather than stacking.
- It no-ops cleanly when no transcripts are present.

## Dependencies

- Depends on: #P8-3.

## References

- `.github/workflows/ci.yml` — existing workflow conventions.
- **Open question for scoping:** where the runner gets transcripts from. Options are a committed redacted export (#P8-6), an artifact upload from a prior job, or restricting the action to self-hosted runners. Resolve before implementation — this determines whether #P8-9 actually depends on #P8-6.
