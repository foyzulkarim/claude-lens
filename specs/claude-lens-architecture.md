# Claude Lens — Architecture Specification

Companion to `claude-lens-pages.md` (IA + data dependencies) and `gates.md` (Report Card gate specs). This document defines **how** the system is built; those define **what** it shows. Conflict resolution: on **data semantics** the page spec wins; on **routing, URL encoding, and implementation mechanics** this document wins (e.g. global filters live in the query string, not the URL hash — see §11).

---

## 1. System overview

Claude Lens is a **local-first analytics dashboard** for Claude Code usage. One Node process, launched via `npx claude-lens`, that:

1. Discovers Claude Code session data under configured scan roots (default `~/.claude/projects`)
2. Parses transcript JSONL (and premium capture files when present) into compact in-memory records
3. Serves a React SPA + JSON query API + WebSocket invalidation feed **on a single port**
4. Polls source files and streams live updates into the dashboard while sessions run

```
~/.claude/projects/**/*.jsonl
        │  (poll + tail from byte offset)
        ▼
   Ingest pipeline ──► In-memory store ──► Metrics engine
        │                                       ▲
        │ invalidation events                   │ /api/metrics queries
        ▼                                       │
   WebSocket ◄──────────── Browser SPA ─────────┘
   (same port, same Fastify server, same process)
```

### Non-negotiable constraints

| Constraint | Consequence |
|---|---|
| Spin-up must be one command, near-instant | `npx claude-lens`; no global install; no native modules; warm-start cache |
| No database | In-memory columnar store; disk is used only for a warm-start **cache** (deletable at any time, always safe) and a small JSON config |
| Node is the only runtime | Every Claude Code user has Node. Bundle targets Node ≥ 18. Bun works via `bunx` as a bonus, never a requirement |
| Single port | Static assets, API, and WS share one Fastify server. No CORS, no proxy config in production |
| Live updates designed in from day one | WS is an **invalidation bus**, never a data channel (see §7) |

---

## 2. Technology stack

### Server (production dependencies — the complete list)

| Library | Role |
|---|---|
| `fastify` | HTTP server |
| `@fastify/static` | SPA assets + SPA fallback (serve `index.html` for unknown non-`/api` GETs) |
| `@fastify/websocket` | WS upgrade on the same server instance |
| `fast-glob` | Scan-root discovery |
| `open` | Launch browser on boot (`--no-open` to suppress) |
| `pino-pretty` | Terminal log formatting (pino ships with Fastify) |

Deliberately excluded: **chokidar** (polling replaces watching, §5.2), **any database driver** (§6), **zod** (we own both sides of the API; ingest validates by hand because malformed lines are counters, not errors), **commander/yargs** (CLI surface is `--port`, `--no-open`, `--roots`; parse `process.argv` directly), server-side date libraries (bucket on epoch ms; `Intl` for labels).

### Client (devDependencies — compiled into static assets)

| Library | Role |
|---|---|
| `react`, `react-dom` | UI |
| `wouter` | Routing (~2KB; six static routes need nothing heavier) |
| `@tanstack/react-query` | Query cache; the client half of the WS invalidation bus |
| `@tanstack/react-table` | Sessions table, turn table, Explore table output (headless) |
| `@tanstack/react-virtual` | Long turn/prompt lists |
| `echarts` | All charts. Canvas rendering (SVG chokes on per-call granularity). Per-module imports for treeshaking. Thin hand-rolled wrapper (~50 lines: mount, setOption, ResizeObserver, dispose) — **do not** use `echarts-for-react` |
| `minisearch` | Client-side prompt full-text search over an index served by the API |
| `date-fns` | Range-preset math, calendar grid helpers (client only) |
| `tailwindcss`, `clsx` | Styling. No component library — build the ~10 dashboard primitives by hand |

### Toolchain

`typescript` (strict, everywhere) · `vite` + `@vitejs/plugin-react` (client build; dev proxy) · `esbuild` (server → single `dist/server.js`) · `tsx` (dev server runner) · `vitest` (parser/metrics tests).

### Rejected alternatives (decision log)

