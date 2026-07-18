import { useMemo } from "react";
import { Chart } from "../../charts/Chart.js";
import { buildContextGrowthOption } from "./chart-options.js";
import { TierBadge } from "../../components/TierBadge.js";
import type { ContextGrowthSection } from "../../../../shared/cache-lab-contract.js";

/**
 * Cache Lab context-growth panel (ARCH §T6 R9): per-session token-
 * estimated input context, one curve per session. Always marked
 * token-estimated today — observed values land under #P4-13 with a
 * separate `basis` variant.
 *
 * The server caps curves at CACHE_LAB_LIMITS.CONTEXT_MAX_CURVES (24)
 * and surfaces `total` + `truncated` so the header can honestly
 * disclose the bound.
 */
export function ContextGrowthPanel({
  data,
  error,
}: {
  data: ContextGrowthSection | undefined;
  error?: Error | null;
}) {
  const option = useMemo(
    () => (data ? buildContextGrowthOption(data.curves) : buildContextGrowthOption([])),
    [data],
  );
  const summary = useMemo(() => {
    if (!data) return { total: 0, finiteBuckets: 0 };
    let total = 0;
    let finiteBuckets = 0;
    for (const curve of data.curves) {
      for (const point of curve.points) {
        if (typeof point.inputTokens === "number" && Number.isFinite(point.inputTokens)) {
          total += point.inputTokens;
          finiteBuckets++;
        }
      }
    }
    return { total, finiteBuckets };
  }, [data]);

  return (
    <section
      data-testid="context-growth-panel"
      aria-labelledby="context-growth-heading"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="context-growth-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          Context growth (token-estimated)
        </h2>
        <div className="flex items-center gap-2">
          <TierBadge level="estimated" />
          <p className="font-mono text-xs text-slate-600 dark:text-[#8A96A5]">
            {data
              ? data.truncated
                ? `showing ${data.curves.length} of ${data.total}`
                : `${data.total} session${data.total === 1 ? "" : "s"}`
              : error
                ? "Unavailable"
                : "Loading…"}
          </p>
        </div>
      </div>

      {!data || data.curves.length === 0 ? (
        <p
          role={error ? "alert" : "status"}
          className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]"
        >
          {error
            ? `Cache Lab analysis failed: ${error.message}`
            : data
              ? "No context curves in range."
              : "Loading…"}
        </p>
      ) : (
        <>
          <Chart
            option={option}
            className="mt-4 h-72 w-full"
            ariaLabel={`Context growth across ${data.curves.length} sessions, top ${data.total}`}
          />
          <p className="mt-2 font-mono text-xs text-slate-600 dark:text-[#8A96A5]">
            {summary.finiteBuckets} turn points · {data.curves.length} curves
          </p>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-medium text-[#96631E] dark:text-[#E8A33D]">
              View context-growth data table
            </summary>
            <table className="mt-2 w-full text-left text-xs">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Turn</th>
                  <th>Timestamp</th>
                  <th>Input tokens</th>
                </tr>
              </thead>
              <tbody>
                {data.curves.flatMap((curve) =>
                  curve.points.map((point) => (
                    <tr key={`${curve.sessionId}-${point.turnIndex}`}>
                      <td>{curve.sessionId}</td>
                      <td>{point.turnIndex + 1}</td>
                      <td>{point.timestamp}</td>
                      <td>{point.inputTokens}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </details>
          <p role="status" aria-live="polite" className="sr-only">
            Context growth updated: {data.curves.length} curves.
          </p>
        </>
      )}
    </section>
  );
}
