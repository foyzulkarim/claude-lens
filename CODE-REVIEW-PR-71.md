# Review Report

## Metadata

| Field | Value |
|-------|-------|
| **Review Mode** | PR |
| **Target** | https://github.com/foyzulkarim/claude-lens/pull/71 |
| **Date** | 2026-07-13 |
| **Tech Stack** | TypeScript (strict, ESM/NodeNext), Node built-ins (fs/promises, path, os), fast-glob, vitest |
| **Checks Run** | Task Completion, Code Quality, TypeScript Strictness, Error Handling |
| **Checks Skipped** | Test Coverage (tdd mode, 27/27 confirmed passing, scenarios manually traced), Security/Performance/React/Express/Database/Accessibility/Migration/Runtime-behavior/Async-patterns (no HTTP surface, no DB, no React — pure local fs polling), Documentation (internal module, no public API), Config/Dependencies (`fast-glob` already pinned, no `npm install`) |
| **Files Changed** | 7 (4 code, 2 spec artifacts, 1 unrelated docs file) |
| **Lines Changed** | +1103 / -10 |

## Review Process

- [x] Preflight checks passed
- [x] Diff gathered (7 files, 1113 lines)
- [x] Tech stack detected: TypeScript / Node / fast-glob / vitest
- [x] Context read (CLAUDE.md, PR description, ARCH-discovery-polling.md, issue #20 context)
- [x] Triage proposed and developer confirmed
- [x] 4 checks dispatched: Task Completion, Code Quality, TypeScript Strictness, Error Handling
- [x] Results collected and deduplicated
- [x] Report compiled
- [x] Verdict determined

## Verdict: ⚠️ APPROVE WITH COMMENTS

Clean, well-scoped implementation — every ARCH acceptance criterion (AC1–AC4) traces to a real test, all Scope Boundaries and Must-NOT-modify constraints were honored, and `typecheck`/`lint`/tests all pass (27/27 for these two modules). No Critical or High findings. Two Medium items worth a look before or shortly after merge: an unguarded event-callback path that could produce an unhandled rejection once #P2-7 wires a real `Poller`, and a control-flow-only (not type-level) exhaustiveness guarantee on `FileClass` that would silently swallow a future variant. Neither blocks merge — this code is inert until #P2-7 assembles it.

### Finding Counts

| Category | 🔴 | 🟠 | 🟡 | 💭 | ⚠️ |
|----------|-----|-----|-----|-----|-----|
| Task Completion | 0 | 0 | 0 | 0 | 0 |
| Code Quality | 0 | 0 | 0 | 1 | 0 |
| TypeScript Strictness | 0 | 0 | 1 | 0 | 0 |
| Error Handling | 0 | 0 | 1 | 1 | 0 |
| **Total** | **0** | **0** | **2** | **2** | **0** |

*(The `RegisteredFile.class` duplication was flagged independently by both Code Quality and TypeScript Strictness — merged into one Low finding below.)*

## Task Completion

**Requirements source:** issue #20 / ARCH-discovery-polling.md (no REQ doc — plan task, AC1–AC4 traced verbatim).

| AC | Status | Evidence |
|----|--------|----------|
| AC1 — classification tests + new file picked up within one slow-loop pass | ✅ | `discovery.test.ts` 7 classify tests + fixture/synthetic `discover` tests; `poller.test.ts` "registers a newly discovered file" / "picks up a file added after boot" |
| AC2 — deleted file's session removed on next discovery pass | ✅ | `poller.test.ts` "prunes a deleted file on the next discovery pass" — `onFileRemoved` fires once, no re-fire on a subsequent pass. Actual store removal is correctly deferred to #P2-6 |
| AC3 — overlapping roots dedupe by absolute path | ✅ | `discovery.test.ts` + `poller.test.ts` "dedupes overlapping roots" — verified the dedupe collapses 6 raw glob matches to 3 unique paths |
| AC4 — clean boot on missing/empty root | ✅ | `discovery.test.ts` "tolerates a missing/empty root"; `poller.test.ts` "boots cleanly on a missing/empty root" |

**Verification (tdd):** 27/27 scenarios traced 1:1 from ARCH's Test Plan tables to actual tests — no missing scenario, no vestigial test. Independently re-ran `npx vitest run server/ingest/discovery.test.ts server/ingest/poller.test.ts`: 2 files, 27 passed.

**Change Footprint:** matches ARCH exactly — 4 new files, zero existing files modified. One unexpected file, `.claude/skills/archive-issue/SKILL.md`, is out-of-scope docs hardening from a prior task riding the same branch (see Manual Checks below) — not a completion gap.

**Must NOT modify:** `test/fixtures/projects/-Users-demo-project-alpha/*.jsonl`, `server/cli.ts`, `server/app.ts`, `package.json` — all confirmed untouched via `git diff` and grep.

**Scope Boundaries:** ✅ no `chokidar`/`fs.watch`; not wired into `cli.ts`/`app.ts`; no writes to the pinned fixture dir (synthetic cases use `fs.mkdtemp`); no store/session/WS-invalidation code.

**ARCH Decisions A1–A7:** all followed — standalone/inert modules, injected `IngestEvents` seam, path-keyed registry, stateless `discover`, deterministic `runDiscovery()`/`pollOnce()` hooks, L-file resolved outside the roots glob, dot-separated classification order with underscore-variant fallthrough.

## Code Quality

### Findings Table

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| 1 | 💭 Low | `server/ingest/poller.ts` | 10 | `RegisteredFile.class` hand-declares the same 4-member literal union as `DiscoveredFile["class"]` in `discovery.ts` (already imported here). No type-level link — a future `FileClass` addition/rename in `discovery.ts` won't force this copy to update. | `import type { DiscoveredFile } from "./discovery.js"` and use `class: DiscoveredFile["class"]`. |

### Coverage Checklist

- [x] `discovery.ts` — naming, complexity, pure/effectful split (matches `parse-transcript.ts` convention), layer boundary (no HTTP), import hygiene → no issues
- [x] `discovery.test.ts` — colocated, behavior-named tests, tmp-dir cleanup via `afterEach` → no issues
- [x] `poller.ts` — SRP, caller-owned state / injected collaborators, layer boundary → 1 issue (type duplication, above)
- [x] `poller.test.ts` — fake-timer scoping, behavior-named tests, shared event-collection helper → no issues

Overall closely follows the established `parse-transcript.ts` pure-core/effectful-shell convention; no singletons; stays within the ingest layer boundary.

## TypeScript Strictness

No `any`, no type assertions, no non-null assertions, no `@ts-ignore`/`@ts-expect-error` anywhere in the four files. `strict: true` confirmed in `tsconfig.base.json`.

### Findings Table

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| 1 | 🟡 Medium | `discovery.ts` | 77–84 | `discover()` narrows `FileClass["kind"]` to `Exclude<..., "unknown">` purely by control flow (an early `continue` on `"unknown"`), not by an exhaustiveness check. A future 6th `FileClass` variant would silently compile and flow into `DiscoveredFile.class` as if already handled, instead of failing the build. | Add a lightweight exhaustiveness guard (e.g. a `switch` with a `never`-typed default) at the classification dispatch point, so a new `FileClass` kind fails typecheck until consciously routed. |
| 2 | 💭 Low | `poller.ts` | 10 | Same `RegisteredFile.class` duplication as Code Quality finding #1 — merged, see above. | Same fix — reuse `DiscoveredFile["class"]`. |

### Coverage Checklist

- [x] `discovery.ts` — no `any`/assertions/`!`/`ts-ignore`; explicit return types on all exports; exhaustiveness ⚠️ (Finding #1)
- [x] `poller.ts` — no `any`/assertions/`!`/`ts-ignore`; explicit return types; `Awaited<ReturnType<typeof stat>>` is a good pattern; type duplication ⚠️ (merged into Code Quality #1)
- [x] `discovery.test.ts`, `poller.test.ts` — fully typed, no `any`/assertions → no issues

## Error Handling

### Findings Table

| # | Severity | File | Line | Issue | Recommendation |
|---|----------|------|------|-------|----------------|
| 1 | 🟡 Medium | `poller.ts` | 35, 49–85, 87–102 | `start()` fires `runDiscovery()` with `void`. Its fs calls are all safely caught, but the injected `onFileAdded`/`onFileRemoved` callbacks (lines 56, 83) are invoked unguarded — a throwing consumer callback surfaces as an unhandled rejection from the `void`-fired call. Same unguarded pattern applies to `onFileChanged` in `pollOnce()` (line 99), invoked from a `setInterval` closure with no caller-side handling either. Currently unreachable (nothing constructs a `Poller` yet, per ARCH decision A1), but this is exactly the seam #P2-7 wires up next. | Wrap each callback invocation in try/catch (or wrap the loop body) so a misbehaving consumer callback can't take down the poll loop via an unhandled rejection. |
| 2 | 💭 Low | `poller.ts` | 65–71, 90–94 | Both `stat()` catches use a bare `catch { continue }`, treating `ENOENT` (expected — file removed) identically to `EACCES`/`EIO`/other unexpected errors. Consistent with ARCH's "minimal logging" stance, but means a permissions/disk error on a session file is indistinguishable from routine deletion. | Optional: narrow to `err.code === "ENOENT"` and no-op-flag anything else, so future debugging can tell the two apart. Not blocking given the documented minimal-logging tradeoff. |

### Coverage Checklist

- [x] `discovery.ts` — fast-glob call and explicit L-file stat both wrapped, degrade to skip/`[]` per AC4/A6 → no issues
- [x] `poller.ts` — per-file stat in `runDiscovery` and `pollOnce` both wrapped ⚠️ (Finding #2); catch blocks scoped tightly, no adjacent logic masked; unguarded event-callback path ⚠️ (Finding #1)

## Manual Checks Required

- [ ] `.claude/skills/archive-issue/SKILL.md` is modified in this PR but is unrelated to #P2-3 (docs hardening for the archive-issue skill, matching commit `dbe8e2f`) — confirm this is intentionally bundled rather than accidentally carried over from local branch history; harmless either way (docs-only) but worth a conscious decision before merge.

## Prioritized Action Items

### Must Fix (🔴 Critical / 🟠 High)
_None._

### Should Address (🟡 Medium)
- Wrap `IngestEvents` callback invocations in try/catch inside `runDiscovery()`/`pollOnce()` so a throwing consumer can't produce an unhandled rejection (latent today, live once #P2-7 wires a real `Poller`).
- Add an exhaustiveness guard where `FileClass["kind"]` is narrowed to `DiscoveredFile.class` in `discover()`, so a future new `FileClass` variant fails typecheck instead of silently flowing through.

### Nice to Have (💭 Low)
- Reuse `DiscoveredFile["class"]` instead of hand-duplicating the union in `RegisteredFile.class` (`poller.ts:10`).
- Consider narrowing `poller.ts`'s `stat()` catches to `ENOENT` specifically, distinguishing expected deletions from unexpected fs errors.
- Confirm the unrelated `SKILL.md` change is intentionally bundled into this PR.

---

## Re-review Report

**Original report:** this document, 2026-07-13
**Findings addressed:** 4 of 4 code findings (the manual `SKILL.md` bundling check is not code-fixable and remains open)

| # | Original Finding | Status | Notes |
|---|-------------------|--------|-------|
| 1 | 🟡 `poller.ts` — unguarded `IngestEvents` callbacks risk unhandled rejection | ✅ Resolved | `onFileAdded`/`onFileRemoved`/`onFileChanged` invocations now wrapped in try/catch in both `runDiscovery()` and `pollOnce()` |
| 2 | 🟡 `discovery.ts` — `FileClass` narrowing is control-flow-only, not exhaustiveness-checked | ✅ Resolved | Added `toDiscoveredClass()` with a `switch`/`never`-typed default; a future unhandled `FileClass` kind now fails typecheck |
| 3 | 💭 `poller.ts:10` — `RegisteredFile.class` duplicates `DiscoveredFile["class"]` | ✅ Resolved | Now `class: DiscoveredFile["class"]`, imported from `discovery.ts` |
| 4 | 💭 `poller.ts` — `stat()` catches don't distinguish `ENOENT` from unexpected errors | ✅ Resolved (as comment, not branching) | Evaluated adding an `err.code === "ENOENT"` branch; left as a bare catch with a clarifying comment instead, since there was no differentiated action to take (ARCH's "minimal logging" stance) and an empty conditional branch would have been dead code. Documents the reasoning for both catch sites. |

**Regression check:** `npm run typecheck`, `npm run lint`, and `npx vitest run server/ingest/discovery.test.ts server/ingest/poller.test.ts` all re-run clean after the fixes (typecheck clean, lint clean, 27/27 tests passing, no new failures).

**Updated Verdict:** ✅ **APPROVE** — all Medium/Low findings resolved or consciously addressed; only the manual `SKILL.md` bundling question remains, which is a merge-scope decision, not a code defect.

---
*Generated by Review — 2026-07-13*
