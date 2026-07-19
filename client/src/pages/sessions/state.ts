import type {
  DistributionMetricsQuery,
  ScatterMeasure,
  ScatterMetricsQuery,
} from "../../../../shared/metrics-contract.js";
import type { SessionListParams, SessionPageParams } from "../../../../shared/sessions-contract.js";
import type { FilterState } from "../../filters/state.js";
import { resolveRange } from "../../filters/state.js";

// ---------------------------------------------------------------------------
// Page state shape
// ---------------------------------------------------------------------------

/** View toggle for the Sessions page (ARCH A4: pure display state, lives
 * in URL so drill-ins share the same rendered shape). */
export type SessionsBrowserView = "table" | "timeline";

/** Distribution view toggle over the same exact result (ARCH R6). */
export type SessionsDistributionView = "histogram" | "percentiles";

/** Allowlisted scatter presets (ARCH R5). Free-form measure selection is
 * not in scope — the page picks from this list and writes the same
 * xMeasure/yMeasure/sizeMeasure fields underneath. */
export type ScatterPreset = "cost-vs-duration" | "tokens-vs-turns" | "cache-vs-cost";

const SCATTER_PRESETS: ReadonlyArray<{
  id: ScatterPreset;
  x: ScatterMeasure;
  y: ScatterMeasure;
  size?: ScatterMeasure;
  label: string;
}> = [
  { id: "cost-vs-duration", x: "costComputed", y: "wallMinutes", label: "$ × duration" },
  { id: "tokens-vs-turns", x: "totalTokens", y: "turns", label: "tokens × turns" },
  { id: "cache-vs-cost", x: "cacheHitPct", y: "costComputed", label: "cache% × $" },
];

/** List of available scatter presets — exposed for the section's preset
 * buttons (T8) to render in a stable order. */
export function scatterPresets(): readonly { id: ScatterPreset; label: string }[] {
  return SCATTER_PRESETS.map((p) => ({ id: p.id, label: p.label }));
}

/** Resolve a preset id to its xMeasure/yMeasure/sizeMeasure triple. Used
 * by the scatter card's preset button handler. */
export function resolveScatterPreset(id: ScatterPreset): {
  xMeasure: ScatterMeasure;
  yMeasure: ScatterMeasure;
  sizeMeasure?: ScatterMeasure;
} {
  const found = SCATTER_PRESETS.find((p) => p.id === id);
  if (!found) {
    throw new Error(`unknown scatter preset: ${id}`);
  }
  const out: { xMeasure: ScatterMeasure; yMeasure: ScatterMeasure; sizeMeasure?: ScatterMeasure } =
    {
      xMeasure: found.x,
      yMeasure: found.y,
    };
  if (found.size !== undefined) out.sizeMeasure = found.size;
  return out;
}

/** The canonical, parsed Sessions-page state. Every URL-owned field lives
 * here; everything display-only (table-toggle, distribution-toggle) also
 * lives here for permalink parity (ARCH R10).
 *
 * There is no separate "fetch timeline" flag: the list query always
 * requests `include=timeline` alongside the table rows (ARCH R4 — "toggle
 * between table and Gantt/timeline presentations without … refetching the
 * matched population"). A single `browserView` control switches which
 * already-fetched projection is visible; there is nothing else to toggle. */
export interface SessionsPageState {
  /** Sort key + direction. */
  sort: NonNullable<SessionPageParams["sort"]>;
  order: NonNullable<SessionPageParams["order"]>;
  offset: number;
  /** Page row view — table or Gantt toggle. */
  browserView: SessionsBrowserView;
  /** Page-only filter dimensions. */
  minCostComputed?: number;
  maxCostComputed?: number;
  entrypoint?: string[];
  hasDrilldown?: boolean;
  /** Distribution display toggle (histogram vs percentiles). */
  distributionView: SessionsDistributionView;
  /** Active scatter preset — drives xMeasure/yMeasure selection. */
  scatterPreset: ScatterPreset;
  /** Optional size measure on top of the preset. */
  scatterSize?: ScatterMeasure;
  /** Compare hydration — up to 3 session IDs. */
  compareIds: string[];
  /**
   * Selected tag filter (#P4-15). Client-side only — never sent to the
   * server (tags live in local.json, not the transcript-derived
   * population); `SessionBrowser` filters its already-fetched page items
   * by these values. Lives in the URL for permalink parity like every
   * other display-only field here.
   */
  tags?: string[];
}