| Option | Why rejected |
|---|---|
| Next.js | 150–200MB npx weight vs a few MB; SSR/RSC solve deployment problems a localhost SPA doesn't have; stateful singleton + WS upgrade fight its request model |
| Hono | Web-Standards-first; on Node it runs through an adapter layer that buys multi-runtime portability we explicitly don't need. Fastify is Node-native with mature first-party static/WS/logging |
| Recharts | SVG-per-point rendering janks at this data volume; missing calendar heatmap, hour×weekday heatmap, regression, brush, compare overlays natively; JSX-composition model fights the config-driven generic chart layer |
| SQLite/DuckDB | Native deps break npx cold-start; the metrics contract is a few hundred lines of aggregation over typed arrays; DuckDB would only earn its weight for Explore and doesn't |
| Bun runtime | `bunx` fails for users without Bun — reintroduces the install step. I/O-bound tailing gains nothing from Bun's speed. `--compile` binaries are ~90MB/platform |
| chokidar | Polling (§5.2) covers the need with less machinery and no platform quirks; a few seconds of dashboard latency is acceptable |
| Electron/Tauri | The browser is fine |

---

## 3. Repository layout

Single npm package, three TS roots sharing one types module.

```
claude-lens/
├── package.json              # "bin": {"claude-lens": "dist/cli.js"}
├── shared/
│   ├── types.ts              # CompactCall, Turn, Session, TierFlags
│   ├── metrics-contract.ts   # MetricsQuery + Series (§8)
│   └── ws-protocol.ts        # invalidation message shapes (§7)
├── server/
│   ├── cli.ts                # argv parse, port pick, boot, open()
│   ├── app.ts                # fastify assembly: static, routes, ws
│   ├── ingest/
│   │   ├── discovery.ts      # glob roots; classify T / C / B / L by filename
│   │   ├── poller.ts         # fast stat loop + slow re-glob loop
│   │   ├── tailer.ts         # offset map; read-from-offset; last-newline rule
│   │   ├── parse-transcript.ts  # line → CompactCall; message.id dedupe
│   │   ├── parse-premium.ts  # cost / turn-boundaries / cost-log parsers
│   │   └── warm-cache.ts     # (path,size,mtime)-keyed compact-record cache
│   ├── store/
│   │   ├── store.ts          # columnar arrays + per-session derived state
│   │   ├── derive-turns.ts   # promptId grouping; sidechain attribution
│   │   ├── derive-session.ts # rollups; tier detection per session
│   │   └── invalidation.ts   # dirty-set; debounce; emit to WS layer
│   ├── metrics/
│   │   ├── engine.ts         # THE query function (parser contract)
│   │   ├── measures.ts       # $, tokens-by-type, calls, turns, cache%, …
│   │   ├── dimensions.ts     # time, project, model, branch, version, entrypoint, tool
│   │   ├── grain.ts          # hour/day/week/month buckets; period-over-period
│   │   └── distributions.ts  # percentiles, histograms, pareto
│   ├── gates/
│   │   ├── engine.ts         # run gates per session; score
│   │   └── gates/            # one file per V1 gate (six — see gates.md)
│   ├── routes/
│   │   ├── metrics.ts        # POST /api/metrics
│   │   ├── sessions.ts       # list, detail, compare
│   │   ├── turns.ts          # turn-inspector payloads
│   │   ├── search.ts         # GET /api/search-index
│   │   ├── health.ts         # parse errors, coverage, reconciliation
│   │   ├── config.ts         # settings read/write
│   │   └── export.ts         # CSV/JSON streaming
│   └── config/
│       ├── settings.ts       # ~/.claude-lens/config.json (§10)
│       └── local-store.ts    # tags, saved views
├── client/
│   ├── index.html · vite.config.ts
│   └── src/
│       ├── main.tsx · App.tsx        # wouter routes, QueryClientProvider
│       ├── api/                      # typed fetchers; query-key factory; ws.ts
│       ├── filters/                  # global filter bar; URL ↔ filter sync; presets
│       ├── charts/                   # ECharts wrapper + option builders per family
│       ├── components/               # stat-card, data-table, tier-badge, locked-card,
│       │                             # empty-state, layout chrome
│       └── pages/
│           ├── dashboard/  sessions/  session-detail/  turn-inspector/
│           ├── projects/   models/    cache-lab/       trends/
│           ├── data-health/ settings/ explore/
│           └── (each: index.tsx + page-local sections/)
├── scripts/build.ts          # vite build → esbuild server → assemble dist/
└── test/                     # anonymized jsonl fixtures; parser + metrics specs
```

### Module boundaries (enforced, not decorative)

