# Architecture: React shell — routing, query layer, WS invalidation client (#P3-2)

> **Date:** 2026-07-14
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Plan task #P3-2 — `specs/claude-lens-plan.md` (Phase 3); authoritative specs `specs/claude-lens-architecture.md` §7 (WS invalidation bus), §11 (frontend architecture); `specs/claude-lens-pages.md` (the 11-page map). Issue #29 / `specs/issues/P3-2-react-shell.md`.
> **Type:** feature (greenfield client, constrained by existing server/shared contracts)

## Architecture Summary

This task stands up the React SPA skeleton every later page plugs into. `client/src/` today is bare Vite/Storybook scaffolding; this adds the React root (`main.tsx`), a wouter `<Switch>` over **11 page stubs** with minimal layout chrome (`App.tsx` + `layout/AppShell.tsx`), the TanStack Query layer (`QueryClientProvider` + a lean **query-key factory**, `api/`), and the hand-rolled **reconnecting WebSocket client** (`ws.ts`) that translates the three server→client invalidation messages into `queryClient.invalidateQueries` calls **by key prefix**. No page renders real data beyond a smoke query; charts (P3-4), the global filter bar (P3-3), and shared primitives (P4-1) are explicitly out of scope. The whole design leans on contracts that already exist — `shared/ws-protocol.ts` (3 message types), `shared/metrics-contract.ts` (`MetricsQuery`/`Series`), `POST /api/metrics`, and the Vite dev proxy to `127.0.0.1:4128` — inventing no new server surface.

## Inferred Requirements

_No REQ doc — this is a plan task whose requirements are the authoritative specs. Traced to spec sections rather than REQ-IDs._

| ID  | Requirement | Source |
|-----|-------------|--------|
| S1  | wouter routes exist for all 11 pages; client-side navigation works with SPA history-mode | pages §"Page map"; architecture §11 (wouter, history mode) |
| S2  | Every remote read goes through TanStack Query with keys from **one** factory; identical `MetricsQuery`s dedupe | architecture §11 (Data) |
| S3  | WS client is a native `WebSocket` with **hand-rolled** reconnect/backoff (no library) | architecture §11, §7 |
| S4  | On a WS message the client invalidates **by key prefix**; only **mounted** queries refetch; WS never carries data | architecture §7, §11 |
| S5  | Reconnect after a server restart recovers the live stream (and catches anything missed while disconnected) | architecture §7 (`ws.ts` reconnect); resolves P3-1 ARCH Open Question (no reconnect-replay) |

## High-Level Structure

Greenfield client tree under `client/src/`. One WS connection lives module-level and pushes invalidations into the single `QueryClient`; pages are pure consumers of that client.

```
                         main.tsx (client composition root)
                                 │
                    createQueryClient()      connectWs(queryClient)
                                 │                    │  native WebSocket → /ws
                                 ▼                    │  (Vite proxies to :4128 in dev)
        ┌───────────────────────────────────┐        │
        │ <QueryClientProvider client=…>     │        │  onmessage(WsServerMessage):
        │   <App/>  ── wouter <Switch>       │        │   scan-updated   → invalidate ALL
        │     11 <Route> → page stubs        │        │   session-added  → invalidate ["metrics"]
        │     <AppShell> nav chrome          │        │   session-updated→ invalidate ["metrics"],
        │                                    │        │                    ["session", id]
        └───────────────┬───────────────────┘        │  onopen (re)connect → invalidate ALL
                        │ useQuery(qk.metrics(q))     │  onclose/onerror → backoff → reconnect
                        ▼                             │
                 POST /api/metrics ──► Series[]       │
                        ▲                             │
                        └─── refetch (only mounted matching keys) ◄──┘
```

