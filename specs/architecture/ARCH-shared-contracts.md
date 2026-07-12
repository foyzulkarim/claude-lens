# Architecture: Shared Contracts (#P2-1)

> **Date:** 2026-07-11
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone — `/plan-requirements` skipped (settled plan-task; see Inferred Requirements). Authoritative scope: `specs/claude-lens-plan.md` lines 87–90; field evidence: `specs/claude-lens-data-model.md` + `specs/claude-lens-field-definitions.md`; §7/§8 of `specs/claude-lens-architecture.md`.
> **Type:** feature (greenfield contract design)

## Architecture Summary

#P2-1 **designs** the three shared TypeScript contracts that every downstream module speaks — it derives them from the observed-field evidence, it does not transcribe. `shared/types.ts` defines the store vocabulary: `ApiCall` (the deduped assistant API-response atom), the derived `Turn` and `Session` aggregates, and `TierFlags` (per-session premium-capture presence). `shared/metrics-contract.ts` defines the single query language — `MetricsQuery` (measure × dimension × grain) and the rich `Series` return type per architecture §8. `shared/ws-protocol.ts` defines the three invalidation-bus message shapes per §7. The contracts are the memory-discipline lever (§6): they retain user prompt text and tool-result *byte sizes* but structurally exclude tool-result bodies. This task ships types plus the minimal server/client stub imports that prove the acceptance criterion; the parser (#P2-2), store (#P2-3), and metrics engine (#P2-4) consume these types unchanged.

## Inferred Requirements (Mode B — no REQ)

| ID | Inferred Requirement | Source |
|----|----------------------|--------|
| R1 | The three contracts compile under `strict` and are imported by both a server stub and a client stub; `npm run typecheck` (all three tsconfig projects) passes. | `plan.md:88` acceptance |
| R2 | `ApiCall`/`Turn`/`Session`/`TierFlags` field sets are consistent with the observed fields catalogued in `claude-lens-data-model.md` / `-field-definitions.md`. | `plan.md:87-88` |
| R3 | `MetricsQuery`/`Series` conform to architecture §8; `ws-protocol` conforms to §7 (three types, invalidation only, never data). | `plan.md:88`, arch §7/§8 |
| R4 | The contracts enforce memory discipline: no tool-result bodies anywhere — only byte sizes and retained typed-prompt text. | arch §5.4 / §6 |
| R5 | Cost is tier-aware: computed (tokens × pricing) and observed (C/L) are distinguishable at the contract level. | arch §4 |

## High-Level Structure

Three sibling files in the existing `shared/` root. No runtime — pure `type`/`interface` declarations. Consumption is unidirectional; `shared/` imports nothing from `server/` or `client/`.

```
shared/
├── types.ts            # TokenUsage, ToolUseRef, ApiCall, Turn, Session, TierFlags
├── metrics-contract.ts # Measure, Dimension, Grain, MetricsQuery, SeriesPoint, Distribution, Series
└── ws-protocol.ts      # SessionUpdated | SessionAdded | ScanUpdated → WsServerMessage
        ▲                         ▲
        │ import type             │ import type   (relative, NodeNext ".js", type-only)
   server/app.ts               client/ stub
```

Data-flow role (design intent, populated by later tasks): parser emits `ApiCall[]` → columnar store derives `Turn[]`/`Session[]` → `metrics(MetricsQuery)` returns `Series[]` → HTTP → client; ingest debounce emits a `WsServerMessage` → client invalidates by query-key prefix.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|------|----------|-------------------------|-----------|
| Vocabulary form | String-literal unions (`Measure`, `Dimension`, `Grain`) | TS `enum`s | Idiomatic under `strict`; serialize cleanly into TanStack Query keys (§11 requires the key factory to serialize the full query); no runtime object emitted. |
| Cross-root import | Relative path with `.js` extension, `import type` | Path aliases; npm workspace package | Repo has neither aliases nor workspaces; NodeNext requires explicit extensions. `type`-only imports erase at emit — zero runtime coupling. |
| ApiCall scope | Assistant-only API-call atom | Discriminated union across line types | Matches §6 ("columnar arrays of `ApiCall` plus *derived* `Turn`/`Session`") and the `parseSession → {calls[], turns[], session, tier}` contract; gives the metrics engine a homogeneous array to scan. |
| Cost in vocabulary | Separate `costComputed` / `costObserved` measures | One `cost` measure + basis label | Explicit in the measure list; a page/preset names exactly the basis it wants. (`TierFlags.costBasis` still carries the label for badging.) |
| Series richness | Rich `Series` (compare ghost + distribution inline) | Minimal `{key, points}` | §8 makes compare, smoothing, and distribution mode first-class; modeling them in the return type keeps the client assembly-free. |

