import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "wouter";
import type { SessionListParams, TracePoint } from "../../../../shared/sessions-contract.js";
import { qk } from "../../api/queryKeys.js";
import { listSessions } from "../../api/sessions.js";
import { Badge } from "../../components/Badge.js";
import { EmptyState } from "../../components/EmptyState.js";
import { costTierLevel, TierBadge } from "../../components/TierBadge.js";
import { type FilterState, resolveRange, serializeFilters } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";

const CURRENCY_FORMAT = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const TIME_FORMAT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

/** Maps the global filter bar's `FilterState` to the `SessionListParams` for
 * "most recent session matching the active filters" — mirrors
 * `filtersToQuery` (`filters/state.ts`) but targets the sessions-list wire
 * contract instead of the metrics one. */
function sessionParamsFromFilters(filters: FilterState): SessionListParams {
  const { from, to } = resolveRange(filters.range, new Date());
  const params: SessionListParams = {
    sort: "lastAt",
    order: "desc",
    limit: 1,
    include: "trace",
    from,
    to,
  };
  if (filters.project.length > 0) params.project = filters.project;
  if (filters.model.length > 0) params.model = filters.model;
  if (filters.branch.length > 0) params.branch = filters.branch;
  if (filters.host.length > 0) params.host = filters.host;
  return params;
}

function shortId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

function formatTimeRange(startedAt: string, lastAt: string): string {
  const start = new Date(startedAt);
  const end = new Date(lastAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  return `${TIME_FORMAT.format(start)}–${TIME_FORMAT.format(end)}`;
}

function contextPctLabel(contextPctEstimated: number | undefined): string {
  // Undefined means the server couldn't resolve the model's context window
  // (derive-session.ts) — show "—", never a fabricated number.
  if (contextPctEstimated === undefined) return "—";
  return `ctx ${Math.round(contextPctEstimated * 100)}%`;
}

interface TraceThumbnailProps {
  trace: TracePoint[];
}

/** Bar-per-turn cost trace, scaled to the session's own peak turn — the
 * "trace thumbnail" from the mockup's sparkline-in-a-panel treatment,
 * rendered as bars (not a polyline) since `TracePoint.cost` is a discrete
 * per-turn value, not a continuous series. */
function TraceThumbnail({ trace }: TraceThumbnailProps) {
  if (trace.length === 0) return null;

  const width = 100;
  const height = 32;
  const maxCost = Math.max(...trace.map((p) => p.cost), 0);
  const barWidth = width / trace.length;
  const peak = trace.reduce((best, p) => (p.cost > best.cost ? p : best), trace[0] as TracePoint);

  const ariaLabel = `Cost trace across ${trace.length} turn${trace.length === 1 ? "" : "s"}, peaking at ${CURRENCY_FORMAT.format(peak.cost)} on turn ${peak.turnIndex + 1}`;

  return (
    <>
      <span className="sr-only" role="img" aria-label={ariaLabel}>
        {ariaLabel}
      </span>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="mt-2 h-8 w-full"
      >
        {trace.map((point, i) => {
          const barHeight = maxCost > 0 ? (point.cost / maxCost) * height : 0;
          return (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: trace points are a fixed, ordered snapshot from the server — turnIndex isn't guaranteed unique across sessions but is stable within this one render
              key={i}
              x={i * barWidth}
              y={height - barHeight}
              width={Math.max(barWidth - 1, 0.5)}
              height={barHeight}
              className="fill-[#96631E] dark:fill-[#E8A33D]"
            />
          );
        })}
      </svg>
    </>
  );
}

/**
 * The Dashboard's "most recent session" card (ARCH-dashboard-page.md T9):
 * cost, project/time summary, turns count, estimated context %, and a
 * per-turn cost trace thumbnail for the single most-recent session
 * matching the active global filters. Fetches independently of
 * `StatCardsRow` (its own `useQuery`), so a slow/erroring
 * `GET /api/sessions` never blocks the stat cards from rendering.
 */
export function RecentSessionCard() {
  const { filters } = useFilters();
  const filtersKey = serializeFilters(filters);

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey) — same pattern as ChartCard.tsx
  const params = useMemo<SessionListParams>(() => sessionParamsFromFilters(filters), [filtersKey]);

  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.sessions(params),
    queryFn: ({ signal }) => listSessions(params, signal),
    placeholderData: keepPreviousData,
  });

  const session = data?.items[0];

  return (
    <section
      aria-label="Most recent session"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
          Most recent session
        </h2>
        {data ? (
          <div className="flex items-center gap-2">
            <TierBadge level={costTierLevel(data.meta.globalCapture)}>
              {data.meta.globalCapture.costBasis === "observed" ? "$ observed" : "$ computed"}
            </TierBadge>
            {session ? (
              <Link
                href={`/sessions/${session.sessionId}`}
                className="font-mono text-[11px] text-slate-500 hover:text-slate-900 dark:text-[#8A96A5] dark:hover:text-[#E8EDF2]"
              >
                open →
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      {isPending && (
        <p role="status" className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">
          Loading…
        </p>
      )}

      {isError && (
        <p role="alert" className="mt-3 text-sm text-[#B23A3A] dark:text-[#E05252]">
          {error instanceof Error ? error.message : "Failed to load the most recent session"}
        </p>
      )}

      {!isPending && !isError && !session && (
        <div className="mt-3">
          <EmptyState message="No sessions match the current filters." />
        </div>
      )}

      {session && (
        <>
          <div className="mt-2 flex flex-wrap items-baseline gap-3">
            <span className="font-mono text-[26px] font-medium text-[#96631E] dark:text-[#E8A33D]">
              {CURRENCY_FORMAT.format(session.costComputed)}
            </span>
            <span className="font-mono text-xs text-slate-500 dark:text-[#8A96A5]">
              {shortId(session.sessionId)} · {session.project} ·{" "}
              {formatTimeRange(session.startedAt, session.lastAt)}
            </span>
            <Badge>{`${session.turnCount} turns`}</Badge>
            <Badge>{contextPctLabel(session.contextPctEstimated)}</Badge>
          </div>
          {session.trace ? <TraceThumbnail trace={session.trace} /> : null}
        </>
      )}
    </section>
  );
}
