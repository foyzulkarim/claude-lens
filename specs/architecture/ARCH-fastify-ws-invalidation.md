# Architecture: Fastify assembly + WS invalidation bus (#P3-1)

> **Date:** 2026-07-14
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Plan task #P3-1 — `specs/claude-lens-plan.md` (Phase 3); authoritative specs `specs/claude-lens-architecture.md` §5 (ingest), §7 (WS protocol), §9 (route ownership)
> **Type:** feature (brownfield wiring)

## Architecture Summary

This task closes the last open seam of the ingest→transport pipeline: the live path from a changed transcript file to a WS `session-updated` message in a connected browser. All three stages already exist and are individually tested — `startIngest()` produces debounced `WsServerMessage`s via an `onInvalidate` callback (`ingest/pipeline.ts`), `/ws` accepts loopback-origin connections (`app.ts`), and `invalidation.ts` guarantees per-session debounce. What's missing is the **fan-out seam** between the single `onInvalidate` callback and the *set* of connected sockets. We introduce a small framework-agnostic **Broadcaster** (`server/ws/broadcaster.ts`) created before either side, injected into both: ingest sends into it, the `/ws` handler registers/unregisters sockets in it. `cli.ts` is rewired from its placeholder bare `Store` to a real `startIngest()`, making `node cli.js` genuinely live, with a SIGINT/SIGTERM handler that tears ingest down cleanly. The WS remains an invalidation bus only — three message types, never data (§7).

## High-Level Structure

The seam breaks a construction-order cycle: ingest binds `onInvalidate` at `Store` construction (inside `startIngest`), which runs *before* `buildApp` and therefore before any socket exists. The Broadcaster is the shared object both sides hold, so neither depends on the other's lifetime.

```
                         cli.ts (composition root)
                                 │
              resolveScanConfig({ roots })   createBroadcaster()
                                 │                    │
                                 ▼                    │
   ┌─────────────────────────────────────────┐       │
   │ startIngest(config, { onInvalidate })    │       │
   │   discovery → poller → tailer → parser   │       │
   │   → Store → invalidation (debounce §5.5) │       │
   │        onInvalidate = broadcaster.broadcast ◄─────┤
   └───────────────┬──────────────────────────┘       │
                   │ ingest.store                      │
                   ▼                                    ▼
        ┌─────────────────────────────────────────────────────┐
        │ buildApp({ store, broadcaster })                     │
        │   /api/metrics (reads store)                         │
        │   /ws  ── on open:  broadcaster.add(socket)          │
        │        ── on close: broadcaster.remove(socket)       │
        │   static SPA + index.html fallback                   │
        └─────────────────────────────────────────────────────┘
                   │
                   ▼
   broadcast(msg): JSON.stringify once → send to every OPEN socket
                   ▼
              browser ws.ts → invalidateQueries (refetch, never data)
```

**Added:** `server/ws/broadcaster.ts` (+ test), `server/app.test.ts` (acceptance).
**Modified:** `app.ts` (accept `broadcaster`, wire `/ws` add/remove, drop `sendInvalidation`), `cli.ts` (bare Store → `startIngest`, signal handler).
**Replaced:** the bare-`Store` placeholder in `cli.ts`; `sendInvalidation` (absorbed into the Broadcaster).

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|---|---|---|---|
| Fan-out registry | Explicit `createBroadcaster()` object injected into both ingest and app | (a) reuse `@fastify/websocket`'s `app.websocketServer.clients`; (b) `buildApp` owns `startIngest` internally; (c) mutable `setInvalidationSink` late-binding | (a) recreates the cycle — ingest's callback would need the `app` reference that doesn't exist at `onInvalidate`-bind time, and broadcasts to *all* ws routes not just `/ws`; (b) couples app assembly to ingest lifecycle and strips `cli.ts` of the `whenSettled`/`stop` handles it needs; (c) order-dependent and easy to misuse. An explicit seam matches the codebase's file-per-concern style (`invalidation.ts`, `poller.ts`, `tailer.ts`) and is unit-testable with a fake socket. |
| Broadcaster socket type | Structural `{ send, readyState }` interface (`WebSocket`-shaped), no Fastify import | Depend on `ws.WebSocket` type directly | Framework-agnostic mirror of the existing `OutboundSocket` interface in `app.ts`; keeps the module free of transport deps and trivially fake-able in tests. |
| Serialization | `JSON.stringify(message)` once per broadcast, reused across sockets | stringify per socket | Cheap win; message is identical for all clients (invalidation bus, no per-client data). |
| Config resolution | Reuse existing `resolveScanConfig({ roots })` from `discovery.ts` | Build `ScanConfig` inline in `cli.ts` | Already the canonical builder (used by `benchmark.ts`); defaults roots to `~/.claude/projects`, `claudeDir` to `~/.claude`. |
| Shutdown | SIGINT/SIGTERM → `ingest.stop()` → `app.close()` | Rely on process exit | Ingest now holds real fast/slow timers and open file handles (poller/tailer); a bare Ctrl-C would leak them. `stop()` is already a hard boundary in `pipeline.ts`. |

