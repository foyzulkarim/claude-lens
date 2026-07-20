import type { SessionDetailHeader } from "../../../../shared/session-detail-contract.js";

/** Format a USD value at the same precision the dashboard uses — never
 * fabricated as 0 when the underlying number is "unavailable" (`undefined`).
 * For Session Detail, undefined is rendered as "—" (em dash) so the page
 * never lies about a value the server withheld. */
export function formatCost(value: number | undefined | null): string {
  if (value === undefined || value === null) return "—";
  if (value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

/** Format a token count at the dashboard's standard 3-sig-fig resolution. */
export function formatTokens(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

/** Format a 0..1 ratio as a percent. Returns "—" when undefined so a missing
 * context estimate never renders as 0%. */
export function formatPercent(value: number | undefined | null): string {
  if (value === undefined || value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

/** Format a tier label for the page chrome — "$ computed" matches the
 * dashboard's cost-tier treatment (T9), with "$ observed" reserved for the
 * post-#P4-13 state. */
export function formatCostBasis(tier: SessionDetailHeader["tier"]): string {
  if (tier.costBasis === "observed") return "$ observed";
  return "$ computed";
}

/** Render the "vs your median" delta — when the fleet baseline has fewer
 * than two entries, return "—" rather than fabricating a comparison.
 * Otherwise show `+12%` / `-8%` style deltas vs the fleet median. */
export function formatMedianDelta(
  header: Pick<SessionDetailHeader, "costComputed" | "fleetCostMedian">,
): string {
  if (header.fleetCostMedian === null || header.fleetCostMedian === undefined) return "—";
  if (header.fleetCostMedian === 0) return "—";
  const delta = (header.costComputed - header.fleetCostMedian) / header.fleetCostMedian;
  const pct = Math.round(delta * 100);
  if (pct === 0) return "at median";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct}% vs median`;
}

/** Short id (first 8 chars) — mirrors the dashboard's session-id chip
 * convention so drill-back links read consistently across pages. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Format a duration in ms as ms/s, or "—" when unavailable (#P4-13). Used by
 * the observed api-vs-wall timing column, which the server only supplies with
 * premium capture. */
export function formatDurationMs(value: number | undefined | null): string {
  if (value === undefined || value === null) return "—";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

/** Render an observed line delta as `+A/−R`, or "—" when neither is available
 * (transcript-only turns). A present-but-zero delta still renders `+0/−0`
 * (measured), never "—" (unavailable). (#P4-13) */
export function formatLineDelta(added?: number, removed?: number): string {
  if (added === undefined && removed === undefined) return "—";
  return `+${added ?? 0}/−${removed ?? 0}`;
}

/** True if the Session Detail page has an honest "premium data missing"
 * state to surface — at minimum the cost-observed fields aren't available.
 * The page renders a single tier banner explaining what's absent. */
export function isPremiumUnavailable(header: Pick<SessionDetailHeader, "tier" | "drift">): boolean {
  return header.drift === undefined;
}
