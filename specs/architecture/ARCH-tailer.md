# Architecture: #P2-4 — Tailer (byte-offset incremental transcript reader)

> **Date:** 2026-07-13
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** specs/context/21.md (GitHub issue #21) · architecture §5.3, §13 · plan.md #P2-4
> **Type:** feature

## Architecture Summary

The tailer is a poller-agnostic `Tailer` class in `server/ingest/tailer.ts` that owns a per-file state map `Map<path, { size, mtime, offset, seen: Set<string> }>` and turns the poller's coarse "this file changed" signal into incremental, parsed record deltas. It exposes the `IngestEvents` shape (`onFileAdded` / `onFileChanged` / `onFileRemoved`) so a `Poller` can drive it directly, but every method is also directly callable with a hand-built `RegisteredFile` for testing. On growth it `fs.read`s only the bytes from its stored `offset`, decodes the buffer, splits on newlines, feeds **complete lines only** to `parseTranscriptLines()` (reusing the per-file seen-set for cross-read dedupe), emits the `ParseTranscriptResult` via a `TailerEvents` callback, and advances `offset` to the last newline byte — a half-written trailing line stays beyond the offset and is re-read whole next poll (no remainder buffer). When the reported size is **smaller** than the stored offset it treats the file as truncated/rewritten: it emits a reset signal (so the future store drops that file's records), clears the seen-set, resets `offset` to 0, and reparses from byte 0. Only `class === "transcript"` files are tailed; premium capture files are ignored here (they belong to a later `parse-premium.ts` task).

## High-Level Structure

```
  discovery.ts ──registers──►  poller.ts ──onFileChanged(RegisteredFile)──►  tailer.ts  ──TailerEvents──►  (future store)
  (P2-3)                       (P2-3)      new size only, sync callback       (P2-4)      onRecords/onReset      (later task)
                                                                                │
                                                                                └── calls parseTranscriptLines()  (parse-transcript.ts, P2-2)
```

