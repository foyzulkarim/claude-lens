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

## Task T1: Retain Compact Workflow and Compaction Metadata

> **Status:** not started
> **Date:** 2026-07-18
> **Verification:** tdd
> **Effort:** l
> **Priority:** critical
> **Depends on:** None
> **Satisfies REQs:** R1, R7
> **Footprint slice:** Modified: `shared/types.ts`, `server/ingest/parse-transcript.ts`, `server/ingest/warm-cache.ts`, and their tests; typed fixture updates in `server/ingest/tailer.test.ts`
> **High-risk areas touched:** Compact ingest and warm cache (H); Prompt/path privacy (M)

### Description

Extend the compact transcript contract with the minimum workflow, tool-result, and compaction facts
required by Session Detail. Version the rebuildable warm cache so an old warm hit can never silently
omit the new facts, while retaining no raw commands, general tool inputs, or tool-result bodies.

### Test Plan

#### Test File(s)

- `shared/types.test.ts`
- `server/ingest/parse-transcript.test.ts`
- `server/ingest/warm-cache.test.ts`
- `server/ingest/tailer.test.ts`

#### Test Scenarios

##### Compact tool classification

- **retains only normalized workflow facts** — GIVEN Read, Edit, Write, ordinary Bash, and
  `git commit` tool uses WHEN transcript lines are parsed THEN path-bearing tools retain normalized
  target paths, Bash retains only `git-commit` or `other`, and no command/general input is stored
  _(verifies R7)_
- **joins tool results without retaining bodies** — GIVEN a tool use followed by a tool result WHEN
  the batch is parsed THEN the compact result contains the tool-use ID, originating name, byte count,
  error flag, and sidechain flag but not content _(verifies R1, R7)_
- **recognizes the settled planning vocabulary** — GIVEN EnterPlanMode, ExitPlanMode, TodoWrite,
  TaskCreate, and TaskUpdate calls WHEN parsed THEN their existing names remain available for the
  centralized workflow classifier without prompt-text inference _(verifies R1)_

##### Compaction and cache lifecycle

- **captures explicit compact boundaries** — GIVEN a valid `system/compact_boundary` line WHEN
  parsed THEN one compact record with session, timestamp, and optional prompt identity is emitted
  without increasing malformed counts _(verifies R1)_
- **round-trips the current cache schema** — GIVEN calls, prompts, compact tool results, and
  compactions WHEN a warm-cache entry is saved and loaded THEN every compact field is preserved
  exactly _(verifies R1, R7)_
- **treats old cache schemas as safe misses** — GIVEN a pre-versioned cache entry WHEN loaded THEN
  it returns a cache miss without mutating transcript source data or throwing
  _(verifies ARCH rollback stress-test)_
- **keeps warm and cold paths equivalent** — GIVEN the same transcript through a cold parse and a
  warm-cache hit WHEN Tailer emits records THEN the Store-facing results are equivalent
  _(guards backward-regression risk for `server/ingest/tailer.ts`)_
- **preserves parser invariants** — GIVEN existing duplicate, malformed, sidechain, and Bash
  exit-code fixtures WHEN parsed THEN their existing counts and error attribution remain unchanged
  _(guards ARCH backward-regression risk for parser compact calls)_

### Implementation Notes

- **Module(s):** `shared/types.ts`, `server/ingest/parse-transcript.ts`,
  `server/ingest/warm-cache.ts`
- **Pattern reference:** existing compact `ToolUseRef`, `ToolResultBytesRecord`, and rebuild-on-miss
  validation in `server/ingest/warm-cache.ts`
- **Key decisions:** A3 and A7; tool names and derived classifications are retained, payloads are not
- **Libraries:** Node buffer/filesystem APIs and existing TypeScript/Vitest only
- **High-risk callouts:** Cache compatibility is load-bearing; current-schema round trips and
  old-schema misses must both be explicit rather than inferred from absent fields

### Scope Boundaries

- Do NOT retain Bash command strings, arbitrary tool inputs, or tool-result bodies.
- Do NOT implement gates, Report Card behavior, or C/B/L premium parsing.
- Do NOT add a special parser-to-UI channel; compact records continue through Tailer and Store.
- Only implement compact facts and versioned serialization needed by the architecture contract.

### Files Expected

**New files:**

- None.

**Modified files:**

- `shared/types.ts` (add optional compact target and Bash classifications)
- `shared/types.test.ts` (cover the additive compact fields)
- `server/ingest/parse-transcript.ts` (parse workflow/tool-result/compaction facts)
- `server/ingest/parse-transcript.test.ts` (cover classifications and preserve parser invariants)
- `server/ingest/warm-cache.ts` (version, serialize, and validate all compact records)
- `server/ingest/warm-cache.test.ts` (cover round trips and old-schema misses)
- `server/ingest/tailer.test.ts` (update typed parse results and guard warm/cold equivalence)

**Must NOT modify:**

- `server/ingest/tailer.ts` (pass-through behavior is a silent-regression hotspot)
- `server/ingest/pipeline.ts` (must continue applying the complete parse result unchanged)
- `test/fixtures/projects/` (the existing corpus must not drift for this metadata extension)

### TDD Sequence

Start with compact tool and compaction parser failures, then cache round-trip/version failures, and
finish by running the existing parser/tailer regression suites unchanged.

---

## Task T2: Derive Logical Turns and Atomic Session Snapshots

> **Status:** not started
> **Date:** 2026-07-18
> **Verification:** tdd
> **Effort:** l
> **Priority:** critical
> **Depends on:** T1
> **Satisfies REQs:** R3, R6, R7
> **Footprint slice:** New: `server/store/logical-turns.ts`; Modified: `server/store/store.ts`, `server/store/derive-session.ts`, and colocated tests
> **High-risk areas touched:** Turn semantics (H); Store read boundary (M)

