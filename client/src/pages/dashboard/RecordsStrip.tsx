import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Dimension, Series, SeriesMetricsQuery } from "../../../../shared/metrics-contract.js";
import type { SessionListItem, SessionListParams } from "../../../../shared/sessions-contract.js";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { listSessions } from "../../api/sessions.js";
import { pointValueOrNull } from "../../charts/series-math.js";
import { formatUnitValueOrDash } from "../../charts/units.js";
import { CHIP_DIMENSION, type FilterState, serializeFilters } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";

type CategoricalSessionParams = Pick<SessionListParams, "project" | "model" | "branch" | "host">;

/** Categorical-only filter fragment (project/model/branch/host) — Records
 * intentionally drop the active date range (decision A7: "ignore only the
 * active date range"), so this never reads `filters.range`. */
function categoricalSessionParams(state: FilterState): CategoricalSessionParams {
  const params: CategoricalSessionParams = {};
  if (state.project.length > 0) params.project = state.project;
  if (state.model.length > 0) params.model = state.model;
  if (state.branch.length > 0) params.branch = state.branch;
  if (state.host.length > 0) params.host = state.host;
  return params;
}

/** Same categorical fragment, shaped for a `MetricsQuery.filters` map
 * (remaps the URL's `branch` chip to the contract's `gitBranch` dimension,
 * matching `filtersToQuery`'s convention) — used only for the
 * most-expensive-day metrics query below. */
function categoricalMetricsFilters(state: FilterState): Partial<Record<Dimension, string[]>> {
  const filters: Partial<Record<Dimension, string[]>> = {};
  for (const key of ["project", "model", "branch", "host"] as const) {
    const values = state[key];
    if (values.length > 0) filters[CHIP_DIMENSION[key]] = values;
  }
  return filters;
}

/** Format an $/value cell for the Records strip. Review #6: routes through
 * the shared `formatUnitValueOrDash` helper so the unavailable placeholder
 * ("—") matches every other dashboard cell instead of an ad-hoc `null`
 * that `sessionRecordRow` had to translate. */
function formatMoney(value: number | null | undefined): string {
  return formatUnitValueOrDash(value, "$");
}

/** Format a session duration as `Xh YYm` or `Nm`. Returns `null` for
 * invalid inputs — the record-row helper treats `null` as "show —". This
 * keeps a distinct format (compound hours/minutes) that doesn't fit the
 * `Unit`/`formatUnitValue` shape, so it stays local rather than going
 * through the shared helper. */
