# Architecture: Warm-start cache

> **Date:** 2026-07-13
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** `specs/claude-lens-plan.md` #P2-5, `specs/claude-lens-architecture.md` §5.6 (issue #22)
> **Type:** feature (brownfield — extends the ingest pipeline)

## Architecture Summary

A new `server/ingest/warm-cache.ts` module provides a `(path, size, mtime)`-keyed NDJSON cache of parsed transcript results under `~/.claude-lens/cache/`, one cache file per transcript (filename = hash of the absolute path). `Tailer` (from #P2-4) is extended with an optional `WarmCache` collaborator: on `onFileAdded`, if the cache holds a valid entry for the file's current `(path, size, mtime)`, `Tailer` replays the cached records instead of reading and parsing the transcript from byte 0; on a miss, it parses as before and then best-effort writes the result back to the cache. Cache reads/writes never throw — any corruption, mismatch, or I/O failure degrades to "parse it, like today," matching the project's existing fail-open conventions. Full pipeline wiring (constructing a `WarmCache` and passing it into `Tailer` at boot) is #P2-7's job, not this task's — this task makes `Tailer` cache-*capable*.

## High-Level Structure

```
Poller.runDiscovery() → onFileAdded(file)
  → Tailer.enqueue(state, checkCacheThenRead)
      cache hit  → seed state.seen from cached messageIds, state.offset = file.size
                   → emitRecords(file, cachedEntry)   [no transcript read]
      cache miss → readGrowth() as today (full parse from offset 0)
                   → fire-and-forget cache.save(key, result)
```

Added: `warm-cache.ts` (new module, no dependents yet outside `Tailer`).
Modified: `tailer.ts` (`onFileAdded` gains a cache-check branch inside the existing per-file `enqueue()` chain; constructor takes an optional `cache: WarmCache`).
Unchanged: `poller.ts`, `discovery.ts`, `parse-transcript.ts`, and all boot/app wiring (`app.ts`, `cli.ts`) — `Tailer` is not yet instantiated anywhere outside its own test file.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| Cache serialization format | NDJSON, one JSON object per line | msgpack; a single binary blob | §5.6 specifies NDJSON explicitly; msgpack is deferred until #P2-7 boot profiling demands it. No new dependency — reuses `JSON.parse`/`stringify` already used in `parse-transcript.ts`. |
| Storage granularity | One cache file per transcript (`<hash(path)>.ndjson`) | One monolithic cache file for all transcripts | Mirrors the transcript layout; keeps corruption/truncation blast radius to a single session; avoids read-modify-write contention across concurrently tailed files. |
| Storage engine | Flat files under `~/.claude-lens/cache/` | SQLite / LevelDB | §1's non-negotiable constraints rule out a database entirely ("No database... disk is used only for a warm-start cache"). |
| Cache directory resolution | `join(homedir(), ".claude-lens", "cache")`, resolved directly, overridable via constructor param for tests | Read from `config/settings.ts` | That module doesn't exist yet (#P4-15). Matches the existing pattern in `discovery.ts`'s `resolveScanConfig`, which also resolves `~/.claude` directly via `homedir()`. |
| Cache key validity check | First NDJSON line is a header record `{path, size, mtime}`; compared against the file's current stat on load | Encode size/mtime into the filename | Filename-encoding is fragile (mtime formatting, filesystem-safe escaping) and adds no value since the file must be opened anyway; a header line is simpler and keeps the filename derivation (path hash) independent of stat volatility. |
| Compact record shape | Reuse `ParseTranscriptResult`'s constituent types (`ApiCall`, `PromptTextRecord`, `ToolResultBytesRecord`) tagged by `kind`, mirroring `ParsedLine`'s discriminant from `parse-transcript.ts` | Invent a new "compact record" type | Those types are already compact (no raw tool_result bodies, per §5.4) — no new vocabulary needed. Confirmed as the suggested approach in #P2-4's own ARCH doc (`ARCH-transcript-parser-dedupe.md`: "include them in the warm-cache NDJSON alongside ApiCalls (tagged by kind, mirroring ParsedLine) — #P2-5 should confirm when it designs the cache format"). |
| Corruption/error handling | Fail-open: any read/parse/stat-mismatch error → treated as a miss; any write error is swallowed | Throw and let the caller decide | Matches the project-wide convention already in `parse-transcript.ts` ("malformed → skip, never throw") and `discovery.ts` ("unexpected fs error → skip"), and the architecture's explicit invariant that the cache dir is "always safe to delete." |
| Write durability | Write to a temp path, then `rename()` into place | Write directly to the final path | Atomic rename avoids a reader ever observing a half-written cache file if the process crashes or two instances race during boot. |
| Cache wiring point | Inside `Tailer`'s existing per-file `enqueue()` chain, at the top of the `onFileAdded` task | Check the cache before calling `enqueue()` | A prior review of `Tailer` (#P2-4 / PR #72) flagged serialization ordering as fragile; checking the cache outside the chain could let a cache-hit `onFileAdded` race a concurrent `onFileChanged` for the same file. Keeping it inside the chain preserves the existing serialization guarantee. |

## Patterns & Conventions

- **Optional-collaborator injection** — `Tailer`'s constructor already takes an `events: TailerEvents` callback bag; `cache?: WarmCache` follows the same seam (optional, so every existing caller/test that omits it gets today's unchanged behavior).
- **Fail-open, never-throw I/O** — followed throughout `ingest/` (`discovery.ts`, `parse-transcript.ts`, `poller.ts`); `warm-cache.ts` continues it for cache reads and writes.
- **Tagged-union wire records mirroring `ParsedLine`** — from `parse-transcript.ts`; reused verbatim for cache record framing rather than inventing a parallel shape.

