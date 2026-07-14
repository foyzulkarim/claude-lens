import type {
  Dimension,
  Grain,
  MetricsQuery,
  Series,
  SeriesPoint,
} from "../../shared/metrics-contract.js";
import type { ApiCall, Session, Turn } from "../../shared/types.js";
import {
  type CallDimension,
  callDimensionValue,
  matchesFilter,
  turnDimensionValue,
} from "./dimensions.js";
import { bucketLabel, bucketStart, enumerateBuckets } from "./grain.js";
import { computeMeasure, type MeasureScope, type PricingTable } from "./measures.js";

// engine.ts is the only file in metrics/ that composes grain.ts/dimensions.ts/
// measures.ts. It takes plain arrays, never a live Store (architecture
// decision A1, plan.md decisions log 2026-07-14) — testable against fixtures
// with no debounce/WS machinery involved.
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
    return [turn ? turnDimensionValue(turn, "gateStatus") : "unknown"];
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
      return [session.project || "unknown"];
    case "gitBranch":
      return [session.gitBranch || "unknown"];
    case "version":
      return [session.version || "unknown"];
    case "entrypoint":
      return [session.entrypoint || "unknown"];
    case "model":
      return session.models.length > 0 ? session.models : ["unknown"];
    case "host":
      return ["default"];
    default:
      // sidechain / tool / gateStatus / time have no session-level meaning.
      return ["unknown"];
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
    if (ts < rangeFromMs || ts > rangeToMs) return false;
    if (bucketStartMs !== null && bucketStart(ts, grain) !== bucketStartMs) return false;
    return turnMatchesGroup(turn, group);
  });

  const sessions = input.sessions.filter((session) => {
    const ts = Date.parse(session.firstAt);
    if (ts < rangeFromMs || ts > rangeToMs) return false;
    if (bucketStartMs !== null && bucketStart(ts, grain) !== bucketStartMs) return false;
    return sessionMatchesGroup(session, group);
  });

  return { calls, turns, sessions };
}

/**
 * THE query function (architecture §8). mode/compare/smoothing are accepted
 * in the type but not implemented here — #P2-9 owns distributions.ts,
 * ma7 smoothing, and previous-period alignment (decision A6); this function
 * simply never reads those three fields, so they no-op rather than throw.
 */
export function metrics(input: MetricsInput, query: MetricsQuery): Series[] {
  const breakdownDims = query.dimensions.filter((d) => d !== "time");
  const bucketByTime = query.dimensions.includes("time");
  const callToTurn = buildCallToTurn(input.turns);

  const rangeFromMs = Date.parse(query.range.from);
  const rangeToMs = Date.parse(query.range.to);

  const filteredCalls = input.calls.filter((call) => {
    const ts = Date.parse(call.timestamp);
    if (ts < rangeFromMs || ts > rangeToMs) return false;
    return callMatchesFilters(call, query.filters, callToTurn);
  });

  const groups = buildGroups(filteredCalls, breakdownDims, callToTurn);
  const buckets: (number | null)[] = bucketByTime
    ? enumerateBuckets(query.range, query.grain)
    : [null];

  const series: Series[] = [];
  for (const measure of query.measures) {
    for (const group of groups) {
      const points: SeriesPoint[] = buckets.map((bucketStartMs) => {
        const scope = scopeFor(group, bucketStartMs, query.grain, input, rangeFromMs, rangeToMs);
        const value = computeMeasure(measure, scope, input.pricing);
        const t =
          bucketStartMs === null ? query.range.from : bucketLabel(bucketStartMs, query.grain);
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
