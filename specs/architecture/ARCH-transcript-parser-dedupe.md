# Architecture: Transcript parser + dedupe (#P2-2)

> **Date:** 2026-07-13
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** `specs/claude-lens-plan.md` #P2-2 (issue #19); field evidence from `specs/claude-lens-data-model.md` §3.1/§3.2 and `specs/claude-lens-field-definitions.md` §B/§C; contracts from `shared/types.ts` (#P2-1)
> **Type:** feature

## Architecture Summary

A single new ingest module, `server/ingest/parse-transcript.ts`, turns raw JSONL lines from Claude Code transcripts into the compact records the rest of the system consumes. `assistant` lines become deduped `ApiCall`s (dedupe key: `message.id`, via a caller-owned per-session `Set`); `user` lines yield lightweight `PromptTextRecord`/`ToolResultBytesRecord` intermediates that a later task (`derive-turns.ts`, #P2-6) folds into `Turn.promptText`/`Turn.toolResultBytes`. Every other line type is skipped; anything structurally broken is counted as malformed and never throws. The task also authors the hand-built synthetic fixture tree (`test/fixtures/`) this module is tested against — absorbed from the superseded #P0-3 — which downstream tasks (tailer tests, Cypress E2E, gate-scenario fixtures) reuse rather than duplicate.

## High-Level Structure

```
<uuid>.jsonl line (string)
        │
        ▼
parseTranscriptLine(rawLine, seenMessageIds)
        │
        ├─ type: assistant ──► dedupe on message.id ──► { kind: "call", call: ApiCall }
        │                                            └─► { kind: "duplicate" }
        │
        ├─ type: user, content: string ──────────────► { kind: "prompt", prompt: PromptTextRecord }
        ├─ type: user, content: array w/ tool_result ─► { kind: "tool-result-bytes", record: ToolResultBytesRecord }
        │
        ├─ blank line / other line type ─────────────► { kind: "skipped" }
        └─ JSON.parse failure / broken shape ─────────► { kind: "malformed" }

parseTranscriptLines(rawLines[], seenMessageIds) — loops the above, buckets into
{ calls, prompts, toolResultBytes, duplicateCount, malformedCount }
```

Nothing is added to or modified in the existing runtime path (`server/app.ts`, `server/cli.ts`). This module is pure and unwired — P2-3/P2-4/P2-7 are what call it.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| Parsing | Hand-written field mapping, no schema library | `zod` | Architecture §2 explicitly excludes zod — ingest validates by hand because malformed lines are counters, not thrown errors; a schema library's throw-on-invalid model fights that. |
| Byte sizing | `Buffer.byteLength(str, "utf8")` | `str.length` | `str.length` counts UTF-16 code units, not bytes — would misreport multi-byte (emoji, CJK) tool output sizes on the context-composition panels. |
| Dedupe state | Caller-owned `Set<string>`, passed by reference | Module-internal `Map<sessionId, Set>` | Architecture §5.4 says dedupe is per-session, in-stream — but session lifecycle (created on discovery, torn down on file deletion) is P2-3/P2-6's concern, not the parser's. Keeping the parser stateless-except-for-the-passed-Set keeps it a pure, trivially testable function. |

## Patterns & Conventions

- **Discriminated union result type** (`ParsedLine`) — matches the existing `WsServerMessage`/`CliUsageError`-style tagged unions already in `server/`/`shared/`.
- **Never throw on bad input** — from CLAUDE.md / architecture §2: "ingest validates by hand because malformed lines are counters, not errors." Followed for every parse path.
- **Colocated tests** — `parse-transcript.test.ts` sits next to `parse-transcript.ts`, matching `vitest.config.ts`'s `{shared,server,client}/**/*.test.ts` include glob (test files, not fixture data, must live under one of those three roots).

## Data Models

### `PromptTextRecord` (new, local to `parse-transcript.ts`)

**Purpose:** retains a user's typed prompt text (needed for full-text search per architecture §5.4), extracted once at parse time rather than re-read later.

**Key fields:**
| Field | Type / Constraint | Notes |
|---|---|---|
| `sessionId` | string, required | groups records to a session, same as `ApiCall.sessionId` |
| `promptId` | string, required | turn-grouping key; present directly on `user` lines |
| `text` | string, required | raw prompt text, only when `message.content` is a string |

**Relationships:** many `PromptTextRecord`s can map to one `Turn.promptId` in #P2-6 (a turn may involve at most one typed prompt, but the record is emitted per matching line).

**Lifecycle:** created once per qualifying `user` line at parse time; consumed and discarded by `derive-turns.ts`; never persisted to the warm-start cache separately (folds into cached `ApiCall`/`Turn` records once P2-6 lands — open question, see below).

### `ToolResultBytesRecord` (new, local to `parse-transcript.ts`)

**Purpose:** retains tool-output size without retaining tool-output content (architecture §5.4/§6 memory discipline: "no tool_result bodies").

**Key fields:**
| Field | Type / Constraint | Notes |
|---|---|---|
| `sessionId` | string, required | |
| `promptId` | string, required | |
| `toolUseId` | string, required | joins to `ApiCall.tools[].name` via the matching `tool_use.id` on the assistant line — that join happens in #P2-6, not here |
| `bytes` | number, required | `Buffer.byteLength(content, "utf8")` of the `tool_result` block's `content` string |

**Relationships:** many-to-one with the `ApiCall` whose `tool_use` block it answers (joined later by `toolUseId`).

**Lifecycle:** created once per `tool_result` block at parse time; consumed by #P2-6 to compute `Turn.toolResultBytes`.

### `ApiCall` (existing, `shared/types.ts` — not modified)

Only the mapping from raw `assistant` line to this already-shipped shape is new here. See Data Models mapping table in Change Footprint's "New files" notes and the Phase D conversation above. Notably: `promptId` is left `undefined` by this task (assistant lines don't carry it directly; #P2-6 derives it by walking `parentUuid`).

## API Contracts / Interfaces

### `server/ingest/parse-transcript.ts`

**Boundary:** internal module (no HTTP/WS surface) — the ingest pipeline's parse stage, called by the tailer (#P2-4) and initial full-file parse (#P2-7).

**Operations:**

| Method/Op | Signature | Purpose | Errors / Returns |
|---|---|---|---|
| `parseTranscriptLine` | `(rawLine: string, seenMessageIds: Set<string>) => ParsedLine` | parse one line, mutating `seenMessageIds` on a new `assistant` line | never throws; returns `{kind: "malformed"}` on any unparseable/broken input |
| `parseTranscriptLines` | `(rawLines: string[], seenMessageIds: Set<string>) => ParseTranscriptResult` | batch convenience over the above | never throws; aggregates counts |

**Auth requirements:** none — internal server-side module, not reachable from HTTP.

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|---|---|---|
| `server/ingest/parse-transcript.ts` | line → `ApiCall` / `PromptTextRecord` / `ToolResultBytesRecord`; dedupe; malformed counting | `shared/types.ts` only (`ApiCall`). No filesystem, no store, no network. |

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `server/ingest/parse-transcript.ts` | the parser: `ParsedLine`, `PromptTextRecord`, `ToolResultBytesRecord`, `parseTranscriptLine`, `parseTranscriptLines` | tagged-union style of `shared/ws-protocol.ts`; error-class style of `server/cli.ts`'s `CliUsageError` |
| `server/ingest/parse-transcript.test.ts` | vitest spec against `test/fixtures/` | none yet — first test file in the repo |
| `test/fixtures/projects/<project-slug>/<uuid>.jsonl` (clean session) | multi-turn, sidechain (`isSidechain`+`agentId`), model switch, cache TTL (`ephemeral_5m`/`1h`) fixture | filename/dir convention mirrors `~/.claude/projects/<project-slug>/<uuid>.jsonl` (architecture §4), so `--roots test/fixtures` (P3-5) globs it identically |
| `test/fixtures/projects/<project-slug>/<uuid>.jsonl` (malformed-lines session) | mix of valid + broken JSON lines | same convention |
| `test/fixtures/projects/<project-slug>/<uuid>.jsonl` (partial-trailing-line session) | valid lines + one incomplete trailing line (no newline) | same convention; reused by #P2-4's tailer tests |
| `test/fixtures/README.md` | what each fixture exercises | convention extended later by #P4-11 (gate-scenario), #P4-2/#P4-13 (premium C/B/L) |

### Modified files / modules

None.

### Deleted / replaced

None.

### Touched but not changed (silent-regression hotspots)

None — no existing runtime path imports this module yet.

## Areas of Impact

| Area | Impact | Risk (L/M/H) | Why |
|---|---|---|---|
| #P2-4 (Tailer) | will call `parseTranscriptLine` per line; reuses the partial-trailing-line and malformed fixtures | L | consumer-only, contract is additive; tailer is unbuilt so nothing to break |
| #P2-6 (Store + derivations) | consumes `ApiCall[]` (with `promptId` unset) plus the two new local record types to build `Turn`/`Session` | L | `PromptTextRecord`/`ToolResultBytesRecord` aren't in `shared/types.ts`, so P2-6 must import them directly from `parse-transcript.ts` — a minor cross-module import, not a shared-contract change |
| #P3-5 (Cypress smoke) | depends on fixture file paths staying stable once landed under `test/fixtures/` | L | renaming fixtures later would break its `--roots test/fixtures` boot harness; mitigated by treating these paths as a stable contract once merged |

**Contract changes:** none — `shared/types.ts`/`ApiCall` is read-only in this task.

**Cross-cutting ripples:** none — no auth, no telemetry, no migration, no build/deploy change. Purely additive library code plus test fixtures.

## Cross-Cutting Concerns

- **Errors:** never throws; all failure modes fold into `ParsedLine.kind === "malformed"`, counted by the caller (this task returns counts, doesn't own "per-file" accumulation — that's the tailer/poller's job in #P2-3/#P2-4).
- **Logging & metrics:** none at this layer. Malformed counts are plain data; surfacing them (Data Health page, #P4-14) is a later task's job.
- **Auth / authz:** N/A — internal module, no HTTP surface.
- **Performance:** one pass per line; `Buffer.byteLength` instead of retaining tool_result content; no regex backtracking risk (field access + `JSON.parse` only).
- **Security:** transcript content is local user data, but still treated as untrusted structurally — no `eval`, no dynamic imports, defensive optional-chaining per the field-mapping table (Phase D).
- **Migrations / rollout:** N/A — pure library module, not wired into any running process yet.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|---|---|---|---|
| A1 | Parser handles both `assistant` → `ApiCall` and `user` → `PromptTextRecord`/`ToolResultBytesRecord` in one pass | Assistant-only parser; defer prompt/tool_result capture to #P2-6 | Matches the issue's literal scope line; avoids a second full read of every transcript file later; user confirmed | #P2-2 scope bullet 1 |
| A2 | `ApiCall.promptId` left unset by this task | Walk `parentUuid` chain in-parser to attribute promptId immediately | Assistant lines never carry `promptId` directly (confirmed against data-model.md §3.1); repo layout names `derive-turns.ts` (#P2-6) as the "promptId grouping" owner | #P2-2 scope, consistent w/ #P2-1's `ApiCall.promptId?` being optional |
| A3 | `PromptTextRecord`/`ToolResultBytesRecord` are local types in `parse-transcript.ts`, not added to `shared/types.ts` | Extend `shared/types.ts` with these as first-class shared types | They're ingest-internal intermediates, not part of the pages' query vocabulary; `shared/metrics-contract.ts` is documented as the only vocabulary pages speak (architecture §3) | — |
| A4 | Sidechains are embedded in the same `<uuid>.jsonl`, not a separate per-agent file | Author a separate `agent-<id>.jsonl` fixture per field-definitions.md's `agentId` note | data-model.md §1's evidence-based file-classification table lists exactly 4 patterns (T/C/B/L); trusted over one 🔶-confidence inferred aside | — |
| A5 | Blank lines / non-`assistant`/`user` line types are `skipped` (uncounted); JSON failures or `assistant` lines missing `message.id` are `malformed` (counted) | Count every non-`assistant` line as "skipped == malformed" for simplicity | Keeps the Data Health malformed counter meaningful — it should reflect actual data corruption, not routine sidecar-line traffic (`mode`, `ai-title`, etc. are ~40% of all lines) | — |
| A6 | Array-shaped `user.content` `text` blocks are not treated as prompt text; only string-shaped `content` is | Treat any `text`-typed block as a prompt-text candidate | Avoids conflating rare (~111 observed) injected/meta text with real typed input | — |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| Same `message.id` recurs across 3 lines (API retry) | Second and third lines return `duplicate`; `seenMessageIds` prevents re-adding; `calls` array holds exactly one `ApiCall` |
| 500-line file, every 10th line malformed | Loop in `parseTranscriptLines` continues past each malformed line (no early return/throw); `malformedCount === 50`; `calls.length` reflects only valid, non-duplicate `assistant` lines |
| Truncated/rewritten file (tailer's fallback territory) | Out of scope for this module — `parse-transcript.ts` has no notion of "this file was truncated"; the tailer (#P2-4) drops the file's prior records and reparses from byte 0, which is just a fresh call into this same stateless parser |
| A partial trailing line reaches the parser anyway (defense in depth, in case the tailer has a bug) | `JSON.parse` throws internally, caught, returned as `malformed` — degrades safely rather than crashing the ingest loop |

### Backward — regression risk per touched area

N/A — greenfield module, no existing behavior to regress.

## Open Questions

- Should `PromptTextRecord`/`ToolResultBytesRecord` be cached in the warm-start cache (#P2-5) alongside `ApiCall`s, or re-derived from a full reparse on every cold boot?
  - **Impact if unresolved:** #P2-5 might design the cache format without a slot for these, forcing a rework later.
  - **Suggested default:** include them in the warm-cache NDJSON alongside `ApiCall`s (tagged by `kind`, mirroring `ParsedLine`) — #P2-5 should confirm when it designs the cache format.

## Out of Scope

- Wiring `parse-transcript.ts` into a running ingest loop (discovery/poller/tailer) — #P2-3/#P2-4/#P2-7.
- `Turn`/`Session` derivation, `promptId` attribution via `parentUuid` walking — #P2-6.
- Premium (C/B/L) file parsing — #P4-13.
- Gate-scenario fixtures — #P4-11. Dashboard-anomaly fixtures — #P4-2.
- Malformed-count surfacing on the Data Health page — #P4-14.

---

# Tasks

## Task T1: Transcript parser + dedupe + synthetic fixture tree

> **Status:** done
> **Verification:** tdd
> **Effort:** m
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** N/A — no REQ linked; traces to `specs/claude-lens-plan.md` #P2-2 (issue #19)
> **Footprint slice:** New: `server/ingest/parse-transcript.ts`, `server/ingest/parse-transcript.test.ts`, `test/fixtures/projects/<project-slug>/<uuid>.jsonl` ×3, `test/fixtures/README.md`
> **High-risk areas touched:** None (all ARCH Areas of Impact are Low risk)

### Description

Implements `server/ingest/parse-transcript.ts`, the ingest pipeline's line-level parser: raw JSONL line → deduped `ApiCall` (for `assistant` lines) or `PromptTextRecord`/`ToolResultBytesRecord` (for `user` lines), with malformed lines counted and never thrown. Also authors the hand-built synthetic fixture tree (`test/fixtures/`) this module is tested against, since #P2-2 is the first real consumer of that fixture scope (absorbed from the superseded #P0-3). A developer with no prior context on this codebase needs only `shared/types.ts` (`ApiCall`) and the field-mapping table in this ARCH's Phase D section to implement it.

### Test Plan

#### Test File(s)
- `server/ingest/parse-transcript.test.ts`

#### Test Scenarios

##### Assistant line → ApiCall mapping

- **maps core assistant fields** — GIVEN a well-formed `assistant` line WHEN parsed THEN the returned `ApiCall` has `uuid`/`sessionId`/`messageId`/`model`/`cwd`/`gitBranch`/`version`/`entrypoint`/`stopReason` copied from the matching source fields _(verifies ARCH Data Models: `ApiCall` mapping)_
- **maps token usage including cache TTL buckets** — GIVEN an `assistant` line with `message.usage.cache_creation.{ephemeral_5m_input_tokens,ephemeral_1h_input_tokens}` WHEN parsed THEN `ApiCall.usage.cacheCreate5m`/`cacheCreate1h` carry those values, alongside `inputTokens`/`outputTokens`/`cacheReadTokens`/`cacheCreateTokens` _(verifies issue #19 acceptance: "token fields incl. ephemeral_5m/1h")_
- **defaults usage fields when `cache_creation` is absent** — GIVEN an `assistant` line with no `message.usage.cache_creation` object WHEN parsed THEN `cacheCreate5m`/`cacheCreate1h` are `undefined` and the required `TokenUsage` fields default to `0`, with no throw
- **extracts tool_use blocks into `tools[]`** — GIVEN an `assistant` line whose `message.content[]` has two `tool_use` blocks WHEN parsed THEN `ApiCall.tools` has two `ToolUseRef`s with correct `name` and `inputBytes === Buffer.byteLength(JSON.stringify(input))`
- **marks API-error responses without treating them as malformed** — GIVEN an `assistant` line with `isApiErrorMessage: true` and `apiErrorStatus: 429` WHEN parsed THEN the result is `{kind: "call"}` with `ApiCall.isApiError === true` and `apiErrorStatus === 429`, not `{kind: "malformed"}`
- **carries sidechain attribution** — GIVEN an `assistant` line with `isSidechain: true` and `agentId` set WHEN parsed THEN `ApiCall.isSidechain === true` and `agentId` is carried through

##### Dedupe

- **dedupes repeated message.id** — GIVEN two `assistant` lines sharing the same `message.id`, parsed in sequence against the same `seenMessageIds` Set WHEN the second is parsed THEN it returns `{kind: "duplicate"}` and the aggregate `calls` array (via `parseTranscriptLines`) has exactly one entry _(verifies ARCH forward stress-test: "same message.id recurs across 3 lines")_

##### User line → prompt / tool-result records

- **captures typed prompt text** — GIVEN a `user` line with string `message.content` and a `promptId` WHEN parsed THEN the result is `{kind: "prompt"}` with a `PromptTextRecord{sessionId, promptId, text}`
- **captures tool_result byte sizes without retaining content** — GIVEN a `user` line with array `message.content` containing one `tool_result` block WHEN parsed THEN the result is `{kind: "tool-result-bytes"}` with `ToolResultBytesRecord.bytes === Buffer.byteLength(block.content, "utf8")`, and no field in the result holds the raw `content` string
- **ignores array-shaped text blocks for prompt capture** — GIVEN a `user` line with array `message.content` containing a `text` block and no `tool_result` block WHEN parsed THEN no `PromptTextRecord` is emitted _(verifies ARCH Decision A6)_

##### Skip / malformed classification

- **skips non-assistant/user line types without counting them as malformed** — GIVEN lines of type `mode`, `ai-title`, and `system/turn_duration` WHEN parsed THEN each returns `{kind: "skipped"}` and `parseTranscriptLines`' `malformedCount` is unaffected _(verifies ARCH Decision A5)_
- **skips blank lines** — GIVEN an empty or whitespace-only line WHEN parsed THEN the result is `{kind: "skipped"}`
- **counts invalid JSON as malformed, never throws** — GIVEN a line that fails `JSON.parse` WHEN parsed THEN the result is `{kind: "malformed"}` and no exception propagates
- **counts a structurally broken assistant line as malformed** — GIVEN valid JSON with `type: "assistant"` but no `message.id` WHEN parsed THEN the result is `{kind: "malformed"}`
- **treats a partial trailing line as malformed, not a crash** — GIVEN an incomplete/truncated JSON line (no closing brace) handed directly to `parseTranscriptLine` WHEN parsed THEN the result is `{kind: "malformed"}` with no throw _(verifies ARCH forward stress-test: "partial trailing line reaches the parser anyway — defense in depth")_

##### Batch aggregation resilience

- **continues past a malformed line mid-batch** — GIVEN a small array of lines where one line in the middle is malformed WHEN passed to `parseTranscriptLines` THEN the returned `malformedCount` reflects exactly that one line and every valid line before/after it is still present in `calls`/`prompts`/`toolResultBytes` as appropriate _(verifies ARCH forward stress-test: "500-line file, every 10th line malformed")_

##### Fixture-tree contract (pins the compact-record contract)

- **clean multi-turn fixture parses to expected counts** — GIVEN the clean session fixture (multi-turn, sidechain, model switch, both cache-TTL buckets) parsed via `parseTranscriptLines` WHEN compared against hand-verified expected counts THEN `calls.length`, `duplicateCount`, `prompts.length`, and `toolResultBytes.length` match exactly, at least one parsed call has `isSidechain === true`, at least two distinct `model` values appear across `calls`, and both `cacheCreate5m` and `cacheCreate1h` are non-zero on at least one call each _(verifies issue #19 acceptance: "fixture tests pin the compact-record contract")_
- **malformed-lines fixture produces the exact expected malformed count** — GIVEN the malformed-lines session fixture WHEN parsed THEN `malformedCount` equals the number of intentionally-broken lines authored into that file
- **partial-trailing-line fixture's last line is malformed, earlier lines are not** — GIVEN the partial-trailing-line session fixture, split naively on `\n` WHEN each resulting line is parsed THEN every complete line before the last parses successfully and the final incomplete line returns `{kind: "malformed"}`

### Implementation Notes

- **Module(s):** `server/ingest/parse-transcript.ts` only, per ARCH Module Boundaries (`shared/types.ts` is its only allowed dependency — no filesystem, no store, no network).
- **Pattern reference:** discriminated-union result shape follows `shared/ws-protocol.ts`'s `WsServerMessage` tagged union; usage-error style (never throw, return a typed outcome) follows `server/cli.ts`'s `CliUsageError` handling pattern for "expected failure, not a crash."
- **Key decisions (from ARCH Decisions Log):**
  - A1 — parse both `assistant` and `user` lines in one pass; do not defer prompt/tool-result capture to a later task.
  - A2 — leave `ApiCall.promptId` unset; do not attempt `parentUuid` chain-walking here.
  - A3 — `PromptTextRecord`/`ToolResultBytesRecord` are local exported types in this file, not added to `shared/types.ts`.
  - A4 — sidechains live in the same `<uuid>.jsonl`; the clean fixture must NOT be split into a separate agent file.
  - A5 — skipped vs. malformed classification exactly as specified; get this wrong and the Data Health malformed counter (future #P4-14) becomes noise.
  - A6 — array-shaped `text` blocks on `user` lines are not prompt-text candidates.
- **Libraries:** none beyond Node built-ins (`Buffer.byteLength`). No `zod` or schema library, per ARCH Tech Choices — validate by hand.
- **High-risk callouts:** none — all ARCH Areas of Impact for this task are Low risk.

### Scope Boundaries

- Do NOT wire `parse-transcript.ts` into any running ingest loop (discovery/poller/tailer/app.ts) — that's #P2-3/#P2-4/#P2-7.
- Do NOT implement `Turn`/`Session` derivation or `promptId` attribution via `parentUuid` walking — that's #P2-6.
- Do NOT add premium (C/B/L) file parsing, gate-scenario fixtures, or dashboard-anomaly fixtures — those are #P4-13/#P4-11/#P4-2 respectively, reusing this task's `test/fixtures/README.md` convention.
- Do NOT add malformed-count surfacing/reporting (Data Health page) — that's #P4-14; this task only produces the count.
- Do NOT add `PromptTextRecord`/`ToolResultBytesRecord` to `shared/types.ts` (ARCH Decision A3).
- Only implement the parser as a pure function module — no logging, no caching (that's #P2-5's warm-start cache), no per-file counter accumulation (the caller's job per ARCH Cross-Cutting Concerns).

### Files Expected

**New files:**
- `server/ingest/parse-transcript.ts` — the parser: `ParsedLine`, `PromptTextRecord`, `ToolResultBytesRecord`, `parseTranscriptLine`, `parseTranscriptLines`
- `server/ingest/parse-transcript.test.ts` — vitest spec, colocated per `vitest.config.ts`'s include glob
- `test/fixtures/projects/<project-slug>/<uuid>.jsonl` — clean session: multi-turn, sidechain, model switch, both cache-TTL buckets
- `test/fixtures/projects/<project-slug>/<uuid>.jsonl` — malformed-lines session
- `test/fixtures/projects/<project-slug>/<uuid>.jsonl` — partial-trailing-line session
- `test/fixtures/README.md` — what each fixture exercises, establishing the convention #P4-11/#P4-2/#P4-13 extend later

**Modified files:** None.

**Must NOT modify:**
- `shared/types.ts` (ARCH Decision A3 — read-only; `ApiCall` is already shipped by #P2-1)
- `server/app.ts`, `server/cli.ts` (wiring is out of scope — #P2-3/#P2-4/#P2-7)

### TDD Sequence

1. Core `assistant` → `ApiCall` mapping (single-field, then usage, then `tools[]`) before dedupe — dedupe needs a working baseline parse to be meaningful.
2. Dedupe, then error/sidechain variants of `assistant` parsing.
3. `user` line handling (prompt text, then tool-result bytes, then the array-text-block exclusion).
4. Skip/malformed classification, then batch-aggregation resilience (`parseTranscriptLines`).
5. Author the three fixture files last, once the unit-level behavior is locked — the fixture-tree scenarios are an integration check on top of already-verified unit behavior, and hand-counting expected values is easiest once the mapping rules are stable.

---

_Status values: `not started` (defined, not picked up) | `in progress`
(implementation underway) | `done` (verification evidence produced) | `blocked`
(cannot proceed — see notes). The implement skill updates this field as it works._