**Added (all new):** `main.tsx`, `App.tsx`, `layout/AppShell.tsx`, `pages/*` (11 stubs + an index/registry), `api/queryClient.ts`, `api/queryKeys.ts`, `api/metrics.ts`, `ws.ts` (+ its unit test), `routes.ts` (route↔page table).
**Modified:** `client/index.html` (mount point + `main.tsx` script), possibly `client/tsconfig.json` (only if a path/lib tweak is needed — default is no change).
**Replaced / deleted:** none load-bearing — `src/placeholder.ts` may be removed if nothing imports it; `src/example/*` stays (Storybook fixture).

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| Router | `wouter` (history mode), `<Switch>`/`<Route>`/`<Link>` | react-router; TanStack Router | Pinned by architecture §2/§11; smallest footprint; we own the server so SPA fallback (`app.ts` `setNotFoundHandler` → `index.html`) is already in place |
| Data/cache | `@tanstack/react-query` v5, one `QueryClient`, keys from one factory | SWR; bespoke fetch+state | Pinned §2/§11; gives mounted-only refetch and key-prefix invalidation for free (satisfies S4) |
| Key hashing | TanStack **default** `hashKey` (deterministic, sorts object keys); key = `["metrics", query]` | Custom stable JSON serializer of the full query | Default hash already canonicalizes object-key order, so identical `MetricsQuery`s dedupe (S2) with zero extra code. Caveat: **array** order is significant (`measures:["a","b"]`≠`["b","a"]`) — callers pass canonical order; documented in the factory |
| Key factory scope | **Lean** — implement only `qk.metrics` (the sole live endpoint) + the WS→prefix router; document forward-looking `session`/`sessions` prefixes without creating unused keys | Full namespace (metrics/sessions/session/search/health) now | CLAUDE.md: "don't scaffold V2 pieces outside their plan tasks." Endpoints for the other keys don't exist yet; the invalidation router still references future prefixes harmlessly (nothing mounted matches) |
| WS client | Native `WebSocket`, hand-rolled reconnect + exponential backoff (cap + jitter) | `reconnecting-websocket`, socket.io | §11 mandates no library; the protocol is 3 message types — a library is overkill and would add a dep the spec forbids |
| Invalidation model | **Prefix map** per message type (see §API); TanStack refetches only active queries by default | Invalidate-all on every message | §7/§11 say "invalidate by key prefix"; prefix map preserves per-session precision. Mounted-only refetch is TanStack's default, satisfying the "only mounted queries refetch" criterion |
| WS URL | Derive from `window.location`: `` `${proto}//${host}/ws` `` (`proto` = `wss:`/`ws:`) | Hardcode `ws://127.0.0.1:4128/ws` | Works unchanged in dev (Vite proxies `/ws`) and prod (same-origin Fastify); no client base-URL config |
| Styling | Tailwind v4 (already wired via `@tailwindcss/vite`); chrome kept minimal | Build real nav styling now | Shared primitives + polished chrome are P4-1; over-styling here duplicates that work |

## Patterns & Conventions

- **One key factory, no ad-hoc keys** (§11) — every `useQuery` key comes from `api/queryKeys.ts`; the WS router imports the same module so prefixes can never drift from the keys they target.
- **WS carries no data** (§7) — `ws.ts` reads only `message.type` (+ `sessionId`); it never puts payload data into the cache. Refetch goes through the normal HTTP query API.
- **Composition root owns wiring** — `main.tsx` is the only place that constructs the `QueryClient` and opens the socket; pages receive both via context and hooks, mirroring the server's `cli.ts`-owns-lifecycle convention.
- **File-per-concern** (matches `server/` style) — `queryClient`, `queryKeys`, `metrics` fetch helper, and `ws` are separate small modules rather than one `api.ts`.
- **Three strict-TS roots** (architecture §3) — `client/` imports `shared/` types only (e.g. `WsServerMessage`, `MetricsQuery`, `Series`); it never imports from `server/`.
- **Deliberately-not-applied:** no global filter/URL-state wiring (P3-3), no chart component (P3-4), no data-table/stat-card primitives (P4-1), no MiniSearch/search index (P4-3). Page stubs are placeholders, not layouts.

## Data Models

No persistent or domain entities. New runtime state is entirely client-side and ephemeral:

- **`QueryClient` cache** — keyed by the factory's arrays; entries are `Series[]` responses from `/api/metrics`. Lifecycle: created on mount, invalidated by WS messages, GC'd by TanStack defaults.
- **WS connection state** (module-local in `ws.ts`) — the current `WebSocket`, a reconnect-attempt counter (for backoff), and a "closed by app" flag so an intentional teardown doesn't trigger reconnect. Not React state.
- Wire message shapes are **consumed unchanged** from `shared/ws-protocol.ts`: `SessionUpdated | SessionAdded | ScanUpdated`.