### Description

Introduce the canonical user-visible turn adapter that groups main and sidechain derived turns by
prompt without changing Store's existing isolation model. Add one atomic Store snapshot reader so
the detail projector receives Session, calls, turns, prompts, results, and compactions from a single
synchronous revision.

### Test Plan

#### Test File(s)

- `server/store/logical-turns.test.ts`
- `server/store/store.test.ts`
- `server/store/derive-session.test.ts`
- `server/store/derive-turns.test.ts` (run unchanged as regression evidence)

#### Test Scenarios

##### Logical turn grouping

- **groups main and sidechain work by prompt** — GIVEN main and sidechain derived turns sharing a
  prompt WHEN grouped THEN one chronological logical turn contains the main segment and every
  sidechain segment with a one-based number _(verifies R6)_
- **preserves incomplete logical turns** — GIVEN prompt-only, sidechain-only, or partially completed
  state WHEN grouped THEN the logical turn is retained with honest optional segment/timestamp fields
  _(verifies R3, R6)_
- **keeps sidechain attribution isolated** — GIVEN sidechain result bytes and errors WHEN grouping
  and deriving THEN they remain on sidechain segments and are not folded into main gate inputs
  _(guards ARCH backward-regression risk for logical-turn grouping)_

##### Atomic Store reads

- **returns a coherent current snapshot** — GIVEN newly appended calls and pending derived state
  WHEN a known session snapshot is requested THEN exactly that session is recomputed and every array
  reflects the same revision _(verifies R3)_
- **distinguishes unknown from known empty state** — GIVEN an unknown ID and a registered transcript
  with no completed calls WHEN snapshots are requested THEN only the unknown ID returns `undefined`
  _(verifies R3)_
- **clears every compact record on reset** — GIVEN calls, prompts, tool results, and compactions WHEN
  the session is reset THEN no pre-reset record appears in the next snapshot _(verifies R7)_
- **derives logical rollups** — GIVEN a prompt with main and sidechain costs WHEN Session is derived
  THEN turn count is one and maximum turn cost includes both segments exactly once _(verifies R6)_
- **preserves invalidation behavior** — GIVEN a burst of appends WHEN debounce flushes THEN one
  session update is emitted after recompute, matching existing timing and isolation
  _(guards ARCH backward-regression risk for Store snapshot/invalidation)_

### Implementation Notes

- **Module(s):** `server/store/logical-turns.ts`, `server/store/store.ts`,
  `server/store/derive-session.ts`
- **Pattern reference:** pure grouping in `server/store/derive-turns.ts` and lazy per-session reads in
  `server/store/store.ts`
- **Key decisions:** A4; logical turns adapt existing Turn records rather than replacing their model
- **Libraries:** existing TypeScript/Vitest only
- **High-risk callouts:** Snapshot recompute must not change debounce emissions; logical grouping must
  not weaken the sidechain isolation already covered by derive-turns tests

### Scope Boundaries

- Do NOT merge sidechain calls into the existing main `Turn` object.
- Do NOT change prompt assignment, dedupe, or sidechain derivation rules.
- Do NOT expose filesystem reads or route types from Store.
- Only implement grouping, logical Session rollups, compact-state lifecycle, and atomic reads.

### Files Expected

**New files:**

- `server/store/logical-turns.ts` (pure logical prompt-turn adapter)
- `server/store/logical-turns.test.ts` (grouping/order/incomplete-state coverage)

**Modified files:**

- `server/store/store.ts` (accumulate/reset compactions and expose atomic snapshots)
- `server/store/store.test.ts` (snapshot coherence and invalidation regression coverage)
- `server/store/derive-session.ts` (logical turn count and maximum turn cost)
- `server/store/derive-session.test.ts` (logical rollup expectations)

**Must NOT modify:**

- `server/store/derive-turns.ts` (existing main/sidechain isolation is authoritative)
- `server/ingest/pipeline.ts` (Store remains the only mutable ingest destination)

### TDD Sequence

Establish the pure logical-turn tests first, then add Store snapshot failures, and finally update
Session rollups while keeping every existing derive-turn and invalidation regression green.

---

## Task T3: Align Metrics and Session Traces with Logical Turns

> **Status:** not started
> **Date:** 2026-07-18
> **Verification:** tdd
> **Effort:** m
> **Priority:** high
> **Depends on:** T2
> **Satisfies REQs:** R1, R6
> **Footprint slice:** Modified: `server/metrics/measures.ts`, `server/metrics/engine.ts`, `server/routes/sessions.ts`, and their tests
> **High-risk areas touched:** Turn semantics (H); existing Dashboard trace/anomaly consumers (M)

### Description

Apply the logical-turn adapter to all existing turn-count, turn-distribution, and session-trace
surfaces that must agree with Session Detail. Preserve the established list contract, filters,
pricing fallback, and trace caps while preventing sidechain segments from appearing as extra user
turns.

### Test Plan

#### Test File(s)

- `server/metrics/measures.test.ts`
- `server/metrics/engine.test.ts`
- `server/routes/sessions.test.ts`
- Existing Dashboard component tests (run unchanged as regression evidence)

#### Test Scenarios

##### Metrics consistency

- **counts unique prompt turns** — GIVEN a scope with main and sidechain segments sharing a prompt
  WHEN the `turns` measure is computed THEN the result counts one logical turn
  _(verifies R6)_
- **distributes combined logical-turn cost** — GIVEN mixed main/sidechain turn entities WHEN a turn
  distribution is requested THEN each prompt contributes one combined entity and its cost once
  _(verifies R1, R6)_
- **retains sidechain-only activity** — GIVEN a logical turn without a main segment WHEN metrics are
  computed THEN its calls are represented without creating duplicate turn entities _(verifies R6)_