- **Added:** `server/ingest/tailer.ts` (+ `tailer.test.ts`). Introduces the `offset` state the poller lacks and the `TailerEvents` output contract.
- **Modified:** none. The tailer consumes `poller.ts`'s existing `IngestEvents`/`RegisteredFile` contract and `parse-transcript.ts`'s existing `parseTranscriptLines()` as-is.
- **Not built here:** the in-memory store, `app.ts` pipeline wiring, and warm-start cache (#P2-5) — all downstream.

**Most-important flow (one growth poll):** `poller.pollOnce()` stats a live transcript, sees `size` grew, mutates `RegisteredFile.size` in place, calls `tailer.onFileChanged(file)` → tailer looks up its offset state → `fs.open` + `FileHandle.read` bytes `[offset, size)` into a Buffer → find last `0x0A` → decode `buffer.subarray(0, lastNewline+1)` → `split("\n")` → `parseTranscriptLines(lines, state.seen)` → `events.onRecords(file, result)` → `state.offset += (lastNewline + 1)`.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|------|----------|-------------------------|-----------|
| File reads | `node:fs/promises` `open()` → `FileHandle.read(buffer, 0, length, position)` → `close()` | `fs.createReadStream({start})`; `readFile` whole | Positioned single read matches §5.3 ("`fs.read` from stored `offset`"); a live poll reads a few KB. Streams add lifecycle/backpressure complexity for no gain at this size. |
| Byte handling | Read into a `Buffer`, locate last newline by **byte** (`buffer.lastIndexOf(0x0a)`), advance offset by byte count | Decode to string then split | Offsets are byte positions (§5.3, "not line counts"). Finding the newline in the buffer guarantees the decoded slice ends on a clean byte boundary — a UTF-8 multibyte char can never be split, since `\n` is single-byte. |
| Parse integration | Call `parseTranscriptLines(rawLines, seenSet)` in-process | Emit raw lines, parse downstream | Confirmed decision: tailer owns per-file seen-set + malformed count so truncation reset is local. Reuses P2-2 verbatim. |
| Output transport | Injected `TailerEvents` callback object (mirrors poller's `IngestEvents`) | Return values; EventEmitter; async iterator | Consistent with the established poller pattern (synchronous injected callbacks, each wrapped so a consumer throw can't escape). Testable by capturing emitted events. |
| Read serialization | Per-file promise chain (serialize reads for the same path) | Busy-flag skip; no guard | A skip could lose a delta (poller only re-fires on a *further* size change). Chaining preserves order and never drops appended bytes. |

## Patterns & Conventions

- **Injected-callback consumer** — from `poller.ts`: constructor takes a `TailerEvents` object; each emit wrapped in try/catch so a downstream throw cannot break the tail loop. Applied to all emits.
- **Class owning a `Map` keyed by absolute path** — mirrors `Poller`'s `registry`. The tailer's map is independent of the poller's.
- **NodeNext relative imports with `.js`** — `import { parseTranscriptLines } from "./parse-transcript.js"`, `import type { IngestEvents, RegisteredFile } from "./poller.js"`, shared types via `../../shared/types.js`. No path aliases.
- **Biome style** — 2-space indent, double quotes, semicolons, ≤100 col; node builtins → vitest → local imports, alphabetized.
- **Intentionally NOT applied:** no filesystem watcher / chokidar (§2, §5.2 — the poller owns change detection); no remainder buffer (§5.3 — offset is the only cross-read state besides the seen-set); no diffing on rewrite (§5.3 — drop + full reparse is the entire robustness story).

## Data Models

### TailFileState (internal, `tailer.ts`)

**Purpose:** per-file cross-read state the poller does not track.

**Key fields:**
| Field | Type / Constraint | Notes |
|-------|-------------------|-------|
| `offset` | `number` (bytes, ≥0) | Byte position of the last consumed newline+1. Positioned-read start. Truncation is detected against the incoming `RegisteredFile.size`, not a stored copy. |
| `seen` | `Set<string>` | Per-file `message.id` dedupe set passed to `parseTranscriptLines`; cleared on truncation. |
| `chain` | `Promise<void>` | Tail of the per-file serialization chain; a rejected `task()` is caught before joining the chain so it can never poison future enqueues. |
| `readErrorCount` | `number` | Per-file fs open/read/close failure count; retained for later Data Health surfacing (#P2-13), not yet read anywhere. |

`size`/`mtime` are not stored on `TailFileState` today — this task only initializes the map internally (per Scope Boundaries); a future warm-start cache (#P2-5) may add them when it needs to seed offsets across restarts.

**Lifecycle:** created on `onFileAdded` (offset 0, empty seen) or lazily on first `onFileChanged` → mutated on each read → `offset`/`seen` reset to 0/empty on truncation → deleted on `onFileRemoved`.

### ParseTranscriptResult (reused, `parse-transcript.ts`)

Emitted unchanged: `{ calls, prompts, toolResultBytes, duplicateCount, malformedCount }`. No new shared types.

## API Contracts / Interfaces

### Tailer (`server/ingest/tailer.ts`)

**Boundary:** internal module. Implements the `IngestEvents` shape (from `poller.ts`) as its input; emits `TailerEvents` as its output.

**Operations:**

| Method/Op | Signature | Purpose | Returns / Errors |
|-----------|-----------|---------|------------------|
| constructor | `new Tailer(events: TailerEvents)` | Wire downstream sink | — |
| `onFileAdded` | `(file: RegisteredFile) => Promise<void>` | Register offset state (0) for a transcript; enqueue initial read from 0 | non-transcript classes ignored; returned promise never rejects (all internal errors caught before joining the chain) |
| `onFileChanged` | `(file: RegisteredFile) => Promise<void>` | Enqueue incremental read (grew) or truncation reparse (`size < offset`) | fs errors caught, counted, never thrown; returned promise never rejects |
| `onFileRemoved` | `(file: RegisteredFile) => void` | Drop offset state; emit `onFileRemoved` downstream | — |

**TailerEvents (new, exported from `tailer.ts`):**

| Callback | Signature | Fired when |
|----------|-----------|-----------|
| `onRecords?` | `(file: RegisteredFile, result: ParseTranscriptResult) => void` | A read produced ≥1 complete line |
| `onFileReset?` | `(file: RegisteredFile) => void` | Truncation detected — consumer must drop this file's records *before* the reparse `onRecords` |
| `onFileRemoved?` | `(file: RegisteredFile) => void` | File pruned by discovery |

**Ordering guarantee:** on truncation the tailer emits `onFileReset` then the from-0 `onRecords`, so a store applying them in order ends with exactly the current file contents.

**Auth requirements:** none (in-process).

## Module Boundaries

| Module | Responsibility | Allowed Dependencies |
|--------|----------------|----------------------|
| `tailer.ts` | Byte-offset positioned reads; last-newline rule; truncation fallback; per-file seen-set + parse; emit deltas | `node:fs/promises`, `./poller.js` (types), `./parse-transcript.js`, `../../shared/types.js` |
| `poller.ts` | Change *detection* (stat loop); fires `IngestEvents` | unchanged |
| `parse-transcript.ts` | Line → `ApiCall` + dedupe + malformed counting | unchanged |

Rule: the tailer never stats or globs (poller/discovery own that) and never touches HTTP/WS.

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|------|---------|-------------------|
| `server/ingest/tailer.ts` | The `Tailer` class + `TailerEvents` interface | `server/ingest/poller.ts` (class + injected callbacks + path-keyed Map) |
| `server/ingest/tailer.test.ts` | Real-fs temp-dir tests for the §13 cases | `server/ingest/poller.test.ts` (`mkdtemp`/`tmpDirs`/`afterEach` rm) |

### Modified files / modules

None. (`poller.ts` and `parse-transcript.ts` are consumed as-is.)

### Deleted / replaced

None.

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|------|----------------|
| `server/ingest/poller.ts` | Tailer depends on: `onFileChanged` carrying the **new** size (not previous), in-place `RegisteredFile` mutation, and truncation surfacing as a plain change. If the poller's contract shifts, the tailer's grew-vs-truncated logic breaks. |
| `server/ingest/parse-transcript.ts` | Tailer relies on `parseTranscriptLines(lines, seen)` mutating the shared seen-set for cross-read dedupe and counting malformed lines rather than throwing. |
| `test/fixtures/projects/.../33333333-…jsonl` | The README designates this partial-trailing-line fixture as reused by the tailer's partial-line-withholding tests. |

## Areas of Impact

| Area | Impact | Risk (L/M/H) | Why |
|------|--------|--------------|-----|
| Ingest pipeline assembly (#P2-7) | Gains the tailer as the poller→parser bridge; must instantiate `Tailer` and route poller events to it | L | New wiring, no change to existing modules |
| Future in-memory store | Must handle `onFileReset` (drop file records) before subsequent `onRecords`; must apply deltas idempotently | M | Contract the store hasn't been built against yet — reset ordering must be honored |
| Warm-start cache (#P2-5) | Will seed the tailer's `offset`/`size`/`mtime` on boot to skip re-reading unchanged files | L | State shape (`{size,mtime,offset}`) is designed to accept a seed |

**Contract changes:** introduces one new internal contract — `TailerEvents` (`onRecords` / `onFileReset` / `onFileRemoved`). No public HTTP/WS/shared-type contract changes.

**Cross-cutting ripples:** malformed-line and read-error counts should surface on the Data Health page eventually (architecture §5.4) — the tailer exposes them via `ParseTranscriptResult.malformedCount` and (new) a per-file read-error count, but the Data Health wiring is out of scope here.

## Cross-Cutting Concerns

- **Errors:** `fs.open`/`read` failures (ENOENT if the file vanished mid-poll, permission errors) are caught, increment a per-file read-error counter, and are swallowed — never thrown into the poll loop (mirrors poller's try/catch discipline). Parse errors are already counted by `parseTranscriptLines` (`malformedCount`), never thrown. A downstream `TailerEvents` callback throwing is caught per-emit.
- **Logging & metrics:** per-file read-error and malformed counts retained on state for later Data Health surfacing; no console logging in the hot path.
- **Auth / authz:** n/a (in-process).
- **Performance:** one positioned read of `size - offset` bytes per changed file per poll — a few KB on a live session. Per-file serialization prevents overlapping reads. The seen-set grows with distinct `message.id`s per file (bounded by session length); acceptable.
- **Security:** reads only files the poller already registered under configured scan roots; no path input from users; buffer sized to the stat-reported delta.
- **Migrations / rollout:** none — additive module, not wired into a running path until #P2-7. `FileHandle` always closed in a `finally`.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies |
|---|----------|--------------|----------------|-----------|
| A1 | Tailer parses internally, owns per-file seen-set + malformed count, emits `ParseTranscriptResult` | Emit raw lines; parse downstream | Truncation reset (clear seen-set) is local and atomic; reuses P2-2 | §5.3, §5.4 |
| A2 | Byte-level newline scan in the `Buffer` (`lastIndexOf(0x0a)`); advance offset by bytes | Decode-then-split; string offsets | §5.3 byte-offset mandate; never splits a UTF-8 multibyte char | §5.3 |
| A3 | Truncation = incoming `size < stored offset` → `onFileReset` + reparse from 0 | mtime-only heuristic; diffing | §5.3 "never attempt diffing"; drop + full reparse is the whole robustness story | §5.3 |
| A4 | No remainder buffer — leave offset at last newline, re-read partial line next poll | Buffer the fragment, prepend next read | §5.3 explicit "No remainder buffer"; offset is the only cross-read read-state | §5.3 |
| A5 | Tailer implements the `IngestEvents` shape but is directly callable | Poller-only coupling; separate orchestrator | Pluggable into `new Poller(config, tailer)` and unit-testable without a real poller | §5.2–5.3 |
| A6 | Per-file promise-chain serialization of reads | Busy-flag skip; unguarded | Skipping could drop a delta the poller won't re-signal | §5.3 |
| A7 | Only `class === "transcript"` files are tailed | Tail all registered files | Premium capture files (cost/turn-boundaries/cost-log) belong to a later `parse-premium.ts` | §5.1, §5.4 |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|----------|---------------------------|
| Poll lands mid-write (partial trailing line) | Read includes the fragment; `lastIndexOf(0x0a)` stops at the last complete line; fragment left beyond offset, re-read whole next poll. No partial line ever parsed. |
| No newline at all in the read (whole delta is one unterminated line) | `lastIndexOf` returns -1 → consume 0 bytes, emit nothing, offset unchanged → re-read next poll. |
| File truncated then rewritten shorter | Incoming `size < offset` → `onFileReset` emitted, seen-set cleared, offset 0, reparse from 0. Correct final state. |
| File rewritten to same/greater length (undetectable by size) | Out of scope per append-only assumption (§5.3); mtime change alone does not trigger a reset — documented in Open Questions. |
| Two poll cycles overlap on a slow read | Per-file promise chain serializes; second read starts from the offset the first left. No overlap, no loss. |
| File deleted between poller stat and tailer `fs.open` | `open` throws ENOENT → caught, read-error counted, swallowed; `onFileRemoved` arrives on the next discovery pass and clears state. |
| Large existing file first seen (`onFileAdded`, offset 0) | Single read of full size then parse; a few MB worst case, one-time. Warm cache (#P2-5) later avoids the re-read. |

### Backward — regression risk per touched area (brownfield only)

| Touched area | What could regress | How we'd know / mitigation |
|--------------|--------------------|-----------------------------|
| `poller.ts` contract | If poller stopped mutating size in place or changed truncation-as-change behavior, tailer's grew/truncated branch would misfire | Poller tests already pin these behaviors; tailer tests drive `onFileChanged` with explicit sizes |
| `parse-transcript.ts` seen-set | If `parseTranscriptLines` stopped mutating the passed seen-set, cross-read dedupe would silently break | Parser tests pin dedupe; tailer test asserts a `message.id` repeated across two reads is deduped |
| Shared partial-line fixture | If the fixture gains a trailing newline, the withholding test would no longer exercise the path | Test reads the fixture's raw bytes and asserts on withheld-then-completed behavior |

## Open Questions

- **Same-length rewrite detection.** A rewrite that preserves byte length is invisible to the `size < offset` check (only mtime changes).
  - **Impact if unresolved:** stale records for that one file until it next grows or shrinks — rare, and contradicts the append-only assumption the spec relies on.
  - **Suggested default:** accept it (matches §5.3's explicit append-only scope); revisit only if real transcripts show same-length rewrites.
- **Read-error counter surfacing.** The tailer will retain a per-file read-error count, but the Data Health page consuming it does not exist yet.
  - **Impact if unresolved:** counter is tracked but unread.
  - **Suggested default:** keep it on state now; wire to Data Health in the relevant Phase 3 page task.

## Out of Scope

- In-memory store and record application (separate later task) — tailer only emits deltas.
- `app.ts` / poller pipeline wiring and real-`~/.claude` validation (#P2-7).
- Warm-start cache seeding of offsets (#P2-5).
- Premium capture file parsing (`parse-premium.ts`) — non-transcript classes are ignored.
- WS invalidation emission (§7) — a store/assembly concern, not the tailer's.

---

# Tasks

## Task T1: Tailer — byte-offset incremental reader

> **Status:** done
> **Verification:** tdd
> **Effort:** m
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** N/A — no REQ linked (plan task #P2-4, requirements traced to architecture §5.3/§5.4/§13)
> **Footprint slice:** New: `server/ingest/tailer.ts`, `server/ingest/tailer.test.ts` (entire Change Footprint — this task owns it in full)
> **High-risk areas touched:** Future in-memory store (M) — `onFileReset`/`onRecords` ordering contract; addressed by this task's emit-order guarantee, consumed correctly is the responsibility of the store task

### Description

Implements the `Tailer` class: a per-file byte-offset state map that turns the poller's coarse `onFileChanged` signal into incremental, parsed record deltas. Reads only appended bytes on growth, withholds partial trailing lines (no remainder buffer — offset stays at the last newline), and falls back to a full drop-and-reparse on truncation. This is the byte-offset core of the ingest pipeline (architecture §5.3) and the direct upstream of the future in-memory store.

### Test Plan

#### Test File(s)
- `server/ingest/tailer.test.ts`

#### Test Scenarios

##### Tailer — growth reads

- **reads only appended bytes on growth** — GIVEN a file already tailed to offset X that grows by appending new lines, WHEN `onFileChanged` fires, THEN `onRecords` receives a `ParseTranscriptResult` containing only the newly-appended lines' records, not a reparse of bytes before X _(architecture §5.3 "read-from-offset on growth")_
- **advances offset to the last newline** — GIVEN a read that yields N complete lines, WHEN processed, THEN the tailer's stored offset equals the byte position immediately after the last `\n` in that read _(§13 "offset advancement", decision A2/A4)_
- **withholds a partial trailing line, mid-write** — GIVEN fixture `test/fixtures/projects/-Users-demo-project-alpha/33333333-3333-4333-8333-333333333333.jsonl` (two complete valid lines + a third cut mid-write, no trailing newline) copied into a temp dir, WHEN polled after only the two complete lines are on disk, THEN `onRecords` reflects exactly those two lines and the offset stops before the partial one; WHEN the third line is subsequently completed on disk (with a trailing `\n`) and polled again, THEN it is parsed and included _(§13 "partial trailing line" + "mid-write reads", decision A4)_
- **no newline at all in the delta** — GIVEN a read whose entire appended content has no `\n` byte, WHEN processed, THEN zero records are emitted via `onRecords` (or it is not called) and the stored offset is unchanged _(forward-stress: "No newline at all in the read")_

##### Tailer — truncation fallback

- **treats shrink as truncation** — GIVEN the tailer's stored offset is greater than the incoming `size` reported by `onFileChanged`, WHEN processed, THEN `onFileReset` fires before `onRecords`, and the subsequent `onRecords` reflects a from-byte-0 reparse of the file's current (post-truncation) full content _(§13 "truncation/rewrite fallback", decision A3)_
- **truncation clears the dedupe seen-set** — GIVEN a `message.id` was seen and counted pre-truncation, WHEN the same `message.id` reappears in the post-truncation reparse, THEN it is emitted as a normal call, not flagged as a duplicate _(decision A1/A3 interaction)_

##### Tailer — file lifecycle

- **onFileAdded starts a new file at offset 0** — GIVEN a freshly registered transcript file with existing content, WHEN `onFileAdded` fires, THEN the file is fully parsed once via `onRecords` and no `onFileReset` is emitted _(decision A5)_
- **onFileAdded ignores non-transcript classes** — GIVEN a `RegisteredFile` with `class` of `"cost"`, `"turn-boundaries"`, or `"cost-log"`, WHEN `onFileAdded` fires, THEN no read occurs and no `onRecords`/`onFileReset` fires for that path _(decision A7)_
- **onFileRemoved drops state and forwards the event** — GIVEN a registered, previously-tailed file, WHEN `onFileRemoved` fires, THEN the downstream `TailerEvents.onFileRemoved` fires, and if the same path is later re-added via `onFileAdded`, it is treated as a brand-new file starting at offset 0

##### Tailer — concurrency & errors

- **serializes overlapping changes on the same file** — GIVEN `onFileChanged` is called a second time (simulating a further append) before the first invocation's async read has resolved, WHEN both resolve, THEN the two reads do not overlap, the final stored offset equals the total bytes written across both appends, and no line is dropped or duplicated across the two `onRecords` emissions _(forward-stress: "Two poll cycles overlap on a slow read", decision A6)_
- **survives the file disappearing before open** — GIVEN a path is deleted between the poller's stat and the tailer's `fs.open` call (simulated by unlinking the file before invoking `onFileChanged` with a stale `RegisteredFile`), WHEN `onFileChanged` fires, THEN the call resolves without throwing and no `onRecords`/`onFileReset` is emitted for that path _(forward-stress: "File deleted between poller stat and tailer `fs.open`")_

### Implementation Notes

- **Module(s):** `server/ingest/tailer.ts` (per ARCH Module Boundaries: byte-offset positioned reads, last-newline rule, truncation fallback, per-file seen-set + parse, emit deltas)
- **Pattern reference:** `server/ingest/poller.ts` — class owning a path-keyed `Map`, constructor-injected event-callback object, each emit wrapped in try/catch so a downstream throw can't escape. Test file mirrors `server/ingest/poller.test.ts`'s `mkdtemp`/`tmpDirs` module-level array + single `afterEach` cleanup, and `server/ingest/parse-transcript.test.ts`'s `readFileSync`/`fixturesDir` pattern for loading the shared fixture.
- **Key decisions (from ARCH Decisions Log):**
  - A1 — parse internally via `parseTranscriptLines()`, own the per-file seen-set + malformed count locally (truncation reset stays local).
  - A2 — byte-level newline scan (`buffer.lastIndexOf(0x0a)`), advance offset by bytes, never split a UTF-8 multibyte char.
  - A3 — truncation = incoming `size < stored offset` → `onFileReset` then reparse from 0; never diff.
  - A4 — no remainder buffer; leave offset at the last newline, let the partial line be re-read whole next poll.
  - A5 — implement the `IngestEvents` shape but keep every method directly callable for unit testing without a real `Poller`.
  - A6 — per-file promise-chain serialization of reads so overlapping `onFileChanged` calls never race.
  - A7 — only `class === "transcript"` files are tailed.
- **Libraries:** `node:fs/promises` (`open`, `FileHandle.read`, `close` in a `finally`) — no `fs.createReadStream`, no chokidar.
- **High-risk callouts:** The future in-memory store depends on the `onFileReset`-before-`onRecords` ordering guarantee on truncation to end up with correct final state. This task's "treats shrink as truncation" test scenario pins that ordering so the store task can rely on it without re-verifying the tailer's internals.

### Scope Boundaries

- Do NOT implement or stub an in-memory store — the tailer only emits `TailerEvents`; applying deltas is a separate future task (per ARCH Out of Scope).
- Do NOT wire the tailer into `app.ts` or a running `Poller` instance — pipeline assembly is #P2-7 (per ARCH Out of Scope).
- Do NOT implement warm-start cache seeding of `offset`/`size`/`mtime` — that's #P2-5; `TailFileState`'s shape is designed to accept a future seed but this task only initializes it internally.
- Do NOT handle premium capture file classes (`cost`, `turn-boundaries`, `cost-log`) beyond ignoring them per A7 — parsing them is a later `parse-premium.ts` task.
- Do NOT add WS invalidation emission — that's a store/assembly concern (§7), not the tailer's.
- Do NOT modify `poller.ts` or `parse-transcript.ts` — both are consumed as-is (per ARCH Change Footprint, no modified files).
- Only implement the `Tailer` class and `TailerEvents` interface exactly as specified in ARCH's API Contracts section — no additional public methods or events beyond `onFileAdded`/`onFileChanged`/`onFileRemoved` (input) and `onRecords`/`onFileReset`/`onFileRemoved` (output).

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- `server/ingest/tailer.ts` — the `Tailer` class + `TailerEvents` interface, mirroring `server/ingest/poller.ts`'s class + injected callbacks + path-keyed Map pattern
- `server/ingest/tailer.test.ts` — real-fs temp-dir tests for the §13 cases, mirroring `server/ingest/poller.test.ts`'s `mkdtemp`/`tmpDirs`/`afterEach` pattern

**Modified files:** None (ARCH Change Footprint lists none).

**Must NOT modify:** _(from ARCH "Touched but not changed")_
- `server/ingest/poller.ts` (silent-regression hotspot — tailer depends on `onFileChanged` carrying the new size and truncation surfacing as a plain change; covered by this task's growth/truncation test scenarios exercising the documented poller contract, not by modifying the poller itself)
- `server/ingest/parse-transcript.ts` (silent-regression hotspot — tailer relies on `parseTranscriptLines` mutating the shared seen-set; covered by the "truncation clears the dedupe seen-set" scenario)
- `test/fixtures/projects/-Users-demo-project-alpha/33333333-3333-4333-8333-333333333333.jsonl` (reused fixture, read-only — covered by the "withholds a partial trailing line" scenario)

### TDD Sequence

1. `onFileAdded` full-file read at offset 0 (simplest case — no offset math yet) before growth/offset-advancement tests.
2. Growth + offset-advancement + partial-trailing-line withholding (the core byte-offset logic) before truncation.
3. Truncation fallback + seen-set clearing (builds on the reparse-from-0 path already exercised by `onFileAdded`).
4. `onFileRemoved` lifecycle, then concurrency/error edge cases last — they wrap the already-tested read logic in serialization and failure handling.

---

_Status values: `not started` (defined, not picked up) | `in progress`
(implementation underway) | `done` (verification evidence produced) | `blocked`
(cannot proceed — see notes). The implement skill updates this field as it works._