## Patterns & Conventions

- **Contracts are the only shared vocabulary** — from CLAUDE.md/arch §3: `metrics-contract.ts` is "the only vocabulary pages speak." These types are that vocabulary; keep them free of server- or client-only concerns.
- **Memory discipline by construction** — §5.4/§6: the *absence* of a tool-result-body field is the design. `Turn` carries `toolResultBytes: number`, never the payload.
- **Tier awareness is explicit** — §4: premium-only quantities (`costObserved`, `apiMs`, `linesAdded/Removed`, observed `durationMs`) are **optional** fields / distinct measures, never silently zeroed.
- **Deferred signals are optional, not omitted** — fields backed by ingest that lands in #P2-2+ (`wallMs`, `gateStatus`, `gateScore`) are declared now as optional so consumers don't force a contract revision later.

## Data Models

### `TokenUsage` (shared sub-shape)

| Field | Type / Constraint | Notes |
|-------|-------------------|-------|
| `inputTokens` | `number` | Fresh (non-cached) input. `message.usage.input_tokens`. |
| `outputTokens` | `number` | `output_tokens`. |
| `cacheReadTokens` | `number` | `cache_read_input_tokens`. |
| `cacheCreateTokens` | `number` | `cache_creation_input_tokens` (total). |
| `cacheCreate5m` | `number?` | `cache_creation.ephemeral_5m_input_tokens` — TTL-mix panel (§4). |
| `cacheCreate1h` | `number?` | `cache_creation.ephemeral_1h_input_tokens`. |
| `webSearchRequests` | `number?` | `server_tool_use.web_search_requests`. |
| `webFetchRequests` | `number?` | `server_tool_use.web_fetch_requests`. |

### `ApiCall`

**Purpose:** one deduped assistant API response — the money/token atom of the columnar store.

| Field | Type / Constraint | Notes |
|-------|-------------------|-------|
| `uuid` | `string` (required) | This line's node id. |
| `sessionId` | `string` (required) | Per-file grouping key. |
| `messageId` | `string` (required) | `message.id` (`msg_…`) — **dedupe key** (§4/§5.4). |
| `requestId` | `string?` | `req_…` underlying API call. |
| `promptId` | `string?` | Turn-grouping key (§4). Optional: not every assistant line carries it. |
| `agentId` | `string?` | Sub-agent attribution (`agent-<id>.jsonl`). |
| `timestamp` | `string` ISO-8601 | `timestamp`. |
| `model` | `string` (required) | `message.model`. |
| `usage` | `TokenUsage` (required) | Zeroed on API-error lines (see `isApiError`). |
| `stopReason` | `string?` | `message.stop_reason`. |
| `isSidechain` | `boolean` (required) | main-vs-sidechain dimension. |
| `tools` | `ToolUseRef[]` (required, may be empty) | One per `tool_use` block: `{ name, inputBytes }` — powers the tool dimension + "tool calls" measure. **No tool bodies.** |
| `isApiError` | `boolean?` | `isApiErrorMessage` — record captures an API error, `usage` is zeroed. |
| `apiErrorStatus` | `number?` | `apiErrorStatus` (429/529/…). |
| `cwd` | `string` (required) | Envelope dim → project. |
| `gitBranch` | `string` (required) | Envelope dim. |
| `version` | `string` (required) | Envelope dim → CC-version. |
| `entrypoint` | `string` (required) | Envelope dim (`cli`/…). |