##### Session-list trace compatibility

- **builds one cumulative point per prompt** — GIVEN a priced session with main and sidechain calls
  WHEN `include=trace` is requested THEN points are chronologically logical and the final cumulative
  cost equals the complete session cost _(verifies R6)_
- **preserves trace limits and unpriced fallback** — GIVEN more turns than the cap or no injected
  pricer WHEN trace is projected THEN existing cap/order behavior and honest zero fallback remain
  unchanged _(guards backward-regression risk for `server/routes/sessions.ts`)_
- **preserves list behavior** — GIVEN existing filters, sorts, pagination, and metadata WHEN the list
  route executes THEN every non-trace response field retains its current behavior
  _(guards ARCH backward-regression risk for session-list consumers)_
- **preserves anomaly delta semantics** — GIVEN a logical cumulative trace WHEN Dashboard converts
  it to per-turn deltas THEN costs are non-negative, complete, and ordered
  _(guards backward-regression risk for `client/src/pages/dashboard/AnomalyFeed.tsx`)_

### Implementation Notes

- **Module(s):** metrics measures/engine and sessions-list trace projection
- **Pattern reference:** `server/store/logical-turns.ts`; existing `buildTrace` and distribution
  scopes
- **Key decisions:** A4; all user-facing turn consumers share one grouping definition
- **Libraries:** existing metrics engine, runtime Pricer, TypeScript/Vitest
- **High-risk callouts:** Dashboard values may legitimately change for sidechain sessions, but list
  shape, cumulative totals, and anomaly conversion invariants must not

### Scope Boundaries

- Do NOT change the sessions-list wire contract or filtering vocabulary.
- Do NOT change anomaly thresholds/classification in `shared/anomaly.ts`.
- Do NOT modify Dashboard production components or fixture JSONL.
- Only align counts, distributions, and trace points with logical turns.

### Files Expected

**New files:**

- None.

**Modified files:**

- `server/metrics/measures.ts` (count logical prompt turns)
- `server/metrics/measures.test.ts` (mixed main/sidechain count coverage)
- `server/metrics/engine.ts` (logical turn-entity distribution scopes)
- `server/metrics/engine.test.ts` (combined logical cost distribution coverage)
- `server/routes/sessions.ts` (logical cumulative traces)
- `server/routes/sessions.test.ts` (trace and list regression coverage)

**Must NOT modify:**

- `client/src/pages/dashboard/RecentSessionCard.tsx` (silent-regression hotspot)
- `client/src/pages/dashboard/AnomalyFeed.tsx` (silent-regression hotspot)
- `shared/anomaly.ts` (single anomaly classifier)
- `test/fixtures/projects/` (Dashboard fixture values remain stable source data)

---

## Task T4: Define and Project the Session Detail Resource

> **Status:** not started
> **Date:** 2026-07-18
> **Verification:** tdd
> **Effort:** l
> **Priority:** critical
> **Depends on:** T1, T2, T3
> **Satisfies REQs:** R1, R4, R5, R6, R7
> **Footprint slice:** New: `shared/session-detail-contract.ts`, `server/session-detail/projector.ts`, and their tests
> **High-risk areas touched:** Detail HTTP contract (M); Turn semantics (H); Prompt/path privacy (M); Phase 5 performance (H)

### Description

Define the complete typed Session Detail wire resource and a pure projector that derives every
binding section from compact Store snapshots and exact fleet history. The output must be ready to
render, tier-truthful, deterministic, privacy-preserving, and safe for empty or partial sessions.

### Test Plan

#### Test File(s)

- `shared/session-detail-contract.test.ts`
- `server/session-detail/projector.test.ts`

#### Test Scenarios

##### Complete projection

- **projects every binding section** — GIVEN a representative logical session WHEN projected THEN
  header, timeline, turns, distribution, cache, tools, prompts, workflow, token funnel, context
  composition, and metadata are present while Report Card data is absent _(verifies R1, R2, R4)_
- **computes header history context** — GIVEN fleet sessions and runtime pricing WHEN projected THEN
  cost basis, session median/rank, logical turn count, models, time, and optional drift fields follow
  the shared contract _(verifies R1, R5)_
- **projects logical turn detail** — GIVEN main and sidechain segments WHEN projected THEN one turn
  contains reconciled segment cost/tokens/calls, tools, timing, percentile, anomaly, and flags
  _(verifies R1, R6)_
- **projects timeline and cache causes** — GIVEN ordered calls and compactions WHEN projected THEN
  cumulative values, context estimates, turn rules, compaction flags, and K2-compatible first-call /
  model-switch / compaction / unexplained causes are deterministic _(verifies R1)_

##### Workflow, privacy, and edge behavior

- **derives tools, prompts, and cumulative workflow stages** — GIVEN compact calls and prompts WHEN
  projected THEN Tool Mix/Timeline, prompt order, and edit/read/plan/verify/commit counts match A6/A7
  and never increase at a later funnel stage _(verifies R1, R4, R7)_
- **reconciles token and result-byte funnels** — GIVEN token usage and named/unknown tool results WHEN
  projected THEN context offered equals cache-served plus fresh-billed, output remains separate, and
  result bytes group by tool with an Unknown fallback _(verifies R1, R7)_
- **keeps sensitive derivation inputs server-side** — GIVEN target paths, commands, and result
  records WHEN projected THEN no target path, command, or raw result body is present anywhere in the
  response _(verifies R7)_
- **handles unavailable and partial data honestly** — GIVEN empty, in-progress, unpriced, or
  unknown-model inputs WHEN projected THEN optional values/availability flags are correct and no
  number is `NaN` or infinite _(verifies R3, R5; verifies ARCH edge scenarios)_