## Patterns & Conventions

- **Explicit seam over implicit coupling** — the Broadcaster is a named object passed by the composition root, same as `startIngest(config, options)` and `buildApp({ store })` already do. From CLAUDE.md architecture §3: three strict-TS roots; `server/` may not leak transport types into ingest.
- **Callback must never throw** — `broadcast()` runs inside `invalidation.ts`'s `setTimeout`/`safeOnFlush`. Per-socket send errors are swallowed (matching the poller/tailer/invalidation "consumer callback error must not escape" convention) so one dead socket can neither abort the fan-out to healthy sockets nor crash the process.
- **WS carries no data (§7)** — only the three `WsServerMessage` types cross the wire; the client refetches through the HTTP query API. This task adds no new message types and no inbound protocol.
- **Composition root owns lifecycle** — `cli.ts` is the only place that constructs ingest + broadcaster + app and owns teardown; `buildApp` stays a pure assembler taking its dependencies as arguments.

## Data Models

No new persistent or domain entities. The only new runtime state is the Broadcaster's in-memory socket set (see interface below). Message shapes are unchanged — `SessionUpdated | SessionAdded | ScanUpdated` in `shared/ws-protocol.ts`.

## API Contracts / Interfaces

### Broadcaster — `server/ws/broadcaster.ts` (new)

**Boundary:** internal module (server-only). No Fastify/ws import.

| Op | Signature | Purpose | Returns / Errors |
|---|---|---|---|
| `createBroadcaster` | `() => Broadcaster` | Factory; owns the live socket set | — |
| `add` | `(socket: WsSocket) => void` | Register a connected `/ws` socket | — |
| `remove` | `(socket: WsSocket) => void` | Deregister on close/error | — |
| `broadcast` | `(message: WsServerMessage) => void` | Serialize once, send to every OPEN socket; swallow per-socket errors; never throws | — |
| `size` | `() => number` | Connected-socket count (for tests/health) | number |

`WsSocket` = structural `{ send(data: string): void; readyState: number }`; `OPEN` compared against the standard `1`. `broadcast` is passed directly as ingest's `onInvalidate` (`broadcaster.broadcast`).

### `buildApp` — `server/app.ts` (modified)

**Boundary:** HTTP/WS assembler.

| Op | Signature | Change |
|---|---|---|
| `buildApp` | `({ store, broadcaster }: BuildAppOptions) => FastifyInstance` | Add `broadcaster` to `BuildAppOptions`; `/ws` handler calls `broadcaster.add(socket)` on connect and `broadcaster.remove(socket)` on `socket.on("close")` (and error). Remove the now-redundant exported `sendInvalidation`. |

`/ws` behavior otherwise unchanged: loopback-origin `preValidation` guard stays; inbound messages remain a no-op (invalidation bus is server→client only).

### `/ws` (HTTP surface, §9)

Unchanged contract: `GET /ws` upgrade, server→client only, three message types. No auth beyond the existing loopback-origin allowlist.

## Module Boundaries

| Module | Responsibility | Allowed Dependencies |
|---|---|---|
| `server/ws/broadcaster.ts` | Own the connected-socket set; fan out one message to all OPEN sockets, error-isolated | `shared/ws-protocol` (type only) |
| `server/app.ts` | Assemble Fastify: static/SPA, `/api/*`, `/ws` upgrade; register sockets into the injected broadcaster | `@fastify/*`, `shared/ws-protocol`, `routes/`, `store/` (type), `ws/broadcaster` |
| `server/cli.ts` | Composition root: resolve config, start ingest, build app, listen, handle shutdown | `ingest/pipeline`, `ingest/discovery`, `ws/broadcaster`, `app`, `store` |
| `server/ingest/pipeline.ts` | Unchanged — produces `WsServerMessage`s via `onInvalidate` | (unchanged) |

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|---|---|---|
| `server/ws/broadcaster.ts` | The fan-out seam: socket set + `broadcast()` | `OutboundSocket`/`sendInvalidation` in `app.ts`; module style of `invalidation.ts` |
| `server/ws/broadcaster.test.ts` | Unit: add/remove, broadcast to N sockets, skip non-OPEN, swallow send throw, `size` | `invalidation.test.ts` (fake-socket / callback-isolation style) |
| `server/app.test.ts` | **Acceptance:** append to a watched fixture `.jsonl` → exactly one debounced `session-updated` over a real WS client | `pipeline.test.ts` (temp-dir + `whenSettled`), `poller.test.ts` (short intervals) |

