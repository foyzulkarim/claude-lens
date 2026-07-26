import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "wouter";
import type {
  Grain,
  Series,
  SeriesMetricsQuery,
  SeriesPoint,
} from "../../../../shared/metrics-contract.js";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { pointValue as sharedPointValue } from "../../charts/series-math.js";
import { formatUnitValue } from "../../charts/units.js";
import {
  StatCard,
  type StatCardProps,
  type StatDelta,
  StatRow,
} from "../../components/StatCard.js";
import { filtersToQuery, serializeFilters } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";
import { useStableNow } from "./useStableNow.js";

// Day grain keeps the sparkline readable across the common 7d/30d filter
// presets without an extra control — StatCard's toolbar-free contract
// (unlike ChartCard) means grain isn't user-selectable here.
const GRAIN: Grain = "day";

// ---------------------------------------------------------------------------
// Pure series-arithmetic helpers (exported for potential reuse/tests — none
// of these touch React or fetch).
// ---------------------------------------------------------------------------

/**
 * Reads a SeriesPoint's numeric value, treating non-finite or absent points
 * as 0. Re-exported here from `charts/series-math.ts` for backwards compat
 * with this file's existing tests and external imports — the canonical
 * implementation lives in the shared module now.
 */
export const pointValue = sharedPointValue;

export function sumPoints(points: SeriesPoint[] | undefined): number {
  return (points ?? []).reduce((sum, p) => sum + pointValue(p), 0);
}

/** Sums aligned points across a batched-measure `Series[]` response — every
 * measure in one `SeriesMetricsQuery` shares the same bucket boundaries
 * (architecture decision A5), so index `i` across series is the same
 * bucket. */
export function combinedSparkline(seriesList: (Series | undefined)[]): number[] {
  const length = Math.max(0, ...seriesList.map((s) => s?.points.length ?? 0));
  return Array.from({ length }, (_, i) =>
    seriesList.reduce((sum, s) => sum + pointValue(s?.points[i]), 0),
  );
}

export function combinedTotal(seriesList: (Series | undefined)[]): number {
  return seriesList.reduce((sum, s) => sum + sumPoints(s?.points), 0);
}

/** `undefined` (not 0) when any series in the batch lacks a `compareGhost` —
 * matches the engine's "no previous-period counterpart" contract (a
 * partial previous total would misrepresent the delta as a real number). */
export function combinedPreviousTotal(seriesList: (Series | undefined)[]): number | undefined {
  if (seriesList.some((s) => !s?.compareGhost)) return undefined;
  return seriesList.reduce((sum, s) => sum + sumPoints(s?.compareGhost), 0);
}

function ratioAt(input: number, cacheRead: number, cacheCreate: number): number {
  const eligible = input + cacheRead + cacheCreate;
  return eligible > 0 ? cacheRead / eligible : 0;
}

/** Cache-hit-rate is a ratio, not a summable count — per-bucket ratios
 * can't be added together, so this recomputes the ratio from the raw
 * token measures at each bucket / over the whole range (same math as the
 * server's `cacheHitPct` case in measures.ts, applied client-side to the
 * already-fetched batch instead of firing a second query for it). */
export function cacheHitSparkline(
  input?: Series,
  cacheRead?: Series,
  cacheCreate?: Series,
): number[] {
  const length = Math.max(
    input?.points.length ?? 0,
    cacheRead?.points.length ?? 0,
    cacheCreate?.points.length ?? 0,
  );
  return Array.from({ length }, (_, i) =>
    ratioAt(
      pointValue(input?.points[i]),
      pointValue(cacheRead?.points[i]),
      pointValue(cacheCreate?.points[i]),
    ),
  );
}

export function cacheHitTotal(input?: Series, cacheRead?: Series, cacheCreate?: Series): number {
  return ratioAt(
    sumPoints(input?.points),
    sumPoints(cacheRead?.points),
    sumPoints(cacheCreate?.points),
  );
}

export function cacheHitPreviousTotal(
  input?: Series,
  cacheRead?: Series,
  cacheCreate?: Series,
): number | undefined {
  if (!input?.compareGhost || !cacheRead?.compareGhost || !cacheCreate?.compareGhost)
    return undefined;
  return ratioAt(
    sumPoints(input.compareGhost),
    sumPoints(cacheRead.compareGhost),
    sumPoints(cacheCreate.compareGhost),
  );
}

/** Avg $/session per bucket — 0-session buckets are `NaN` (StatCard's
 * sparkline filters non-finite points, so they're skipped rather than
 * plotted as a false 0). */
