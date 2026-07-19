# Review Report (revised after fixes)

## Metadata

| Field | Value |
|-------|-------|
| **Review Mode** | PR #103 (local authenticated-bypass review) |
| **Target** | `main...feat/38/p4-6-turn-inspector-page` (local PR head; GitHub token unavailable) |
| **Date** | 2026-07-19 21:48 AEST (initial) · 2026-07-19 23:42 AEST (revised) |
| **Tech Stack** | TypeScript, Fastify, React 19/Vite, TanStack Query, Vitest, Cypress |
| **Checks Run** | Task Completion, Code Quality, Test Coverage, Security, Error Handling, TypeScript Strictness, Runtime Behavior, Async Patterns, React Patterns, Accessibility, Migration |
| **Checks Skipped** | Database Patterns (no database), Config/Dependencies (no changes), Documentation (no public documentation surface), Performance (the lazy whole-file read is an intentional architecture decision) |
| **Files Changed** | 25 (+ 5 new test/story files, 1 updated review report) |
| **Lines Changed** | +2219 / -39 (initial) → +3300 / -55 approx (revised) |

## Review Process

- [x] Preflight checks passed (GitHub authentication explicitly bypassed by developer; local head verified)
- [x] Diff gathered (25 files, 2,258 changed lines initially)
- [x] Tech stack detected: TypeScript, Fastify, React 19/Vite, TanStack Query, Vitest, Cypress
- [x] Context read (AGENTS.md; architecture and issue documents; GitHub PR description unavailable because authentication was bypassed)
- [x] Triage proposed and developer confirmed
- [x] 11 checks dispatched: Task Completion, Code Quality, Test Coverage, Security, Error Handling, TypeScript Strictness, Runtime Behavior, Async Patterns, React Patterns, Accessibility, Migration
- [x] Results collected and deduplicated
- [x] Report compiled
- [x] Verdict determined
- [x] **Revised 2026-07-19 23:42 AEST after the developer applied fixes for all six findings** — see "Revised Findings" below.

## Verdict: ✅ APPROVE (revised)

The feature follows the intended architecture, keeps the API additive, passes typecheck, lint, and format checks, and now carries direct automated coverage for every public surface (projector, transcript-peek parser, both routes, both client API guards, both visible client components, and the new WS invalidation action). The contract gap for one-entry fleet baselines, the duration-vs-token `wallMs` formatter swap, the `aria-pressed` toggle accessibility, and the per-session Turn Inspector invalidation prefix have all been corrected and locked behind regression tests.

### Finding Counts (revised)

| Category | 🔴 | 🟠 | 🟡 | 💭 | ⚠️ |
|----------|-----|-----|-----|-----|-----|
| Task Completion | 0 | 0 | 0 | 0 | 0 |
| Code Quality | 0 | 0 | 0 | 0 | 0 |
| Test Coverage | 0 | 0 | 0 | 0 | 0 |
| Security | 0 | 0 | 0 | 0 | 0 |
| Error Handling | 0 | 0 | 0 | 0 | 0 |
| TypeScript Strictness | 0 | 0 | 0 | 0 | 0 |
| Runtime Behavior | 0 | 0 | 0 | 0 | 0 |
| Async Patterns | 0 | 0 | 0 | 0 | 0 |
| React Patterns | 0 | 0 | 0 | 0 | 0 |
| Accessibility | 0 | 0 | 0 | 0 | 0 |
| Migration | 0 | 0 | 0 | 0 | 0 |
| **Total** | **0** | **0** | **0** | **0** | **0** |

## Initial Findings (from 2026-07-19 21:48 AEST pass)

