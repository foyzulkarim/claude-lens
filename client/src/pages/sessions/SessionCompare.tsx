import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { SessionPageItem } from "../../../../shared/sessions-contract.js";
import { qk } from "../../api/queryKeys.js";
import { listSessionsPage } from "../../api/sessions.js";
import { formatDuration, formatUnitValue } from "../../charts/units.js";
import { EmptyState } from "../../components/EmptyState.js";
import { useFilters } from "../../filters/useFilters.js";
import { useStableNow } from "../dashboard/useStableNow.js";
import { buildListQuery, type SessionsPageState } from "./state.js";

export interface SessionCompareProps {
  state: SessionsPageState;
  onStateChange: (patch: Partial<SessionsPageState>) => void;
  /** Optional injection seam for stories / tests. */
  now?: Date;
}

const COMPARE_ID_MAX = 3;

type CompareField = {
  label: string;
  resolve: (item: SessionPageItem) => string;
};

const COMPARE_FIELDS: CompareField[] = [
  { label: "Project", resolve: (i) => i.project },
  {
    label: "Models",
    resolve: (i) => i.models.join(", ") || "—",
  },
  { label: "Branch", resolve: (i) => i.branch ?? "—" },
  { label: "Entrypoint", resolve: (i) => i.entrypoint },
  { label: "Version", resolve: (i) => i.version },
  { label: "Duration", resolve: (i) => formatDuration(i.durationMs) },
  { label: "Turns", resolve: (i) => String(i.turnCount) },
  { label: "Tokens", resolve: (i) => formatUnitValue(i.totalTokens, "tokens") },
  { label: "Cost", resolve: (i) => formatUnitValue(i.costComputed, "$") },
  { label: "Cache %", resolve: (i) => `${Math.round(i.cacheHitPct * 100)}%` },
  {
    label: "Observed $",
    resolve: (i) => (i.costObserved === undefined ? "—" : formatUnitValue(i.costObserved, "$")),
  },
];

/**
 * Compare panel for the Sessions page (ARCH R7 / R10). Hydrates up to
 * three IDs under the active population filters via the same list endpoint
 * — IDs that no longer match the population render an unavailable state
 * rather than fetching outside the filter.
 */
export function SessionCompare({ state, onStateChange, now: injectedNow }: SessionCompareProps) {
  const { filters } = useFilters();
  const now = useStableNow(injectedNow);

  // Always send `view=page` with the sessionId narrow so the list
  // endpoint resolves only the selected IDs against the active population.
  // When fewer than 2 IDs are selected the section renders an empty
  // selection prompt (per ARCH R7).
  const baseParams = buildListQuery({ ...state, offset: 0 }, filters, now);
  const compareParams = {
    ...baseParams,
    limit: COMPARE_ID_MAX,
    sort: "lastAt" as const,
    order: "desc" as const,
  };
  const query = useQuery({
    queryKey: qk.sessions({ ...compareParams, view: "page" } as Parameters<typeof qk.sessions>[0]),
    queryFn: ({ signal }) => listSessionsPage(compareParams, signal),
    enabled: state.compareIds.length >= 2,
    placeholderData: keepPreviousData,
  });

  const items = query.data?.items ?? [];

  return (
    <section
      data-testid="session-compare"
      aria-label="Compare sessions"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
          Compare sessions
        </h2>
        <p className="text-xs text-slate-500 dark:text-[#8A96A5]">
          {state.compareIds.length}/{COMPARE_ID_MAX} selected — select two or three rows from the
          table to compare.
        </p>
      </div>
      {state.compareIds.length < 2 && (
        <div className="mt-3">
          <EmptyState message="Select 2–3 sessions from the table to compare." />
        </div>
      )}
      {state.compareIds.length >= 2 && (
        <div className="mt-3 overflow-x-auto">
          {query.isError ? (
            <p role="alert" className="text-sm text-[#B23A3A] dark:text-[#E05252]">
              {query.error.message}
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b border-slate-200 p-2 text-left text-[10px] uppercase tracking-wider text-slate-600 dark:border-[#232B36] dark:text-[#8A96A5]">
                    Field
                  </th>
                  {items.map((item) => (
                    <th
                      key={item.sessionId}
                      className="border-b border-slate-200 p-2 text-left text-[10px] uppercase tracking-wider text-slate-600 dark:border-[#232B36] dark:text-[#8A96A5]"
                    >
                      {item.sessionId.slice(0, 8)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_FIELDS.map((field) => (
                  <tr key={field.label}>
                    <td className="border-b border-slate-100 p-2 text-slate-600 dark:border-[#232B36] dark:text-[#8A96A5]">
                      {field.label}
                    </td>
                    {items.map((item) => (
                      <td
                        key={`${field.label}-${item.sessionId}`}
                        className="border-b border-slate-100 p-2 font-mono tabular-nums"
                      >
                        {field.resolve(item)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {state.compareIds.some((id) => !items.find((i) => i.sessionId === id)) && (
            <p className="mt-2 text-xs text-slate-500 dark:text-[#8A96A5]">
              One or more selected IDs no longer match the current filters.
            </p>
          )}
        </div>
      )}
      {/* Selection from the table would be wired through the page composition
          shell's onStateChange (the same setter every other section uses).
          Hidden until the browser exposes a selection model;
          selection-from-URL is the authoritative source per ARCH R10. */}
      {state.compareIds.length > 0 && (
        <button
          type="button"
          className="mt-3 text-xs text-slate-500 underline hover:text-slate-700 dark:text-[#8A96A5] dark:hover:text-[#E8EDF2]"
          onClick={() => onStateChange({ compareIds: [] })}
        >
          Clear comparison
        </button>
      )}
    </section>
  );
}
