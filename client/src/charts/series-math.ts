import type { SeriesPoint } from "../../../shared/metrics-contract.js";

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