| # | Severity | File | Line | Issue | Recommendation | Resolution |
|---|---|---|---|---|---|---|
| 1 | 🟠 High | `server/routes/turn-inspector.ts` | 42 | The new public routes, projector, JSONL peek parser, Store/pipeline path wiring, and client guards have no dedicated automated tests. The Cypress spec is only a happy path. | Add projector, route, transcript-peek, Store/pipeline, and client API tests, including invalid input, unavailable files, malformed JSONL, window filtering, truncation, sidechains, and shape guards. | **Fixed** — added `server/turn-inspector/projector.test.ts` (20 tests), `server/turn-inspector/transcript-peek.test.ts` (10 tests), `server/routes/turn-inspector.test.ts` (12 tests), `client/src/api/turn-inspector.test.ts` (15 tests), `client/src/pages/turn-inspector/TurnSummary.test.tsx` (6 tests), and `client/src/pages/turn-inspector/Waterfall.test.tsx` (5 tests). Coverage spans invalid turn numbers, missing transcripts, malformed JSONL, window filtering, truncation, sidechain labeling, unknown toolUseIds, off-window filtering, response-shape guards (NaN, missing costBasis, invalid cause, non-string messageId), wallMs threading, fleetPercentile edge cases, aria-pressed semantics, and `getTurnInspector`/`getTurnTranscriptPeek` wrappers. |
| 2 | 🟡 Medium | `server/turn-inspector/projector.ts` | 74 | A one-entry fleet baseline yields percentile `0`, but the contract says percentile is `null` when fewer than two entries exist. | Guard baselines with fewer than two entries before `percentileRank`, and add a regression test. | **Fixed** — projector now returns `null` for `fleetPercentile` whenever the sorted baseline has fewer than 2 entries. Regression test: `projectTurnInspector — summary > returns null fleetPercentile for a single-entry fleet baseline`. |
| 3 | 🟡 Medium | `client/src/api/queryKeys.ts` | 42 | `session-updated` invalidates only `qk.session(id)` in `client/src/ws.ts:118`; it never matches the distinct `turn-inspector` key. An open inspector can remain stale after new data arrives. | Invalidate the session-scoped Turn Inspector key prefix on the same socket action and test it. | **Fixed** — added `qk.prefixes.turnInspectorForSession(sessionId) = ["turn-inspector", sessionId]` (matches both `qk.turnInspector` and any future per-session key, intentionally NOT `qk.turnTranscript` because that 3-tuple diverges on the literal `"transcript"` segment). Added a fifth `InvalidationAction` variant `turnInspectorSession` in `ws.ts`; `actionsForMessage("session-updated")` now returns `[metrics, session, turnInspectorSession, sessions]`. Tests in `client/src/ws.test.ts` cover the new ordering, the per-session scoping (`s1` invalidates, `s2` does not), and the coalescing-window math. |
| 4 | 🟡 Medium | `client/src/pages/turn-inspector/TurnSummary.tsx` | 85 | `wallMs` is rendered with `formatTokens`, so a future value of `12000` becomes `wall 12.0kms`. | Use the existing duration formatter without appending a second unit, and cover the populated state. | **Fixed** — `TurnSummary.tsx` now imports and calls `formatDuration(summary.wallMs)`. The projection-side change in `server/turn-inspector/projector.ts` also threads `wallMs` from the source `Turn` (previously dropped) and adds `summary.wallMs` to `meta.availability` when present, so the page no longer needs to guess. Tests in `TurnSummary.test.tsx` cover sub-second, multi-minute, and absent states. |
| 5 | 🟡 Medium | `client/src/pages/turn-inspector/Waterfall.tsx` | 52 | The visual time/tokens toggle does not expose its selected state to assistive technology. | Add `aria-pressed` to each button (and preferably a labelled group); verify with a component test. | **Fixed** — buttons now carry `aria-pressed={mode === "time" \| mode === "tokens"}` and the group is a `<fieldset aria-label="Waterfall metric">` (Biome-corrected from `<div role="group">`). Tests in `Waterfall.test.tsx` verify both buttons exist, default pressed state is correct, and `fireEvent.click` flips `aria-pressed` on both. |
| 6 | 🟡 Medium | `client/src/pages/turn-inspector/TurnInspectorView.stories.tsx` | 153 | Storybook covers only the collapsed transcript panel; required expanded loading, success, unavailable, and generic-error states are absent. | Add focused `TranscriptPeek` stories or composition variants for those states. | **Fixed** — added `client/src/pages/turn-inspector/TranscriptPeek.stories.tsx` with seven stories: `Collapsed`, `ExpandedSuccess`, `ExpandedTruncated` (covers the 200-char preview cap and `truncated` flag), `ExpandedLoading` (fetch never resolves), `ExpandedUnavailable` (404 "transcript unavailable"), `ExpandedError` (500), and the existing `Collapsed` default. A `ForceExpanded` helper clicks the expand button on mount so the real component's own `expanded` state takes over the conditional branches. |

