import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import clsx from "clsx";
import { useId, useMemo, useState } from "react";
import { useLocation } from "wouter";
import type { Series, SeriesMetricsQuery } from "../../../../shared/metrics-contract.js";
import type { SessionListItem, SessionListParams } from "../../../../shared/sessions-contract.js";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { listSessions } from "../../api/sessions.js";
import { formatUnitValue } from "../../charts/units.js";
import { DataTable } from "../../components/DataTable.js";
import { EmptyState } from "../../components/EmptyState.js";
import { filtersToQuery } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import { useStableNow } from "./useStableNow.js";

const LEADERBOARD_LIMIT = 5;

type Tab = "sessions" | "projects" | "models";

const TABS: { value: Tab; label: string }[] = [
  { value: "sessions", label: "Sessions" },
  { value: "projects", label: "Projects" },
  { value: "models", label: "Models" },
];

/** One row of a dimension-grouped leaderboard (Projects/Models tabs) —
 * derived from a `Series[]` aggregate query (no `time` dimension), not a
 * dedicated leaderboard endpoint. */
interface DimensionRow {
  dimensionKey: string;
  label: string;
  value: number | null;
}

/** Projects/Models tabs both aggregate `costComputed` over the whole range
 * (no `time` dimension → one point per group), then sort/limit client-side —
 * the metrics contract has no server-side top-N. */
function topDimensionRows(series: Series[] | undefined, limit: number): DimensionRow[] {
  if (!series) return [];
  return series
    .map((s) => ({
      dimensionKey: s.dimensionKey,
      label: s.label,
      value: s.points[0]?.value ?? null,
    }))
    .sort((a, b) => (b.value ?? Number.NEGATIVE_INFINITY) - (a.value ?? Number.NEGATIVE_INFINITY))
    .slice(0, limit);
}

/** Maps the global chip filters + range into `/api/sessions` query params —
 * the sessions contract's chip field names (`project`/`model`/`branch`/
 * `host`) already match `FilterState`'s, so no dimension remapping is
 * needed here (unlike `filtersToQuery`'s `gitBranch` remap for metrics). */
function sessionParams(
  filters: ReturnType<typeof useFilters>["filters"],
  now: Date,
): SessionListParams {
  const { range } = filtersToQuery(filters, now);
  return {
    sort: "costComputed",
    order: "desc",
    limit: LEADERBOARD_LIMIT,
    from: range.from,
    to: range.to,
    project: filters.project,
    model: filters.model,
    branch: filters.branch,
    host: filters.host,
  };
}

const sessionColumnHelper = createColumnHelper<SessionListItem>();
// biome-ignore lint/suspicious/noExplicitAny: matches DataTable's own ColumnDef<T, any>[] contract (DataTable.tsx)
const sessionColumns: ColumnDef<SessionListItem, any>[] = [
  sessionColumnHelper.accessor("sessionId", {
    header: "Session",
    cell: (info) => info.getValue().slice(0, 8),
  }),
  sessionColumnHelper.accessor("project", { header: "Project" }),
  sessionColumnHelper.accessor("model", { header: "Model" }),
  sessionColumnHelper.accessor("costComputed", {
    header: "Cost",
    meta: { align: "right", mono: true },
    cell: (info) => formatUnitValue(info.getValue(), "$"),
  }),
];

const dimensionColumnHelper = createColumnHelper<DimensionRow>();
// biome-ignore lint/suspicious/noExplicitAny: matches DataTable's own ColumnDef<T, any>[] contract (DataTable.tsx)
function buildDimensionColumns(labelHeader: string): ColumnDef<DimensionRow, any>[] {
  return [
    dimensionColumnHelper.accessor("label", { header: labelHeader }),
    dimensionColumnHelper.accessor("value", {
      header: "Cost",
      meta: { align: "right", mono: true },
      cell: (info) => {
        const value = info.getValue();
        return typeof value === "number" ? formatUnitValue(value, "$") : "—";
      },
    }),
  ];
}

const projectColumns = buildDimensionColumns("Project");
const modelColumns = buildDimensionColumns("Model");

export interface LeaderboardsCardProps {
  /** Initial active tab — testing/story seam; the component still owns its
   * own tab state after mount (uncontrolled), matching `ChartCard`'s local
   * per-widget display-state convention (decision A4). */
  initialTab?: Tab;
  /** Injection seam for stories/tests; defaults to the real current time. */
  now?: Date;
}

/**
 * Tabbed top-5 leaderboard (ARCH-dashboard-page.md T13): Sessions/Projects/
 * Models, each deep-linking to its bound page per the section-level lock
 * (Sessions → §3 `/sessions/:id`, Projects → §5 `/projects`, Models → §6
 * `/models`). Global filters (`useFilters`) apply to every tab's query.
 */