**Relationships:** grouped into a `Turn` by `promptId`; grouped into a `Session` by `sessionId`. Deduped on `messageId`.
**Lifecycle:** produced by the parser (#P2-2) per retained assistant line; never mutated; dropped wholesale on file-truncation reparse (§5.3).

### `Turn`

**Purpose:** derived `promptId` group — a user prompt and the assistant calls answering it. Carrier for user-line data (prompt text, tool-result sizes) so `ApiCall` stays a pure call.

| Field | Type / Constraint | Notes |
|-------|-------------------|-------|
| `promptId` | `string` (required) | Group key. |
| `sessionId` | `string` (required) | Owning session. |
| `isSidechain` | `boolean` (required) | Whether the turn ran on a sub-agent branch. |
| `promptText` | `string?` | Retained typed prompt (`message.content` string, `promptSource: typed`) — search index source (§5.4). Absent for tool-only turns. |
| `promptSource` | `string?` | `promptSource` (`typed`/`queued`/…). |
| `startedAt` / `endedAt` | `string` ISO | Bounds from member calls / boundary. |
| `calls` | `ApiCall[]` (required) | Member calls (store may hold indices; contract expresses them logically). |
| `usage` | `TokenUsage` (required) | Rollup over `calls`. |
| `toolResultBytes` | `number` (required) | Aggregated `tool_result` payload **sizes** — context-composition panels. Bodies dropped. |
| `wallMs` | `number?` | *Optional signal* — `system/turn_duration` or B boundary delta (#P2-2+). |
| `gateStatus` | `string?` | *Optional signal* — `system/stop_hook_summary` gate outcome (#P2-8). |

### `Session`

**Purpose:** derived per-file rollup + tier state.

| Field | Type / Constraint | Notes |
|-------|-------------------|-------|
| `sessionId` | `string` (required) | Per-file id (= filename stem). |
| `lineageId` | `string` (required) | Snake `session_id` — origin/lineage; equals `sessionId` for originals, older ancestor on resume. **Join key for C/B/L** (§A.1). |
| `slug` | `string?` | Human nickname. |
| `project` | `string` (required) | `cwd`. |
| `entrypoint` | `string` (required) | |
| `models` | `string[]` (required) | Distinct models used. |
| `gitBranch` | `string` (required) | |
| `version` | `string` (required) | |
| `tier` | `TierFlags` (required) | Premium-capture presence. |
| `firstAt` / `lastAt` | `string` ISO | Session bounds. |
| `usage` | `TokenUsage` (required) | Session token rollup. |
| `turnCount` / `callCount` | `number` (required) | |
| `costComputed` | `number` (required) | Tokens × pricing table. |
| `costObserved` | `number?` | Present only when C or L (§4). |
| `durationMs` | `number?` | Observed (L `duration_ms` / B); optional. |
| `cacheHitPct` | `number` (required) | Cache-read ÷ total input. |
| `linesAdded` / `linesRemoved` | `number?` | Premium (C/L) churn. |
| `gateScore` | `number?` | Aggregate gate outcome (#P2-8); optional. |

### `TierFlags`

| Field | Type / Constraint | Notes |
|-------|-------------------|-------|
| `hasCostSamples` | `boolean` | C — `<uuid>.cost.jsonl` present. |
| `hasTurnBoundaries` | `boolean` | B — `<uuid>.turn-boundaries.jsonl` present. |
| `hasCostLog` | `boolean` | L — `cost-log.jsonl` row present. |
| `costBasis` | `"computed" \| "observed"` | `observed` when C or L present; drives the 🟢🟡🔴 legend downstream. |

## API Contracts / Interfaces

### `shared/metrics-contract.ts`

**Boundary:** the query language for `POST /api/metrics` and the internal `metrics()` engine (§8).

Literal unions (canonical members from `pages.md:19-20`):

- `Measure` = `"costComputed" | "costObserved" | "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheCreateTokens" | "apiCalls" | "turns" | "sessions" | "toolCalls" | "cacheHitPct" | "wallMinutes" | "apiMs" | "linesAdded" | "linesRemoved" | "gatePassRate"`
- `Dimension` = `"time" | "project" | "model" | "gitBranch" | "version" | "entrypoint" | "sidechain" | "tool" | "gateStatus" | "host"`
- `Grain` = `"hour" | "day" | "week" | "month"`

| Op | Signature | Purpose | Returns |
|----|-----------|---------|---------|
| query | `MetricsQuery` = `{ measures: Measure[]; dimensions: Dimension[]; grain: Grain; range: { from: string; to: string }; filters?: Partial<Record<Dimension, (string \| number)[]>>; compare?: "previous-period"; smoothing?: "none" \| "ma7"; mode?: "series" \| "distribution" }` | The one query shape all charts speak. | `Series[]` |
| point | `SeriesPoint` = `{ t: string; value: number \| null }` | One bucket (`t` = bucket-start ISO, or dimension-value key). `null` = empty bucket. | — |
| dist | `Distribution` = `{ p50: number; p90: number; p99: number; histogram: { bucket: string; count: number }[] }` | Percentile/histogram payload when `mode: "distribution"`. | — |
| series | `Series` = `{ measure: Measure; dimensionKey: string; label: string; points: SeriesPoint[]; basis?: "computed" \| "observed"; compareGhost?: SeriesPoint[]; distribution?: Distribution }` | One measure × one dimension slice. `dimensionKey` = `""` when undifferentiated. `basis` set for cost measures; `compareGhost` set when `compare` requested; `distribution` set in distribution mode. | — |

### `shared/ws-protocol.ts`

**Boundary:** server → client event producer on `GET /ws` — invalidation only, never data (§7).

| Message | Shape | Emitted when |
|---------|-------|--------------|
| `SessionUpdated` | `{ type: "session-updated"; sessionId: string }` | Debounced per §5.5 after appends settle. |
| `SessionAdded` | `{ type: "session-added"; sessionId: string }` | Discovery finds a new session file. |
| `ScanUpdated` | `{ type: "scan-updated" }` | Roots rescanned / settings changed. |
| union | `WsServerMessage = SessionUpdated \| SessionAdded \| ScanUpdated` | Discriminated on `type`. |

**Auth requirements:** origin-gated at the handshake (already implemented in `server/app.ts` — loopback origins only). No inbound protocol.

## Module Boundaries

| Module | Responsibility | Allowed Dependencies |
|--------|----------------|----------------------|
| `shared/*.ts` | Own the three contracts. Pure types, no runtime, no I/O. | Nothing (imports no sibling root). |
| `server/*` | May `import type` from `shared/`. | `shared/` |
| `client/*` | May `import type` from `shared/`. | `shared/` |

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|------|---------|-------------------|
| `shared/types.ts` | `TokenUsage`, `ToolUseRef`, `ApiCall`, `Turn`, `Session`, `TierFlags`. | New; field tables above. |
| `shared/metrics-contract.ts` | `Measure`, `Dimension`, `Grain`, `MetricsQuery`, `SeriesPoint`, `Distribution`, `Series`. | arch §8. |
| `shared/ws-protocol.ts` | `WsServerMessage` union + members. | arch §7 (verbatim shapes). |

### Modified files / modules

| Path | What changes here |
|------|-------------------|
| `server/app.ts` | Add `import type { WsServerMessage } from "../shared/ws-protocol.js"`; type the (currently no-op) `/ws` outbound path against it — proves the server-stub import for R1. |
| `client/src/placeholder.ts` (or a small `client/src/api/contracts.ts`) | Add a `import type` of a shared contract (e.g. `MetricsQuery`) — proves the client-stub import for R1. Keep minimal; the real client data layer is #P3. |

### Deleted / replaced

| Path | Reason |
|------|--------|
| `shared/placeholder.ts` | Its own comment: "Removed by #P2-1 when the shared contracts land." Real `.ts` files now satisfy the root's `tsc` input. |

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|------|----------------|
| `shared/tsconfig.json` / `server/tsconfig.json` / `client/tsconfig.json` | Include globs already cover the new files; cross-root `import type` pulls `shared/*.ts` into the server/client `tsc` programs. Verify all three `--noEmit` passes still succeed. |
| `package.json` `typecheck` script | The R1 acceptance harness (3-project `tsc`). No change, but it must stay green. |
| `biome.json` | Lint/format now applies to the three new files; run `npm run format:check` / `lint`. |

## Areas of Impact

| Area | Impact | Risk | Why |
|------|--------|------|-----|
| Parser #P2-2 | Populates `ApiCall`; routes prompt text / tool-result sizes / system signals into `Turn`. | M | Field-set errors here surface as parser rework, but the evidence is the guardrail. |
| Store #P2-3 | Columnar arrays of `ApiCall`; derives `Turn`/`Session`. | M | `calls: ApiCall[]` on `Turn` is logical; store may use indices — a representation choice, not a contract break. |
| Metrics engine #P2-4 | Implements `metrics(MetricsQuery): Series[]` against these exact unions. | M | Every measure/dimension member must map to a store field; a missing member forces a contract edit + re-typecheck of consumers. |
| Client #P3 | Query-key factory serializes `MetricsQuery`; charts render `Series`. | L | Rich `Series` was chosen precisely to minimize client assembly. |

**Contract changes:** these are *new* public shared types; no existing consumer, so nothing breaks. Every future edit to a `Measure`/`Dimension` member or a required field is a breaking change across all three roots — treat additions as optional-first.

**Cross-cutting ripples:** none at runtime (types only). Reaches the build only via the `typecheck` script and Biome. No migrations, flags, telemetry, or auth changes.

## Cross-Cutting Concerns

- **Errors:** N/A at runtime. The contract *enables* the parser's malformed-line counting (§5.4) by making `isApiError`/`apiErrorStatus` explicit and `usage` present-but-zeroed on error lines.
- **Logging & metrics:** none (no runtime).
- **Auth / authz:** unchanged; `/ws` origin gate already in `server/app.ts`.
- **Performance:** the contract *is* the memory lever (§6) — excluding tool-result bodies and modeling only byte sizes keeps the store to low-hundreds-of-MB. No field holds an unbounded payload except `promptText` (typed prompts, small).
- **Security:** `promptText` retains user prompt content; per project note transcript PII is treated as public — not a blocker. No secrets in contracts.
- **Migrations / rollout:** greenfield; delete placeholder + add files in one PR. Backward-compat N/A (no prior contract).

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies |
|---|----------|--------------|----------------|-----------|
| A1 | `ApiCall` = assistant-only API-call atom | Discriminated union across line types | §6 + `parseSession → {calls[]}` alignment; homogeneous columnar store for the engine. | R2 |
| A2 | Prompt text + tool-result byte sizes live on `Turn` | Carry them in-band on `ApiCall` | Keeps a "call" = an API call; per-turn concerns stay per-turn. | R2, R4 |
| A3 | Separate `costComputed` / `costObserved` measures | One `cost` measure + basis label | Developer decision — explicit vocabulary; presets name the basis directly. | R3, R5 |
| A4 | System signals (`wallMs`/`gateStatus`/`gateScore`) as optional slots now | Defer to a later contract revision | Measures are canonical; optional = no false promise; avoids a revision rippling into stubs. | R2, R3 |
| A5 | Rich `Series` (compare/distribution inline) | Minimal `{key, points}` | Developer decision — §8 makes compare/smoothing/distribution first-class. | R3 |
| A6 | String-literal unions over enums | TS `enum`s | `strict` idiom; clean query-key serialization (§11); no runtime emit. | R1, R3 |
| A7 | Cross-root imports: relative `.js`, `type`-only | Path aliases; workspace package | Repo has neither; NodeNext needs explicit extensions; `type` erases at emit. | R1 |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|----------|---------------------------|
| API-error assistant line (no `usage`) | `isApiError: true` + `apiErrorStatus`; `usage` present-but-zeroed. Parser (#P2-2) branches on `isApiError`; measures exclude zeroed error calls. |
| Resumed/continued session (`session_id` ≠ `sessionId`) | `Session` carries both `sessionId` and `lineageId`; premium C/B/L join on `lineageId` per §A.1. |
| Old transcript lacking TTL split / `server_tool_use` | `cacheCreate5m/1h`, `webSearchRequests/webFetchRequests` optional — absent, not zero-invented. |
| Multi-pass response (`message.usage.iterations[]`) | `TokenUsage` is the summed view; summation is the parser's job (#P2-2). **See Open Questions.** |
| Distribution query with a dimension | `Series.distribution` optional; one `Series` per dimension slice carries its own percentiles/histogram. |
| Store grows 10K → 10M calls | Contract excludes tool-result bodies by construction (§6); `Turn.calls` may be indices in the store impl — no bloat forced by the type. |

### Backward — regression risk per touched area

| Touched area | What could regress | How we'd know / mitigation |
|--------------|--------------------|-----------------------------|
| `shared/tsconfig.json` + cross-root imports | New `.ts` files or `import type` paths break one of the three `tsc` projects. | `npm run typecheck` (all three) is the gate; run before commit. |
| `server/app.ts` `/ws` handler | Typing the outbound path disturbs the existing origin-gate / no-op message handler. | Keep the change additive (`import type` + annotation only); server still boots (`/api/ping`, `/ws` handshake). |
| `shared/placeholder.ts` deletion | A stray import of `SHARED_ROOT` elsewhere. | `grep` for `SHARED_ROOT` before deleting (expected: none). |

## Open Questions

- **`message.usage.iterations[]` summation** — does `TokenUsage` represent the summed total across internal passes, or the first pass?
  - **Impact if unresolved:** multi-pass responses under/over-count tokens and cost.
  - **Suggested default:** summed total; parser (#P2-2) folds `iterations[]` into the single `TokenUsage`. Confirm when the parser lands.
- **`gateStatus` / `gateScore` value domain** — string outcome vs structured object depends on `gates.md` / #P2-8.
  - **Impact if unresolved:** a later widening of the type touches `Turn`/`Session` consumers.
  - **Suggested default:** `string` / `number` placeholders now; refine when the gate engine is designed.
- **`Turn.calls` representation** — full `ApiCall[]` vs indices into the columnar store.
  - **Impact if unresolved:** none at the contract level; it's a #P2-3 store-impl choice.
  - **Suggested default:** express `ApiCall[]` logically; let the store decide physical layout.

## Out of Scope

- Parser / dedupe / error-counting logic (#P2-2).
- Columnar store and derivation implementation (#P2-3).
- `metrics()` engine implementation (#P2-4).
- Pricing table, gate definitions, distribution math (#P2-8 / Settings / gates.md).
- Client query-key factory and chart wrapper (#P3).
- Fixing the stale issue #18 body / `specs/context/18.md` wording (tracked separately; noted in this session).

---

# Tasks

## Task T1: Author the three shared contracts + prove cross-root imports

> **Status:** done
> **Verification:** checklist
> **Effort:** s
> **Priority:** critical
> **Depends on:** None (Phase 1 exit + #P0-7 evidence already in place)
> **Satisfies REQs:** R1, R2, R3, R4, R5
> **Footprint slice:** New: `shared/types.ts`, `shared/metrics-contract.ts`, `shared/ws-protocol.ts`; Modified: `server/app.ts` (+`import type WsServerMessage`), client stub (+`import type MetricsQuery`); Deleted: `shared/placeholder.ts`
> **High-risk areas touched:** Parser #P2-2, Store #P2-3, Metrics engine #P2-4 (M) — all *downstream* consumers of these types; none edited by this task, but the field set chosen here is their contract.

### Description

Design and author the three shared TypeScript contracts that every downstream module speaks — the store vocabulary (`shared/types.ts`), the metrics query language (`shared/metrics-contract.ts`), and the WS invalidation protocol (`shared/ws-protocol.ts`) — deriving field sets from the #P0-7 evidence, not transcribing. Delete the temporary `shared/placeholder.ts` and add the minimal `import type` stubs in `server/` and `client/` that prove the contracts are consumable from both roots. This is the foundation task for Phase 2; getting the field set right against the evidence is the whole job.

### Verification Checklist

**Compile & quality gates**
- **V1 — typecheck** — run `npm run typecheck` — expected: exit 0; all three projects (`shared`/`server`/`client`) compile under `strict`. _(verifies R1)_
- **V2 — lint** — run `npm run lint` — expected: exit 0; Biome clean on the three new files. _(quality gate)_
- **V3 — format** — run `npm run format:check` — expected: exit 0. _(quality gate)_

**Stub imports (R1 "imported by both server and client stubs")**
- **V4 — server import + boot** — expected: `server/app.ts` contains `import type { WsServerMessage } from "../shared/ws-protocol.js"` and references it on the `/ws` outbound path (`grep` confirms); `buildApp()` still boots — `GET /api/ping` → `{ok:true}` and a loopback `/ws` handshake succeeds (existing origin gate intact). _(verifies R1; guards backward-regression for `server/app.ts`)_
- **V5 — client import** — expected: a client stub file contains an `import type` of a shared contract (e.g. `import type { MetricsQuery } from "../../shared/metrics-contract.js"`); `grep` confirms. _(verifies R1)_

**Placeholder removal**
- **V6 — placeholder gone** — expected: `shared/placeholder.ts` no longer exists and `grep -rn SHARED_ROOT .` (excluding node_modules) returns nothing. _(guards backward-regression for the deleted placeholder)_

**Contract-vs-evidence review (design consistency)**
- **V7 — field traceability** — expected: every `Measure`/`Dimension` union member maps to a `pages.md:19-20` catalog entry, and every `ApiCall`/`Turn`/`Session`/`TierFlags`/`TokenUsage` field traces to a `claude-lens-field-definitions.md`/`-data-model.md` row — or is a declared optional/derived signal (`wallMs`, `gateStatus`, `gateScore`) or config-supplied dimension (`host`). _(verifies R2, R5)_
- **V8 — §7/§8 conformance** — expected: `MetricsQuery` carries exactly `measures/dimensions/grain/range/filters/compare?/smoothing?/mode?` per §8; `Series` is the rich shape (basis/compareGhost/distribution); `WsServerMessage` is exactly the three §7 types with no data payload beyond `sessionId`. _(verifies R3, R4)_

### Implementation Notes

- **Module(s):** `shared/*` (pure types, no runtime, imports no sibling root) per ARCH Module Boundaries.
- **Pattern reference:** no prior contract file to mirror; field tables in this ARCH's Data Models + API Contracts sections are the spec. Follow the existing `strict`/NodeNext setup in `tsconfig.base.json`.
- **Key decisions (constrain this task):** A1 (ApiCall = assistant-only atom), A2 (separate `costComputed`/`costObserved`), A3 (prompt text + tool-result byte sizes on `Turn`), A4 (system signals as optional slots now), A5 (rich `Series`), A6 (string-literal unions, no enums), A7 (cross-root imports relative `.js`, `type`-only).
- **Libraries:** none — TypeScript language only. Imports use explicit `.js` extensions (NodeNext); prefer `import type`.
- **High-risk callouts:** these types are the contract for #P2-2/#P2-3/#P2-4. A wrong/missing field forces a contract edit + re-typecheck across all three roots later — V7/V8 are the guard. Additions after this task should be optional-first to avoid breaking consumers. Watch the API-error case (§stress): `usage` present-but-zeroed with `isApiError: true`, not omitted.

### Scope Boundaries

- Do NOT implement parser/dedupe/error-counting logic (#P2-2), the columnar store or `Turn`/`Session` *derivation* (#P2-3), or the `metrics()` engine (#P2-4) — this task ships the type shapes only.
- Do NOT add a pricing table, gate definitions, or distribution math (#P2-8 / Settings / gates.md).
- Do NOT build the client query-key factory or chart wrapper (#P3); the client change is a bare `import type` stub only.
- Do NOT add runtime helpers, validators, or type-level test files (developer decision: checklist-only, `tsc` is the done-signal).
- Do NOT edit the three `tsconfig.json` files — their `include` globs already cover the new files; if typecheck can't see a cross-root import, fix the import path, not the config.

### Files Expected

**New files:** _(from ARCH "New files / modules")_
- `shared/types.ts` — `TokenUsage`, `ToolUseRef`, `ApiCall`, `Turn`, `Session`, `TierFlags`.
- `shared/metrics-contract.ts` — `Measure`, `Dimension`, `Grain`, `MetricsQuery`, `SeriesPoint`, `Distribution`, `Series`.
- `shared/ws-protocol.ts` — `SessionUpdated`, `SessionAdded`, `ScanUpdated`, `WsServerMessage`.

**Modified files:** _(from ARCH "Modified files / modules")_
- `server/app.ts` — add `import type { WsServerMessage }` and type the `/ws` outbound path against it.
- `client/src/placeholder.ts` — add an `import type` of a shared contract (minimal stub; the real client data layer is #P3). _(A new `client/src/api/contracts.ts` re-export is an acceptable alternative if preferred.)_

**Deleted:** _(from ARCH "Deleted / replaced")_
- `shared/placeholder.ts` — its own comment marks it for removal by #P2-1; real `.ts` files now satisfy the root's `tsc` input.

**Must NOT modify:** _(from ARCH "Touched but not changed" + scope boundaries)_
- `shared/tsconfig.json` / `server/tsconfig.json` / `client/tsconfig.json` — include globs already cover the new files; verified green by V1, not edited.
- `package.json` (the `typecheck` script is the acceptance harness) / `biome.json` — exercised by V1–V3, not edited.
