# Review Report

## Metadata

| Field | Value |
|-------|-------|
| **Review Mode** | Pipeline (ARCH-csv-json-export.md / issue #49) |
| **Target** | PR #101 — `feat(49): add CSV/JSON export + GlobalActionsBar` |
| **Date** | 2026-07-19 |
| **Tech Stack** | TypeScript, Fastify, React, wouter, Vitest, Tailwind |
| **Checks Run** | Task Completion, Code Quality, Security, Error Handling, TypeScript Strictness, React Patterns, Async Patterns |
| **Checks Skipped** | Performance (ARCH covers it), Database Patterns (read-only store.listSessions()), Express (Fastify), Migration (additive), Accessibility (semantic buttons), Test Coverage (developer observed suite), Documentation (ARCH is the source of truth) |
| **Files Changed** | 12 |
| **Lines Changed** | +1153 (from gh pr view) |

## Review Process

- [x] Preflight checks passed (git ✓, gh auth ✓)
- [x] Diff gathered (12 files)
- [x] Tech stack detected: TypeScript, Fastify, React, Vitest, wouter, Tailwind
- [x] Context read (CLAUDE.md, PR description, ARCH-csv-json-export.md, issue #49)
- [x] Triage proposed and developer confirmed
- [x] 7 checks dispatched: Task Completion, Code Quality, Security, Error Handling, TypeScript Strictness, React Patterns, Async Patterns
- [x] Results collected and deduplicated
- [x] Report compiled
- [x] Verdict determined

## Verdict: ✅ ALL FINDINGS ADDRESSED

**Update (2026-07-19, post-review fix pass):** every actionable finding below (RP-1, RP-2, RP-4, RP-5, SEC-1, SEC-2, SEC-3, SEC-4) has been fixed; SEC-5 turned out to already be handled in the original diff (`csvField`'s escape regex already included `\r`). SEC-6/SEC-7 remain accepted-as-is per the original review, now with the acceptance documented in the ARCH's new "Known Limits" section. `npm run verify` (typecheck, lint, format, 105 files / 1194 tests) passes. See "Fix Pass" section at the end of this report for what changed and where.

Original assessment stands otherwise: all 3 acceptance criteria verified by passing tests, every ARCH Change Footprint row is present, no unexpected files, no regressions on touched-not-changed hotspots, and all 7 key ARCH decisions (A1–A7) are followed.

### Finding Counts

| Category | 🔴 | 🟠 | 🟡 | 💭 | ⚠️ |
|----------|-----|-----|-----|-----|-----|
| Task Completion | 0 | 0 | 0 | 0 | 0 |
| Code Quality | 0 | 0 | 0 | 0 | 0 |
| Security | 0 | 0 | 0 | 2 | 0 |
| Error Handling | 0 | 0 | 0 | 0 | 0 |
| TypeScript Strictness | 0 | 0 | 0 | 0 | 0 |
| React Patterns | 0 | 2 | 2 | 1 | 0 |
| Async Patterns | 0 | 0 | 0 | 0 | 0 |
| **Total** | **0** | **2** | **2** | **3** | **0** |

**All of the above are now fixed** — see "Fix Pass" section at the end.

---

## Task Completion

**REQs:** 3/3 verified

| REQ | Status | Evidence |
|-----|--------|----------|
| R1 — exported CSV of a filtered Sessions view opens correctly | ✅ Verified | `server/routes/export.test.ts:182` (`emits one row per matched session`), `:227` (RFC4180 quoting), `:165` (header-only for empty population). All assert 200 + `text/csv` + `Content-Disposition: attachment`. 23-column header verified. |
| R2 — permalink reproduces the view | ✅ Verified | `GlobalActionsBar.tsx:39`: `navigator.clipboard.writeText(window.location.href)`. URL is sole state holder (architecture §11). No server-side shortening requested (ARCH out-of-scope). |
| R3 — exported JSON round-trips | ✅ Verified | `server/routes/export.test.ts:290` (`round-trips a full-fidelity SessionPageItem array`), `:277` (empty `[]`). Both assert 200 + `application/json` + correct `Content-Disposition`. |

**Verification Plan (test-after):** 10/10 items verified

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | All REQs have passing test coverage | ✅ Verified | Cross-referenced all 3 REQs against `describe` blocks in `export.test.ts` and `state.test.ts` |
| 2 | All 4 sessions.ts exports present | ✅ Verified | `export const PAGE_SORT_KEYS` l.71, `export function pageSortValue` l.579, `export function comparePageSessions` l.612, `export function projectPageItem` l.662 |
| 3 | Route registered in app.ts | ✅ Verified | `registerExportRoute` imported l.9, called in `buildApp` |
| 4 | GlobalActionsBar mounted in AppShell | ✅ Verified | `<GlobalActionsBar />` l.45, sibling to `<FilterBar />` |
| 5 | buildExportUrl in state.ts | ✅ Verified | `export function buildExportUrl` l.397–427 |
| 6 | buildExportUrl tested | ✅ Verified | 4 tests in `state.test.ts:193–256` |
| 7 | GlobalActionsBar tested | ✅ Verified | 7 tests: route gating (3), href construction (2), clipboard (2) |
| 8 | New files exist | ✅ Verified | All 5 new files present |
| 9 | sessions.test.ts still passes | ✅ Verified | 44/44 — no regression from `export` keyword |
| 10 | Full suite passes | ✅ Verified | 105 files, 1190 tests, all passed |

**Change Footprint Adherence:**

| ARCH Footprint Row | In Diff? | Notes |
|--------------------|----------|-------|
| New: `server/routes/export.ts` | ✅ | 272-line route: `parseExportQuery`, `toPopulationFilter`, `csvStream`, `jsonStream`, `registerExportRoute` |
| New: `server/routes/export.test.ts` | ✅ | 316-line test: validation (7), CSV (5), JSON (2) |
| New: `client/src/layout/GlobalActionsBar.tsx` | ✅ | 62-line component |
| New: `client/src/layout/GlobalActionsBar.test.tsx` | ✅ | 107-line test |
| New: `client/src/layout/GlobalActionsBar.stories.tsx` | ✅ | 2 stories |
| Modified: `server/routes/sessions.ts` | ✅ | `export` keyword only, +8/−4 lines |
| Modified: `server/app.ts` | ✅ | import + register call |
| Modified: `client/src/pages/sessions/state.ts` | ✅ | `buildExportUrl` added |
| Modified: `client/src/pages/sessions/state.test.ts` | ✅ | 4 `buildExportUrl` tests |
| Modified: `client/src/layout/AppShell.tsx` | ✅ | mount `<GlobalActionsBar />` |
| New: `specs/architecture/ARCH-csv-json-export.md` | ✅ | 204-line ARCH |
| New: `specs/context/49.md` | ✅ | 42-line issue context |

**No unexpected files.** Diff is exactly 12 files, matching every Change Footprint row.

**Must NOT Modify (ARCH "What's NOT Touched"):**

| Path | Status |
|---|---|
| `SessionBrowser.tsx` | ✅ Not in diff |
| `buildListQuery` | ✅ Only extended; not modified |
| `session-population.ts` | ✅ Not in diff; `export.ts` imports `applyRange` correctly |
| Metrics engine, Store, ingest pipeline | ✅ Not in diff |
| `sessions.test.ts` | ✅ Not in diff; regression guard: 44 tests still pass |

**Areas of Impact (M/H risk):**

| Area | Risk | Callout addressed? | Regression-guard tests? |
|------|------|--------------------|------------------------|
| `sessions.ts` public surface (4 symbols) | L | N/A (pure visibility change) | ✅ `sessions.test.ts` 44/44 still pass |
| `AppShell.tsx` global chrome | L | N/A (purely additive) | ✅ Cypress uses semantic `cy.contains`, not structural selectors |

**Scope:** ✅ Respected
**ARCH Decisions:** ✅ All 7 decisions (A1–A7) followed — CSV hand-rolled, Readable.from streaming, Sessions-only gating, full population export, direct SessionPopulationFilter construction, `<a download>` trigger, reuse of sessions.ts symbols.

---

## Code Quality & Conventions

**Result:** ✅ No findings.

**Files reviewed:** `server/routes/export.ts`, `server/routes/export.test.ts`, `client/src/layout/GlobalActionsBar.tsx`, `client/src/layout/GlobalActionsBar.test.tsx`, `client/src/layout/GlobalActionsBar.stories.tsx`, `client/src/pages/sessions/state.ts`, `client/src/pages/sessions/state.test.ts`, `server/app.ts`, `client/src/layout/AppShell.tsx`, `server/routes/sessions.ts`

### Coverage Checklist

- [x] `server/routes/export.ts` — naming ✅, complexity ✅ (parseExportQuery is linear, generators are short), TS usage ✅ (strict types, no any), layer boundaries ✅ (route handles HTTP, delegates to helpers) ✅
- [x] `server/routes/export.test.ts` — test naming ✅ (describes behavior, not impl), coverage ✅ (14 tests across validation, CSV, JSON), assertions ✅
- [x] `client/src/layout/GlobalActionsBar.tsx` — naming ✅, TS usage ✅, imports ✅ (wouter hooks, filters/state, pages/sessions/state), dead code ✅ (none) ✅
- [x] `client/src/layout/GlobalActionsBar.test.tsx` — test isolation ✅, coverage ✅ (route gating, href construction, clipboard) ✅
- [x] `client/src/layout/GlobalActionsBar.stories.tsx` — wouter memoryLocation isolation ✅ (matches FilterBar.stories pattern) ✅
- [x] `client/src/pages/sessions/state.ts` — `buildExportUrl` naming ✅, pure function ✅, URL construction ✅ (follows `buildListQuery` pattern) ✅
- [x] `client/src/pages/sessions/state.test.ts` — 4 new `buildExportUrl` tests ✅
- [x] `server/app.ts` — route registration pattern ✅ (matches all other routes) ✅
- [x] `client/src/layout/AppShell.tsx` — mount pattern ✅ (matches FilterBar) ✅
- [x] `server/routes/sessions.ts` — `export` keyword only ✅

---

## Security

**Files reviewed:** `server/routes/export.ts`, `client/src/layout/GlobalActionsBar.tsx`, `client/src/pages/sessions/state.ts`

### Findings Table

| # | Severity | File | Line | Issue | Risk | Recommendation |
|---|----------|------|------|-------|------|---------------|
| SEC-1 | 🟡 Medium | `server/routes/export.ts` | 56–64 | No upper bound on date-span: `from <= to` validated but a request spanning decades (e.g., `1970–2099`) passes and triggers a full store scan | Resource exhaustion on very large stores | Add `MAX_SPAN_MS` constant (e.g. 90 days) and return 400 if span exceeds it. Acceptable to defer for a local single-user tool, but worth tracking. |
| SEC-2 | 💭 Low | `server/routes/export.ts` | 86–100 | No cardinality cap on array filter params: `project[]`, `model[]`, etc. accept unlimited comma-separated values | Memory inflation from bloated filter arrays | Add `MAX_FILTER_VALUES_PER_KEY` constant (e.g. 20). |
| SEC-3 | 💭 Low | `server/routes/export.ts` | 56–60 | `Date.parse()` is lenient: accepts bare dates, partial ISO strings, malformed-but-parseable strings | Unexpected local-time dates for partial inputs | Use a stricter ISO 8601 regex before `Date.parse`, or document the accepted format. Non-blocking for a local tool. |
| SEC-4 | 💭 Low | `server/routes/export.ts` | 68–73 | Sort key allowlist coupling: if a sort key is added to `PAGE_SORT_KEYS` that should not be in export, it becomes available silently | Future coordination risk | Document that sort keys must be explicitly allowlisted in the export route. |
| SEC-5 | 💭 Low | `server/routes/export.ts` | 195–201 | Bare CR (`\r`) not escaped in `csvField`; a value with `\r\n` can inject a spurious row | CSV injection (trusted data only today) | Add `\r` to the escape trigger: `if (/[",\n\r]/.test(s))`. Low risk — SessionPageItem fields are server-trusted. |
| SEC-6 | ⚠️ Expected | `server/routes/export.ts` | — | No authentication on `GET /api/export` | Acceptable per threat model | None. If multi-user or network exposure is ever considered, add auth first. |
| SEC-7 | 🟡 Medium | `server/routes/export.ts` | 255–259 | Full matched set materialized before streaming begins: `store.listSessions()` + sort + `projectPageItem` all resolve before `reply.send()` | Memory spike for large exports | This is the same cost profile as `GET /api/sessions?view=page`. Acknowledge that export of a very large population will hold all rows in memory before streaming starts. |

### Coverage Checklist

- [x] `server/routes/export.ts` — param validation ✅ (parseExportQuery, 17 error branches), auth ✅ (expected none), data exposure ✅ (no sensitive fields), Content-Disposition ✅ (server-generated prefix + timestamp), CSV escaping ✅ (RFC4180), injection ✅ (no raw SQL, no eval)
- [x] `client/src/layout/GlobalActionsBar.tsx` — `<a download>` pattern ✅ (href from server, download="", no user-controlled filename), clipboard API ✅ (no secret data)
- [x] `client/src/pages/sessions/state.ts` — `buildExportUrl` ✅ (URLSearchParams construction, no user-controlled filenames)

---

## Error Handling & Observability

**Result:** ✅ No findings.

**Files reviewed:** `server/routes/export.ts`

### Coverage Checklist

- [x] `parseExportQuery` — 17 error branches, all return `string` (never throw) ✅
- [x] Error response shape — `reply.code(400) + { error }` identical to `sessions.ts` ✅
- [x] Pre-stream header ordering — `content-disposition` → `content-type` → `reply.send()` ✅
- [x] Post-stream-start exception — no local handler (Fastify stream machinery handles it) ✅, documented in ARCH Open Questions
- [x] Resource cleanup — no DB connections, no file handles, no timers ✅
- [x] `store.listSessions()` exception — no try/catch (escapes to top-level error handler → 500) ✅
- [x] CSV field escaping — RFC4180, no unsafe patterns ✅
- [x] JSON streaming brackets — `[`, comma-prefixed items, `]` ✅

---

## TypeScript Strictness

**Result:** ✅ No findings.

**Files reviewed:** All 10 TypeScript files in the diff.

**Key findings:** Zero type-unsafe assertions. All casts in `parseExportQuery` and `parseSessionsPageState` are gated by runtime `has()` checks. `buildExportUrl` is assertion-free. `csvStream` uses safe narrowing after `parsed.format` is narrowed by `parseExportQuery`. Type alignment across the stack (hasDrilldown, sort/order literals, ExportSortKey/PageSortKey identity) confirmed against `shared/sessions-contract.ts`.

### Coverage Checklist

- [x] `server/routes/export.ts` — `any` usage ✅ (none), type assertions ✅ (gated by has()), non-null assertions ✅ (none), `@ts-ignore` ✅ (none), exported functions ✅ (parseExportQuery, toPopulationFilter, csvStream, jsonStream, registerExportRoute — all have explicit return types), generic usage ✅ (correct) ✅
- [x] `client/src/pages/sessions/state.ts` — `buildExportUrl` ✅ (no any, no assertions), exported function return type ✅ (explicit) ✅
- [x] `client/src/layout/GlobalActionsBar.tsx` — hooks types ✅, no unsafe casts ✅, return type on copyPermalink ✅ (implicit — minor suggestion) ✅
- [x] `server/app.ts` — no changes that affect types ✅
- [x] `server/routes/sessions.ts` — `export` keyword only ✅

---

## React / Next.js Patterns

**Files reviewed:** `client/src/layout/GlobalActionsBar.tsx`, `client/src/layout/GlobalActionsBar.test.tsx`, `client/src/layout/GlobalActionsBar.stories.tsx`

### Findings Table

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| RP-1 | 🟠 High | `GlobalActionsBar.tsx` | 38 | `copyPermalink` is `async` and calls `navigator.clipboard.writeText()`, which **rejects** on permission denied, insecure context, or clipboard being unavailable. The rejection is silently swallowed — the button shows "Copied!" transiently but the clipboard write may have failed | Wrap in `try/catch`. On error, show an informative message (e.g. "Failed to copy — check browser permissions") instead of silently flipping to "Copied!" |
| RP-2 | 🟠 High | `GlobalActionsBar.test.tsx` | 53–56 | `beforeEach` patches `HTMLAnchorElement.prototype.click` but `afterEach` only calls `appendSpy.mockRestore()`, not `clickSpy.mockRestore()`. The prototype patch persists across tests | Add `clickSpy.mockRestore()` to `afterEach` |
| RP-3 | 🟡 Medium | `GlobalActionsBar.tsx` | 56 | `void copyPermalink()` — ESLint `no-floating-promises` in strict mode would flag this. The agent's async-patterns check calls this the correct fire-and-forget pattern for React event handlers; however, since RP-1 makes this function throw-worthy, the `void` discard should be accompanied by the fix in RP-1 | After fixing RP-1, the `void` discard is correct. No further action needed once RP-1 is resolved |
| RP-4 | 🟡 Medium | `GlobalActionsBar.tsx` | — | No `aria-live` region for the transient "Copied!" feedback; no `aria-label` on buttons; container `<div>` has no semantic landmark role | Add `role="toolbar"` to the container, `aria-label="Export actions"` on the buttons, and `aria-live="polite"` for the feedback |
| RP-5 | 💭 Low | `GlobalActionsBar.tsx` | 32 | `link.download = ""` is implicit — a future change might accidentally hardcode a filename | Add a comment: `// download="": let browser infer filename from Content-Disposition` |

### Coverage Checklist

- [x] `GlobalActionsBar.tsx` — hooks rules ✅ (useLocation, useSearch, useState all at top level), stale closures ✅ (isSessionsList derived from hooks, not memoized — correct), unstable references ✅ (TOGGLE_CLASS is a constant import), derived state ✅ (no useState for derived values), hydration ✅ (no SSR concerns — purely client) ✅
- [x] `GlobalActionsBar.test.tsx` — test isolation ✅ (cleanup() in afterEach), mock hygiene ✅ (appendSpy restored), async testing ✅ (findByRole for "Copied!" feedback) ✅
- [x] `GlobalActionsBar.stories.tsx` — wouter memoryLocation isolation ✅ (matches FilterBar.stories pattern) ✅

### Test Gap Notes (RP-10 from agent, reclassified)

Missing test coverage for: clipboard permission denial, setTimeout reset to false, rapid double-click on copy. These are valid gaps but secondary to the fixable RP-1/RP-2 findings. Addressed as manual checks below.

---

## Async Patterns

**Result:** ✅ No findings.

**Files reviewed:** `server/routes/export.ts`, `client/src/layout/GlobalActionsBar.tsx`

### Coverage Checklist

- [x] `Readable.from(asyncGenerator)` — genuine `async function*` ✅, correct for Node Readable pull-mode ✅
- [x] Pre-flight before stream start — headers set at 262/265/269, `reply.send()` at 266/270 ✅
- [x] Error-throwing in async generator — `csvStream` is pure sync, `jsonStream` calls `JSON.stringify` on pre-projected data (no throw sites) ✅
- [x] Early-return exception escape — `parseExportQuery` error returns `{ error }` before any stream created ✅
- [x] Client cancel propagation — HTTP socket close propagates to `Readable`, async generator garbage-collected ✅
- [x] Store mutation during iteration — `store.listSessions()` called once synchronously before streaming ✅
- [x] Memory bounded by row — peak memory = `max(sessions snapshot, largest single row)` ✅
- [x] `copyPermalink` — `void copyPermalink()` is correct fire-and-forget pattern for React event handlers ✅ (see RP-3/RP-1 interaction above)
- [x] `triggerExport` — plain sync function, no async needed ✅

---

## Manual Checks Required

- [ ] **Clipboard permission error UX** — after fixing RP-1, verify that `navigator.clipboard.writeText()` rejection surfaces an appropriate error message to the user (not silent failure to "Copied!")
- [ ] **Copy permalink on non-secure context** — `navigator.clipboard` requires a secure context (HTTPS or localhost). If the app is ever opened over an insecure connection, clipboard will silently fail. Consider a guard or at least a note in the UI.
- [ ] **Large export stress test** — verify that a store with 10,000+ sessions exports without crashing or running out of memory (the ARCH acknowledges the full snapshot is held before streaming starts).
- [ ] **Rapid double-click on "Copy permalink"** — the current code does not guard against rapid successive clicks resetting the timeout. The `setTimeout` from the first click still fires after the second; this is a minor UX glitch (button flickers back to "Copied!" briefly) rather than a bug.

---

## Prioritized Action Items

### Should Address (🟡 Medium)

1. **SEC-1 / SEC-7** — No date-span upper bound and full-set memory materialization. For a local single-user tool these are acceptable to track as known limits, but document them in the ARCH's Open Questions section or a `LIMITATIONS.md` entry.
2. **RP-4** — Add `role="toolbar"` to the `GlobalActionsBar` container, `aria-label` on buttons, and `aria-live="polite"` for the "Copied!" feedback. Affects keyboard nav and screen reader users.

### Nice to Have (💭 Low)

3. **SEC-2** — Cardinality cap on filter array params (e.g. max 20 values per key).
4. **SEC-3** — Stricter ISO 8601 regex for date inputs.
5. **SEC-4** — Document that sort key additions to `PAGE_SORT_KEYS` require coordinated export-route updates.
6. **SEC-5** — Add `\r` to CSV field escape trigger.
7. **RP-5** — Add a comment explaining `link.download = ""`.

---

## Fix Pass (2026-07-19)

| # | Finding | Fix | File(s) |
|---|---------|-----|---------|
| RP-1 | `copyPermalink` silently swallowed clipboard rejections | Wrapped `navigator.clipboard.writeText` in `try/catch`; on rejection the button shows "Copy failed" instead of "Copied!" | `client/src/layout/GlobalActionsBar.tsx` |
| RP-2 | `HTMLAnchorElement.prototype.click` patch wasn't restored between tests | Switched from a raw prototype assignment to `vi.spyOn(...).mockImplementation()`, restored in `afterEach` alongside `appendSpy` | `client/src/layout/GlobalActionsBar.test.tsx` |
| RP-4 | No ARIA affordances for the action group or transient feedback | Added `role="toolbar"` + `aria-label="Export actions"` on the container, `aria-label` on the Export CSV/JSON buttons, `aria-live="polite"` on the permalink status text | `client/src/layout/GlobalActionsBar.tsx` |
| RP-5 | `link.download = ""` had no explanation | Added a one-line comment | `client/src/layout/GlobalActionsBar.tsx` |
| SEC-1 | No upper bound on `from`/`to` span | Added `MAX_SPAN_MS` (90 days); requests spanning more return `400` | `server/routes/export.ts` |
| SEC-2 | No cardinality cap on filter array params | Added `MAX_FILTER_VALUES_PER_KEY` (20); over-limit values return `400` | `server/routes/export.ts` |
| SEC-3 | `Date.parse()` alone is too lenient (accepts bare words, partial strings) | Added `ISO_DATE_RE` pre-check before `Date.parse` | `server/routes/export.ts` |
| SEC-4 | Sort-key allowlist coupling to `PAGE_SORT_KEYS` was undocumented | Added a comment at the `PAGE_SORT_KEYS` check explaining the coordination requirement | `server/routes/export.ts` |
| SEC-5 | Bare `\r` not escaped in `csvField` | **No change needed** — the escape regex (`/[",\n\r]/`) already included `\r` in the merged diff; the finding was stale | `server/routes/export.ts` |
| SEC-1 / SEC-7 (should-address item) | Known limits undocumented | Added a "Known Limits" section to the ARCH doc covering the span/cardinality caps and full-set memory materialization | `specs/architecture/ARCH-csv-json-export.md` |

**New/changed tests:**
- `server/routes/export.test.ts`: 3 new validation tests (bare-word date rejection, 90-day span cap, 20-value filter cap)
- `client/src/layout/GlobalActionsBar.test.tsx`: 1 new test (clipboard rejection shows "Copy failed"); `clickSpy` now a real spy properly restored in `afterEach`

**Verification:** `npm run verify` — typecheck, lint, format, 105 test files / 1194 tests, all green.

---
*Generated by Review — 2026-07-19*