export function avgPerSessionSparkline(cost?: Series, sessions?: Series): number[] {
  const length = Math.max(cost?.points.length ?? 0, sessions?.points.length ?? 0);
  return Array.from({ length }, (_, i) => {
    const s = pointValue(sessions?.points[i]);
    const c = pointValue(cost?.points[i]);
    return s > 0 ? c / s : Number.NaN;
  });
}

export function safeDivide(numerator: number, denominator: number): number | undefined {
  return denominator > 0 ? numerator / denominator : undefined;
}

/**
 * The Total-tokens tile's explanatory sub-line: what share of all token
 * volume was served from the prompt cache (issue #122). Returns `undefined`
 * for a zero-token range so an empty window renders no line at all rather
 * than "NaN%" or a meaningless "0%".
 *
 * Deliberately a *different* denominator from the Cache-hit-% tile, which
 * excludes output tokens (`cacheRead / (input + cacheRead + cacheCreate)`).
 * That one answers "how well is the cache working?"; this one answers "what
 * is this total made of?" — the two percentages will not match, and unifying
 * them would break whichever question it were unified toward.
 */
export function cacheReadShareLabel(
  cacheReadTotal: number,
  allTokensTotal: number,
): string | undefined {
  const share = safeDivide(cacheReadTotal, allTokensTotal);
  if (share === undefined) return undefined;
  // Rounding alone would claim an absolute "100% cache reads" at 99.6% and
  // "0%" at 0.4% — both read as exact on a tile whose whole job is
  // explaining a total. Only a true 1 or 0 gets the absolute reading.
  const pct = Math.round(share * 100);
  const clamped = pct === 100 && share < 1 ? 99 : pct === 0 && share > 0 ? 1 : pct;
  return `${clamped}% cache reads`;
}

function findSeries(data: Series[] | undefined, measure: Series["measure"]): Series | undefined {
  return data?.find((s) => s.measure === measure);
}

// ---------------------------------------------------------------------------
// Delta formatting
// ---------------------------------------------------------------------------

type Sentiment = "cost" | "benefit";

function sentimentFor(
  sentiment: Sentiment,
  direction: StatDelta["direction"],
): StatDelta["sentiment"] {
  if (direction === "flat") return "neutral";
  if (sentiment === "cost") return direction === "up" ? "bad" : "good";
  return direction === "up" ? "good" : "bad";
}

/** Percent-change delta. `previous === undefined || previous === 0` hides
 * the delta entirely (StatCard's third prop variant, sparkline +
 * sparklineLabel) rather than showing a divide-by-zero-derived "∞%" or a
 * fabricated 0% — matches the checklist's "card without a previous period
 * ... hides the delta" option. */
function pctDelta(
  current: number,
  previous: number | undefined,
  sentiment: Sentiment,
): StatDelta | undefined {
  if (previous === undefined || !Number.isFinite(previous) || previous === 0) return undefined;
  const pct = ((current - previous) / previous) * 100;
  const rounded = Math.round(Math.abs(pct));
  const direction: StatDelta["direction"] = rounded === 0 ? "flat" : pct > 0 ? "up" : "down";
  return { text: `${rounded}%`, direction, sentiment: sentimentFor(sentiment, direction) };
}

/** Percentage-point delta for ratio measures (cache hit %) — a "1.2%
 * change" on a 95%-ish ratio reads as noise; "1.2pp" states the actual
 * ratio movement, matching the mockup's `▲ 1.2` convention. */
function ppDelta(
  current: number,
  previous: number | undefined,
  sentiment: Sentiment,
): StatDelta | undefined {
  if (previous === undefined || !Number.isFinite(previous)) return undefined;
  const diffPp = Math.round((current - previous) * 1000) / 10;
  const direction: StatDelta["direction"] = diffPp === 0 ? "flat" : diffPp > 0 ? "up" : "down";
  return {
    text: `${Math.abs(diffPp)}pp`,
    direction,
    sentiment: sentimentFor(sentiment, direction),
  };
}

function sparklineTrendLabel(points: number[]): string {
  const finite = points.filter((p) => Number.isFinite(p));
  if (finite.length < 2) return "Not enough data for a trend yet";
  const first = finite[0] as number;
  const last = finite[finite.length - 1] as number;
  if (last === first) return "Flat over the period";
  return last > first ? "Trending up over the period" : "Trending down over the period";
}

// ---------------------------------------------------------------------------
// Drill-link matrix (section-level lock, ARCH-dashboard-page.md T9): spend
// and avg $/session drill to Trends, tokens to Models, cache hit % to Cache
// Lab, sessions to Sessions. Filters (including the date range) are
// retained verbatim on every link via `serializeFilters`.
// ---------------------------------------------------------------------------

function drillHref(path: string, filtersQuery: string): string {
  return filtersQuery ? `${path}?${filtersQuery}` : path;
}

