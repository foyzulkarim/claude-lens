# Architecture: Gates engine (#P4-11 / #43)

> **Date:** 2026-07-19
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone brief — `specs/issues/P4-11-gates-engine.md` + `specs/gates.md` (binding over the brief)
> **Type:** feature (brownfield — Phase D2 is the center of gravity)

## Architecture Summary

A pure, deterministic **gates engine** lives in a new `server/gates/` directory and evaluates seven gate IDs (V1, V2, P3, C3, K2, E1, E2) across six checks over the post-`deriveSession()` store output (sessions, turns, calls) plus a filesystem check for E1/E2. The engine is a single function `evaluateSessionGates({ session, turns, calls, cwd }, thresholds) → GateReport`; K2 imports (not reimplements) `classifyCacheWrite` from `server/cache/classifier.ts` (#P4-9 / #41), and the TTL attribution overlay stays out of K2's scope. A new HTTP route `GET /api/sessions/:id/gates` returns the `GateReport` to #P4-12 (Report Card UI, Dashboard gate feed, Sessions gate-score column) and #P4-15 (Settings UI). Threshold configuration is a separate concern — `server/gates/thresholds.ts` reads `~/.claude-lens/config.json` and merges any user-set values over `gates.md` defaults; the engine itself never reads disk. Six new fixture sessions extend `test/fixtures/projects/-Users-demo-project-alpha/` under the existing README convention.

## Inferred Requirements

The issue body and `gates.md` together form the contract. There is no separate `REQ-*.md`. The following inferred-requirement IDs mirror the acceptance-criteria bullets in the issue body so `generate-tasks` has something to trace tasks against; everything else traces back to `gates.md`.

| ID  | Inferred Requirement | Source |
|-----|----------------------|--------|
| R1  | Engine ships six checks (seven gate IDs) sharing one preprocess pipeline and one scoring formula | `gates.md` §"V1 — Edit-without-verify" through §"E1/E2 — CLAUDE.md missing / bloated" + §"Report Card scoring"; issue scope |
| R2  | Shared preprocessing: dedupe by `message.id` (already done at ingest), exclude `isSidechain: true` calls, classify `Edit`/`Write` vs `Bash` tool_use blocks | `gates.md` §"Shared preprocessing" |
| R3  | Each gate emits `{ gateId, status: pass \| warn \| fail, evidence: GateEvidence[] }` with the asymmetric shape per `gates.md` §1: V1/V2/P3/C3/K2 evidence is turn-keyed (`turnN`, `callId`); E1/E2 evidence is session-scoped (`filePath`, `detail` only) | `gates.md` §1 + decisions log 2026-07-06 |
| R4  | Per-gate scenario fixtures added under the #P0-3 `test/fixtures/` README convention | `specs/claude-lens-plan.md` line 192; existing `test/fixtures/README.md` |
| R5  | K2 imports the miss-attribution classifier built in #P4-9 (#41) — does not reimplement it | issue body "Dependencies"; `server/cache/classifier.ts` already exists |
| R6  | Engine ships configurable-threshold plumbing + defaults; the Settings UI for threshold editing belongs to #P4-15 | issue body; `gates.md` §"Configurable constants" |
| R7  | E1/E2 evidence is `{ filePath, detail }` only — consumers must not assume evidence is turn-keyed | issue body; `gates.md` §1 |
| R8  | Per-gate fixture tests including N/A-turn denominators and E1/E2 filesystem checks (labeled "as of now") | issue acceptance criteria |
| R9  | V1 applies the softer final-turn framing: a session with only its last turn failing (edit with no later verify) is not scored the same as a mid-session failing turn | issue acceptance criteria |
| R10 | V2 detects repeated failing commands via `tool_result.is_error` and exit-code markers in result content | issue acceptance criteria; `gates.md` §"V2" |
| R11 | P3 treats a user-message attachment containing the target file path as a prior read | issue acceptance criteria; `gates.md` §"P3" |
| R12 | C3 evidence includes the recurring-cost estimate `size/4 tokens × remaining API calls in session`, not just the raw result size | issue acceptance criteria; `gates.md` §"C3" |
| R13 | K2 fixture tests cover all four classifier branches (first-call, model-switch, compaction, unexplained) and report which one fired | issue acceptance criteria; `gates.md` §"K2" |
| R14 | E1/E2 size total follows `@import` references one level, per `gates.md` | issue acceptance criteria; `gates.md` §"E1/E2" |
| R15 | Report Card session scoring = `passes / (passes + 0.5·warns + fails)` across the six checks (E1/E2 collapse to one) | `gates.md` §"Report Card scoring" |

## High-Level Structure

```
        ┌──────────────────────────────────────────────────────────┐
HTTP:   │  GET /api/sessions/:id/gates                            │  (new route)
        └─────────────────────────────┬────────────────────────────┘
                                      │
                                      ▼
        ┌──────────────────────────────────────────────────────────┐
        │  server/gates/engine.ts                                  │
        │    evaluateSessionGates({ session, turns, calls, cwd }, │
        │                            thresholds) → GateReport      │
        └─────────────────────────────┬────────────────────────────┘
                                      │
                                      ▼
        ┌──────────────────────────────────────────────────────────┐
        │  server/gates/preprocess.ts                              │
        │    - filter sidechain calls (R2)                         │
        │    - normalize Bash command strings for V2 (R10)         │
        │    - materialize per-session prompt text for P3 (R11)    │
        └─────────────────────────────┬────────────────────────────┘
                                      │
            ┌──────────┬───────────┬───────────┬───────────┬───────────┐
            ▼          ▼           ▼           ▼           ▼           ▼
        ┌──────┐  ┌──────┐    ┌──────┐    ┌──────┐    ┌──────┐    ┌──────┐
        │ V1   │  │ V2   │    │ P3   │    │ C3   │    │ K2   │    │ E1E2 │
        │      │  │      │    │      │    │      │    │      │    │      │
        └──────┘  └──────┘    └──────┘    └──────┘    └──────┘    └──────┘
                                                              │           │
                                                              ▼           ▼
                                            classifyCacheWrite   node:fs/promises
                                            (server/cache/        readFile for
                                             classifier.ts)       CLAUDE.md + @imports
                                                              │
                                                              └──────────┐
                                                                         ▼
        ┌──────────────────────────────────────────────────────────┐
        │  server/gates/thresholds.ts                              │
        │    getGateThresholds(config) → GateThresholds            │
        │    readConfig() ─► merge with defaults ─► return         │
        └──────────────────────────────────────────────────────────┘
                                      │
                                      ▼
                            GateReport {
                              sessionId,
                              gates: [GateResult; 7],
                              score: number,         // R15
                              scoreLetter: "A"|"B"|"C"|"D"|"F",
                              evaluatedAt: ISO8601,
                              thresholdsUsed: GateThresholds
                            }
```

The engine is a pure function with no I/O; the route layer is the only place that reads `cwd` and calls `node:fs`. `getGateThresholds` is called by the route, never by the engine.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|------|----------|--------------------------|-----------|
| Engine shape | Pure function `evaluateSessionGates(input, thresholds) → GateReport` | Class with state; method on Session | Mirrors existing pattern (`server/cache/classifier.ts` is also a pure function module); keeps the engine unit-testable without DI ceremony |
| File layout | One file per gate under `server/gates/` (`v1.ts`, `v2.ts`, `p3.ts`, `c3.ts`, `k2.ts`, `e1e2.ts`) | Single `gates.ts` with all checks inline | Mirrors the existing `server/cache/classifier.ts` + `server/cache/analysis.ts` split; isolates each gate's evidence shape and branch logic for fixture regression; #P4-12's UI will read each gate independently |
| K2 reuse | Import `classifyCacheWrite`, `MAIN_STREAM_KEY`, `ClassifiedBaseCause`, `ClassifierTrace` from `server/cache/classifier.ts`; do NOT import `attributeCacheMiss` | Reimplement classifier in gates/; import both classifier and attribution overlay | `gates.md` K2 only cares about `unexplained` base cause — the TTL overlay is Cache Lab's verdict chip concern, mixing it in would double-attribute |
| Threshold source | New `server/gates/thresholds.ts` resolves `config.gateThresholds` over `gates.md` defaults | Inline defaults in engine; read inside engine | Keeps engine pure (no I/O); lets #P4-15's Settings UI pass a fully-resolved threshold object directly without re-reading disk |
| Settings wire shape | `gateThresholds?: Partial<GateThresholds>` field on `AppConfig`; engine receives fully-typed `GateThresholds` | Separate config file; per-threshold top-level fields on `AppConfig` | `server/settings.ts` already round-trips unknown keys via `{ ...DEFAULT_CONFIG, ...parsed }` — adding an optional nested field is the minimum-blast-radius extension. Top-level fields would clutter `AppConfig` and break the convention that `AppConfig` mirrors the file shape |
| Route | New `GET /api/sessions/:id/gates` returning `GateReport` | Fold into existing `GET /api/sessions/:id`; POST-style explicit "evaluate" endpoint | The gates are independent of session-detail rollups; #P4-12 fans out from this one route (Report Card, Dashboard feed, Sessions column). Folding into session-detail would balloon that route's contract and force every consumer to opt out |
| HTTP errors | Route returns 404 when session not found (matches existing pattern); 500 with `{ error, cause }` on filesystem/parse failure; 400 on invalid `gateThresholds` in PUT (if Settings passes invalid PUT — engine itself never validates) | Custom error code per failure mode | Matches `server/routes/config.ts` and `server/routes/session-detail.ts` style; engine never throws on user-data bad input, only the route translates IO failures |
| Filesystem access | `node:fs/promises.readFile` (matches `server/settings.ts`, `server/ingest/warm-cache.ts`) | `node:fs` sync; third-party fs helper | Existing project pattern; async keeps the route non-blocking |
| E1/E2 `@import` walker | Hand-rolled 1-level regex `@import\s+(?:"|')([^"']+)(?:"|')` over the resolved CLAUDE.md text, resolving the path relative to the importer's directory | Full markdown parser; deep `@import` chain | `gates.md` §E1/E2 says "one level only"; a regex is deterministic and matches the gates.md contract without a new dependency |
| Test framework | Vitest (matches `server/cache/*.test.ts`, `shared/*.test.ts`) | Jest, node:test | Existing project standard |
| Fixture location | New entries under `test/fixtures/projects/-Users-demo-project-alpha/` with new UUIDs; existing 5555… session is reused as K2's pass-case fixture | Separate `test/fixtures/gates/` tree | Existing README convention; keeps a single fixture scan root for ingest |

## Patterns & Conventions

- **Pure-function module pattern** — applied from `server/cache/classifier.ts`. Affects: every gate file plus `engine.ts` and `preprocess.ts`. No class state, no module-level mutation, no `Date.now()` / `Math.random()` (deterministic — required by the per-gate fixture regression tests in R8).
- **Engine never reads disk** — applied because `gates.md` says all six checks are "deterministic rules evaluated over the canonical `parseSession()` output plus a filesystem check". The filesystem check (E1/E2) lives in `e1e2.ts`, the route calls it; the engine composes gate results. Affects: `server/gates/engine.ts`, `server/gates/thresholds.ts`.
- **Sidechain exclusion happens once** in `preprocess.ts`; downstream gates see only main-chain data. Affects: every gate file.
- **Evidence shape asymmetry is enforced at the type level** — `GateEvidence` is `{ turnN?: number; callId?: string; filePath?: string; detail: string }`. Turn-keyed gates set `turnN`/`callId`; E1/E2 sets `filePath`/`detail` only. The route serializes verbatim; #P4-12 must not assume turn keys on every entry.
- **No new dependency** — every technique is either already in the project (Vitest, Fastify, `node:fs/promises`) or a hand-rolled regex. The classifier is reused, not forked.
- **Settings file is loose** — `server/settings.ts` round-trips unknown keys, so adding `gateThresholds` cannot destroy `budget` or any future #P4-15 field.

## Data Models

### `GateEvidence`

**Purpose:** One piece of evidence a gate produces. The shape is asymmetric — turn-keyed fields are optional, session-scoped fields are optional, but the type itself is uniform so consumers can iterate one array per gate.

**Key fields:**

| Field | Type / Constraint | Notes |
|-------|-------------------|-------|
| `turnN` | `number?` | 1-indexed turn number within the session (main chain only). Set by V1, V2, P3, C3, K2. Never set by E1/E2. |
| `callId` | `string?` | `ApiCall.messageId` of the offending call. Turn-keyed gates set this; E1/E2 does not. |
| `filePath` | `string?` | Absolute or cwd-relative path. P3 sets it to the unread file; E1/E2 sets it to the resolved CLAUDE.md path(s). |
| `detail` | `string` | Human-readable explanation. Always present. Examples: `"last edit was Write(/a/b.ts); no command followed"` (V1); `"size/4 tokens × N remaining calls"` (C3); `"baseCause: unexplained; trace…"` (K2); `"checked: <path>, size=1234 chars / 45 lines"` (E1/E2) |

**Relationships:** child of `GateResult`; many per gate.

**Lifecycle:** created during `evaluateSessionGates` evaluation; serialized in `GateReport`; consumed read-only by #P4-12's UI.

### `GateResult`

**Purpose:** One gate's verdict for a session.

**Key fields:**

| Field | Type / Constraint | Notes |
|-------|-------------------|-------|
| `gateId` | `"V1" \| "V2" \| "P3" \| "C3" \| "K2" \| "E1" \| "E2"` | The seven gate IDs from `gates.md`. |
| `status` | `"pass" \| "warn" \| "fail"` | Per gates.md §"Report Card scoring" roll-up. |
| `evidence` | `GateEvidence[]` | Empty for clean passes (e.g. V1 with no edit turns is N/A and emits zero evidence; K2 with no spikes is pass with zero evidence). |

**Relationships:** child of `GateReport`; one per gate ID.

### `GateReport`

**Purpose:** Top-level engine output for one session.

**Key fields:**

| Field | Type / Constraint | Notes |
|-------|-------------------|-------|
| `sessionId` | `string` | Mirrors `Session.sessionId`. |
| `gates` | `GateResult[7]` | Exactly seven entries, one per gate ID. Order matches `gates.md` prose order: V1, V2, P3, C3, K2, E1, E2. |
| `score` | `number` | `passes / (passes + 0.5·warns + fails)` across six checks (E1+E2 collapse to one). N/A turns/gates excluded from the denominator per `gates.md` §"Report Card scoring". |
| `scoreLetter` | `"A" \| "B" \| "C" \| "D" \| "F"` | Bucketed from `score`: `≥0.9` A, `≥0.75` B, `≥0.5` C, `≥0.25` D, `<0.25` F. Display only — the engine outputs both so #P4-12's UI doesn't have to re-bucket. |
| `evaluatedAt` | `string` (ISO-8601) | Set by the route layer (engine is pure). |
| `thresholdsUsed` | `GateThresholds` | Echoed for UI transparency; lets the Settings UI show "you scored this with defaults" vs custom values. |

### `GateThresholds`

**Purpose:** Resolved threshold values for all configurable gates.

**Key fields:**

| Field | Type / Constraint | Notes |
|-------|-------------------|-------|
| `v2Repeat` | `number ≥ 1` (default `3`) | `gates.md` §V2. |
| `c3MaxChars` | `number ≥ 0` (default `15_000`) | `gates.md` §C3. |
| `k2Spike` | `number ≥ 0` (default `10_000`) | `gates.md` §K2. Mirrors `K2_SPIKE_THRESHOLD` in `server/cache/classifier.ts`. |
| `e2MaxChars` | `number ≥ 0` (default `4_000`) | `gates.md` §E1/E2. |
| `e2MaxLines` | `number ≥ 0` (default `60`) | `gates.md` §E1/E2. |

**Relationships:** input to `evaluateSessionGates`; output of `getGateThresholds` (which reads `AppConfig.gateThresholds` and merges over these defaults).

**Lifecycle:** resolved per-route-call (cheap; just an object merge). Memoization is out of scope unless profiling later demands it.

### Settings extension: `AppConfig.gateThresholds`

**Purpose:** User-tunable override for gate thresholds, persisted in `~/.claude-lens/config.json`.

**Shape:** `Partial<GateThresholds>` — every field optional; `getGateThresholds` fills missing fields with the defaults above.

**Why optional nested field:** `server/settings.ts` already merges unknown keys via `{ ...DEFAULT_CONFIG, ...parsed }` — adding a nested field is the minimum-blast-radius extension and #P4-15 can extend further without touching this task's code.

## API Contracts / Interfaces

### `server/gates/engine.ts`

**Boundary:** internal library API (server-only).

**Operations:**

| Op | Signature | Purpose | Errors / Returns |
|----|-----------|---------|-------------------|
| `evaluateSessionGates` | `(input: { session: Session; turns: Turn[]; calls: ApiCall[]; cwd: string }, thresholds: GateThresholds) => GateReport` | Pure function — evaluates all seven gates, aggregates evidence, computes session score. | Returns a `GateReport`. Never throws on user-data bad input (parse failures in upstream layers are out of scope; the engine treats malformed inputs as deterministic facts and may emit a warn/fail or pass per the gate's own rules). |

**Auth requirements:** none at this layer; the route handler enforces HTTP-level concerns.

### `server/gates/thresholds.ts`

**Boundary:** internal library API.

**Operations:**

| Op | Signature | Purpose | Errors / Returns |
|----|-----------|---------|-------------------|
| `getGateThresholds` | `(config: AppConfig) => GateThresholds` | Resolves a fully-typed `GateThresholds` by merging `config.gateThresholds` (partial) over `gates.md` defaults. | Returns a complete `GateThresholds`. Never throws. Missing/invalid fields default. |
| `isValidGateThresholds` | `(value: unknown) => value is Partial<GateThresholds>` | Per-field validation used by the route (and later by #P4-15's Settings UI form) to reject malformed `PUT /api/config` payloads before persisting. | Returns boolean. |

### `server/routes/gates.ts`

**Boundary:** HTTP API.

**Operations:**

| Method | Path | Purpose | Errors / Returns |
|--------|------|---------|-------------------|
| `GET` | `/api/sessions/:id/gates` | Returns `GateReport` for the given session. Reads the session, turns, calls from the existing store; resolves thresholds via `getGateThresholds(await readConfig())`; calls `evaluateSessionGates`. | 200 + `GateReport`; 404 if session not found; 500 + `{ error, cause }` on filesystem/parse failure (E1/E2 IO). |

**Auth requirements:** same as existing `/api/sessions/:id` and `/api/config` — local-only, no auth layer in V2.

### `server/routes/config.ts` (extended)

**Boundary:** HTTP API.

**Operations:**

| Method | Path | Purpose | Errors / Returns |
|--------|------|---------|-------------------|
| `PUT` | `/api/config` (existing) | Now also accepts `gateThresholds` in the body. Validates each field via `isValidGateThresholds`; merges onto `~/.claude-lens/config.json` via `writeConfig` (existing merge, no shape change to the budget path). | 200 + updated `AppConfig`; 400 if `gateThresholds` contains invalid fields. |

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|------------------|----------------|----------------------|
| `server/gates/` | Pure gate evaluation logic — preprocess, per-gate checks, scoring | `shared/types`, `shared/cache-lab-contract`, `server/cache/classifier` (for K2 only), `shared/settings-contract` (for `GateThresholds` type), `server/store/token-usage` (only if a gate needs to roll up tokens — likely not). **Never imports `node:fs`**, **never reads `~/.claude-lens/config.json` directly**. |
| `server/gates/e1e2.ts` | The single file in `server/gates/` allowed to import `node:fs/promises` for the filesystem check | As above + `node:fs/promises`. |
| `server/routes/gates.ts` (new) | HTTP layer for `/api/sessions/:id/gates`; calls engine, translates IO failures to HTTP errors | `server/gates/engine`, `server/gates/thresholds`, `server/store/store`, `server/settings`, existing Fastify route patterns. |
| `server/routes/config.ts` (existing, extended) | Validates + persists `gateThresholds` alongside `budget` | Existing deps + `server/gates/thresholds`. |
| `server/cache/classifier.ts` (existing) | Owns `classifyCacheWrite` + `partitionCacheStreams`; K2 reads from it | No new dependencies; contract surface unchanged. |
| `shared/cache-lab-contract.ts` (existing) | Owns `ClassifierTrace`, `CacheWriteCause` types reused by K2's evidence | No change. |
| `shared/settings-contract.ts` (existing, extended) | Owns `AppConfig`; gains `gateThresholds?: Partial<GateThresholds>` | No change to validation surface; only adds one optional field. |

## Change Footprint

_The concrete answer to "where does this land in the codebase?"_

### New files / modules

| Path | Purpose | Pattern reference |
|------|---------|-------------------|
| `server/gates/preprocess.ts` | Filter sidechain, normalize Bash command strings, materialize prompt text index keyed by turnN | `server/cache/classifier.ts`'s `partitionCacheStreams` |
| `server/gates/v1.ts` | V1 — Edit-without-verify (R1, R9). Exports `evaluateV1({turns, preprocessed}, thresholds): GateResult`. | Single-gate module |
| `server/gates/v2.ts` | V2 — Failing-command loop (R1, R10). Bash command normalization + `tool_result.is_error` + exit-code marker detection. | Single-gate module |
| `server/gates/p3.ts` | P3 — Code-before-read (R1, R11). Walks edits, checks prior `Read` tool_use + prompt-text `@path` mention. | Single-gate module |
| `server/gates/c3.ts` | C3 — Fat tool result (R1, R12). Iterates main-chain `tool_result` content sizes; computes recurring-cost estimate from `size/4 × remaining calls in session`. | Single-gate module |
| `server/gates/k2.ts` | K2 — Unexplained cache invalidation (R5, R13). Calls `classifyCacheWrite` over the main stream; fails when `baseCause === "unexplained"`; emits the full `ClassifierTrace` in evidence `detail`. | Single-gate module that imports `server/cache/classifier.ts` |
| `server/gates/e1e2.ts` | E1/E2 — CLAUDE.md missing / bloated (R7, R14). The only file allowed to read disk. Resolves `${cwd}/CLAUDE.md` and `~/.claude/CLAUDE.md`; follows `@import` one level. | Single-gate module |
| `server/gates/engine.ts` | `evaluateSessionGates({session, turns, calls, cwd}, thresholds) → GateReport`. Composes the seven gates, computes the score + letter (R15), echoes `thresholdsUsed`. | `server/cache/analysis.ts` (composes `classifyCacheWrite` + attribution) |
| `server/gates/thresholds.ts` | `getGateThresholds(config): GateThresholds` + `isValidGateThresholds(value)`. Pure defaults + merge. | `server/settings.ts`'s merge pattern |
| `server/routes/gates.ts` | HTTP route `GET /api/sessions/:id/gates`. | `server/routes/session-detail.ts` |
| `server/gates/*.test.ts` | Per-gate Vitest unit tests (branch logic, exit-code markers, `@` mention match, recurring-cost math, `@import` walker, K2 four branches) | `server/cache/classifier.test.ts` |
| `server/gates/engine.test.ts` | Scoring tests + N/A-turn denominators + fixture-regression guard | `server/cache/fixture-regression.test.ts` |
| `test/fixtures/projects/-Users-demo-project-alpha/66666666-6664-4666-8666-666666666666.jsonl` | V1 fail fixture: mid-session edit with no following Bash | Existing fixture convention |
| `test/fixtures/projects/-Users-demo-project-alpha/77777777-7774-4777-8777-777777777777.jsonl` | V1 final-turn-only fail (proves softer framing) | Existing fixture convention |
| `test/fixtures/projects/-Users-demo-project-alpha/88888888-8884-4888-8888-888888888888.jsonl` | V2 fail: same normalized Bash command fails `V2_REPEAT` times | Existing fixture convention |
| `test/fixtures/projects/-Users-demo-project-alpha/99999999-9994-4999-8999-999999999999.jsonl` | P3 fail: `Edit` on a file with no prior `Read` and no `@path` mention | Existing fixture convention |
| `test/fixtures/projects/-Users-demo-project-alpha/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl` | C3 fail: single `tool_result` content > `C3_MAX_CHARS` | Existing fixture convention |
| `test/fixtures/projects/-Users-demo-project-alpha/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl` | E1 fail: transcript `cwd` has no CLAUDE.md and `~/.claude/CLAUDE.md` is absent (test sets `cwd` to a temp dir) | Existing fixture convention |
| `test/fixtures/projects/-Users-demo-project-alpha/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jsonl` | E2 fail: CLAUDE.md present, > `E2_MAX_CHARS` or > `E2_MAX_LINES`, with a `@import` reference whose imported file is also counted | Existing fixture convention |
| (No new K2 fixture) | The existing `55555555-…` session already exercises all four K2 cause branches (first-call, model-switch, compaction, unexplained); it's reusable as K2's pass+fail-case coverage (R13). README entry updated to reflect dual ownership. | Existing |

### Modified files / modules

| Path | What changes here |
|------|-------------------|
| `shared/settings-contract.ts` | Add `gateThresholds?: Partial<GateThresholds>` field to `AppConfig`. Add `GateThresholds` type + `isValidGateThresholds` validator. No change to existing `isValidBudget`. |
| `server/routes/config.ts` | In `PUT /api/config`, when the body contains `gateThresholds`, validate via `isValidGateThresholds` and pass through to `writeConfig`. Existing budget path unchanged. |
| `test/fixtures/README.md` | Add entries for the seven new fixture sessions (V1 fail, V1 final-turn, V2 fail, P3 fail, C3 fail, E1 fail, E2 fail). Update the existing `55555555-…` entry to note K2 gate-fixture dual ownership. |
| `specs/issues/P4-11-gates-engine.md` | The issue body itself is unchanged (the implementation deliverable references it) — but the shipped code will be linked from the issue's References section. |

### Deleted / replaced

Nothing deleted. No replacement.

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|------|----------------|
| `server/settings.ts` | `writeConfig`'s merge-on-disk contract is the reason we can add `gateThresholds` without a migration. A future change that flips `writeConfig` to replace-mode would silently drop `budget` on a PUT from this task's route. The merge is documented and asserted by existing tests (`server/settings.test.ts`). |
| `server/cache/classifier.ts` | K2 calls `classifyCacheWrite` and `partitionCacheStreams`. Their contract (threshold strict `>`, per-stream walk, trace shape) is asserted by `server/cache/fixture-regression.test.ts` and `server/cache/classifier.test.ts`. Any future rename/shape change there is a contract break for both K2 and the Cache Lab analyzer. |
| `server/store/derive-turns.ts` | P3 reads `Turn.promptText` to scan for `@path` mentions. The current `deriveTurns` only sets `promptText` when `promptSource === "typed"` (main chain only, never sidechain). That matches P3's contract (R2 + R11), but if a future change starts filling `promptText` on sidechain turns, P3 would start matching `@path` mentions there too. The hotspot is the sidechain exclusion on `promptText`, not on calls. |
| `server/ingest/parse-transcript.ts` | The engine assumes `message.id` dedupe has already happened (R2 — "dedupe API calls by `message.id` before any counting"). The dedupe is done at ingest; the engine does not re-dedupe. A regression that removed dedupe would silently double-count tool_result bytes in C3 and cause writes in V2 to look like repeated commands. |
| `server/store/store.ts` | The route reads session/turns/calls from the store. Any future API change (e.g. dropping `turns` from the read API) breaks the route. Existing tests cover the read shape. |
| `shared/cache-lab-contract.ts` | K2's evidence embeds the `ClassifierTrace` shape. Adding/removing fields there is a wire-shape change that #P4-12's UI sees directly. |
| `specs/gates.md` | Source of truth for all six check rules. Any divergence between this doc and the engine code is a defect; the spec wins. |

## Areas of Impact

| Area | Impact | Risk (L/M/H) | Why |
|------|--------|--------------|-----|
| `#P4-9 / #41 Cache Lab page` | No contract change — K2 reads from the existing `classifyCacheWrite` API. Cache Lab's analyzer (`server/cache/analysis.ts`) is unchanged. | L | The classifier is the shared primitive; K2 is a second caller, not a fork. |
| `#P4-12 / #44 Report Card UI + gate feeds` | Consumes `GET /api/sessions/:id/gates`; renders `GateReport` with turn-keyed deep-links for V1/V2/P3/C3/K2 and session-scoped `{filePath, detail}` for E1/E2. **Hard dependency on this task's output.** | H | The shape of `GateReport` and `GateEvidence` becomes #P4-12's input. Any undeclared field added later is a breaking change. |
| `#P4-15 / Settings page + config/local-store` | Reads `AppConfig.gateThresholds` for the Settings UI form; validates via `isValidGateThresholds`. **Soft dependency** — the engine works with defaults if #P4-15 hasn't shipped. | M | The settings file extension is owned by this task; the UI is #P4-15's. |
| `#P4-2 / Dashboard page` (gate feed) | Will call `GET /api/sessions/:id/gates` (or a multi-session rollup — design TBD with #P4-12). Until then, the existing `AnomalyFeed` placeholder (per `claude-lens-plan.md` line 165) stays as-is. | L | No contract change to existing Dashboard payload. |
| `#P4-4 / Sessions page` (gate-score column) | The existing stub per `claude-lens-plan.md` line 171 ("gate-score column stubs until #P4-12") gets populated by #P4-12; this task has no direct edit. | L | No contract change. |
| `~/.claude-lens/config.json` schema | Gains an optional `gateThresholds` key. Existing `{budget: ...}` files are untouched (settings.ts merges). | L | `writeConfig` merges; `readConfig` returns `DEFAULT_CONFIG` on missing/malformed. New key is optional. |
| `test/fixtures/` tree | Grows by seven session files. Existing sessions are untouched; the 5555… session's README entry gains a "dual ownership" line. | L | Purely additive; no fixture is replaced. |
| `specs/gates.md` | Source-of-truth doc for all six checks. No changes from this task — the engine is required to match the doc, not the other way around. | M | Any divergence surfaces in code review; the spec wins. |

**Contract changes:**

- **New HTTP route** `GET /api/sessions/:id/gates` returning `GateReport` — single new endpoint; no existing endpoint changes.
- **Extended `PUT /api/config`** body now accepts an optional `gateThresholds` object — purely additive, existing `budget`-only callers are unaffected.
- **Extended `AppConfig`** gains `gateThresholds?: Partial<GateThresholds>` — purely additive (optional field).
- **New types** `GateEvidence`, `GateResult`, `GateReport`, `GateThresholds` — exported from `server/gates/types.ts` (a new tiny module) or inlined in `engine.ts` depending on what `generate-tasks` lands; either way the shapes are new and have no existing consumers.

**Cross-cutting ripples:**

- **Build/CI:** no new dependencies, no new scripts. `npm run verify` (typecheck + lint + format + tests) gains one new Vitest file per gate plus the engine test plus the fixture-regression guard. Run time impact: small (each gate test is bounded; fixtures are tiny JSONL files).
- **Telemetry:** none — the engine is deterministic and unit-tested, not metric-emitting.
- **Migrations:** none — `config.json` is loose-merged by `writeConfig`.
- **Feature flags:** none.

## Cross-Cutting Concerns

- **Errors:** the engine never throws on user-data bad input. Bad inputs are deterministic facts (gates.md is a check over the canonical `parseSession()` output, so malformed transcripts are upstream concern). The route layer converts E1/E2 filesystem failures (e.g., unreadable CLAUDE.md) to HTTP 500 with `{ error, cause }`; the gate itself reports "checked `<path>`, unreadable" as E1/E2 evidence with status `warn` (don't punish the user for an unreadable file — the spec notes it's a filesystem check labeled "as of now").
- **Logging & metrics:** none — engine is pure and tested in isolation. The route does not log per-request (matches existing route style).
- **Auth / authz:** none — V2 is local-only. The new route mirrors the existing `/api/sessions/:id` access pattern.
- **Performance:** `evaluateSessionGates` is O(N) over main-chain calls plus one filesystem read for E1/E2. Per-session cost is dominated by `classifyCacheWrite` (already O(1) per call after partition). No caching layer — gates are cheap and deterministic, recompute per request. If profiling later shows the route is hot, memoize keyed on `${sessionId}@${configHash}`.
- **Security:** filesystem access is limited to `session.cwd` and `~/.claude/CLAUDE.md` — both already validated paths in the existing system. `@import` resolution is bounded to one level and relative to the importer's directory (no path traversal outside the importer's parent dir). The regex rejects paths containing `..` after `path.resolve`.
- **Migrations / rollout:** no schema migration. `config.json` gains an optional key; existing files are forward-compatible.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|----------|--------------|----------------|----------------|
| A1 | New `server/gates/` directory with one file per gate | Single `server/gates.ts` with all checks inline | Mirrors `server/cache/` (one file per concern); isolates evidence shape and branch logic per gate for fixture regression; #P4-12 will read each gate independently | R1, R4, R8 |
| A2 | K2 imports `classifyCacheWrite` only; does not import `attributeCacheMiss` | Import both classifier and TTL attribution overlay | `gates.md` K2 is purely "unexplained → fail"; TTL attribution is Cache Lab's verdict chip concern. Mixing them would double-attribute and contradict K2's evidence contract | R5, R13 |
| A3 | Sidechain exclusion happens once in `server/gates/preprocess.ts`; every gate sees main-chain only | Each gate filters sidechain internally | DRY; gates.md §Shared preprocessing is a single rule, not six copies | R2 |
| A4 | Threshold resolution is `server/gates/thresholds.ts`; engine never reads disk | Inline defaults in engine; read inside engine | Keeps engine pure; lets #P4-15 pass a fully-resolved threshold object without re-reading config | R6 |
| A5 | New HTTP route `GET /api/sessions/:id/gates` returns `GateReport` | Fold into `GET /api/sessions/:id`; new POST `/api/sessions/:id/gates/evaluate` | Gates are independent of session-detail rollups; #P4-12 fans out from one route; folding would balloon that route's contract | R1, R15 |
| A6 | `AppConfig.gateThresholds?: Partial<GateThresholds>` — optional nested field with defaults applied at read time | Top-level per-threshold fields on `AppConfig`; separate config file | `server/settings.ts` already merges unknown keys; nested field is the minimum-blast-radius extension and follows the existing `budget` pattern (one named field) | R6 |
| A7 | C3 "remaining API calls in session" = all subsequent calls in the session (main + sidechain) | Main-chain only | Cache-read cost is paid regardless of stream — every subsequent call (including a sidechain sub-agent) pays to re-read the cached prefix bytes | R12 |
| A8 | E1/E2 follows `@import` exactly one level; no recursive `@import` chains | Recursive follow; full markdown parser | `gates.md` §E1/E2 says "one level"; deterministic and no new dependency | R14 |
| A9 | V2 Bash normalization = trim + collapse internal whitespace runs to a single space | Aggressive normalization (strip flags, env, etc.); raw command | Matches `gates.md` §V2 ("trim, collapse whitespace") and avoids false positives from shell quoting differences | R10 |
| A10 | K2 evidence `detail` embeds the full `ClassifierTrace` plus the offending call's model + cacheCreateTokens | Just the baseCause | `gates.md` §K2 says "evidence: the call, spike size, classifier trace (which checks ran and their values)"; the trace is part of the contract | R13 |
| A11 | Score bucketing: `≥0.9` A, `≥0.75` B, `≥0.5` C, `≥0.25` D, `<0.25` F | Raw fraction only; percent display | Matches `gates.md` §"Report Card scoring" ("display as letter or fraction, not a percentage with false precision"); engine outputs both so #P4-12 doesn't re-bucket | R15 |
| A12 | `evaluatedAt` is set by the route, not the engine | Engine stamps `Date.now()` | Engine must be deterministic (no `Date.now()`); the timestamp is metadata, not evaluation state | R8 (fixture regression) |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|----------|----------------------------|
| Transcript file contains malformed lines (existing fixture `22222222-…`) | Parser already increments a malformed-line counter, never throws. The engine sees only the successfully-parsed calls; V2's "exit-code markers" logic tolerates missing tool_results by skipping that command (no false repeat). |
| Session has zero main-chain calls (sidechain-only) | After preprocess filters sidechains, every gate's input is empty. V1/V2/P3/C3 return `pass` with empty evidence (no edits to fail on). K2's main stream is empty → no calls above threshold → `pass`. E1/E2 still runs against the filesystem (session `cwd` is set even for sidechain-only sessions — verified by `deriveSession` always setting `project = call.cwd`). |
| CLAUDE.md present but unreadable (permission denied) | `e1e2.ts` catches the read error and emits evidence `detail: "checked <path>, unreadable"` with status `warn` (don't punish for IO failure). The route returns 200 with the report; only a complete fs failure (rare on local-only) becomes 500. |
| User sets `gateThresholds.v2Repeat: -1` via direct `config.json` edit | `getGateThresholds` clamps to the default + logs nothing (matches existing settings.ts "never throws" pattern). The engine never sees a negative threshold. |
| 10K-call session | `evaluateSessionGates` is O(N) over main-chain calls; K2's classifier is O(1) per call after partition. No pre-existing performance budget, but each gate is a single pass with no nested loops. If profiling shows hot routes, memoize on `${sessionId}@${configHash}`. |
| `@import` points to a path containing `..` | Regex match is followed by `path.resolve(importerDir, match)`; `e1e2.ts` rejects any resolved path that escapes `importerDir`. Falls back to `warn` evidence with detail "import `<raw>` resolved outside importer dir, skipped". |
| Two requests hit the route simultaneously for the same session | Engine is pure, no shared state. Route handlers run concurrently in Fastify. No coordination needed. |
| Rollback path if the engine ships and breaks a consumer | New route (`GET /api/sessions/:id/gates`) is purely additive — removing it cannot affect existing endpoints. Settings extension is additive (optional field). The only "active" surface is the engine code itself, which is isolated under `server/gates/` and consumed only by the new route. Rollback = revert the PR; no data migration. |
| Existing `55555555-…` fixture is "out of scope for #P4-9 page, in scope for #P4-11 gate" (README already documents this) | Engine reuse is read-only — `classifyCacheWrite` is untouched. Fixture-regression guard in `server/cache/fixture-regression.test.ts` already asserts the classifier's output stays fixed. K2's tests assert engine-level behavior, not the classifier. |
| E1/E2 evidence doesn't carry `turnN` but #P4-12 UI assumes turn key | `GateEvidence` type marks `turnN` optional. Engine never sets it for E1/E2. This is contract (R7) — the type enforces it. |

### Backward — regression risk per touched area (brownfield only)

| Touched area | What could regress | How we'd know / mitigation |
|---------------|--------------------|----------------------------|
| `server/settings.ts` (merge-on-disk) | A future change flipping `writeConfig` to replace-mode would silently drop `budget` on a PUT from this task's route | `server/settings.test.ts` asserts the merge; the engine never depends on `budget`'s survival, only on `gateThresholds` round-tripping |
| `server/cache/classifier.ts` (K2 imports) | A rename/shape change to `classifyCacheWrite` or `ClassifierTrace` is a contract break for both K2 and Cache Lab analyzer | `server/cache/fixture-regression.test.ts` and `server/cache/classifier.test.ts` already assert the contract; engine tests assert the same |
| `server/store/derive-turns.ts` (`promptText` sidechain handling) | If a future change starts filling `promptText` on sidechain turns, P3's `@path` mention check would match in sidechains | P3 tests explicitly use main-chain fixtures; `preprocess.ts` filters calls but the type system can enforce `Turn.isSidechain === false` on promptText readers if we want belt-and-braces |
| `server/ingest/parse-transcript.ts` (message.id dedupe) | A regression that removed dedupe would double-count tool_result bytes in C3 and double-fire V2 commands | Ingest tests assert dedupe; engine tests use already-deduped inputs from the store |
| `server/store/store.ts` (read shape) | If the read API drops `turns`, the new route breaks | Existing route tests cover read shape |
| `shared/cache-lab-contract.ts` (ClassifierTrace shape) | Adding/removing fields is a wire-shape change visible to #P4-12 | Shared contract tests exist; engine tests assert the trace is embedded verbatim |
| `specs/gates.md` (source of truth) | If the doc diverges from the code, the spec wins — code review catches it | Issue-acceptance review checklist explicitly cross-references each criterion to the gate file |

## Open Questions

- **Should `GateReport.evaluatedAt` include the threshold configuration hash?**  
  **Impact if unresolved:** #P4-12's UI might show stale thresholds in the "evaluated with these thresholds" tooltip if config changes between requests.  
  **Suggested default:** omit the hash for now (the engine is cheap enough to recompute). Revisit if profiling later demands caching.
- **C3 "remaining API calls in session" — confirmed main + sidechain (A7)?**  
  **Impact if unresolved:** a 5K-call sidechain session after the fat result would inflate the estimate by ~5K rather than just main-chain calls.  
  **Suggested default:** main + sidechain (A7). The recurring-cost math is about future cache reads, which fire regardless of stream.
- **E1/E2 filesystem read for `~/.claude/CLAUDE.md` happens at route time, not engine time.** Does the route layer want to memoize the file content?  
  **Impact if unresolved:** repeated requests for the same session re-read CLAUDE.md from disk each time.  
  **Suggested default:** no memoization in this task. The read is small (≤ a few KB) and the route is not expected to be hot. #P4-15 may want to memoize at the config layer.
- **Should K2 emit N/A evidence when the session has no spikes above threshold?**  
  **Impact if unresolved:** the engine currently emits `status: "pass"` with empty evidence for a clean session. #P4-12's UI must handle "pass with no evidence" as "nothing to show" rather than "evidence missing".  
  **Suggested default:** pass with empty evidence — matches `gates.md` §"V1" ("Turns with zero edits are N/A, not pass; exclude from the score denominator"), but the gate-level status is still `pass`. The score formula already excludes N/A turns. K2 doesn't have a turn-level N/A because it's session-level by construction.

## Out of Scope

- **Settings UI for threshold editing** (#P4-15) — the engine ships plumbing + defaults; the UI form is #P4-15.
- **Report Card UI / Dashboard gate feed / Sessions gate-score column / Trends gate pass-rate trend** (#P4-12) — this task ships the engine + route; the UI is #P4-12.
- **Sidechain gate coverage** (deferred per `gates.md` §"Deferred to later gate sets") — all gates in this set exclude sidechain; revisiting this is a deliberate deferral.
- **Pluggable gate registry** (deferred per `gates.md` §"Deferred") — the file-per-gate pattern is fixed; `gates/*.js` discovery is explicitly out.
- **V3, V4, P1, P2, C1, C2, C4, C5, K1, K3, E3, S1/S2** (all deferred per `gates.md` §"Deferred") — not in this engine.
- **Memoization of `evaluateSessionGates`** — not in this task; revisit if profiling shows the route is hot.
- **Pricing-driven gate variants** — K2 today is purely structural (no `$`-weighted scoring); a future iteration may add pricing to the cache-spike gate, but that's a separate engine revision.

---

# Tasks

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-gates-engine.md`_
