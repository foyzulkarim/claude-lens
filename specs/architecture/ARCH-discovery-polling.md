# Architecture: Discovery + polling (#P2-3)

> **Date:** 2026-07-13
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** `specs/issues/P2-3-discovery-polling.md` (GitHub #20); architecture §4 (classification, L-file location), §5.1–5.2 (discovery, polling)
> **Type:** feature

## Architecture Summary

P2-3 delivers file **discovery** and the two-speed **poller** as standalone, fully-tested modules under `server/ingest/`. Discovery is a stateless `fast-glob` snapshot that classifies each file T/C/B/L by its dot-separated name and checks the L-file (`cost-log.jsonl`) explicitly at `~/.claude/` (outside the projects glob). The poller owns a `FileRegistry` (`Map<absPath, RegisteredFile>`, keyed by absolute path — where overlapping-root dedupe happens) and runs two timers: a fast `fs.stat` loop (2–5s) that fires `onFileChanged` on growth, and a slow re-discovery loop (~30s) that fires `onFileAdded`/`onFileRemoved`. Consumers reach the pipeline through an injected `IngestEvents` callback seam; the tailer (#P2-4) will subscribe to those events and extend `RegisteredFile` with a byte `offset`. Per the decisions log, the actual wiring of discovery→poller→tailer→parser→store into app boot belongs to **#P2-7** — so P2-3 ships inert, with no change to the running server.

## Inferred Requirements (if Mode B / no REQ)

_Not applicable — requirements come from issue #20 and architecture §4/§5. Acceptance criteria (verbatim from the issue) are traced in the Decisions Log below as AC1–AC4:_

| ID  | Acceptance criterion (from #20)                                                                 |
|-----|------------------------------------------------------------------------------------------------|
| AC1 | Unit tests for classification; a file created after boot is picked up within one slow-loop interval |
| AC2 | A session whose source file is deleted is removed from the store on the next discovery pass     |
| AC3 | Overlapping scan roots do not create duplicate sessions (dedupe by absolute file path)          |
| AC4 | App boots cleanly when a configured scan root does not exist or contains no `.jsonl` files       |

## High-Level Structure

```
                 ScanConfig { roots[{path,label?}], claudeDir, fast/slowIntervalMs }
                          │
   ┌──────────────────────▼───────────────────────┐
   │  discovery.ts  (stateless)                    │
   │   classifyFilename(name) -> FileClass  (pure) │
   │   discover(config) -> DiscoveredFile[]        │
   │     • fast-glob **/*.jsonl per root           │
   │     • path.resolve + dedupe by abspath        │
   │     • explicit stat of claudeDir/cost-log.jsonl│
   └──────────────────────┬───────────────────────┘
                          │ snapshot
   ┌──────────────────────▼───────────────────────┐
   │  poller.ts   owns FileRegistry Map<abspath,RF>│
   │   slow loop ~30s: discover() -> reconcile()   │──► onFileAdded / onFileRemoved
   │   fast loop 2–5s: fs.stat registered files    │──► onFileChanged
   │   start()/stop(); runDiscovery()/pollOnce()   │        (IngestEvents seam)
   └───────────────────────────────────────────────┘
                          │
         (subscribed later by #P2-4 tailer → #P2-6 store, wired in #P2-7)
```

Everything here is **new** code under `server/ingest/`. Nothing existing is modified. The modules are not imported by `server/app.ts` boot — that assembly is #P2-7.

## Tech Choices

| Area              | Decision                                              | Alternatives Considered              | Rationale                                                                 |
|-------------------|-------------------------------------------------------|--------------------------------------|---------------------------------------------------------------------------|
| File discovery    | `fast-glob ^3.3.3` (`**/*.jsonl` per root)            | `fs.readdir` recursion; `glob`       | Already a pinned dep (arch §2); handles nested project slugs; fast        |
| Change detection  | Polling (`fs.stat`, 2–5s fast / ~30s slow)            | `chokidar` / `fs.watch`              | Arch §5.2 rejects watchers — polling has zero platform quirks, sub-second reaction not needed |
| Consumer seam     | Injected callback interface `IngestEvents`            | Node `EventEmitter`; delta returns   | Simplest typed contract; poller still owns the loop; testable with spies; enhanceable later |
| Registry identity | `Map<absolutePath, RegisteredFile>`                   | Keyed by sessionId; stateless diff   | Absolute path is the dedupe key for overlapping roots (AC3) and the future tailer offset key |

## Patterns & Conventions

- **Pure core, effectful shell** — `classifyFilename` is pure (mirrors the parser's `parseTranscriptLine` style); `discover`/poller do the fs I/O. Keeps the classification table trivially unit-testable.
- **Caller-owned state, injected collaborators** — follows the parser convention where the caller owns the `Set<string>` seen-set; here the poller takes `(config, events)` and owns the registry. No module-level singletons.
- **ESM / NodeNext imports** — `"type": "module"`, strict TS; relative source imports carry `.js` extensions (e.g. `import { classifyFilename } from "./discovery.js"`), matching `parse-transcript.ts`.
- **Never throw out of the loop** — fs errors (`ENOENT`, glob failures) are caught per-file/per-root and skipped; a malformed environment degrades to empty state (arch §5.4's "count, never throw" ethos applied to discovery).
- **Colocated vitest tests** — `*.test.ts` next to source; fixtures under `test/fixtures/`; per-test scratch dirs via `fs.mkdtemp` for premium/L cases.

## Data Models

### FileClass (classification result)

**Purpose:** the typed outcome of `classifyFilename`, carrying the tier class and (for T/C/B) the session it belongs to.

**Key fields:**
| Field    | Type / Constraint                                                                 | Notes                                              |
|----------|-----------------------------------------------------------------------------------|----------------------------------------------------|
| `kind`   | `"transcript" \| "cost" \| "turn-boundaries" \| "cost-log" \| "unknown"`          | T / C / B / L / unrecognized                       |
| `sessionId` | `string` (present for transcript/cost/turn-boundaries only)                    | filename with the recognized suffix stripped        |

**Classification rules (order matters):**
- exact `cost-log.jsonl` → `{kind:"cost-log"}` (**L**)
- `*.turn-boundaries.jsonl` → `{kind:"turn-boundaries", sessionId}` (**B**)
- `*.cost.jsonl` → `{kind:"cost", sessionId}` (**C**)
- `*.jsonl` (anything else ending `.jsonl`) → `{kind:"transcript", sessionId}` (**T**)
- otherwise → `{kind:"unknown"}`
- Dot-separated only: `<uuid>_cost.jsonl` is **not** premium — it falls through to `transcript` on the `<uuid>_cost` stem (arch §4: "Do not use underscore forms").

### RegisteredFile (registry entry)

**Purpose:** a tracked file in the poller's `FileRegistry`, holding enough state to detect growth.

**Key fields:**
| Field       | Type / Constraint          | Notes                                                       |
|-------------|----------------------------|-------------------------------------------------------------|
| `path`      | `string`, absolute, unique | Map key; the AC3 dedupe identity                            |
| `class`     | `FileClass["kind"]`        | T/C/B/L                                                     |
| `sessionId` | `string?`                  | absent for the L-file                                       |
| `root`      | `string`                   | which scan root it was discovered under                    |
| `label`     | `string?`                  | root label → future host dimension                         |
| `size`      | `number`                   | last observed byte size (growth detection)                 |
| `mtime`     | `number`                   | last observed mtime ms (growth detection)                  |
| _(offset)_  | _added by #P2-4_           | byte offset for incremental tailing — reserved, not set here |

**Lifecycle:** registered on first discovery (`onFileAdded`) → `size`/`mtime` updated on each fast-loop change (`onFileChanged`) → deleted from registry when absent from a slow-loop snapshot (`onFileRemoved`).

## API Contracts / Interfaces

### discovery.ts

**Boundary:** internal module (pure classify + fs snapshot). Imported by `poller.ts` and, later, #P2-7.

**Operations:**
| Op                 | Signature                                             | Purpose                                  | Errors / Returns                                    |
|--------------------|------------------------------------------------------|------------------------------------------|-----------------------------------------------------|
| `classifyFilename` | `(name: string) => FileClass`                        | Name → tier class (pure)                 | Never throws; unrecognized → `{kind:"unknown"}`     |
| `discover`         | `(config: ScanConfig) => Promise<DiscoveredFile[]>`  | Glob roots + explicit L check → snapshot | Missing/empty root → `[]`; catches glob/stat errors  |
| `resolveScanConfig`| `(cli: {roots?: string[]}) => ScanConfig`            | CLI/defaults → config                    | Defaults roots `[~/.claude/projects]`, claudeDir `~/.claude` |

`DiscoveredFile = { path: string; class: FileClass["kind"]; sessionId?: string; root: string; label?: string }`

### poller.ts

**Boundary:** internal module; owns the registry and the timer loop; pushes to the `IngestEvents` seam.

**Operations:**
| Op              | Signature                                     | Purpose                                            | Errors / Returns                     |
|-----------------|-----------------------------------------------|----------------------------------------------------|--------------------------------------|
| constructor     | `new Poller(config: ScanConfig, events: IngestEvents)` | Wire config + callbacks                     | —                                    |
| `start`         | `() => void`                                  | Begin fast + slow timers (after an initial discovery) | —                                 |
| `stop`          | `() => void`                                  | Clear both timers                                  | Idempotent                           |
| `runDiscovery`  | `() => Promise<void>`                         | One slow pass (discover → reconcile) — deterministic test hook | Emits added/removed       |
| `pollOnce`      | `() => Promise<void>`                         | One fast pass (stat registered files) — deterministic test hook | Emits changed; swallows ENOENT |

`IngestEvents = { onFileAdded?(f: RegisteredFile): void; onFileChanged?(f: RegisteredFile): void; onFileRemoved?(f: RegisteredFile): void }`

**Auth requirements:** none — in-process local filesystem, decoupled from HTTP (arch §5 intro).

## Module Boundaries

| Module / Package            | Responsibility                                             | Allowed Dependencies                          |
|-----------------------------|------------------------------------------------------------|-----------------------------------------------|
| `server/ingest/discovery.ts`| Classify filenames; produce a deduped discovery snapshot   | `fast-glob`, `node:path`, `node:fs`, `node:os`|
| `server/ingest/poller.ts`   | Own `FileRegistry`; run the two-speed loop; emit events    | `./discovery.js`, `node:fs`                   |
| _(consumers)_               | Subscribe to `IngestEvents` (tailer #P2-4 → store #P2-6)   | wired by #P2-7; not imported here             |

Boundary rule preserved (arch §3): `ingest/` is the only module that writes the store; `routes/` never touch the filesystem. P2-3 adds no route and no store write — it only defines the seam.

## Change Footprint

_Greenfield within an existing repo — all-new modules; the walk is shallow but the read-only hotspots matter._

### New files / modules

| Path                                   | Purpose                                                        | Pattern reference                          |
|----------------------------------------|----------------------------------------------------------------|--------------------------------------------|
| `server/ingest/discovery.ts`           | `classifyFilename`, `discover`, `resolveScanConfig`            | `server/ingest/parse-transcript.ts` (pure core) |
| `server/ingest/discovery.test.ts`      | Classification `it.each` table + `discover` over `test/fixtures` + tmpdir L-file | `server/ingest/parse-transcript.test.ts` |
| `server/ingest/poller.ts`              | `Poller` class, `FileRegistry`, `IngestEvents`                | —                                          |
| `server/ingest/poller.test.ts`         | add/change/remove events, overlap dedupe, start/stop timers   | `server/ingest/parse-transcript.test.ts`   |

### Modified files / modules

| Path        | What changes here                                                                                  |
|-------------|----------------------------------------------------------------------------------------------------|
| _(none)_    | No existing file is edited. `resolveScanConfig` is co-located in `discovery.ts`, consumed by #P2-7. |

### Deleted / replaced

| Path      | Reason        |
|-----------|---------------|
| _(none)_  | —             |

### Touched but not changed (silent-regression hotspots)

| Path                                                        | Why it matters                                                                                       |
|-------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| `test/fixtures/projects/-Users-demo-project-alpha/*.jsonl`  | **Read-only.** ⚠️ Do NOT add files here — P2-2's tests pin exact fixture counts. Premium/L test files go in a per-test `fs.mkdtemp` dir. |
| `server/cli.ts`                                             | `--roots` already parsed but unused; `resolveScanConfig` will consume it in #P2-7. No edit now.        |
| `server/app.ts`                                             | Ingest boot wiring is #P2-7; unchanged here.                                                          |
| `package.json`                                              | `fast-glob` already present — no dependency change.                                                   |

## Areas of Impact

| Area                         | Impact                                                                 | Risk (L/M/H) | Why                                                            |
|------------------------------|-----------------------------------------------------------------------|--------------|----------------------------------------------------------------|
| Ingest pipeline seam         | `IngestEvents` + `RegisteredFile` become #P2-4/#P2-7's contract        | **M**        | Designed so the tailer adds `offset` without breaking callers  |
| WS layer (`shared/ws-protocol.ts`) | Event→invalidation mapping (`SessionAdded`/`ScanUpdated`) deferred | **L**        | Mapping is #P2-7; P2-3 doesn't import or emit WS messages       |
| Running server (`app.ts`)    | None — modules not wired into boot                                     | **L**        | Ships inert; #P2-7 assembles                                   |
| P2-2 fixture tests           | Would break if new files land in the pinned fixture dir               | **L**        | Mitigated by using tmpdirs for C/B/L test files                |

**Contract changes:** none external. New internal types (`IngestEvents`, `RegisteredFile`, `FileClass`, `DiscoveredFile`, `ScanConfig`) — first consumers are #P2-4 and #P2-7.

**Cross-cutting ripples:** none into auth, telemetry, migrations, or build. Optional: accept an injected pino logger later; P2-3 keeps logging minimal/no-op to stay decoupled from Fastify.

## Cross-Cutting Concerns

- **Errors:** every fs boundary (`fast-glob`, `fs.stat`, the explicit L-file stat) is wrapped; `ENOENT` and glob failures degrade to empty/skip, never propagate. A missing or empty root yields `[]` (AC4). Removal is reported via `onFileRemoved` on the next slow pass, not by throwing.
- **Logging & metrics:** minimal. Malformed *content* is out of scope (parser's job); discovery only tracks file presence. A per-file error counter for tail/parse surfaces later on the Data Health page (#P2-6+), not here.
- **Auth / authz:** none — local, in-process, no HTTP surface.
- **Performance:** fast loop is O(files) `stat` calls every 2–5s and never reads file bodies (a 10M-line file costs one `stat`); `fast-glob` runs only on the ~30s slow loop. Suits hundreds of session files single-threaded (arch §5.7).
- **Security:** scan roots are user-supplied local paths; no traversal concern. No secrets, no network.
- **Migrations / rollout:** none. Modules are inert until #P2-7 wires them, so shipping P2-3 cannot regress the running app; "rollback" = the code is simply unreferenced.

## Architecture Decisions Log

| #   | Decision                                                                 | Alternatives                                | Chosen Because                                                                 | Satisfies |
|-----|--------------------------------------------------------------------------|---------------------------------------------|--------------------------------------------------------------------------------|-----------|
| A1  | Standalone modules + event seam; **not** wired into `buildApp()` boot     | Wire a minimal discovery into boot now      | Decisions-log assigns ingest assembly to #P2-7; keeps P2-3 shippable & inert   | AC1–AC4   |
| A2  | Injected callback interface `IngestEvents`                                | Node `EventEmitter`; delta-return only      | Simplest typed contract; poller keeps loop ownership; spy-testable; enhanceable | AC1, AC2  |
| A3  | Poller owns `FileRegistry` `Map<absPath, RegisteredFile>`                 | Keyed by sessionId; fully stateless diff    | Absolute path is the AC3 dedupe key and the future tailer offset key           | AC2, AC3  |
| A4  | `discover` stateless; poller `reconcile`s snapshot → registry            | Discovery holds mutable state               | Pure snapshot is trivially testable; poller centralizes all mutable state       | AC1, AC2  |
| A5  | Deterministic `runDiscovery()`/`pollOnce()` hooks alongside timer `start()` | Fake timers only; real short intervals only | Lets acceptance tests assert "picked up in one slow pass" without timer flake   | AC1, AC2  |
| A6  | L-file resolved once at `join(claudeDir, "cost-log.jsonl")`, checked explicitly | Per-root parent scan; glob include        | Arch §4: L lives outside the projects glob at `~/.claude/`                       | —         |
| A7  | Classify by dot-separated suffix; underscore forms → transcript stem      | Strict UUID regex; reject unknown           | Matches real capture output; arch §4 rejects underscore *premium* forms         | AC1       |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario                                        | How the Design Handles It                                                                                  |
|-------------------------------------------------|------------------------------------------------------------------------------------------------------------|
| Configured root missing / empty at boot         | `discover` catches glob failure → `[]`; poller starts with empty registry, no crash (AC4)                  |
| Root deleted mid-run                            | Slow-loop snapshot lacks its files → `onFileRemoved` + registry prune; fast-loop `stat` hits `ENOENT` → caught, loop survives (AC2) |
| Same file reached via two overlapping roots     | `Map` keyed by `path.resolve` → single registration; first root wins attribution (AC3)                     |
| Live session file grows 10K → 10M lines         | Fast loop only `stat`s (size/mtime) — O(1)/file; body reads are the tailer's job (#P2-4)                   |
| File truncated / rewritten smaller              | `size` change → `onFileChanged`; truncation *handling* (reparse from 0) is #P2-4 — P2-3 only reports        |
| New session created after boot                  | Next slow-loop `discover` → `onFileAdded` within one interval (AC1)                                         |
| Rollback if P2-3 misbehaves                     | Modules unreferenced by boot → removing/ignoring them is a no-op for the running app                        |

### Backward — regression risk per touched area

| Touched area                                              | What could regress                                   | How we'd know / mitigation                                        |
|-----------------------------------------------------------|------------------------------------------------------|-------------------------------------------------------------------|
| `test/fixtures/.../-Users-demo-project-alpha/*.jsonl`     | Adding files breaks P2-2's pinned fixture counts     | Use `fs.mkdtemp` scratch dirs for C/B/L cases; keep fixture dir read-only; `parse-transcript.test.ts` stays green |
| `server/cli.ts`, `server/app.ts`                          | Accidental boot wiring pulls #P2-7 work forward       | A1 keeps them unedited; typecheck + existing tests unchanged      |
| `package.json`                                            | Unnecessary dep churn                                 | `fast-glob` already pinned; no `npm install`                      |

## Open Questions

- **L-file location under custom `--roots`.**
  - **Impact if unresolved:** premium L totals could be missed for non-default roots.
  - **Suggested default:** resolve L once at `join(claudeDir, "cost-log.jsonl")` (default `~/.claude`), configurable via `ScanConfig.claudeDir`; revisit if per-root L files ever appear.
- **Root label → host dimension.**
  - **Impact if unresolved:** the host filter (arch §11 `host(root label)`) has no label source.
  - **Suggested default:** `ScanConfig` accepts `{path,label?}`; CLI passes paths only today; labeled roots are a later Settings concern.

## Out of Scope

- Byte-offset tailing / incremental reads (#P2-4) — P2-3 only reports that a file changed.
- Store writes, session derivation, prune-from-store (#P2-6) — P2-3 emits `onFileRemoved`; the store acts on it later.
- Warm-start cache (#P2-5).
- WS invalidation emission + full boot assembly (#P2-7).
- Parsing file *contents* (#P2-2, already done) — discovery classifies by name only.

---

# Tasks

## Task T1: Discovery — filename classification + fast-glob snapshot

> **Status:** done
> **Verification:** tdd
> **Effort:** s
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** N/A — no REQ linked; satisfies acceptance criteria AC1, AC3, AC4 (see ARCH "Inferred Requirements")
> **Footprint slice:** New: `server/ingest/discovery.ts`, `server/ingest/discovery.test.ts`
> **High-risk areas touched:** None (T1's only Area of Impact entry, "Ingest pipeline seam," is M-risk but is the *contract* T1 defines, not a risk T1 absorbs from elsewhere)

### Description

Deliver `classifyFilename` (pure T/C/B/L filename classification per arch §4's dot-separated convention) and `discover` (a stateless `fast-glob` snapshot over configured scan roots, deduped by absolute path, plus an explicit check of the L-file at `claudeDir/cost-log.jsonl`). Also deliver `resolveScanConfig` to turn CLI `--roots` into a `ScanConfig`. This is the pure/read-only half of the ingest seam — poller (T2) builds its stateful registry on top of this.

### Test Plan

#### Test File(s)
- `server/ingest/discovery.test.ts`

#### Test Scenarios

##### classifyFilename — tier classification

- **classifies the exact L-file name** — GIVEN the filename `cost-log.jsonl` WHEN `classifyFilename` runs THEN it returns `{kind:"cost-log"}` with no `sessionId` _(verifies AC1)_
- **classifies a turn-boundaries file** — GIVEN `<uuid>.turn-boundaries.jsonl` WHEN classified THEN it returns `{kind:"turn-boundaries", sessionId:<uuid>}` _(verifies AC1)_
- **classifies a cost file** — GIVEN `<uuid>.cost.jsonl` WHEN classified THEN it returns `{kind:"cost", sessionId:<uuid>}` _(verifies AC1)_
- **classifies a plain transcript file** — GIVEN `<uuid>.jsonl` WHEN classified THEN it returns `{kind:"transcript", sessionId:<uuid>}` _(verifies AC1)_
- **rejects underscored premium variants** — GIVEN `<uuid>_cost.jsonl` WHEN classified THEN it returns `{kind:"transcript", sessionId:"<uuid>_cost"}`, NOT `{kind:"cost", ...}` _(verifies AC1; A7 — arch §4 "do not use underscore forms")_
- **classifies unrecognized names as unknown** — GIVEN `notes.txt` WHEN classified THEN it returns `{kind:"unknown"}` _(verifies AC1)_
- **never throws on degenerate input** — GIVEN an empty string or `.jsonl` alone WHEN classified THEN no exception is thrown and a `{kind:"unknown"}`-shaped result is returned

##### discover — snapshot over real and synthetic roots

- **discovers fixture transcripts** — GIVEN `test/fixtures/projects/-Users-demo-project-alpha` as the sole root WHEN `discover` runs THEN it returns 3 transcript entries whose `sessionId` matches each fixture file's UUID stem _(verifies AC1)_
- **dedupes overlapping roots** — GIVEN two configured roots that resolve to the same directory WHEN `discover` runs THEN each file appears exactly once in the result, keyed by absolute path _(verifies AC3)_
- **tolerates a missing root** — GIVEN a root path that does not exist WHEN `discover` runs THEN it returns `[]` for that root without throwing _(verifies AC4)_
- **tolerates an empty root** — GIVEN an `fs.mkdtemp` root containing no `.jsonl` files WHEN `discover` runs THEN it returns `[]` without throwing _(verifies AC4)_
- **classifies premium files in a synthetic root** — GIVEN an `fs.mkdtemp` root containing `<uuid>.cost.jsonl` and `<uuid>.turn-boundaries.jsonl` WHEN `discover` runs THEN both appear correctly classified with matching `sessionId`s
- **discovers the L-file explicitly** — GIVEN a synthetic `claudeDir` containing `cost-log.jsonl` WHEN `discover` runs THEN the result includes one `{kind:"cost-log"}` entry with no `sessionId` _(verifies A6 — arch §4 L-file location)_
- **tolerates a missing L-file** — GIVEN a synthetic `claudeDir` without `cost-log.jsonl` WHEN `discover` runs THEN no cost-log entry appears and nothing throws

##### resolveScanConfig — CLI/defaults to ScanConfig

- **defaults to the standard root and claudeDir** — GIVEN no CLI roots WHEN `resolveScanConfig` runs THEN `roots` is `[{path: "~/.claude/projects"}]` and `claudeDir` is `homedir()/.claude`
- **claudeDir stays fixed under custom roots** — GIVEN CLI `--roots` pointing elsewhere WHEN `resolveScanConfig` runs THEN `claudeDir` is still `homedir()/.claude`, independent of the custom roots _(confirmed default, resolving the ARCH open question)_

##### Regression Guard

_None — T1 introduces no changes to existing files; `discover`'s fixture-directory scenario only reads `test/fixtures/`, never writes to it, so `parse-transcript.test.ts`'s pinned counts are unaffected by construction._

### Implementation Notes

- **Module(s):** `server/ingest/discovery.ts` (per ARCH Module Boundaries: depends only on `fast-glob`, `node:path`, `node:fs`, `node:os`)
- **Pattern reference:** `server/ingest/parse-transcript.ts` — pure core (`classifyFilename` mirrors `parseTranscriptLine`'s pure-function style); `server/ingest/parse-transcript.test.ts` — `it.each` table style, `fs.mkdtemp`-free fixture reading via `readFileSync`/`join(__dirname, "..", "..", "test", "fixtures", ...)`
- **Key decisions:** A4 (discover is stateless — no registry here, that's T2), A6 (L-file resolved once at `claudeDir/cost-log.jsonl`, checked explicitly outside the glob), A7 (dot-separated classification order: exact L-name → B suffix → C suffix → T fallback → unknown)
- **Libraries:** `fast-glob ^3.3.3` (already a pinned dependency — no `npm install` needed)
- **High-risk callouts:** None directly — T1 defines the `DiscoveredFile`/`FileClass`/`ScanConfig` shapes that T2 and later #P2-4/#P2-7 build on; keeping these exactly as specified in ARCH's API Contracts section avoids downstream breakage.

### Scope Boundaries

- Do NOT read or parse file *contents* — classification and discovery are filename/stat-only (ARCH Out of Scope: "Parsing file contents is #P2-2, already done")
- Do NOT add files to `test/fixtures/projects/-Users-demo-project-alpha/` — use `fs.mkdtemp` scratch dirs for any C/B/L or edge-case fixtures
- Do NOT implement the registry, polling loop, or `IngestEvents` — that is T2
- Do NOT wire `resolveScanConfig`/`discover` into `server/cli.ts` or `server/app.ts` boot — that is #P2-7 (ARCH Decision A1)

### Files Expected

**New files:**
- `server/ingest/discovery.ts` — `classifyFilename`, `discover`, `resolveScanConfig`, and the `FileClass`/`DiscoveredFile`/`ScanConfig` types
- `server/ingest/discovery.test.ts` — classification table + discover/resolveScanConfig scenarios above

**Modified files:**
_None._

**Must NOT modify:**
- `test/fixtures/projects/-Users-demo-project-alpha/*.jsonl` (silent-regression hotspot — P2-2's pinned fixture counts; T1 only reads this dir)
- `server/cli.ts`, `server/app.ts` (out of scope per ARCH — boot wiring is #P2-7)
- `package.json` (`fast-glob` already present — no dependency change)

---

## Task T2: Poller — FileRegistry + two-speed polling loop

> **Status:** done
> **Verification:** tdd
> **Effort:** m
> **Priority:** high
> **Depends on:** T1
> **Satisfies REQs:** N/A — no REQ linked; satisfies acceptance criteria AC1, AC2, AC3, AC4
> **Footprint slice:** New: `server/ingest/poller.ts`, `server/ingest/poller.test.ts`
> **High-risk areas touched:** Ingest pipeline seam (M) — `IngestEvents`/`RegisteredFile` become #P2-4/#P2-7's contract; addressed by keeping the interface exactly as specified in ARCH so `offset` can be added later without breaking callers

### Description

Deliver the `Poller` class: it owns a `FileRegistry` (`Map<absPath, RegisteredFile>`) built on T1's `discover`, runs a fast `fs.stat` loop (2–5s) that detects growth and a slow re-discovery loop (~30s) that detects new/removed files, and reports all three via an injected `IngestEvents` callback interface. This is the stateful half of the ingest seam that #P2-4 (tailer) will subscribe to and extend.

### Test Plan

#### Test File(s)
- `server/ingest/poller.test.ts`

#### Test Scenarios

##### Poller — discovery reconciliation

- **registers a newly discovered file** — GIVEN a fresh `Poller` over an `fs.mkdtemp` root with one file WHEN `runDiscovery()` is called THEN `onFileAdded` fires once with a `RegisteredFile` matching that file's path/class/sessionId/size/mtime _(verifies AC1)_
- **picks up a file added after boot within one slow-loop pass** — GIVEN a running registry WHEN a new file is added to the root and `runDiscovery()` is called again THEN `onFileAdded` fires only for the new file _(verifies AC1)_
- **prunes a deleted file on the next discovery pass** — GIVEN a registered file WHEN it is deleted from disk and `runDiscovery()` is called THEN `onFileRemoved` fires once and the entry is removed from the registry; a further `runDiscovery()` does not re-fire removal for the same path _(verifies AC2)_
- **dedupes overlapping roots** — GIVEN two configured roots resolving to the same directory WHEN `runDiscovery()` is called THEN the registry contains one entry for the shared file and `onFileAdded` fires exactly once _(verifies AC3)_
- **boots cleanly on a missing/empty root** — GIVEN a `Poller` configured with a non-existent or empty root WHEN `start()` is called THEN no exception is thrown and the registry stays empty _(verifies AC4)_

##### Poller — fast-loop stat detection

- **detects growth** — GIVEN a registered file WHEN bytes are appended to it and `pollOnce()` is called THEN `onFileChanged` fires with the updated `size`/`mtime` _(verifies ARCH forward stress-test: "live session file grows")_
- **stays silent with no change** — GIVEN a registered file WHEN nothing changes on disk and `pollOnce()` is called THEN no event fires
- **survives a file deleted between registration and stat** — GIVEN a registered file WHEN it is deleted before `pollOnce()` runs THEN the resulting `ENOENT` is caught, no exception propagates, and no `onFileChanged` fires (removal is deferred to the next slow-loop pass) _(verifies ARCH forward stress-test: "root deleted mid-run")_
- **reports truncation as a change, not a special case** — GIVEN a registered file WHEN it is truncated to a smaller size and `pollOnce()` is called THEN `onFileChanged` still fires (size differs from the stored value); no reparse/truncation logic runs here _(verifies ARCH forward stress-test: "file truncated/rewritten" — P2-3 only reports, #P2-4 handles the reparse)_

##### Poller — timer lifecycle

- **start() schedules both loops** — GIVEN a `Poller` with fake timers WHEN `start()` is called and time is advanced by the fast interval THEN a stat pass runs (observable via a file-growth event); advancing further by the slow interval runs a discovery pass (observable via an add/remove event)
- **stop() halts both loops** — GIVEN a running `Poller` WHEN `stop()` is called and time is advanced past both intervals THEN no further events fire

##### Regression Guard

_None — T2 imports only `./discovery.js` (T1) and touches no existing file. Not modifying `server/cli.ts`, `server/app.ts`, `package.json`, or the pinned fixture directory is enforced by the Files Expected boundary below, not by a runtime test._

### Implementation Notes

- **Module(s):** `server/ingest/poller.ts` (per ARCH Module Boundaries: depends on `./discovery.js` and `node:fs`)
- **Pattern reference:** `server/ingest/parse-transcript.test.ts` for vitest structure/`describe` naming; use `vi.useFakeTimers()`/`vi.advanceTimersByTime()` for the timer-lifecycle scenarios (no real-time sleeps)
- **Key decisions:** A2 (injected `IngestEvents` callback interface — poller owns the loop, calls back), A3 (registry keyed by absolute path — this is where AC3 dedupe happens, and where #P2-4 will add `offset`), A4 (poller centralizes all mutable state; `discover` from T1 stays stateless), A5 (expose `runDiscovery()`/`pollOnce()` deterministic hooks alongside `start()`/`stop()` so tests don't depend on real timer flake)
- **Libraries:** none beyond T1's `fast-glob` (transitively) and Node built-ins
- **High-risk callouts:** Ingest pipeline seam (M) — `IngestEvents`/`RegisteredFile` are the exact shapes #P2-4 will consume and extend with `offset`; implement them precisely per ARCH's API Contracts section (do not rename fields or change callback arity) so the seam holds without a follow-up break.

### Scope Boundaries

- Do NOT implement byte-offset tailing, incremental reads, or truncation reparse — that is #P2-4 (ARCH Out of Scope)
- Do NOT write to any store or derive sessions/turns — that is #P2-6 (ARCH Out of Scope); `onFileRemoved` only fires the callback, it does not touch any store
- Do NOT emit WS invalidation messages or import `shared/ws-protocol.ts` — that mapping is #P2-7 (ARCH Out of Scope)
- Do NOT wire `Poller` into `server/cli.ts` or `server/app.ts` boot — that is #P2-7 (ARCH Decision A1)
- Do NOT use `chokidar` or `fs.watch` — polling only, per ARCH Tech Choices

### Files Expected

**New files:**
- `server/ingest/poller.ts` — `Poller` class, `FileRegistry`, `RegisteredFile`, `IngestEvents` types
- `server/ingest/poller.test.ts` — reconciliation + fast-loop + timer-lifecycle scenarios above

**Modified files:**
_None._

**Must NOT modify:**
- `server/ingest/discovery.ts` (T1's deliverable — poller only imports it)
- `test/fixtures/projects/-Users-demo-project-alpha/*.jsonl` (silent-regression hotspot — poller tests use `fs.mkdtemp`, never this dir)
- `server/cli.ts`, `server/app.ts` (out of scope per ARCH — boot wiring is #P2-7)
- `package.json` (no dependency change)

### TDD Sequence (optional)

Build in this order: (1) registry construction + `runDiscovery()`'s add/remove reconciliation against T1's `discover`, since everything else depends on a populated registry; (2) `pollOnce()`'s stat-based change detection; (3) `start()`/`stop()` timer wiring last, once the two deterministic hooks are proven correct in isolation.