- `shared/metrics-contract.ts` is the **only vocabulary pages speak**. A page = filter state + a list of `MetricsQuery` presets + layout. Pages never aggregate raw data.
- `charts/` implements the global analytics layer (unit switcher, compare ghost, smoothing, granularity) **exactly once**. Every chart on every page is an instance of this generic layer.
- `store/` is the only module `routes/` may import for data. `ingest/` is the only module that writes to it. Route handlers never touch the filesystem.
- Explore (page 11) is not special: it's a page whose `MetricsQuery` is user-assembled instead of preset.

---

## 4. Data sources (input contract)

Per `claude-lens-pages.md` legend. Filename classification within scan roots:

| Pattern | Source | Tier |
|---|---|---|
| `<uuid>.jsonl` | **T** — transcript (per-call usage, model, `promptId`, `isSidechain`, timestamps, tool calls, prompt text, `cwd`, `gitBranch`, `version`, `entrypoint`) | Default |
| `<uuid>.cost.jsonl` | **C** — cost samples (observed $, `api_duration_ms`, lines ±, `context_pct`) | Premium |
| `<uuid>.turn-boundaries.jsonl` | **B** — Stop-hook turn ends | Premium |
| `cost-log.jsonl` | **L** — per-session totals. **Lives at `~/.claude/cost-log.jsonl`** — the *parent* of the default projects scan root; discovery must check it explicitly, not rely on the projects glob | Premium |

Filename convention is **dot-separated**, verified against the real capture output (`ls ~/.claude/projects/**/*.cost.jsonl`) and V1 `legacy/server.js` (filters `.cost.jsonl`). Do not use underscore forms.

Core semantics (confirmed against real data, do not re-derive):

- **Dedupe by `message.id`** — raw transcript lines collapse significantly to distinct API calls. The store must never contain duplicates; dedupe happens in-stream at parse time (§5.3), never at query time.
- **`promptId` is the turn-grouping key.** Turn boundaries file (B) is optional refinement, not required for turn derivation.
- **Tier is per-session**: detect which of C/B/L exist for each session; costs are labeled `computed` (tokens × pricing table) vs `observed` (from C/L).
- **Host/machine is not in any file.** The host dimension comes from labeled scan roots in Settings.
- Cache TTL buckets: `cache_creation.ephemeral_5m_input_tokens` and `cache_creation.ephemeral_1h_input_tokens` (exact field names, verified 2026-07-06 against real transcripts) drive the Cache Lab TTL mix panel.

---

## 5. Ingest pipeline

Five stages. Runs in-process, decoupled from HTTP: route handlers read the store; only ingest writes it.

### 5.1 Discovery

On boot and on a slow interval, `fast-glob` `**/*.jsonl` under each scan root; classify by filename; register unknown files in the tail map. Mid-run discovery is what makes a brand-new live session appear without restart.

### 5.2 Polling (no filesystem watcher)

Two timers:

- **Fast loop (2–5s):** `fs.stat` every registered file; on `size`/`mtime` change, hand to the tailer.
- **Slow loop (~30s):** re-run discovery for new files.

Rationale: chokidar's value is sub-second reaction and huge file counts; we need neither, and polling has zero platform quirks. A few seconds of dashboard latency is acceptable.

### 5.3 Tailing — byte offsets, append-only assumption

Per-file state: `Map<path, {size, mtime, offset}>`.

- **Size grew** → `fs.read` from stored `offset` only. JSONL transcripts are append-only, so this is safe; a poll on a live session reads a few KB, not tens of MB.
- **Size shrank or rewrite suspected** → treat as truncated: drop that file's records from the store, reparse from byte 0. This fallback is the entire robustness story; never attempt diffing.
- **Partial trailing line** (Claude Code may be mid-write): after each read, parse complete lines only and **advance `offset` to the last newline**. A half-written tail stays beyond the offset and is re-read whole next poll. No remainder buffer.
- **Byte offsets, not line counts** — line counts force reading from byte 0 to count newlines; offsets allow positioned reads.
- Multiple concurrent live sessions need nothing special: each session is its own file, entries in the map are independent.

### 5.4 Parse + dedupe

Line → JSON → `CompactCall`. Rules:

- Dedupe by `message.id` with a per-session seen-set, in-stream.
- Retain **user prompt text** (needed for search; small) but **not tool_result content — only byte sizes** (needed for context-composition panels). Session Detail's transcript peek reads the raw file lazily on request.
- Malformed line → increment per-file error counter (surfaces on Data Health page), skip, never throw.

