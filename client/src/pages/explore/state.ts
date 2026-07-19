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

  if (state.mode === "distribution") {
    const distQuery: DistributionMetricsQuery = {
      mode: "distribution",
      measures: [state.measure],
      dimensions: [state.dim],
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
    dimensions: [state.dim],
    grain: state.grain,
    range,
    ...(filters ? { filters } : {}),
  };
  return seriesQuery;
}

/**
 * Narrows the metrics `filters` shape (whose values are typed as
 * `(string | number)[]`) down to `SessionPopulationCriteria`'s
 * `string[]`-only fields. Every filter value the engine emits here is a
 * string (dimension values, not measure values), so the runtime guard is
 * a no-op in practice — but it lets TypeScript prove the assignment
 * without `as`.
 */
function filtersToStringCriteria(
  filters: Partial<Record<Dimension, (string | number)[]>> | undefined,
): Partial<Record<Dimension, string[]>> {
  if (!filters) return {};
  const out: Partial<Record<Dimension, string[]>> = {};
  for (const [dim, values] of Object.entries(filters) as [Dimension, (string | number)[]][]) {
    if (!Array.isArray(values)) continue;
    out[dim] = values.map((v) => String(v));
  }
  return out;
}
