import type { Distribution, SeriesPoint } from "../../shared/metrics-contract.js";

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.ceil((p / 100) * sorted.length);
  const clamped = Math.min(Math.max(index, 1), sorted.length);
  return sorted[clamped - 1] ?? null;
}

const HISTOGRAM_BUCKET_COUNT = 10;

function buildHistogram(sorted: number[]): Distribution["histogram"] {
  if (sorted.length === 0) return [];
  const min = sorted[0] as number;
  const max = sorted[sorted.length - 1] as number;
  if (sorted.length === 1 || min === max) {
    return [{ rangeStart: min, rangeEnd: max, count: sorted.length }];
  }

  const width = (max - min) / HISTOGRAM_BUCKET_COUNT;
  const buckets = Array.from({ length: HISTOGRAM_BUCKET_COUNT }, (_, i) => ({
    rangeStart: min + i * width,
    rangeEnd: i === HISTOGRAM_BUCKET_COUNT - 1 ? max : min + (i + 1) * width,
    count: 0,
  }));

  for (const value of sorted) {
    const rawIndex = Math.floor((value - min) / width);
    const index = Math.min(rawIndex, HISTOGRAM_BUCKET_COUNT - 1);
    const bucket = buckets[index];
    if (bucket) bucket.count += 1;
  }

  return buckets;
}

function buildPareto(values: number[]): Distribution["pareto"] {
  const n = values.length;
  if (n === 0) return undefined;

  const descending = [...values].sort((a, b) => b - a);
  const total = descending.reduce((sum, v) => sum + v, 0);

  let cumulative = 0;
  const curve = descending.map((value, i) => {
    cumulative += value;
    return {
      entityPct: ((i + 1) / n) * 100,
      cumulativeValuePct: total === 0 ? 0 : (cumulative / total) * 100,
    };
  });

  const topDecileCount = Math.ceil(n * 0.1);
  const topDecileValue = descending.slice(0, topDecileCount).reduce((sum, v) => sum + v, 0);
  const topDecileValuePct = total === 0 ? 0 : (topDecileValue / total) * 100;

  return { curve, topDecileValuePct };
}

const MA7_WINDOW = 7;

export function movingAverage7(points: SeriesPoint[]): SeriesPoint[] {
  return points.map((point, i) => {
    const windowStart = Math.max(0, i - (MA7_WINDOW - 1));
    const window = points.slice(windowStart, i + 1);
    const nonNull = window.map((p) => p.value).filter((v): v is number => v !== null);
    const value =
      nonNull.length === 0 ? null : nonNull.reduce((sum, v) => sum + v, 0) / nonNull.length;
    return { t: point.t, value };
  });
}

// Ghost points render at the current period's x-position (same bucket slot),
// carrying the previous period's value — not the previous point's own `t`,
// which belongs to a different instant entirely.
export function alignPreviousPeriod(
  current: SeriesPoint[],
  previous: SeriesPoint[],
): SeriesPoint[] {
  return current.map((point, i) => ({ t: point.t, value: previous[i]?.value ?? null }));
}

export function computeDistribution(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    histogram: buildHistogram(sorted),
    pareto: buildPareto(values),
  };
}
