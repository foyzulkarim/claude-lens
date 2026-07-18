import type { Dimension, MetricsQuery } from "../../../shared/metrics-contract.js";

/**
 * The pure URL ↔ state core of the global filter bar (architecture §11,
 * plan #P3-3). Every function here is side-effect-free — no `window`, no
 * wouter — so the URL is the only place filter state actually lives
 * (decision A1): components re-derive it from the query string every render
 * instead of holding a parallel copy that could drift.
 */

export type RangePreset = "1d" | "7d" | "30d" | "90d";
const RANGE_PRESETS: ReadonlySet<RangePreset> = new Set(["1d", "7d", "30d", "90d"]);
const DEFAULT_RANGE: { preset: RangePreset } = { preset: "7d" };

function isRangePreset(value: string): value is RangePreset {
  return RANGE_PRESETS.has(value as RangePreset);
}

/** The four chip dimensions exposed by the URL (decision A4: `branch` is the
 * URL's clean name for the contract's `gitBranch` dimension). Single source
 * of truth for both `useFilters` (URL keys) and `useFacets` (breakdown
 * queries) so the two never drift out of sync. */
export type ChipDimension = "project" | "model" | "branch" | "host";

export const CHIP_DIMENSION: Record<ChipDimension, Dimension> = {
  project: "project",
  model: "model",
  branch: "gitBranch",
  host: "host",
};

export type FilterRange = { preset: RangePreset } | { from: string; to: string };

export interface FilterState {
  range: FilterRange;
  project: string[];
  model: string[];
  branch: string[];
  host: string[];
}

function isParseableDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function parseChip(params: URLSearchParams, key: string): string[] {
  const raw = params.get(key);
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .sort();
}

function parseRange(params: URLSearchParams): FilterRange {
  const from = params.get("from");
  const to = params.get("to");
  if (from !== null && to !== null) {
    if (isParseableDate(from) && isParseableDate(to) && Date.parse(from) <= Date.parse(to)) {
      return { from, to };
    }
    return DEFAULT_RANGE;
  }

  const preset = params.get("range");
  if (preset !== null && isRangePreset(preset)) {
    return { preset };
  }

  return DEFAULT_RANGE;
}

/** Decodes a URL query string (with or without a leading `?`) into a `FilterState`. Never throws — unknown params and malformed values fall back to defaults so a bad pasted URL degrades gracefully rather than breaking the view. */
export function parseFilters(search: string): FilterState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    range: parseRange(params),
    project: parseChip(params, "project"),
    model: parseChip(params, "model"),
    branch: parseChip(params, "branch"),
    host: parseChip(params, "host"),
  };
}

/** Encodes a `FilterState` back into a query string (no leading `?`). Omits the default range and empty chips so an unfiltered view serializes to `""` — clean permalinks for the common case. */
export function serializeFilters(state: FilterState): string {
  const params = new URLSearchParams();

  if ("preset" in state.range) {
    if (state.range.preset !== DEFAULT_RANGE.preset) {
      params.set("range", state.range.preset);
    }
  } else {
    params.set("from", state.range.from);
    params.set("to", state.range.to);
  }

  for (const key of ["project", "model", "branch", "host"] as const) {
    const values = state[key];
    if (values.length > 0) params.set(key, [...values].sort().join(","));
  }

  return params.toString();
}

/** Global-owned URL keys that `mergeGlobalFilters` knows how to patch
 * (ARCH A7, R10). Single source of truth — the merge function below and
 * any future "what is global?" question both read this constant. Sessions
 * state (`sort`, `order`, `offset`, `limit`, `view`, `entrypoint`,
 * `minCostComputed`, `maxCostComputed`, `hasDrilldown`, `gateStatus`,
 * `sessionId`, `include`) is NOT globally owned and the merge preserves
 * it verbatim. */
export const GLOBAL_FILTER_KEYS = [
  "range",
  "from",
  "to",
  "project",
  "model",
  "branch",
  "host",
] as const;
export type GlobalFilterKey = (typeof GLOBAL_FILTER_KEYS)[number];

/**
 * Patches only the global-owned URL keys (`range`/`from`/`to`/`project`/
 * `model`/`branch`/`host`) onto the existing search string while preserving
 * every other key (ARCH A7, decision R10).
 *
 * Pre-fix: `useFilters.commit` called `navigate("?" + serializeFilters(next))`,
 * which DROPPED every Sessions-owned URL key on every FilterBar change —
 * a Dashboard drill-in to `/sessions?from=...&to=...&view=page` would
 * silently lose `view=page` the moment the user clicked a chip. Post-fix:
 * callers pass the existing search string in, this function replaces only
 * the owned keys, and Sessions state survives (the `#P4-4` Sessions page
 * already parses both layers out of `useSearch()`).
 *
 * Pure: never mutates the input. Returns a canonical query string ready for
 * `navigate("?" + merged)`. Empty after patch → `""` (the empty search,
 * not a `"?"`).
 */
export function mergeGlobalFilters(search: string, next: FilterState): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);

  // Replace owned global keys. Drop empty chip values (canonical URL form).
  for (const key of GLOBAL_FILTER_KEYS) {
    params.delete(key);
  }

  if ("preset" in next.range) {
    if (next.range.preset !== DEFAULT_RANGE.preset) {
      params.set("range", next.range.preset);
    }
  } else {
    params.set("from", next.range.from);
    params.set("to", next.range.to);
  }

  for (const key of ["project", "model", "branch", "host"] as const) {
    const values = next[key];
    if (values.length > 0) params.set(key, [...values].sort().join(","));
  }

  return params.toString();
}

const PRESET_DAYS: Record<RangePreset, number> = { "1d": 1, "7d": 7, "30d": 30, "90d": 90 };

/** Resolves a preset to concrete ISO instants relative to `now`; a custom range passes through unchanged. Presets are resolved client-side per architecture §8. */
export function resolveRange(range: FilterRange, now: Date): { from: string; to: string } {
  if (!("preset" in range)) return range;

  const days = PRESET_DAYS[range.preset];
  const to = now;
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Shapes a `FilterState` into the `{range, filters}` fragment a `MetricsQuery` needs — resolves the range, remaps the URL's `branch` name to the contract's `gitBranch` dimension (decision A4), and drops empty-array chips (the server rejects empty-array filter values). */
export function filtersToQuery(
  state: FilterState,
  now: Date,
): Pick<MetricsQuery, "range" | "filters"> {
  const filters: Partial<Record<Dimension, string[]>> = {};
  for (const key of ["project", "model", "branch", "host"] as const) {
    const values = state[key];
    if (values.length > 0) filters[CHIP_DIMENSION[key]] = values;
  }

  return { range: resolveRange(state.range, now), filters };
}
