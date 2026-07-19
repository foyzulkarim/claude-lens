import type { Series } from "../../../../shared/metrics-contract.js";
import type { HourWeekdayCell } from "../../charts/heatmap.js";
import { pointValue } from "../../charts/series-math.js";

const HOURS = 24;
const WEEKDAYS = 7;

/** `Date#getUTCDay()` is Sunday-first (0-6); remaps to Monday-first (0-6). */
function mondayFirstWeekday(timestamp: string): number {
  const sundayFirst = new Date(timestamp).getUTCDay();
  return (sundayFirst + 6) % 7;
}

/**
 * Buckets an hour-grain `Series[]` response into a dense 7×24 grid — every
 * (weekday, hour) combination is always present (summed to `0` when no
 * point falls there), so the heatmap renders a complete grid rather than
 * sparse cells. Sums `pointValue` (never fabricates a *missing* point, but
 * an hour with genuinely zero activity is a real `0` cell — same
 * display-aggregation convention as `calendar.ts`/`ChartCard`'s `bucketTotal`).
 * Reads only the first series in `series` (the panel requests exactly one
 * measure). Never throws on empty or malformed timestamps — an unparseable
 * `t` is skipped rather than crashing the whole grid.
 */
export function bucketHourWeekday(series: Series[]): HourWeekdayCell[] {
  const grid = new Map<string, number>();
  for (let weekday = 0; weekday < WEEKDAYS; weekday++) {
    for (let hour = 0; hour < HOURS; hour++) {
      grid.set(`${weekday}|${hour}`, 0);
    }
  }

  const [primary] = series;
  for (const point of primary?.points ?? []) {
    const parsedMs = Date.parse(point.t);
    if (!Number.isFinite(parsedMs)) continue;
    const weekday = mondayFirstWeekday(point.t);
    const hour = new Date(point.t).getUTCHours();
    const key = `${weekday}|${hour}`;
    grid.set(key, (grid.get(key) ?? 0) + pointValue(point));
  }

  const cells: HourWeekdayCell[] = [];
  for (let weekday = 0; weekday < WEEKDAYS; weekday++) {
    for (let hour = 0; hour < HOURS; hour++) {
      cells.push({ weekday, hour, value: grid.get(`${weekday}|${hour}`) ?? 0 });
    }
  }
  return cells;
}