## Data Models

### WarmCacheKey

**Purpose:** identifies a cache entry's validity — a transcript file's identity plus the stat fields that signal "unchanged since last cached."

**Key fields:**
| Field | Type / Constraint | Notes |
|---|---|---|
| `path` | `string`, required | Absolute transcript path; used both for the header comparison and to derive the cache filename (hashed). |
| `size` | `number`, required | Byte size at time of caching. |
| `mtime` | `number`, required | `mtimeMs` at time of caching. |

**Relationships:** none (value type, not a store entity).

**Lifecycle:** constructed fresh on every `load()`/`save()` call from the current `RegisteredFile`; never persisted independently of its parent cache file's header line.

### WarmCacheEntry

**Purpose:** the cached form of a fully parsed transcript — structurally identical to `ParseTranscriptResult` (from `parse-transcript.ts`), so a cache hit and a live parse are interchangeable to every downstream consumer.

**Key fields:**
| Field | Type / Constraint | Notes |
|---|---|---|
| `calls` | `ApiCall[]` | Deduped assistant API-call records. |
| `prompts` | `PromptTextRecord[]` | User prompt text, keyed by `promptId`. |
| `toolResultBytes` | `ToolResultBytesRecord[]` | Byte-size-only tool result records. |
| `duplicateCount` | `number` | Carried through so cache hits report identical counters to a live parse. |
| `malformedCount` | `number` | Same. |

**Relationships:** 1:1 with a transcript file's on-disk cache file (identified by path hash); embeds `ApiCall`/`PromptTextRecord`/`ToolResultBytesRecord` from `shared/types.ts` and `parse-transcript.ts`.

**Lifecycle:** written once per `(path, size, mtime)` tuple on a cache miss; superseded (new cache file content, same path hash, overwritten via rename) whenever the file grows and is later re-cached with the same key derivation — not expected to happen in the current design since only `onFileAdded` (cold start) writes the cache, never `onFileChanged` (incremental tail). Deleting the whole `~/.claude-lens/cache/` directory is always safe and simply forces a full re-parse on next boot.

## API Contracts / Interfaces

### `warm-cache.ts` (internal module boundary)

**Boundary:** internal module — consumed only by `tailer.ts`.

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| `createWarmCache` | `(cacheDir?: string) => WarmCache` | Factory; defaults `cacheDir` to `~/.claude-lens/cache` | Never throws; directory is created lazily on first write. |
| `WarmCache.load` | `(key: WarmCacheKey) => Promise<WarmCacheEntry \| null>` | Look up a cache entry and validate it against the current stat | Returns `null` on any miss — absent file, header mismatch, or malformed content. Never rejects. |
| `WarmCache.save` | `(key: WarmCacheKey, entry: WarmCacheEntry) => Promise<void>` | Best-effort persist of a freshly parsed result | Never rejects — internal errors are caught and swallowed. |

