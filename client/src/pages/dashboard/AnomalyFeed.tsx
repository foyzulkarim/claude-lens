import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "wouter";
import { detectTurnCostAnomalies, type TurnCostSample } from "../../../../shared/anomaly.js";
import type { SessionListItem, SessionListParams } from "../../../../shared/sessions-contract.js";
import { qk } from "../../api/queryKeys.js";
import { listSessions } from "../../api/sessions.js";
import { formatUnitValue } from "../../charts/units.js";
import { filtersToQuery } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";

/** `include=trace` is capped at 25 by the sessions route (SESSIONS_TRACE_MAX_LIMIT) —
 * pulling that many of the highest-cost sessions gives the detector a
 * reasonably representative user-history population without a dedicated
 * per-turn-samples endpoint (none exists yet; see module doc below). */
const TRACE_SESSIONS_LIMIT = 25;
const MAX_ANOMALY_ITEMS = 5;

export type AnomalyItemKind = "anomaly" | "gateFailure" | "captureGap";
export type AnomalySeverity = "low" | "medium" | "high";

/**
 * The AnomalyFeed item contract (ARCH-dashboard-page.md T13): a stable shape
 * across all three kinds, even though only `anomaly` has a live data source
 * today. `gateFailure`/`captureGap` are reserved for #P4-12.
 */
export interface AnomalyFeedItem {
  kind: AnomalyItemKind;
  sessionId: string;
  turnId?: string;
  severity: AnomalySeverity;
  summary: string;
  drill: string;
}

function severityFor(ratioToBaseline: number): AnomalySeverity {
  if (ratioToBaseline >= 10) return "high";
  if (ratioToBaseline >= 5) return "medium";
  return "low";
}

/**
 * Turns a session's cumulative priced trace (`SessionListItem.trace`, opt-in
 * via `include=trace`) into per-turn cost deltas. The trace endpoint reports
 * *cumulative* cost per turn (server/routes/sessions.ts `buildTrace`), not
 * each turn's own cost, so consecutive points are diffed here to recover the
 * per-turn `TurnCostSample` shape the T3b detector expects. Negative deltas
 * (shouldn't occur since cost only accumulates, but guards against float
 * noise) are clamped to 0 rather than fabricating a value.
 */
export function turnSamplesFromSessions(sessions: SessionListItem[]): TurnCostSample[] {
  const samples: TurnCostSample[] = [];
  for (const session of sessions) {
    if (!session.trace) continue;
    let previous = 0;
    for (const point of session.trace) {
      const delta = Math.max(0, point.cost - previous);
      previous = point.cost;
      samples.push({
        sessionId: session.sessionId,
        turnId: `turn-${point.turnIndex}`,
        costComputed: delta,
      });
    }
  }
  return samples;
}

/** Maps the T3b detector's flagged samples into feed items — pure so it's
 * independently testable from the fetch that supplies its input. */
export function anomalyItemsFromSamples(
  samples: TurnCostSample[],
  limit = MAX_ANOMALY_ITEMS,
): AnomalyFeedItem[] {
  const { baseline, flagged } = detectTurnCostAnomalies(samples);
  if (baseline === null) return [];
  return flagged.slice(0, limit).map((sample) => ({
    kind: "anomaly" as const,
    sessionId: sample.sessionId,
    turnId: sample.turnId,
    severity: severityFor(sample.costComputed / baseline),
    summary: `Turn cost ${formatUnitValue(sample.costComputed, "$")} is ${(sample.costComputed / baseline).toFixed(1)}x the session median (${formatUnitValue(baseline, "$")})`,
    drill: `/sessions/${sample.sessionId}`,
  }));
}

export interface AnomalyFeedProps {
  /**
   * Overrides the internal detector-driven fetch and renders exactly this
   * list — the seam stories/tests use to exercise `gateFailure`/`captureGap`
   * rendering branches that have no live data source yet (#P4-12), and to
   * assert item-kind-specific rendering deterministically. When omitted
   * (the real Dashboard usage), the component fetches recent session traces
   * itself and runs the T3b anomaly detector over them.
   */
  items?: AnomalyFeedItem[];
}

