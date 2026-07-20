import type { Series, SeriesPoint } from "../../../shared/metrics-contract.js";

/**
 * Extracts a `SeriesPoint`'s numeric value, treating non-finite or absent
 * points as 0. Single canonical implementation of the "is this a usable
 * number?" guard that used to be hand-rolled in 6 dashboard components with
 * three different fallback conventions (0, null, skip). Co-located with
 * `charts/units.ts` so a future chart-component import already has the
 * series-math primitives in scope.
 */
export function pointValue(point: SeriesPoint | undefined): number {
  return typeof point?.value === "number" && Number.isFinite(point.value) ? point.value : 0;
}

/**
 * Same guard as `pointValue` but returns `null` for the absent/non-finite
 * case instead of 0 — for components that need to distinguish "no data"
 * from "real zero" (e.g. `aggregateValue`-style consumers rendering "—" vs
 * "$0.00"). Use `pointValue` when you intend to sum or count; use this when
 * you intend to display.
 */
export function pointValueOrNull(point: SeriesPoint | undefined): number | null {
  return typeof point?.value === "number" && Number.isFinite(point.value) ? point.value : null;
}

/**
 * Sum a series' `points` array, ignoring non-finite values. Extracted
 * (#P4-12 review finding #26) from the 5 near-duplicate measure helpers
 * that lived inline in `EfficiencyTable.tsx` (Trends gate-pass-rate +
 * projects + models have all been consumers of this pattern). Centralizing
 * keeps the "ignore non-finite" rule consistent — a future panel that
 * wanted to error on a non-finite point would break loudly here rather
 * than silently in five places.
 */
export function sumPoints(points: readonly SeriesPoint[]): number {
  let sum = 0;
  for (const p of points) sum += pointValue(p);
  return sum;
}

/**
 * Mean of the `points` array, ignoring non-finite values. Returns `null`
 * when the array is empty or every point is non-finite — the "no data"
 * signal, never fabricated as 0. Mirrors the engine's `gatePassRate`
 * bucket semantics (`ARCH-p4-12 §Metrics engine gatePassRate`).
 */
export function meanPoints(points: readonly SeriesPoint[]): number | null {
  let total = 0;
  let n = 0;
  for (const p of points) {
    const v = pointValueOrNull(p);
    if (v === null) continue;
    total += v;
    n += 1;
  }
  return n > 0 ? total / n : null;
}

/**
 * Sum the `points` of every series in `serieses` that matches
 * `measure`. Convenience wrapper for the per-(measure × dimension)
 * aggregation that `EfficiencyTable` and the Trends panels already
 * duplicate (`#P4-12 review finding #26`).
 */
export function sumMeasure(serieses: readonly Series[], measure: Series["measure"]): number {
  let sum = 0;
  for (const s of serieses) {
    if (s.measure !== measure) continue;
    sum += sumPoints(s.points);
  }
  return sum;
}

/**
 * Mean per-(measure × dimension) across all points in `serieses` whose
 * `measure` matches. `null` for an empty population. Used by
 * `EfficiencyTable.deriveRows` for the per-project `gatePassRate` cell
 * (mean of bucket means — same shape as the engine's `gatePassRate`
 * bucket aggregation).
 */
export function meanMeasure(
  serieses: readonly Series[],
  measure: Series["measure"],
): number | null {
  let total = 0;
  let n = 0;
  for (const s of serieses) {
    if (s.measure !== measure) continue;
    for (const p of s.points) {
      const v = pointValueOrNull(p);
      if (v === null) continue;
      total += v;
      n += 1;
    }
  }
  return n > 0 ? total / n : null;
}
