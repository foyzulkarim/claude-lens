import type {
  Dimension,
  DistributionEntity,
  DistributionMetricsQuery,
  Grain,
  MetricsQuery,
  Series,
  SeriesMetricsQuery,
  SeriesPoint,
} from "../../shared/metrics-contract.js";
import type { ApiCall, Session, Turn } from "../../shared/types.js";
import {
  type CallDimension,
  callDimensionValue,
  matchesFilter,
  turnDimensionValue,
  UNKNOWN,
} from "./dimensions.js";
import { alignPreviousPeriod, computeDistribution, movingAverage7 } from "./distributions.js";
import { bucketStart, enumerateBuckets } from "./grain.js";
import { computeMeasure, type MeasureScope, type PricingTable } from "./measures.js";
import { indexSessionsByScope, matchSession, type SessionScope } from "./session-population.js";

// engine.ts is the only file in metrics/ that composes grain.ts/dimensions.ts/
// measures.ts/distributions.ts. It takes plain arrays, never a live Store
// (architecture decision A1, plan.md decisions log 2026-07-14) — testable
// against fixtures with no debounce/WS machinery involved.
export interface MetricsInput {
  calls: ApiCall[];
  turns: Turn[];
  sessions: Session[];
  pricing: PricingTable;
}

interface GroupKeyEntry {
  dim: Dimension;
  value: string;
}

interface Group {
  dimensionKey: string;
  label: string;
  keyEntries: GroupKeyEntry[];
  calls: ApiCall[];
}

function buildCallToTurn(turns: Turn[]): Map<ApiCall, Turn> {
  const map = new Map<ApiCall, Turn>();
  for (const turn of turns) {
    for (const call of turn.calls) map.set(call, turn);
  }
  return map;
}

/** Every dimension value a call belongs to, always as an array (single-valued dims wrap to length 1). */
function valuesForCallDim(call: ApiCall, dim: Dimension, callToTurn: Map<ApiCall, Turn>): string[] {
  if (dim === "gateStatus") {
    const turn = callToTurn.get(call);
    return [turn ? turnDimensionValue(turn, "gateStatus") : UNKNOWN];
  }
  const value = callDimensionValue(call, dim as CallDimension);
  return Array.isArray(value) ? value : [value];
}

function callMatchesFilters(
  call: ApiCall,
  filters: MetricsQuery["filters"],
  callToTurn: Map<ApiCall, Turn>,
): boolean {
  if (!filters) return true;
  // Object.keys widens to string[]; this cast trusts every key is a real
  // Dimension. Safe because routes/metrics.ts's parseMetricsQuery validates
  // every filter key/value shape before a query reaches here (#P2-10).
  for (const dim of Object.keys(filters) as Dimension[]) {
    if (dim === "time") continue;
    const values = valuesForCallDim(call, dim, callToTurn);
    if (!matchesFilter(values, filters[dim])) return false;
  }
  return true;
}

function labelFor(keyEntries: GroupKeyEntry[]): { dimensionKey: string; label: string } {
  if (keyEntries.length === 0) return { dimensionKey: "all", label: "All" };
  return {
    dimensionKey: keyEntries.map((e) => `${e.dim}:${e.value}`).join("|"),
    label: keyEntries.map((e) => e.value).join(" · "),
  };
}

/**
 * Cartesian product of a call's values across every breakdown dimension. A
 * call with a multi-valued dim (tool) fans out into one key-tuple per value
 * — the source of the documented tool-dimension double-count.
 */
function groupKeysForCall(
  call: ApiCall,
  breakdownDims: Dimension[],
  callToTurn: Map<ApiCall, Turn>,
): GroupKeyEntry[][] {
  let combos: GroupKeyEntry[][] = [[]];
  for (const dim of breakdownDims) {
    const values = valuesForCallDim(call, dim, callToTurn);
    const next: GroupKeyEntry[][] = [];
    for (const combo of combos) {
      for (const value of values) next.push([...combo, { dim, value }]);
    }
    combos = next;
  }
  return combos;
}

/**
 * Groups already-filtered calls by the breakdown dimensions. With no
 * breakdown dims, a single "all" group is always seeded (even with zero
 * calls) so dense output still works for an empty-range/empty-filter query.
 * With breakdown dims and zero matching calls, no groups can be known (there's
 * nothing to enumerate values from) — an empty Series[] is the honest result.
 */
function buildGroups(
  calls: ApiCall[],
  breakdownDims: Dimension[],
  callToTurn: Map<ApiCall, Turn>,
): Group[] {
  const groups = new Map<string, Group>();
  if (breakdownDims.length === 0) {
    const { dimensionKey, label } = labelFor([]);
    groups.set(dimensionKey, { dimensionKey, label, keyEntries: [], calls: [] });
  }
  for (const call of calls) {
    for (const keyEntries of groupKeysForCall(call, breakdownDims, callToTurn)) {
      const { dimensionKey, label } = labelFor(keyEntries);
      let group = groups.get(dimensionKey);
      if (!group) {
        group = { dimensionKey, label, keyEntries, calls: [] };
        groups.set(dimensionKey, group);
      }
      group.calls.push(call);
    }
  }
  return [...groups.values()];
}

