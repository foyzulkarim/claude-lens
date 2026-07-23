// Number / currency / percentage formatters for the Data Health page.
// All formatters return strings; the page renders them verbatim. No
// side effects, no module-level state — these are pure helpers so
// stories can call them directly without mounting the page.

/** `$1.23`, `$0.00`, `$1.2k`, `$3.4M` — abbreviated at the high end. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "$0.00";
  if (Math.abs(value) < 0.01) return "<$0.01";
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(2)}`;
}

/** `42`, `1.2k`, `3.4M` — no currency, integer-ish at small scale. */
export function formatInt(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value < 1_000) return value.toLocaleString("en-US");
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/** `12.5%` — one decimal. */
export function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

/** Render the basename of a file path so absolute paths from
 *  the store don't leak the user's home layout into the page. */
export function basename(filePath: string): string {
  const last = filePath.split("/").pop();
  return last && last.length > 0 ? last : filePath;
}
