# Architecture: Session Detail Page

> **Date:** 2026-07-18
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone brief — see Inferred Requirements
> **Type:** feature

## Architecture Summary

The Session Detail page is a brownfield vertical slice built around one typed, read-only
`GET /api/sessions/:id` snapshot. A pure server projector combines one session's compact Store
records with fleet-wide logical-turn costs, returning every section required by the binding pages
spec except Report Card. Small ingest and warm-cache extensions retain only the metadata needed
for workflow, compaction, and context-composition analysis; raw tool-result bodies remain excluded.
The client fetches the snapshot under the existing per-session invalidation prefix and renders it
through pure page-local sections using the established Chart, DataTable, tier, and state primitives.

## Inferred Requirements (if Mode B / no REQ)

| ID | Inferred Requirement | Source |
|---|---|---|
| R1 | Replace the Session Detail stub with the header, cumulative timeline, per-turn bars, turn table, turn-vs-history distribution, cache strip, tool mix/timeline, prompt list, workflow funnel, token funnel, and context composition. | `specs/issues/P4-5-session-detail-page.md`; `specs/claude-lens-pages.md` §3 |
| R2 | Exclude Report Card from this issue; its UI lands in #P4-12. | Issue #37 scope; `specs/claude-lens-plan.md` #P4-5/#P4-12 |
| R3 | Add a typed `GET /api/sessions/:id` resource and keep the page live during active sessions through the existing WebSocket invalidation bus. | Issue #37 acceptance criteria; `specs/claude-lens-architecture.md` §§7, 9, 11 |
| R4 | Treat the pages-spec table as binding over the mockup, including the mockup-missing Tool Mix panel and Tool Timeline. | Phase 4 standing rule 2; issue #37 page contract |
| R5 | Preserve transcript/premium tier truthfulness: computed and estimated values render now, while premium-only values remain unavailable until #P4-13 supplies them. | `specs/claude-lens-pages.md` data-source legend and §3 |
| R6 | Use logical user turns for display and navigation, with sidechain work represented as a segment of its parent prompt turn. | Per-turn stacked main/sidechain requirement; core derivation rule that turns group by `promptId` |
| R7 | Preserve compact-store memory discipline and the route/store boundary; routes must not reread transcript files or retain raw tool-result bodies. | `CLAUDE.md`; `specs/claude-lens-architecture.md` §§3, 5, 6 |
| R8 | Supply component-state Storybook coverage, a fixture-backed Cypress smoke with a drill journey, and a page structure suitable for manual visual sign-off against the mockup. | Issue #37 definition of done; Phase 4 standing rules |

## High-Level Structure

```text
transcript JSONL
  -> parse-transcript (compact calls, prompts, tool-result sizes, compaction markers)
  -> versioned warm cache
  -> Store (per-session state and derived Turn[] / Session)
  -> atomic Store session snapshot
  -> session-detail projector
       |- logical prompt turns (main + sidechain)
       |- session-local section projections
       `- fleet logical-turn cost baseline
  -> GET /api/sessions/:id
  -> qk.session(id) / TanStack Query
  -> SessionDetailView + pure page-local sections