**Auth requirements:** none — local filesystem module, no network/user boundary.

### `Tailer` (modified, `tailer.ts`)

**Boundary:** internal module — poller-agnostic, directly callable (existing pattern from #P2-4).

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| `constructor` | `(events: TailerEvents, cache?: WarmCache)` | Adds optional cache collaborator | Backward compatible — omitting `cache` reproduces pre-change behavior exactly. |
| `onFileAdded` | `(file: RegisteredFile) => Promise<void>` (signature unchanged) | Now checks `cache.load()` first when a cache is supplied | On hit: emits cached records, no disk read of the transcript. On miss or no cache: unchanged from today. Promise still never rejects (errors caught before joining the per-file chain, per existing pattern). |

**Auth requirements:** none.

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|---|---|---|
| `server/ingest/warm-cache.ts` | Owns all reads/writes under `~/.claude-lens/cache/`; validates and serializes/deserializes cache entries | `node:fs/promises`, `node:os`, `node:path`, `node:crypto`, `shared/types.ts`, `parse-transcript.ts` (types only) |
| `server/ingest/tailer.ts` | Owns the parse-vs-skip decision per file; the only caller of `warm-cache.ts` | `warm-cache.ts`, `parse-transcript.ts`, `poller.ts` (types only) |

`warm-cache.ts` never imports from `tailer.ts` or `poller.ts` (no upward dependency) — it is a leaf module in the ingest chain.

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `server/ingest/warm-cache.ts` | `(path,size,mtime)`-keyed NDJSON cache of parsed transcript results | `discovery.ts`'s `resolveScanConfig` (homedir-based path resolution); `parse-transcript.ts`'s tagged-union `kind` framing |
| `server/ingest/warm-cache.test.ts` | Unit tests for `WarmCache` in isolation | `discovery.test.ts` / `tailer.test.ts` (mkdtemp-based fixture pattern) |

### Modified files / modules

| Path | What changes here |
|---|---|
| `server/ingest/tailer.ts` | Constructor gains optional `cache?: WarmCache` param; `onFileAdded`'s enqueued task checks the cache first and branches hit/miss; `readGrowth`'s success path fires a non-blocking `cache.save()` on miss. |
| `server/ingest/tailer.test.ts` | New test cases for cache-hit replay (seen/offset seeded correctly, no transcript read), cache-miss-then-save, and a no-cache-supplied regression guard covering all pre-existing scenarios. |

### Deleted / replaced

None.

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| `server/ingest/poller.ts` | Drives `Tailer.onFileAdded`/`onFileChanged` once wired (not yet, per #P2-7) — its `IngestEvents` contract and call sites are unaffected by this change, but any future wiring must supply the same `RegisteredFile` shape the cache-check branch relies on (`path`, `size`, `mtime`). |
| `server/ingest/parse-transcript.ts` | `ParseTranscriptResult`'s shape is now serialized to disk (via the cache) in addition to being an in-memory return value. Any future change to `ApiCall`/`PromptTextRecord`/`ToolResultBytesRecord` shapes must consider that old cache files on disk won't reflect the new shape — see Open Questions (schema versioning). |

## Areas of Impact

| Area | Impact | Risk (L/M/H) | Why |
|---|---|---|---|
| `server/ingest/` | Additive — new module, optional constructor param on an existing internal class | L | No existing caller of `Tailer`'s constructor outside its own test file; nothing can break that isn't already covered by new tests. |
| Filesystem (`~/.claude-lens/cache/`) | New directory created lazily | L | Isolated from `~/.claude/` (read-only source data) and from `config.json`/`local.json` (not yet built); explicitly documented as always-safe-to-delete. |
| #P2-7 (future boot wiring) | Must remember to construct a `WarmCache` and pass it into `Tailer` for warm-start to activate at runtime | M | If omitted, the pipeline still works correctly (cache simply never consulted) but the feature silently does nothing — no crash, no signal. Flagged explicitly in Open Questions so it isn't lost. |

**Contract changes:** none — `TailerEvents`, `RegisteredFile`, and `ParseTranscriptResult` are all unchanged; a cache hit emits the exact same event shape as a live parse.

**Cross-cutting ripples:** none outside `server/ingest/`. No client, shared-contract, HTTP, or WS surface touched.

## Cross-Cutting Concerns

- **Errors:** all cache I/O failures caught inside `warm-cache.ts`; `Tailer` never observes a rejected promise from a cache call. Consistent with the project's existing "malformed/failed → skip, never throw" convention.
- **Logging & metrics:** no logger is wired into `server/ingest/` yet. `load()`/`save()` return shapes (`entry | null`, `void`) are structured so a future Data Health counter (hit/miss/corruption) can be added without a signature change; deferred to whichever task introduces logging in this layer.
- **Auth / authz:** N/A — local filesystem only, no network surface.
- **Performance:** a cache hit replaces `fs.open` + `fs.read` + per-line `JSON.parse` of the full transcript with one `fs.readFile` + NDJSON parse of the smaller compact form (no raw prompt/tool_result bloat) — the entire point of this task, validated at scale in #P2-7's boot/memory pass.
- **Security:** cache filenames are derived from a hash of the absolute transcript path, which itself originates only from `fast-glob` over configured scan roots (never from network/user input) — no path traversal surface.
- **Migrations / rollout:** none needed. First run starts with an empty cache dir and behaves identically to pre-change code (miss → parse → write). No schema versioning exists yet since this is the format's first version (see Open Questions).

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies |
|---|---|---|---|---|
| A1 | Wire the cache into `Tailer.onFileAdded` within this task, not deferred to a later task | Ship `warm-cache.ts` as a passive, unwired module | The acceptance criterion ("second boot on unchanged files skips parsing") is unverifiable end-to-end without this wiring; confirmed with developer in Phase A | #P2-5 acceptance criteria |
| A2 | NDJSON, one file per transcript, header line = validity key | msgpack; monolithic cache file; filename-encoded stat | Matches §5.6 exactly; isolates corruption blast radius per session; avoids fragile filename encoding | §5.6 |
| A3 | Cache directory resolved directly via `homedir()`, not through `config/settings.ts` | Depend on `config/settings.ts` | That module doesn't exist yet (#P4-15); matches `discovery.ts`'s existing homedir-resolution pattern | §10 |
| A4 | Tagged NDJSON records mirroring `ParsedLine`'s `kind` discriminant | New bespoke "compact record" type | Reuses existing types; matches #P2-4's own ARCH doc's forward-note that P2-5 should confirm this shape | §5.4, §5.6 |
| A5 | Fail-open on any corruption, non-blocking best-effort writes | Throw on corruption; block boot on write | Matches project-wide never-throw convention; matches "always safe to delete" cache invariant | §5.6 |
| A6 | Cache check happens inside `Tailer`'s existing per-file `enqueue()` chain | Check cache before enqueueing | Preserves the serialization guarantee flagged as fragile in #P2-4's PR #72 review | §5.3 (tailer serialization) |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| Cache write fails mid-boot (disk full, permission denied) | `save()` swallows the error; boot proceeds unaffected, just slower on the next boot. |
| Two processes boot concurrently against the same `~/.claude/projects` | Atomic rename-on-write means a reader never sees a half-written cache file; worst case is a redundant parse if both race before either writes — no corruption possible. |
| Transcript file renamed/moved between boots | Cache lookup is keyed by a hash of the absolute path — a moved file simply misses (new hash); the old cache entry becomes an orphan but is harmless per the "always safe to delete" invariant. No GC needed (would be scope creep for this task). |
| Cache entry written under an old `ApiCall` schema, code later changes the shape | GAP — no versioning field exists in the header. See Open Questions. |

### Backward — regression risk per touched area (brownfield only)

| Touched area (from Change Footprint) | What could regress | How we'd know / mitigation |
|---|---|---|
| `server/ingest/tailer.ts` — 11 existing passing scenarios (per PR #72's review) | Adding the optional `cache` param or the enqueue-branch could change behavior for callers that don't pass a cache | New test asserts `Tailer` constructed with no `cache` arg is behaviorally identical to today; all 11 existing scenarios re-run unmodified as a regression guard. |
| `server/ingest/tailer.ts` — per-file promise-chain serialization (flagged fragile in PR #72) | A cache-hit `onFileAdded` bypassing `readGrowth` could race a concurrent `onFileChanged` for the same file if the cache check sits outside `enqueue()` | Design places the cache check inside the existing `enqueue()` task (A6) — a dedicated test drives a cache-hit `onFileAdded` concurrently with an `onFileChanged` and asserts ordering matches the pre-existing serialization test's pattern. |

## Open Questions

- Should cache entries carry a schema/format version so a future `ApiCall` shape change can safely invalidate old entries?
  - **Impact if unresolved:** a future breaking change to `ApiCall`/`PromptTextRecord`/`ToolResultBytesRecord` could load stale-shaped cache entries into the store with no warning.
  - **Suggested default:** not needed for this task (first version of the format); the next task that changes those shapes should add a version field to `WarmCacheKey`'s header record at that time.
- Who wires `createWarmCache()` into `Tailer` at actual boot?
  - **Impact if unresolved:** the feature ships fully functional but dormant — no crash, no signal, just silently never consulted.
  - **Suggested default:** #P2-7 ("assemble the Phase 2 modules... into a runnable ingest entry point") owns this; flag it explicitly in that task's context when it starts.
- Should hit/miss/corruption counts be surfaced anywhere in this task?
  - **Impact if unresolved:** the acceptance criterion's "observable via log/health counters" phrase has no concrete implementation yet.
  - **Suggested default:** defer to the task that wires logging into `server/ingest/` (none currently exists); this task's `WarmCache.load`/`.save` return shapes are already structured to support that addition without a signature change.

## Out of Scope

- Full pipeline boot wiring (constructing `Poller` → `Tailer` → `WarmCache` → store and starting it from `app.ts`/`cli.ts`) — that's #P2-7.
- Cache entry schema versioning — deferred until a task actually changes the cached shapes (see Open Questions).
- Data Health log/counter surfacing for cache hits/misses — deferred until logging exists in `server/ingest/`.
- Orphaned cache file cleanup (stale entries for renamed/deleted transcripts) — the "always safe to delete" directory invariant makes this unnecessary.

---

# Tasks

## Task T1: WarmCache module

> **Status:** done
> **Verification:** tdd
> **Effort:** s
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** N/A — no REQ linked (plan task, ARCH is the requirements source); satisfies #P2-5 acceptance criteria (this task) via A2–A5
> **Footprint slice:** New: `server/ingest/warm-cache.ts`, `server/ingest/warm-cache.test.ts`
> **High-risk areas touched:** None (new, unconsumed module — Area of Impact "server/ingest/" rated L)

### Description

Build a standalone `(path,size,mtime)`-keyed NDJSON cache under `~/.claude-lens/cache/` that stores parsed transcript results (`ParseTranscriptResult`-shaped entries) and validates them against a file's current stat before returning a hit. This is the leaf module the Tailer integration (T2) will consume — no wiring into the ingest pipeline happens in this task.

### Test Plan

#### Test File(s)
- `server/ingest/warm-cache.test.ts` (mkdtemp-based fixtures, following `discovery.test.ts`'s pattern)

#### Test Scenarios

##### Round trip

- **returns the saved entry when key matches exactly** — GIVEN an entry saved under key `{path, size, mtime}` WHEN `load()` is called with the identical key THEN it returns an entry deep-equal to what was saved _(A2, A4)_
- **creates the cache directory lazily on first save** — GIVEN a `cacheDir` that does not yet exist WHEN `save()` is called THEN the directory is created and the entry is subsequently loadable _(A3)_

##### Cache miss conditions

- **returns null when no entry exists for the path** — GIVEN an empty cache directory WHEN `load()` is called THEN it returns `null`
- **returns null when size differs from the cached header** — GIVEN a saved entry WHEN `load()` is called with the same path/mtime but a different `size` THEN it returns `null` _(A2 — header line is the validity key)_
- **returns null when mtime differs from the cached header** — GIVEN a saved entry WHEN `load()` is called with the same path/size but a different `mtime` THEN it returns `null` _(A2)_
- **returns null when the cache file contains malformed JSON** — GIVEN a cache file with a corrupted line WHEN `load()` is called with a matching key THEN it returns `null` rather than throwing or returning a partial entry _(A5, forward stress: corrupted cache entry)_
- **returns null when a record line has an unrecognized kind** — GIVEN a cache file whose header matches but one record line has an unknown `kind` tag WHEN `load()` is called THEN it returns `null` (no partial trust) _(A5)_

##### Write resilience

- **save() resolves without throwing when the write target is unwritable** — GIVEN a `cacheDir` that cannot be created or written to (e.g. a path colliding with an existing file) WHEN `save()` is called THEN the returned promise resolves (not rejects) _(A5, forward stress: cache write fails mid-boot)_

##### Key isolation

- **different paths produce independent cache entries** — GIVEN two entries saved under different `path`s (same or different size/mtime) WHEN both are loaded back THEN each returns its own entry with no cross-contamination _(forward stress: no collision within the cache dir)_

### Implementation Notes

- **Module(s):** `server/ingest/warm-cache.ts` — owns all reads/writes under `~/.claude-lens/cache/`; leaf module, no imports from `tailer.ts`/`poller.ts`
- **Pattern reference:** `discovery.ts`'s `resolveScanConfig` for homedir-based path resolution; `parse-transcript.ts`'s tagged-union `kind` framing for the NDJSON record shape
- **Key decisions:** A2 (NDJSON, file-per-transcript, header-line validity key), A3 (homedir-resolved cache dir, no `config/settings.ts` dependency), A4 (tagged records mirroring `ParsedLine`'s `kind`), A5 (fail-open on any corruption, non-blocking best-effort writes)
- **Libraries:** `node:fs/promises`, `node:os`, `node:path`, `node:crypto` (path hashing for the cache filename) — no new dependencies
- **High-risk callouts:** None — this task has no consumers yet.

### Scope Boundaries

- Do NOT wire this module into `Tailer`, `Poller`, `app.ts`, or `cli.ts` — that's T2 (Tailer wiring) and #P2-7 (boot assembly), respectively.
- Do NOT add a schema/format version field to the cache header — deferred per ARCH Open Questions until a task actually changes the cached shapes.
- Do NOT add orphaned-cache-file cleanup/GC — the "always safe to delete" directory invariant makes this unnecessary (ARCH Out of Scope).
- Do NOT add logging or Data Health counters — deferred until logging exists in `server/ingest/` (ARCH Open Questions).

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- `server/ingest/warm-cache.ts` — `WarmCache` interface + `createWarmCache(cacheDir?)`; NDJSON read/write, atomic rename-on-write, fail-open on corruption
- `server/ingest/warm-cache.test.ts` — unit tests per the Test Plan above

**Modified files:** None.

**Must NOT modify:** _(none — this task touches no existing files)_

---

## Task T2: Tailer warm-cache integration

> **Status:** done
> **Verification:** tdd
> **Effort:** s
> **Priority:** high
> **Depends on:** T1
> **Satisfies REQs:** N/A — no REQ linked; satisfies #P2-5 acceptance criteria ("second boot on unchanged files skips parsing... corrupted cache entries fall back to parse") via A1, A6
> **Footprint slice:** Modified: `server/ingest/tailer.ts`, `server/ingest/tailer.test.ts`
> **High-risk areas touched:** `server/ingest/` (Area of Impact, risk L, additive-only per ARCH) — but touches `tailer.ts`'s previously-reviewed serialization guarantees (PR #72), which is the backward-regression focus of this task's test plan

### Description

Extend `Tailer` with an optional `WarmCache` collaborator so `onFileAdded` can skip a full transcript re-parse when the cache holds a valid entry for the file's current `(path, size, mtime)`. On a cache miss, behavior is unchanged except that the parsed result is now also written back to the cache. This is the change that makes the #P2-5 acceptance criterion ("second boot on unchanged files skips parsing") actually observable.

### Test Plan

#### Test File(s)
- `server/ingest/tailer.test.ts` (extends the existing suite; existing scenarios must continue to pass unmodified)

#### Test Scenarios

##### Cache hit behavior

- **cache hit skips the transcript read and replays cached records** — GIVEN a cache pre-populated for a file's exact `(path, size, mtime)`, with the actual transcript file deleted from disk, WHEN `onFileAdded` is called THEN it emits the cached records via `onRecords` and sets internal `offset` to `file.size` without erroring _(A1, ARCH "second boot skips parsing")_
- **cache hit seeds the dedupe seen-set** — GIVEN a cache-hit `onFileAdded` for a file whose cached entry contains call with `messageId` X, WHEN a subsequent `onFileChanged` delivers a transcript line with the same `messageId` X THEN it is treated as a duplicate and not re-emitted _(A1 — cache hit must reconstruct dedupe state correctly for live tailing to behave identically to the parsed path)_

##### Cache miss behavior

- **cache miss parses normally and writes the result to the cache** — GIVEN no matching cache entry for a file WHEN `onFileAdded` is called THEN it parses from byte 0 as before (records emitted match a plain parse) AND the result becomes loadable from the cache under that file's `(path, size, mtime)` afterward _(A1, #P2-5 acceptance: "corrupted cache entries fall back to parse" — miss path also covers corrupted-entry fallback since T1 guarantees corruption surfaces as a miss)_

##### Regression guard

- **no-cache-supplied Tailer is behaviorally unchanged** — GIVEN a `Tailer` constructed without a `cache` argument WHEN every existing scenario in this suite is run THEN all pass exactly as before this task _(guards backward-regression risk for `server/ingest/tailer.ts`'s 11 pre-existing scenarios, PR #72 baseline)_
- **cache check preserves per-file serialization** — GIVEN a cache-hit-eligible file WHEN `onFileAdded` and a concurrent `onFileChanged` for the same path are both triggered THEN they are still processed in enqueued order, not interleaved _(A6, guards backward-regression risk flagged in PR #72's review of `tailer.ts`'s promise-chain fragility)_

##### Resilience

- **a rejecting cache does not reject onFileAdded** — GIVEN a `WarmCache` stub whose `load()` rejects WHEN `onFileAdded` is called THEN the returned promise still resolves (falls through to a normal parse) _(A5/A1, forward stress: cache I/O failure must never propagate out of the tail chain)_

### Implementation Notes

- **Module(s):** `server/ingest/tailer.ts` — the only consumer of `warm-cache.ts` (T1)
- **Pattern reference:** `Tailer`'s existing `TailerEvents` constructor-injection seam (`tailer.ts:30`) for how `cache?: WarmCache` should be added as a second optional constructor param
- **Key decisions:** A1 (wire into `onFileAdded` within this task), A6 (cache check must run *inside* the existing per-file `enqueue()` chain, not before it — this is the fix for the serialization risk identified in Phase F)
- **Libraries:** none new — consumes T1's `WarmCache` interface only
- **High-risk callouts:** `tailer.ts`'s per-file promise-chain serialization was flagged as fragile in PR #72's review; placing the cache check inside `enqueue()` (A6) and the dedicated "cache check preserves per-file serialization" test directly address this.

### Scope Boundaries

- Do NOT modify `poller.ts`, `discovery.ts`, or `parse-transcript.ts` — untouched per ARCH Change Footprint.
- Do NOT construct or wire a real `WarmCache` into `app.ts`/`cli.ts` boot — that's #P2-7 (explicitly out of scope per ARCH).
- Do NOT add a schema version field, logging, or Data Health counters in this task — deferred per ARCH Open Questions (owned by T1's scope boundaries, restated here since `tailer.ts` is where they'd otherwise be tempting to bolt on).
- Only implement the `onFileAdded` cache-check branch and the miss-path `cache.save()` call — `onFileChanged` and `onFileRemoved` are unchanged per the architecture (cache only ever short-circuits the initial full-file parse).

### Files Expected

**New files:** None.

**Modified files:** _(from ARCH "Modified files / modules")_
- `server/ingest/tailer.ts` (constructor gains optional `cache?: WarmCache`; `onFileAdded`'s enqueued task branches on cache hit/miss; `readGrowth`'s success path fires a non-blocking `cache.save()` on miss)
- `server/ingest/tailer.test.ts` (new cache-hit/miss/regression/resilience scenarios per Test Plan above)

**Must NOT modify:**
- `server/ingest/poller.ts` (touched-but-not-changed — its `IngestEvents` contract and call sites are unaffected; covered by the no-cache-supplied regression guard)
- `server/ingest/parse-transcript.ts` (touched-but-not-changed — its types are consumed, not modified; schema-shape risk is a T1/ARCH Open Question, not this task's to resolve)

### TDD Sequence

1. Regression guard first (confirm the existing suite is green with the new optional constructor param, before any cache-check logic is added).
2. Cache-miss path (parse unchanged + save call) — smallest behavioral delta.
3. Cache-hit path (skip read + replay + seed dedupe) — the core new behavior.
4. Serialization and resilience tests last — they exercise the interaction between the new branch and existing concurrency/error-handling code.
