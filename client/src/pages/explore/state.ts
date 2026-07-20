import type {
  Dimension,
  DistributionEntity,
  DistributionMetricsQuery,
  Grain,
  Measure,
  MetricsQuery,
  ScatterMeasure,
  ScatterMetricsQuery,
  SeriesMetricsQuery,
} from "../../../../shared/metrics-contract.js";
import { DIMENSIONS, GRAINS, MEASURES } from "../../../../shared/metrics-contract.js";
import type { SessionPopulationCriteria } from "../../../../shared/sessions-contract.js";

/**
 * Pure URL ↔ state core of the Explore page (ARCH-explore-page.md).
 *
 * The pivot state lives entirely in the URL query string under an `xp.*`
 * key prefix so it composes with the existing global filter bar (range,
 * project, model, branch, host) and produces shareable permalinks. Every
 * function here is side-effect-free — no `window`, no wouter, no React —
 * so the URL is the only place pivot state actually lives (mirror of the
 * global filter decision, architecture §11 / decision A1).
 *
 * Three query modes surface via a single `buildPivotQuery` dispatcher:
 *   • chart=scatter        → ScatterMetricsQuery
 *   • mode=series          → SeriesMetricsQuery
 *   • mode=distribution    → DistributionMetricsQuery
 *
 * The chart-type union (`bar`/`line`/`area`/`scatter`/`table`) is purely
 * a UI rendering choice — the engine returns the same `Series[]` for the
 * non-scatter chart types; `table` is a client-side render of the same
 * dimension-grouped data.
 */

export const PIVOT_KEY_PREFIX = "xp.";

export type PivotChart = "bar" | "line" | "area" | "scatter" | "table";
export type PivotMode = "series" | "distribution";

export const PIVOT_CHARTS: readonly PivotChart[] = ["bar", "line", "area", "scatter", "table"];
export const PIVOT_MODES: readonly PivotMode[] = ["series", "distribution"];

const CHART_SET: ReadonlySet<PivotChart> = new Set(PIVOT_CHARTS);
const MODE_SET: ReadonlySet<PivotMode> = new Set(PIVOT_MODES);
const ENTITY_SET: ReadonlySet<DistributionEntity> = new Set(["session", "turn", "call"]);

/**
 * Default pivot configuration — what the page lands on when no `xp.*` keys
 * are present in the URL. Chosen to be the most useful out-of-the-gate
 * (cost by tool, daily bars — matches the explore.html mockup's first
 * panel).
 */
export const DEFAULT_PIVOT: PivotState = {
  measure: "costComputed",
  dim: "tool",
  grain: "day",
  chart: "bar",
  mode: "series",
  entity: "session",
  x: "costComputed",
  y: "wallMinutes",
};

/** Decoded form of the `xp.*` URL keys. `size` is optional (scatter only). */
export interface PivotState {
  measure: Measure;
  dim: Dimension;
  grain: Grain;
  chart: PivotChart;
  mode: PivotMode;
  entity: DistributionEntity;
  x: ScatterMeasure;
  y: ScatterMeasure;
  size?: ScatterMeasure;
}

function isChart(value: string): value is PivotChart {
  return CHART_SET.has(value as PivotChart);
}

function isMode(value: string): value is PivotMode {
  return MODE_SET.has(value as PivotMode);
}

function isEntity(value: string): value is DistributionEntity {
  return ENTITY_SET.has(value as DistributionEntity);
}

/**
 * The scatter-only `totalTokens` preset is a valid `ScatterMeasure` but
 * not a `Measure` (see metrics-contract `ScatterMeasure`). Accept it
 * alongside the standard measures when validating URL input.
 */
function isScatterMeasure(value: string): value is ScatterMeasure {
  if (value === "totalTokens") return true;
  return (MEASURES as readonly string[]).includes(value);
}

/**
 * Decodes the URL query string into a PivotState. Never throws — unknown
 * values fall back to defaults so a bad pasted URL degrades gracefully
 * rather than breaking the view (mirrors `parseFilters`).
 */