// Turn-grain measures (wallMinutes, etc.) are matched to a group independently
// of which calls landed in that group's `calls` list — via the turn's own
// first call as a representative for call-level dims (architecture decision
// A5), or turn.gateStatus directly for the gateStatus dimension.
function turnMatchesGroup(turn: Turn, group: Group): boolean {
  const representative = turn.calls[0];
  for (const { dim, value } of group.keyEntries) {
    if (dim === "gateStatus") {
      if (turnDimensionValue(turn, "gateStatus") !== value) return false;
      continue;
    }
    if (!representative) return false;
    const repValue = callDimensionValue(representative, dim as CallDimension);
    const repValues = Array.isArray(repValue) ? repValue : [repValue];
    if (!repValues.includes(value)) return false;
  }
  return true;
}

function sessionValueForDim(session: Session, dim: Dimension): string[] {
  switch (dim) {
    case "project":
      return [session.project || UNKNOWN];
    case "gitBranch":
      return [session.gitBranch || UNKNOWN];
    case "version":
      return [session.version || UNKNOWN];
    case "entrypoint":
      return [session.entrypoint || UNKNOWN];
    case "model":
      return session.models.length > 0 ? session.models : [UNKNOWN];
    case "host":
      return ["default"];
    case "sidechain":
    case "tool":
    case "gateStatus":
    case "time":
      // No session-level meaning for any of these. Explicit cases (not a
      // default) so a future Dimension addition fails to compile here
      // instead of silently falling into "unknown" (review finding L5).
      return [UNKNOWN];
  }
}

function sessionMatchesGroup(session: Session, group: Group): boolean {
  return group.keyEntries.every(({ dim, value }) =>
    sessionValueForDim(session, dim).includes(value),
  );
}

function scopeFor(
  group: Group,
  bucketStartMs: number | null,
  grain: Grain,
  input: MetricsInput,
  rangeFromMs: number,
  rangeToMs: number,
): MeasureScope {
  const calls =
    bucketStartMs === null
      ? group.calls
      : group.calls.filter(
          (call) => bucketStart(Date.parse(call.timestamp), grain) === bucketStartMs,
        );

  const turns = input.turns.filter((turn) => {
    const ts = Date.parse(turn.startedAt);
    if (!Number.isFinite(ts) || ts < rangeFromMs || ts > rangeToMs) return false;
    if (bucketStartMs !== null && bucketStart(ts, grain) !== bucketStartMs) return false;
    return turnMatchesGroup(turn, group);
  });

  const sessions = input.sessions.filter((session) => {
    const ts = Date.parse(session.firstAt);
    if (!Number.isFinite(ts) || ts < rangeFromMs || ts > rangeToMs) return false;
    if (bucketStartMs !== null && bucketStart(ts, grain) !== bucketStartMs) return false;
    return sessionMatchesGroup(session, group);
  });

  return { calls, turns, sessions };
}

/** Filters calls to the range/filters and groups them by breakdown dims — shared by both the series and distribution pipelines below. */
function filterAndGroup(
  input: MetricsInput,
  query: MetricsQuery,
  range: { from: string; to: string },
): { groups: Group[]; rangeFromMs: number; rangeToMs: number } {
  const breakdownDims = query.dimensions.filter((d) => d !== "time");
  const callToTurn = buildCallToTurn(input.turns);

  const rangeFromMs = Date.parse(range.from);
  const rangeToMs = Date.parse(range.to);

  const filteredCalls = input.calls.filter((call) => {
    const ts = Date.parse(call.timestamp);
    // NaN < x and NaN > x are both false in JS, so an unparseable timestamp
    // (a real shape — parse-transcript.ts's toStr() coerces a missing/bad
    // field to "") would otherwise silently bypass the range filter instead
    // of being excluded by it (review finding H2). Exclude explicitly.
    if (!Number.isFinite(ts) || ts < rangeFromMs || ts > rangeToMs) return false;
    return callMatchesFilters(call, query.filters, callToTurn);
  });

  const groups = buildGroups(filteredCalls, breakdownDims, callToTurn);
  return { groups, rangeFromMs, rangeToMs };
}

