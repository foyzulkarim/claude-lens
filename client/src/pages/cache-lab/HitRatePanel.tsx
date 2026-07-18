import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import clsx from "clsx";
import { Chart } from "../../charts/Chart.js";
import {
  bucketRows,
  chartAriaLabel,
  chartRangeSummary,
  chartTrendSummary,
  type BucketRow,
} from "../../charts/ChartCard.js";
import { sessionsHrefForBucket } from "../../charts/drilldown.js";
import { formatUnitValue } from "../../charts/units.js";
import { useFilters } from "../../filters/useFilters.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import {
  buildHitRateHistogramOption,
  buildHitRateOption,
  classifySpanSummary,
} from "./chart-options.js";
import type { Series } from "../../../../shared/metrics-contract.js";

type Family = "line" | "histogram";

const FAMILIES: Family[] = ["line", "histogram"];

/**
 * Cache Lab hit-rate panel (ARCH §T6 R2): one of two interchangeable
 * views — line (cache hit % over time) or histogram (per-session hit
 * rate distribution). Both reuse the existing Chart wrapper and the
 * shared drill-link helper.
 *
 * Hit-rate data flows through `/api/metrics` rather than
 * `/api/cache-lab` (ARCH §Decision A1): cacheHitPct is the metrics
 * engine's measure, not a Cache Lab concept. A Cache Lab endpoint
 * outage therefore cannot blank this panel.
 */
export function HitRatePanel({ series }: { series: Series[] | undefined }) {
  const { filters } = useFilters();
  const [, navigate] = useLocation();
  const [family, setFamily] = useState<Family>("line");

  // Hit-rate series is the line view (cacheHitPct over time).
  // Histogram view rebuilds a distribution on the client from the same
  // row-resolution cacheHitPct series (each row's value treated as one
  // session's overall hit rate).
  const lineRows: BucketRow[] = useMemo(() => bucketRows(series), [series]);
  const histogramBins = useMemo(() => {
    const values = (series ?? [])
      .flatMap((s) => s.points)
      .map((p) => p.value)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (values.length === 0) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) return [{ rangeStart: min, rangeEnd: max, count: values.length }];
    const buckets = 10;
    const width = (max - min) / buckets;
    const result = Array.from({ length: buckets }, (_, i) => ({
      rangeStart: min + i * width,
      rangeEnd: i === buckets - 1 ? max : min + (i + 1) * width,
      count: 0,
    }));
    for (const v of values) {
      const idx = Math.min(buckets - 1, Math.floor((v - min) / width));
      const bucket = result[idx];
      if (bucket) bucket.count++;
    }
    return result;
  }, [series]);

  const linePoints = lineRows.map((row) => ({
    t: row.t,
    hitRate:
      row.values["Hit rate"] !== undefined
        ? (row.values["Hit rate"] ?? null)
        : (Object.values(row.values).find((v): v is number => typeof v === "number") ?? null),
  }));

  const lineOption = useMemo(() => buildHitRateOption(linePoints), [linePoints]);
  const histogramOption = useMemo(
    () => buildHitRateHistogramOption(histogramBins),
    [histogramBins],
  );
  const summary = useMemo(
    () => classifySpanSummary(linePoints.map((p) => ({ t: p.t, value: p.hitRate }))),
    [linePoints],
  );
  const ariaLabel = useMemo(() => chartAriaLabel(series, "Cache hit rate", "tokens"), [series]);
  const rangeSummary = useMemo(() => chartRangeSummary(series), [series]);
  const trendSummary = useMemo(() => chartTrendSummary(series), [series]);

  const handlePointClick = (
    timestamp: string,
    grain: import("../../../../shared/metrics-contract.js").Grain,
  ) => {
    navigate(sessionsHrefForBucket(timestamp, grain, filters));
  };

  return (
    <section
      data-testid="hit-rate-panel"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Hit rate</h2>
        <div className="flex gap-1">
          {FAMILIES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFamily(option)}
              aria-pressed={family === option}
              className={clsx(TOGGLE_CLASS, family === option && TOGGLE_ACTIVE_CLASS)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {(rangeSummary || trendSummary) && (
        <p className="mt-1 text-sm text-slate-600 dark:text-[#8A96A5]">
          {[rangeSummary, trendSummary].filter(Boolean).join(" · ")}
        </p>
      )}

      {summary.finiteBuckets === 0 ? (
        <p role="status" className="mt-4 text-sm text-slate-500 dark:text-[#8B98A9]">
          No hit-rate data in range.
        </p>
      ) : family === "line" ? (
        <Chart
          option={lineOption}
          onPointClick={(params) => {
            const value = params.value;
            const timestamp = Array.isArray(value) ? value[0] : undefined;
            if (typeof timestamp === "string") {
              handlePointClick(timestamp, "day");
            }
          }}
          className="mt-4 h-72 w-full"
          ariaLabel={ariaLabel ?? "Cache hit rate"}
        />
      ) : (
        <Chart
          option={histogramOption}
          className="mt-4 h-72 w-full"
          ariaLabel={
            histogramBins.length > 0
              ? `Hit-rate distribution across ${histogramBins.reduce(
                  (sum, b) => sum + b.count,
                  0,
                )} sessions`
              : "Hit-rate distribution"
          }
        />
      )}

      <p className="mt-2 font-mono text-xs text-slate-600 dark:text-[#8A96A5]">
        {formatUnitValue(summary.total, "tokens")} hit-rate sum · {summary.finiteBuckets} buckets
      </p>
    </section>
  );
}
