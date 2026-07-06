---
title: "#P4-9 — Cache Lab page"
labels: phase-4
milestone: Phase 4 — Pages & features
status: filed
issue: 41
url: https://github.com/foyzulkarim/claude-lens/issues/41
---

Task **#P4-9** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 4.

## Summary
Build the Cache Lab page (pages spec §7): cache economics end-to-end, including the miss-attribution classifier that gate K2 reuses.

## Scope
- *(§7)* Fleet totals + hit-rate histogram/trend, input composition, busts net panel, **miss-attribution classifier (K2 base + TTL-lapse heuristic)**, TTL bucket mix, baseline weight trend, $ saved + counterfactual, invalidation gallery + cost-by-cause trend. The classifier built here is reused by gate K2.

## Acceptance criteria
- matches `cache-lab.html`; classifier has unit tests on fixtures.

## Page contract (pages spec §7)
| Section | Deps | Tier | Notes |
|---|---|---|---|
| Fleet totals, hit-rate histogram + trend over time | T | 🟢 | |
| Input composition bar: reads / writes / uncached share of all input ("X% served from cache") | T | 🟢 | |
| Busts headline + net panel: saved by cache vs lost to busts → NET, net-negative badge per session | T+P | 🟢 | Adds accounting to the existing cause classifier |
| Miss attribution: TTL lapse (idle gap > TTL) vs prefix change (K2 classifier) vs unknown, verdict chip | T | 🟢 | One timestamp heuristic on top of existing classifier |
| TTL bucket mix: 5m vs 1h cache-write split | T (`cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` — verified in real transcripts 2026-07-06) | 🟢 | 5m-heavy mix + idle pattern explains TTL misses |
| Baseline weight trend: first cache-write size per session over time (system prompt + CLAUDE.md + MCP overhead proxy) | T | 🟢 | "Baseline grew 18k the week I added that MCP server" |
| $ saved by cache (+ counterfactual: "uncached this month = $X") | T+P | 🟢 | |
| Invalidation gallery (cause-labeled, → turn) | T+P | 🟢 | |
| Invalidation cost by cause, over time (model-switch vs compaction vs unexplained) | T+P | 🟢 | Turns K2 into a trend |
| Context growth curves overlaid (session DNA small-multiples) | C 🔴; token-approx fallback | 🟡 | |
Spec-vs-mockup gaps to implement from the spec table: Cache Lab — baseline weight trend

## Definition of done (Phase 4 standing rules)
- [ ] Cypress smoke spec: route renders key sections from fixtures; one drill-link lands filtered
- [ ] Component states covered in Storybook (not Cypress)
- [ ] Manual visual sign-off vs `specs/pages/cache-lab.html` on real data; plan checkbox flipped

## Dependencies
- Depends on: P4-8
- Unblocks: P4-10

## References
- [specs/claude-lens-pages.md](../blob/main/specs/claude-lens-pages.md)
- `specs/pages/cache-lab.html` (visual reference, not exhaustive contract)
- `specs/pages/cache-lab.png` — static screenshot of the mockup