/** The `mode: "series"` pipeline, parameterized on `range` so it can also serve compare's shifted previous-period run (decision A7) — everything else (measures/dimensions/grain/filters) comes from `query`. */
function computeSeriesForRange(
  input: MetricsInput,
  query: SeriesMetricsQuery | DistributionMetricsQuery,
  range: { from: string; to: string },
): Series[] {
  const { groups, rangeFromMs, rangeToMs } = filterAndGroup(input, query, range);
  const bucketByTime = query.dimensions.includes("time");
  const buckets: (number | null)[] = bucketByTime ? enumerateBuckets(range, query.grain) : [null];

  const series: Series[] = [];
  for (const measure of query.measures) {
    for (const group of groups) {
      const points: SeriesPoint[] = buckets.map((bucketStartMs) => {
        const scope = scopeFor(group, bucketStartMs, query.grain, input, rangeFromMs, rangeToMs);
        const value = computeMeasure(measure, scope, input.pricing);
        // `t` must be a machine-readable ISO-8601 instant, not a display
        // label: ECharts' `xAxis: { type: "time" }` parser requires an
        // ISO-shaped string (or a Date/number) and silently drops any point
        // it can't parse via its own regex-based `parseDate` — it does NOT
        // fall back to the browser's lenient `new Date(str)` parsing. The
        // previous `bucketLabel(...)` call emitted a locale-formatted
        // display string (e.g. "11 July 2026"), which ECharts couldn't
        // parse, so every point in every timeseries chart was silently
        // dropped (empty canvas) even though the underlying data was
        // correct — confirmed via the Dashboard's "Cost over time" chart
        // rendering nothing while its data table showed real values. Every
        // client consumer already re-derives its own human-readable label
        // from this timestamp (ChartCard.tsx's `formatBucketLabel`), so
        // switching to ISO here is a pure correctness fix with no display
        // regression.
        const t = bucketStartMs === null ? range.from : new Date(bucketStartMs).toISOString();
        return { t, value };
      });
      series.push({
        measure,
        dimensionKey: group.dimensionKey,
        label: group.label,
        points,
        basis: measure === "costComputed" ? "computed" : undefined,
      });
    }
  }
  return series;
}

/** One MeasureScope per distribution-mode entity, reusing an already range/group-scoped MeasureScope as the source population (decision A8). A `"turn"` entity uses the Turn's own `.calls` directly, matching how `measures.ts` already treats turn-grain aggregation; a `"session"` entity narrows the group's calls/turns down to that session's own. */
function entityScopesFor(entity: DistributionEntity, scope: MeasureScope): MeasureScope[] {
  switch (entity) {
    case "call":
      return scope.calls.map((call) => ({ calls: [call], turns: [], sessions: [] }));
    case "turn":
      return scope.turns.map((turn) => ({ calls: turn.calls, turns: [turn], sessions: [] }));
    case "session":
      return scope.sessions.map((session) => ({
        calls: scope.calls.filter((call) => call.sessionId === session.sessionId),
        turns: scope.turns.filter((turn) => turn.sessionId === session.sessionId),
        sessions: [session],
      }));
  }
}

/**
 * Indexed-per-session variant of `entityScopesFor("session", …)` (ARCH T1
 * session-scope optimization): pre-indexes `calls`/`turns` by sessionId
 * once, then yields the same per-session `MeasureScope` array without the
 * O(S × (C+T)) per-session re-filter. Used by the distribution +
 * scatter pipelines when `distributionEntity === "session"`, which is the
 * Sessions page's default — keeps the engine's existing semantics
 * (one MeasureScope per session, single-session record set) while making
 * the per-query cost linear instead of quadratic.
 */
function sessionEntityScopesFromIndex(scopes: Map<string, SessionScope>): MeasureScope[] {
  const result: MeasureScope[] = [];
  for (const scope of scopes.values()) {
    result.push({
      calls: scope.calls,
      turns: scope.turns,
      sessions: [scope.session],
    });
  }
  return result;
}

/**
 * Build the per-session indexed scopes for the matched range-filtered
 * sessions in `input` (ARCH T1). Reused by both the session-distribution
 * and the scatter pipelines — building it once per metrics request
 * replaces the O(S × (C+T)) per-session re-filter that the legacy
 * `entityScopesFor("session", …)` did on every measure × group iteration.
 */
function buildSessionScopeIndex(
  input: MetricsInput,
  rangeFromMs: number,
  rangeToMs: number,
  criteria?: DistributionMetricsQuery["sessionPopulation"],
): Map<string, SessionScope> {
  const matched = input.sessions.filter((session) => {
    const firstMs = Date.parse(session.firstAt);
    return (
      Number.isFinite(firstMs) &&
      firstMs >= rangeFromMs &&
      firstMs <= rangeToMs &&
      (criteria === undefined || matchSession(session, criteria))
    );
  });
  return indexSessionsByScope(matched, input.calls, input.turns);
}