const KIND_LABEL: Record<AnomalyItemKind, string> = {
  anomaly: "Cost anomaly",
  gateFailure: "Gate failure",
  captureGap: "Capture gap",
};

const SEVERITY_CLASS: Record<AnomalySeverity, string> = {
  high: "text-[#B23A3A] dark:text-[#E05252]",
  medium: "text-[#96631E] dark:text-[#E8A33D]",
  low: "text-slate-600 dark:text-[#8A96A5]",
};

function AnomalyFeedRow({ item }: { item: AnomalyFeedItem }) {
  return (
    <li className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 last:border-b-0 dark:border-[#232B36]">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-[#8A96A5]">
          {KIND_LABEL[item.kind]}
          <span className={`ml-2 ${SEVERITY_CLASS[item.severity]}`}>{item.severity}</span>
        </p>
        <p className="text-sm text-slate-900 dark:text-[#E8EDF2]">{item.summary}</p>
      </div>
      <Link
        href={item.drill}
        className="shrink-0 text-xs font-medium text-[#96631E] dark:text-[#E8A33D]"
      >
        View →
      </Link>
    </li>
  );
}

/**
 * Stable feed container for anomalous-cost / gate-failure / capture-gap
 * items (ARCH-dashboard-page.md T13). `anomaly` items are live, wired to the
 * T3b detector over pre-priced turn samples derived from session traces;
 * `gateFailure`/`captureGap` have no data source yet (#P4-12) so the default
 * (no `items` override, no detected anomalies) state is an explicit
 * "gate data not available yet" notice rather than a bare empty list.
 */
export function AnomalyFeed({ items }: AnomalyFeedProps) {
  const { filters } = useFilters();
  const now = useMemo(() => new Date(), []);
  const { range } = filtersToQuery(filters, now);

  // biome-ignore lint/correctness/useExhaustiveDependencies: range/filters covered via their JSON identity below
  const params = useMemo<SessionListParams>(
    () => ({
      sort: "costComputed",
      order: "desc",
      limit: TRACE_SESSIONS_LIMIT,
      include: "trace",
      from: range.from,
      to: range.to,
      project: filters.project,
      model: filters.model,
      branch: filters.branch,
      host: filters.host,
    }),
    [JSON.stringify(range), JSON.stringify(filters)],
  );

  const sessionsQuery = useQuery({
    queryKey: qk.sessions(params),
    queryFn: ({ signal }) => listSessions(params, signal),
    enabled: items === undefined,
  });

  const detectedItems = useMemo<AnomalyFeedItem[]>(() => {
    if (items !== undefined) return items;
    if (!sessionsQuery.data) return [];
    const samples = turnSamplesFromSessions(sessionsQuery.data.items);
    return anomalyItemsFromSamples(samples);
  }, [items, sessionsQuery.data]);

  const showGateStub = items === undefined;
  const isLoading = items === undefined && sessionsQuery.isPending;
  const isError = items === undefined && sessionsQuery.isError;

  return (
    <div
      data-testid="anomaly-feed"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Anomalies</h2>

      {isLoading && (
        <p role="status" className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">
          Loading…
        </p>
      )}
      {isError && (
        <p role="alert" className="mt-3 text-sm text-[#B23A3A] dark:text-[#E05252]">
          {sessionsQuery.error.message}
        </p>
      )}

      {!isLoading && !isError && (
        <>
          {detectedItems.length > 0 && (
            <ul role="feed" aria-label="Anomaly items" className="mt-3">
              {detectedItems.map((item) => (
                <AnomalyFeedRow
                  key={`${item.kind}-${item.sessionId}-${item.turnId ?? ""}`}
                  item={item}
                />
              ))}
            </ul>
          )}

          {showGateStub && (
            <p
              role={detectedItems.length === 0 ? "status" : undefined}
              className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]"
            >
              Gate failure and capture-gap data not available yet.
            </p>
          )}

          {!showGateStub && detectedItems.length === 0 && (
            <p role="status" className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">
              No anomalies detected.
            </p>
          )}
        </>
      )}
    </div>
  );
}
