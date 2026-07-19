# Architecture: Turn Inspector Page (#38 / #P4-6)

> **Date:** 2026-07-19
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** `specs/claude-lens-pages.md` §4, `specs/issues/P4-6-turn-inspector-page.md` (issue #38)
> **Type:** feature

## Architecture Summary

Turn Inspector is the deepest drill level in the page map: one logical turn's
API-call waterfall, cache narrative, transcript peek, and sidechain
breakdown. It is a brownfield, pattern-following feature — it mirrors the
just-shipped Session Detail page (#37/#P4-5) almost exactly: a pure
server-side projector consumes a `Store.getSessionSnapshot` plus the fleet
turn-cost baseline and returns one wire response; a thin route registers it;
a page-level TanStack Query owns the fetch; a pure view component composes
per-section panels. The one genuinely new capability is the "transcript
peek" — a second, separate, lazily-fetched endpoint that reads the session's
raw `.jsonl` file on demand to show short previews of assistant text and
tool calls, since the Store's compact `ApiCall`/`Turn` records never retain
that raw content. That requires a small Store extension (`transcriptPath`)
because nothing in the ingest pipeline currently remembers where a session's
transcript file lives on disk.

The route param shape (`/session/:sessionId/turn/:turnNumber`) and the stub
page (`client/src/pages/TurnInspector.tsx`) are already committed and
settled by #P4-5's drill-link work — this task fills in the page body and
its backing routes, it does not choose new route shapes.

## High-Level Structure

```
Client                                   Server
──────                                   ──────
TurnInspector.tsx (route shell)
  useQuery(qk.turnInspector) ─────────►  GET /api/sessions/:id/turns/:n
    │                                      └─ turn-inspector/projector.ts (pure)
    ▼                                          consumes Store.getSessionSnapshot(id)
  TurnInspectorView.tsx                        + shared fleet turn-cost baseline
    ├─ TurnSummary.tsx
    ├─ Waterfall.tsx (time/tokens toggle,
    │    client-side transform of one array)
    ├─ CacheNarrative.tsx
    └─ SidechainBreakdown.tsx

  TranscriptPeek.tsx (collapsed by default)
    useQuery(qk.turnTranscript,          GET /api/sessions/:id/transcript?turn=n
      enabled: expanded) ─────────────►    └─ turn-inspector/transcript-peek.ts
                                              resolves Store.getTranscriptPath(id)
                                              reads raw file, filters lines by
                                              the turn's timestamp range,
                                              returns truncated previews
```

Added: everything under `server/turn-inspector/`, `shared/turn-inspector-contract.ts`,
`client/src/pages/turn-inspector/*`, the two new routes, and the
`transcriptPath` slot on `Store`. Modified: `TurnInspector.tsx` (stub → real
page), `app.ts` (route registration), `pipeline.ts` (one new wiring line),
`queryKeys.ts` (two new key factories), and `session-detail.ts`'s route
(fleet-baseline helper extracted so both routes share it).

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| Transcript peek data source | On-demand raw-file read, not a Store-resident cache | (a) Store retains full raw text per call; (b) pre-parse and cache peek previews at ingest time | (a) breaks the "compact metadata only" rule the whole ingest layer is built on and bloats memory for content almost never viewed; (b) does unnecessary work for turns nobody inspects. A lazy, on-demand read matches the issue's own framing ("lazy raw-file read route") and the existing precedent of doing raw-file I/O only when explicitly needed (`warm-cache.ts` reconstruction) |
| Fleet turn-cost baseline reuse | Extract `buildFleetBaselines` out of `session-detail.ts` into a shared helper, both routes call it | Duplicate the ~15-line function in the new route | Two independently-maintained copies of "how we compute the fleet percentile baseline" is exactly the kind of drift the codebase's existing `logical-turns.ts` module comment warns against ("keeping the helper here avoids two divergent aggregation rules") |
| Waterfall time/tokens toggle | Client-side transform over one `waterfall.calls[]` array | Server computes and returns two separate array shapes | The toggle is a pure view transform (same data, different bar-width formula) — matches the metrics-engine principle "pages never aggregate raw data themselves" only where real aggregation is involved; this is presentation, not aggregation, so keeping it client-side avoids doubling the wire payload for no informational gain |
| Transcript path tracking | New `Store.transcriptPath` slot, set from `pipeline.ts`'s existing transcript-file-add/change branch | (a) Re-glob scan roots on each peek request to relocate the file; (b) thread `ScanConfig` into `buildApp`/routes | (a) is O(all files) per peek click, fragile if the session directory structure varies; (b) leaks ingest-layer config into the HTTP layer, which the codebase has kept separate everywhere else (routes only ever take a `Store` + optional pricing metadata) |
| Store dirty-marking for transcriptPath | `setTranscriptPath` does **not** call `markDirty` | Treat it like `markSidecarPresent` (which does mark dirty) | It's not derived-session metadata (doesn't affect `Session`/`Turn` shape or the WS "session-updated" contract) — marking it dirty would trigger a spurious recompute + WS broadcast every time the poller's fast-stat loop re-touches a transcript file, for a field the client never reads via `/api/sessions/:id` |

## Patterns & Conventions

- **Pure projector, I/O-owning route module split** — from `session-detail/projector.ts` / `routes/session-detail.ts`. Applied identically for turn-inspector; the one exception is `transcript-peek.ts`, which is intentionally I/O-owning (raw file read) rather than pure, mirroring `ingest/tailer.ts`'s "this module is allowed to touch the filesystem" role.
- **Runtime response-shape guard on the client** — every field of the wire contract is asserted at runtime before the page trusts it (`api/session-detail.ts`'s `assertSessionDetailResponse`). Followed for both new endpoints.
- **Honest tier vocabulary (`SessionDetailField`-style availability list, 🟢/🟡/🔴)** — followed: `apiMs`/`wallMs` stay absent, never fabricated, until #P4-13.
- **One page-level query owns the fetch; panels are pure presentational components taking already-fetched data** — from `SessionDetail.tsx` / `SessionDetailView.tsx`. Followed, with the transcript peek as a second, independently-lazy query (`enabled: expanded`) rather than bundled into the page-level query, since it's explicitly deferred/optional per the issue.
- **Query key factory is the single source of truth (`api/queryKeys.ts`)** — two new entries added there, not inlined at call sites.

## Data Models

### TurnInspectorResponse (wire, not persisted)

**Purpose:** complete read-only payload for one logical turn — everything `TurnInspectorView` needs to render without re-aggregating raw calls.

**Key fields:**
| Field | Type / Constraint | Notes |
|---|---|---|
| `summary` | object | turnNumber, totalTurns, sessionId, cost, tokens, models/primaryModel, callCount, fleetPercentile (nullable), promptText, startedAt/endedAt |
| `summary.apiMs` / `summary.wallMs` | optional number | 🔴, absent until #P4-13 — never fabricated |
| `waterfall.calls[]` | array | callIndex, messageId, timestamp, offsetMs (timestamp-delta from turn start — 🟡 fallback per spec), tokens, cost, tools[], isSidechain, cacheReadTokens, cacheCreateTokens |
| `cacheNarrative[]` | array | per-call cache point: callIndex, cause (`first-call`\|`model-switch`\|`compaction`\|`unexplained`), isWriteSpike, hitRate, optional generated `narrative` string on notable points |
| `sidechainBreakdown` | object | mainCost/mainTokens/mainCallCount, `sidechains[]` (agentId?, cost, tokens, callCount, primaryModel) |
| `nav` | object | prevTurnNumber, nextTurnNumber (both nullable at session ends), totalTurns |
| `meta` | object | costBasis, availability[], fleetBaselineSize — same convention as `SessionDetailMeta` |

**Relationships:**
- One `TurnInspectorResponse` per `(sessionId, turnNumber)` pair — derived from the same `LogicalTurn` grouping Session Detail already uses (`groupLogicalTurns`), so turn numbering can never disagree between the two pages.

**Lifecycle:** computed fresh per request from the current `SessionSnapshot`; nothing is persisted.

### TurnTranscriptPeekResponse (wire, not persisted)

**Purpose:** short, truncated preview of the turn's raw transcript lines — read on demand, never cached server-side.

**Key fields:**
| Field | Type / Constraint | Notes |
|---|---|---|
| `lines[]` | array | role (`assistant-text`\|`tool-use`\|`tool-result`), toolName?, preview (string, hard-capped length), bytes? |
| `truncated` | boolean | true if any line's raw content exceeded the preview cap |

**Relationships:** scoped to one `(sessionId, turnNumber)`; not derived from the Store — read straight from the raw file resolved via `Store.getTranscriptPath`.

**Lifecycle:** computed per request, discarded immediately after the response is sent — no retention.

### Store extension: `transcriptPath`

**Purpose:** remembers the absolute path of a session's transcript `.jsonl` file so the transcript-peek route can locate it without re-globbing scan roots.

**Key fields:**
| Field | Type / Constraint | Notes |
|---|---|---|
| `SessionState.transcriptPath` | `string \| undefined` | Set once by `pipeline.ts` when the transcript file is first discovered; overwritten (not appended) on subsequent `onFileChanged` calls in case of rotation |

**Lifecycle:** set on first `onFileAdded`/`onFileChanged` for a transcript-class file; never cleared by `resetSession` (the path is still valid even if the file's content was truncated/reset) — mirrors `sidecars` flags, which also survive `resetSession`.

## API Contracts / Interfaces

### `server/routes/turn-inspector.ts`

**Boundary:** HTTP API (Fastify)

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| GET | `/api/sessions/:id/turns/:n` | Turn Inspector's main payload | 200 `TurnInspectorResponse`; 404 `{error:"session not found", sessionId}`; 404 `{error:"turn not found", sessionId, turnNumber}` |
| GET | `/api/sessions/:id/transcript?turn=n` | Lazy transcript peek | 200 `TurnTranscriptPeekResponse`; 404 `{error:"session not found", sessionId}` \| `{error:"turn not found", ...}` \| `{error:"transcript unavailable", sessionId}` (path unresolved or file unreadable) |

**Auth requirements:** none — same as every other `claude-lens` route (local-first, loopback-only per the existing `/ws` origin policy; no auth layer exists anywhere in the app).

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|---|---|---|
| `server/turn-inspector/projector.ts` | Pure derivation: `SessionSnapshot` + fleet baseline → `TurnInspectorResponse` | `shared/*`, `server/store/logical-turns.ts`, `server/store/store.ts` (types only) — **never** filesystem, live `Store`, metrics engine internals, or Fastify |
| `server/turn-inspector/transcript-peek.ts` | I/O: resolve path via `Store.getTranscriptPath`, read file, filter lines by turn window, truncate | `node:fs/promises`, `server/ingest/parse-transcript.ts` (line-shape types), `server/store/store.ts` |
| `server/routes/turn-inspector.ts` | Wires both endpoints; error mapping only | `server/turn-inspector/*`, `server/store/fleet-baselines.ts` (new shared helper), Fastify |
| `server/store/fleet-baselines.ts` | Extracted from `session-detail.ts`: computes fleet turn/session cost baselines from a `Store` | `server/store/store.ts`, `server/store/logical-turns.ts` |
| `client/src/pages/turn-inspector/*` | Presentational panels, no fetch/state | `shared/turn-inspector-contract.ts`, existing chart/UI primitives |
| `client/src/api/turn-inspector.ts` | Fetch + runtime shape guard for both endpoints | `shared/turn-inspector-contract.ts` |

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `shared/turn-inspector-contract.ts` | Wire types for both endpoints | `shared/session-detail-contract.ts` |
| `server/turn-inspector/projector.ts` | Pure turn-detail projector | `server/session-detail/projector.ts` |
| `server/turn-inspector/transcript-peek.ts` | Raw-file read + line filter + truncation | `server/ingest/warm-cache.ts` (raw file I/O idiom) |
| `server/routes/turn-inspector.ts` | Registers both GET routes | `server/routes/session-detail.ts` |
| `server/store/fleet-baselines.ts` | Shared fleet turn/session cost baseline builder | extracted from `server/routes/session-detail.ts`'s `buildFleetBaselines` |
| `client/src/api/turn-inspector.ts` | Fetch wrapper + response-shape guard | `client/src/api/session-detail.ts` |
| `client/src/pages/turn-inspector/TurnInspectorView.tsx` | Composes the panels below | `client/src/pages/session-detail/SessionDetailView.tsx` |
| `client/src/pages/turn-inspector/TurnSummary.tsx` | $, tokens, models, flags, percentile, prev/next nav | `client/src/pages/session-detail/Header.tsx` |
| `client/src/pages/turn-inspector/Waterfall.tsx` | API-call waterfall, time/tokens toggle | `client/src/pages/session-detail/CostTimeline.tsx` (chart composition idiom) |
| `client/src/pages/turn-inspector/CacheNarrative.tsx` | Cache read/write narrative panel | `client/src/pages/session-detail/CacheStrip.tsx` |
| `client/src/pages/turn-inspector/SidechainBreakdown.tsx` | Main vs. sidechain cost/token split | new (no direct precedent; simple bar-pair panel) |
| `client/src/pages/turn-inspector/TranscriptPeek.tsx` | Collapsed-by-default, lazy-fetch on expand | new (own `useQuery`, `enabled: expanded`) |
| `*.stories.tsx` for each new panel | Storybook coverage (states: normal, empty, tier-locked) | existing `session-detail/*.stories.tsx` |
| `cypress/e2e/turn-inspector.cy.ts` (exact filename TBD in generate-tasks) | Smoke spec: route renders key sections from fixtures, one drill-link lands filtered | existing Phase 4 page smoke specs |

### Modified files / modules

| Path | What changes here |
|---|---|
| `client/src/pages/TurnInspector.tsx` | Replace `PageStub` body with the real page-level query (`qk.turnInspector`) + `TurnInspectorView`; keep the existing `useParams` param handling as-is |
| `server/app.ts` | Import and call `registerTurnInspectorRoute(app, store, runtimeOptions)` alongside the other route registrations |
| `server/store/store.ts` | Add `transcriptPath?: string` to `SessionState`; add `setTranscriptPath(sessionId, path)` (no `markDirty`) and `getTranscriptPath(sessionId)` |
| `server/ingest/pipeline.ts` | In the `poller.onFileAdded`/`onFileChanged` transcript-class branch, add `store.setTranscriptPath(file.sessionId, file.path)` next to the existing sidecar-presence wiring |
| `client/src/api/queryKeys.ts` | Add `qk.turnInspector(sessionId, n)` → `["turn-inspector", sessionId, n]`, `qk.turnTranscript(sessionId, n)` → `["turn-inspector", "transcript", sessionId, n]`, plus matching `prefixes` entries |
| `server/routes/session-detail.ts` | Remove its private `buildFleetBaselines`; import the extracted `server/store/fleet-baselines.ts` helper instead — no behavior change |

### Deleted / replaced

None.

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| `server/routes/session-detail.test.ts` (or equivalent) | Asserts `session-detail.ts` route behavior; must stay green after `buildFleetBaselines` is extracted — the extraction must be byte-identical in output |
| Any `server/store/store.test.ts` fixtures that construct `SessionState` object literals directly | New optional `transcriptPath` field must not break exhaustive-shape assertions, if any exist |
| `client/src/routes.ts` | Already wires `TurnInspector` to the settled route param shape — no change expected, but confirm the import still resolves after the page body is replaced |

## Areas of Impact

| Area | Impact | Risk (L/M/H) | Why |
|---|---|---|---|
| `server/store/store.ts` | New optional field + two new methods | L | Additive, no existing method's behavior changes, no new `markDirty` call path |
| `server/ingest/pipeline.ts` | One new line in an existing callback | L | Purely additive side effect; doesn't change what gets tailed or how records apply |
| `server/routes/session-detail.ts` | Fleet-baseline logic moves to a shared module | L–M | Mechanical extraction, but any subtle behavioral coupling to `session-detail.ts`'s local scope needs a careful diff-free extraction, not a rewrite |
| Session Detail page's turn-table drill links | None — consumes, doesn't change | — | `TurnsSection.tsx`'s existing `/session/:id/turn/:n` links already point at the right shape; this task makes the destination real |
| #P4-12 (gate-evidence links, future) | Unblocked, not implemented | — | Per the issue: "this task ships the route wiring-ready... not a testable end-to-end link yet" — no gate-status field is consumed here beyond what's already reserved in `SessionDetailTurn.gateStatus` |

**Contract changes:** none to existing wire contracts. Two new response shapes (`TurnInspectorResponse`, `TurnTranscriptPeekResponse`), both additive, no consumers outside this page yet.

**Cross-cutting ripples:** none — no auth, no migration, no feature flag, no build/deploy change. WS invalidation is untouched (`transcriptPath` deliberately does not enter the dirty-marking/broadcast path).

## Cross-Cutting Concerns

- **Errors:** both routes return the existing `{error, ...}` JSON shape on failure; unexpected exceptions fall through to `app.ts`'s existing top-level error handler (`{error:"internal server error", cause}`). Turn-not-found and transcript-unavailable are both distinguishable 404 causes so the client can render different empty states (transcript peek failing must not blank the rest of the page).
- **Logging & metrics:** no new logging beyond Fastify's existing per-request log line; no new metrics.
- **Auth / authz:** none, consistent with the rest of the app.
- **Performance:** transcript-peek reads the whole raw file per request — acceptable because it's lazy (only fires when the user expands the panel) and one-off per click, same cost class as the existing warm-cache reconstruction path. Flagged as a candidate for the Phase 5 performance pass if real multi-GB transcripts make it noticeably slow; not solved here.
- **Security:** `sessionId`/`turnNumber` are only ever used as Store map keys / array indices, never interpolated into a filesystem path directly — the transcript peek resolves the path via `Store.getTranscriptPath` (populated only from paths the ingest pipeline itself discovered under configured scan roots), so a malicious `id` param can't be used to read an arbitrary file.
- **Migrations / rollout:** none — additive routes and an additive Store field, no data migration, no flag.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|---|---|---|---|
| A1 | On-demand raw-file read for transcript peek, not Store-resident | Cache full raw text in Store; pre-parse at ingest time | Matches "compact metadata only" ingest philosophy and the issue's own "lazy raw-file read route" framing | Issue #38 scope line: "transcript peek (lazy raw-file read route)" |
| A2 | Extract `buildFleetBaselines` into `server/store/fleet-baselines.ts`, shared by both routes | Duplicate the function in the new route | Avoids two divergent copies of the fleet-percentile computation, consistent with the existing `logical-turns.ts` precedent for shared aggregation helpers | Pages spec §4 "percentile vs your history" — must agree with Session Detail's §3 percentile |
| A3 | `Store.setTranscriptPath` does not call `markDirty` | Treat identically to `markSidecarPresent` (which does) | Not derived-session metadata; marking dirty would cause spurious recompute/WS broadcasts on every poller re-touch | — (implementation-only concern, no REQ) |
| A4 | Waterfall time/tokens toggle computed client-side from one array | Server returns two pre-shaped arrays | Pure presentation transform, not aggregation; avoids doubling wire payload | Pages spec §4 "API-call waterfall" |
| A5 | Two separate GET endpoints (turn detail vs. transcript peek) rather than one combined response | Bundle transcript preview into the main turn response | Issue explicitly calls for a separate `/transcript?turn=n` route and "lazy" read; bundling would force every page load to pay the raw-file-read cost even when the panel stays collapsed | Issue #38 scope: "Needs `GET /api/sessions/:id/turns/:n` and `/transcript?turn=n`" |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| Requested turn number doesn't exist for the session (e.g. turn 999 of a 5-turn session) | Projector returns a sentinel the route maps to 404 `{error:"turn not found", sessionId, turnNumber}` — unit-testable directly against the projector |
| Two concurrent requests for different turns of the same session | Each route call takes its own atomic `Store.getSessionSnapshot(id)` — no shared mutable state between requests, same guarantee Session Detail already relies on |
| Session's transcript file rotated/deleted after ingest (mid-run file replacement) | Turn-detail route (`/turns/:n`) is unaffected — it's Store-backed, not file-backed. Transcript peek alone fails closed with `{error:"transcript unavailable"}` when the resolved path can't be read |
| Fleet baseline grows from 10K to 10M logical turns | No new complexity class introduced — reuses the same `O(n log n)` sort-once, binary-search-lookup pattern Session Detail's projector already uses |
| Ship this and it breaks | Fully additive change (new files + 4 small, mechanical edits) — rollback is a straight revert with no data migration to undo |

### Backward — regression risk per touched area (brownfield only)

| Touched area (from Change Footprint) | What could regress | How we'd know / mitigation |
|---|---|---|
| `server/store/store.ts` (`transcriptPath` addition) | Any test that does exhaustive equality on `SessionState`/`Store` internals could fail on the new optional field | Existing store test suite must stay green; new field defaults `undefined` so equality against pre-existing fixtures without it should be unaffected unless a test does strict key-count assertions — verify during implementation |
| `server/ingest/pipeline.ts` (new wiring line) | Could accidentally fire on every poller tick instead of only on file add/change, causing overhead | Placed inside the existing `onFileAdded`/`onFileChanged` callbacks only — verify with the existing pipeline test suite that call counts don't change |
| `server/routes/session-detail.ts` (`buildFleetBaselines` extraction) | Fleet percentile numbers on Session Detail silently shift if the extraction isn't behavior-identical | Session Detail's existing route tests assert exact percentile/median values against fixtures — must stay green unchanged, proving the extraction is a pure move |

## Open Questions

- Exact wording/format of the generated `cacheNarrative[].narrative` strings (mockup shows prose like "Likely prefix churn: CLAUDE.md or MCP config changed mid-session")
  - **Impact if unresolved:** cosmetic only — doesn't affect data shape or any other section
  - **Suggested default:** short, deterministic template strings keyed off `cause` + `isWriteSpike`, similar in tone to existing K2 gate detail text (`server/gates/k2.ts`); refine during implementation/visual sign-off against the mockup
- Preview truncation cap for transcript-peek lines (mockup shows short 1-2 line previews)
  - **Impact if unresolved:** minor — too-long previews would just look wrong, not break anything
  - **Suggested default:** ~200 chars per line, consistent with "compact" framing elsewhere; adjust during visual sign-off

## Out of Scope

- Gate-evidence deep links into this page (reason: downstream-gated on #P4-11/#P4-12 per the issue; this task ships the route "wiring-ready" only)
- `apiMs`/`wallMs` real timing data (reason: needs #P4-13 premium cost-sample capture; waterfall stays timestamp-delta-only for now)
- Any change to the Session Detail page itself beyond the mechanical `buildFleetBaselines` extraction

---

# Tasks

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-turn-inspector-page.md`_
