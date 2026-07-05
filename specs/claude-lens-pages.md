# Claude Lens — Pages, Sections & Data Dependencies (v2)

## Data source legend

| Mark | Source | Availability |
|------|--------|--------------|
| **T** | `<session>.jsonl` — transcript (per-call usage, model, promptId, isSidechain, timestamps, tool calls, prompt text, `cwd`, `gitBranch`, `version`, `entrypoint`) | **Default — every user has this.** Scanned from `~/.claude/projects/**/*.jsonl` |
| **P** | Pricing table (Settings config) | Default |
| **C** | `<session>.cost.jsonl` — cost samples (observed $, api_duration_ms, lines ±, context_pct) | **Premium** — statusline setup |
| **B** | `<session>.turn-boundaries.jsonl` — Stop-hook turn ends | **Premium** — hook setup |
| **L** | `cost-log.jsonl` — per-session totals | **Premium** — statusline setup |
| **fs** | Filesystem checks (CLAUDE.md, scan roots) | Default |
| **⚑N** | Needs **new capture or config** not yet built (e.g. hostname field, budget config) | — |

**Tiers:** 🟢 transcript-only · 🟡 transcript fallback, premium upgrades it · 🔴 premium-only (locked card + "Set up cost capture" CTA).

**Core derivations:** turns = deduped calls (`message.id`) grouped by `promptId` · computed $ = tokens × P, labeled "computed" ("observed" when C/L present) · session index = fs scan.

**Dimensions (confirmed in the data):** time · project (`cwd`) · model (per call) · git branch · CC version · entrypoint (cli/ide) · main-vs-sidechain · tool name · gate status. **Host/machine**: not in any file — provide via labeled scan roots in Settings (🟢) or a hostname field added to cost-logger (⚑N).
**Measures:** computed/observed $ · tokens by type (input/output/cache-r/cache-w) · API calls · turns · sessions · tool calls · cache hit % · wall minutes · api ms (C) · lines ± (C) · gate pass rate.
Any dimension × any measure is a valid chart — the pages below are the curated subset; page 11 (Explore) is the escape hatch.

---

## 0. Global analytics layer (applies to every page)

| Capability | Deps | Tier | Notes |
|---|---|---|---|
| Global filter bar: date range presets (1D/7D/30D/90D/custom), project, model, branch, host | T (+fs for host labels) | 🟢 | Persists across pages; encoded in URL hash for permalinks |
| Period-over-period deltas on every stat (▲▼ vs previous equal period) | T+P | 🟢 | The single biggest "real dashboard" upgrade |
| Sparkline inside every stat card | T+P | 🟢 | |
| Granularity rollups: hour / day / week / month on every time series | T+P | 🟢 | |
| Unit switcher on every chart: $ ↔ tokens ↔ API calls ↔ turns | T+P | 🟢 | Tokens/calls work even with no pricing table at all |
| Compare overlay: this period vs previous (ghost line) | T+P | 🟢 | |
| Smoothing toggle: raw / 7-point moving average | T+P | 🟢 | |
| Drill-anywhere: click any point/bar/cell → Sessions filtered to that slice | T | 🟢 | |
| Export current view (CSV/JSON) + copy permalink | — | 🟢 | |
| Saved views (named filter+page combos) | ⚑N (local config) | 🟢 | |
| Empty/partial-range states: "no data for filter" with reset action | — | 🟢 | |

## Page map

```
1. Dashboard ── 2. Sessions ── 3. Session Detail ── 4. Turn Inspector
   ├─ 5. Projects   ├─ 6. Models      ├─ 7. Cache Lab
   ├─ 8. Trends, Calendar & Budget    ├─ 9. Data Health
   ├─ 10. Settings                    └─ 11. Explore (ad-hoc)
```

---

## 1. Dashboard

| Section | Deps | Tier | Notes / links |
|---|---|---|---|
| Stat cards with delta + sparkline: spend, total tokens, cache hit %, sessions, avg $/session | T+P; L upgrades $ to observed | 🟡 | Each → its page |
| Cost-over-time area chart (range/granularity/unit toggles, compare ghost) | T+P; C adds intra-day resolution | 🟡 | Click point → 2 filtered |
| Burn-rate card: month-to-date $, projected month-end, budget bar | T+P; budget value ⚑N (Settings) | 🟢 | → 8 §Budget |
| Most recent session card (trace thumb, turns, ctx %) | T+P; ctx % true value C | 🟡 | → 3 |
| Top sessions / top projects / top models mini-leaderboards (tabbed) | T+P | 🟢 | → 3 / 5 / 6 |
| Anomaly & gate-failure feed | T+P+fs; capture-gap items B/C | 🟡 | → 4, → 3 §Report Card, → 9 |
| Records strip: most expensive day/session/turn ever, longest session, biggest cache save | T+P | 🟢 | Small, fun, sticky |
| Subscription window tracker: 5h + 7d usage bars, "resets in Xh Ym", vs historical peak; user-calibrated limit | T (trailing-window token sums) + ⚑N calibration value | 🟢 | Estimated until first observed limit event; possibly the #1 install reason for sub users |
| Leverage ratio headline: tokens served from cache ÷ fresh-billed (e.g. "20×") | T | 🟢 | Same data as hit rate, better headline |
| Savings decomposition stack: cache discount $ + cheap-model routing $ (vs all-Opus uncached counterfactual) | T+P | 🟢 | |
| Failed-work stat: error tool_results / failed commands per period | T | 🟢 | Pairs with gate V2 |
| "Set up cost capture" banner (when C/B/L absent) | — | 🔴 CTA | → 10 |

