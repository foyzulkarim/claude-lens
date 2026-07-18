import { useMemo, useState } from "react";
import { Link } from "wouter";
import clsx from "clsx";
import type {
  SessionDetailDistribution,
  SessionDetailTurn,
} from "../../../../shared/session-detail-contract.js";
import { formatCost, formatPercent, formatTokens } from "./format.js";

export interface TurnsSectionProps {
  turns: SessionDetailTurn[];
  distribution: SessionDetailDistribution;
}

/**
 * Turn analysis core (#P4-5, T8). Three semantic regions:
 *
 *  1. Stacked main/sidechain per-turn cost bars (the binding spec's "each
 *     logical turn is one bar/row" — main and sidechain segments reconcile
 *     to total). Anomalies render in a distinct rose color.
 *  2. Virtualized-feel turn table (we render every row, but the table
 *     has explicit row boundaries and keyboard drill). Clicking a row
 *     drills into `/session/:id/turn/:n` (one-based) — the canonical
 *     evidence-link shape established in gates.md.
 *  3. History distribution: per-turn percentile (vs the fleet's
 *     logical-turn cost baseline), the population size, p50/p90/p99, and
 *     a histogram.
 *
 * Pure: never re-groups sidechains or recomputes ranks — every value comes
 * straight from the server's projected `turnDistribution` and `turns`.
 */
export function TurnsSection({ turns, distribution }: TurnsSectionProps): React.JSX.Element {
  const peak = useMemo(
    () => turns.reduce((m, t) => (t.cost > m ? t.cost : m), 0),
    [turns],
  );

  return (
    <section
      aria-labelledby="session-detail-turns"
      data-testid="session-detail-turns"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 id="session-detail-turns" className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
        Turns
      </h2>

      <div className="mt-3" aria-labelledby="turns-bars-heading">
        <h3 id="turns-bars-heading" className="text-xs font-medium text-slate-500 dark:text-[#8A96A5]">
          Per-turn cost
        </h3>
        <TurnBars turns={turns} peak={peak} />
      </div>

      <div className="mt-6" aria-labelledby="turns-table-heading">
        <h3 id="turns-table-heading" className="text-xs font-medium text-slate-500 dark:text-[#8A96A5]">
          Turn table
        </h3>
        <TurnTable turns={turns} />
      </div>

      <div className="mt-6" aria-labelledby="turns-distribution-heading">
        <h3
          id="turns-distribution-heading"
          className="text-xs font-medium text-slate-500 dark:text-[#8A96A5]"
        >
          Turn cost vs your history
        </h3>
        <HistoryDistribution distribution={distribution} turns={turns} />
      </div>
    </section>
  );
}