session-updated(id) -> invalidate qk.session(id) -> refetch the same HTTP snapshot
```

Added boundaries are a shared wire contract, a logical-turn grouping helper, a pure detail
projector, a thin Fastify route, a guarded client fetcher, and page-local view components. Existing
parser, cache, Store, pricing, invalidation, Chart, DataTable, and tier primitives are extended or
reused rather than replaced.

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| HTTP shape | One `GET /api/sessions/:id` snapshot | Detail endpoint plus multiple metrics requests; one endpoint per section | One response is internally consistent during live updates and matches the settled API surface. |
| Server computation | Pure projector over an atomic Store snapshot | Aggregate in the route; aggregate in React | Keeps the handler thin, enables fixture-level unit coverage, and prevents client-side raw-call aggregation. |
| Contracts | Dedicated `shared/session-detail-contract.ts` plus a manual client shape guard | Widen `sessions-contract.ts`; add Zod/Fastify schema dependencies | Keeps list/detail vocabularies focused and follows the existing guarded sessions fetcher without a new package. |
| Turn identity | Logical turns grouped by `(sessionId, promptId)`, containing main and sidechain segments | Expose every derived `Turn` separately; merge sidechain calls into the main `Turn` model | Preserves Store sidechain isolation while matching user-visible turn semantics and stacked-bar requirements. |
| Retained analysis data | Compact tool target/classification fields, tool-result name/bytes, and compaction markers | Raw tool inputs/results; route-time transcript rereads | Supplies exact required derivations without violating parser memory or module-boundary constraints. |
| Client data ownership | One page query; pure presentational sections | Each section fetches independently; React context with separate queries | All sections share one resource and failure boundary; pure sections are straightforward to exercise in Storybook. |
| Visualization | Existing low-level ECharts `Chart`, shared `DataTable`, and semantic HTML bars/lists | Force-fit range-oriented `ChartCard`; add another chart library | Reuses established accessible primitives while allowing fixed-session axes and turn addressing. |
| Storage/transport | Existing in-memory Store and invalidation-only WebSocket | Database/cache; data-bearing socket messages | No persistence is required, and pushing data would duplicate the HTTP/query contract. |
| Premium behavior | Optional wire fields and explicit availability metadata | Pull #P4-13 parsing forward; substitute computed values for premium facts | Maintains scope and the repository's `undefined = unavailable`, `0 = measured zero` rule. |
| Warm-cache evolution | Explicit schema-version bump and safe cold rebuild | Accept old entries with absent metadata; migrate entries in place | Old cache records cannot silently erase workflow/compaction facts; the cache is disposable and rebuildable. |

## Patterns & Conventions

- **Thin route, pure projection** — the Fastify layer validates/address-resolves and delegates; all
  calculations accept plain arrays and runtime metadata.
- **Atomic resource snapshot** — Store exposes one read surface containing the Session, calls,
  turns, prompts, compact tool results, and compaction markers from the same synchronous revision.
- **Logical-turn adapter** — Store continues to derive separate main/sidechain `Turn` records for
  isolation, while user-visible counts, traces, and detail projections group them by prompt.
- **One source of pricing truth** — all costs use the injected runtime `Pricer`; zero is never used
  as an unavailable sentinel.
- **Server-derived, client-rendered** — costs, ranks, flags, and funnels cross the wire ready to
  render; React performs formatting and display-only unit selection, not raw aggregation.
- **Section-level semantic fallback** — every canvas visualization has a visible summary or
  table/list representation; funnels use semantic HTML because canvas adds no value there.
- **Existing V2 conventions** — strict TypeScript, ESM imports, two-space formatting, colocated
  tests/stories, URL-preserving navigation, and specs over mockups.
- **No speculative premium values** — optional fields remain absent and tier-aware UI explains why.

## Data Models

### Compact Tool Metadata

**Purpose:** Extend the existing `ToolUseRef` with the minimum facts needed for workflow analysis
without keeping general tool input payloads.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| `name` | string, required | Existing tool name and primary classifier. |
| `id` | string, optional | Existing join key to a later tool result. |
| `inputBytes` | finite non-negative number | Existing compact size measure. |
| `targetPath` | string, optional | Normalized only for Read/Edit/Write path-bearing tools; omitted otherwise. |
| `bashKind` | `"git-commit" \| "other"`, optional | Derived from Bash input during parsing; the command itself is not retained. |

**Relationships:**

- `ApiCall` — zero-to-many compact tool references.
- compact tool-result record — joined by `id` / `toolUseId`.

**Lifecycle:** Parsed from one assistant line, serialized into warm cache, stored with its `ApiCall`,
and discarded when that session is reset or the process exits.

### Compaction Record

**Purpose:** Preserve explicit transcript `system/compact_boundary` markers for timeline flags.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| `sessionId` | non-empty string | Store partition key. |
| `timestamp` | parseable timestamp when present | Used to place the flag against the next logical turn/call. |
| `promptId` | string, optional | Direct attribution when the source line supplies it. |

**Relationships:**

- Session snapshot — zero-to-many records.
- Timeline/logical turn — projector assigns each marker without changing the stored record.

**Lifecycle:** Parsed, warm-cached, accumulated per session, cleared on session reset, and never
persisted outside the rebuildable warm cache.

### Atomic Session Snapshot

**Purpose:** Internal Store read boundary supplying one coherent projector input.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| `session` | `Session`, required for a known session | Recomputed before the snapshot is returned. |
| `calls` | `ApiCall[]` | Deduped, compact API calls for the session. |
| `turns` | `Turn[]` | Existing separately derived main/sidechain turns. |
| `prompts` | `PromptTextRecord[]` | Includes an in-progress prompt before its first assistant call. |
| `toolResults` | compact result records | Contains IDs, tool names, byte counts, error flags, and sidechain attribution; no body. |
| `compactions` | `CompactionRecord[]` | Explicit transcript markers. |

**Relationships:**

- Store session state — exactly one snapshot per known session read.
- detail projector — one snapshot is the session-local half of its input.

**Lifecycle:** Created synchronously on each detail read, consumed without mutation, and not cached
outside the Store/projector request lifetime.

### Logical Turn

**Purpose:** Canonical user-visible grouping for turn numbering and stacked main/sidechain values.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| `turnNumber` | positive integer, one-based | Stable UI/API evidence number after chronological grouping. |
| `promptId` | string, unique within session | Group key. |
| `promptText` | string, optional | From prompt records; may exist before calls arrive. |
| `main` | `Turn`, optional | Main-thread derived segment. |
| `sidechains` | `Turn[]` | All sidechain segments sharing the prompt. |
| `startedAt` / `endedAt` | timestamp, optional | Min/max across prompt and segment calls. |

**Relationships:**

- Session — one-to-many ordered logical turns.
- detail turn projection — exactly one output row/bar per logical turn.
- session list trace and turn-count measures — reuse the grouping helper so counts do not drift.

**Lifecycle:** Derived from snapshot arrays at read/recompute time; it is not independently stored.

### Session Detail Response

**Purpose:** Complete wire resource for every #P4-5 section.

**Key fields:**

| Field | Type / Constraint | Notes |
|---|---|---|
| `header` | required object | ID, project/dir, branch, version, models, timestamps, logical-turn count, costs, tier, context estimate, session-cost median/rank, optional drift. |
| `timeline` | ordered call points and markers | Cumulative cost/tokens/calls, per-call context estimate, turn boundaries, compactions, and availability. |
| `turns` | ordered `SessionDetailTurn[]` | Main/sidechain costs, tokens, calls, cache rate, tools, timing, optional premium fields, rank, anomaly, and flags. |
| `turnDistribution` | required object | Fleet population size, p50/p90/p99, histogram, and exact rank basis. |
| `cache` | ordered call points | Hit rate, write size, and K2-compatible first-call/model-switch/compaction/unexplained cause. |
| `toolMix` / `toolTimeline` | arrays | Tool-use counts/bytes and time-ordered events; full-call cost attribution is labelled non-additive when one call uses multiple tools. |
| `prompts` | ordered prompt items | Turn number, timestamp, source, and full typed user text. |
| `workflow` | required funnel object | Base edit-turn count plus cumulative read/planned/verified/committed stage counts. |
| `tokenFunnel` | required object | Context offered, served from cache, fresh-billed, and output tokens. |
| `contextComposition` | array | Tool-result bytes and share grouped by originating tool, with `Unknown` fallback. |
| `meta` | required object | Cost basis, field availability, in-progress/partial indicators, and fleet baseline population. |

**Relationships:**

- Exactly one response per session ID.
- All page sections consume slices of this object; no section receives raw Store types directly.

**Lifecycle:** Produced on GET, cached by TanStack Query, invalidated for its session ID, replaced
atomically after refetch, and discarded when the query ages out.

## API Contracts / Interfaces

### Session Detail HTTP Resource

**Boundary:** HTTP API

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| GET | `/api/sessions/:id` | Return the complete session-detail snapshot. URL query filters do not change the addressed session. | `200 SessionDetailResponse`; `404 { error: "session not found" }`; unexpected projection failures use Fastify's normal `500` path. |

**Auth requirements:** Same local-only trust boundary as existing read APIs; no new authentication or
authorization layer. The ID is used only for exact Map lookup and is never interpolated into a
filesystem path.

### Store Snapshot Reader

**Boundary:** internal module API

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| read | `Store.getSessionSnapshot(sessionId)` | Recompute exactly one known session and return coherent compact arrays. | Snapshot for known state; `undefined` for an unknown ID; never performs filesystem I/O. |

**Auth requirements:** Internal server call only.

### Session Detail Projector

**Boundary:** internal pure module

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| project | `projectSessionDetail(snapshot, fleetTurns, fleetSessions, runtimeMetadata)` | Build the complete wire response with one pass over current-session data and one sorted fleet baseline. | `SessionDetailResponse`; expects already-valid compact Store records and never mutates inputs. |

**Auth requirements:** Internal server call only.

### Client Detail Fetcher

**Boundary:** browser library API

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| fetch | `getSessionDetail(id, signal?)` | Fetch, validate, and return the detail response with cancellation support. | Response; typed HTTP error retaining status/server message; distinct response-shape error for malformed 2xx payloads. |

**Auth requirements:** Same-origin browser request.

### Query / Invalidation Key

**Boundary:** client event consumer

**Operations:**

| Method/Op | Path / Signature | Purpose | Errors / Returns |
|---|---|---|---|
| key | `qk.session(id)` | Canonical detail query key `['session', id]`. | Stable readonly tuple. |
| invalidate | `session-updated(sessionId)` | Invalidate exactly the matching detail key alongside existing metrics/session-list prefixes. | TanStack Query schedules mounted refetch; no socket data payload. |

**Auth requirements:** Internal browser event handling.

## Module Boundaries

| Module / Package | Responsibility | Allowed Dependencies |
|---|---|---|
| `shared/session-detail-contract.ts` | Wire-only detail vocabulary and availability enums. | Other `shared/` types only; no server/client imports. |
| `server/ingest/parse-transcript.ts` | Extract compact facts, including path/classification and compaction metadata. | Shared compact types; no Store/UI imports. |
| `server/ingest/warm-cache.ts` | Versioned serialization/validation of every compact parsed record. | Parser/shared record types and Node filesystem APIs only. |
| `server/store/logical-turns.ts` | Pure grouping of prompt/main/sidechain records into stable user-visible turns. | Shared `Turn` plus prompt record type; no route/client dependency. |
| `server/store/store.ts` | Sole mutable owner and atomic session snapshot reader. | Ingest record types and store derivations; no routes/client. |
| `server/session-detail/projector.ts` | Pure section calculations and wire projection. | Shared contracts/types, logical-turn helper, pricing/distribution/anomaly primitives; never live Store or filesystem. |
| `server/routes/session-detail.ts` | Fastify resource registration and 404 mapping. | Store snapshot/list readers, projector, runtime metadata. |
| `client/src/api/session-detail.ts` | Fetch, cancellation, error typing, and runtime response guard. | Shared detail contract only. |
| `client/src/pages/SessionDetail.tsx` | Route parameter, query lifecycle, loading/error/not-found shell. | Client API/query keys and pure detail view. |
| `client/src/pages/session-detail/` | Page layout, fixed-session charts/tables, formatting, and accessible semantic fallbacks. | Shared response contract plus existing client Chart/DataTable/badges; no fetch calls. |

## Change Footprint

_The concrete answer to "where does this land in the codebase?" — produced during the Phase D2 walk._

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `shared/session-detail-contract.ts` | Complete detail wire types and availability vocabulary. | `shared/sessions-contract.ts` |
| `shared/session-detail-contract.test.ts` | Contract construction/type assertions. | `shared/sessions-contract.test.ts` |
| `server/store/logical-turns.ts` | Group main/sidechain derived turns by prompt for stable display semantics. | Pure derivations in `server/store/derive-turns.ts` |
| `server/store/logical-turns.test.ts` | Protect grouping, order, prompt-only, and sidechain invariants. | `server/store/derive-turns.test.ts` |
| `server/session-detail/projector.ts` | Pure response projection for all page sections. | `server/metrics/engine.ts`; `server/routes/sessions.ts` projection helpers |
| `server/session-detail/projector.test.ts` | Fixture-shaped projector verification and availability boundaries. | `server/metrics/engine.test.ts` |
| `server/routes/session-detail.ts` | Thin Fastify `GET /api/sessions/:id` registration. | `server/routes/sessions.ts` |
| `server/routes/session-detail.test.ts` | Route status/shape boundary coverage. | `server/routes/sessions.test.ts` |
| `client/src/api/session-detail.ts` | Guarded typed detail fetcher and error types. | `client/src/api/sessions.ts` |
| `client/src/api/session-detail.test.ts` | Fetch URL, cancellation, error, and shape-guard coverage. | `client/src/api/sessions.test.ts` |
| `client/src/pages/session-detail/SessionDetailView.tsx` | Pure responsive composition of all binding sections. | `client/src/pages/Dashboard.tsx` |
| `client/src/pages/session-detail/Header.tsx` | Session identity, tier, cost, median, and availability header. | `client/src/pages/dashboard/RecentSessionCard.tsx` |
| `client/src/pages/session-detail/CostTimeline.tsx` | Cumulative/per-turn visualization, context trace, turn rules, and compactions. | `client/src/charts/ChartCard.tsx` and low-level `Chart.tsx` |
| `client/src/pages/session-detail/TurnsSection.tsx` | Separate semantic regions for stacked bars, virtualized turn table, and history distribution. | `client/src/components/DataTable.tsx`; chart primitives |
| `client/src/pages/session-detail/CacheStrip.tsx` | Per-call cache hit/write visualization and cause labels. | Existing dashboard chart/card styling |
| `client/src/pages/session-detail/ToolMix.tsx` | Tool mix plus time-ordered tool timeline missing from the mockup. | Dashboard page-local panels |
| `client/src/pages/session-detail/PromptList.tsx` | Virtualized per-turn typed prompt list. | `client/src/components/DataTable.tsx` |
| `client/src/pages/session-detail/WorkflowFunnel.tsx` | Cumulative edit/read/plan/verify/commit coverage. | Existing semantic progress bars in dashboard sections |
| `client/src/pages/session-detail/TokenFunnel.tsx` | Context/cache/fresh/output token funnel. | Existing semantic progress bars in dashboard sections |
| `client/src/pages/session-detail/ContextComposition.tsx` | Tool-result byte composition by originating tool. | Dashboard page-local panels |
| `client/src/pages/session-detail/format.ts` | Page-specific time, percent, prompt, and availability formatting. | `client/src/pages/dashboard/format.ts` |
| `client/src/pages/session-detail/SessionDetail.stories.tsx` | Transcript-only, premium-available, partial, empty, and anomaly visual states. | Existing dashboard section stories |
| `client/src/pages/session-detail/SessionDetail.test.tsx` | Page composition, state, navigation, and accessible-region coverage. | `client/src/pages/dashboard/Dashboard.test.tsx` |
| `cypress/e2e/session-detail.cy.ts` | Fixture-backed route smoke and turn drill journey. | `cypress/e2e/dashboard.cy.ts` |

### Modified files / modules

| Path | What changes here |
|---|---|
| `shared/types.ts` | Add optional compact target/Bash classifications to `ToolUseRef`; keep general tool inputs excluded. |
| `shared/types.test.ts` | Cover the additive compact fields without weakening existing shapes. |
| `server/ingest/parse-transcript.ts` | Parse target paths, commit classification, originating tool names, and compact-boundary records into `ParseTranscriptResult`. |
| `server/ingest/parse-transcript.test.ts` | Update expected compact calls and cover new record classifications. |
| `server/ingest/warm-cache.ts` | Serialize/validate compaction records and require the new cache schema version. |
| `server/ingest/warm-cache.test.ts` | Cover new records and rejection of pre-versioned cache entries as safe misses. |
| `server/ingest/tailer.test.ts` | Update typed `ParseTranscriptResult` fixtures for the additive compaction array and cache version. |
| `server/store/store.ts` | Accumulate/reset compactions and expose the recomputed atomic session snapshot. |
| `server/store/store.test.ts` | Protect snapshot coherence, reset behavior, and existing invalidation timing. |
| `server/store/derive-session.ts` | Derive user-visible turn count and max turn cost from logical prompt groups. |
| `server/store/derive-session.test.ts` | Update sidechain expectations while preserving pricing/tier rollups. |
| `server/metrics/measures.ts` | Count logical prompt turns rather than separately derived sidechain segments. |
| `server/metrics/measures.test.ts` | Protect logical turn-count behavior for aggregate scopes. |
| `server/metrics/engine.ts` | Use logical turn groups for turn-entity distribution scopes so fleet baselines match Session Detail. |
| `server/metrics/engine.test.ts` | Protect main/sidechain distribution grouping. |
| `server/routes/sessions.ts` | Build session-list traces from logical turns so Dashboard traces and detail turn numbers agree. |
| `server/routes/sessions.test.ts` | Update trace/count expectations and preserve pagination/filter behavior. |
| `server/app.ts` | Register the detail route with the same Store/runtime metadata as metrics and session-list routes. |
| `server/app.test.ts` | Include detail route assembly in app-level behavior. |
| `client/src/api/queryKeys.ts` | Promote the existing per-session prefix into canonical `qk.session(id)` while retaining identical prefix matching. |
| `client/src/api/queryKeys.test.ts` | Protect exact detail keys and list/detail prefix separation. |
| `client/src/ws.test.ts` | Verify a matching `session-updated` invalidates the mounted detail key. |
| `client/src/pages/SessionDetail.tsx` | Replace `PageStub` with route/query state and pure view composition. |
| `client/src/routes.ts` | Replace the provisional Turn Inspector parameter path with the gates-spec path. |
| `client/src/pages/TurnInspector.tsx` | Accept `sessionId` and `turnNumber` parameters while remaining a stub for #P4-6. |

### Deleted / replaced

| Path | Reason |
|---|---|
| `client/src/pages/SessionDetail.tsx` placeholder body | Replaced in place by the real page query shell; the file remains. |
| Client route `/turns/:id` | Replaced by `/session/:sessionId/turn/:turnNumber`, the evidence-link shape settled in `specs/gates.md`; search found no current producer. |

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| `client/src/pages/dashboard/RecentSessionCard.tsx` | Consumes session-list traces whose points are now logical rather than raw main/sidechain turns. |
| `client/src/pages/dashboard/AnomalyFeed.tsx` | Diffs those traces into anomaly samples; thresholds/items could shift when sidechains are grouped. |
| `shared/anomaly.ts` | Remains the one anomaly classifier reused by the projector; its factor/median semantics must not be forked. |
| `client/src/ws.ts` | Already invalidates `['session', id]`; key-factory refactoring must preserve this exact behavior. |
| `server/ingest/tailer.ts` | Passes parser/cache results through unchanged; new records must survive both cold and warm paths. |
| `server/ingest/pipeline.ts` | Applies the whole parse result to Store; no special compaction side channel should be introduced. |
| `client/src/charts/Chart.tsx` | Reused for fixed-session canvases; its accessibility and resize lifecycle remain authoritative. |
| `client/src/components/DataTable.tsx` | Reused for potentially long turn/prompt lists; virtualization and keyboard row actions must remain intact. |
| `test/fixtures/projects/-Users-demo-project-alpha/11111111-1111-4111-8111-111111111111.jsonl` | Existing multi-turn/sidechain fixture backs the Cypress route without being edited, avoiding global Dashboard metric drift. |
| `specs/issues/P4-6-turn-inspector-page.md` | #P4-6 consumes the UI turn address and API turn identity established here. |
| `specs/issues/P4-11-gates-engine.md` | Future V1/P3/K2 gates must share the compact classifications and one-based logical turn evidence identity. |
| `specs/issues/P4-13-premium-tier-cbl-parsers-upgrades.md` | Future premium fields must fill existing optional slots instead of replacing the detail contract. |

## Areas of Impact

_Broader-than-files impact — modules, services, teams, contracts, cross-cutting effects._

| Area | Impact | Risk (L/M/H) | Why |
|---|---|---|---|
| Compact ingest and warm cache | Adds workflow/compaction facts and invalidates the old cache format once. | H | A stale warm hit would make the page silently wrong; schema rejection must be exact and rebuildable. |
| Turn semantics | User-visible counts/traces/distributions group sidechains under prompt turns. | H | Existing Dashboard and metrics consumers currently observe raw derived-turn array length. |
| Store read boundary | Adds coherent single-session snapshots without changing the writer/invalidation model. | M | Incorrect recompute timing could mix new calls with stale turns or alter debounce behavior. |
| Detail HTTP contract | Adds a new read-only response and 404 shape. | M | The response is broad and every page section depends on its runtime guard staying aligned. |
| Client page and visualization | Replaces a stub with eleven binding sections and responsive/accessibility states. | M | Dense layout and canvas fallbacks have substantial visual and keyboard surface. |
| Live invalidation | Activates the already-forward-looking session query prefix. | L | Protocol is unchanged; risk is limited to key mismatch/refetch omission. |
| Prompt/path privacy | Returns prompt text by requirement and derives path-sensitive workflow facts. | M | Prompt content is sensitive local data; paths should not cross the wire when only counts are needed. |
| #P4-6 Turn Inspector | Establishes canonical one-based UI turn identity and route parameters. | M | A mismatch would break every later drill/evidence link. |
| #P4-11/#P4-12 gates and Report Card | Establishes compact V1/P3/K2 inputs but does not implement gate outcomes. | M | Later code must reuse, not reinterpret, classifiers and turn numbers. |
| #P4-13 premium upgrades | Reserves optional observed cost/context/timing/line fields. | M | Incorrect sentinel choices would force a breaking contract change later. |
| Phase 5 performance | Exact fleet distribution remains an all-history operation. | H | Multi-million-turn histories exceed the current unindexed in-memory design's comfortable request budget. |

**Contract changes:** Adds `SessionDetailResponse` and `GET /api/sessions/:id`; adds optional compact
fields to `ToolUseRef`; adds compaction records to the internal parse/cache contract; changes
user-visible turn counts/traces/distributions to logical prompt grouping; replaces the provisional
Turn Inspector UI route. Consumers are Session Detail, Dashboard trace/anomaly panels, metrics turn
counts/distributions, future Turn Inspector, and future gate evidence producers.

**Cross-cutting ripples:** No auth, feature flag, database, deployment, or WebSocket message change.
The warm cache rebuilds once after rollout. Storybook/Cypress gain page coverage; production build
composition is unchanged. Future premium/gate work fills reserved fields and reuses compact analysis
signals rather than changing the base resource.

## Cross-Cutting Concerns

- **Errors:** Unknown IDs return typed 404s; malformed 2xx payloads become a distinct client shape
  error; AbortSignal cancellation is not shown as an error; unexpected server failures follow
  Fastify's 500/log path. A known but empty transcript returns 200 with honest empty sections.
- **Logging & metrics:** Existing Fastify request logging is sufficient. Do not log response bodies,
  prompt text, target paths, or tool content. Projector duration and response size are candidates for
  the Phase 5 performance pass, not a new telemetry dependency here.
- **Auth / authz:** This remains a local same-origin read resource with no auth layer. Exact Map
  lookup is the validation boundary; a session ID never becomes a path. The existing loopback
  WebSocket Origin guard is unchanged.
- **Performance:** Snapshot/projector work is synchronous and bounded by current-session records plus
  one fleet logical-turn cost baseline. Fleet costs are sorted once per response and ranks use binary
  search, avoiding a session-turn × fleet-turn loop. Long tables are virtualized, responses exclude
  raw bodies, and only mounted detail queries refetch. Multi-million-turn exact baselines remain an
  explicit Phase 5 risk.
- **Security:** React escapes prompts; raw tool-result bodies and general tool inputs remain dropped;
  derived target paths stay server-side because the funnel needs counts, not filenames. No secrets
  or Bash command strings are retained for this feature.
- **Migrations / rollout:** No persistent-data migration. Increment the rebuildable warm-cache schema;
  old/new code both degrade incompatible records to cache misses, leaving transcripts untouched.
  The HTTP addition is backward compatible; the only replaced public-looking surface is an explicitly
  provisional, currently unconsumed client route.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|---|---|---|---|
| A1 | One atomic detail resource. | Multiple metrics/detail calls; per-section endpoints. | Keeps all sections consistent across live updates and matches the settled API. | R1, R3 |
| A2 | Pure server projector over compact arrays. | Route calculations; React aggregation. | Preserves boundaries, testability, and a small browser payload. | R1, R7 |
| A3 | Versioned compact metadata additions only. | Raw results/inputs; route filesystem reads. | Enables exact required analysis without violating memory/privacy constraints. | R4, R7 |
| A4 | Logical prompt turns with main/sidechain segments. | Display raw derived turns; merge sidechain internals. | Matches user-visible turn meaning while preserving Store isolation. | R1, R6 |
| A5 | Exact fleet history for turn ranks at intended scale. | Recent-only Dashboard traces; client sampling. | The requirement says all-time and the server already owns pricing/history. | R1 |
| A6 | Cumulative workflow cohort using exact P3/V1 semantics. | Independent non-monotonic bars; new gate rules. | Keeps the visualization a true funnel and avoids conflicting future gates. | R1, R4 |
| A7 | Plan tools are `EnterPlanMode`, `ExitPlanMode`, `TodoWrite`, `TaskCreate`, or `TaskUpdate`; commit is classified Bash `git commit`. | Prompt-text inference; retaining full commands. | Deterministic, compact, explainable, and privacy-preserving. | R1, R7 |
| A8 | One page-owned TanStack query with pure sections. | Per-section queries; shared React aggregation context. | The page is one resource and pure sections give clean Storybook states. | R3, R8 |
| A9 | Reuse Chart/DataTable/semantic HTML; no new dependency. | Force `ChartCard`; new visualization package. | Existing primitives cover the required interactions and accessibility surface. | R1, R8 |
| A10 | Reserve optional premium fields and render unavailable states. | Pull #P4-13 forward; fabricate estimates for red fields. | Preserves tier truthfulness and downstream contract stability. | R2, R5 |
| A11 | Turn drills use `/session/:id/turn/:n`, one-based. | Keep provisional `/turns/:id`; invent another nested route. | Follows the settled gate-evidence URL and gives #P4-6 a stable identity. | R6, R8 |
| A12 | Global filters remain in the URL/navigation context but do not filter an addressed session. | Hide FilterBar; return 404 when the session misses active filters. | A detail URL names a resource; silently changing its contents by fleet filters is surprising. | R3 |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| WebSocket is unavailable for 30 seconds while the session changes. | The mounted page may be stale temporarily; reconnect already invalidates all queries, causing an HTTP refetch. Manual reload remains functional because data never depends on the socket. |
| Ingest appends a call while a GET is projecting. | Node runs the synchronous snapshot/projector on one event-loop turn, so the response is internally atomic. A later append produces another debounced invalidation/refetch. |
| Two browsers request the same active session concurrently. | Both operations are read-only and deterministic; they share no mutable projector state and cannot create duplicates. |
| A known transcript has no complete turn yet. | Return 200 with prompt/header facts, empty or partial call/turn sections, and explicit partial availability; never turn a known empty state into 404. |
| Pricing/context metadata lacks a model. | Preserve the established unavailable/zero rules; affected optional ranks/costs/context values render unavailable rather than throwing or fabricating. |
| A cache-write spike occurs on the first call, after a model switch, or around compaction. | The K2-compatible ordered cause classifier yields a deterministic explanation; otherwise it marks the spike unexplained. |
| Fleet history grows from thousands to millions of turns. | Current algorithm remains correct but the exact all-history sort can miss interactive budgets. **GAP — see Open Questions and Phase 5 performance risk.** |
| Deployment is rolled back after new warm-cache records were written. | The older reader rejects unknown/versioned records as a cache miss and reparses source transcripts; no source or user configuration is migrated. |

### Backward — regression risk per touched area (brownfield only)

| Touched area (from Change Footprint) | What could regress | How we'd know / mitigation |
|---|---|---|
| Parser compact calls | Existing call equality, dedupe, malformed/skip counts, or Bash error attribution changes. | Keep additions optional on shared shapes where compatible; parser regression suite covers existing fixtures plus focused new lines. |
| Warm cache | Warm boot omits new facts or rejects valid current entries. | Version gate, round-trip coverage for every record kind, and tailer warm-hit/miss tests. |
| Store snapshot/invalidation | Snapshot mixes fresh calls with stale turns or emits different invalidation timing. | Recompute one session before returning; preserve existing invalidator path and store timing tests. |
| Logical-turn grouping | Sidechain usage leaks into main gates or counts as a second user turn. | Dedicated grouping tests plus existing derive-turn sidechain-isolation tests. |
| Session list traces | Dashboard thumbnail/anomaly deltas change order or cumulative totals. | Route trace tests assert logical order/total; Dashboard component and Cypress smoke remain green. |
| Metrics turn scopes | Turn counts/distributions double-count or drop sidechain-only work. | Measures/engine tests compare grouped costs/counts with mixed main/sidechain inputs. |
| Query-key factory | Session updates fail to refetch detail or accidentally invalidate unrelated detail IDs. | Query-key and WebSocket mapping tests assert exact and prefix matches. |
| Client route replacement | Existing links/bookmarks to the provisional path stop resolving. | Code search found no current producer; all new row/chart links and Cypress use the gates path. |
| DataTable/Chart reuse | Virtualization, keyboard drills, or non-canvas summaries regress. | Components remain unchanged; page-level interaction/accessibility coverage exercises their public contracts. |
| Premium placeholders | Later #P4-13 cannot fill observed values without changing response shapes. | Contract contains explicit optional observed/timing/line/context fields and availability flags now. |

## Open Questions

- At what fleet size does exact all-time turn distribution stop meeting the interactive request
  budget?
  - **Impact if unresolved:** Very large histories could make live detail refetches CPU-heavy even
    though the session-local response remains compact.
  - **Suggested default:** Keep exact results for Phase 4, record projector duration/response size in
    the Phase 5 performance pass, then introduce a revision-keyed index or explicitly labelled
    deterministic sample only if measured budgets are missed.
- Will future Claude Code versions add planning/commit tool names that the compact classifier does
  not recognize?
  - **Impact if unresolved:** Workflow coverage under-reports plan/commit stages but does not corrupt
    other sections.
  - **Suggested default:** Centralize the documented name set, ignore unknown names, and extend it
    only from observed transcript evidence or a settled gate-spec update.

## Out of Scope

- Report Card, gate results, evidence, and score rendering (reason: owned by #P4-11/#P4-12).
- Parsing or reconciling C/B/L premium file contents (reason: owned by #P4-13; this feature only
  reserves optional fields and tier states).
- Raw transcript peek and API-call waterfall endpoints (reason: owned by #P4-6 Turn Inspector).
- Changing global filter semantics or implementing Sessions search/compare/tags (reason: #P4-4 and
  global filter work own those resources).
- New persistence, authentication, telemetry dependencies, or data-bearing WebSocket messages
  (reason: unnecessary for the read-only local resource).
- A multi-million-turn distribution index (reason: implement only if Phase 5 measurements show the
  existing in-memory exact path misses budgets).
- Implementation sequencing, estimates, and test-case enumeration (reason: Phase 3
  `generate-tasks` owns task decomposition).

---

# Tasks

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-session-detail-page.md`_