### Implementation Notes

- **Module(s):** shared detail contract and pure server projector
- **Pattern reference:** `shared/sessions-contract.ts`, pure `server/metrics/engine.ts`, pricing and
  distribution helpers, and `shared/anomaly.ts`
- **Key decisions:** A1, A2, A5, A6, A7, and A10
- **Libraries:** existing TypeScript, metrics/pricing helpers, and Vitest only
- **High-risk callouts:** Sort the fleet baseline once and use rank lookups rather than a
  session-turn × fleet-turn loop; preserve `undefined = unavailable`, `0 = measured zero`

### Scope Boundaries

- Do NOT implement HTTP, React, Report Card, gate results, or premium file parsing.
- Do NOT accept a live Store or read the filesystem from the projector.
- Do NOT leak retained path/classification inputs into the wire response.
- Only define and derive the architecture's complete `SessionDetailResponse`.

### Files Expected

**New files:**

- `shared/session-detail-contract.ts` (complete detail wire vocabulary)
- `shared/session-detail-contract.test.ts` (contract construction/type coverage)
- `server/session-detail/projector.ts` (pure response projection)
- `server/session-detail/projector.test.ts` (behavior, edge, privacy, and stress coverage)

**Modified files:**

- None.

**Must NOT modify:**

- `shared/anomaly.ts` (reuse its existing classifier)
- `server/store/store.ts` (consume the T2 snapshot boundary, do not widen it ad hoc)
- `specs/issues/P4-11-gates-engine.md` and `specs/issues/P4-13-premium-tier-cbl-parsers-upgrades.md`
  (downstream contracts, not implementation targets)

### TDD Sequence

Start with the wire contract and empty/unavailable response, then add logical turn/timeline values,
and finish with fleet ranks, cache/workflow classifiers, and privacy regression assertions.

---

## Task T5: Wire the Detail Resource Across HTTP and Client Transport

> **Status:** not started
> **Date:** 2026-07-18
> **Verification:** tdd
> **Effort:** m
> **Priority:** high
> **Depends on:** T4
> **Satisfies REQs:** R3, R5, R7
> **Footprint slice:** New: `server/routes/session-detail.ts`, `client/src/api/session-detail.ts`; Modified: `server/app.ts`, `client/src/api/queryKeys.ts`, and boundary tests
> **High-risk areas touched:** Detail HTTP contract (M); Live invalidation (L); Prompt/path privacy (M)

### Description

Expose the pure resource through a thin Fastify GET route and a guarded, cancellable browser
fetcher. Register the route with the existing Store/runtime metadata and promote the existing
per-session invalidation tuple into the canonical query-key factory operation.

### Test Plan

#### Test File(s)

- `server/routes/session-detail.test.ts`
- `server/app.test.ts`
- `client/src/api/session-detail.test.ts`
- `client/src/api/queryKeys.test.ts`

#### Test Scenarios

##### Server boundary

- **returns the projected known resource** — GIVEN a known session and injected runtime metadata
  WHEN `/api/sessions/:id` is requested THEN it returns `200` with the projector response and ignores
  unrelated global-filter query parameters _(verifies R3, R5)_
- **distinguishes unknown and known empty sessions** — GIVEN an unknown ID and a known empty
  transcript WHEN requested THEN the first returns typed `404` and the second returns an honest
  `200` empty response _(verifies R3)_
- **preserves existing app assembly** — GIVEN the detail route is registered WHEN existing ping,
  metrics, sessions, SPA fallback, and WebSocket routes run THEN their behavior is unchanged
  _(guards ARCH backward-regression risk for `server/app.ts`)_

##### Client boundary and query identity

- **fetches the encoded detail URL with cancellation** — GIVEN a session ID and AbortSignal WHEN
  fetched THEN the ID is safely encoded, the signal is passed through, and a valid body is returned
  _(verifies R3, R7)_
- **surfaces typed HTTP errors** — GIVEN a 404 or server failure WHEN fetched THEN the client error
  retains status and structured server detail without attempting to render the body _(verifies R3)_
- **rejects malformed success payloads** — GIVEN a 2xx response missing required or corrupting
  optional detail fields WHEN guarded THEN a distinct response-shape error is thrown
  _(guards ARCH backward-regression risk for the broad detail contract)_
- **produces exact session keys** — GIVEN two session IDs WHEN keys/prefixes are built THEN each key
  is `['session', id]`, matches its existing invalidation prefix, and does not collide with the list
  prefix _(verifies R3)_

### Implementation Notes

- **Module(s):** Fastify route/app assembly, client API wrapper, query-key factory
- **Pattern reference:** `server/routes/sessions.ts`, `client/src/api/sessions.ts`, and current
  forward-looking `qk.prefixes.session`
- **Key decisions:** A1, A8, A10, and A12
- **Libraries:** Fastify, TanStack Query key conventions, browser fetch, TypeScript/Vitest
- **High-risk callouts:** Runtime validation must track the full shared contract; route IDs are exact
  Map keys and never filesystem paths

### Scope Boundaries

- Do NOT add query filtering to an addressed session resource.
- Do NOT change the WebSocket protocol or send detail data over sockets.
- Do NOT add authentication, persistence, or a schema-validation dependency.
- Only implement route registration, guarded fetch, and canonical query identity.

### Files Expected

**New files:**

- `server/routes/session-detail.ts` (thin GET route)
- `server/routes/session-detail.test.ts` (HTTP status/shape coverage)
- `client/src/api/session-detail.ts` (guarded fetcher and typed errors)
- `client/src/api/session-detail.test.ts` (fetch/error/shape coverage)

**Modified files:**