### 5.5 Store update + emit

- Append compact records to columnar arrays; incrementally update derived state (turn groupings by `promptId`, session rollups) **for the affected session only**.
- Cross-session aggregates (daily rollups, records strip) are invalidated lazily — recomputed on next query, not eagerly per append (a live session fires events every few seconds).
- After appends settle (**debounce 200–500ms per session** — CC writes in bursts), emit one `{sessionId}` invalidation to the WS layer.

### 5.6 Warm-start cache

Sits at the tail/parse boundary. On boot, if `(path, size, mtime)` matches a cache entry in `~/.claude-lens/cache/`, load compact records directly and skip parsing; else parse and write the entry back. Format: NDJSON of compact records (revisit msgpack only if boot profiling demands). Cache writes are best-effort — failure means a slower next boot, nothing else. Deleting the cache directory is always safe.

### 5.7 Threading

Single-threaded until proven otherwise. Only cold-boot backfill of a large history plausibly justifies a parse worker pool; incremental tails are trivial. Build single-threaded, measure boot on real data, then decide.

---

## 6. In-memory store

- Columnar arrays of `CompactCall` plus derived `Turn` and `Session` structures, per §5.5.
- Memory discipline comes from what's *excluded* at parse time (no tool_result bodies), not from paging. Expected footprint: low hundreds of MB for months of heavy usage. **Validate against real data early**; a paging strategy is the contingency, not the plan.
- No persistence beyond the warm cache. Restart = reload cache + tail deltas.

---

## 7. WebSocket protocol — invalidation bus only

**The WS never carries data.** It carries "something changed"; the client refetches through the normal HTTP query API.

Server → client messages (`shared/ws-protocol.ts`):

```
{ type: "session-updated", sessionId: string }   // debounced per §5.5
{ type: "session-added",   sessionId: string }
{ type: "scan-updated" }                          // roots rescanned / settings changed
```

Client behavior: `ws.ts` maintains a native WebSocket with hand-rolled reconnect/backoff (no library). On message → `queryClient.invalidateQueries()` scoped by the query-key factory. Only mounted queries refetch; a background session updating while you're on Settings costs nothing. This yields live-updating Session Detail while Claude Code runs — a headline demo feature — with a protocol of three message types.

Why not push data over WS: it duplicates the query layer inside the socket protocol, forever. Rejected permanently.

---

## 8. Metrics engine (server-side query contract)

From the parser contract in `claude-lens-pages.md`:

```ts
metrics(query: MetricsQuery): Series[]

MetricsQuery = {
  measures:   Measure[]      // $, tokens by type, calls, turns, sessions, cache%, wall-min, api-ms(C), lines±(C), gate pass rate
  dimensions: Dimension[]    // time, project(cwd), model, gitBranch, version, entrypoint, main/sidechain, tool, gateStatus, host(root label)
  grain:      "hour" | "day" | "week" | "month"
  range:      { from, to }   // presets resolved client-side
  filters:    Partial<Record<Dimension, value[]>>
  compare?:   "previous-period"      // ghost overlay
  smoothing?: "none" | "ma7"
  mode?:      "series" | "distribution"   // distributions.ts: percentiles/histogram/pareto
}
```

Rules:

- **One engine serves every chart** — curated pages and Explore alike. Any dimension × any measure is valid.
- Period-over-period deltas, moving averages, and percentiles are computed **here, once**. Pages and charts never aggregate raw data.
- Unit switching ($ ↔ tokens ↔ calls ↔ turns) is just a measure swap — same query shape, so it's cheap everywhere.
- Costs carry a `computed | observed` label per the tier rules in §4.

## 9. HTTP API surface

| Route | Purpose |
|---|---|
| `POST /api/metrics` | The engine. Body = `MetricsQuery` |
| `GET /api/sessions` · `GET /api/sessions/:id` | List (sortable columns incl. tier-dependent ones) · detail payload |
| `GET /api/sessions/:id/turns/:n` | Turn Inspector payload (waterfall, cache narrative, sidechains) |
| `GET /api/sessions/:id/transcript?turn=n` | Lazy raw-transcript peek (reads file on demand) |
| `GET /api/search-index` | MiniSearch-ready prompt index; searching happens client-side |
| `GET /api/health` | Dedup stats, parse errors, scan coverage, reconciliation (premium) |
| `GET/PUT /api/config` | Settings: roots+labels, pricing table, budget, thresholds |
| `GET/PUT /api/views` · `/api/tags` | Saved views, session tags (local-store) |
| `GET /api/export?format=csv\|json&…` | Streams current view |
| `GET /ws` | WebSocket upgrade |
| `GET /*` | Static SPA + fallback to `index.html` |

