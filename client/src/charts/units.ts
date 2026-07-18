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