function formatDuration(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m`;
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** First 8 characters of a session id — matches the mockup's truncated id
 * display (specs/pages/dashboard.html Records section). */
function shortId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

export interface RecordRow {
  label: string;
  /** Pre-formatted display value, or "—" when unavailable. */
  value: string;
  /** Secondary detail (short session id or a formatted day) — omitted when
   * the record itself is unavailable. */
  detail?: string;
}

/** Builds one record row from a top-ranked session (or its absence).
 * Exported for direct unit testing of the "—" degradation without a full
 * component render. Accepts either a string-returning extractor (the new
 * `formatUnitValueOrDash`/`formatMoney` shape — always returns "—" for
 * unavailable) or a string-or-null extractor (the older `formatDuration`
 * shape — `null` means unavailable). */
export function sessionRecordRow(
  label: string,
  session: SessionListItem | undefined,
  extract: (session: SessionListItem) => string | null,
): RecordRow {
  if (!session) return { label, value: "—" };
  const value = extract(session);
  if (value === null) return { label, value: "—" };
  return { label, value, detail: shortId(session.sessionId) };
}

/** Builds the "most expensive day" record from a `costComputed` day-grain
 * `Series[]` over the matched history extent — the one record sourced from
 * `/api/metrics` rather than `/api/sessions` (architecture §"Records": day
 * through `/api/metrics`, the other four through `/api/sessions`). Review
 * #6: formatMoney is now a passthrough to `formatUnitValueOrDash`, so the
 * unreachable null-coalesce in this function is gone. */
export function dayRecordRow(data: Series[] | undefined): RecordRow {
  const label = "Most expensive day";
  const points = data?.find((s) => s.measure === "costComputed")?.points ?? [];
  let best: { t: string; value: number } | null = null;
  for (const point of points) {
    const value = pointValueOrNull(point);
    if (value === null) continue;
    if (!best || value > best.value) best = { t: point.t, value };
  }
  if (!best) return { label, value: "—" };
  return {
    label,
    value: formatMoney(best.value),
    detail: DAY_FORMAT.format(new Date(best.t)),
  };
}

function useTopSession(params: SessionListParams) {
  return useQuery({
    queryKey: qk.sessions(params),
    queryFn: ({ signal }) => listSessions(params, signal),
    placeholderData: keepPreviousData,
  });
}

/**
 * Five all-time records (T11 spec): most expensive day/session/turn,
 * longest session, biggest cache save. Per decision A7, only the active
 * date range is overridden (with the full matched-history extent);
 * categorical filters (project/model/branch/host) stay active. Records do
 * NOT deep-link — the spec shows "—" for record drill targets, so unlike
 * `ChartCard` there is no click-to-drill handler here (T11 scope boundary).
 */
export function RecordsStrip() {
  const { filters } = useFilters();
  const filtersKey = serializeFilters(filters);

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey)
  const sessionParams = useMemo(() => categoricalSessionParams(filters), [filtersKey]);

  const expensiveSessionQuery = useTopSession({
    ...sessionParams,
    sort: "costComputed",
    order: "desc",
    limit: 1,
  });
  const expensiveTurnQuery = useTopSession({
    ...sessionParams,
    sort: "maxTurnCostComputed",
    order: "desc",
    limit: 1,
  });
  const longestSessionQuery = useTopSession({
    ...sessionParams,
    sort: "durationMs",
    order: "desc",
    limit: 1,
  });
  const cacheSaveQuery = useTopSession({
    ...sessionParams,
    sort: "cacheSavingsComputed",
    order: "desc",
    limit: 1,
  });

  // The matched-history extent is filter-dependent but sort/limit-
  // independent (server/routes/sessions.ts computes it over the full
  // matched set before sort/slice) — any resolved query's `meta` carries
  // the same value, so the first one to land is used.
  const extent =
    expensiveSessionQuery.data?.meta.matchedExtent ??
    expensiveTurnQuery.data?.meta.matchedExtent ??
    longestSessionQuery.data?.meta.matchedExtent ??
    cacheSaveQuery.data?.meta.matchedExtent ??
    null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey)
  const dayQuery = useMemo<SeriesMetricsQuery | null>(() => {
    if (!extent) return null;
    return {
      measures: ["costComputed"],
      dimensions: ["time"],
      grain: "day",
      range: extent,
      filters: categoricalMetricsFilters(filters),
    };
  }, [filtersKey, extent]);

  const expensiveDayQuery = useQuery({
    queryKey: dayQuery ? qk.metrics(dayQuery) : (["metrics", "records-day", filtersKey] as const),
    queryFn: ({ signal }) => (dayQuery ? postMetrics(dayQuery, signal) : Promise.resolve([])),
    enabled: dayQuery !== null,
    placeholderData: keepPreviousData,
  });

  const isPending =
    expensiveSessionQuery.isPending ||
    expensiveTurnQuery.isPending ||
    longestSessionQuery.isPending ||
    cacheSaveQuery.isPending ||
    (dayQuery !== null && expensiveDayQuery.isPending);

  const topSession = (data: { items: SessionListItem[] } | undefined) => data?.items[0];

  const records: RecordRow[] = [
    dayRecordRow(expensiveDayQuery.data),
    sessionRecordRow("Most expensive session", topSession(expensiveSessionQuery.data), (s) =>
      formatMoney(s.costComputed),
    ),
    sessionRecordRow("Most expensive turn", topSession(expensiveTurnQuery.data), (s) =>
      formatMoney(s.maxTurnCostComputed),
    ),
    sessionRecordRow("Longest session", topSession(longestSessionQuery.data), (s) =>
      formatDuration(s.durationMs),
    ),
    sessionRecordRow("Biggest cache save", topSession(cacheSaveQuery.data), (s) =>
      formatMoney(s.cacheSavingsComputed),
    ),
  ];

  return (
    <div
      data-testid="records-strip"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-[#8A96A5]">
        Records
      </p>
      {isPending ? (
        <p role="status" className="mt-2 text-sm text-slate-500 dark:text-[#8B98A9]">
          Loading…
        </p>
      ) : (
        <dl className="mt-2 space-y-1">
          {records.map((record) => (
            <div
              key={record.label}
              className="flex items-baseline justify-between gap-2 font-mono text-xs"
            >
              <dt className="text-slate-600 dark:text-[#8A96A5]">{record.label}</dt>
              <dd className="text-right">
                <span className="text-slate-900 dark:text-[#E8EDF2]">{record.value}</span>
                {record.detail ? (
                  <span className="ml-2 text-slate-500 dark:text-[#8A96A5]">{record.detail}</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
