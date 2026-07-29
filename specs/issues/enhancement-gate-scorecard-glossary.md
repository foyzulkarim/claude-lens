---
title: "feat: explain Report Card / Cache Scorecard jargon via info modals"
labels: enhancement
status: filed
issue: 126
url: https://github.com/foyzulkarim/claude-lens/issues/126
---

## What & why

The Report Card (Session Detail) shows bare gate codes (`V1`, `K2`, ...) and raw evidence
strings with no legend, and the Cache Scorecard has the same problem ("Hygiene B", "waste
ratio", "prefix bust"). A first-time viewer has no way to know what a code means, why it
matters, or what the score/grade represents. This adds a reusable "?" info-modal affordance
plus inline human-readable gate labels so both sections are self-explanatory without
leaving the page.

## Acceptance

- Report Card: each gate row shows an inline label (e.g. "V1 · Edit-without-verify") next
  to the bare code, plus a "?" opening a modal with what the gate checks, why it matters,
  and (where applicable) the session's actual configured threshold.
- Report Card: the overall score badge has a "?" explaining the score formula and letter
  bands.
- Cache Scorecard: the grade badge has a "?" explaining the hygiene formula and this
  session's actual resolved grade-band cutoffs.
- Cache Scorecard: the `warmup`/`incremental`/`rewritten`/`waste ratio`/`hit ratio` metrics
  each have a "?" description (`cache reads` excluded as self-explanatory).
- Cache Scorecard: one shared "?" on the "Waste events" heading explains all four
  waste-event kinds (`prefix-bust`, `duplicated-warmup`, `idle-expiry`, `unattributed`)
  rather than repeating the same explanation on every event row.
- New `InfoModal`/`InfoButton` components are dependency-free, accessible (`role="dialog"`,
  Escape/backdrop-click to close, focus trap, focus returns to the trigger on close), and
  reusable on other pages later (Sessions/Projects gate columns are explicitly out of
  scope for this issue).
- `npm run verify` (typecheck → lint → format:check → test) passes.

## References

- `specs/gates.md` — source of truth for the gate rules/thresholds paraphrased in the
  glossary content.