## 10. Local configuration (`~/.claude-lens/`)

```
~/.claude-lens/
├── config.json      # scan roots [{path, label}], pricing table, budget,
│                    # anomaly + gate thresholds, subscription-limit calibration
├── local.json       # saved views, session tags
└── cache/           # warm-start cache (§5.6) — deletable at any time
```

Covers every ⚑N item in the page spec except the optional hostname field in cost-logger (deferred; labeled roots cover the common case).

---

## 11. Frontend architecture

- **Routing:** wouter, history mode (we own the server, so SPA fallback is trivial). Global filters live in the **query string** (`/sessions?range=7d&project=x&model=sonnet`) — this satisfies the spec's persistence/permalink requirement with cleaner URLs than hash routing. `filters/` owns URL ↔ state sync; filter state survives page navigation.
- **Data:** every remote read goes through TanStack Query with keys from one factory (`api/`). The WS handler invalidates by key prefix. Identical `MetricsQuery`s across chart instances dedupe automatically.
- **Charts:** one generic chart component (`charts/`) that takes `Series[]` + a chart-family option builder (timeseries / heatmap / calendar / scatter / pareto / funnel / distribution). Unit switcher, compare ghost, smoothing toggle, granularity control, and click-to-drill (→ Sessions filtered to the clicked slice) are implemented in this layer once and appear on every chart for free.
- **Tables:** TanStack Table headless + shared `data-table` component; virtualized where rows can reach thousands (turn table, prompt list).
- **Search:** index fetched once from `/api/search-index`, MiniSearch runs in-browser — search-as-you-type without server round-trips. Result rows deep-link to Session Detail at the matching turn.
- **Tier awareness:** components render 🟢/🟡/🔴 states from per-session/fleet tier flags in API payloads — `locked-card` with "Set up cost capture" CTA for 🔴, upgraded columns/values lighting up when C/B/L present (🟡).
- **Styling:** Tailwind; dense-data-dashboard aesthetic; ~10 hand-built primitives (stat-card with delta + sparkline, filter bar, chip, tier badge, empty state, locked card).

## 12. Build, dev, distribution

- **Dev:** `tsx watch server/cli.ts` + `vite dev` with proxy for `/api` and `/ws` → two ports in dev only.
- **Build (`scripts/build.ts`):** `vite build` → `client/dist`; `esbuild server/cli.ts --bundle --platform=node --target=node18` → `dist/cli.js` (+ pino-pretty worker handling); assemble package with static assets under `dist/public/`.
- **Package:** publish `dist/` only; goal is a few MB so npx cold-start stays fast. No postinstall scripts, no native modules — these are hard rules.
- **Runtime flags:** `claude-lens [--port <n>] [--no-open] [--roots <paths…>]`. Default port auto-increments if taken; prints the URL; opens browser.

## 13. Testing priorities

Highest-value, in order:

1. **Parser + dedupe** (`parse-transcript`) against real anonymized fixtures — the compact-record contract must not regress.
2. **Tailer edge cases:** partial trailing line, truncation/rewrite fallback, offset advancement.
3. **Metrics engine:** grain bucketing, period-over-period alignment, percentiles, computed-vs-observed labeling.
4. **Gate engine** per `gates.md` specs.

UI testing is manual against real data initially; the mockup HTML pages define the visual acceptance target.

## 14. Build order (suggested for implementation agent)

1. `shared/` types + parser + tests (fixtures from real data)
2. Ingest pipeline (poll, tail, warm cache) + store — verify boot time and memory on real `~/.claude/projects`
3. Metrics engine + `/api/metrics` — validate against hand-computed numbers from the fixture data
4. App shell: Fastify, static, WS bus, React shell with filter bar + one live chart (proves the whole loop end-to-end)
5. Pages in spec order: Dashboard → Sessions → Session Detail → Turn Inspector → the rest
6. Gates engine + Report Card
7. Premium (C/B/L) parsing + tier upgrades + Data Health
8. Explore + saved views + tags + export