### Modified files / modules

| Path | What changes here |
|---|---|
| `server/app.ts` | Add `broadcaster: Broadcaster` to `BuildAppOptions`; `/ws` handler `broadcaster.add(socket)` on open, `broadcaster.remove(socket)` on close/error; delete exported `sendInvalidation` + `OutboundSocket` (absorbed into broadcaster) |
| `server/cli.ts` | Replace bare `new Store({ onInvalidate: () => {} })` with `resolveScanConfig({ roots })` → `createBroadcaster()` → `startIngest(config, { onInvalidate: broadcaster.broadcast })` → `buildApp({ store: ingest.store, broadcaster })`; add SIGINT/SIGTERM → `ingest.stop()` + `app.close()` |

### Deleted / replaced

| Path | Reason |
|---|---|
| `server/app.ts` — `sendInvalidation` + `OutboundSocket` | Superseded by `broadcaster.broadcast`; the per-socket primitive folds into the multi-socket one |
| `server/cli.ts` — bare-`Store` placeholder + its `--roots`-is-parsed-but-unused gap | Replaced by the real ingest pipeline this task wires |

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|---|---|
| `server/routes/metrics.ts` | Unchanged code, but its data source flips from an always-empty store to a live-ingested one — `/api/metrics` now returns real data (intended, but the first time this route sees non-empty input at runtime) |
| `server/ingest/pipeline.ts` / `store/invalidation.ts` | The `onInvalidate` contract and debounce guarantee they already provide are what the acceptance test asserts end-to-end; no code change, but their behavior is now load-bearing for a user-visible feature |
| `shared/ws-protocol.ts` | Message shapes consumed unchanged; #P3-2's `ws.ts` client will depend on exactly these three types |

## Areas of Impact

| Area | Impact | Risk | Why |
|---|---|---|---|
| `cli.ts` runtime path | First genuinely-live end-to-end path: `node cli.js` now scans `~/.claude/projects`, tails files, broadcasts | **M** | First time ingest runs in the real process (not just tests/benchmark); underlying poller/tailer are individually tested, lowering it |
| `/ws` route | Becomes stateful — tracks a socket set across connect/disconnect | **L** | Small, isolated; add/remove is symmetric and covered by the acceptance test |
| `/api/metrics` | Data source empty → live | **L** | Intended Phase-3 behavior; route logic untouched |
| #P3-2 (React shell / `ws.ts`) — downstream | Consumes the now-live invalidation stream | **L** | Contract (three message types) is unchanged and pre-agreed |
| Process lifecycle | New signal handlers own teardown | **L** | Additive; without them timers/handles simply leak on exit as before |

**Contract changes:** None. `WsServerMessage` (the only external/public wire contract) is unchanged; `buildApp`'s `BuildAppOptions` gains a field but is internal (sole callers: `cli.ts`, `app.test.ts`).

**Cross-cutting ripples:** No auth change (loopback-origin guard stays). No migrations, feature flags, or build-pipeline changes. Logging: ingest + Fastify already log via pino; optionally log broadcaster connect/disconnect at debug. `npm run verify` (typecheck→lint→format→test) gates as usual.

## Cross-Cutting Concerns