/** Default page state — what every URL starts from. */
const DEFAULT_STATE: SessionsPageState = {
  sort: "costComputed",
  order: "desc",
  offset: 0,
  browserView: "table",
  distributionView: "histogram",
  scatterPreset: "cost-vs-duration",
  compareIds: [],
};

const ALLOWED_PAGE_SORT: ReadonlySet<NonNullable<SessionPageParams["sort"]>> = new Set([
  "lastAt",
  "costComputed",
  "costObserved",
  "durationMs",
  "totalTokens",
  "turnCount",
  "cacheHitPct",
  "cacheSavingsComputed",
  "maxTurnCostComputed",
  "gateScore",
  "branch",
  "version",
]);

// Type-narrowed Sets keyed on string — `NonNullable<SessionPageParams["sort"]>`
// is a type, not a value, so we keep the runtime set typed as string and
// narrow at the call site. `browserView` and `distributionView` are
// two-literal unions checked inline in the parser instead (no Set needed).
const ALLOWED_ORDER = new Set<string>(["asc", "desc"]);
const ALLOWED_SCATTER_PRESET = new Set<string>([
  "cost-vs-duration",
  "tokens-vs-turns",
  "cache-vs-cost",
]);

/** Hard cap on compare IDs (server-validated; client side mirrors it
 * so the user can't even author a URL with four). */
const COMPARE_ID_MAX = 3;

// ---------------------------------------------------------------------------
// Page-state query keys (single source of truth — keeps the parser and
// serializer in lockstep with the same key list)
// ---------------------------------------------------------------------------

const PAGE_QUERY_KEYS = [
  "sort",
  "order",
  "offset",
  "view",
  "include",
  "minCostComputed",
  "maxCostComputed",
  "entrypoint",
  "hasDrilldown",
  "distView",
  "scatter",
  "scatterSize",
  "compare",
  "tags",
] as const;

type PageQueryKey = (typeof PAGE_QUERY_KEYS)[number];

function isPageKey(key: string): key is PageQueryKey {
  return (PAGE_QUERY_KEYS as readonly string[]).includes(key);
}

/** True iff the URL key is page-owned (not global). Sessions-page state
 * lives entirely under these keys — everything else is either a global
 * filter or out-of-scope URL noise that gets ignored. */
export function isPageOwnedKey(key: string): boolean {
  return isPageKey(key);
}

/** Returns the page-owned keys list — useful for tests and for any future
 * "list all page keys" iteration. */
export function pageOwnedKeys(): readonly PageQueryKey[] {
  return PAGE_QUERY_KEYS;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** Round-trip every page-owned URL key into a `SessionsPageState`. Unknown
 * values fall back to documented defaults so a bad pasted URL degrades to
 * a usable view rather than breaking. Never throws. */
export function parseSessionsPageState(search: string): SessionsPageState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);

  const sort = params.get("sort");
  const order = params.get("order");
  const view = params.get("view");
  const distView = params.get("distView");
  const scatter = params.get("scatter");
  const scatterSize = params.get("scatterSize");

  const state: SessionsPageState = {
    ...DEFAULT_STATE,
    sort:
      sort && ALLOWED_PAGE_SORT.has(sort as NonNullable<SessionPageParams["sort"]>)
        ? (sort as NonNullable<SessionPageParams["sort"]>)
        : DEFAULT_STATE.sort,
    order:
      order && ALLOWED_ORDER.has(order as NonNullable<SessionPageParams["order"]>)
        ? (order as NonNullable<SessionPageParams["order"]>)
        : DEFAULT_STATE.order,
    offset: clampOffset(parseIntOrZero(params.get("offset"))),
    browserView: view === "table" || view === "timeline" ? view : DEFAULT_STATE.browserView,
    distributionView:
      distView === "histogram" || distView === "percentiles"
        ? distView
        : DEFAULT_STATE.distributionView,
    scatterPreset:
      scatter && ALLOWED_SCATTER_PRESET.has(scatter as ScatterPreset)
        ? (scatter as ScatterPreset)
        : DEFAULT_STATE.scatterPreset,
  };

  // Cost bounds — both finite non-negative numbers, min ≤ max when both set.
  const min = parsePositiveNumber(params.get("minCostComputed"));
  const max = parsePositiveNumber(params.get("maxCostComputed"));
  if (min !== undefined) state.minCostComputed = min;
  if (max !== undefined) state.maxCostComputed = max;
  if (min !== undefined && max !== undefined && min > max) {
    // Contradiction — drop both, fall back to defaults.
    delete state.minCostComputed;
    delete state.maxCostComputed;
  }

  // Entrypoint CSV.
  const entrypoint = params.get("entrypoint");
  if (entrypoint) {
    const items = entrypoint
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    if (items.length > 0) state.entrypoint = items;
  }

  // hasDrilldown — strict true/false.
  const hasDrilldown = params.get("hasDrilldown");
  if (hasDrilldown === "true") state.hasDrilldown = true;
  else if (hasDrilldown === "false") state.hasDrilldown = false;

  // Scatter size — accept any non-empty string; type-level guard lives in
  // the query builder below (server validates the actual Measure list).
  if (scatterSize && scatterSize.length > 0) state.scatterSize = scatterSize as ScatterMeasure;

  // Compare IDs — CSV, unique, capped at COMPARE_ID_MAX.
  const compare = params.get("compare");
  if (compare) {
    const items = compare
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    const unique = [...new Set(items)];
    state.compareIds = unique.slice(0, COMPARE_ID_MAX);
  }

  // Tags CSV (#P4-15) — client-side filter only, same shape as entrypoint.
  const tags = params.get("tags");
  if (tags) {
    const items = tags
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    if (items.length > 0) state.tags = items;
  }

  return state;
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/** Canonical encoder for the page state. Defaults are omitted so an
 * untouched page URL stays clean (`/sessions?view=page` rather than
 * `/sessions?view=page&sort=costComputed&order=desc&offset=0&...`). Stable
 * key order for tests. Returns the body of a query string (no leading
 * `?`). */