- `server/app.ts` (register detail route with Store/runtime metadata)
- `server/app.test.ts` (protect route assembly and existing surfaces)
- `client/src/api/queryKeys.ts` (add canonical `qk.session(id)`)
- `client/src/api/queryKeys.test.ts` (protect exact/prefix key behavior)

**Must NOT modify:**

- `client/src/ws.ts` (existing invalidation implementation is authoritative)
- `shared/ws-protocol.ts` (no protocol change)
- `server/ingest/` (HTTP never crosses into filesystem ingestion)

---

## Task T6: Build the Query Shell and Live Detail State Boundary

> **Status:** not started
> **Date:** 2026-07-18
> **Verification:** tdd
> **Effort:** m
> **Priority:** high
> **Depends on:** T5
> **Satisfies REQs:** R3, R8
> **Footprint slice:** New: initial `client/src/pages/session-detail/SessionDetailView.tsx` and `SessionDetail.test.tsx`; Modified: `client/src/pages/SessionDetail.tsx`, `client/src/ws.test.ts`
> **High-risk areas touched:** Client page and visualization (M); Live invalidation (L)

### Description

Replace the route stub with the single TanStack Query lifecycle and a pure success-view boundary.
Handle loading, not-found, malformed, generic-error, and success states, and prove that the existing
WebSocket invalidation path refetches exactly the addressed session.

### Test Plan

#### Test File(s)

- `client/src/pages/session-detail/SessionDetail.test.tsx`
- `client/src/ws.test.ts`

#### Test Scenarios

##### Page query states

- **renders an accessible loading state** — GIVEN the detail query is pending WHEN the route renders
  THEN a status is shown without stale/fabricated session values _(verifies R3)_
- **distinguishes 404 and other failures** — GIVEN a typed not-found, server, or malformed-response
  error WHEN rendered THEN the page shows the appropriate not-found or alert state and remains inside
  AppShell _(verifies R3, R8)_
- **hands validated data to one pure view** — GIVEN a successful response WHEN rendered THEN exactly
  that response reaches `SessionDetailView` and the route shell performs no aggregation
  _(verifies R3)_
- **preserves navigation filter context** — GIVEN a detail URL with global query parameters WHEN the
  page fetches and builds navigation THEN only the path ID addresses the resource while navigation
  retains the query string _(verifies R3)_
- **cancels superseded requests** — GIVEN unmount or ID change during a request WHEN React Query
  cancels it THEN no user-facing error is rendered _(verifies ARCH runtime edge behavior)_

##### Live invalidation regression

- **invalidates only the matching detail key** — GIVEN mounted detail queries for two IDs WHEN one
  `session-updated` arrives THEN only that ID's detail prefix matches while existing metrics/list
  invalidations still occur _(verifies R3)_
- **recovers after reconnect** — GIVEN updates were missed during a socket outage WHEN the connection
  reopens THEN the existing invalidate-all behavior makes the mounted detail query refetch
  _(verifies ARCH 30-second dependency-outage stress-test; guards `client/src/ws.ts`)_

### Implementation Notes

- **Module(s):** route-level query shell, pure view boundary, WebSocket mapping tests
- **Pattern reference:** Dashboard section query states and existing `invalidateForMessage` tests
- **Key decisions:** A8 and A12
- **Libraries:** React, wouter, TanStack Query, React Testing Library, Vitest
- **High-risk callouts:** Keep the success view pure and the query key exact so later UI tasks cannot
  create duplicate requests

### Scope Boundaries

- Do NOT implement final page sections, chart options, or visual polish in this task.
- Do NOT modify FilterBar, AppShell, or `client/src/ws.ts`.
- Do NOT aggregate response data in React.
- Only implement resource states, validated data handoff, and invalidation evidence.

### Files Expected

**New files:**

- `client/src/pages/session-detail/SessionDetailView.tsx` (initial pure success-view boundary)
- `client/src/pages/session-detail/SessionDetail.test.tsx` (query-state and handoff coverage)

**Modified files:**

- `client/src/pages/SessionDetail.tsx` (replace PageStub with route/query state)
- `client/src/ws.test.ts` (prove exact detail invalidation and reconnect recovery)

**Must NOT modify:**

- `client/src/ws.ts` (silent-regression hotspot)
- `client/src/filters/FilterBar.tsx` and `client/src/layout/AppShell.tsx` (global behavior is settled)
- `client/src/charts/Chart.tsx` and `client/src/components/DataTable.tsx`

---

## Task T7: Render the Session Header and Cost Timeline

> **Status:** not started
> **Date:** 2026-07-18
> **Verification:** ui
> **Effort:** m
> **Priority:** high
> **Depends on:** T6
> **Satisfies REQs:** R1, R5, R8
> **Footprint slice:** New: `Header.tsx`, `CostTimeline.tsx`, `format.ts`; Modified: `SessionDetailView.tsx` and component test
> **High-risk areas touched:** Client page and visualization (M); #P4-13 premium upgrades (M)

### Description

Establish the page's visual hierarchy with a tier-aware session header and the primary cumulative /
per-turn cost timeline. The timeline must expose turn rules, context, and compaction information
without making canvas the only readable representation.

### Verification Checklist

- **Desktop hierarchy** — expected: header and timeline match the mockup's dense card hierarchy,
  typography, spacing, and cost emphasis without rendering Report Card.
- **Responsive hierarchy** — expected: identity facts, badges, controls, and chart summaries wrap or
  stack without clipping at narrow widths.
- **Header truthfulness** — expected: ID, directory, branch, version, models, logical turns, time,
  context, cost basis, and median/rank render from the response; absent premium values show explicit
  unavailable states rather than zero.
- **Timeline controls** — expected: cumulative/per-turn and cost/token/call controls are keyboard
  operable, visibly selected, and change only display state.
