# Review Report — PR #111

## Metadata

| Field | Value |
|-------|-------|
| **Review Mode** | PR #111 |
| **Target** | https://github.com/foyzulkarim/claude-lens/pull/111 |
| **Branch** | `feat/46/data-health-page` → `main` |
| **Date** | 2026-07-23 |
| **Tech Stack** | TypeScript (strict), Fastify, React + wouter + TanStack Query, hand-rolled ECharts wrapper, Biome (lint/format), Vitest, Cypress |
| **Checks Run** | code-quality, typescript-strictness, test-coverage, react-patterns, error-handling, accessibility, performance, security, migration |
| **Checks Skipped** | database-patterns (no DB), express-patterns (Fastify, not Express), config-dependencies (no new deps), task-completion (no ARCH-46.md), async-patterns (overlap with error-handling), runtime-behavior (overlap with performance) |
| **Files Changed** | 48 |
| **Lines Changed** | +2305 / -185 |

## Review Process

- [x] Preflight checks passed (`git` inside repo, `gh` v2.96.0 authenticated, default branch = `main`)
- [x] Diff gathered (48 files, 2305/185)
- [x] Tech stack detected: TS strict + Fastify + React + wouter + TanStack Query + ECharts (no `echarts-for-react`)
- [x] Context read (CLAUDE.md, PR description, page/architecture specs §9, ARCH-data-health-page.md)
- [x] Triage proposed and developer confirmed ("agree")
- [x] 9 checks dispatched in parallel
- [x] Results collected and deduplicated (overlaps merged by root cause)
- [x] Report compiled
- [x] Verdict determined

## Verdict: ❌ REQUEST CHANGES