function TurnBars({ turns, peak }: { turns: SessionDetailTurn[]; peak: number }): React.JSX.Element {
  if (turns.length === 0) {
    return (
      <p className="mt-2 text-xs text-slate-500 dark:text-[#8A96A5]">
        No turns yet.
      </p>
    );
  }
  return (
    <ul aria-label="Per-turn cost bars" className="mt-2 space-y-1">
      {turns.map((turn) => {
        const totalWidth = peak > 0 ? (turn.cost / peak) * 100 : 0;
        const mainWidth = peak > 0 ? (turn.mainCost / peak) * 100 : 0;
        const sideWidth = Math.max(totalWidth - mainWidth, 0);
        return (
          <li
            key={turn.turnNumber}
            className="flex items-center gap-2 text-xs"
            aria-label={`Turn ${turn.turnNumber} — ${formatCost(turn.cost)}`}
          >
            <span className="w-8 text-right font-mono text-slate-500 dark:text-[#8A96A5]">
              #{turn.turnNumber}
            </span>
            <div className="relative h-3 flex-1 rounded bg-slate-100 dark:bg-[#232B36]">
              <div
                className={clsx(
                  "absolute inset-y-0 left-0 rounded",
                  turn.isAnomaly ? "bg-rose-500" : "bg-[#96631E] dark:bg-[#E8A33D]",
                )}
                style={{ width: `${mainWidth}%` }}
              >
                <span className="sr-only">main thread: {formatCost(turn.mainCost)}</span>
              </div>
              {turn.hasSidechain && sideWidth > 0 ? (
                <div
                  className="absolute inset-y-0 rounded bg-slate-400 dark:bg-slate-500"
                  style={{ left: `${mainWidth}%`, width: `${sideWidth}%` }}
                >
                  <span className="sr-only">sidechain: {formatCost(turn.sidechainCost)}</span>
                </div>
              ) : null}
            </div>
            <span className="w-16 text-right font-mono text-slate-700 dark:text-[#E8EDF2]">
              {formatCost(turn.cost)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function TurnTable({ turns }: { turns: SessionDetailTurn[] }): React.JSX.Element {
  if (turns.length === 0) {
    return (
      <p className="mt-2 text-xs text-slate-500 dark:text-[#8A96A5]">
        No turns yet.
      </p>
    );
  }
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wide text-slate-500 dark:border-[#232B36] dark:text-[#8A96A5]">
            <th className="py-1 pr-2">#</th>
            <th className="py-1 pr-2">$</th>
            <th className="py-1 pr-2">tokens</th>
            <th className="py-1 pr-2">hit %</th>
            <th className="py-1 pr-2">calls</th>
            <th className="py-1 pr-2">tools</th>
            <th className="py-1 pr-2">models</th>
            <th className="py-1 pr-2">anomaly</th>
          </tr>
        </thead>
        <tbody>
          {turns.map((turn) => (
            <tr
              key={turn.turnNumber}
              className="border-b border-slate-100 dark:border-[#232B36]"
            >
              <td className="py-1 pr-2 font-mono">
                <Link
                  href={`/session/${turn.promptId}/turn/${turn.turnNumber}`}
                  className="text-slate-900 underline-offset-2 hover:underline dark:text-[#E8EDF2]"
                  data-testid={`turn-drill-${turn.turnNumber}`}
                >
                  #{turn.turnNumber}
                </Link>
              </td>
              <td className="py-1 pr-2 font-mono">{formatCost(turn.cost)}</td>
              <td className="py-1 pr-2 font-mono">{formatTokens(turn.tokens)}</td>
              <td className="py-1 pr-2 font-mono">{Math.round(turn.cacheHitPct * 100)}%</td>
              <td className="py-1 pr-2 font-mono">{turn.callCount}</td>
              <td className="py-1 pr-2 font-mono">
                {turn.tools
                  .slice(0, 2)
                  .map((t) => `${t.name}×${t.count}`)
                  .join(", ")}
              </td>
              <td className="py-1 pr-2 font-mono">{turn.primaryModel || "—"}</td>
              <td className="py-1 pr-2 font-mono">
                {turn.isAnomaly ? (
                  <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-700 dark:bg-rose-900/30 dark:text-rose-200">
                    flag
                  </span>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryDistribution({
  distribution,
  turns,
}: {
  distribution: SessionDetailDistribution;
  turns: SessionDetailTurn[];
}): React.JSX.Element {
  const [hovered, setHovered] = useState<number | null>(null);
  const peakHistogram = useMemo(
    () => distribution.histogram.reduce((m, h) => (h.count > m ? h.count : m), 0),
    [distribution.histogram],
  );

  return (
    <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
      <div>
        <dl className="grid grid-cols-4 gap-2 text-xs">
          <Stat label="Population" value={String(distribution.populationSize)} />
          <Stat label="p50" value={formatCost(distribution.p50)} />
          <Stat label="p90" value={formatCost(distribution.p90)} />
          <Stat label="p99" value={formatCost(distribution.p99)} />
        </dl>

        <ul
          aria-label="Per-turn percentile"
          className="mt-3 max-h-32 space-y-1 overflow-y-auto"
          onMouseLeave={() => setHovered(null)}
        >
          {turns.map((turn) => {
            const pct = turn.fleetPercentile;
            return (
              <li
                key={turn.turnNumber}
                className="flex items-center gap-2 text-[11px]"
                onMouseEnter={() => setHovered(turn.turnNumber)}
              >
                <span className="w-8 font-mono text-slate-500 dark:text-[#8A96A5]">
                  #{turn.turnNumber}
                </span>
                <div className="relative h-2 flex-1 rounded bg-slate-100 dark:bg-[#232B36]">
                  <div
                    className="absolute inset-y-0 left-0 rounded bg-sky-600 dark:bg-sky-400"
                    style={{ width: pct === null ? "0%" : `${pct}%` }}
                  />
                </div>
                <span className="w-12 text-right font-mono text-slate-700 dark:text-[#E8EDF2]">
                  {pct === null ? "—" : formatPercent(pct)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-[#8A96A5]">
          Histogram ({distribution.histogram.length} buckets)
        </p>
        <ul
          aria-label="Cost distribution histogram"
          className="mt-2 flex h-24 items-end gap-px"
        >
          {distribution.histogram.map((bucket, i) => {
            const height = peakHistogram > 0 ? (bucket.count / peakHistogram) * 100 : 0;
            return (
              <li
                key={i}
                className="flex-1"
                aria-label={`${formatCost(bucket.rangeStart)}–${formatCost(bucket.rangeEnd)}: ${bucket.count}`}
              >
                <div
                  className={clsx(
                    "w-full rounded-t",
                    hovered === i ? "bg-sky-500" : "bg-sky-300 dark:bg-sky-600",
                  )}
                  style={{ height: `${height}%` }}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-[#8A96A5]">
        {label}
      </dt>
      <dd className="font-mono text-sm text-slate-900 dark:text-[#E8EDF2]">{value}</dd>
    </div>
  );
}