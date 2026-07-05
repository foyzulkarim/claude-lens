# Claude Lens — Build Plan (V2)

Companion to `claude-lens-architecture.md` (how), `claude-lens-pages.md` (what), and `gates.md` (Report Card gates). This document is the **project-management view**: phases, milestones, and the task list that becomes GitHub issues.

**How to use this doc:** each numbered task below becomes one GitHub issue, filed with its phase label (`phase-0` … `phase-5`). Issues are implemented sequentially in the order listed unless the dependency notes say otherwise. When starting a phase, re-read that phase's section here plus the spec sections it references. Check off tasks here as their issues close, so this file always shows where we are.

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` done

---

## Phase overview

```
Phase 0  Spec closure & repo prep     (unblocks everything)
Phase 1  Bootstrapping                (runnable skeleton, CI)
Phase 2  Data engine                  (parser → ingest → store → metrics; the risk phase)
Phase 3  Steel thread                 (one live chart end-to-end; go/no-go milestone)
Phase 4  Pages & features             (11 pages, gates, premium tier, explore)
Phase 5  Finalize & publish           (perf, package hygiene, docs, npm)
```

Phases 0–3 are strictly sequential. Within Phase 4, pages can proceed in the listed order sequentially; a few tasks note where parallelism is possible if we ever want it.

---

## Phase 0 — Spec closure & repo prep

Everything here unblocks later phases; none of it is throwaway.

- [x] **#P0-1 — `gates.md` written** — done (six V1 gates, thresholds, Report Card scoring).
- [ ] **#P0-2 — Move V1 app into `legacy/`**
  Move the current V1 (`index.html`, `server.js`, `llm-cache-cost.html`, `images/`, and V1-specific bits of `package.json`) into `legacy/`. Root `README.md` gets a one-line pointer. V1 must still run from `legacy/` (`node legacy/server.js`).
  *Acceptance:* repo root is clean for the V2 scaffold; V1 still boots from `legacy/`.
- [ ] **#P0-3 — Anonymized JSONL fixtures**
  Produce anonymized fixtures from real `~/.claude/projects` data covering: a multi-turn transcript with sidechains, model switches, cache TTL fields, malformed lines, and a partial trailing line; plus the three premium file types (`_cost`, `_turn-boundaries`, `cost-log`). Land under `test/fixtures/` with a README describing what each fixture exercises. Every parser/metrics/gates test depends on these.
  *Acceptance:* fixtures contain no real prompt text, paths, or identifiers; each edge case above is represented and documented.
- [ ] **#P0-4 — npm name check**
  Verify `claude-lens` availability on npm (and decide fallback name if taken). Reserve with a placeholder publish if needed. Cheap now, painful in Phase 5.
  *Acceptance:* package name decided and secured.
- [ ] **#P0-5 — LICENSE + repo hygiene**
  Choose and commit a license (MIT unless decided otherwise); add `engines` field (Node ≥ 18), `.nvmrc`, and `packageManager` so contributors and CI agree on runtime versions.
  *Acceptance:* LICENSE at repo root; `npm pkg get engines packageManager` returns the pinned values.
- [ ] **#P0-6 — GitHub project scaffolding**
  Create the `phase-0`…`phase-5` labels, one milestone per phase, and an issue template that links back to this plan doc and carries the task ID + acceptance criteria structure. This is what makes "tasks become issues" real.
  *Acceptance:* labels + milestones exist; a test issue filed from the template renders correctly and auto-links here.

**Exit criteria:** repo root empty of V1; fixtures merged; package name locked; license committed; issue tracking scaffolded.

---

## Phase 1 — Bootstrapping

Target layout is architecture §3 exactly. No feature code — just a booting skeleton.

- [ ] **#P1-1 — Scaffold three-root TS package**
  `shared/`, `server/`, `client/` per §3; strict TypeScript everywhere; production deps limited to the §2 server list; client deps as devDependencies.
  *Acceptance:* `tsc --noEmit` passes across all three roots; dependency lists match §2 (deviations require editing the architecture doc first).
- [ ] **#P1-2 — Dev & build toolchain**
  `tsx watch` dev server; `vite dev` with `/api` + `/ws` proxy; `scripts/build.ts` running vite build → esbuild server bundle → assembled `dist/` (`cli.js` + `public/`). CLI flags `--port`, `--no-open`, `--roots` parsed by hand (no commander).
  *Acceptance:* `node dist/cli.js` serves a hello-world SPA, an `/api/ping` route, and a WS upgrade on **one port**; dev mode hot-reloads client and restarts server.
- [ ] **#P1-3 — CI**
  GitHub Actions: typecheck + vitest on push/PR to main, plus a `storybook build` smoke step (once #P1-4 lands) and lint/format checks (once #P1-5 lands). The Cypress E2E job is added later by #P3-5. Single OS/Node version by decision (see decisions log).
  *Acceptance:* red CI blocks merge; typecheck+test stage runs in under ~2 min.
- [ ] **#P1-4 — Storybook setup**
  Storybook (Vite builder) wired to the client root as a devDependency: Tailwind styles loaded, dark/light theme toggle matching the dashboard aesthetic. Dev workbench only — no test-runner/play functions for now (revisit if UI regressions bite). Stories and `.storybook/` never enter the published `dist/`.
  *Acceptance:* `npm run storybook` renders a sample story with Tailwind applied in both themes.
- [ ] **#P1-5 — Linting + formatting**
  One tool across all three TS roots, wired into CI (#P1-3) and an npm script. Decide at task start: Biome (single fast tool, fits the minimal-tooling ethos) vs ESLint + Prettier (bigger ecosystem). Config lives at repo root; `legacy/` excluded.
  *Acceptance:* `npm run lint` and `npm run format:check` pass on the skeleton; a deliberately misformatted file fails CI.

**Exit criteria:** `npx .` from a fresh clone boots the skeleton on one port; Storybook runs; lint enforced; CI green.

---

## Phase 2 — Data engine (the risk phase)

Everything downstream assumes the parser, store, and metrics engine are correct. Ordered by dependency; each task's tests use the Phase 0 fixtures. Reference: architecture §4–§6, §8.

- [ ] **#P2-1 — Shared contracts**
  `shared/types.ts` (`CompactCall`, `Turn`, `Session`, `TierFlags`), `shared/metrics-contract.ts` (`MetricsQuery`, `Series` per §8), `shared/ws-protocol.ts` (three message shapes per §7).
  *Acceptance:* types compile and are imported by both server and client stubs; contract shapes match §7/§8 field-for-field.
- [ ] **#P2-2 — Transcript parser + dedupe**
  `parse-transcript.ts`: line → `CompactCall`; in-stream `message.id` dedupe with per-session seen-set; retain prompt text, drop tool_result bodies keeping byte sizes; malformed lines increment a per-file counter, never throw.
  *Acceptance:* fixture tests pin the compact-record contract (call counts, dedupe counts, token fields incl. `ephemeral_5m/1h`, error counters).
- [ ] **#P2-3 — Discovery + polling**
  `discovery.ts` (fast-glob over roots, filename classification T/C/B/L) and `poller.ts` (fast stat loop 2–5s, slow re-glob ~30s). Mid-run discovery registers brand-new session files.
  *Acceptance:* unit tests for classification; a file created after boot is picked up within one slow-loop interval.
- [ ] **#P2-4 — Tailer**
  `tailer.ts`: byte-offset map; read-from-offset on growth; truncation fallback (drop + full reparse); advance offset only to last newline (partial-line rule).
  *Acceptance:* tests cover partial trailing line, mid-write reads, truncation/rewrite, offset advancement — the §13 priority list.
- [ ] **#P2-5 — Warm-start cache**
  `warm-cache.ts`: `(path,size,mtime)`-keyed NDJSON compact-record cache under `~/.claude-lens/cache/`; best-effort writes; deleting the dir is always safe.
  *Acceptance:* second boot on unchanged files skips parsing (observable via log/health counters); corrupted cache entries fall back to parse.
- [ ] **#P2-6 — Store + derivations**
  `store.ts` columnar arrays; `derive-turns.ts` (promptId grouping, sidechain attribution); `derive-session.ts` (rollups, per-session tier detection); `invalidation.ts` (dirty-set, 200–500ms per-session debounce, emit hook). Incremental updates touch only the affected session; cross-session aggregates invalidate lazily.
  *Acceptance:* fixture tests for turn grouping and rollups; appending calls to one session leaves other sessions' derived state untouched.
- [ ] **#P2-7 — Boot & memory validation on real data** *(checkpoint task)*
  Run ingest against the real `~/.claude/projects`. Measure cold boot, warm boot, RSS.
  *Acceptance:* results recorded in this doc (below); memory in the expected "low hundreds of MB" band or a paging decision is escalated **before** Phase 3. This is the only assumption in the architecture that can force a redesign — fail fast here.
- [ ] **#P2-8 — Metrics engine: measures, dimensions, grain**
  `engine.ts` + `measures.ts` + `dimensions.ts` + `grain.ts`: the single `metrics(query) → Series[]` function; hour/day/week/month bucketing on epoch ms; period-over-period; computed-vs-observed cost labeling.
  *Acceptance:* hand-computed numbers from fixtures match engine output for every measure × a sample of dimensions; unit switching is a measure swap only.
- [ ] **#P2-9 — Distributions + smoothing + compare**
  `distributions.ts`: percentiles, histograms, pareto (`mode: "distribution"`); `ma7` smoothing; `compare: "previous-period"` alignment.
  *Acceptance:* percentile/histogram tests against known inputs; previous-period alignment correct across DST/month boundaries at each grain.
- [ ] **#P2-10 — `POST /api/metrics` route**
  Wire the engine to Fastify. Route handlers import only `store/` per the §3 module boundary.
  *Acceptance:* end-to-end test: fixture data in store → HTTP query → expected `Series[]`.

**Exit criteria:** all §13 priority-1–3 tests green; #P2-7 numbers recorded and acceptable.

---

## Phase 3 — Steel thread (milestone)

One vertical slice proving every layer. Nothing page-specific begins until this works. Reference: architecture §7, §11.

- [ ] **#P3-1 — Fastify assembly + WS invalidation bus**
  `app.ts`: static assets + SPA fallback, `/ws` upgrade, ingest→invalidation→WS wiring (three message types, never data).
  *Acceptance:* appending to a watched fixture file emits one debounced `session-updated` over WS.
- [ ] **#P3-2 — React shell**
  `main.tsx`/`App.tsx`: wouter routes (all 11 page stubs), `QueryClientProvider`, query-key factory in `api/`, `ws.ts` with hand-rolled reconnect/backoff invalidating by key prefix, layout chrome.
  *Acceptance:* navigation works; WS reconnects after server restart; only mounted queries refetch on invalidation.
- [ ] **#P3-3 — Global filter bar + URL sync**
  `filters/`: range presets (1D/7D/30D/90D/custom), project/model/branch/host chips; filter state lives in the query string and survives navigation (spec §0 permalink requirement).
  *Acceptance:* copy-pasting a URL reproduces the filtered view; filters persist across page changes.
- [ ] **#P3-4 — Chart layer + one live chart** *(the demo milestone)*
  ECharts wrapper (~50-line mount/setOption/ResizeObserver/dispose — no `echarts-for-react`); timeseries option builder; unit switcher, compare ghost, smoothing, granularity, click-to-drill implemented **in this layer** per §11. Mount one cost-over-time chart on the Dashboard stub.
  *Acceptance:* with Claude Code running a real session, the chart updates within a few seconds without reload. **Go/no-go checkpoint for Phase 4.**
- [ ] **#P3-5 — Cypress setup + steel-thread smoke spec**
  Cypress (devDependency) with a boot harness that launches the built app deterministically: `node dist/cli.js --roots test/fixtures --no-open --port <test-port>`. Smoke spec asserts: Dashboard renders the chart from fixture data; filter changes sync to the URL and survive navigation; appending a line to a fixture JSONL mid-test live-updates the chart (regression guard on the full ingest → store → WS → refetch loop). Add the E2E job to CI.
  *Acceptance:* smoke spec green locally and in CI against the built `dist/`; the live-update assertion passes without reload or polling hacks.

**Exit criteria:** live-updating chart demo recorded/verified against a real running session; Cypress smoke green in CI.

---

## Phase 4 — Pages & features

Pages are cheap by design: filter state + preset `MetricsQuery`s + layout. The HTML mockups in `specs/pages/` are the visual acceptance targets; `claude-lens-pages.md` defines each page's sections, deps, and tier behavior — treat its section tables as the per-issue checklist. Order below front-loads shared components; after #P4-2, remaining pages could parallelize, but sequential is fine.

**Standing rule for every page task (#P4-2, #P4-4 … #P4-16):** acceptance includes a Cypress smoke spec — the route renders its key sections from fixture data and at least one drill-link navigates to the right filtered destination. Component-state coverage belongs in Storybook stories, not Cypress.

- [ ] **#P4-1 — Shared dashboard primitives**
  `components/`: stat-card (delta + sparkline), data-table (TanStack Table + virtualization), tier-badge, locked-card ("Set up cost capture" CTA), empty-state, chip. Tailwind, no component library. Built in Storybook first.
  *Acceptance:* each primitive has stories covering its states (stat-card delta up/down/flat + sparkline, tier-badge 🟢/🟡/🔴, locked-card CTA, empty-state, table loading/virtualized rows); visual check against the mockups' shared elements.
- [ ] **#P4-2 — Dashboard page** *(pages spec §1)*
  All 12 sections incl. stat cards, burn-rate, leaderboards, records strip, subscription window tracker, leverage ratio, savings decomposition, failed-work stat, capture CTA. Anomaly/gate-feed items may stub until #P4-11.
  *Acceptance:* matches `specs/pages/dashboard.html` against real data; every card deep-links per the spec's "→" column.
- [ ] **#P4-3 — Search index + prompt search**
  `GET /api/search-index` + MiniSearch client integration; results deep-link to Session Detail at the matching turn.
  *Acceptance:* search-as-you-type over full history with no server round-trip per keystroke.
- [ ] **#P4-4 — Sessions page** *(§2)*
  Table (sortable, tier-dependent columns), timeline/gantt toggle, efficiency scatter with regression, cost histogram with percentile markers, compare mode. Tags column stubs until #P4-15.
  *Acceptance:* matches `sessions.html`; drill-in from Dashboard lands filtered.
- [ ] **#P4-5 — Session Detail page** *(§3)*
  All sections except Report Card (lands in #P4-12): header, cumulative timeline, per-turn bars, turn table, turn-vs-history distribution, cache strip, tool mix, prompt list, workflow funnel, token funnel, context composition. Needs `GET /api/sessions/:id`.
  *Acceptance:* matches `session-detail.html`; live-updates during an active session.
- [ ] **#P4-6 — Turn Inspector page** *(§4)*
  Turn summary, API-call waterfall (timestamp-delta fallback widths), cache narrative, transcript peek (lazy raw-file read route), sidechain breakdown. Needs `GET /api/sessions/:id/turns/:n` and `/transcript?turn=n`.
  *Acceptance:* matches `turn-inspector.html`; reachable from Session Detail and gate evidence links.
- [ ] **#P4-7 — Projects page** *(§5)*
  Spend + WoW, stacked-area composition, efficiency table, per-branch breakdown, → Sessions links.
  *Acceptance:* matches `projects.html`.
- [ ] **#P4-8 — Models page** *(§6)*
  Token/$ split, model mix over time, efficiency ratios, CC-version dimension, entrypoint breakdown; latency/throughput sections render 🟡 fallback (timestamp deltas) until premium (#P4-13) upgrades them.
  *Acceptance:* matches `models.html`.
- [ ] **#P4-9 — Cache Lab page** *(§7)*
  Fleet totals + hit-rate histogram/trend, input composition, busts net panel, **miss-attribution classifier (K2 base + TTL-lapse heuristic)**, TTL bucket mix, baseline weight trend, $ saved + counterfactual, invalidation gallery + cost-by-cause trend. The classifier built here is reused by gate K2.
  *Acceptance:* matches `cache-lab.html`; classifier has unit tests on fixtures.
- [ ] **#P4-10 — Trends, Calendar & Budget page** *(§8)*
  Calendar heatmap, hour×weekday heatmap, stacked weekly bars, Pareto, rolling efficiency, forecast (EWMA, labeled naive), budget config + projection band + Dashboard threshold alert. Gate pass-rate trend stubs until #P4-11.
  *Acceptance:* matches `trends.html`; budget value persists in `~/.claude-lens/config.json`.
- [ ] **#P4-11 — Gates engine** *(gates.md)*
  `gates/engine.ts` + six gate files (V1, V2, P3, C3, K2, E1/E2); shared preprocessing (dedupe, sidechain exclusion, edit/command call classification); evidence with Turn Inspector deep-links; session scoring per gates.md; configurable thresholds.
  *Acceptance:* per-gate fixture tests including N/A-turn denominators and E1/E2 filesystem checks (labeled "as of now").
- [ ] **#P4-12 — Report Card UI + gate feeds**
  Report Card section on Session Detail; anomaly & gate-failure feed on Dashboard; gate pass-rate trend on Trends; gate-status filter/column on Sessions.
  *Acceptance:* evidence links land on the exact turn in Turn Inspector.
- [ ] **#P4-13 — Premium tier: C/B/L parsers + upgrades**
  `parse-premium.ts`; per-session tier detection wiring through to `TierFlags`; every 🟡 upgrade path lights up: observed $, intra-day resolution, true ctx %, waterfall widths from `api_duration_ms`, Δlines/api-vs-wall columns, latency/throughput on Models, context growth curves on Cache Lab; drift badge on Session Detail.
  *Acceptance:* fixture set with C/B/L present flips tier badges and values; transcript-only sessions unaffected; tier-upgrade component states (🟡 columns lighting up, drift badge) covered by Storybook stories — these are hard to reproduce on demand with real data.
- [ ] **#P4-14 — Data Health page + `/api/health`** *(§9)*
  Dedup stats, pricing coverage, scan coverage, parse errors; reconciliation and boundary/capture-gap sections (🔴, needs #P4-13).
  *Acceptance:* matches `data-health.html`; malformed-line counters from #P2-2 surface here.
- [ ] **#P4-15 — Settings page + config/local-store** *(§10)*
  `~/.claude-lens/config.json` + `local.json` (settings.ts, local-store.ts); pricing table editor, labeled scan roots (host dimension), budget/anomaly/gate thresholds, saved-views + tags managers, cost-capture setup guide. `GET/PUT /api/config`, `/api/views`, `/api/tags`.
  *Acceptance:* matches `settings.html`; root relabeling reflects in the host dimension without restart; tags now filterable on Sessions.
- [ ] **#P4-16 — Explore page** *(§11)*
  Pivot builder over the existing engine: measure × dimension × grain × chart type; distribution mode; save-as-Saved-View pinned to Dashboard.
  *Acceptance:* matches `explore.html`; any curated chart is reproducible as an Explore query.
- [ ] **#P4-17 — Export**
  `GET /api/export?format=csv|json` streaming the current view; export + copy-permalink buttons in the global layer.
  *Acceptance:* exported CSV of a filtered Sessions view opens correctly; permalink reproduces the view.
- [ ] **#P4-18 — Cross-page E2E flows (Cypress)**
  The journeys that span pages, run against the fixture-root harness from #P3-5: prompt search → Session Detail at the matching turn; drill-anywhere from a Dashboard chart slice → Sessions filtered to that slice; permalink copy → paste reproduces the exact view; CSV export downloads; gate evidence link → Turn Inspector at the exact turn.
  *Acceptance:* all five flows green in CI.

**Exit criteria:** all 11 pages match their mockups on real data; §13 test priorities 1–4 all green; page smoke specs and #P4-18 flows green in CI.

---

## Phase 5 — Finalize & publish

- [ ] **#P5-1 — Performance pass**
  Cold/warm boot and RSS on a large real history; warm-cache hit verification; profile only if numbers miss targets (single-threaded until proven otherwise, §5.7).
  *Acceptance:* numbers recorded below; warm boot near-instant.
- [ ] **#P5-2 — Package hygiene + npx cold-start**
  Publish `dist/` only; no postinstall, no native modules (hard rules, §12); package size a few MB. Test `npx claude-lens` from a packed tarball on a clean environment (macOS + Linux at minimum). Verify `.storybook/`, `*.stories.tsx`, and `cypress/` are excluded from the tarball.
  *Acceptance:* tarball size recorded; cold `npx` boot works with zero prior installs; no dev-tooling files in the published package.
- [ ] **#P5-3 — Docs**
  README (install, screenshots, tier explanation), cost-capture setup guide (statusline + Stop hook), CHANGELOG. `legacy/` pointer note.
  *Acceptance:* a new user can go from `npx claude-lens` to premium tier using docs alone.
- [ ] **#P5-4 — Publish v0.1.0**
  npm publish; GitHub release; tag.
  *Acceptance:* `npx claude-lens@latest` works from the public registry.

---

## Benchmark log (filled in by checkpoint tasks)

| Date | Task | Cold boot | Warm boot | RSS | Data size | Notes |
|---|---|---|---|---|---|---|
| — | #P2-7 | | | | | |
| — | #P5-1 | | | | | |

## Decisions log

| Date | Decision | Where reflected |
|---|---|---|
| 2026-07-06 | V1 app moves to `legacy/`, stays runnable | #P0-2 |
| 2026-07-06 | Tasks tracked as sequential GitHub issues, one per task above, labeled by phase | this doc |
| 2026-07-06 | Storybook (Vite builder, devDependency) as the component workbench; primitives built stories-first; workbench only, no test-runner for now | #P1-4, #P4-1, #P4-13 |
| 2026-07-06 | Cypress for E2E only, booting built app via `--roots test/fixtures`; component states stay in Storybook (no duplication) | #P3-5, Phase 4 standing rule, #P4-18 |
| 2026-07-06 | Lint/format enforced from Phase 1 (Biome vs ESLint+Prettier decided at #P1-5 start); LICENSE + runtime pinning in Phase 0; GitHub labels/milestones/issue template scaffolded in Phase 0 | #P0-5, #P0-6, #P1-5 |
| 2026-07-06 | **Consciously skipped** (recorded so they're not re-litigated): CI OS/Node matrix (single OS/Node; cross-platform checked manually in Phase 5) · automated npx-tarball smoke in CI (manual in #P5-2) · npm provenance/OIDC + Dependabot · release automation (manual v0.1.0) · telemetry decision doc · global Definition-of-Done rule · a11y addon/audit · visual regression · Docker/staging · feature flags/i18n/APM · CONTRIBUTING/CODEOWNERS | — |