export function parsePivotState(search: string): PivotState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);

  const measureRaw = params.get(`${PIVOT_KEY_PREFIX}measure`);
  const dimRaw = params.get(`${PIVOT_KEY_PREFIX}dim`);
  const grainRaw = params.get(`${PIVOT_KEY_PREFIX}grain`);
  const chartRaw = params.get(`${PIVOT_KEY_PREFIX}chart`);
  const modeRaw = params.get(`${PIVOT_KEY_PREFIX}mode`);
  const entityRaw = params.get(`${PIVOT_KEY_PREFIX}entity`);
  const xRaw = params.get(`${PIVOT_KEY_PREFIX}x`);
  const yRaw = params.get(`${PIVOT_KEY_PREFIX}y`);
  const sizeRaw = params.get(`${PIVOT_KEY_PREFIX}size`);

  const measure =
    measureRaw && (MEASURES as readonly string[]).includes(measureRaw)
      ? (measureRaw as Measure)
      : undefined;
  const dim =
    dimRaw && (DIMENSIONS as readonly string[]).includes(dimRaw)
      ? (dimRaw as Dimension)
      : undefined;
  const grain =
    grainRaw && (GRAINS as readonly string[]).includes(grainRaw) ? (grainRaw as Grain) : undefined;
  const chart = chartRaw && isChart(chartRaw) ? chartRaw : undefined;
  const mode = modeRaw && isMode(modeRaw) ? modeRaw : undefined;
  const entity = entityRaw && isEntity(entityRaw) ? entityRaw : undefined;
  const x = xRaw && isScatterMeasure(xRaw) ? xRaw : undefined;
  const y = yRaw && isScatterMeasure(yRaw) ? yRaw : undefined;
  const size = sizeRaw && isScatterMeasure(sizeRaw) ? sizeRaw : undefined;

  return {
    measure: measure ?? DEFAULT_PIVOT.measure,
    dim: dim ?? DEFAULT_PIVOT.dim,
    grain: grain ?? DEFAULT_PIVOT.grain,
    chart: chart ?? DEFAULT_PIVOT.chart,
    mode: mode ?? DEFAULT_PIVOT.mode,
    entity: entity ?? DEFAULT_PIVOT.entity,
    x: x ?? DEFAULT_PIVOT.x,
    y: y ?? DEFAULT_PIVOT.y,
    ...(size ? { size } : {}),
  };
}

/**
 * Encodes a PivotState back into URL keys under the `xp.` prefix. Omits
 * keys that match the default so a default-state pivot serializes to an
 * empty string for that key — clean permalinks.
 */
export function serializePivotState(state: PivotState): string {
  const params = new URLSearchParams();
  if (state.measure !== DEFAULT_PIVOT.measure) {
    params.set(`${PIVOT_KEY_PREFIX}measure`, state.measure);
  }
  if (state.dim !== DEFAULT_PIVOT.dim) {
    params.set(`${PIVOT_KEY_PREFIX}dim`, state.dim);
  }
  if (state.grain !== DEFAULT_PIVOT.grain) {
    params.set(`${PIVOT_KEY_PREFIX}grain`, state.grain);
  }
  if (state.chart !== DEFAULT_PIVOT.chart) {
    params.set(`${PIVOT_KEY_PREFIX}chart`, state.chart);
  }
  if (state.mode !== DEFAULT_PIVOT.mode) {
    params.set(`${PIVOT_KEY_PREFIX}mode`, state.mode);
  }
  if (state.entity !== DEFAULT_PIVOT.entity) {
    params.set(`${PIVOT_KEY_PREFIX}entity`, state.entity);
  }
  if (state.x !== DEFAULT_PIVOT.x) {
    params.set(`${PIVOT_KEY_PREFIX}x`, state.x);
  }
  if (state.y !== DEFAULT_PIVOT.y) {
    params.set(`${PIVOT_KEY_PREFIX}y`, state.y);
  }
  if (state.size) {
    params.set(`${PIVOT_KEY_PREFIX}size`, state.size);
  }
  return params.toString();
}

