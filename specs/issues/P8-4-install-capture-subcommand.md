---
title: "#P8-4 — claude-lens install-capture subcommand"
labels: phase-8
milestone: Phase 8 — Growth
status: draft
---

Task **#P8-4** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 8.

## Summary

Promote `capture/install.sh` to a first-class subcommand. Today an `npx` user who wants 🟢 observed values must open Settings, read the resolved capture directory out of the cost-capture guide, and run a shell script from a path they never chose — the narrowest point in the tier-upgrade funnel, and the reason most installs never leave 🟡.

## Scope

- New `install-capture` subcommand wrapping the same installer already vendored into `dist/capture/` (resolved the same way `server/capture-assets.ts` resolves it for `/api/capture-assets`).
- Preserves every property of the shell script: idempotency, the `settings.json.backup-<timestamp>` write, the "already configured" no-op path, and the exit-code contract (0 installed-or-already-configured; 1 node missing / settings unparseable / write failed).
- `capture/install.sh` keeps working unchanged — this wraps it, it does not replace it. The manual path documented in `capture/README.md` also stays.
- Settings page's `CostCaptureGuide.tsx` and the README both point at the subcommand as the primary instruction, with the script as the fallback.

## Acceptance criteria

- `npx @foyzulkarim/claude-lens install-capture` performs the same install as `bash capture/install.sh` including idempotency, the `settings.json` backup, and the already-configured no-op path.
- The Settings guide and README point at the subcommand.
- The shell script keeps working unchanged.

## Dependencies

- Depends on: none blocking.
- Unblocks: #P8-5 (the plugin bundles this).

## References

- `capture/install.sh`, `capture/merge-settings.cjs` — the behaviour to preserve exactly.
- `server/capture-assets.ts`, `server/routes/capture-assets.ts` — existing dist-path resolution.
- `client/src/pages/settings/` — `CostCaptureGuide.tsx`.
- `AGENTS.md` — capture scripts stay synchronous, failure-tolerant CommonJS; do not apply server async conventions.