interface DrillStatCardProps {
  label: string;
  value: string;
  accent?: StatCardProps["accent"];
  delta?: StatDelta;
  sparkline: number[];
  href: string;
  drillLabel: string;
  /** Optional explanatory line under the value (issue #122's "NN% cache
   * reads" on Total tokens). Rendered by `StatCard`, which already supports
   * `sub`, *and* folded into this link's `aria-label` below. */
  sub?: string;
}

/** Wraps `StatCard` in a `wouter` `Link` without modifying `StatCard`
 * itself — `display: contents` (the `contents` Tailwind class) lets the
 * anchor stay the click target while the grid still sees `StatCard`'s own
 * div as the direct child, so `StatRow`'s CSS grid layout is unaffected. */
function DrillStatCard({
  label,
  value,
  accent,
  delta,
  sparkline,
  href,
  drillLabel,
  sub,
}: DrillStatCardProps) {
  // An explicit `aria-label` on the anchor *overrides* its descendant text,
  // so a `sub` rendered only inside `StatCard` would be visible but silent
  // to a screen reader. One string feeds both so they can't drift.
  const ariaLabel = [`${label}: ${value}`, sub, `view in ${drillLabel}`]
    .filter(Boolean)
    .join(" — ");
  return (
    <Link href={href} aria-label={ariaLabel} className="contents">
      {delta ? (
        <StatCard
          label={label}
          value={value}
          accent={accent}
          delta={delta}
          sparkline={sparkline}
          sub={sub}
        />
      ) : (
        <StatCard
          label={label}
          value={value}
          accent={accent}
          sparkline={sparkline}
          sparklineLabel={sparklineTrendLabel(sparkline)}
          sub={sub}
        />
      )}
    </Link>
  );
}

/**
 * The Dashboard's 5-card stat row (ARCH-dashboard-page.md T9): spend, total
 * tokens, cache hit %, sessions, avg $/session — each with a delta vs the
 * previous equal period and a 1-week-ish sparkline.
 *
 * Batches per decision A5: one query (`costComputed` + `sessions`) serves
 * Spend, Sessions, and Avg $/session; a second query (the four token
 * measures) serves Total tokens and Cache hit % (recomputed client-side
 * from the raw components rather than firing a third query for the ratio
 * measure). Two `/api/metrics` calls power all 5 cards.
 */
export interface StatCardsRowProps {
  /** Injection seam for stories/tests; defaults to the real current time. */
  now?: Date;
}