Two **🔴 Critical** items, six **🟠 High** items, and two **Phase 4 DoD gaps** (Storybook states not runnable, Cypress doesn't drill). The PR is well-structured and most findings are addressable in tight, scoped changes, but the type-safety holes at persisted-data boundaries and the missing DoD coverage need to land before merge. Path forward is clear and the changes are small.

### Finding Counts

| Category | 🔴 | 🟠 | 🟡 | 💭 | ⚠️ |
|----------|-----|-----|-----|-----|-----|
| code-quality | 0 | 1 | 2 | 6 | 0 |
| typescript-strictness | 2 | 0 | 2 | 0 | 1 |
| test-coverage | 0 | 6 | 3 | 0 | 0 |
| react-patterns | 0 | 1 | 0 | 0 | 0 |
| error-handling | 0 | 0 | 1 | 3 | 0 |
| accessibility | 0 | 0 | 6 | 0 | 0 |
| performance | 0 | 2 | 4 | 4 | 0 |
| security | 0 | 0 | 0 | 0 | 0 |
| migration | 0 | 0 | 0 | 1 | 2 |
| **Total** | **2** | **8** | **18** | **14** | **3** |

(Cross-agent duplicates were merged by root cause before counting. Security review came back clean — no findings.)

---

## Cross-Cutting Findings (flagged by ≥ 2 agents)

These are the structural issues worth tackling first — each one was independently observed and traces back to a single root cause.

### X-1. `aria-labelledby` IDs are dangling — `SectionHeader.tsx` never assigns an `id` to its `<h2>`

**Flagged by:** react-patterns #1 (High), accessibility #1 (Medium), accessibility #2/#3 (Medium, related)

**Root cause:** Every panel renders `<section aria-labelledby="data-health-…-title">` but `SectionHeader`'s `<h2>` carries no `id`. The references resolve to nothing — screen-reader users lose section landmarks for every card on the page.

**Fix (one place):** Hoist the `<section>` into `SectionHeader` itself, derive the heading `id` from `slug(title)`, and let panels drop their own `aria-labelledby`. Roughly 15 lines of change in `SectionHeader.tsx` plus removing the redundant `aria-labelledby` from each panel.

### X-2. Cold-boot `/api/health` event-loop block — `getHealthSnapshot` calls `recompute()` per session without try/catch or yield

**Flagged by:** error-handling #1 (Medium), performance P-003 (Medium), performance P-001 (High), code-quality Q-002 (High), code-quality Q-008 (Low), test-coverage #1/#2 (High)

**Root cause:** `Store.getHealthSnapshot` (store.ts:527–651) walks `this.sessions`, calls `this.recompute(sessionId)` synchronously for every null-state session, AND `pipeline.getStats()` independently calls `store.listSessions()` which triggers the same recomputes. So one bad session blanks the whole page (the architecture rule says `/api/health` "must never throw on partial data") AND every `/api/health` request does two sweeps.

**Fix:** Wrap per-session body in try/catch mirroring `buildSearchSnapshot` (lines 877–898 — the precedent is already in the same file). Compute `transcriptsParsed` inside the snapshot loop and pass it back via the `PipelineStats` callback return value, dropping the redundant `listSessions()` call.

### X-3. `TRANSCRIPT_FAILED_POLL_THRESHOLD` is dead — exported, documented, never used

**Flagged by:** code-quality Q-001 (Low), error-handling #4 (Low), performance P-007 (Low)

**Root cause:** `pipeline-stats.ts:31` exports `= 5` with a JSDoc that promises "polled ≥ 5 times with `state.calls.length === 0`", but `pipeline.getStats()` (line 94–104) computes `transcriptsFound - transcriptsParsed` with no threshold. So every freshly-discovered session with zero calls (cold boot, slow tail) immediately reports as "failed" — Data Health §2 will show "1 failed" the moment the server starts.

**Fix:** Either wire the threshold into `getStats()` (track per-path poll counts) or delete the constant and reword the JSDoc. Lowest-cost fix is delete + reword.

### X-4. Panel className duplicated 8× across 7 files

**Flagged by:** code-quality Q-005 (Medium)

**Root cause:** Every panel renders `<section aria-labelledby="…" className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]">`. The dark-theme magic hex and the section/aria-labelledby convention are repeated identically. Future theme tweaks land in 8 places.

**Fix:** Extract a `<Panel>` wrapper into `client/src/components/` that owns the `<section>`, the className, and the `aria-labelledby` convention. Subsumes X-1 (one fix, two birds).

### X-5. JSON.parse / cache-deserialize cast with `as unknown as` at persistence boundaries

**Flagged by:** typescript-strictness #1 (Critical), typescript-strictness #2 (Critical)

**Root cause:** In `server/ingest/warm-cache.ts:191, 195, 199, 203` (deserializing persisted cache records) and `server/ingest/parse-transcript.ts:370, 374, 381` (raw JSONL line variants), the code casts with `as unknown as` to internal types after partial-shape checks. The security review verified runtime guards (`toStr`/`toNum`/`typeof` checks) are present and no prototype-pollution vector exists — so this is a **type-system hole, not a runtime vulnerability**. But the persisted-cache trust boundary deserves full discriminated narrowing.

**Note:** The pattern is **pre-existing in this codebase** (warm-cache.ts and parse-transcript.ts existed before #P4-14). The PR extends the pattern with new fields rather than introducing it. Recommendation: fix as a focused follow-up PR rather than expanding this PR's scope — but flag it now and note it as a tracked issue.

### X-6. Tier states render as raw emoji instead of `TierBadge`

**Flagged by:** accessibility #2 (Medium), accessibility #5 (Medium, partial overlap)

**Root cause:** Each panel renders the tier as a raw colored-circle emoji (`🟢`/`🟡`/`🔴`) rather than the project's `TierBadge` component, which hides the decorative emoji and emits screen-reader labels `exact` / `estimated` / `locked`. The locked reconciliation branch has no tier badge at all. The architecture specifies that tiers must be both visible and machine-readable — currently only visible.

**Fix:** Use `<TierBadge tier="…">` from the existing component library in every panel. Affects all 7 panel files.

### X-7. `costLogTotal: undefined` is the only nullable field on `HealthSnapshot`

**Flagged by:** code-quality Q-004 (Medium), migration ⚠️ Manual #2 (Manual)

**Root cause:** The shared contract doc says "missing data is represented as zero counts / empty arrays, never `undefined`" — then carves out one exception (`reconciliation.costLogTotal` when L is absent). Every renderer has to special-case this one field. Worse, the client test fixtures use `costLogTotal: 12.99` while the server hard-codes `undefined` (see test-coverage #2) — so client and server are out of sync.

**Fix:** Pick one: (a) thread the L total via the pipeline and represent absence as `null`; (b) represent absence as `0` with an adjacent `hasCostLog: boolean`; (c) drop the field from this PR's wire shape until L plumbing exists. The Data Health page renders fine without it.

---

## Per-Check Findings (unique items)

### code-quality

| # | Severity | File | Issue |
|---|----------|------|-------|
| Q-002 | 🟠 High | `server/store/store.ts:527-651` | God function — `getHealthSnapshot` owns 7 unrelated rollups in one 125-line method with 11 local counters. Extract one helper per rollup; `getHealthSnapshot` becomes a composer. Subsumes perf P-001/P-003/P-005 if done together. |
| Q-004 | 🟡 Medium | `shared/health-contract.ts:139` | `costLogTotal: undefined` contract asymmetry. See X-7. |
| Q-005 | 🟡 Medium | `client/src/pages/data-health/*.tsx` (8 sites) | Panel className duplicated 8×. See X-4. |
| Q-001 | 💭 Low | `server/pipeline-stats.ts:31` | Dead `TRANSCRIPT_FAILED_POLL_THRESHOLD` constant. See X-3. |
| Q-003 | 💭 Low | `server/store/store.ts:607-609` | Redundant `this.pricing &&` inside ternary's filter callback — bind to local. |
| Q-006 | 💭 Low | `server/cli.ts:142-171` | `metadataWithScanRoots` spread is unnecessary — `scanRoots` is already a `RuntimeMetadata` field. |
| Q-007 | 💭 Low | `client/src/pages/data-health/PricingCoverageTable.tsx:18-83` | Two near-identical `<section>` branches for empty vs populated. Render `<section>` once, branch only on body. |
| Q-008 | 💭 Low | `server/ingest/pipeline.ts:99` + `server/store/store.ts:561-595` | Redundant `listSessions()` per `/api/health`. See X-2. |
| Q-009 | 💭 Low | `client/src/pages/data-health/ScanCoverage.tsx:15` | File is `ScanCoverage.tsx` but export is `ScanCoveragePanel`. Either rename file or export. |
| Q-010 | 💭 Low | `client/src/pages/data-health/DataHealth.test.tsx` + `DataHealth.stories.tsx` | `emptySnapshot()` / `populatedSnapshot()` defined twice. Extract to `DataHealth.fixtures.ts`. |

### typescript-strictness

| # | Severity | File | Issue |
|---|----------|------|-------|
| TS-1 | 🔴 Critical | `server/ingest/warm-cache.ts:191, 195, 199, 203` | Persisted-cache deserializer casts with `as unknown as` after partial-shape checks. Pre-existing pattern extended by this PR. See X-5. |
| TS-2 | 🔴 Critical | `server/ingest/parse-transcript.ts:370, 374, 381` | Raw JSONL line variants cast with `as unknown as` after `isRecord` + `type` check. Pre-existing pattern. See X-5. |
| TS-3 | 🟡 Medium | `client/src/api/health.ts:22` | `response.json()` cast directly to `HealthSnapshot` without runtime validation. Add a type guard or use the project's response-validation pattern. |
| TS-4 | 🟡 Medium | `client/src/ws.ts:52` | `new WebSocket(url) as unknown as WsLike` — adapter object preferred over double assertion. |
| TS-5 | ⚠️ Manual | `server/ingest/warm-cache.ts:63-64` | `isCacheHeader` uses a double assertion to read `version`; avoidable. |

### test-coverage

| # | Severity | File | Issue |
|---|----------|------|-------|
| TC-1 | 🟠 High | `server/ingest/parse-transcript.ts` + `warm-cache.ts` + `server/store/store.ts` | New health-counter path (`rawLines`, `skippedLines`, append/accumulate/truncate/reset) has zero non-zero behavioral coverage — every test value is 0. Adding fixtures wouldn't catch a regression. |
| TC-2 | 🟠 High | `server/store/store.ts` + `server/routes/health.ts` + `server/app.ts` | No route integration test asserts any of the new public `/api/health` fields or the `scanRoots`/`pipelineStats` wiring. Existing health tests assert only legacy premium-file fields; client tests use hand-authored snapshots. **This is why client and server have drifted on `costLogTotal`.** |
| TC-3 | 🟠 High | `server/ingest/pipeline.ts` + `server/pipeline-stats.ts` | `getStats()` has no test; in particular, no test pins the documented "5 polls before failure" threshold behavior. The threshold is unused (see X-3). |
| TC-4 | 🟠 High | `server/ingest/parse-premium.ts` + `server/store/reconcile-premium.ts` | `prompt_id`, `promptIdMismatchCount`, `unbucketedTailCount` have zero assertions. Regressions in matching, missing-field handling, invalid timestamps, no-call sessions, boundary inclusivity, or large sample volumes would pass unnoticed. |
| TC-5 | 🟠 High | `client/src/pages/data-health/DataHealth.stories.tsx` + `DataHealth.tsx` | **Storybook stories are not runnable.** `DataHealth` always calls `useHealthQuery()` and the stories provide no `QueryClientProvider`. Direct render throws `No QueryClient set`. **Phase 4 DoD blocker** — "Component states covered in Storybook (not Cypress)". |
| TC-6 | 🟠 High | `cypress/e2e/data-health.cy.ts:14-36` | **Cypress smoke never clicks a drill link.** No click or URL assertion. **Phase 4 DoD blocker** — "Cypress smoke spec: route renders key sections from fixtures; one drill-link lands filtered". |
| TC-7 | 🟡 Medium | `cypress/e2e/data-health.cy.ts` | Cypress only checks static section headings. Would pass even if all fixture-derived counts were zero or wrong. Premium branch is dead (runs only in `premium-tier.cy.ts`). |
| TC-8 | 🟡 Medium | `client/src/pages/data-health/DataHealth.test.tsx:93-141` | `getAllByText("21").length > 0` does not prove Found/Parsed correctness. Missing: malformed-file row, non-empty all-red state, fetch-error branch. |
| TC-9 | 🟡 Medium | `client/src/pages/data-health/DataHealth.test.tsx:87-90, 136-139` | `vi.clearAllMocks()` leaves the never-resolving loading mock installed. Future tests inherit it. Use `mockReset()` + default `mockResolvedValue` in `beforeEach`. |

### react-patterns

| # | Severity | File | Issue |
|---|----------|------|-------|
| RP-1 | 🟠 High | `client/src/pages/data-health/SectionHeader.tsx` + all 7 panels | Dangling `aria-labelledby`. See X-1. |

**Low-confidence observations (not standalone findings):**
- `DataHealth.tsx:35` — test-seam still fires the query even when `snapshot` is injected; consider `enabled: !injectedSnapshot`.
- `format.ts:33` — POSIX-only `basename` (pre-existing, low risk on macOS/Linux).
- `DataHealth.tsx:37-38` — truthy check on `injectedSnapshot` is intentional but should be documented.
- No page-level `<ErrorBoundary>` — latent risk, not a current bug.

### error-handling

| # | Severity | File | Issue |
|---|----------|------|-------|
| EH-1 | 🟡 Medium | `server/store/store.ts:565` | `getHealthSnapshot` calls `recompute(sessionId)` per session with no try/catch. See X-2. |
| EH-2 | 💭 Low | `server/ingest/pipeline.ts:140-156` | `readPremiumFile` silently `return`s on stat/readFile failures. Adopt `warnedOnSaveFailure` once-gate pattern from `warm-cache.ts:232`. |
| EH-3 | 💭 Low | `server/ingest/discovery.ts:84-86` | `discover()` swallows fast-glob errors per root with no log. |
| EH-4 | 💭 Low | `server/pipeline-stats.ts` + `pipeline.ts:94-104` | `TRANSCRIPT_FAILED_POLL_THRESHOLD` dead. See X-3. |

### accessibility

| # | Severity | File | Issue |
|---|----------|------|-------|
| A11Y-1 | 🟡 Medium | `SectionHeader.tsx` + all panels | Dangling `aria-labelledby`. See X-1. |
| A11Y-2 | 🟡 Medium | All 7 panels | Tier emoji used directly instead of `TierBadge`. See X-6. |
| A11Y-3 | 🟡 Medium | `PricingCoverageTable.tsx`, `ParseErrorsPanel.tsx` | Tables lack `<caption>` and `scope="col"` headers. |
| A11Y-4 | 🟡 Medium | `PricingCoverageTable.tsx`, `ParseErrorsPanel.tsx` | Fixed-height scroll regions not focusable (`tabIndex={0}` needed for keyboard-only users to scroll). |
| A11Y-5 | 🟡 Medium | All panels with amber warning text | Light-theme `text-amber-600` on white ≈ 3.19:1, misses 4.5:1. Dark theme passes. |
| A11Y-6 | 🟡 Medium | `client/src/pages/data-health/DataHealth.tsx:39-56, 70-92` | Loading/failure/WS-refetch transitions have no live-region announcements. |

### performance

| # | Severity | File | Issue |
|---|----------|------|-------|
| P-001 | 🟠 High | `server/ingest/pipeline.ts:94-104` | `getStats()` triggers full `recompute()` per null-state session via `listSessions()`; then `getHealthSnapshot()` walks `sessions` again. Two sweeps per `/api/health`. See X-2. |
| P-002 | 🟠 High | `server/store/reconcile-premium.ts:264-273` | `unbucketedTailCount` is O(samples × turns). Marathon session with 10k samples performs ~10M comparisons per `recompute`. Sort `turnRanges` once by `startMs`, scan with pointer (mirrors boundary-mismatch pass at 380-391). |
| P-003 | 🟡 Medium | `server/store/store.ts:561-595` | Cold-boot `/api/health` blocks event loop on sum of recompute costs. Yield with `setImmediate` every N sessions, or let the debouncer drain cold-boot before first request. See X-2. |
| P-004 | 🟡 Medium | `server/store/reconcile-premium.ts:182-193` | `Date.parse` inside sort comparator — ~2·K·log₂K parses per reconcile for K samples. Pre-parse once into `{ms, original, key}` tuples. |
| P-005 | 🟡 Medium | `server/store/store.ts:543-604` | Unconditional `Map`/`Set` allocation per request for `malformedByFile` and `modelsSeen` even when empty. Lazy-allocate. |
| P-006 | 🟡 Medium | `server/ingest/parse-transcript.ts:436-445 + 353` | Double `trim()` per non-blank line. Accept already-trimmed input. |
| P-007 | 💭 Low | `server/pipeline-stats.ts` + `pipeline.ts:94-104` | Dead threshold constant. See X-3. |
| P-008 | 💭 Low | `server/store/store.ts:578-580` | Inner `for (const call of state.calls)` runs unconditionally per session. |
| P-009 | 💭 Low | `server/store/reconcile-premium.ts:182, 187` | `[...calls].sort(...)` / `[...samples].sort(...)` allocate per reconcile even on already-sorted input. Cache sorted view on `state`. |
| P-010 | 💭 Low | `server/store/store.ts:605-609` | `[...modelsSeen].sort()` always allocates; not consumed when `pricing === undefined`. |

### security

**Clean.** No findings. The aggregate endpoint, JSON.parse paths, prototype-pollution probes, path-traversal surfaces, and WS invalidation expansion were all reviewed and cleared. The unauthenticated `/api/health` and absolute-path exposure in `parseErrors.byFile[].filePath` / `scan.roots` are intentional per architecture (local-first; matches the pre-existing #P4-13 `PremiumFileHealth.filePath` precedent documented in `shared/health-contract.ts`).

### migration

| # | Severity | File | Issue |
|---|----------|------|-------|
| M-1 | 💭 Low | `server/routes/health.ts:25` | Comment "older callers without options still return the legacy four fields" is misleading — wire shape is always the full 11-field `HealthSnapshot`; options only affect `scan` sub-field values. Update comment. |
| M-2 | ⚠️ Manual | `shared/health-contract.ts:26-32` | If `/api/health` is consumed by external tooling, document the additive wire-shape growth. No internal consumers use strict JSON schemas — verified. |
| M-3 | ⚠️ Manual | `server/store/store.ts:612-614` | `scan.transcriptsFailed` silently falls back to `max(0, found - parsed)` = `0` when no `pipelineStats` callback is provided. Test paths without CLI wiring see misleading "0 failed". Document the fallback or require `pipelineStats`. |

**No breaking changes** — all existing routes, CLI flags, env vars, and WS message types are unchanged. The `HealthSnapshot` grew additively; all 4 legacy fields are still required-and-present.

---

## Manual Checks Required

- [ ] **Visual sign-off vs `specs/pages/data-health.html`** — issue acceptance criteria require manual visual diff. Real-data load + 🔴 placeholder rendering + drill-link focus order.
- [ ] **Phase 4 DoD**: confirm Storybook states run after TC-5 fix (empty, transcript-only, premium, all-red).
- [ ] **Phase 4 DoD**: confirm Cypress drill-link lands filtered after TC-6 fix.
- [ ] **`getHealthSnapshot` warm-up behavior**: on real data with cold boot, does the page render within an acceptable window, or does the first request block the event loop? (P-003 + X-2)
- [ ] **Marathon-session regression**: does `unbucketedTailCount` stay performant on a real 12-hour session with ~10k C samples? (P-002)

---

## Prioritized Action Items

### Must Fix (🔴 Critical / 🟠 High)

1. **X-2 — `getHealthSnapshot` doesn't wrap per-session `recompute()` and double-sweeps via `listSessions()`** *(error-handling #1, performance P-001/P-003, code-quality Q-002/Q-008, test-coverage #1/#2)*. Mirror the `buildSearchSnapshot` try/catch pattern; compute `transcriptsParsed` in the snapshot loop and thread it back via the `PipelineStats` callback. One fix, multiple birds.
2. **X-3 — `TRANSCRIPT_FAILED_POLL_THRESHOLD` is dead code** *(code-quality Q-001, error-handling #4, performance P-007)*. Either wire it in or delete it + reword JSDoc.
3. **P-002 — `unbucketedTailCount` O(samples × turns) on marathon sessions** *(performance P-002)*. Sort `turnRanges` by `startMs` and use a scanning pointer — same shape as the existing boundary-mismatch pass.
4. **X-1 — Dangling `aria-labelledby` IDs** *(react-patterns #1, accessibility #1)*. Hoist `<section>` into `SectionHeader`, derive heading id from `slug(title)`, drop redundant `aria-labelledby` from panels.
5. **TC-5 — Storybook stories are not runnable** *(test-coverage #5)*. Add `QueryClientProvider` + router decorator; add empty/transcript-only/premium stories. **Phase 4 DoD blocker.**
6. **TC-6 — Cypress never clicks a drill link** *(test-coverage #6)*. Add fixture-backed drill action, assert destination path + query param + filter chip. **Phase 4 DoD blocker.**
7. **TC-1, TC-2, TC-4 — Missing behavioral coverage** *(test-coverage #1/#2/#4)*. Add mixed-counter parser batch + tail append + cache round-trip + `resetSession` tests (TC-1); full route integration test for `/api/health` covering transcript, C/B/L, pricing, roots, pipeline stats (TC-2); parser + reconciliation tests for `prompt_id`/`promptIdMismatchCount`/`unbucketedTailCount` (TC-4).
8. **X-5 — `as unknown as` casts at persistence boundaries** *(typescript-strictness #1/#2)*. Pre-existing pattern, but flagged. Recommendation: fix as a focused follow-up PR with a tracked issue; or scope-bump this PR.

### Should Address (🟡 Medium)

9. **X-4 — Panel className duplicated 8×** *(code-quality Q-005)*. Extract `<Panel>` wrapper. (Subsumes X-1 if done together.)
10. **X-6 — Tier emoji used directly instead of `TierBadge`** *(accessibility #2)*. Replace with `<TierBadge tier="…">`.
11. **X-7 — `costLogTotal: undefined` contract asymmetry** *(code-quality Q-004, migration ⚠️ #2)*. Pick one: null + pipeline wiring, `0` + `hasCostLog` flag, or drop from this PR.
12. **A11Y-3, A11Y-4, A11Y-5, A11Y-6** — table captions + `scope`, scroll-region `tabIndex`, light-theme amber contrast, WS live-region announcements.
13. **P-004** — `Date.parse` in sort comparator.
14. **P-005, P-006** — lazy Map/Set allocation, double `trim()`.
15. **TS-3, TS-4** — runtime validation on `fetchHealth` response, WebSocket adapter object.
16. **TC-7, TC-8, TC-9** — Cypress fixture-derived assertions, scoped `within()` in DataHealth test, `mockReset()` in `beforeEach`.

### Nice to Have (💭 Low)

17. **Q-003, Q-006, Q-007, Q-009, Q-010** — cosmetic refactors.
18. **EH-2, EH-3** — once-gated warnings on `readPremiumFile` and `discover()` silent failures.
19. **P-008, P-009, P-010** — micro-allocation optimizations (cache sorted views, hoist length checks, skip unused sort).
20. **M-1** — fix misleading comment in `server/routes/health.ts:25`.

---

*Generated by Review — 2026-07-23*