- **Timeline markers** — expected: turn boundaries, context trace, anomaly emphasis, and compaction
  markers are distinguishable and correspond to their semantic summary.
- **Partial/empty behavior** — expected: an active or empty session shows honest partial/empty text
  without a fabricated line, percentage, or amount.
- **Non-canvas access** — expected: visible range/total/marker information communicates the chart's
  material facts without relying on hover, color, or canvas inspection.

#### Testable Seams

- Header conditional fields and tier labels.
- Timeline toggle handlers and selected-state ARIA.
- Marker/summary rendering for populated, empty, and partial data.
- Query-preserving back navigation.

### Implementation Notes

- **Module(s):** page-local Header, CostTimeline, format helpers, and pure view composition
- **Pattern reference:** `RecentSessionCard.tsx`, low-level `Chart.tsx`, and toggle styles used by
  `ChartCard.tsx`
- **Key decisions:** A9 and A10
- **Libraries:** React, ECharts through the existing Chart wrapper, Tailwind, clsx where needed
- **High-risk callouts:** Optional premium values must occupy stable UI states that #P4-13 can later
  populate without reshaping the component contract

### Scope Boundaries

- Do NOT implement Report Card or premium parsing.
- Do NOT force the range-oriented smart `ChartCard` around fixed-session data.
- Do NOT modify the shared Chart implementation.
- Only render the header, timeline, controls, summaries, and page-local formatting.

### Files Expected

**New files:**

- `client/src/pages/session-detail/Header.tsx` (session identity/tier header)
- `client/src/pages/session-detail/CostTimeline.tsx` (fixed-session timeline and summaries)
- `client/src/pages/session-detail/format.ts` (page-local formatting)

**Modified files:**

- `client/src/pages/session-detail/SessionDetailView.tsx` (compose header and timeline)
- `client/src/pages/session-detail/SessionDetail.test.tsx` (testable UI seams)

**Must NOT modify:**

- `client/src/charts/Chart.tsx` (shared lifecycle/accessibility contract)
- `client/src/pages/dashboard/RecentSessionCard.tsx` (pattern reference and regression hotspot)
- `specs/pages/session-detail.html` and `.png` (acceptance references, not implementation files)

---

## Task T8: Render Turn, Cache, and Tool Analysis Panels

> **Status:** not started
> **Date:** 2026-07-18
> **Verification:** ui
> **Effort:** l
> **Priority:** high
> **Depends on:** T7
> **Satisfies REQs:** R1, R4, R5, R6, R8
> **Footprint slice:** New: `TurnsSection.tsx`, `CacheStrip.tsx`, `ToolMix.tsx`; Modified: `SessionDetailView.tsx` and component test
> **High-risk areas touched:** Client page and visualization (M); Turn semantics (H); #P4-6 Turn Inspector (M)

### Description

Render the page's dense turn-analysis core: stacked costs, virtualized turn table, all-time
distribution, per-call cache behavior, and Tool Mix/Timeline. This task deliberately implements the
binding Tool Mix spec gap even though it is absent from the visual mockup.

### Verification Checklist

- **Distinct turn regions** — expected: per-turn bars, turn table, and history distribution each
  have their own labelled semantic region and supporting summary.
- **Main/sidechain stack** — expected: each logical turn is one bar/row; main and sidechain segments
  reconcile to total and anomalies remain visibly distinct without color-only meaning.
- **Turn table contract** — expected: number, cost, tokens, hit rate, models, tools, timing,
  premium-only line/API fields, and flags render with honest tier states.
- **Virtualized drill interaction** — expected: long tables stay bounded; pointer and keyboard row
  actions navigate to the correct one-based Turn Inspector address.
- **History distribution** — expected: per-turn percentile and p50/p90/p99/histogram information
  visibly explains how expensive each turn is relative to all-time history.
- **Cache strip** — expected: per-call hit/write values and first-call, model-switch, compaction, and
  unexplained labels align with the server projection.
- **Tool Mix/Timeline** — expected: tool counts/bytes and chronological tool events render as a full
  binding section despite having no mockup panel.
- **Accessible fallback** — expected: material canvas values and row actions are available through
  semantic text/table controls without hover or canvas inspection.

#### Testable Seams

- Unit selection, anomaly/flag labels, and main/sidechain reconciliation.
- DataTable columns, virtualization opt-out, and keyboard drill handler.
- Cache cause and empty-state rendering.
- Tool Mix/Timeline presence and ordering.

### Implementation Notes

- **Module(s):** page-local turn/cache/tool panels and pure view composition
- **Pattern reference:** `DataTable.tsx`, `Chart.tsx`, dashboard cards, and architecture A4/A9
- **Key decisions:** A4, A5, A9, A10, and A11
- **Libraries:** React, TanStack Table through DataTable, ECharts through Chart, Tailwind
- **High-risk callouts:** Never re-group sidechains or recompute ranks client-side; render the
  projector's one-based logical identity unchanged

### Scope Boundaries

- Do NOT implement Turn Inspector content, raw transcript peek, or API waterfall.
- Do NOT implement gate evidence/Report Card flags.
- Do NOT modify DataTable, Chart, or anomaly classification.
- Only render turn, cache, and tool response slices and their interactions.

### Files Expected

**New files:**

- `client/src/pages/session-detail/TurnsSection.tsx` (bars/table/distribution regions)
- `client/src/pages/session-detail/CacheStrip.tsx` (per-call cache analysis)
- `client/src/pages/session-detail/ToolMix.tsx` (tool mix and timeline)

**Modified files:**

- `client/src/pages/session-detail/SessionDetailView.tsx` (compose new regions)
- `client/src/pages/session-detail/SessionDetail.test.tsx` (testable interactions/states)

**Must NOT modify:**

