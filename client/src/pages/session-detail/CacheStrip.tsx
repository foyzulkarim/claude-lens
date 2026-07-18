import type {
  SessionDetailCacheCause,
  SessionDetailCachePoint,
} from "../../../../shared/session-detail-contract.js";

export interface CacheStripProps {
  cache: SessionDetailCachePoint[];
}

/**
 * Per-call cache strip (#P4-5, T8). Each call's read vs write is rendered as
 * a stacked bar; K2-compatible cause labels (first-call, model-switch,
 * compaction, unexplained) explain why a write spike occurred. The strip's
 * summary is also exposed as a semantic table so the canvas isn't the
 * only readable representation.
 */
export function CacheStrip({ cache }: CacheStripProps): React.JSX.Element {
  if (cache.length === 0) {
    return (
      <section
        aria-label="Cache strip"
        data-testid="session-detail-cache"
        className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Cache strip</h2>
        <p className="mt-3 text-xs text-slate-500 dark:text-[#8A96A5]">No cache activity yet.</p>
      </section>
    );
  }

  const totalRead = cache.reduce((s, p) => s + p.cacheReadTokens, 0);
  const totalWrite = cache.reduce((s, p) => s + p.cacheCreateTokens, 0);
  const eligible = totalRead + totalWrite;
  const hitRate = eligible > 0 ? totalRead / eligible : 0;

  return (
    <section
      aria-label="Cache strip"
      data-testid="session-detail-cache"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Cache strip</h2>
        <span className="font-mono text-xs text-slate-500 dark:text-[#8A96A5]">
          hit rate {Math.round(hitRate * 100)}%
        </span>
      </div>

      <ul aria-label="Per-call cache read/write" className="mt-3 space-y-1">
        {cache.map((point) => (
          <CacheRow key={point.callIndex} point={point} totalReadWrite={eligible} />
        ))}
      </ul>

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-slate-500 dark:text-[#8A96A5]">
          Cause labels
        </summary>
        <table className="mt-2 w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wide text-slate-500 dark:border-[#232B36] dark:text-[#8A96A5]">
              <th className="py-1 pr-2">call</th>
              <th className="py-1 pr-2">cause</th>
              <th className="py-1 pr-2">spike</th>
            </tr>
          </thead>
          <tbody>
            {cache.map((point) => (
              <tr key={point.callIndex} className="border-b border-slate-100 dark:border-[#232B36]">
                <td className="py-1 pr-2 font-mono">#{point.callIndex + 1}</td>
                <td className="py-1 pr-2 font-mono">
                  <CauseBadge cause={point.cause} />
                </td>
                <td className="py-1 pr-2 font-mono">{point.isWriteSpike ? "yes" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function CacheRow({
  point,
  totalReadWrite,
}: {
  point: SessionDetailCachePoint;
  totalReadWrite: number;
}): React.JSX.Element {
  // Render a stacked bar with read and write portions at the call's own
  // share of the strip's total tokens. This keeps the visual proportion
  // across calls stable.
  const readRatio =
    point.cacheReadTokens + point.cacheCreateTokens > 0
      ? point.cacheReadTokens / (point.cacheReadTokens + point.cacheCreateTokens)
      : 0;
  // Width is bounded by the call's local eligible sum so a single huge
  // call doesn't visually flatten the strip.
  const localTokens = point.cacheReadTokens + point.cacheCreateTokens;
  const width = totalReadWrite > 0 ? (localTokens / totalReadWrite) * 100 : 0;
  return (
    <li
      className="flex items-center gap-2 text-[11px]"
      aria-label={`Call ${point.callIndex + 1} — ${formatTokens(point.cacheReadTokens)} read, ${formatTokens(point.cacheCreateTokens)} write`}
    >
      <span className="w-8 text-right font-mono text-slate-500 dark:text-[#8A96A5]">
        #{point.callIndex + 1}
      </span>
      <div className="relative h-2 flex-1 rounded bg-slate-100 dark:bg-[#232B36]">
        <div
          className="absolute inset-y-0 left-0 rounded bg-emerald-500"
          style={{ width: `${width * readRatio}%` }}
        >
          <span className="sr-only">read: {formatTokens(point.cacheReadTokens)}</span>
        </div>
        <div
          className="absolute inset-y-0 rounded bg-amber-500"
          style={{
            left: `${width * readRatio}%`,
            width: `${width * (1 - readRatio)}%`,
          }}
        >
          <span className="sr-only">write: {formatTokens(point.cacheCreateTokens)}</span>
        </div>
      </div>
      <CauseBadge cause={point.cause} />
    </li>
  );
}

function CauseBadge({ cause }: { cause: SessionDetailCacheCause }): React.JSX.Element {
  const labels: Record<SessionDetailCacheCause, string> = {
    "first-call": "first call",
    "model-switch": "model switch",
    compaction: "compaction",
    unexplained: "unexplained",
  };
  const colorClass: Record<SessionDetailCacheCause, string> = {
    "first-call": "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
    "model-switch": "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
    compaction: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
    unexplained: "bg-slate-100 text-slate-700 dark:bg-[#232B36] dark:text-[#8A96A5]",
  };
  return (
    <span
      className={`inline-block min-w-[88px] rounded px-1.5 py-0.5 text-center text-[10px] ${colorClass[cause]}`}
    >
      {labels[cause]}
    </span>
  );
}

function formatTokens(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}
