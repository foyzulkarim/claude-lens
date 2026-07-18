import { addDays, addHours, addMonths, addWeeks } from "date-fns";
import type { Grain } from "../../../shared/metrics-contract.js";
import type { ChipDimension, FilterState } from "../filters/state.js";

// The single source of truth for time-bucket → Sessions drill URLs.
// Originally a private helper inside `ChartCard.tsx`; extracted here so
// Cache Lab's hit-rate panel (and any future chart card) shares the
// exact same permalink semantics (decision A10) — a single-day bucket
// drills to `from = to = dayStart`, every other grain drills to
// `[from, nextBucketStart)`. No JSX, no React, no router imports —
// pure URL construction so Storybook and unit tests can pin behavior
// without mounting a wouter tree.

function bucketEnd(timestamp: string, grain: Grain): string {
  const start = new Date(timestamp);
  switch (grain) {
    case "hour":
      return addHours(start, 1).toISOString();
    case "day":
      return addDays(start, 1).toISOString();
    case "week":
      return addWeeks(start, 1).toISOString();
    case "month":
      return addMonths(start, 1).toISOString();
    default: {
      const unhandled: never = grain;
      throw new Error(`unhandled grain: ${unhandled}`);
    }
  }
}

/** Builds the `/sessions?from=...&to=...&chip=...` URL a chart bucket
 * drills into. Preserves the four global chip filters (project/model/
 * branch/host) in sorted CSV form, then replaces the date range with
 * the clicked bucket's boundaries. Single-day buckets drill to a
 * point (`from = to = dayStart`); other grains span `[from, nextStart)`.
 */
export function sessionsHrefForBucket(
  timestamp: string,
  grain: Grain,
  filters: FilterState,
): string {
  const params = new URLSearchParams();

  // Preserve categorical chip filters in sorted CSV form so two clicks
  // on the same bucket with the same chip set produce the same URL.
  const chipDimensions: ChipDimension[] = ["project", "model", "branch", "host"];
  for (const chip of chipDimensions) {
    if (filters[chip].length > 0) {
      params.set(chip, [...filters[chip]].sort().join(","));
    }
  }

  // Replace date range with the bucket's boundaries. Day grain drills
  // to from = to = bucketStart (a "view this day's sessions" point).
  // All other grains span [from, nextBucketStart).
  const from = timestamp;
  const to = grain === "day" ? from : bucketEnd(timestamp, grain);

  params.set("from", from);
  params.set("to", to);

  return `/sessions?${params.toString()}`;
}