## API Contracts / Interfaces

### Query-key factory — `client/src/api/queryKeys.ts` (new)

**Boundary:** internal client module; single source of truth for cache keys and invalidation prefixes.

| Op | Signature | Purpose | Notes |
|---|---|---|---|
| `qk.metrics` | `(query: MetricsQuery) => ["metrics", MetricsQuery]` | Cache key for a `POST /api/metrics` read | Default `hashKey` dedupes identical queries; array order significant |
| `qk.prefixes.all` | `readonly []` (conceptual) | The everything-prefix used on `scan-updated` and on (re)connect | Implemented as `invalidateQueries()` with no `queryKey` |
| `qk.prefixes.metrics` | `["metrics"]` | Prefix hit by `session-added`/`session-updated` | All metrics aggregate over sessions |
| `qk.prefixes.session` | `(id: string) => ["session", id]` | Forward-looking prefix for the future session-detail endpoint (P4-5); harmless now (nothing matches) | Documented, not backed by a live query yet |

### WS invalidation router — `client/src/ws.ts` (new)

**Boundary:** internal client module; the only WebSocket owner. Depends on `shared/ws-protocol` (type) + the `QueryClient` + the key factory.

| Op | Signature | Purpose | Errors / Behavior |
|---|---|---|---|
| `connectWs` | `(queryClient: QueryClient) => () => void` | Open the socket, wire handlers, return a disposer that closes without reconnecting | Never throws to callers; malformed frames are ignored |
| _(internal)_ `handleMessage` | `(msg: WsServerMessage) => void` | Map message type → invalidation | `scan-updated`→`invalidateQueries()`; `session-added`→`invalidateQueries({queryKey:["metrics"]})`; `session-updated`→ same **plus** `{queryKey:["session",sessionId]}` |
| _(internal)_ `scheduleReconnect` | `() => void` | Exponential backoff (base ~500ms, cap ~10s, ±jitter) on `close`/`error`; on `open` reset the counter and `invalidateQueries()` once | Skips reconnect if disposed |

**Message → prefix table (S4):**

| Message | Invalidated prefix | Why |
|---|---|---|
| `scan-updated` | _all_ (`invalidateQueries()`) | Roots/settings changed globally — any query may be stale |
| `session-added` | `["metrics"]` | A new session shifts every aggregate |
| `session-updated` | `["metrics"]` + `["session", sessionId]` | Aggregates shift; the session's own (future) detail is stale |
| _(re)connect_ `onopen` | _all_ | Catch anything missed while disconnected (reconnect-replay via refetch, §7) |

### Metrics fetch helper — `client/src/api/metrics.ts` (new)

**Boundary:** internal; the one caller of `POST /api/metrics`.

| Op | Signature | Purpose | Errors |
|---|---|---|---|
| `postMetrics` | `(query: MetricsQuery) => Promise<Series[]>` | `fetch('/api/metrics', {method:'POST', json})`; parse `Series[]` | Throws on non-2xx (surfaced by TanStack `isError`); 400 body `{error}` bubbled in the thrown message |

### Route table — `client/src/routes.ts` (new)

**Boundary:** internal; the single list `App.tsx` and `AppShell.tsx` both read (nav + `<Switch>` stay in sync).

`Route = { path: string; label: string; component: React.ComponentType }` for the 11 pages (`/` Dashboard, `/sessions`, `/sessions/:id` Session Detail, `/turns/:id` Turn Inspector, `/projects`, `/models`, `/cache`, `/trends`, `/health`, `/settings`, `/explore`) — exact paths finalized against `pages.md` during implementation; a `NotFound` fallback route closes the switch.

**Auth requirements:** none — local-first app; the only guard (loopback origin on `/ws`) lives server-side in `app.ts` and is unchanged.

## Module Boundaries

