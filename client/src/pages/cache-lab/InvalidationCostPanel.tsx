import { useMemo, useState } from "react";
import clsx from "clsx";
import { Chart } from "../../charts/Chart.js";
import { formatUnitValue } from "../../charts/units.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import {
  buildInvalidationCostOption,
  buildInvalidationCostTotalsOption,
  classifySpanSummary,
  sumInvalidationCause,
} from "./chart-options.js";
import type { InvalidationCostPoint } from "../../../../shared/cache-lab-contract.js";

type Family = "trend" | "totals";
const FAMILIES: Family[] = ["trend", "totals"];

/**
 * Cache Lab invalidation-cost panel (ARCH §T6 R7): stacked cost by K2
 * cause over time, plus a one-bar-per-cause totals view as the
 * alternative. First-call spikes are excluded server-side; the page
 * only ever renders model-switch / compaction / unexplained.
 */
export function InvalidationCostPanel({
  points,
  error,
}: {
  points: InvalidationCostPoint[] | undefined;
  error?: Error | null;
}) {
  const resolvedPoints = points ?? [];
  const [family, setFamily] = useState<Family>("trend");
  const trendOption = useMemo(() => buildInvalidationCostOption(resolvedPoints), [resolvedPoints]);
  const totalsOption = useMemo(
    () => buildInvalidationCostTotalsOption(resolvedPoints),
    [resolvedPoints],
  );

  const summary = useMemo(
    () => ({
      totalModelSwitch: sumInvalidationCause(resolvedPoints, "modelSwitch"),
      totalCompaction: sumInvalidationCause(resolvedPoints, "compaction"),
      totalUnexplained: sumInvalidationCause(resolvedPoints, "unexplained"),
    }),
    [resolvedPoints],
  );

  const trendSummary = useMemo(
    () =>
      classifySpanSummary(
        resolvedPoints.map((p) => ({
          t: p.t,
          value: p.modelSwitch ?? p.compaction ?? p.unexplained,
        })),
      ),
    [resolvedPoints],
  );

  return (
    <section
      data-testid="invalidation-cost-panel"
      aria-labelledby="invalidation-cost-heading"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="invalidation-cost-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          Invalidation cost by cause
        </h2>
        <div className="flex gap-1">
          {FAMILIES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFamily(option)}
              aria-pressed={family === option}
              className={clsx(TOGGLE_CLASS, family === option && TOGGLE_ACTIVE_CLASS)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-1 text-xs text-slate-600 dark:text-[#8A96A5]">
        Bust-loss dollar split across model-switch / compaction / unexplained
      </p>

      {trendSummary.finiteBuckets === 0 ? (
        <p
          role={error ? "alert" : "status"}
          className="mt-4 text-sm text-slate-500 dark:text-[#8B98A9]"
        >
          {error
            ? `Cache Lab analysis failed: ${error.message}`
            : points
              ? "No invalidations in range."
              : "Loading…"}
        </p>
      ) : family === "trend" ? (
        <Chart
          option={trendOption}
          className="mt-4 h-72 w-full"
          ariaLabel={`Invalidation cost by cause: ${trendSummary.finiteBuckets} buckets`}
        />
      ) : (
        <Chart
          option={totalsOption}
          className="mt-4 h-72 w-full"
          ariaLabel="Total invalidation cost by cause"
        />
      )}

      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-slate-600 dark:text-[#8A96A5]">Model switch</dt>
          <dd className="font-mono text-slate-900 dark:text-[#E8EDF2]">
            {formatUnitValue(summary.totalModelSwitch, "$")}
          </dd>
        </div>
        <div>
          <dt className="text-slate-600 dark:text-[#8A96A5]">Compaction</dt>
          <dd className="font-mono text-slate-900 dark:text-[#E8EDF2]">
            {formatUnitValue(summary.totalCompaction, "$")}
          </dd>
        </div>
        <div>
          <dt className="text-slate-600 dark:text-[#8A96A5]">Unexplained</dt>
          <dd className="font-mono text-slate-900 dark:text-[#E8EDF2]">
            {formatUnitValue(summary.totalUnexplained, "$")}
          </dd>
        </div>
      </dl>
      {trendSummary.finiteBuckets > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium text-[#96631E] dark:text-[#E8A33D]">
            View invalidation-cost data table
          </summary>
          <table className="mt-2 w-full text-left text-xs">
            <thead>
              <tr>
                <th>Bucket</th>
                <th>Model switch</th>
                <th>Compaction</th>
                <th>Unexplained</th>
              </tr>
            </thead>
            <tbody>
              {resolvedPoints.map((point) => (
                <tr key={point.t}>
                  <td>{point.t}</td>
                  <td>{point.modelSwitch ?? "—"}</td>
                  <td>{point.compaction ?? "—"}</td>
                  <td>{point.unexplained ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        Invalidation cost {family} updated.
      </p>
    </section>
  );
}