export function LeaderboardsCard({
  initialTab = "sessions",
  now: injectedNow,
}: LeaderboardsCardProps) {
  const { filters } = useFilters();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const tabPanelId = useId();
  // Review #4: same stale-closure bug class as the live-window cards fixed
  // in PR #89's two follow-up commits. `useMemo(() => new Date(), [])` froze
  // `now` at mount forever — leaderboards stopped reflecting newer sessions.
  const now = useStableNow(injectedNow);

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters covered via its JSON identity
  const sessionsQueryParams = useMemo(
    () => sessionParams(filters, now),
    [JSON.stringify(filters), now],
  );

  const sessionsQuery = useQuery({
    queryKey: qk.sessions(sessionsQueryParams),
    queryFn: ({ signal }) => listSessions(sessionsQueryParams, signal),
    placeholderData: keepPreviousData,
    enabled: activeTab === "sessions",
  });

  const { filters: categoricalFilters, range } = filtersToQuery(filters, now);

  // biome-ignore lint/correctness/useExhaustiveDependencies: range/categoricalFilters covered via their JSON identity below
  const projectsQuery0 = useMemo<SeriesMetricsQuery>(
    () => ({
      measures: ["costComputed"],
      dimensions: ["project"],
      grain: "day",
      range,
      filters: categoricalFilters,
    }),
    [JSON.stringify(range), JSON.stringify(categoricalFilters)],
  );
  const modelsQuery0 = useMemo<SeriesMetricsQuery>(
    () => ({ ...projectsQuery0, dimensions: ["model"] }),
    [projectsQuery0],
  );

  const projectsQuery = useQuery({
    queryKey: qk.metrics(projectsQuery0),
    queryFn: ({ signal }) => postMetrics(projectsQuery0, signal),
    placeholderData: keepPreviousData,
    enabled: activeTab === "projects",
  });

  const modelsQuery = useQuery({
    queryKey: qk.metrics(modelsQuery0),
    queryFn: ({ signal }) => postMetrics(modelsQuery0, signal),
    placeholderData: keepPreviousData,
    enabled: activeTab === "models",
  });

  const projectRows = useMemo(
    () => topDimensionRows(projectsQuery.data, LEADERBOARD_LIMIT),
    [projectsQuery.data],
  );
  const modelRows = useMemo(
    () => topDimensionRows(modelsQuery.data, LEADERBOARD_LIMIT),
    [modelsQuery.data],
  );

  /**
   * Roving-tabindex keyboard navigation for the tablist (WCAG 1.4.13 +
   * ARIA Tabs pattern, review #19). Tab moves focus into/out of the widget
   * as one stop; arrow keys cycle the active tab within. Selected tab gets
   * `tabIndex={0}`, others `{−1}` so the roving index is correct without
   * a per-button ref juggling.
   */
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = TABS.findIndex((t) => t.value === activeTab);
    if (currentIndex < 0) return;
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % TABS.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = TABS.length - 1;
    else return;
    event.preventDefault();
    const next = TABS[nextIndex];
    if (!next) return;
    setActiveTab(next.value);
    const btn = document.getElementById(`${tabPanelId}-tab-${next.value}`);
    btn?.focus();
  };

  return (
    <div
      data-testid="leaderboards-card"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div
        role="tablist"
        aria-label="Leaderboards"
        className="flex items-center gap-1"
        onKeyDown={onTabKeyDown}
      >
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={`${tabPanelId}-tab-${tab.value}`}
            aria-selected={activeTab === tab.value}
            aria-controls={`${tabPanelId}-panel`}
            tabIndex={activeTab === tab.value ? 0 : -1}
            onClick={() => setActiveTab(tab.value)}
            className={clsx(TOGGLE_CLASS, activeTab === tab.value && TOGGLE_ACTIVE_CLASS)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        id={`${tabPanelId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabPanelId}-tab-${activeTab}`}
        className="mt-3"
      >
        {activeTab === "sessions" && (
          <>
            {sessionsQuery.isError && (
              <p role="alert" className="text-sm text-[#B23A3A] dark:text-[#E05252]">
                {sessionsQuery.error.message}
              </p>
            )}
            <DataTable
              data={sessionsQuery.data?.items ?? []}
              columns={sessionColumns}
              isLoading={sessionsQuery.isPending}
              getRowId={(row) => row.sessionId}
              label="Top sessions by cost"
              empty={<EmptyState message="No data yet" />}
              onRowClick={(row) => navigate(`/sessions/${row.sessionId}`)}
              getRowActionLabel={(row) => `View session ${row.sessionId}`}
            />
          </>
        )}

        {activeTab === "projects" && (
          <>
            {projectsQuery.isError && (
              <p role="alert" className="text-sm text-[#B23A3A] dark:text-[#E05252]">
                {projectsQuery.error.message}
              </p>
            )}
            <DataTable
              data={projectRows}
              columns={projectColumns}
              isLoading={projectsQuery.isPending}
              getRowId={(row) => row.dimensionKey}
              label="Top projects by cost"
              empty={<EmptyState message="No data yet" />}
              onRowClick={(row) => navigate(`/projects?project=${encodeURIComponent(row.label)}`)}
              getRowActionLabel={(row) => `View project ${row.label}`}
            />
          </>
        )}

        {activeTab === "models" && (
          <>
            {modelsQuery.isError && (
              <p role="alert" className="text-sm text-[#B23A3A] dark:text-[#E05252]">
                {modelsQuery.error.message}
              </p>
            )}
            <DataTable
              data={modelRows}
              columns={modelColumns}
              isLoading={modelsQuery.isPending}
              getRowId={(row) => row.dimensionKey}
              label="Top models by cost"
              empty={<EmptyState message="No data yet" />}
              onRowClick={(row) => navigate(`/models?model=${encodeURIComponent(row.label)}`)}
              getRowActionLabel={(row) => `View model ${row.label}`}
            />
          </>
        )}
      </div>
    </div>
  );
}
