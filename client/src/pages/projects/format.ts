/**
 * Display formatters used by the Projects page's panels. Kept co-located
 * with the page directory (rather than in `client/src/charts/units.ts`)
 * because:
 *
 *   1. These are Projects-specific — `lastActiveFrom` is a relative-time
 *      helper no other page currently uses, and the cached `Intl.NumberFormat`
 *      instances below pair with the ratio helpers the page derives
 *      client-side (cache% + gate stub).
 *   2. Pages across the dashboard already own tiny `format.ts` files
 *      (`dashboard/format.ts`, `session-detail/format.ts`) — Projects
 *      joining that pattern keeps the convention consistent.
 *
 * No React, no router imports — pure functions so the page's
 * Storybook stories and Vitest suite can pin behavior without
 * mounting a wouter tree.
 */

// `Intl.NumberFormat` instances are cached at module load so every
// table cell doesn't pay the formatter-construction cost. Mirrors the
// same pattern in `charts/units.ts` and `models/EfficiencyTable.tsx`.

const CURRENCY_FORMAT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COMPACT_INT_FORMAT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const INTEGER_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const PERCENT_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Two-decimal USD cell. Returns `—` for non-finite / null so the
 * efficiency table's `$/session` column renders an honest placeholder
 * instead of `"$NaN"` or `"$0.00"`. */
export function formatCurrency(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? CURRENCY_FORMAT.format(value) : "—";
}

/** Compact token count, e.g. `96k`, `1.2M`. `—` for non-finite. */
export function formatCompactTokens(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? COMPACT_INT_FORMAT.format(value)
    : "—";
}

/** Whole-number count, e.g. `1,234`. `—` for non-finite. */
export function formatCount(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? INTEGER_FORMAT.format(value) : "—";
}

/** Converts a fraction in `[0, 1]` to a `12.3%` style string. `null` →
 * `—` so the cache% cell and the gate stub cell render the same
 * placeholder. */
export function formatPercentFraction(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${PERCENT_FORMAT.format(value * 100)}%`
    : "—";
}

/**
 * Relative-time helper for the efficiency table's `last active` column
 * and the branch breakdown's per-branch label. Matches the spec's
 * "Nd ago" / "Nh ago" / "just now" convention; falls back to `—` when
 * the timestamp doesn't parse (a real shape — `parse-transcript.ts`'s
 * `toStr()` coerces a missing/bad field to `""`).
 *
 * `now` is injected so Storybook stories and the test can pin a
 * deterministic instant; production callers pass nothing.
 */
export function lastActiveFrom(timestamp: string | undefined, now: Date = new Date()): string {
  if (!timestamp) return "—";
  const t = Date.parse(timestamp);
  if (!Number.isFinite(t)) return "—";

  const diffMs = now.getTime() - t;
  // Negative deltas (timestamp in the future) render as `"just now"` —
  // a real transcript can carry a clock-skewed `timestamp` value that
  // lands ahead of the wall clock, and showing `"-12m ago"` is more
  // confusing than the honest "the clock is off" stub.
  if (diffMs < 0) return "just now";

  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;

  const diffMonth = Math.round(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo ago`;

  const diffYear = Math.round(diffDay / 365);
  return `${diffYear}y ago`;
}