- `client/src/components/DataTable.tsx` (silent-regression hotspot)
- `client/src/charts/Chart.tsx` (silent-regression hotspot)
- `shared/anomaly.ts` (single anomaly classifier)
- `client/src/pages/TurnInspector.tsx` (route stub changes land in T11)

---

## Task T9: Render Prompts and Workflow Coverage

> **Status:** not started
> **Date:** 2026-07-18
> **Verification:** ui
> **Effort:** m
> **Priority:** medium
> **Depends on:** T8
> **Satisfies REQs:** R1, R4, R7, R8
> **Footprint slice:** New: `PromptList.tsx`, `WorkflowFunnel.tsx`; Modified: `SessionDetailView.tsx` and component test
> **High-risk areas touched:** Client page and visualization (M); Prompt/path privacy (M); #P4-11/#P4-12 gates and Report Card (M)

### Description

Add the ordered prompt history and cumulative workflow funnel over the server-derived P3/V1-compatible
signals. The UI must explain partial or empty coverage without exposing the path and command inputs
used to derive it.

### Verification Checklist

- **Prompt order and identity** — expected: prompts appear in stable logical-turn order with turn
  number, timestamp, source, and typed text.
- **Long prompt handling** — expected: the list remains bounded/virtualized and long text is readable
  without breaking page width or keyboard navigation.
- **Prompt edge states** — expected: prompt-only active turns and sessions without typed prompts show
  honest in-progress/empty states.
- **Workflow stages** — expected: edit cohort, read-first, planned, verified, and committed stages use
  the exact labels/denominators established by A6/A7.
- **Cumulative invariant** — expected: every later stage count/bar is less than or equal to the prior
  stage, including zero-eligible-turn and partial-coverage cases.
- **Privacy boundary** — expected: no target path, Bash command, or tool-result content is displayed,
  serialized into DOM attributes, or exposed by accessible names.
- **Gate distinction** — expected: the funnel describes coverage only and never claims pass/fail
  gate status or renders Report Card content.

#### Testable Seams

- Prompt row ordering, virtualization, and empty/partial states.
- Workflow labels, counts, widths, cumulative invariant, and accessible values.
- Absence of retained server-only path/command fields from rendered output.

### Implementation Notes

- **Module(s):** page-local PromptList and WorkflowFunnel
- **Pattern reference:** shared DataTable and semantic progress bars in dashboard sections
- **Key decisions:** A6, A7, and A9
- **Libraries:** React, DataTable, Tailwind, React Testing Library/Vitest
- **High-risk callouts:** Future gates must be able to reuse the same semantics; do not add a second
  client-side workflow classifier

### Scope Boundaries

- Do NOT implement V1/P3 gate outcomes, evidence, scores, or Report Card.
- Do NOT infer workflow from prompt text or retain commands in the browser.
- Do NOT modify the shared DataTable.
- Only render prompt and workflow slices already present in the response.

### Files Expected

**New files:**

- `client/src/pages/session-detail/PromptList.tsx` (virtualized ordered prompt history)
- `client/src/pages/session-detail/WorkflowFunnel.tsx` (cumulative coverage funnel)

**Modified files:**

- `client/src/pages/session-detail/SessionDetailView.tsx` (compose prompt/workflow regions)
- `client/src/pages/session-detail/SessionDetail.test.tsx` (testable seams and privacy guard)

**Must NOT modify:**

- `client/src/components/DataTable.tsx` (shared behavior remains authoritative)
- `specs/issues/P4-11-gates-engine.md` and `specs/issues/P4-12-report-card-ui-gate-feeds.md`
- `server/session-detail/projector.ts` (render the settled projection; do not redesign it here)

---

## Task T10: Render Token Flow and Context Composition

> **Status:** not started
> **Date:** 2026-07-18
> **Verification:** ui
> **Effort:** m
> **Priority:** medium
> **Depends on:** T9
> **Satisfies REQs:** R1, R5, R7, R8
> **Footprint slice:** New: `TokenFunnel.tsx`, `ContextComposition.tsx`; Modified: `SessionDetailView.tsx` and component test
> **High-risk areas touched:** Client page and visualization (M); Prompt/path privacy (M); #P4-13 premium upgrades (M)

### Description

Complete the binding page sections with semantic token-flow and tool-result context-composition
panels. Both panels render server-reconciled totals and honest zero/unavailable states without
introducing another charting dependency or exposing retained content.

### Verification Checklist

- **Token reconciliation** — expected: context offered equals cache-served plus fresh-billed, output
  remains separate, and every displayed number matches the response.
- **Token narrative** — expected: the relationship between wire context and output is readable in
  text as well as bar length, including the intended small-output comparison.
- **Context grouping** — expected: tool-result bytes and share group by originating tool with a clear
  Unknown fallback and deterministic order.
- **Empty/zero behavior** — expected: zero-token/result sessions display meaningful empty values and
  never produce `NaN`, infinity, or misleading 100% bars.
- **Responsive semantics** — expected: labels, values, and bars remain readable at narrow widths and
  every value is available to screen readers without color-only meaning.
- **Privacy boundary** — expected: only aggregate byte counts cross the rendered boundary; result
  content and target paths never appear.
- **Tier boundary** — expected: transcript-derived values render now while premium-only context facts
  remain explicitly unavailable for #P4-13.

#### Testable Seams

- Exact displayed arithmetic and zero-state branches.
- Unknown-tool grouping and deterministic row order.
- Accessible labels/values and absence of raw content.

### Implementation Notes

- **Module(s):** page-local TokenFunnel and ContextComposition
- **Pattern reference:** semantic progress bars in dashboard sections and page-local formatting
- **Key decisions:** A9 and A10
- **Libraries:** React, Tailwind, React Testing Library/Vitest
- **High-risk callouts:** Render the projector's reconciled facts; no token or byte aggregation belongs
  in these components