export function serializeSessionsPageState(state: SessionsPageState): string {
  const params = new URLSearchParams();

  if (state.sort !== DEFAULT_STATE.sort) params.set("sort", state.sort);
  if (state.order !== DEFAULT_STATE.order) params.set("order", state.order);
  if (state.offset !== DEFAULT_STATE.offset) params.set("offset", String(state.offset));
  if (state.browserView !== DEFAULT_STATE.browserView) params.set("view", state.browserView);
  if (state.minCostComputed !== undefined) {
    params.set("minCostComputed", String(state.minCostComputed));
  }
  if (state.maxCostComputed !== undefined) {
    params.set("maxCostComputed", String(state.maxCostComputed));
  }
  if (state.entrypoint && state.entrypoint.length > 0) {
    params.set("entrypoint", [...state.entrypoint].sort().join(","));
  }
  if (state.hasDrilldown !== undefined) {
    params.set("hasDrilldown", state.hasDrilldown ? "true" : "false");
  }
  if (state.distributionView !== DEFAULT_STATE.distributionView) {
    params.set("distView", state.distributionView);
  }
  if (state.scatterPreset !== DEFAULT_STATE.scatterPreset) {
    params.set("scatter", state.scatterPreset);
  }
  if (state.scatterSize !== undefined) params.set("scatterSize", state.scatterSize);
  if (state.compareIds.length > 0) {
    params.set("compare", [...state.compareIds].sort().join(","));
  }
  if (state.tags && state.tags.length > 0) {
    params.set("tags", [...state.tags].sort().join(","));
  }

  return params.toString();
}

// ---------------------------------------------------------------------------
// Query builders
// ---------------------------------------------------------------------------

/**
 * Maps the canonical state + global `FilterState` to the Sessions list
 * (page projection) query. The resolved range and categorical filters
 * come from the global `FilterState`; page-only filters (cost bounds,
 * entrypoint, drilldown, compare) come from the page state. The shared
 * `SessionPopulationFilter` is the destination contract (ARCH A2 single
 * population).
 */
