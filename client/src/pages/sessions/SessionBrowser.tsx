import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import clsx from "clsx";
import { useLocation } from "wouter";
import type {
  SessionListParams,
  SessionPageItem,
  SessionPageParams,
  SessionTimelineItem,
} from "../../../../shared/sessions-contract.js";
import { listSessionsPage } from "../../api/sessions.js";
import { qk } from "../../api/queryKeys.js";
import { DataTable } from "../../components/DataTable.js";
import { EmptyState } from "../../components/EmptyState.js";
import { formatDuration, formatUnitValue } from "../../charts/units.js";
import { useFilters } from "../../filters/useFilters.js";
import { useStableNow } from "../dashboard/useStableNow.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import { type SessionsPageState, buildListQuery } from "./state.js";

export interface SessionBrowserProps {
  state: SessionsPageState;
  onStateChange: (patch: Partial<SessionsPageState>) => void;
  /** Optional injection seam for stories / tests. */
  now?: Date;
}

const PAGE_SIZE = 25;

const helper = createColumnHelper<SessionPageItem>();
// biome-ignore lint/suspicious/noExplicitAny: matches DataTable's own ColumnDef<T, any>[] contract (DataTable.tsx)
const pageColumns: ColumnDef<SessionPageItem, any>[] = [
  helper.accessor("sessionId", {
    header: "Session",
    cell: (info) => info.getValue().slice(0, 8),
  }),
  helper.accessor("project", { header: "Project" }),
  helper.accessor("models", {
    header: "Models",
    cell: (info) => info.getValue().join(", "),
  }),
  helper.accessor("branch", {
    header: "Branch",
    cell: (info) => info.getValue() ?? "—",
  }),
  helper.accessor("entrypoint", { header: "Entrypoint" }),
  helper.accessor("version", { header: "Version" }),
  helper.accessor("durationMs", {
    header: "Duration",
    meta: { align: "right", mono: true },
    cell: (info) => formatDuration(info.getValue()),
  }),
  helper.accessor("turnCount", {
    header: "Turns",
    meta: { align: "right", mono: true },
  }),
  helper.accessor("totalTokens", {
    header: "Tokens",
    meta: { align: "right", mono: true },
    cell: (info) => formatUnitValue(info.getValue(), "tokens"),
  }),
  helper.accessor("costComputed", {
    header: "Cost",
    meta: { align: "right", mono: true },
    cell: (info) => formatUnitValue(info.getValue(), "$"),
  }),
  helper.accessor("cacheHitPct", {
    header: "Cache %",
    meta: { align: "right", mono: true },
    cell: (info) => `${Math.round(info.getValue() * 100)}%`,
  }),
  helper.accessor("hasDrilldown", {
    header: "Drilldown",
    cell: (info) => (info.getValue() ? "Yes" : "—"),
  }),
];

/**
 * Sessions identity-oriented view (ARCH R3/R4/R8/R9/R11). Owns the
 * page-list query, the table ↔ timeline toggle, server-side sort/paging,
 * selection, and drill links to `/sessions/:id`.
 *
 * The browser reuses one `listSessionsPage` query regardless of which view
 * is active so the table/timeline toggle never refetches the population
 * (ARCH R4 — "toggle uses the already-fetched response").
 */
