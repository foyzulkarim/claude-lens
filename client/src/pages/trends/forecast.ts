import type { SeriesPoint } from "../../../../shared/metrics-contract.js";
import type { MonthForecast } from "../../charts/forecast.js";
import { pointValue } from "../../charts/series-math.js";

const MIN_DAYS_FOR_PROJECTION = 3;
const EWMA_ALPHA = 0.3;
/** Floor the band spread at 5% of the projected value so a near-zero-variance start-of-month doesn't render an invisible band (Open Question suggested default). */
const MIN_BAND_SPREAD_PCT = 0.05;

export function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function daysInUtcMonth(now: Date): number {
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return (monthEnd.getTime() - utcMonthStart(now).getTime()) / (24 * 60 * 60 * 1000);
}

function ewmaDailyRate(dailyValues: number[]): number {
  if (dailyValues.length === 0) return 0;
  let ewma = dailyValues[0];
  for (let i = 1; i < dailyValues.length; i++) {
    ewma = EWMA_ALPHA * dailyValues[i] + (1 - EWMA_ALPHA) * ewma;
  }
  return ewma;
}

function sampleStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** First UTC-midnight ISO date `daysFromNow` days after `now`. */
function isoDateOffset(now: Date, daysFromNow: number): string {
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(base + daysFromNow * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * First day (1-indexed into the remaining-days window) the linear
 * trajectory from `mtd` to `endpointValue` reaches `budget`, or `null` if it
 * never does within `remainingDays`.
 */
function firstDayCrossing(
  mtd: number,
  endpointValue: number,
  remainingDays: number,
  budget: number,
): number | null {
  if (remainingDays <= 0) return null;
  const perDay = (endpointValue - mtd) / remainingDays;
  if (perDay <= 0) return null;
  for (let day = 1; day <= remainingDays; day++) {
    if (mtd + perDay * day >= budget) return day;
  }
  return null;
}

export interface ComputeForecastOptions {
  now: Date;
  method: "linear" | "ewma";
  budget: number | null;
}

/**
 * `points` is one point per day of the current UTC month, ascending,
 * month-to-date only (the panel's own query already scopes the range —
 * this function does no date filtering of its own).
 */
export function computeForecast(
  points: SeriesPoint[],
  { now, method, budget }: ComputeForecastOptions,
): MonthForecast {
  const values = points.map((point) => pointValue(point));
  const mtd = values.reduce((sum, v) => sum + v, 0);
  const daysInMonth = daysInUtcMonth(now);
  const elapsedDays = values.length;
  const remainingDays = Math.max(0, daysInMonth - elapsedDays);

  if (elapsedDays < MIN_DAYS_FOR_PROJECTION) {
    return {
      mtd,
      method,
      projectedEndOfMonth: null,
      bandLow: null,
      bandHigh: null,
      budget,
      crossesBudgetAt: null,
    };
  }

  const linearRate = mtd / elapsedDays;
  const ewmaRate = ewmaDailyRate(values);
  const rate = method === "linear" ? linearRate : ewmaRate;
  const projectedEndOfMonth = mtd + rate * remainingDays;

  const dailyStdDev = sampleStdDev(values);
  const rawSpread = dailyStdDev * Math.sqrt(remainingDays);
  const minSpread = projectedEndOfMonth * MIN_BAND_SPREAD_PCT;
  const spread = Math.max(rawSpread, minSpread);

  const bandLow = Math.max(0, projectedEndOfMonth - spread);
  const bandHigh = projectedEndOfMonth + spread;

  let crossesBudgetAt: string | null = null;
  if (budget !== null && bandHigh > budget) {
    const crossingDay = firstDayCrossing(mtd, bandHigh, remainingDays, budget);
    if (crossingDay !== null) crossesBudgetAt = isoDateOffset(now, crossingDay);
  }

  return { mtd, method, projectedEndOfMonth, bandLow, bandHigh, budget, crossesBudgetAt };
}