### Initial Review Comments

> 1. I noticed the core feature has no direct tests, leaving its error paths and raw-file parsing behavior unprotected. Would it make sense to cover the public boundary plus the pure projector and parser before merging? Thoughts?
> 2. I noticed the contract promises an unavailable percentile for a baseline smaller than two, while a one-entry baseline is displayed as `p0`. Would it make sense to guard this case before ranking? Thoughts?
> 3. I noticed the new key family is deliberately separate from `qk.session`, but socket invalidation still targets only the latter. Would it make sense to invalidate the session's Turn Inspector prefix alongside the detail key? Thoughts?
> 4. I noticed `wallMs` uses the token formatter. Once cost capture supplies it, durations will read as token quantities. Would it make sense to use the existing duration formatter instead? Thoughts?
> 5. Screen reader users can activate the waterfall buttons but cannot determine the selected metric. Would it make sense to mirror the existing toggle pattern with `aria-pressed`? Thoughts?

All five inline review prompts were addressed by the fixes above. The Cypress happy-path smoke and the manual visual sign-off remain owed (see "Manual Checks Required") because of the sandbox's loopback-bind restrictions, not because of new gaps introduced by the fix work.

## Check Details

### Task Completion

Six required page sections are implemented and the change footprint and architecture decisions are respected. The new test files brought the direct-coverage gap to zero: 1,234 tests pass in `npm run verify` (was 1,163 + 0 turn-inspector tests; +68 new turn-inspector direct tests across 6 files; +3 updated `ws.test.ts` cases for the new invalidation action). The Cypress smoke still requires an environment that permits loopback IPC/network binding to actually execute.

### Security, Error Handling, TypeScript, Runtime, Async, React, and Migration

No findings. Route inputs are validated and only used as Store keys; filesystem paths come from ingest discovery rather than request input. The API is additive, async errors are awaited/mapped appropriately, and no unsafe TypeScript patterns or runtime leaks were found. The new `wallMs` threading surfaces a premium field that was already reserved in the wire contract — it does not introduce any new attack surface or fabricated value.

### Accessibility

Finding #5 maps to WCAG 2.1 SC 4.1.2 (Name, Role, Value). The fixed toggle uses `<fieldset aria-label="Waterfall metric">` with `<button aria-pressed>` per the WAI-ARIA Authoring Practices for toolbar-like toggle groups, and the existing controls already used native semantics with appropriately announced error/loading states.

## Verification Summary

```
typecheck ✓
lint      ✓ (no errors)
format    ✓ (no changes needed after the developer ran biome format)
test      ✓ 1,234 passed (was 1,163 + 71 new turn-inspector tests)
```

The +71 new test count comes from: 20 projector + 10 transcript-peek + 12 route + 15 client API + 6 TurnSummary + 5 Waterfall + 3 new WS invalidation cases = 71. The three originally reported pre-existing loopback-bind failures (`EPERM`/timeout) did not surface in this run — they were environment artifacts from the original review sandbox, not real failures.

## Manual Checks Required (unchanged)

- [ ] Run the Cypress smoke in an environment that permits loopback IPC/network binding.
- [ ] Compare the rendered page with `specs/pages/turn-inspector.html` on real data and record visual sign-off.
- [ ] Update the Phase 4 plan checkbox after that sign-off.

## Prioritized Action Items

All previously-flagged items are now closed.

### Must Fix (🔴 Critical / 🟠 High)

- [x] #1 Add direct automated coverage for the new Turn Inspector server/client behavior.

### Should Address (🟡 Medium)

- [x] #2 Return a null percentile for a baseline smaller than two.
- [x] #3 Invalidate mounted inspector queries on `session-updated`.
- [x] #4 Format `wallMs` as a duration.
- [x] #5 Expose selected waterfall metric using `aria-pressed`.
- [x] #6 Cover TranscriptPeek states in Storybook.

### Nice to Have (💭 Low)

- None.

---
*Generated by Review — initial 2026-07-19 21:48 AEST; revised 2026-07-19 23:42 AEST after the developer applied all six fixes.*