| Module | Responsibility | Allowed Dependencies |
|---|---|---|
| `client/src/main.tsx` | Construct `QueryClient`, mount React, call `connectWs` | `react-dom`, `api/queryClient`, `ws`, `App` |
| `client/src/App.tsx` | wouter `<Switch>` from `routes.ts`; render `AppShell` | `wouter`, `routes`, `layout/AppShell` |
| `client/src/layout/AppShell.tsx` | Minimal nav chrome (Links from `routes.ts`) + `children` outlet | `wouter`, `routes` |
| `client/src/routes.ts` | The 11-route table (path/label/component) | `pages/*` |
| `client/src/pages/*` | One stub component per page (name + TODO; maybe one smoke `useQuery`) | `wouter` (params), `api/*` (only where a smoke query is shown) |
| `client/src/api/queryKeys.ts` | Key factory + invalidation prefixes | `shared/metrics-contract` (type) |
| `client/src/api/queryClient.ts` | `createQueryClient()` with sane defaults | `@tanstack/react-query` |
| `client/src/api/metrics.ts` | `postMetrics` fetch helper | `shared/metrics-contract` (type) |
| `client/src/ws.ts` | Own the WebSocket; reconnect/backoff; message→prefix invalidation | `shared/ws-protocol` (type), `@tanstack/react-query` (type), `api/queryKeys` |

Rule: `client/` imports from `shared/` and npm only — **never** from `server/` (architecture §3).

## Change Footprint

Greenfield client: the walk is mostly new files plus forward-looking impacts.

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `client/src/main.tsx` | React root; `QueryClientProvider`; open WS | standard Vite React entry; `server/cli.ts` "composition root owns lifecycle" |
| `client/src/App.tsx` | wouter `<Switch>` + `AppShell` | wouter docs; `routes.ts` as source of truth |
| `client/src/routes.ts` | 11-route table (path/label/component) | — (new convention) |
| `client/src/layout/AppShell.tsx` | Minimal sidebar nav + outlet | intentionally pre-primitives (P4-1) |
| `client/src/pages/*.tsx` (11) | Page stubs | `pages.md` page map; stubs only |
| `client/src/api/queryClient.ts` | `createQueryClient()` | TanStack v5 defaults |
| `client/src/api/queryKeys.ts` | Key factory + prefixes | §11 "keys from one factory" |
| `client/src/api/metrics.ts` | `postMetrics` fetch helper | `server/routes/metrics.ts` contract (request/response) |
| `client/src/ws.ts` | Reconnecting WS invalidation client | §7/§11; `broadcaster.ts` is its server counterpart |
| `client/src/ws.test.ts` | Unit: message→prefix mapping, backoff schedule, reconnect-on-close, invalidate-on-open, disposer suppresses reconnect | vitest; fake `WebSocket` + spy `QueryClient` (mirrors `broadcaster.test.ts` fake-socket style) |

### Modified files / modules

| Path | What changes here |
|---|---|
| `client/index.html` | Add `<div id="root">` + `<script type="module" src="/src/main.tsx">` (currently a scaffold placeholder) |
| `client/tsconfig.json` | Only if a `lib`/`jsx`/`paths` tweak proves necessary; default expectation is **no change** |

### Deleted / replaced

| Path | Reason |
|---|---|
| `client/src/placeholder.ts` | Scaffold stub; remove **only** if nothing imports it (verify first) |

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| `client/vite.config.ts` | The `/api` + `/ws` proxy to `:4128` is what makes same-origin WS/fetch work in dev; `ws.ts`'s origin-relative URL depends on it — no edit, but load-bearing |
| `server/app.ts` `/ws` + loopback-origin guard | `ws.ts` connects same-origin, so the guard admits it; a future origin-guard tightening could silently drop the client |
| `shared/ws-protocol.ts` | `ws.ts` narrows on exactly these 3 `type`s; adding a 4th server message would be silently ignored until handled here |
| `shared/metrics-contract.ts` | `qk.metrics` and `postMetrics` are typed against `MetricsQuery`/`Series`; a contract change ripples into the key hash and the fetch helper |
| `server/routes/metrics.ts` | The shape `postMetrics` posts/parses must match this route's `parseMetricsQuery` + `Series[]` response |

## Areas of Impact

