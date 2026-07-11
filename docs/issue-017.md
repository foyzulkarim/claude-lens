# Issue #17 — Linting + formatting

**Plan task:** #P1-5 · **Phase:** 1 · **PR(s):** #63 · **Closed:** 2026-07-11 · [GitHub issue #17](https://github.com/foyzulkarim/claude-lens/issues/17)

Adopted Biome as the single lint+format tool across all three TS roots, wired into CI (#P1-3) and an
npm script. Biome was kept as the default (single fast tool, fits the minimal-tooling ethos) rather
than switching to ESLint + Prettier. Config lives at repo root; `legacy/` excluded.

## Outcome

`npm run lint` and `npm run format:check` pass on the skeleton; a deliberately misformatted file
fails CI — acceptance criteria verified. Last task in Phase 1.
