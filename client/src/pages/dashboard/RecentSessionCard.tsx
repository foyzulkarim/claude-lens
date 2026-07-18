import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "wouter";
import type { SessionListParams, TracePoint } from "../../../../shared/sessions-contract.js";
import { qk } from "../../api/queryKeys.js";
import { listSessions } from "../../api/sessions.js";
import { Badge } from "../../components/Badge.js";
import { EmptyState } from "../../components/EmptyState.js";
import { costTierLevel, TierBadge } from "../../components/TierBadge.js";
import { formatUnitValue } from "../../charts/units.js";
import { type FilterState, resolveRange, serializeFilters } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";
import { useStableNow } from "./useStableNow.js";

const TIME_FORMAT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

/** Maps the global filter bar's `FilterState` to the `SessionListParams` for
 * "most recent session matching the active filters" — mirrors
 * `filtersToQuery` (`filters/state.ts`) but targets the sessions-list wire
 * contract instead of the metrics one. */
function sessionParamsFromFilters(filters: FilterState, now: Date): SessionListParams {
  const { from, to } = resolveRange(filters.range, now);
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

/**
 * Diff each consecutive `TracePoint` into its per-turn cost. The server
 * (server/routes/sessions.ts `buildTrace`) emits cumulative priced-turn
 * costs — turning `[1, 11, 12]` into per-turn `[1, 10, 1]` so the bar
 * chart, peak calculation, and aria label all describe actual turn costs
 * rather than "running total". Review #10 / CQ3.
 */
export function perTurnCosts(trace: TracePoint[]): number[] {
  const deltas: number[] = [];
  let previous = 0;
  for (const point of trace) {
    // Clamp negative deltas to 0 — float noise / zero-cost turns should
    // never read as a negative bar (mirrors `AnomalyFeed.turnSamplesFromSessions`).
    deltas.push(Math.max(0, point.cost - previous));
    previous = point.cost;
  }
  return deltas;
}

/** Bar-per-turn cost trace, scaled to the session's own peak turn — the
 * "trace thumbnail" from the mockup's sparkline-in-a-panel treatment,
 * rendered as bars (not a polyline) since each `TracePoint` represents a
 * discrete turn. Review #10: converts cumulative server-side values to
 * per-turn deltas first so the bars represent turn cost, not running total
 * (the cumulative-vs-per-turn bug CQ3 was flagging). */
function TraceThumbnail({ trace }: TraceThumbnailProps) {
  const deltas = perTurnCosts(trace);
  if (deltas.length === 0) return null;

  const width = 100;
  const height = 32;
  const maxDelta = Math.max(...deltas, 0);
  const barWidth = width / deltas.length;
  // Find the peak delta's index (not the trace point with highest cumulative
  // cost, which is almost always the last point — the bug review #10 was
  // flagging).
  let peakIndex = 0;
  for (let i = 1; i < deltas.length; i++) {
    if ((deltas[i] ?? 0) > (deltas[peakIndex] ?? 0)) peakIndex = i;
  }
  const peakDelta = deltas[peakIndex] ?? 0;

  const ariaLabel = `Cost trace across ${deltas.length} turn${deltas.length === 1 ? "" : "s"}, peaking at ${formatUnitValue(peakDelta, "$")} on turn ${peakIndex + 1}`;

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
        {deltas.map((delta, i) => {
          const barHeight = maxDelta > 0 ? (delta / maxDelta) * height : 0;
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
export interface RecentSessionCardProps {
  /** Injection seam for stories/tests; defaults to the real current time. */
  now?: Date;
}

export function RecentSessionCard({ now: injectedNow }: RecentSessionCardProps = {}) {
  const { filters } = useFilters();
  const filtersKey = serializeFilters(filters);
  // Review #4: same stale-closure bug class as the live-window cards fixed
  // in PR #89's two follow-up commits. `new Date()` here froze the from/to
  // range to mount time — a dashboard left open silently stopped including
  // newer sessions in "most recent".
  const now = useStableNow(injectedNow);

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey); now ticks on its own via useStableNow
  const params = useMemo<SessionListParams>(
    () => sessionParamsFromFilters(filters, now),
    [filtersKey, now],
  );

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
              {formatUnitValue(session.costComputed, "$")}
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