| Area | Impact | Risk | Why |
|---|---|---|---|
| `client/` app bootstrap | First real SPA entry; everything downstream mounts inside it | **M** | Greenfield; nothing depends on it yet, but every P3-3/P3-4/P4 task builds on these seams — getting the key factory / WS contract wrong is expensive to unwind later |
| Query-key factory shape | Later pages key all reads through it; invalidation precision derives from it | **M** | Design-defining. Array-order-significance and the prefix scheme must be right; changing key shape later invalidates the whole cache convention |
| `ws.ts` reconnect/backoff | Live-update UX; server-restart recovery | **L** | Isolated module, unit-tested with a fake socket; worst case is a slower reconnect, not data corruption (bus carries no data) |
| Page stubs / routing | Nav surface for the whole app | **L** | Trivial placeholders; paths reconciled against `pages.md` |
| Downstream P3-3 (filters) | Consumes `qk.metrics(query)` with filter-bearing queries | **L** | Contract (query→key) is exactly what P3-3 needs; agreed dependency |
| Downstream P3-4 (charts) | Mounts real `useQuery`s that these invalidations refetch | **L** | Depends only on the query layer this establishes |

**Contract changes:** None to any server/shared contract. New **client-internal** contracts introduced: the `qk` key factory shape and `connectWs` signature — consumers are all future client code (P3-3, P3-4, P4-*), none exist yet.

**Cross-cutting ripples:** No server change, no auth change (loopback guard untouched), no migrations, no feature flags. Build: `main.tsx` becomes Vite's real entry (the `scripts/build.ts` client build starts producing a non-trivial bundle). CI gate `npm run verify` (typecheck→lint→format→test) now type-checks `client/tsconfig.json` against real code; the new `ws.test.ts` runs under vitest.

## Cross-Cutting Concerns

- **Errors:** `postMetrics` throws on non-2xx → TanStack surfaces via `isError`/`error` (pages show a placeholder error state; rich error UI is later). `ws.ts` never throws to the app: malformed frames are ignored, socket errors route into the backoff/reconnect path.
- **Logging & metrics:** Minimal `console.warn` on WS disconnect/reconnect and on an unrecognized message `type`; no client metrics infra (not in scope). Guard log volume so a flapping socket doesn't spam.
- **Auth / authz:** None client-side. The `/ws` loopback-origin allowlist (`server/app.ts`) is the only boundary and is unchanged; same-origin connection passes it.
- **Performance:** WS invalidations only refetch **mounted** queries (TanStack default) — a background session updating while you're on Settings costs nothing (§7). Reconnect uses capped backoff to avoid a tight reconnect loop against a down server. `invalidateQueries()`-all fires only on `scan-updated` and on (re)connect, both infrequent.
- **Security:** Client puts **no** WS payload into the cache (bus carries no data), so even a spoofed frame can at worst trigger a refetch of already-authorized same-origin data. No secrets in the client. Fetch is same-origin only.
- **Migrations / rollout:** None. Purely additive to a client that currently renders nothing. Backward-compatible with the server (message + metrics contracts consumed as-is).

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies |
|---|---|---|---|---|
| A1 | Single key factory `api/queryKeys.ts`; WS router imports the same prefixes | Ad-hoc keys per page; duplicate prefix constants in `ws.ts` | Keys and their invalidation prefixes can't drift; §11 mandates one factory | S2, S4 |
| A2 | Use TanStack default `hashKey`; key = `["metrics", query]`, no custom serializer | Custom stable-JSON serialization of the full query | Default hash already sorts object keys → identical queries dedupe with zero code; array-order caveat documented | S2 |
| A3 | **Lean** factory — only `qk.metrics` live; other prefixes forward-looking | Full namespace now | CLAUDE.md "don't scaffold V2 pieces outside their plan tasks"; those endpoints don't exist | S2 |
| A4 | **Prefix map** invalidation, not invalidate-all-per-message | Invalidate-all on every message | Preserves per-session precision (§7 "by key prefix"); mounted-only refetch is free | S4 |
| A5 | Native `WebSocket` + hand-rolled capped-backoff reconnect | `reconnecting-websocket`/socket.io | §11 forbids a WS library; 3-type protocol needs no framework | S3, S5 |
| A6 | On every (re)connect, `invalidateQueries()` once | Track missed messages / server replay buffer | Cheapest correct recovery; resolves P3-1's "no reconnect-replay" open question via refetch | S5 |
| A7 | Origin-relative WS URL from `window.location` | Hardcode `ws://127.0.0.1:4128/ws` | Same code works dev (Vite proxy) and prod (same-origin Fastify) | S3 |
| A8 | `routes.ts` single table feeds both `<Switch>` and nav | Duplicate route lists in `App` and `AppShell` | Nav and router can't fall out of sync | S1 |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| Server restarts (socket drops) | `onclose` → capped exponential backoff → reconnect; `onopen` fires `invalidateQueries()`-all so the UI catches up on anything missed (the acceptance-criteria case) |
| Server stays down for 30s | Backoff caps (~10s) instead of hammering; retries until it returns; no tight loop, no thrown errors |
| Malformed / unknown WS frame | `JSON.parse` in try/catch; unknown `type` → `console.warn` and ignore (never touches the cache) |
| Two pages mount the same `MetricsQuery` | Default `hashKey` produces the same key → TanStack dedupes to one in-flight request (S2) |
| WS message arrives while only unrelated pages are mounted | `invalidateQueries` refetches only **active** matching keys → nothing refetches; background work is free (§7) |
| Burst of `session-updated` in a debounce window | Server already collapses to one message (`invalidation.ts`); even if several arrive, they invalidate the same prefixes — TanStack coalesces refetches |
| App unmount / intentional teardown | `connectWs` disposer sets the "closed by app" flag and closes; `onclose` sees the flag and does **not** reconnect (no zombie socket) |
| `/api/metrics` returns 400 (bad query) | `postMetrics` throws with the `{error}` body → page renders TanStack error state; no crash |