### Scope Boundaries

- Do NOT parse premium context samples or tool-result bodies.
- Do NOT add another visualization package or use canvas where semantic bars suffice.
- Do NOT alter token formulas in the client.
- Only render token-funnel and context-composition response slices.

### Files Expected

**New files:**

- `client/src/pages/session-detail/TokenFunnel.tsx` (semantic token-flow panel)
- `client/src/pages/session-detail/ContextComposition.tsx` (aggregate result-byte composition)

**Modified files:**

- `client/src/pages/session-detail/SessionDetailView.tsx` (complete binding section composition)
- `client/src/pages/session-detail/SessionDetail.test.tsx` (arithmetic/a11y/privacy seams)

**Must NOT modify:**

- `server/session-detail/projector.ts` (server remains the aggregation owner)
- `client/src/charts/Chart.tsx` (no canvas needed here)
- `specs/issues/P4-13-premium-tier-cbl-parsers-upgrades.md`

---

## Task T11: Complete Navigation, Stories, E2E, and Visual Sign-Off

> **Status:** not started
> **Date:** 2026-07-18
> **Verification:** ui
> **Effort:** l
> **Priority:** high
> **Depends on:** T10
> **Satisfies REQs:** R1, R2, R3, R4, R5, R6, R8
> **Footprint slice:** Modified: `client/src/routes.ts`, `client/src/pages/TurnInspector.tsx`; New: Session Detail stories and Cypress smoke; final component-test integration
> **High-risk areas touched:** Client page and visualization (M); #P4-6 Turn Inspector (M); Turn semantics (H)

### Description

Finalize the canonical one-based Turn Inspector navigation contract and exercise the completed page
as an integrated feature. Add the required Storybook states, component composition gate, fixture-backed
Cypress journey, command gates, and manual comparison evidence without changing shared fixtures or
closure bookkeeping.

### Verification Checklist

- **Canonical turn route** — expected: `/session/:sessionId/turn/:turnNumber` resolves and the existing
  Turn Inspector stub displays/accepts both one-based parameters; provisional `/turns/:id` is removed.
- **Complete section gate** — expected: the page exposes every R1 labelled region, includes Tool
  Mix/Timeline, and contains no Report Card section or claim.
- **Storybook state matrix** — expected: transcript-only, premium-available, partial/in-progress,
  empty, and anomalous stories render without network access or console/runtime errors.
- **Component integration** — expected: loading/error/success composition, section presence,
  keyboard turn drill, tier states, and query-preserving navigation pass in jsdom.
- **Fixture-backed Cypress smoke** — expected: the existing `11111111-...` fixture loads the real
  detail resource, key sections show fixture-derived data, a turn row lands on the exact one-based
  Turn Inspector path, and navigation back to Sessions preserves active query filters.
- **Live-update evidence** — expected: the T6 WebSocket test demonstrates matching refetch and the
  built page remains usable when the socket reconnects; Cypress does not duplicate that transport
  unit test.
- **Manual mockup comparison** — expected: real-data desktop and narrow-width screenshots are compared
  with `specs/pages/session-detail.html`/`.png`; deviations are intentional bindings from the pages
  table, especially Tool Mix/Timeline and the absent Report Card.
- **Repository verification** — expected: `npm run verify`, `npm run build`, and `npm run test:e2e`
  all exit 0 with no skipped Session Detail gate.
- **Closure boundary** — expected: the issue/plan checkbox remains unchanged in this implementation
  branch because repository policy flips it after issue closure.

#### Testable Seams

- Route parameter parsing and one-based turn links.
- Full section/absence assertions and query-preserving navigation.
- Story render states and Cypress fixture journey.
- Existing Dashboard/Chart/DataTable suites run unchanged as regression evidence.

### Implementation Notes

- **Module(s):** client route table, Turn Inspector stub parameters, Storybook, component integration,
  and Cypress
- **Pattern reference:** existing dashboard stories/tests and `cypress/e2e/dashboard.cy.ts`
- **Key decisions:** A8, A9, A10, A11, and A12
- **Libraries:** wouter, Storybook, React Testing Library, Cypress, existing build/verify scripts
- **High-risk callouts:** Turn numbering/route identity becomes a downstream contract for #P4-6 and
  gate evidence; visual approval must check the binding spec additions, not only the older mockup

### Scope Boundaries

- Do NOT implement Turn Inspector content, Report Card, gates, premium parsing, or raw transcript peek.
- Do NOT edit fixture JSONL merely to make visual states richer; use Storybook response fixtures.
- Do NOT modify Chart, DataTable, Dashboard production consumers, or the plan checkbox.
- Only finalize navigation and produce integrated UI/command/manual verification evidence.

### Files Expected

**New files:**

- `client/src/pages/session-detail/SessionDetail.stories.tsx` (required state matrix)
- `cypress/e2e/session-detail.cy.ts` (fixture-backed route and navigation smoke)

**Modified files:**

- `client/src/routes.ts` (replace the provisional Turn Inspector path)
- `client/src/pages/TurnInspector.tsx` (accept session and one-based turn parameters)
- `client/src/pages/session-detail/SessionDetail.test.tsx` (complete composition/navigation gate)

**Must NOT modify:**

- `test/fixtures/projects/-Users-demo-project-alpha/11111111-1111-4111-8111-111111111111.jsonl`
  (existing fixture is a silent-regression hotspot)
- `client/src/charts/Chart.tsx` and `client/src/components/DataTable.tsx`
- `client/src/pages/dashboard/RecentSessionCard.tsx` and
  `client/src/pages/dashboard/AnomalyFeed.tsx`
- `specs/claude-lens-plan.md` (checkbox flips after issue closure, not during implementation)
