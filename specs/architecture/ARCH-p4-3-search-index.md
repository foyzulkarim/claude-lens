# Architecture: Search Index + Prompt Search (#P4-3, issue #35)

> **Date:** 2026-07-20
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone brief — `specs/issues/P4-3-search-index-prompt-search.md` (issue #35, filed 2026-07). Binding constraints: architecture spec `claude-lens-architecture.md` §9 (route table — `GET /api/search-index`), §11 (client integration pattern); pages spec `claude-lens-pages.md` §2 row 1 (Sessions — "Full-text prompt search across all sessions" — T — 🟢 — "Results → 3 at the matching turn; the sleeper killer feature").
> **Type:** feature (brownfield, new server route + new client component + new WS message type + new query key)

## Architecture Summary

A new `GET /api/search-index` route ships the full prompt corpus as a compact JSON payload `{ prompts: PromptSearchDoc[], version: number }`. The client fetches it once per session (TanStack Query with `staleTime: Infinity`), builds a `MiniSearch` index lazily on the Sessions page, and runs search-as-you-type locally — no per-keystroke server round-trip, matching architecture §11. A new debounced WS message type `session-prompts-changed` invalidates that single query key when prompts are appended (a `session-updated` is too coarse — it would also invalidate every metrics / session / detail query, which is unnecessary churn for a prompt-only mutation). Result rows deep-link to `/sessions/:id?turn=N` (Session Detail's existing turn-anchor contract), reusing the §11 deep-link convention. The existing `PromptSearchSlot` placeholder component is replaced by the new search UI in place — no page-composition change to `Sessions.tsx`.

## Inferred Requirements

This work has no REQ document (it's a plan-task; the spec IS the requirements). The acceptance criteria + page-spec row + architecture §11 together define the contract. Inferred items beyond the literal acceptance criteria:

| ID  | Inferred Requirement                                                                                       | Source                                                                                  |
|-----|------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------|
| IR1 | Index must be invalidated when prompts mutate (live-session appends), not only on reload                     | Architecture §7 (WS invalidation bus is the only live-update path)                       |
| IR2 | Search must work across the entire in-memory `Store.prompts` corpus — not per-session, not paginated         | Architecture §11 ("index fetched once from /api/search-index")                            |
| IR3 | Result rows need stable deep-link with `?turn=N`; Session Detail's existing turn anchor suffices             | Routes table (`/sessions/:id`); existing Turn Inspector precedent (`/session/:id/turn/:n`)|
| IR4 | Search UI lives in the existing `PromptSearchSlot` mount point on the Sessions page; no new page              | `client/src/pages/sessions/PromptSearchSlot.tsx` — already wired into `Sessions.tsx:63`  |
| IR5 | Search must be honest about empty corpus — no fake results, no fake loading shimmer for the unavailable seam | Architecture A11 (unavailable-seam pattern) + existing `EmptyState` component usage     |
| IR6 | Per-tier behavior is 🟢 only — no C/B/L feature flags; C-tokens do not change search behavior                | Pages spec §2 row 1: "T / 🟢"                                                           |
| IR7 | Memory cost of shipping all prompts to client is bounded by what `Store.prompts` already holds              | Architecture §5.4 ("Retain user prompt text (needed for search; small)")                  |

## High-Level Structure

```
   ┌── Server ──────────────────────────────────────────────────────┐
   │  server/store/store.ts: Store.prompts: PromptTextRecord[]      │  ← unchanged
   │              │                                                 │
   │              ▼                                                 │
   │  server/store/store.ts: NEW store.buildSearchSnapshot()        │  ← adds one method
   │              │                                                 │
   │              ▼                                                 │
   │  server/routes/search.ts: NEW GET /api/search-index             │  ← one new route file
   │              │                                                 │
   │              ▼                                                 │
   │  server/app.ts: NEW registerSearchRoute(app, store)             │  ← one new wire-up line
   │              │                                                 │
   │              ▼                                                 │
   │  server/ingest/pipeline.ts: debounce → onInvalidate             │  ← emits one new WS msg
   │              │                                                 │
   │              ▼                                                 │
   │  shared/ws-protocol.ts: NEW SessionPromptsChanged              │  ← new union member
   └────────────────────────────────────────────────────────────────┘
                                  │  WebSocket
                                  ▼
   ┌── Client ──────────────────────────────────────────────────────┐
   │  client/src/ws.ts: handle SessionPromptsChanged →               │
   │      queryClient.invalidateQueries({ queryKey: qk.searchIndex() })│
   │              │                                                 │
   │              ▼                                                 │
   │  client/src/api/queryKeys.ts: NEW qk.searchIndex()             │
   │  client/src/api/search.ts: NEW getSearchIndex() + SearchIndexApiError│
   │              │                                                 │
   │              ▼                                                 │
   │  client/src/pages/sessions/PromptSearchSlot.tsx:               │
   │      REPLACED with PromptSearchPanel.tsx                        │
   │      - useQuery → getSearchIndex()                             │
   │      - useMemo MiniSearch.build                                 │
   │      - debounced input                                         │
   │      - result rows → /sessions/:id?turn=N                       │
   └────────────────────────────────────────────────────────────────┘
```

**Layers added:** one server module, one server route file, one shared contract file (or extend an existing), one WS message type, one client query-key factory entry, one client fetcher module, one new client component (replace placeholder), one new query-key prefix, one new WS handler branch.

**No changes to:** the parser, the in-memory store layout, the metrics engine, the Session Detail projector, the Turn Inspector, the routes table (no new client route — the deep-link reuses `/sessions/:id?turn=N`), the global filter bar (`?q=` is page-local, not global), the warm-cache contract.

## Tech Choices

| Area                | Decision                                                                    | Alternatives Considered                                          | Rationale                                                                                                                                                                              |
|---------------------|-----------------------------------------------------------------------------|------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Search library      | `minisearch` (client-only)                                                  | `flexsearch`, `lunr`, server-side SQL FTS, raw `String.includes` | Already pinned by architecture §2 ("client-side prompt full-text search"). `minisearch` is small (~10KB), supports prefix + fuzzy + field weighting — all useful for prompt search.  |
| Where the index runs | **Client-side** (built lazily on first fetch)                                | (a) Server builds MiniSearch and ships serialized JSON; (b) `POST /api/search?q=` server-side | Architecture §11 is explicit: "search-as-you-type without server round-trips." Rejected (b). (a) adds a version-skew surface for no measurable win — the prompt corpus is small.        |
| Wire format         | Raw JSON array of `PromptSearchDoc`                                         | MiniSearch's `JSON.stringify(index.toJSON())`                    | Keeps `minisearch` a client-only dep (CLAUDE.md §2 dep table). Client builds once via `MiniSearch.load({ index })` or `new MiniSearch(opts).addAll(docs)`.                                |
| Transport trigger   | TanStack Query, `staleTime: Infinity`, no refetchOnWindowFocus              | Plain `fetch` in `useEffect`                                      | Inherits WS-driven invalidation; same factory pattern as every other resource (`qk.xxx` + `queryKeys.test.ts`).                                                                        |
| Invalidations       | New WS message `session-prompts-changed { sessionId }`                       | (a) Overload `session-updated`; (b) Overload `scan-updated`      | (a) over-invalidates metrics/sessions/detail. (b) over-invalidates on settings changes. The dedicated message keeps the bus honest; cost is one new union member in `ws-protocol.ts`.  |
| Deep-link shape     | `/sessions/:id?turn=N` (existing Session Detail turn-anchor)                 | `/session/:id/turn/:n` (Turn Inspector route)                    | Issue acceptance: "results deep-link to Session Detail at the matching turn." Not the Turn Inspector — the *Session Detail page* with the turn anchor pre-set, which scrolls to the turn. |
| Filter integration  | Local page state via `useSearch()` (?q=…); NOT in `useFilters()` global store | Add `q` to the global filter bar                                  | Spec calls it "full-text search across all sessions" — not a global filter; coupling it to `useFilters()` would force every other page to ignore the search box, defeating the URL model. |
| Debounce on input   | 100 ms `useDeferredValue` or `setTimeout`                                    | None (sync render)                                                | Defensive: MiniSearch search at N=10K prompts is <50ms but typing produces redundant work. 100 ms matches user-typing rhythm; well below the 300 ms debounce of ingest events.        |
| Field weighting     | `text` field at boost 2.0; nothing else                                      | Multi-field (project, model)                                       | Spec only asks for prompt-text search. Adding project/model weighting invites scope creep. Single-field keeps the wire format minimal and the UX predictable.                          |

## Patterns & Conventions

- **Route validator idiom** — `parseSearchIndexResponse` (response guard on the client) mirrors the route's "validate, snapshot, delegate" pattern from `server/routes/cache-lab.ts`. The server route is trivial — no request body, just `store.buildSearchSnapshot()` → JSON — so no `parseXxxQuery` validator is needed. The client does the response-shape guard, identical to `client/src/api/cacheLab.ts`.
- **TanStack Query factory** — `qk.searchIndex()` joins the existing factory in `client/src/api/queryKeys.ts`. The literal `"search-index"` segment is the first entry, so `qk.prefixes.searchIndex = ["search-index"]` matches it for invalidation, mirroring the existing `qk.prefixes.config = ["config"]` pattern.
- **Typed API error** — `SearchIndexApiError` + `SearchIndexResponseShapeError` mirror the `CacheLabApiError` / `CacheLabResponseShapeError` split (client/src/api/cacheLab.ts:7-50).
- **Read-only route** — `/api/search-index` only reads; it must NOT mutate Store, mirroring the comment block at the top of `server/routes/sessions.ts:25-30`.
- **WS message union** — extend `WsServerMessage` in `shared/ws-protocol.ts` by adding one more interface member; the existing `ws.ts` switch is exhaustive on the union, so the compiler will fail until we add the handler branch.
- **Placeholder replacement** — `client/src/pages/sessions/PromptSearchSlot.tsx` exists as the documented mount point (R8/ARCH). Replacing its body with a real implementation keeps the `Sessions.tsx` import and JSX position identical — zero ripples to the page composition.
- **Page-local URL state** — Sessions already uses `useSearch()` for `?view=…`, `?sort=…`, `?range=…`. We add `?q=…` with the same `URLSearchParams` round-trip already in `Sessions.tsx`.
- **No Tailwind-utility drift** — match the existing visual density of `PromptSearchSlot`'s section card (`rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]`) — the established page-level section aesthetic, not a new primitive.

## Data Models

### `PromptSearchDoc` (NEW — client-facing wire type)

**Purpose:** One per `PromptTextRecord`, denormalized with the resolved `turnNumber` so the client never has to call back into the server to render result rows.

**Key fields:**
| Field        | Type / Constraint         | Notes                                                                          |
|--------------|---------------------------|--------------------------------------------------------------------------------|
| `id`         | `string` (required)       | `"<sessionId>:<promptId>"` — globally unique, MiniSearch document id           |
| `sessionId`  | `string` (required)       | Direct from `PromptTextRecord.sessionId`                                        |
| `promptId`   | `string` (required)       | Direct from `PromptTextRecord.promptId`                                        |
| `turnNumber` | `number` (1-based)        | Resolved server-side from `state.turns` index matching `promptId`              |
| `text`       | `string` (required)       | Full user-prompt text — MiniSearch's indexed field                              |
| `timestamp`  | `string` (ISO, required)  | From `PromptTextRecord.timestamp` — for ordering + result-row display         |
| `cwd`        | `string \| undefined`     | Optional, for result-row context line ("~/personal/claude-lens"). NOT indexed.  |
| `gitBranch`  | `string \| undefined`     | Optional. NOT indexed.                                                          |

**Relationships:**
- N `PromptSearchDoc` per `Session` (1 per `PromptTextRecord`)
- `turnNumber` resolves to one `Turn` in the same session via the prompt's `promptId`

**Lifecycle:**
- Created lazily by `store.buildSearchSnapshot()` on every `GET /api/search-index`
- Lives entirely in the client's TanStack Query cache (`staleTime: Infinity`)
- Invalidated by WS `session-prompts-changed { sessionId }` (re-fetch → re-build index)
- No server-side persistence; no disk cache

### `SearchIndexResponse` (NEW)

**Purpose:** Top-level wrapper for the JSON payload (gives us a forward-compatible place to add `version`, `builtAt`, etc. without breaking the wire shape).

**Key fields:**
| Field     | Type                    | Notes                                                                      |
|-----------|-------------------------|----------------------------------------------------------------------------|
| `prompts` | `PromptSearchDoc[]`     | Sorted by `(timestamp ASC, sessionId ASC, promptId ASC)` — deterministic    |
| `version` | `number`                | Monotonic; bumps every time the snapshot rebuilds. Lets the client detect  |
|           |                         | stale indexes if a future change introduces incremental updates.            |

### `SessionPromptsChanged` (NEW — WS union member)

```ts
export interface SessionPromptsChanged {
  type: "session-prompts-changed";
  sessionId: string;
}
```

Appended to `WsServerMessage` in `shared/ws-protocol.ts`. Emitted by the ingest pipeline's per-session debounce after `applyRecords` when at least one new `PromptTextRecord` was appended (existing logic emits `session-updated`; we add a parallel emit gated on prompt count delta).

## API Contracts / Interfaces

### `GET /api/search-index`

**Boundary:** HTTP API (Fastify).

**Operations:**
| Method/Op | Path                | Purpose                                            | Errors / Returns                                  |
|-----------|---------------------|----------------------------------------------------|---------------------------------------------------|
| GET       | `/api/search-index` | Returns `SearchIndexResponse` — entire prompt corpus | `200` + `SearchIndexResponse` (always, when app is alive); `500` on internal error |

**Auth requirements:** Loopback-only — same as every other route (architecture §1: "Local-first analytics dashboard"). The existing `/api/*` routes have no auth layer; we follow that.

**Request:** None (no query params; no body).

**Response:** `200 application/json` with body `{ prompts: PromptSearchDoc[], version: number }`. Empty `prompts: []` is a valid 200 — the client renders an empty-state, not an error.

**Response size budget:** at ~250 bytes per prompt (conservative; prompts are short user inputs), 40 K prompts = ~10 MB JSON. Architecture §6 budgets "low hundreds of MB for months of heavy usage" — 10 MB is comfortably inside that and well under Vite's dev-proxy buffer.

### `getSearchIndex()` (client)

**Boundary:** Client fetcher module.

**Signature:**
```ts
export function getSearchIndex(signal?: AbortSignal): Promise<SearchIndexResponse>;
```

**Errors:** Throws `SearchIndexApiError` (non-2xx) or `SearchIndexResponseShapeError` (2xx but malformed). Caller is `useQuery({ queryKey: qk.searchIndex(), queryFn: getSearchIndex, staleTime: Infinity })` — TanStack Query surfaces both as `isError`.

### `qk.searchIndex()` and `qk.prefixes.searchIndex` (client)

**Boundary:** TanStack Query key factory.

```ts
searchIndex: () => ["search-index"] as const,
// in prefixes:
searchIndex: ["search-index"] as const,
```

Used by:
- `useQuery` call inside the new search panel
- `ws.ts` handler branch on `session-prompts-changed`
- The storybook story's QueryClient wrapper

## Module Boundaries

| Module / Package                                                | Responsibility                                                                                | Allowed Dependencies                                                                |
|-----------------------------------------------------------------|-----------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------|
| `server/store/store.ts` (extended)                              | Owns `Store.prompts`; exposes `buildSearchSnapshot(): SearchIndexResponse`                    | `shared/types.ts`, `shared/search-index-contract.ts`                                |
| `server/routes/search.ts` (NEW)                                 | HTTP route handler — read-only, no body validation, delegates to Store                        | `server/store/store.ts`, `shared/search-index-contract.ts`, `fastify`              |
| `server/ingest/pipeline.ts` (extended)                          | After `applyRecords`, emit `session-prompts-changed` if prompts were appended                  | `shared/ws-protocol.ts` (existing import)                                            |
| `shared/ws-protocol.ts` (extended)                              | Add `SessionPromptsChanged` to `WsServerMessage` union                                        | (no deps)                                                                           |
| `shared/search-index-contract.ts` (NEW)                          | Wire types: `PromptSearchDoc`, `SearchIndexResponse`                                          | (no deps)                                                                           |
| `client/src/api/search.ts` (NEW)                                | Typed fetcher + response-shape guard + typed errors                                            | `shared/search-index-contract.ts`                                                   |
| `client/src/api/queryKeys.ts` (extended)                        | `qk.searchIndex()`, `qk.prefixes.searchIndex`                                                  | (no deps)                                                                           |
| `client/src/ws.ts` (extended)                                   | Add `case "session-prompts-changed"` branch                                                   | `client/src/api/queryKeys.ts`, `shared/ws-protocol.ts`                              |
| `client/src/pages/sessions/PromptSearchPanel.tsx` (NEW)         | Replaces `PromptSearchSlot.tsx`; owns input, MiniSearch index, result list, deep-link clicks   | `client/src/api/search.ts`, `client/src/api/queryKeys.ts`, `minisearch`, `wouter`   |
| `client/src/pages/sessions/PromptSearchSlot.tsx` (DELETED)      | Placeholder no longer needed                                                                  | —                                                                                   |

## Change Footprint

### New files / modules

| Path                                                | Purpose                                                                                 | Pattern reference                                  |
|-----------------------------------------------------|-----------------------------------------------------------------------------------------|----------------------------------------------------|
| `shared/search-index-contract.ts`                   | `PromptSearchDoc` + `SearchIndexResponse` types                                         | `shared/sessions-contract.ts`                      |
| `server/routes/search.ts`                           | `GET /api/search-index` handler + `registerSearchRoute(app, store)`                      | `server/routes/cache-lab.ts`                       |
| `server/routes/search.test.ts`                      | Route tests: 200 + empty, 200 + populated, 500 on Store throw                           | `server/routes/cache-lab.test.ts` (if present), else `server/routes/sessions.test.ts` |
| `server/store/build-search-snapshot.ts`             | Pure function `buildSearchSnapshot(state)` returning `SearchIndexResponse`              | `server/cache/analysis.ts` (pure over snapshot)    |
| `server/store/build-search-snapshot.test.ts`        | Unit tests: empty state, single-session, prompt with missing turnNumber resolves to N+1  | n/a                                                |
| `client/src/api/search.ts`                          | `getSearchIndex()` + `SearchIndexApiError` + `SearchIndexResponseShapeError`            | `client/src/api/cacheLab.ts`                       |
| `client/src/api/search.test.ts`                     | Fetcher tests (success + non-2xx + shape-error)                                          | `client/src/api/cacheLab.test.ts` (if present)    |
| `client/src/pages/sessions/PromptSearchPanel.tsx`   | The real search UI: input, results, deep-links                                          | `client/src/pages/sessions/SessionBrowser.tsx` (component shape) |
| `client/src/pages/sessions/PromptSearchPanel.stories.tsx` | Storybook states: empty, results, no-match, loading, error                          | existing `*.stories.tsx` in same dir               |
| `client/src/pages/sessions/PromptSearchPanel.test.tsx` | RTL tests: typing fires search, debounce, deep-link shape, empty state                   | `client/src/pages/sessions/CostDistributionCard.test.tsx` |

### Modified files / modules

| Path                                                  | What changes here                                                                                          |
|-------------------------------------------------------|------------------------------------------------------------------------------------------------------------|
| `server/store/store.ts`                               | Add `buildSearchSnapshot(): SearchIndexResponse` method; delegates to `build-search-snapshot.ts`          |
| `server/app.ts`                                       | Import + call `registerSearchRoute(app, store)` between `registerMetricsRoute` and `registerSessionsRoute` |
| `server/ingest/pipeline.ts`                           | In the per-session debounce that already emits `session-updated`, additionally emit `session-prompts-changed` if `result.prompts.length` is non-empty |
| `shared/ws-protocol.ts`                               | Add `SessionPromptsChanged` interface; append to `WsServerMessage` union                                    |
| `client/src/ws.ts`                                    | Add `case "session-prompts-changed"` → `queryClient.invalidateQueries({ queryKey: qk.prefixes.searchIndex })` |
| `client/src/api/queryKeys.ts`                         | Add `qk.searchIndex()` and `qk.prefixes.searchIndex`                                                       |
| `client/src/api/queryKeys.test.ts`                    | Add a test that confirms the key shape + the prefix matches the literal key                                |
| `client/src/pages/Sessions.tsx`                       | Replace `import { PromptSearchSlot }` with `import { PromptSearchPanel }`; replace `<PromptSearchSlot />` with `<PromptSearchPanel />` |
| `client/src/pages/Sessions.tsx` (URL state)           | Read/write `q` from `URLSearchParams` (consistent with existing `view`, `range`, etc. handling)             |

### Deleted / replaced

| Path                                                  | Reason                                                                                                       |
|-------------------------------------------------------|--------------------------------------------------------------------------------------------------------------|
| `client/src/pages/sessions/PromptSearchSlot.tsx`       | Replaced by `PromptSearchPanel.tsx` — the placeholder's `data-testid="prompt-search-slot"` migrates with the section, so any existing test that selects it keeps working. (No existing test uses this testid — verified.) |
| `client/src/pages/sessions/PromptSearchSlot.tsx` test/story files | None exist — the placeholder has no test/story files to retire                                            |

### Touched but not changed (silent-regression hotspots)

| Path                                                    | Why it matters                                                                                              |
|---------------------------------------------------------|-------------------------------------------------------------------------------------------------------------|
| `server/store/store.ts` `applyRecords` / `recompute`    | The new `buildSearchSnapshot` reads `state.turns` to resolve `turnNumber`. If recompute becomes async, the snapshot must stay synchronous (snapshot-at-read, mirroring `getSessionSnapshot`). |
| `server/ingest/pipeline.ts` debounce timing             | Adding the second WS emit doubles the bus traffic per dirty session. Acceptable (two invalidations land within ms), but if the bus backpressure changes, the prompt message must not be silently dropped. |
| `client/src/ws.ts` `case` exhaustiveness                 | Adding a new union member without a `case` is a TypeScript error (exhaustive switch). Good. But adding the case while forgetting the `queryClient.invalidateQueries` is a silent regression — a test on the WS handler covers this. |
| `client/src/pages/Sessions.tsx` URL parsing             | The existing `useSearch()` parsing already handles `?view=…`, `?range=…`, etc. Adding `?q=…` must follow the same `URLSearchParams` round-trip; a careless `.set('q', q)` would erase other params. |
| `shared/ws-protocol.ts` shape consumers                  | The contract test on `WsServerMessage` (if present in `ws-protocol.test.ts`) must be extended — server and client both compile against this union, so a shape mismatch is caught at build time. |
| `server/store/store.ts` `resetSession`                  | When a transcript is truncated and reparsed, all `prompts` for that session are wiped. The next `session-prompts-changed` will be a normal refetch — but if `session-updated` doesn't fire (defensive), the client could show stale results. The pre-existing `session-updated` covers this; we don't add a parallel "prompts-removed" event because the user-facing behavior (search box refetches when the session changes) is already correct. |

## Areas of Impact

| Area                                       | Impact                                                                                                  | Risk (L/M/H) | Why                                                                                            |
|--------------------------------------------|---------------------------------------------------------------------------------------------------------|--------------|------------------------------------------------------------------------------------------------|
| Server HTTP API                            | Adds one route + one wire type; no breaking changes to existing routes                                  | **L**         | Pure addition. Route returns a new path; existing clients unaffected.                          |
| WS protocol                                | Adds one union member; existing handlers continue working; new branch required for full invalidation    | **M**         | Exhaustive-switch TS guarantees compile-time coverage; runtime requires `ws.ts` test addition. |
| Ingest pipeline                            | One additional WS emit per dirty-session debounce window                                                  | **L**         | No new parser work; piggy-backs on existing debounce; bounded by already-debounced traffic.    |
| Store interface                            | Adds one method; no changes to existing read paths                                                       | **L**         | Pure addition; mirrors `getSessionSnapshot`.                                                    |
| Client query-key factory                   | One key + one prefix                                                                                     | **L**         | Pattern is established and tested.                                                              |
| Client Sessions page composition           | One import swap; no layout changes                                                                       | **L**         | Existing placeholder comment in `Sessions.tsx:62` already anticipates this swap.                |
| Client mini-search dep usage               | First time `minisearch` is imported; new dep of the Vite bundle                                          | **M**         | ~10KB gzipped; bumps `dist/` size but well within npx cold-start budget. Worth measuring.       |
| Session Detail deep-link target            | `?turn=N` already supported (`SessionDetail` reads `?turn=` query); no change                            | **L**         | Verified against existing route patterns.                                                       |
| Other pages                                | None — search panel is mounted only on `/sessions`                                                       | **L**         | The slot is a Sessions-page child only.                                                         |
| Cypress E2E (`#P4-18`)                     | One new cross-page flow already in scope: "prompt search → Session Detail at the matching turn"          | **L**         | Already enumerated in plan; this PR makes it implementable.                                    |

**Contract changes:**
- New HTTP: `GET /api/search-index` → `SearchIndexResponse`.
- New WS: `session-prompts-changed` (one union member).
- New shared type: `PromptSearchDoc`, `SearchIndexResponse` in a new file.
- No deletions; no breaking changes.

**Cross-cutting ripples:**
- None for auth, telemetry, migrations, or build pipeline.
- Build pipeline: `minisearch` joins the client Vite bundle. esbuild `server` bundle unaffected (search library is client-only).
- Tests: route test file added; fetcher test file added; component test file added; WS handler test updated.

## Cross-Cutting Concerns

- **Errors:**
  - **Server:** Route handler wraps `buildSearchSnapshot()` in try/catch and lets the existing top-level `setErrorHandler` in `server/app.ts:164` produce the documented `{ error, cause }` 500 shape. No new error type.
  - **Client:** `getSearchIndex()` distinguishes `SearchIndexApiError` (non-2xx, surfaces network/server outage) from `SearchIndexResponseShapeError` (2xx but malformed, surfaces a "data is broken — restart the app" state). The component's `isError` boundary renders an `EmptyState` with the message; not a fake-loading shimmer.

- **Logging & observability:** No new metrics. The route logs at Fastify's default INFO with route + duration. The WS emit piggybacks on the existing ingest log line (`debounced invalidation`). No PII concerns — prompt text already crosses the wire via the existing `SessionDetail` route, so logging/metrics behavior is unchanged.

- **Auth / authz:** None. Loopback-only, same as every other route. No CORS, no token check — architecture §1 explicitly.

- **Performance:**
  - **Wire:** ~250 B × N prompts. At the §6 "low hundreds of MB" budget (≈40 K–80 K prompts), 10–20 MB JSON gzipped over loopback HTTP. Well under any proxy or browser buffer.
  - **Client build of MiniSearch index:** `MiniSearch({...opts}).addAll(docs)` is O(N) and ~5–10ms for 10K prompts, ~30–50ms for 50K. Done once after the initial fetch; never re-done on invalidation (TanStack Query gives us the same `data` ref, so `useMemo` skips rebuild).
  - **Per-keystroke search:** O(query tokens × N). Default scoring; <50ms per keystroke at 50K prompts.
  - **Debounce:** 100 ms on input — defensive, not load-bearing.

- **Security:**
  - **Prompt text is user content** — it's already in the in-memory store and already crosses the wire via Session Detail's lazy transcript peek. The search index payload does not increase the trust boundary or expand the attack surface.
  - **No new filesystem reads** — `buildSearchSnapshot` reads in-memory state only.
  - **No new IPC** — the WS message contains only `sessionId`, no prompt text.

- **Migrations / rollout:**
  - **Forward compatible:** the new `session-prompts-changed` is a strict superset of the existing WS contract. Old clients ignore unknown message types (per the existing `ws.ts` default-case behavior). Old clients won't search, but they will not break.
  - **No data migration:** nothing on disk changes shape.
  - **No flag/feature toggle:** the `PromptSearchSlot` placeholder is replaced in the same PR — there is no period where the panel could be mounted in an inconsistent state.

## Architecture Decisions Log

| #   | Decision                                                            | Alternatives                                                | Chosen Because                                                                                                                                          | Satisfies REQs |
|-----|---------------------------------------------------------------------|-------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|----------------|
| A1  | Client builds MiniSearch index from raw `PromptSearchDoc[]` payload  | Server builds MiniSearch, ships serialized JSON              | Keeps `minisearch` a client-only dep (CLAUDE.md §2 dep table); avoids version-skew between server-built and client-loaded indexes; one-time index-build is bounded by `prompts.length` which §6 budgets at "low hundreds of MB". | Acceptance criterion (no server RTT per keystroke); §11; IR2 |
| A2  | New WS message type `session-prompts-changed`                        | Reuse `session-updated`; piggyback on `scan-updated`         | `session-updated` over-invalidates metrics/sessions/detail. `scan-updated` triggers on settings changes (irrelevant). One extra union member is honest and cheap. | IR1; §7 (WS is invalidation-only)        |
| A3  | Deep-link shape is `/sessions/:id?turn=N` (existing Session Detail anchor) | Open Turn Inspector at `/session/:id/turn/:n`                | Issue acceptance: "results deep-link to Session Detail at the matching turn." §3 row says Session Detail shows the turn via existing anchor.            | Acceptance criterion (deep-link to Session Detail at the matching turn) |
| A4  | `?q=…` is page-local URL state on `/sessions`, not a global filter   | Add `q` to `useFilters()` global filter bar                  | Spec calls it "full-text search across all sessions" — not a global dimension. Coupling it to `useFilters()` would force every other page to ignore `?q`, defeating URL persistence. | §11 (page-local)                         |
| A5  | Single indexed field (`text`), no project/model weighting             | Multi-field weighted index                                  | Spec only requires prompt-text search. Multi-field invites scope creep and a larger wire payload for no spec'd benefit.                                  | Acceptance criterion (full-text over prompt text) |
| A6  | `PromptSearchSlot.tsx` deleted; `PromptSearchPanel.tsx` created       | Keep both, feature-flag the swap                            | ARCH R8 explicitly reserves the slot as a future-replacement mount. The placeholder has no test/story files to retire. One PR, one swap, no coexistence surface. | IR4; ARCH R8                              |
| A7  | `buildSearchSnapshot` is a pure function in its own file              | Inline the logic inside `Store.buildSearchSnapshot()`        | Mirrors the `server/cache/analysis.ts` pure-function convention; unit-testable without Store setup. The Store method becomes a 1-liner delegate.       | Architecture §3 (pure modules, testable)  |
| A8  | Server emits `session-prompts-changed` iff `result.prompts.length > 0` after applyRecords | Emit unconditionally per dirty session                       | Empty prompts delta is a no-op for the client. Avoiding the extra message keeps the bus sparse (the existing `session-updated` still fires — the prompt-specific message is additive). | IR1                                          |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario                                                                                              | How the Design Handles It                                                                                                                                  |
|--------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Server is briefly unavailable on Sessions page mount** (`/api/search-index` returns 500)             | `useQuery` enters `isError`; component renders `EmptyState` with the API error message. No crash; the rest of the Sessions page still works (the slot is one section). |
| **User types fast while a session-prompts-changed lands**                                              | The 100 ms input debounce + TanStack Query's `staleTime: Infinity` race: if the new fetch resolves before the next keystroke, MiniSearch rebuilds with the new docs; the next keystroke searches the new index. No torn state. |
| **Index grows 10×** (e.g. 10 K → 100 K prompts)                                                        | `MiniSearch.addAll` is O(N); at 100 K it's still sub-second on a modern laptop. If profiling shows otherwise, we move to the deferred Option-1 path (server pre-builds) — but the wire shape is unchanged. |
| **WS reconnect after network blip while user was on `/sessions`**                                      | Existing `ws.ts` reconnect calls `queryClient.invalidateQueries()` (broad) — that covers `qk.searchIndex` by prefix match. On reconnect, the index refetches and rebuilds. |
| **Two concurrent sessions appending prompts**                                                           | Each session's debounce is independent; two `session-prompts-changed` messages may land back-to-back. TanStack Query dedupes (identical key); MiniSearch rebuilds once. |
| **`resetSession` clears prompts after a transcript truncation**                                        | The pre-existing `session-updated` message covers this — the WS handler invalidates `qk.prefixes.session` (and our new prefix). Stale results clear on next refetch. The new `session-prompts-changed` is only fired on appends (A8); truncations ride the existing `session-updated`. |
| **Client receives malformed `SearchIndexResponse`** (e.g. server is a future version with extra fields) | `SearchIndexResponseShapeError` is thrown by the response-shape guard; component renders `EmptyState`. Honest failure, never a crash. |
| **Browser tab is backgrounded for an hour while a live session appends 100 prompts**                    | On focus, TanStack Query's default behavior refetches stale queries. The panel refetches; the index rebuilds once; the user sees fresh results without manual reload. |
| **Server process is restarted** (cache cleared; cold boot)                                              | Existing cold-boot path. The first `GET /api/search-index` rebuilds the snapshot from the freshly-parsed `Store.prompts`. No new code paths. |
| **Index fetch resolves but `MiniSearch` library throws on `addAll`** (pathological input)             | The component catches inside its `useMemo` and renders `EmptyState`. Defense-in-depth, not a primary failure mode. |

### Backward — regression risk per touched area (brownfield only)

| Touched area (from Change Footprint)                                            | What could regress                                                                                                  | How we'd know / mitigation                                                                                                                                            |
|---------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `server/store/store.ts` `applyRecords` / `resetSession`                         | Existing ingestion behavior — adding the new `buildSearchSnapshot` method could mask a regression if the snapshot reads mutated state | Route test asserts snapshot reflects current `state.prompts` and `state.turns` after `applyRecords`.                                                                   |
| `server/ingest/pipeline.ts` WS emit                                             | The existing `session-updated` emit path could be silently re-routed or swallowed                                    | Existing tests on the ingest debounce remain green; new test asserts that BOTH messages fire when prompts are appended.                                                 |
| `shared/ws-protocol.ts` union                                                  | Forgetting the case in `ws.ts` would be a TS error (exhaustive switch)                                                | `npm run typecheck` already enforces it.                                                                                                                                |
| `client/src/pages/Sessions.tsx` URL parsing                                     | Adding `?q=…` parsing could overwrite other params in a careless `URLSearchParams` rebuild                            | Existing tests on `Sessions.tsx` URL round-trip (if present) cover the other params; new test asserts `?q=hello&view=page&range=7d` survives a write.                 |
| `client/src/ws.ts` handler                                                     | New branch could forget to call `invalidateQueries`                                                                  | Component test asserts the search panel refetches after a synthetic WS message.                                                                                        |
| `server/app.ts` route registration order                                        | Forgetting `registerSearchRoute` between routes would mean the route is unreachable                                  | Route test boots the app and asserts `GET /api/search-index` returns 200 — fails fast if the registration is missing.                                                  |
| `client/src/pages/sessions/PromptSearchSlot.tsx` deletion                        | Any consumer outside `Sessions.tsx` that imports it breaks the build                                                  | Verified via grep: only `Sessions.tsx:7` imports it. Deletion is safe.                                                                                                 |

## Open Questions

- **What does "at the matching turn" mean when a single prompt is split across multiple logical turns** (e.g. mid-prompt sub-agent fan-out per `deriveTurns` conventions)?
  - **Impact if unresolved:** the result row's `?turn=N` could land on a different turn than the user expects.
  - **Suggested default:** `turnNumber` resolves to the *parent* (main-thread) turn whose `promptId` matches the prompt's `promptId`. Sub-agents don't have their own prompt lines (per `PromptTextRecord` extraction rules in `parse-transcript.ts`), so this is consistent with the data we already extract.

- **Should the search panel collapse/hide on small viewports?**
  - **Impact if unresolved:** the panel is one section on the Sessions page — sized like the other section cards. It probably shouldn't be the first thing a mobile user sees.
  - **Suggested default:** No collapse for v1. The placeholder is already a full-width section; the real panel matches. A future mobile pass can revisit.

- **Should we ship a server-side relevance snippet (e.g. highlighted match) or just the matched `text`?**
  - **Impact if unresolved:** MiniSearch's `search()` returns the full document, not snippets. The client would have to re-highlight.
  - **Suggested default:** v1 renders the full prompt text in a truncated single line with the query substring visually emphasized via a tiny `.split()` highlight. No server-side snippet work; matches the spec ("Results → 3 at the matching turn" — the result row is metadata, the full turn is on the next page).

## Out of Scope

- **Server-side query (`POST /api/search?q=…`)** — explicitly forbidden by architecture §11 and the acceptance criterion.
- **Multi-field weighted search (project, model, branch)** — not in spec; reserved for a future if/when asked.
- **Pagination of search results** — the in-browser index handles all matches; result list caps at ~50 rows in v1 with a "(showing first 50 of N)" footer.
- **Search across assistant messages** — spec says "prompt text" only; assistant text is not indexed.
- **Search across tool_result bytes** — never stored (architecture §5.4).
- **Saved searches / search history** — separate enhancement, not part of #P4-3.
- **Server-side index serialization (Option 1)** — deferred; revisit only if client-side build becomes a bottleneck.

---

# Tasks

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-p4-3-search-index.md`_