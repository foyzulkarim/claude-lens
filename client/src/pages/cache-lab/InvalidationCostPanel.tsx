import { useMemo, useState } from "react";
import clsx from "clsx";
import { Chart } from "../../charts/Chart.js";
import { formatUnitValue } from "../../charts/units.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import {
  buildInvalidationCostOption,
  buildInvalidationCostTotalsOption,
  classifySpanSummary,
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
export function InvalidationCostPanel({ points }: { points: InvalidationCostPoint[] }) {
  const [family, setFamily] = useState<Family>("trend");
  const trendOption = useMemo(() => buildInvalidationCostOption(points), [points]);
  const totalsOption = useMemo(() => buildInvalidationCostTotalsOption(points), [points]);

  const summary = useMemo(() => {
    const totalModelSwitch = points.reduce(
      (sum, p) =>
        sum +
        (typeof p.modelSwitch === "number" && Number.isFinite(p.modelSwitch) ? p.modelSwitch : 0),
      0,
    );
    const totalCompaction = points.reduce(
      (sum, p) =>
        sum +
        (typeof p.compaction === "number" && Number.isFinite(p.compaction) ? p.compaction : 0),
      0,
    );
    const totalUnexplained = points.reduce(
      (sum, p) =>
        sum +
        (typeof p.unexplained === "number" && Number.isFinite(p.unexplained) ? p.unexplained : 0),
      0,
    );
    return { totalModelSwitch, totalCompaction, totalUnexplained };
  }, [points]);

  const trendSummary = useMemo(
    () =>
      classifySpanSummary(
        points.map((p) => ({ t: p.t, value: p.modelSwitch ?? p.compaction ?? p.unexplained })),
      ),
    [points],
  );

  return (
    <section
      data-testid="invalidation-cost-panel"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
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
        <p role="status" className="mt-4 text-sm text-slate-500 dark:text-[#8B98A9]">
          No invalidations in range.
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
    </section>
  );
}