/**
 * Patch the pivot-owned `xp.*` keys onto an existing search string while
 * preserving every other key (mirror of `mergeGlobalFilters`). Used by the
 * `usePivotState` setters — never call `navigate("?...")` from a setter,
 * always go through this so the global filter keys (range/project/model/
 * branch/host) survive.
 */
export function mergePivotState(search: string, state: PivotState): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);

  // Delete all xp.* keys (any prior pivot keys), then re-set.
  for (const key of Array.from(params.keys())) {
    if (key.startsWith(PIVOT_KEY_PREFIX)) params.delete(key);
  }

  const next = new URLSearchParams(serializePivotState(state));
  for (const [key, value] of next.entries()) {
    params.set(key, value);
  }

  return params.toString();
}

/**
 * Builds the `MetricsQuery` (the discriminated union) for a given pivot +
 * filter context. `filters` is the `{ range, filters }` fragment produced
 * by `filtersToQuery` (filter-bar → metrics shape).
 *
 * Dispatch rules:
 *   • chart=scatter           → ScatterMetricsQuery
 *   • mode=distribution       → DistributionMetricsQuery
 *   • otherwise               → SeriesMetricsQuery
 *
 * The Grain control maps to the `"time"` dimension — every series /
 * distribution query gets `["time", <breakdown>]` so the engine buckets by
 * time (per `query.grain`) and breaks the totals across the selected
 * dimension. This is what makes "any curated chart reproducible" real
 * (ARCH R1) — model-mix-over-time, project-cost-over-day, etc. all
 * derive from the same shape. The breakdown dimension is omitted
 * (dimensions = ["time"]) when the user hasn't picked one yet.
 *
 * For scatter, `sessionPopulation` is built from the same filter context —
 * the engine reconciles it with the query's `range` per the metrics
 * contract.
 */
export function buildPivotQuery(
  state: PivotState,
  filterShape: Pick<MetricsQuery, "range" | "filters">,
): MetricsQuery {
  const { range, filters } = filterShape;

  if (state.chart === "scatter") {
    const scatterQuery: ScatterMetricsQuery = {
      mode: "scatter",
      entity: "session",
      measures: state.size ? [state.x, state.y, state.size] : [state.x, state.y],
      xMeasure: state.x,
      yMeasure: state.y,
      ...(state.size ? { sizeMeasure: state.size } : {}),
      dimensions: [],
      grain: state.grain,
      range,
      filters,
      // sessionPopulation mirrors the metrics-query shape via
      // `Omit<SessionPopulationFilter, "range">` (no range — the query's
      // own `range` is authoritative). The metrics `filters` type widens
      // values to `(string|number)[]` but every dimension value the engine
      // emits at this site is a string, so we narrow back here.
      sessionPopulation: filtersToStringCriteria(filters),
    };
    return scatterQuery;
  }

  // `"time"` is the engine's signal for "bucket by the grain". Adding the
  // optional breakdown dimension on top is what makes the chart a
  // multi-series breakdown instead of a single aggregate line.
  const dimensions: Dimension[] = state.dim === "time" ? ["time"] : ["time", state.dim];

  if (state.mode === "distribution") {
    const distQuery: DistributionMetricsQuery = {
      mode: "distribution",
      measures: [state.measure],
      dimensions,
      distributionEntity: state.entity,
      grain: state.grain,
      range,
      ...(filters ? { filters } : {}),
    };
    return distQuery;
  }

  const seriesQuery: SeriesMetricsQuery = {
    mode: "series",
    measures: [state.measure],
    dimensions,
    grain: state.grain,
    range,
    ...(filters ? { filters } : {}),
  };
  return seriesQuery;
}

