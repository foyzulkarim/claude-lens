---
title: "#P4-8 — Models page"
labels: phase-4
milestone: Phase 4 — Pages & features
status: draft
---

Task **#P4-8** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Build the Models page (pages spec §6): token/$ split, mix over time, and efficiency by model, with 🟡 latency/throughput fallbacks until #P4-13 upgrades them.

## Scope
- *(§6)* Token/$ split, model mix over time, efficiency ratios, CC-version dimension, entrypoint breakdown; latency/throughput sections render 🟡 fallback (timestamp deltas) until premium (#P4-13) upgrades them.

## Acceptance criteria
- matches `models.html`.

## Page contract (pages spec §6)
| Section | Deps | Tier | Notes |
|---|---|---|---|
| Call-level token & $ split | T+P | 🟢 | |
| Model mix over time (stacked area) — did the new model change my spend profile? | T+P | 🟢 | |
| Efficiency ratios by model: output tokens per $, cache hit %, tokens/turn | T+P | 🟢 | |
| CC-version dimension: spend/token profile before vs after a Claude Code update | T (`version`) | 🟢 | Nobody else can show this |
| $/1k-lines by model | C/L | 🔴 | |
| Latency by model (p50/p90) | C 🔴; fallback timestamp deltas | 🟡 | |
| Throughput: generation tok/s p50/p95 by model | C (output ÷ api_duration) 🔴; coarse timestamp fallback | 🟡 | |
| Entrypoint breakdown: token flow per client (cli / ide / sdk) | T (`entrypoint`) | 🟢 | |
Spec-vs-mockup gaps to implement from the spec table: Models — throughput + entrypoint breakdown

## Definition of done (Phase 4 standing rules)
- [ ] Cypress smoke spec: route renders key sections from fixtures; one drill-link lands filtered
- [ ] Component states covered in Storybook (not Cypress)
- [ ] Manual visual sign-off vs `specs/pages/models.html` on real data; plan checkbox flipped

## Dependencies
- Depends on: P4-7
- Unblocks: P4-9

## References
- [specs/claude-lens-pages.md](../blob/main/specs/claude-lens-pages.md)
- `specs/pages/models.html` (visual reference, not exhaustive contract)