export function buildListQuery(
  state: SessionsPageState,
  filters: FilterState,
  now: Date,
): Omit<SessionPageParams, "view"> {
  const range = resolveRange(filters.range, now);
  const out: Omit<SessionPageParams, "view"> = {
    sort: state.sort,
    order: state.order,
    offset: state.offset,
    limit: 25,
    from: range.from,
    to: range.to,
    // The timeline projection is always requested alongside the table
    // rows (ARCH R4): switching `browserView` must never trigger a
    // refetch, so both projections come back from the same response.
    include: "timeline",
  };
  if (filters.project.length > 0) out.project = [...filters.project].sort();
  if (filters.model.length > 0) out.model = [...filters.model].sort();
  if (filters.branch.length > 0) out.branch = [...filters.branch].sort();
  if (filters.host.length > 0) out.host = [...filters.host].sort();
  if (state.entrypoint && state.entrypoint.length > 0) {
    out.entrypoint = [...state.entrypoint].sort();
  }
  if (state.minCostComputed !== undefined) out.minCostComputed = state.minCostComputed;
  if (state.maxCostComputed !== undefined) out.maxCostComputed = state.maxCostComputed;
  if (state.hasDrilldown !== undefined) out.hasDrilldown = state.hasDrilldown;
  if (state.compareIds.length > 0) out.sessionId = [...state.compareIds].sort();
  return out;
}

/** Builds the session-distribution metrics query (cost histogram /
 * percentiles) — reuses the same resolved range + population criteria as
 * the list query (ARCH A2 single population, A3 distributions). */
export function buildDistributionQuery(
  state: SessionsPageState,
  filters: FilterState,
  now: Date,
): DistributionMetricsQuery {
  const range = resolveRange(filters.range, now);
  const sessionPopulation = buildSessionPopulation(state, filters);
  return {
    measures: ["costComputed"],
    dimensions: [],
    grain: "day",
    range,
    mode: "distribution",
    distributionEntity: "session",
    sessionPopulation,
  };
}

/** Builds the scatter metrics query for the active preset. */
export function buildScatterQuery(
  state: SessionsPageState,
  filters: FilterState,
  now: Date,
): ScatterMetricsQuery {
  const range = resolveRange(filters.range, now);
  const { xMeasure, yMeasure, sizeMeasure } = resolveScatterPreset(state.scatterPreset);
  const sessionPopulation = buildSessionPopulation(state, filters);
  const query: ScatterMetricsQuery = {
    mode: "scatter",
    entity: "session",
    measures: [xMeasure, yMeasure, ...(sizeMeasure !== undefined ? [sizeMeasure] : [])],
    dimensions: [],
    grain: "day",
    range,
    xMeasure,
    yMeasure,
    sessionPopulation,
  };
  // Scatter size: explicit user override wins over the preset's default.
  if (state.scatterSize !== undefined) query.sizeMeasure = state.scatterSize;
  return query;
}

/**
 * Build the canonical `SessionPopulationCriteria` (metrics-query shape)
 * from page state + global filters. Used by distribution + scatter queries
 * — one helper so the population is identical across sections.
 */
function buildSessionPopulation(
  state: SessionsPageState,
  filters: FilterState,
): import("../../../../shared/sessions-contract.js").SessionPopulationCriteria {
  const pop: import("../../../../shared/sessions-contract.js").SessionPopulationCriteria = {};
  if (filters.project.length > 0) pop.project = [...filters.project].sort();
  if (filters.model.length > 0) pop.model = [...filters.model].sort();
  if (filters.branch.length > 0) pop.branch = [...filters.branch].sort();
  if (filters.host.length > 0) pop.host = [...filters.host].sort();
  if (state.entrypoint && state.entrypoint.length > 0) {
    pop.entrypoint = [...state.entrypoint].sort();
  }
  if (state.minCostComputed !== undefined) pop.minCostComputed = state.minCostComputed;
  if (state.maxCostComputed !== undefined) pop.maxCostComputed = state.maxCostComputed;
  if (state.hasDrilldown !== undefined) pop.hasDrilldown = state.hasDrilldown;
  return pop;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseIntOrZero(value: string | null): number {
  if (value === null || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return 0;
  return n;
}

function clampOffset(value: number): number {
  // Sessions-page offset is bounded by `SESSIONS_MAX_LIMIT` indirectly
  // (the server caps limit and rejects negatives). We clamp negatives and
  // non-integers but allow arbitrarily large offsets — the server returns
  // an empty page slice for `offset > total`, which is the documented
  // pagination behavior.
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) return 0;
  return value;
}

function parsePositiveNumber(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/** Sentinel export — exports the canonical default state for unit tests
 * and any future "reset" UX. */
export const DEFAULT_SESSIONS_PAGE_STATE: SessionsPageState = DEFAULT_STATE;

/** Re-export of `SessionListParams` for components that need the compact
 * projection (none today, but the type is here so downstream code can
 * import it from one module). */
export type { SessionListParams };