### Backward — regression risk per touched area

_Client is greenfield, so most footprint entries have no existing behavior to regress. The real risks are the contract seams:_

| Touched area | What could regress | How we'd know / mitigation |
|---|---|---|
| `client/vite.config.ts` proxy (unchanged) | If the origin-relative WS URL is built wrong, dev connects to the Vite port without proxying → handshake fails | `ws.test.ts` asserts URL derivation; manual dev-run in the acceptance check connects live |
| `shared/ws-protocol.ts` narrowing | A future 4th message type silently ignored | Exhaustive `switch` on `type` with a `default` warn; TS `never` check in the default arm flags an unhandled variant at compile time |
| `shared/metrics-contract.ts` typing | Contract drift breaks `postMetrics`/`qk.metrics` silently at runtime | Both are typed against the shared types → `npm run typecheck` fails on drift |
| `server/app.ts` loopback-origin guard | Guard tightening could drop the same-origin client | Same-origin connection is within the allowlist today; noted as a hotspot for future auth work |

## Open Questions

- **Exact route paths for Session Detail / Turn Inspector params.** `pages.md` fixes the page set but not final URL shapes.
  - **Impact if unresolved:** minor — stubs can use provisional paths (`/sessions/:id`, `/turns/:id`).
  - **Suggested default:** adopt the provisional paths above; reconcile against `pages.md`/P4-4/P4-5 when those pages are built. Route table centralizes the change to one file.
- **Backoff constants (base/cap/jitter).** Not spec-pinned.
  - **Impact if unresolved:** cosmetic reconnect latency only.
  - **Suggested default:** base 500ms, ×2, cap 10s, ±20% jitter; tune later if it feels sluggish.
- **Should the smoke `useQuery` live in a page stub or be omitted?** The acceptance criteria ("only mounted queries refetch") is easiest to demonstrate with at least one real mounted query.
  - **Impact if unresolved:** none structural.
  - **Suggested default:** one minimal `useQuery(qk.metrics(...))` on Dashboard to make the invalidation path demonstrable; remove/replace when P3-4 lands the real chart.

## Out of Scope

- Global filter bar + URL query-string filter state (reason: **#P3-3**, depends on this task).
- Any chart rendering / ECharts wrapper (reason: **#P3-4**).
- Shared UI primitives — stat-card, data-table, chip, tier badge, empty state, locked card (reason: **#P4-1**); chrome here stays minimal.
- Search index / MiniSearch (reason: **#P4-3**), export (**#P4-17**), `/api/health` surfacing (**#P4-14**), settings persistence (**#P4-15**).
- New WS message types or any inbound WS protocol (reason: §7 fixes the bus at 3 server→client types).

---

# Tasks

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-react-shell.md`_
