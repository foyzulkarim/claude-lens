import { Link, useSearch } from "wouter";
import type {
  TurnInspectorNav,
  TurnInspectorSummary,
} from "../../../../shared/turn-inspector-contract.js";
import { Badge } from "../../components/Badge.js";
import { formatCost, formatDuration, formatPercentile, formatTokens, shortId } from "./format.js";

export interface TurnSummaryProps {
  summary: TurnInspectorSummary;
  nav: TurnInspectorNav;
}

/**
 * Turn summary panel (#P4-6): $, tokens, models, percentile vs. the user's
 * turn history, and prev/next nav to adjacent turns in the same session.
 * Preserves the current querystring on nav links, matching Session Detail's
 * turn-table drill-link convention (TurnsSection.tsx).
 */
export function TurnSummary({ summary, nav }: TurnSummaryProps): React.JSX.Element {
  const search = useSearch();
  const suffix = search ? `?${search}` : "";

  return (
    <section
      aria-label="Turn summary"
      data-testid="turn-inspector-summary"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
          Turn {summary.turnNumber} of {summary.totalTurns} — session{" "}
          <span className="font-mono text-xs text-slate-500 dark:text-[#8A96A5]">
            {shortId(summary.sessionId)}
          </span>
        </h1>
        <Link
          href={`/sessions/${summary.sessionId}${suffix}`}
          className="text-xs text-sky-600 hover:underline dark:text-sky-400"
        >
          ← session
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-3">
        <span className="font-mono text-2xl font-semibold text-emerald-700 dark:text-emerald-400">
          {formatCost(summary.cost)}
        </span>
        {summary.fleetPercentile !== null && (
          <Badge variant={summary.isAnomaly ? "fail" : "neutral"}>
            {formatPercentile(summary.fleetPercentile)} of your turns
          </Badge>
        )}
        <Badge>{formatTokens(summary.tokens)} tokens</Badge>
        <Badge>{summary.callCount} API calls</Badge>
        {summary.models.map((model) => (
          <Badge key={model}>{model}</Badge>
        ))}
        <span className="ml-auto flex gap-3 font-mono text-xs text-slate-500 dark:text-[#8A96A5]">
          {nav.prevTurnNumber !== null ? (
            <Link href={`/session/${summary.sessionId}/turn/${nav.prevTurnNumber}${suffix}`}>
              ← turn {nav.prevTurnNumber}
            </Link>
          ) : (
            <span className="opacity-40">← turn</span>
          )}
          {nav.nextTurnNumber !== null ? (
            <Link href={`/session/${summary.sessionId}/turn/${nav.nextTurnNumber}${suffix}`}>
              turn {nav.nextTurnNumber} →
            </Link>
          ) : (
            <span className="opacity-40">turn →</span>
          )}
        </span>
      </div>

      {summary.promptText && (
        <p className="mt-3 border-l-2 border-slate-200 pl-2.5 text-xs text-slate-500 dark:border-[#232B36] dark:text-[#8A96A5]">
          "{summary.promptText}"
        </p>
      )}

      <p className="mt-2 font-mono text-[11px] text-slate-400 dark:text-[#5A6675]">
        {summary.wallMs !== undefined ? (
          `wall ${formatDuration(summary.wallMs)}`
        ) : (
          <>
            api/wall time <Badge variant="premium">needs cost capture</Badge> — widths below use
            timestamp deltas
          </>
        )}
      </p>
    </section>
  );
}