## 2. Sessions

| Section | Deps | Tier | Notes |
|---|---|---|---|
| Full-text prompt search across all sessions ("when did I ask about X") | T | 🟢 | Results → 3 at the matching turn; the sleeper killer feature |
| Filter bar (inherits global + cost range, gate status, has-drilldown, branch, entrypoint) | T | 🟢 | |
| Sessions table (sortable: $, tokens, turns, duration, cache %, gate score, branch, version) | T+P | 🟡 | lines ±, observed $, ctx % columns light up with C/L |
| Timeline/gantt view: sessions as bars on a day axis (overlaps = parallel sessions) | T | 🟢 | Toggle with table |
| Efficiency scatter (any-measure × any-measure, regression line) | T+P | 🟢 | Presets: $×duration, tokens×turns |
| Session cost distribution histogram + p50/p90/p99 markers | T+P | 🟢 | "Is this session normal?" |
| Compare mode (2–3 sessions side-by-side) | T+P | 🟢 | |
| Tags: manual labels on sessions, filterable | ⚑N (local store) | 🟢 | |

## 3. Session Detail

| Section | Deps | Tier | Notes |
|---|---|---|---|
| Header (id, dir, branch, CC version, models, turns, computed $, vs-your-median badge) | T+P | 🟢 | Drift badge (computed vs observed) 🔴 |
| Cumulative $ timeline + turn rules + ctx sparkline + compaction flags | T+P; C upgrades resolution & true ctx % | 🟡 | |
| Per-turn cost bars (stacked main/sidechain; anomalies red; unit switcher) | T+P | 🟢 | Tail bucket only in B-mode |
| Turn table (# · $ · tokens · hit % · models · tools · timing · Δlines · flags) | T+P | 🟡 | Δlines, api-vs-wall 🔴 |
| Turn cost distribution vs your all-time turn distribution (percentile per turn) | T+P | 🟢 | Turns "expensive" is now relative to *you* |
| Cache strip (per-call hit rate, write spikes cause-labeled) | T | 🟢 | |
| Tool mix panel (+ tool timeline: which tools when) | T+P | 🟢 | |
| Prompt list (per-turn user text) | T | 🟢 | |
| Report Card (gates, session score, evidence links) | T+fs | 🟢 | Specs in `gates.md` |
| Workflow funnel: read → plan → edit → verify → commit coverage across turns | T | 🟢 | Same signals as gates V1/P3 rendered as a funnel |
| Token funnel: context offered → served from cache → fresh-billed → output | T+P | 🟢 | Shows output is ~1% of wire |
| Context composition: tool_result bytes by tool (Read vs Bash vs Grep…) | T | 🟢 | "My context is 80% file reads" |

## 4. Turn Inspector

| Section | Deps | Tier | Notes |
|---|---|---|---|
| Turn summary ($, tokens, models, flags, percentile vs your history) | T+P | 🟢 | api/wall/idle split 🔴 |
| API-call waterfall | T+P; widths from api_duration 🔴, fallback timestamp deltas | 🟡 | |
| Cache narrative (read/re-written + inferred cause) | T | 🟢 | |
| Transcript peek | T | 🟢 | |
| Sidechain breakdown | T+P | 🟢 | |

## 5. Projects

| Section | Deps | Tier | Notes |
|---|---|---|---|
| Spend by project + WoW growth per project | T+P; L upgrades | 🟡 | |
| Stacked-area composition: spend share by project over time | T+P | 🟢 | "Which project is eating the budget lately" |
| Per-project efficiency table ($/session, cache %, tokens/turn, gate pass rate, last active) | T+P+fs | 🟢 | $/line 🔴 |
| Per-branch breakdown within a project | T (`gitBranch`) | 🟢 | Feature-branch cost accounting |
| Project → sessions | T | 🟢 | → 2 |

## 6. Models

| Section | Deps | Tier | Notes |
|---|---|---|---|
| Call-level token & $ split | T+P | 🟢 | |
| Model mix over time (stacked area) — did the new model change my spend profile? | T+P | 🟢 | |
| Efficiency ratios by model: output tokens per $, cache hit %, tokens/turn | T+P | 🟢 | |
| CC-version dimension: spend/token profile before vs after a Claude Code update | T (`version`) | 🟢 | Nobody else can show this |
| $/1k-lines by model | C/L | 🔴 | |
| Latency by model (p50/p90) | C 🔴; fallback timestamp deltas | 🟡 | |
| Throughput: generation tok/s p50/p95 by model | C (output ÷ api_duration) 🔴; coarse timestamp fallback | 🟡 | |
| Entrypoint breakdown: token flow per client (cli / ide / sdk) | T (`entrypoint`) | 🟢 | |

## 7. Cache Lab

| Section | Deps | Tier | Notes |
|---|---|---|---|
| Fleet totals, hit-rate histogram + trend over time | T | 🟢 | |
| Input composition bar: reads / writes / uncached share of all input ("X% served from cache") | T | 🟢 | |
| Busts headline + net panel: saved by cache vs lost to busts → NET, net-negative badge per session | T+P | 🟢 | Adds accounting to the existing cause classifier |
| Miss attribution: TTL lapse (idle gap > TTL) vs prefix change (K2 classifier) vs unknown, verdict chip | T | 🟢 | One timestamp heuristic on top of existing classifier |
| TTL bucket mix: 5m vs 1h cache-write split | T (`cache_creation.ephemeral_5m/1h` — confirmed present) | 🟢 | 5m-heavy mix + idle pattern explains TTL misses |
| Baseline weight trend: first cache-write size per session over time (system prompt + CLAUDE.md + MCP overhead proxy) | T | 🟢 | "Baseline grew 18k the week I added that MCP server" |
| $ saved by cache (+ counterfactual: "uncached this month = $X") | T+P | 🟢 | |
| Invalidation gallery (cause-labeled, → turn) | T+P | 🟢 | |
| Invalidation cost by cause, over time (model-switch vs compaction vs unexplained) | T+P | 🟢 | Turns K2 into a trend |
| Context growth curves overlaid (session DNA small-multiples) | C 🔴; token-approx fallback | 🟡 | |

## 8. Trends, Calendar & Budget

| Section | Deps | Tier | Notes |
|---|---|---|---|
| Calendar heatmap ($ or tokens per day) | T+P | 🟢 | → 2 |
| Hour-of-day × weekday heatmap: when do I burn money | T+P | 🟢 | Pure timestamp math, high delight |
| Stacked weekly bars by project/model (toggle) | T+P | 🟢 | |
| Pareto panel: top 10% turns = X% of spend; cumulative curve | T+P | 🟢 | |
| Rolling efficiency: $/day 7d-MA, cache-hit trend, tokens-per-$ deflator | T+P | 🟢 | "Am I getting cheaper per unit of work" |
| Gate pass-rate trend per week (habits improving?) | T+fs | 🟢 | Promoted from gates.md deferred list |
| Budget: monthly cap, projection band (linear/EWMA), threshold alerts on Dashboard | T+P + ⚑N budget config | 🟢 | Local notifications only |
| Forecast: month-end spend projection with confidence band | T+P | 🟢 | Simple EWMA; labeled as naive |

## 9. Data Health

| Section | Deps | Tier | Notes |
|---|---|---|---|
| Dedup stats · pricing coverage (unpriced models) | T+P | 🟢 | |
| Scan coverage: roots scanned, transcripts found/parsed/failed | fs | 🟢 | |
| Reconciliation (computed vs sampled vs logged $) | T+P+C+L | 🔴 | |
| Boundary/promptId mismatches, unbucketed tails, capture gaps | B+C | 🔴 | |

## 10. Settings

| Section | Deps | Tier | Notes |
|---|---|---|---|
| Pricing table editor | P | 🟢 | |
| Scan roots with labels (label = host/machine dimension) | fs | 🟢 | Multi-machine without new capture |
| Budget & alert thresholds | ⚑N | 🟢 | |
| Anomaly + gate thresholds | — | 🟢 | `gates.md` |
| Saved views manager · tags manager | ⚑N | 🟢 | |
| Cost-capture setup guide (+ optional hostname field for true multi-host capture ⚑N) | — | 🟢 enables 🔴 | |

## 11. Explore (ad-hoc)

| Section | Deps | Tier | Notes |
|---|---|---|---|
| Pivot builder: pick measure × dimension × time grain × chart type (bar/line/area/scatter/table) | T+P | 🟢 | The generic layer exposed directly; every curated chart above is a preset of this |
| Percentile/distribution mode for any measure | T+P | 🟢 | |
| Save result as a Saved View (pins to Dashboard) | ⚑N | 🟢 | |

---

## Dependency summary

- 🟢 core got much bigger in v2: the entire global analytics layer, search, distributions, heatmaps, Pareto, budget/forecast, branch/version dimensions, Explore — all transcript-only.
- 🟡 unchanged in kind: observed $, true ctx %, intra-day resolution, timing widths.
- 🔴 unchanged: reconciliation, api/wall/idle, lines ±, capture-gap health.
- ⚑N (new capture/config, all small): budget value, saved views/tags store, subscription limit calibration, hostname field in cost-logger (optional — labeled scan roots cover the common case).

## Parser contract (extended)

`parseSession(files) → { session, turns[], calls[], tier }` unchanged, plus a fleet-level `metrics(filter) → series` layer: one query function that takes `{measures[], dimensions[], grain, range, filters}` and serves every chart, preset or Explore-built. Period deltas, MAs, and percentiles computed in this layer once — pages never aggregate raw data themselves.
