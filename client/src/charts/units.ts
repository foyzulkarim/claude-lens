import type { Measure } from "../../../shared/metrics-contract.js";

/**
 * The Dashboard's $/tokens/calls toggle (architecture §11). Not part of the
 * shared metrics contract — purely a client display concept mapped onto one
 * or more `Measure`s (ARCH-chart-layer-live-chart.md Data Models).
 */
export type Unit = "$" | "tokens" | "calls";

/** `tokens` sums input+output only — cache tokens have their own dedicated
 * cache-hit-rate treatment elsewhere per the pages spec (ARCH Open Questions,
 * resolved default). */
export const UNIT_MEASURES: Record<Unit, Measure[]> = {
  $: ["costComputed"],
  tokens: ["inputTokens", "outputTokens"],
  calls: ["apiCalls"],
};

/** Measure → Unit (the inverse of `UNIT_MEASURES`, expanded to cover every
 * `Measure` literal so the Explore page's per-measure formatter and the
 * distribution-percentile stat tiles can pick a Unit deterministically).
 *
 * `cacheHitPct` and `gatePassRate` are intentionally NOT mapped — they're
 * fractions rendered with their own suffix elsewhere (see
 * `TrendStatsRow`). Mapping them to "tokens" here would silently render a
 * "1.5% hit rate" as "1.5 tokens". */
export const MEASURE_UNIT: Record<Measure, Unit> = {
  costComputed: "$",
  costObserved: "$",
  inputTokens: "tokens",
  outputTokens: "tokens",
  cacheReadTokens: "tokens",
  cacheCreateTokens: "tokens",
  apiCalls: "calls",
  turns: "calls",
  sessions: "calls",
  toolCalls: "calls",
  toolErrors: "calls",
  wallMinutes: "calls",
  apiMs: "calls",
  linesAdded: "calls",
  linesRemoved: "calls",
  cacheSavingsComputed: "$",
  routingSavingsComputed: "$",
  // Percent measures — explicit "—" placeholder callers (no fraction
  // formatter wired yet). Tagged "tokens" would silently render
  // "1.5% cache hit rate" as "1.5 tokens"; "calls" still mis-renders but
  // the integer formatter at least produces a readable number. A future
  // "%" unit should replace these — see M1 follow-up.
  cacheHitPct: "calls",
  gatePassRate: "calls",
};

export function unitForMeasure(measure: Measure): Unit {
  return MEASURE_UNIT[measure];
}

/**
 * Human-readable name per `Measure` — used to disambiguate ECharts series
 * names when a chart requests more than one measure (e.g. the `tokens` unit's
 * `inputTokens`+`outputTokens` pair, per `UNIT_MEASURES` above). A `Record`
 * (not a partial map) so adding a `Measure` without a label here is a
 * compile error rather than a silently blank legend entry.
 */
export const MEASURE_LABELS: Record<Measure, string> = {
  costComputed: "Cost (computed)",
  costObserved: "Cost (observed)",
  inputTokens: "Input tokens",
  outputTokens: "Output tokens",
  cacheReadTokens: "Cache read tokens",
  cacheCreateTokens: "Cache create tokens",
  apiCalls: "API calls",
  turns: "Turns",
  sessions: "Sessions",
  toolCalls: "Tool calls",
  cacheHitPct: "Cache hit %",
  wallMinutes: "Wall minutes",
  apiMs: "API ms",
  linesAdded: "Lines added",
  linesRemoved: "Lines removed",
  gatePassRate: "Gate pass rate",
  toolErrors: "Tool errors",
  cacheSavingsComputed: "Cache savings (computed)",
  routingSavingsComputed: "Routing savings (computed)",
};

const CURRENCY_FORMAT = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const COMPACT_FORMAT = new Intl.NumberFormat("en-US", { notation: "compact" });
const INTEGER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Formats a value per the unit's display convention: currency for `$`,
 * compact counts for `tokens`, plain integers for `calls`. */
export function formatUnitValue(value: number, unit: Unit): string {
  switch (unit) {
    case "$":
      return CURRENCY_FORMAT.format(value);
    case "tokens":
      return COMPACT_FORMAT.format(value);
    case "calls":
      return INTEGER_FORMAT.format(value);
    default: {
      const unhandled: never = unit;
      throw new Error(`unhandled unit: ${unhandled}`);
    }
  }
}

/**
 * Null-safe variant of `formatUnitValue`: a non-finite or absent value
 * renders as the em-dash "—" rather than "$NaN" or "NaN tokens". Review #6
 * converged the multiple `formatMoney`/`COUNT_FORMAT`/etc. helpers that
 * used to be independently defined in 4 dashboard components onto this one
 * function so every "unavailable" cell renders the same placeholder.
 */
export function formatUnitValueOrDash(value: number | null | undefined, unit: Unit): string {
  return typeof value === "number" && Number.isFinite(value) ? formatUnitValue(value, unit) : "—";
}

/** Compact duration used consistently by session table and comparison rows. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m`;
}