- **Errors:** `broadcast()` isolates per-socket send failures (try/catch per socket, continue the loop) and never throws — it executes inside `invalidation.ts`'s `safeOnFlush`, so an escape would crash the process. Origin-rejected WS handshakes keep 403ing via the existing `preValidation`.
- **Logging & metrics:** Reuse Fastify's pino logger. Optional debug lines on socket add/remove and `broadcaster.size`; no new metrics infrastructure (that's Report Card / #P4-11, not here).
- **Auth / authz:** Unchanged — loopback-origin allowlist on the `/ws` upgrade; no per-message auth (bus carries no data).
- **Performance:** `broadcast` stringifies once and iterates the socket set (single-digit clients in practice); debounce (§5.5, 200–500ms) already collapses burst writes upstream, so fan-out frequency is bounded. No new hot path.
- **Security:** WS still carries no data — nothing sensitive crosses even if origin-spoofed; the loopback guard remains the boundary. No secrets introduced.
- **Migrations / rollout:** None. Backward-compatible for the client (message contract identical). The only observable runtime change is that the app is now live instead of serving an empty store.

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies |
|---|---|---|---|---|
| A1 | Introduce an explicit `createBroadcaster()` seam injected into both ingest and app | Reuse `app.websocketServer.clients`; let `buildApp` own `startIngest`; mutable late-bound sink | Breaks the `onInvalidate`-bound-before-app cycle without coupling; framework-agnostic; unit-testable; matches file-per-concern style | §7, acceptance |
| A2 | `broadcast()` isolates per-socket errors and never throws | Let errors propagate | Runs inside `safeOnFlush`'s `setTimeout`; an escape crashes the process — matches poller/tailer/invalidation convention | §5.5, §7 |
| A3 | Rewire `cli.ts` to `startIngest` + `resolveScanConfig` in this task | Leave `cli.ts` on the bare Store; prove wire in test only | `cli.ts`'s own comment names this as #P3-1's job; the "watched fixture → WS" criterion needs a live end-to-end path | #P3-1 scope |
| A4 | SIGINT/SIGTERM → `ingest.stop()` + `app.close()` | Rely on process exit | Ingest now holds real timers + file handles that otherwise leak on Ctrl-C | Steel-thread hygiene |
| A5 | Absorb `sendInvalidation`/`OutboundSocket` into the Broadcaster | Keep both | The per-socket primitive is subsumed by the multi-socket one; no external importers | Simplification |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the Design Handles It |
|---|---|
| A socket dies/closes mid-flush | `broadcast` checks `readyState === OPEN` and try/catches each `send`; a dead socket is skipped, others still receive |
| One socket's `send` throws | Caught per-socket; loop continues to remaining sockets; `broadcast` never throws (protects `safeOnFlush`) |
| Multiple clients connected | `broadcast` iterates the full set; each gets the same serialized message |
| Flush fires with zero clients | Broadcast over empty set — message dropped. Accepted: the bus is best-effort; the client refetches all mounted queries on (re)connect. Noted as Open Question for reconnect-replay. |
| Burst of appends within the debounce window | `invalidation.ts` collapses them to one `session-updated`; the acceptance test asserts **exactly one** message, proving the wire preserves the guarantee |
| Client connects, receives a flush, disconnects, another flush fires | `socket.on("close")` → `broadcaster.remove`; the second flush skips it; `size` returns to 0 |
| Ctrl-C while tailing | SIGINT handler → `ingest.stop()` (cancels timers, closes handles) → `app.close()`; no leaked handles |

### Backward — regression risk per touched area

| Touched area | What could regress | How we'd know / mitigation |
|---|---|---|
| `server/app.ts` `BuildAppOptions` (`{store}`→`{store, broadcaster}`) | A caller omitting `broadcaster` | Only callers are `cli.ts` + `app.test.ts` (no prior `app.test.ts`); TS compile catches omission |
| `sendInvalidation` removal | An external importer breaks | Grep confirms no importers outside `app.ts`; TS/lint catches any missed reference |
| `cli.ts` bare-Store → ingest | `/api/metrics` assumed-empty somewhere; ingest touches real FS on boot | `metrics.test.ts` uses its own store (unaffected); acceptance test drives a temp fixture dir, not `~/.claude` |
| Debounce guarantee now user-facing | A future change to `invalidation.ts` silently double-emits | Acceptance test asserts exactly-one, turning the guarantee into a regression gate |

## Open Questions

- **Missed invalidations during client disconnect are not replayed on reconnect.** A `session-added`/`scan-updated` fired while no client is connected is lost.
  - **Impact if unresolved:** a client that reconnects could miss an "added" signal until the next update for that session.
  - **Suggested default:** rely on the client refetching all mounted queries on WS (re)connect (per §7 `ws.ts` reconnect behavior) — sufficient for the steel thread. Revisit only if a page proves it needs guaranteed delivery.
- **Should `broadcaster.size` feed `/api/health`?** Not required by #P3-1.
  - **Impact if unresolved:** none now.
  - **Suggested default:** expose `size()` for tests; defer any health surfacing to #P4-14 (Data Health / `/api/health`).

## Out of Scope

- New WS message types or any inbound WS protocol (reason: §7 fixes the bus at three server→client types; nothing needs more here).
- Parsing sidecar/premium capture files (reason: #P4-13).
- Client-side `ws.ts` reconnect/backoff and `invalidateQueries` wiring (reason: #P3-2 owns the React shell + WS client).
- `/api/health`, saved views, export, and other §9 routes not yet built (reason: their own Phase 4 tasks).

---

# Tasks

_This section is populated by the **generate-tasks** skill (Phase 3)._
_Run: `/generate-tasks from: specs/architecture/ARCH-fastify-ws-invalidation.md`_
