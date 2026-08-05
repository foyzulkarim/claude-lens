# Changelog

V2 changelog. V1 history lives in [`legacy/CHANGELOG.md`](legacy/CHANGELOG.md).

## v1.3.0 — 2026-08-05

### Features
- **Report Card / Cache Scorecard glossary** (#127) — gate rows now
  show an inline human-readable label next to each bare code (e.g.
  "V1 · Edit-without-verify"), plus a "?" info button explaining what
  the gate checks, why it matters, and the session's actual configured
  threshold. The overall score badge, the Cache Scorecard's hygiene
  grade badge, its decomposition metrics (warmup/incremental/
  rewritten/waste ratio/hit ratio), and the four waste-event kinds get
  the same treatment via a new, dependency-free, reusable
  `InfoModal`/`InfoButton` component pair.

## v1.2.0 — 2026-07-28

### Features
- **Cache scorecard** (#124) — a per-session hygiene grade summarizing
  cache-friendliness, plus a "Biggest Lever" card on the dashboard
  surfacing the single highest-impact change for the next session.

## v1.1.1 — 2026-07-26

### Fixes
- **Dashboard token visualizations reconciled** (#122) — token measures
  render as a stacked composition with measure identity preserved in
  accessible chart data, and the Trends calendar aggregates total tokens
  correctly. Compare is disabled while stacking applies (the toggle's
  state survives and returns with the unit), the calendar tooltip
  formats in the active unit, and cache-read share is clamped off an
  absolute 100%/0% when the true share is partial.

## v1.1.0 — 2026-07-25

### Features
- **Per-query instrumentation for `/api/metrics`** (#119) — a new
  `server/observability.ts` adds a write-only `QueryProbe` threaded
  through the metrics engine, a `Server-Timing` response header, one
  structured per-query log line (warned above the slow-query
  threshold), and an event-loop-lag monitor. Response bodies and
  status codes are unchanged.

### Fixes
- **Wide-range series metrics computed in a single pass** (#118) —
  series-mode `/api/metrics` queries over wide date ranges no longer
  block the event loop for 15–90s. The `measure×group×bucket` triple
  loop (which re-filtered and re-parsed every record per cell) is
  replaced by a single pass that parses each record once and places it
  into its `(group, bucket)` cell. Output is byte-for-byte identical to
  the previous implementation.

## v1.0.1 — 2026-07-21

### Features
- **Producer-side cost-capture tier** (#115) — `bash capture/install.sh`
  writes observed C/B/L sidecars during Claude Code sessions; matching
  sessions upgrade from 🟡 estimated to 🟢 observed automatically
- **Data Health page** (#P4-14) — session/file/dedup coverage and
  capture-file reconciliation at `/data-health`
- **Premium tier C/B/L parsers** (#P4-13) — observed values flow
  through the metrics engine for sessions that have capture files
- **Report Card UI** (#P4-12) — gates and KPIs on the Session Detail
  page

### Improvements
- Dashboard quick-start now points at the published
  `npx @foyzulkarim/claude-lens@latest` install
- Chart series names disambiguated when a query spans multiple measures
  (#104)

### Fixes
- Sub-agent transcripts route to parent sessions (#114) — sub-agents no
  longer get their own session rows by default

## v1.0.0 — 2026-05

V2 initial release. The original V1 app (single-file Express dashboard)
was moved to `legacy/` and is kept runnable for existing users.

### Features
- **Explore page** (#P4-16) — pivot builder over the metrics engine
- **Full-text prompt search** (#P4-3) — search across every prompt in
  every session
- **Settings page** — pricing table, budget, thresholds, roots + labels
- **WebSocket invalidation** — the dashboard live-updates as new
  transcripts and capture files appear
- **Tiered accuracy** — 🟡 estimated by default; 🟢 observed when
  premium capture files are present