/**
 * Narrow the metrics `filters` shape (whose values are typed as
 * `(string | number)[]`) down to a `SessionPopulationCriteria` — the
 * session-scoped population shape consumed by the scatter endpoint and the
 * server's `session-population` matcher. Two material differences from the
 * raw metrics `filters` shape:
 *
 *   1. The contract's `gitBranch` dimension is renamed to the `branch` key
 *      the population matcher reads (`server/metrics/session-population.ts`
 *      does `criteria.branch`). Without this remap the branch chip is
 *      silently dropped at runtime — TS permits the mis-assignment only
 *      by weak-type compatibility across two all-optional Partial shapes.
 *   2. Non-array values (defensive guard) are coerced to `string[]` —
 *      every dimension value the metrics endpoint emits is a string, but
 *      the union widens to `(string | number)[]` so we narrow back here.
 */
function filtersToStringCriteria(
  filters: Partial<Record<Dimension, (string | number)[]>> | undefined,
): SessionPopulationCriteria {
  const out: SessionPopulationCriteria = {};
  if (!filters) return out;
  for (const [dim, values] of Object.entries(filters)) {
    if (!Array.isArray(values) || values.length === 0) continue;
    const strings = values.map((v) => String(v));
    if (dim === "gitBranch") {
      out.branch = strings;
    } else if (dim === "project" || dim === "model" || dim === "host" || dim === "entrypoint") {
      out[dim] = strings;
    }
    // Other Dimension keys (time, version, sidechain, tool, gateStatus)
    // are not part of SessionPopulationCriteria — they belong on the
    // metrics `filters` shape consumed upstream, not the population. Drop.
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drill links (R4 — Phase 4 DoD: one drill-link lands filtered)
// ---------------------------------------------------------------------------

/**
 * The four dimensions that already have a corresponding global filter chip.
 * When a pivot slice drill lands on `/sessions` for one of these, we encode
 * the value via the matching chip key (so the existing Sessions page
 * filter bar picks it up with zero coordination). Other dimensions fall
 * through to a generic `slice.<dim>=value` key — not yet honored by
 * Sessions but reserved for a follow-up that lifts the dim filter out of
 * the global filter bar.
 */
const CHIP_DIMENSION_KEY: Partial<Record<Dimension, string>> = {
  project: "project",
  model: "model",
  gitBranch: "branch",
  host: "host",
};

/**
 * Build the `/sessions?…` URL search string for a pivot slice drill — the
 * destination a bar/line/area/table/distribution click should navigate to.
 *
 * Preserves every existing global filter key (`range`/`from`/`to`/
 * `project`/`model`/`branch`/`host`) so the drill lands on a filtered
 * Sessions page (R4 / Phase 4 DoD). When the pivot's `dim` is one of the
 * four chip dimensions, the clicked value is merged into that chip; for
 * any other dimension it's appended as `slice.<dim>=value` for a future
 * Sessions-page reader.
 */
export function buildSliceDrillSearch(
  currentSearch: string,
  pivot: Pick<PivotState, "dim">,
  sliceValue: string,
): string {
  const params = new URLSearchParams(
    currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch,
  );
  const chipKey = CHIP_DIMENSION_KEY[pivot.dim];
  if (chipKey) {
    // Merge with the existing chip values (deduped + sorted) so a global
    // filter applied before the drill doesn't get silently dropped.
    const existing = (params.get(chipKey) ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    const next = Array.from(new Set([...existing, sliceValue])).sort();
    params.set(chipKey, next.join(","));
  } else {
    params.set(`slice.${pivot.dim}`, sliceValue);
  }
  // Force the Sessions page's strict projection — without this the
  // dashboard's compact projection would render and the drill would
  // silently land on a different shape.
  params.set("view", "page");
  return params.toString();
}

/** Build the `/sessions/<sessionId>` URL for a scatter-point drill. The
 * scatter's `points[].sessionId` is the canonical identity, so the drill
 * is a simple path navigation with the search string preserved for
 * global-filter parity with the source Explore view. */
export function buildScatterDrillPath(sessionId: string, currentSearch: string): string {
  const trimmed = currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch;
  return trimmed ? `/sessions/${sessionId}?${trimmed}` : `/sessions/${sessionId}`;
}
