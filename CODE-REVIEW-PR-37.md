# Review Report

## Metadata

| Field | Value |
|---|---|
| **Review Mode** | Pipeline — ARCH-session-detail-page |
| **Target** | `specs/architecture/ARCH-session-detail-page.md` (issue #37 / P4-5, branch `feat/37/session-detail-page` vs `main`) |
| **Date** | 2026-07-19 07:47 |
| **Tech Stack** | TypeScript (strict), Fastify, React + wouter + TanStack Query, ECharts (hand-rolled wrapper), Vitest, Cypress, Storybook |
| **Checks Run** | task-completion, code-quality, typescript-strictness, security, express-patterns (Fastify), react-patterns, migration, accessibility |
| **Checks Skipped** | performance (deferred to Phase 5 per ARCH), documentation (internal feature), config-dependencies (no new deps confirmed), runtime-behavior/async-patterns (folded into code-quality/react-patterns) |
| **Files Changed** | 51 |
| **Lines Changed** | +7885 / -50 |

## Review Process

- [x] Preflight checks passed
- [x] Diff gathered (51 files, ~7,935 lines — above the 3,000-line auto-scope threshold; flagged and reviewed as one unit at developer's request)
- [x] Tech stack detected: TypeScript/Fastify/React/Vitest/Cypress/Storybook
- [x] Context read (CLAUDE.md, ARCH-session-detail-page.md incl. embedded T1–T11 task specs, issue #37)
- [x] Triage proposed and developer confirmed
- [x] 8 checks dispatched: task-completion, code-quality, typescript-strictness, security, express-patterns, react-patterns, migration, accessibility
- [x] Results collected and deduplicated
- [x] Report compiled
- [x] Verdict determined

## Verdict: ❌ FAIL

The architecture and test discipline are strong overall — security, Fastify route patterns, and the core logical-turn/warm-cache mechanics are clean and well-tested. But five High-severity issues need fixing before merge: a navigation bug that silently drops active filters on turn drill-down, an incomplete client-side response validator that can crash on malformed data, ~45 lines of dead computation in the projector, an untested new turn-distribution code path in a High-risk area, and a keyboard/screen-reader-inaccessible compaction/turn-boundary marker. Two of the Medium findings are explicit ARCH-decision deviations (DataTable/virtualization not used per A9; `ws.ts` edited despite being on two tasks' "Must NOT modify" lists) that should at minimum be acknowledged, if not fixed.

### Finding Counts

| Category | 🔴 | 🟠 | 🟡 | 💭 | ⚠️ |
|---|---|---|---|---|---|
| Task Completion | 0 | 1 | 2 | 0 | 0 |
| Code Quality | 0 | 1 | 3 | 3 | 0 |
| TypeScript Strictness | 0 | 1 | 0 | 2 | 0 |
| Security | 0 | 0 | 0 | 0 | 0 |
| Express/Fastify Patterns | 0 | 0 | 0 | 0 | 0 |
| React Patterns | 0 | 1 | 0 | 0 | 0 |
| Migration | 0 | 0 | 0 | 1 | 0 |
| Accessibility | 0 | 1 | 2 | 0 | 0 |
| **Total** | **0** | **5** | **7** | **6** | **0** |

---

## Task Completion

**REQs:** 6/8 fully verified, 2 partially (R6, R1/R8 — see findings). All 11 tasks (T1–T11) have their required test/checklist evidence except the gap below. Report Card is confirmed absent from UI, contract, and projector (R2 respected).

| # | Sev | File | Issue | Recommendation |
|---|---|---|---|---|
| T-1 | 🟠 High | `server/metrics/engine.ts` (~292–345); `server/metrics/engine.test.ts` (untouched) | T3's test plan requires coverage for "distributes combined logical-turn cost" and "retains sidechain-only activity" on the new `groupLogicalTurns`/`logicalTurnToSyntheticTurn` path added to `entityScopesFor`'s `"turn"` case — a High-risk ("Turn semantics") area. The existing `distributionEntity: "turn"` test only uses turns with distinct `promptId`s, so the merge/fold logic (including an `unreachable` throw branch) is never exercised. **Independently corroborated by the migration check**, which also flagged `sessions.test.ts` as lacking a real main+sidechain trace-merge case. | Add a case to `engine.test.ts` with two turns sharing a `promptId` (one main + one sidechain segment) asserting the distribution merges them into one entity with combined cost, plus a sidechain-only case. Add the analogous case to `sessions.test.ts`'s `buildTrace` tests. |
| T-2 | 🟡 Medium | `client/src/pages/session-detail/TurnsSection.tsx`, `PromptList.tsx` | ARCH decision A9 ("Reuse Chart/DataTable/semantic HTML") and the Change Footprint both name `DataTable.tsx` as the pattern reference for these files; T8/T9 checklists require "virtualized"/"bounded" lists. Neither file imports `DataTable` — both map every row directly with no `useVirtualizer` or row-count bound. `TurnsSection.tsx`'s own comment concedes this ("we render every row..."). Scale risk is per-session (not fleet-wide), so Medium not High. | Either route these lists through `DataTable` per the ARCH spec, or explicitly document this as an intentional ARCH deviation so it isn't rediscovered later. |
| T-3 | 🟡 Medium | `client/src/ws.ts` | Listed as **"Must NOT modify"** in both T5 and T6, and named in the Change Footprint's silent-regression-hotspot table ("key-factory refactoring must preserve this exact behavior" — implying `ws.ts` itself shouldn't need edits). It was in fact edited (`qk.prefixes.session(id)` → `qk.session(id)`) as a necessary consequence of the query-key refactor. Behavior-preserving per `ws.test.ts` (same resulting key), so this is a paperwork violation, not a functional one. | No functional fix needed; correct the T5/T6 "Must NOT modify" lists in the ARCH doc (or note the deviation) so future readers aren't misled. |

---

## Code Quality

| # | Sev | File | Line | Issue | Recommendation |
|---|---|---|---|---|---|
| Q-1 | 🟠 High | `server/session-detail/projector.ts` | ~1103–1210 (`buildWorkflow`) | The function runs two nearly-identical scans over every logical turn. The first loop's outputs (`baseEditCount`, `readFirstCount`, `plannedCount`, `toolNames`, `_hasCommit`) are **entirely discarded** — the second loop re-derives everything into `editTurns[]` and overwrites every variable the first loop set. The first pass has no effect on the return value. | Delete the first loop (~45 lines); keep only the `editTurns` accumulation + cumulative-stage loop. |
| Q-2 | 🟡 Medium | `server/session-detail/projector.ts` | 830–888 (`buildCacheStrip`) | Re-implements the compaction-pointer-walk loop from `buildTimeline` almost verbatim instead of consuming the precomputed `compactionsAfterCall` array passed in as a parameter — which is then discarded via `void compactionsAfterCall[i];` just to silence the unused-param lint. | Either consume `compactionsAfterCall` directly and drop the duplicate loop, or drop the unused parameter if the two panels are meant to diverge. |
| Q-3 | 🟡 Medium | `server/session-detail/projector.ts` | 1017, 1033, 1332, 1341 | `modelForCall` and `callToToolUseIds` are computed/threaded through the pure projector "for future enrichment" (#P4-13) but always called with empty/placeholder data today, then explicitly `void`'d. Speculative plumbing for a feature that doesn't exist yet, contra CLAUDE.md's "don't design for hypothetical future requirements." | Drop both until #P4-13 actually needs them; re-add then. |
| Q-4 | 🟡 Medium | `client/src/api/queryKeys.ts` | 44–49 | `export type { SessionDetailResponse };` re-exports the wire type "so callers don't have to import from a separate path," but no file actually imports it from here — every consumer imports directly from `shared/session-detail-contract.ts`. Dead code that also blurs this module's stated responsibility (query keys, not wire types). | Remove the re-export. |
| Q-5 | 💭 Low | `server/routes/session-detail.ts` | 24 | `Pricer` type is redeclared identically to the existing export in `server/store/derive-session.ts`, which `server/routes/sessions.ts` already imports directly. | Import `Pricer` from `../store/derive-session.js` instead of redefining it. |
| Q-6 | 💭 Low | `client/src/pages/session-detail/CostTimeline.tsx` | 1004 | `formatPercent` is imported but unused; a `void formatPercent;` line exists only to suppress the unused-import lint. | Remove the unused import and the `void` line. |
| Q-7 | 💭 Low | `client/src/pages/session-detail/CacheStrip.tsx` | 587–591, 602 | `CacheRow` computes `eligible` and immediately discards it via `void eligible;`; it plays no role in the actual `width`/`readRatio` calculation. | Delete the dead computation and its `void` statement. |

**Observation (not a finding):** `projector.ts` is 854 lines covering all 9 sections in one file — already past the review's ~1000-line watch threshold. Likely an intentional "one pure projector" choice per the ARCH doc; flagged as a future split candidate, not a required change.

---

## TypeScript Strictness

| # | Sev | File | Line | Issue | Recommendation |
|---|---|---|---|---|---|
| TS-1 | 🟠 High | `client/src/api/session-detail.ts` | 244–327 (`assertSessionDetailResponse`) | The guard is declared `asserts value is SessionDetailResponse` but is materially incomplete: `header.costObserved`, `header.contextPctEstimated`, and `header.drift` (`{delta, pct}`) are never checked; `tier.hasCostSamples`/`hasTurnBoundaries`/`hasCostLog` go unchecked; `turnDistribution` only checks `basis`, not `populationSize`/percentiles/`histogram[]`; `meta` is only checked with `isObject(...)`, none of its fields. Since the contract's whole point is that `undefined` = unavailable is load-bearing, an under-validated response sails through as "safe" — and `format.ts`'s `formatCost` calls `.toFixed(2)` on `drift?.delta` unguarded, so a malformed value here becomes a render-time crash, exactly what the guard exists to prevent. | Add field-level checks for the missing sections, mirroring the rigor already applied to `header`/`workflow`/`tokenFunnel`. |
| TS-2 | 💭 Low | `client/src/api/session-detail.ts` | 209–213 | Redundant `as Record<string, unknown>` casts on `h.tier` right after a `isObject(h.tier)` narrowing that TS already carries through the `if` chain. | Drop the redundant casts. |
| TS-3 | 💭 Low | `client/src/pages/session-detail/SessionDetail.stories.tsx` | 381, 383 | Two non-null assertions on fixture array indices — safe (fixed-length array) and scoped to dev-only Storybook code. | No action required. |

`npm run typecheck` was run against the full diff and passes clean, corroborating the manual scan.

---

## Security

**Result:** ✅ No findings.

Traced the full compact-data path end-to-end: session IDs are used only as an exact `Map` key (never a filesystem path or command), `targetPath`/`bashKind` are captured for internal workflow classification only and never surface in any wire-facing builder (cross-checked against `shared/session-detail-contract.ts`), the warm-cache version gate uses strict allow-list validators (no permissive merge/prototype-pollution surface), the client fetcher URL-encodes the session ID, and prompt text renders via standard JSX interpolation (React-escaped, no `dangerouslySetInnerHTML`). No auth layer is expected or missing — this remains a local, same-origin, no-auth read API by design.

---

## Express/Fastify Patterns

**Result:** ✅ No findings.

Route registration order in `server/app.ts` is undisturbed; Fastify's native async-handler → promise rejection → 500 behavior covers the (fully synchronous, in this case) handler body; 404/200-empty/200-populated status codes are correct and tested; unrelated global-filter query params are silently ignored rather than erroring (no schema to reject them); no double-send paths. `buildFleetBaselines`'s per-request O(sessions+turns) recompute matches the existing `listSessions`/metrics pattern and is already an acknowledged, deferred (Phase 5) scaling tradeoff — not a new finding.

---

## React Patterns

| # | Sev | File | Line | Issue | Recommendation |
|---|---|---|---|---|---|
| R-1 | 🟠 High | `client/src/pages/session-detail/TurnsSection.tsx` | 156–163 | Turn-table drill links build a bare path (`/session/${sessionId}/turn/${turn.turnNumber}`), dropping any active global-filter query string. `AppShell.tsx` already establishes the project's pattern for this (`useSearch()` + conditional `?${search}` append), and the ARCH doc requires "query-preserving navigation" as an explicit T6 test scenario (A12/R3) and T11 jsdom assertion. This component doesn't import `useSearch` at all — every turn drill silently loses the visitor's active filters. | Import `useSearch` from `wouter` and build the href the same way `AppShell` does. |

Hooks-rule compliance, stale-closure risk, and pure-section/no-fetch boundary discipline were otherwise clean across all 11 session-detail components; the `ws.ts` invalidation narrowing to `qk.session(message.sessionId)` correctly avoids over-invalidating other sessions' detail keys.

---

## Migration & Breaking Changes

| # | Sev | File | Issue | Recommendation |
|---|---|---|---|---|
| (see Task Completion T-1) | — | `server/metrics/engine.test.ts`, `server/routes/sessions.test.ts` | Independently corroborates the task-completion finding: the sidechain-merge integration path lacks direct test coverage at these two call sites, though the underlying `groupLogicalTurns`/`aggregateLogicalTurnCost` helpers are well covered elsewhere (`logical-turns.test.ts`, `derive-session.test.ts`). | See T-1's recommendation. |
| M-1 | 💭 Low | `server/ingest/warm-cache.ts` | 179 | `WARM_CACHE_SCHEMA_VERSION` starts at `2` even though this is the first version ever written (no prior `version` field existed). Cosmetic only — `isCacheHeader`'s `typeof` check rejects old headers regardless of the starting number. | None required. |

**Assessment:** Both flagged architectural risk areas hold up. (1) The warm-cache version gate is correctly implemented — a pre-existing cache entry with no `version` field fails the `typeof` check and returns a clean `null` (cache miss), never a silent partial load or a throw; this exact scenario has a dedicated passing test. (2) The turn-counting semantics change (raw derived-turn count → logical-prompt-turn count) is a genuine behavior change, but every identified consumer (`derive-session.ts`, `measures.ts`, `engine.ts`, `sessions.ts`) was updated together in this same diff, and since this is a single-deployable local app with no persisted historical data or separate versioned API clients, there's no "stale consumer silently sees wrong numbers" risk — the ARCH doc already documents the Dashboard/AnomalyFeed trace shifts as an expected, contained side effect.

---

## Accessibility

| # | Sev | File | Line | Issue | WCAG | Recommendation |
|---|---|---|---|---|---|---|
| A-1 | 🟠 High | `CostTimeline.tsx` | 154–195 | Per-call compaction/turn-boundary flags are conveyed only by SVG `<rect>` fill color plus an SVG `<title>` — a mouse-hover-only mechanism, not reachable by keyboard, not reliably exposed to screen readers (no `role`/`tabIndex`). Only an aggregate `Compactions: N` count exists in text; there's no way to identify *which* calls are affected. Inconsistent with every sibling panel on this page, which gives each item its own `aria-label`-bearing list element. | 1.1.1, 1.4.1 | Add a per-bar accessible label (visually-hidden list mirroring `TurnBars`' pattern, or wrap each bar in a focusable element) identifying which specific call is a compaction/turn boundary. |
| A-2 | 🟡 Medium | `TurnsSection.tsx` | 84–125 (`TurnBars`) | Per-turn bar anomaly state is conveyed only by `bg-rose-500` vs. amber fill; neither the `<li>`'s `aria-label` nor the bar's `sr-only` text mentions "anomaly" — that information only exists in the separate `TurnTable` below. Color-only within this specific visualization. | 1.4.1 | Append anomaly state to the bar's own `aria-label` (e.g. `", anomaly"` suffix). |
| A-3 | 🟡 Medium | `Header.tsx` | 58–73, 89–98 | `Stat`'s `<dt>`/`<dd>` render as direct children of a plain `<div>` grid, not inside a `<dl>` — invalid HTML, and the label/value pairing isn't guaranteed to reach assistive tech correctly. The identically-shaped `Stat` helper in `TurnsSection.tsx` correctly wraps its output in `<dl>`; this file is the outlier. | 1.3.1 / 4.1.1 | Wrap the grid container in `<dl>`, matching `TurnsSection.tsx`. |

**Observations (not findings):** `CostTimeline`'s `<fieldset aria-label>` could use a visible `<legend>` instead; several sections duplicate their `<h2>` text as an `aria-label` on the parent (harmless, `TurnsSection`'s `aria-labelledby` pattern is more maintainable); `preserveAspectRatio="none"` on the timeline SVG is a visual-fidelity note, not an a11y one.

---

## Manual Checks Required

- [ ] Manual visual sign-off of the built page against `specs/pages/session-detail.html`/`.png` on real data (T11 DoD item) — not verifiable from a code-only review.
- [ ] Confirm `npm run verify`, `npm run build`, and `npm run test:e2e` all exit 0 — only `typecheck` was run directly by a check agent; the other gates weren't executed as part of this review.

## Prioritized Action Items

### Must Fix (🔴 Critical / 🟠 High)
1. **R-1** — Turn-drill links drop the active filter query string; add `useSearch` handling in `TurnsSection.tsx`.
2. **TS-1** — Complete `assertSessionDetailResponse`'s validation for `meta`, `turnDistribution`, `tier` flags, and `drift`.
3. **Q-1** — Delete `buildWorkflow`'s dead first-pass loop in `projector.ts`.
4. **T-1** — Add sidechain-merge test coverage to `engine.test.ts` (and ideally `sessions.test.ts`).
5. **A-1** — Give compaction/turn-boundary markers in `CostTimeline.tsx` a non-hover, non-color-only accessible label.

### Should Address (🟡 Medium)
- **T-2** — Reuse `DataTable` for `TurnsSection`/`PromptList`, or explicitly document the A9 deviation.
- **T-3** — Correct the ARCH doc's T5/T6 "Must NOT modify" lists re: `ws.ts` (functionally fine, paperwork mismatch).
- **Q-2, Q-3, Q-4** — Dedupe `buildCacheStrip`'s compaction loop; drop speculative `modelForCall`/`callToToolUseIds` plumbing; remove dead `queryKeys.ts` re-export.
- **A-2, A-3** — Add anomaly text to `TurnBars` labels; wrap `Header.tsx` stats in `<dl>`.

### Nice to Have (💭 Low)
- **Q-5, Q-6, Q-7** — Dead `Pricer` redeclaration, dead `formatPercent` import, dead `eligible` computation.
- **TS-2, TS-3** — Redundant cast; dev-only non-null assertions in stories.
- **M-1** — Cosmetic warm-cache version numbering.

---
*Generated by Review — 2026-07-19 07:47*