/** The `mode: "distribution"` pipeline (decision A9: `"time"` in `dimensions` is ignored — always one population per breakdown-dim group across the whole range). Entities where `computeMeasure` returns null are excluded from the population, which is what lets an all-premium-gated measure cascade to `computeDistribution([])`'s honest-null result with no special-casing here. */
function computeDistributionSeries(input: MetricsInput, query: DistributionMetricsQuery): Series[] {
  const { groups, rangeFromMs, rangeToMs } = filterAndGroup(input, query, query.range);

  // Session-distribution path uses the indexed scopes (ARCH T1) — one
  // index per request, reused across every measure × group pair. The
  // path takes the same MeasureScope shape downstream callers already
  // see, so distribution semantics (entity → null exclusion, etc.) are
  // unchanged from the legacy per-session filter.
  const sessionIndex =
    query.distributionEntity === "session"
      ? buildSessionScopeIndex(input, rangeFromMs, rangeToMs, query.sessionPopulation)
      : null;

  const series: Series[] = [];
  for (const measure of query.measures) {
    for (const group of groups) {
      let entityScopes: MeasureScope[];
      if (query.distributionEntity === "session" && sessionIndex !== null) {
        // Same scope shape as `entityScopesFor("session", …)`; the
        // indexed path is functionally identical but linear in C+T+S.
        entityScopes = sessionEntityScopesFromIndex(sessionIndex);
      } else {
        const scope = scopeFor(group, null, query.grain, input, rangeFromMs, rangeToMs);
        entityScopes = entityScopesFor(query.distributionEntity, scope);
      }
      const values = entityScopes
        .map((entityScope) => computeMeasure(measure, entityScope, input.pricing))
        .filter((value): value is number => value !== null);
      series.push({
        measure,
        dimensionKey: group.dimensionKey,
        label: group.label,
        points: [],
        distribution: computeDistribution(values),
        basis: measure === "costComputed" ? "computed" : undefined,
      });
    }
  }
  return series;
}

/** Previous range = [from-duration, from), computed independently via the same range-filtering/bucketing machinery as the current range so DST/month-length correctness is inherited, not reimplemented (decision A7). */
function previousPeriodRange(range: { from: string; to: string }): { from: string; to: string } {
  const rangeFromMs = Date.parse(range.from);
  const rangeToMs = Date.parse(range.to);
  const duration = rangeToMs - rangeFromMs;
  return {
    from: new Date(rangeFromMs - duration).toISOString(),
    to: new Date(rangeFromMs - 1).toISOString(),
  };
}

/** Attaches `compareGhost` to each series by aligning it against the previous-period series sharing its `measure|dimensionKey`. A current-period series with no previous-period counterpart (e.g. a dimension value that's new this period) is returned unchanged — no ghost, not a null-padded one. */
function mergeCompareGhost(series: Series[], previousSeries: Series[]): Series[] {
  const previousByKey = new Map(
    previousSeries.map((s) => [`${s.measure}|${s.dimensionKey}`, s.points]),
  );
  return series.map((s) => {
    const previousPoints = previousByKey.get(`${s.measure}|${s.dimensionKey}`);
    return previousPoints === undefined
      ? s
      : { ...s, compareGhost: alignPreviousPeriod(s.points, previousPoints) };
  });
}

/** THE query function (architecture §8): dispatches on `query.mode`, then applies `compare`/`smoothing` post-processing to `mode: "series"` output (decisions A6, A7, A9). */
export function metrics(input: MetricsInput, query: MetricsQuery): Series[] {
  if (query.mode === "distribution") {
    return computeDistributionSeries(input, query);
  }

  // Scatter mode returns a different shape (`ScatterMetricsResult`), so the
  // dispatch above (returning `Series[]`) cannot host it. The scatter
  // pipeline lives in `server/metrics/scatter.ts` and is reached through
  // a sibling helper (`metricsScatter`) called by `server/routes/metrics.ts`.
  // This branch is intentionally a non-`scatter` guard so future variants
  // fail to compile here rather than silently falling through.
  if (query.mode === "scatter") {
    throw new Error("metrics() does not handle mode='scatter' — call metricsScatter()");
  }

  // Narrowed at this point: distribution + scatter were both handled above,
  // so `query` is `SeriesMetricsQuery`. The `as` cast keeps `tsc --strict`
  // honest without changing `MetricsQuery`'s shape.
  let series = computeSeriesForRange(input, query, query.range);
  const seriesQuery: SeriesMetricsQuery = query;

  if (seriesQuery.compare === "previous-period") {
    const previousSeries = computeSeriesForRange(
      input,
      seriesQuery,
      previousPeriodRange(seriesQuery.range),
    );
    series = mergeCompareGhost(series, previousSeries);
  }

  if (seriesQuery.smoothing === "ma7") {
    series = series.map((s) => ({ ...s, points: movingAverage7(s.points) }));
  }

  return series;
}