export function SessionBrowser({ state, onStateChange, now: injectedNow }: SessionBrowserProps) {
  const { filters } = useFilters();
  const [, navigate] = useLocation();
  const now = useStableNow(injectedNow);

  const listParams: Omit<SessionPageParams, "view"> = buildListQuery(state, filters, now);
  const query = useQuery({
    queryKey: qk.sessions({
      ...listParams,
      // Loose-cast: the page projection is a strict superset of
      // SessionListParams, but the qk.sessions factory narrows to the
      // older shape. TanStack's default key hashing sorts object keys so
      // identity-stable serialization isn't required for canonical
      // caching across the two projections.
      view: "summary" as never,
    } as SessionListParams),
    queryFn: ({ signal }) => listSessionsPage(listParams, signal),
    placeholderData: keepPreviousData,
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const timeline = query.data?.timeline;

  // Sort + offset are URL-owned — server-side pagination requires that
  // changing sort/page actually refetch (not just re-render), so the
  // DataTable's onSortingChange writes back to URL state via the page
  // composition shell's setter.
  const handleSortingChange = (
    next:
      | Array<{ id: string; desc: boolean }>
      | ((prev: Array<{ id: string; desc: boolean }>) => Array<{ id: string; desc: boolean }>),
  ) => {
    // TanStack hands us either a value or an updater; resolve both.
    // Resolve both value and updater forms.
    const resolved =
      typeof next === "function" ? next([{ id: state.sort, desc: state.order === "desc" }]) : next;
    const first = resolved[0];
    if (!first) {
      onStateChange({ sort: "costComputed", order: "desc" });
      return;
    }
    onStateChange({
      sort: first.id as typeof state.sort,
      order: first.desc ? "desc" : "asc",
      offset: 0,
    });
  };

  const currentSorting = [{ id: state.sort, desc: state.order === "desc" }];

  const handleRowClick = (row: SessionPageItem) => {
    navigate(`/sessions/${row.sessionId}`);
  };

  const handleRowActionLabel = (row: SessionPageItem) => `View session ${row.sessionId}`;

  return (
    <section
      data-testid="session-browser"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
          Sessions ({total.toLocaleString()})
        </h2>
        <div className="flex items-center gap-2">
          <ViewToggle
            value={state.browserView}
            onChange={(v) => onStateChange({ browserView: v })}
          />
        </div>
      </div>

      {query.isError && (
        <p role="alert" className="mt-2 text-sm text-[#B23A3A] dark:text-[#E05252]">
          {query.error.message}
        </p>
      )}

      {state.browserView === "table" ? (
        <div className="mt-4">
          <DataTable
            data={items}
            columns={pageColumns}
            isLoading={query.isPending}
            label="Sessions table"
            manualSorting
            sorting={currentSorting}
            onSortingChange={handleSortingChange}
            getRowId={(row) => row.sessionId}
            onRowClick={handleRowClick}
            getRowActionLabel={handleRowActionLabel}
            empty={<EmptyState message="No sessions match these filters." />}
          />
        </div>
      ) : (
        <TimelineView
          items={timeline?.items ?? []}
          sampled={timeline?.sampled ?? false}
          matched={timeline?.matched ?? 0}
          eligible={timeline?.eligible ?? 0}
          excludedInvalidTime={timeline?.excludedInvalidTime ?? 0}
          isPending={query.isPending}
          isError={!!query.isError}
        />
      )}

      <Pagination
        offset={state.offset}
        limit={PAGE_SIZE}
        total={total}
        onChange={(offset) => onStateChange({ offset })}
      />
    </section>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: "table" | "timeline";
  onChange: (next: "table" | "timeline") => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {(["table", "timeline"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={clsx(TOGGLE_CLASS, value === v && TOGGLE_ACTIVE_CLASS)}
        >
          {v === "table" ? "Table" : "Timeline"}
        </button>
      ))}
    </div>
  );
}

interface TimelineViewProps {
  items: SessionTimelineItem[];
  sampled: boolean;
  matched: number;
  eligible: number;
  excludedInvalidTime: number;
  isPending: boolean;
  isError: boolean;
}

function TimelineView({
  items,
  sampled,
  matched,
  eligible,
  excludedInvalidTime,
  isPending,
  isError,
}: TimelineViewProps) {
  if (isError) {
    return null;
  }
  if (isPending) {
    return (
      <p role="status" className="mt-4 text-sm text-slate-500 dark:text-[#8B98A9]">
        Loading…
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <p className="mt-4 text-sm text-slate-500 dark:text-[#8B98A9]">
        No timeline-eligible sessions in this population.
      </p>
    );
  }
  return (
    <div className="mt-4">
      <ul
        aria-label="Sessions timeline"
        className="flex flex-col gap-1"
        data-testid="sessions-timeline"
      >
        {items.map((item) => (
          <li key={item.sessionId}>
            <a
              href={`/sessions/${item.sessionId}`}
              className="flex items-baseline justify-between gap-2 rounded border border-slate-200 px-2 py-1 text-sm hover:bg-slate-50 dark:border-[#232B36] dark:hover:bg-[#0B0F14]"
            >
              <span className="font-mono text-xs text-slate-700 dark:text-[#8A96A5]">
                {item.sessionId.slice(0, 8)}
              </span>
              <span className="flex-1 truncate text-slate-700 dark:text-[#E8EDF2]">
                {item.project}
              </span>
              <time className="text-xs text-slate-500 dark:text-[#8A96A5]">
                {new Date(item.startedAt).toISOString().slice(0, 10)} →{" "}
                {new Date(item.lastAt).toISOString().slice(0, 10)}
              </time>
              <span className="font-mono text-xs tabular-nums text-slate-700 dark:text-[#E8EDF2]">
                {formatUnitValue(item.costComputed, "$")}
              </span>
            </a>
          </li>
        ))}
      </ul>
      {(sampled || excludedInvalidTime > 0) && (
        <p className="mt-2 text-xs text-slate-500 dark:text-[#8A96A5]">
          Showing {items.length} of {matched} matched ({eligible} eligible, {excludedInvalidTime}{" "}
          excluded for invalid timestamps)
          {sampled ? " — sampled for the 500-item cap" : ""}
        </p>
      )}
    </div>
  );
}

interface PaginationProps {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
}

function Pagination({ offset, limit, total, onChange }: PaginationProps) {
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="mt-3 flex items-center justify-end gap-2">
      <button
        type="button"
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
        className={TOGGLE_CLASS}
      >
        Prev
      </button>
      <span className="text-xs text-slate-500 dark:text-[#8A96A5]">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={offset + limit >= total}
        onClick={() => onChange(offset + limit)}
        className={TOGGLE_CLASS}
      >
        Next
      </button>
    </div>
  );
}