export function StatCardsRow({ now: injectedNow }: StatCardsRowProps = {}) {
  const { filters } = useFilters();
  const filtersKey = serializeFilters(filters);
  // Review #4: same stale-closure bug class that the PR's two follow-up
  // commits already fixed in BurnRateCard/SubscriptionWindow via
  // useStableNow. A bare `new Date()` here freezes `now` at mount time
  // (serializeFilters omits the default preset, so filtersKey doesn't tick
  // forward either) and the sparklines stop reflecting the live window.
  const now = useStableNow(injectedNow);

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey); now ticks on its own via useStableNow
  const coreQuery = useMemo<SeriesMetricsQuery>(
    () => ({
      measures: ["costComputed", "sessions"],
      dimensions: ["time"],
      grain: GRAIN,
      compare: "previous-period",
      ...filtersToQuery(filters, now),
    }),
    [filtersKey, now],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey); now ticks on its own via useStableNow
  const tokensQuery = useMemo<SeriesMetricsQuery>(
    () => ({
      // Same order as `UNIT_MEASURES.tokens` — these are the four measures
      // the Dashboard chart below plots, and one ordering across the page
      // keeps the tile, the chart, and their query keys aligned.
      measures: ["inputTokens", "outputTokens", "cacheCreateTokens", "cacheReadTokens"],
      dimensions: ["time"],
      grain: GRAIN,
      compare: "previous-period",
      ...filtersToQuery(filters, now),
    }),
    [filtersKey, now],
  );

  const coreQ = useQuery({
    queryKey: qk.metrics(coreQuery),
    queryFn: ({ signal }) => postMetrics(coreQuery, signal),
    placeholderData: keepPreviousData,
  });

  const tokensQ = useQuery({
    queryKey: qk.metrics(tokensQuery),
    queryFn: ({ signal }) => postMetrics(tokensQuery, signal),
    placeholderData: keepPreviousData,
  });

  const isPending = coreQ.isPending || tokensQ.isPending;
  const isError = coreQ.isError || tokensQ.isError;
  const error = coreQ.error ?? tokensQ.error;

  const costSeries = findSeries(coreQ.data, "costComputed");
  const sessionsSeries = findSeries(coreQ.data, "sessions");
  const inputSeries = findSeries(tokensQ.data, "inputTokens");
  const outputSeries = findSeries(tokensQ.data, "outputTokens");
  const cacheReadSeries = findSeries(tokensQ.data, "cacheReadTokens");
  const cacheCreateSeries = findSeries(tokensQ.data, "cacheCreateTokens");

  const spendTotal = sumPoints(costSeries?.points);
  const spendPrevious = sumPoints(costSeries?.compareGhost);
  const spendHasPrevious = costSeries?.compareGhost !== undefined;

  const sessionsTotal = sumPoints(sessionsSeries?.points);
  const sessionsPrevious = sumPoints(sessionsSeries?.compareGhost);
  const sessionsHasPrevious = sessionsSeries?.compareGhost !== undefined;

  const tokensTotal = combinedTotal([
    inputSeries,
    outputSeries,
    cacheReadSeries,
    cacheCreateSeries,
  ]);
  const tokensPrevious = combinedPreviousTotal([
    inputSeries,
    outputSeries,
    cacheReadSeries,
    cacheCreateSeries,
  ]);
  const tokensSparkline = combinedSparkline([
    inputSeries,
    outputSeries,
    cacheReadSeries,
    cacheCreateSeries,
  ]);

  const cacheReadShare = cacheReadShareLabel(sumPoints(cacheReadSeries?.points), tokensTotal);

  const cacheHitRatio = cacheHitTotal(inputSeries, cacheReadSeries, cacheCreateSeries);
  const cacheHitPrevious = cacheHitPreviousTotal(inputSeries, cacheReadSeries, cacheCreateSeries);
  const cacheHitSpark = cacheHitSparkline(inputSeries, cacheReadSeries, cacheCreateSeries);

  const avgPerSession = safeDivide(spendTotal, sessionsTotal);
  const avgPerSessionPrevious =
    spendHasPrevious && sessionsHasPrevious
      ? safeDivide(spendPrevious, sessionsPrevious)
      : undefined;
  const avgSparkline = avgPerSessionSparkline(costSeries, sessionsSeries);

  const filtersQuery = filtersKey;

  return (
    <section aria-label="Key stats">
      {isPending && (
        <p role="status" className="text-sm text-slate-500 dark:text-[#8B98A9]">
          Loading stats…
        </p>
      )}
      {isError && (
        <p role="alert" className="text-sm text-[#B23A3A] dark:text-[#E05252]">
          {error instanceof Error ? error.message : "Failed to load stats"}
        </p>
      )}
      {!isPending && !isError && (
        <StatRow columns={5}>
          <DrillStatCard
            label="Spend"
            value={formatUnitValue(spendTotal, "$")}
            accent="money"
            delta={pctDelta(spendTotal, spendHasPrevious ? spendPrevious : undefined, "cost")}
            sparkline={costSeries ? costSeries.points.map((p) => pointValue(p)) : []}
            href={drillHref("/trends", filtersQuery)}
            drillLabel="Trends"
          />
          <DrillStatCard
            label="Total tokens"
            value={formatUnitValue(tokensTotal, "tokens")}
            sub={cacheReadShare}
            delta={pctDelta(tokensTotal, tokensPrevious, "cost")}
            sparkline={tokensSparkline}
            href={drillHref("/models", filtersQuery)}
            drillLabel="Models"
          />
          <DrillStatCard
            label="Cache hit %"
            value={`${Math.round(cacheHitRatio * 1000) / 10}%`}
            accent="cache"
            delta={ppDelta(cacheHitRatio, cacheHitPrevious, "benefit")}
            sparkline={cacheHitSpark}
            href={drillHref("/cache", filtersQuery)}
            drillLabel="Cache Lab"
          />
          <DrillStatCard
            label="Sessions"
            value={formatUnitValue(sessionsTotal, "calls")}
            delta={pctDelta(
              sessionsTotal,
              sessionsHasPrevious ? sessionsPrevious : undefined,
              "benefit",
            )}
            sparkline={sessionsSeries ? sessionsSeries.points.map((p) => pointValue(p)) : []}
            href={drillHref("/sessions", filtersQuery)}
            drillLabel="Sessions"
          />
          <DrillStatCard
            label="Avg $/session"
            value={avgPerSession !== undefined ? formatUnitValue(avgPerSession, "$") : "—"}
            accent="money"
            delta={
              avgPerSession !== undefined
                ? pctDelta(avgPerSession, avgPerSessionPrevious, "cost")
                : undefined
            }
            sparkline={avgSparkline}
            href={drillHref("/trends", filtersQuery)}
            drillLabel="Trends"
          />
        </StatRow>
      )}
    </section>
  );
}
