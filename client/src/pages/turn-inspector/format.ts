/** Format a USD value — "—" for null/undefined so a missing value never
 * silently renders as $0.00 (mirrors session-detail/format.ts). */
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

/** Format a 0..100 percentile as "pNN". */
export function formatPercentile(value: number | null): string {
  if (value === null) return "—";
  return `p${Math.round(value)}`;
}

/** Format a duration in milliseconds as a compact "Xm Ys" / "Xs" string. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

/** Short id (first 8 chars) — mirrors session-detail's drill-back chip convention. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}
