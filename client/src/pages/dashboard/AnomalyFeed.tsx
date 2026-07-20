import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "wouter";
import { detectTurnCostAnomalies, type TurnCostSample } from "../../../../shared/anomaly.js";
import { letterFromScore, type ScoreLetter } from "../../../../shared/gates-contract.js";
import type {
  SessionListItem,
  SessionListParams,
  SessionPageItem,
} from "../../../../shared/sessions-contract.js";
import { getConfig } from "../../api/config.js";
import { fetchWorstGateFailures } from "../../api/gate-failures.js";
import { qk } from "../../api/queryKeys.js";
import { listSessions } from "../../api/sessions.js";
import { formatUnitValue } from "../../charts/units.js";
import { filtersToQuery } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";
import { useStableNow } from "./useStableNow.js";

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
 * independently testable from the fetch that supplies its input. `factor`
 * is the Settings-configured anomaly multiplier (#P4-15); omitted falls
 * back to the detector's own built-in default (5). */
export function anomalyItemsFromSamples(
  samples: TurnCostSample[],
  limit = MAX_ANOMALY_ITEMS,
  factor?: number,
): AnomalyFeedItem[] {
  const { baseline, flagged } = detectTurnCostAnomalies(samples, factor);
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

const LETTER_SEVERITY: Record<ScoreLetter, AnomalySeverity> = {
  A: "low",
  B: "low",
  C: "medium",
  D: "high",
  F: "high",
};

// `letterFromScore` lives in `gates-contract.ts` (#P4-12 review
// finding #9) — we used to keep a local copy here.

/**
 * Convert worst-scoring Sessions page rows into `gateFailure` feed items
 * (ARCH-p4-12 §High-Level Structure; gated on the live `gateFailure`
 * data the Dashboard feed exposes for the first time in #P4-12).
 * Pure for testability — the fetch lives in the component.
 */
export function gateFailureItemsFromSessions(
  sessions: readonly SessionPageItem[],
  limit = MAX_ANOMALY_ITEMS,
): AnomalyFeedItem[] {
  const out: AnomalyFeedItem[] = [];
  for (const s of sessions) {
    if (s.gateScore === undefined || s.gateStatus === undefined) continue;
    const letter = letterFromScore(s.gateScore);
    const severity = LETTER_SEVERITY[letter];
    // Skip pure-pass rows; mirror the engine's own rollup semantics
    // (pass/warn/fail across six checks). The wire surface only carries
    // the rolled-up status, so the data source is already filtered.
    if (s.gateStatus === "pass") continue;
    out.push({
      kind: "gateFailure",
      sessionId: s.sessionId,
      severity,
      summary: `Session scored ${letter} (${s.gateScore.toFixed(2)}) — ${s.gateStatus}`,
      drill: `/sessions/${s.sessionId}#report-card`,
    });
    if (out.length >= limit) break;
  }
  return out;
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
  /** Injection seam for stories/tests; defaults to the real current time. */
  now?: Date;
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
  // Review #16/#19: per-row `aria-label` on the drill link so screen readers
  // announce which session/turn the link opens (the visible "View →" text is
  // identical across every row and useless as a row distinguisher).
  const drillLabel = `View session ${item.sessionId}${item.turnId ? `, ${item.turnId}` : ""}`;
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
        aria-label={drillLabel}
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
export function AnomalyFeed({ items, now: injectedNow }: AnomalyFeedProps) {
  const { filters } = useFilters();
  // Review #4: same stale-closure bug class as the live-window cards fixed
  // in PR #89's two follow-up commits. `useMemo(() => new Date(), [])`
  // froze `now` at mount forever — anomaly detection stopped including
  // newer sessions.
  const now = useStableNow(injectedNow);
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

  // Settings-configured anomaly multiplier (#P4-15). A brief render with the
  // detector's built-in default (5) while this resolves is acceptable —
  // same tradeoff BudgetForecastPanel.tsx already ships with for its own
  // getConfig() load.
  const configQuery = useQuery({
    queryKey: qk.config(),
    queryFn: ({ signal }) => getConfig(signal),
    enabled: items === undefined,
  });

  // Live gate-failure feed (#P4-12). Reuses the Sessions list wire shape
  // with `sort=gateScore&order=asc&limit=5`; the row projector (T4)
  // populates `gateScore` from the gate cache. Same filter scope as the
  // anomaly detector so the two feed lines stay aligned.
  const gateParams = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      project: filters.project,
      model: filters.model,
      branch: filters.branch,
      host: filters.host,
    }),
    [range.from, range.to, filters.project, filters.model, filters.branch, filters.host],
  );
  const gateFailuresQuery = useQuery({
    queryKey: qk.gateFailures(gateParams),
    queryFn: ({ signal }) => fetchWorstGateFailures(gateParams, signal),
    enabled: items === undefined,
    staleTime: 60_000,
  });

  // Compute anomaly items and gate-failure items INDEPENDENTLY
  // (#P4-12 review finding #28): the previous shape short-circuited
  // both lists behind `if (!sessionsQuery.data) return [];`, which
  // blocked `gateItems` from rendering on the slower `gateFailuresQuery`
  // by coupling it to the slower `sessionsQuery`. Splitting the
  // computations lets the gate-failure list show as soon as the gate
  // endpoint resolves, and lets the anomaly list show as soon as the
  // session endpoint resolves.
  const anomalyItems = useMemo<AnomalyFeedItem[]>(() => {
    if (items !== undefined) return items;
    if (!sessionsQuery.data) return [];
    const samples = turnSamplesFromSessions(sessionsQuery.data.items);
    return anomalyItemsFromSamples(samples, undefined, configQuery.data?.anomalyFactor);
  }, [items, sessionsQuery.data, configQuery.data?.anomalyFactor]);

  const gateItems = useMemo<AnomalyFeedItem[]>(() => {
    if (items !== undefined) return [];
    if (!gateFailuresQuery.data) return [];
    return gateFailureItemsFromSessions(gateFailuresQuery.data);
  }, [items, gateFailuresQuery.data]);

  const detectedItems = useMemo<AnomalyFeedItem[]>(
    () => [...anomalyItems, ...gateItems],
    [anomalyItems, gateItems],
  );

  // Surface errors from BOTH queries (#P4-12 review findings #13/#29):
  // the pre-fix shape only checked `sessionsQuery.isError`, so a failed
  // gate fetch was silently swallowed. Show whichever fired first.
  // Use `useQuery`'s `isError` (a real boolean) rather than `error !==
  // undefined` — TanStack Query's `error` is `null` on success, and
  // `null !== undefined` would otherwise trip `isError` even on a
  // resolved query.
  const sessionsError = items === undefined && sessionsQuery.isError ? sessionsQuery.error : null;
  const gateError =
    items === undefined && gateFailuresQuery.isError ? gateFailuresQuery.error : null;
  const errorMessage = sessionsError?.message ?? gateError?.message ?? "";
  const isLoading = items === undefined && (sessionsQuery.isPending || gateFailuresQuery.isPending);
  const isError = sessionsError !== null || gateError !== null;

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
      {isError && errorMessage && (
        <p role="alert" className="mt-3 text-sm text-[#B23A3A] dark:text-[#E05252]">
          {errorMessage}
        </p>
      )}

      {!isLoading && !isError && (
        <>
          {detectedItems.length > 0 && (
            // Review #16: drop `role="feed"` — it carries a full ARIA APG
            // contract (owned `article` children + position/setsize attrs)
            // that a bounded static list of 5 items doesn't earn. Plain
            // `<ul>` gives screen readers the same role semantics without
            // the broken contract.
            <ul aria-label="Anomaly items" className="mt-3">
              {detectedItems.map((item) => (
                <AnomalyFeedRow
                  key={`${item.kind}-${item.sessionId}-${item.turnId ?? ""}`}
                  item={item}
                />
              ))}
            </ul>
          )}

          {items === undefined && detectedItems.length === 0 && (
            <p role="status" className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">
              No anomalies or gate failures detected.
            </p>
          )}

          {items !== undefined && detectedItems.length === 0 && (
            <p role="status" className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">
              No anomalies detected.
            </p>
          )}
        </>
      )}
    </div>
  );
}
