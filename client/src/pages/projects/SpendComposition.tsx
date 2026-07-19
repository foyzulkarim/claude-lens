import clsx from "clsx";
import type { ECElementEvent } from "echarts/core";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import type { Grain, Series } from "../../../../shared/metrics-contract.js";
import { Chart } from "../../charts/Chart.js";
import { sessionsHrefForBucket } from "../../charts/drilldown.js";
import { formatUnitValue } from "../../charts/units.js";
import type { FilterState } from "../../filters/state.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import { buildSpendCompositionAreaOption, topNWithOther } from "./chart-options.js";

type Shape = "area" | "bars";

const SHAPES: { value: Shape; label: string }[] = [
  { value: "area", label: "stacked area" },
  { value: "bars", label: "grouped bars" },
];

export interface SpendCompositionProps {
  data: Series[] | undefined;
  filters: FilterState;
  grain: Grain;
  isPending?: boolean;
  isError?: boolean;
  error?: Error | null;
}

/** True only for an `ECElementEvent` whose hit element looks like a
 * `[isoTimestamp, value]` data point (the shape emitted by every
 * series in this chart). Falls through to `false` for legend /
 * axis clicks which carry a different payload shape — those stay no-ops. */
function isBucketClick(params: ECElementEvent): params is ECElementEvent & {
  value: [string, number];
} {
  if (!Array.isArray(params.value) || params.value.length !== 2) return false;
  const [ts, value] = params.value;
  return typeof ts === "string" && typeof value === "number" && Number.isFinite(value);
}

/**
 * Spend composition over time (pages spec §5 row 2): stacked-area
 * chart of `costComputed × time × project`, capped via
 * `topNWithOther` so dashboards with 50+ projects still render a
 * readable legend. Shape toggle (`area` / `grouped bars`) per the
 * mockup; the spec doesn't ship a unit toggle here — token / calls
 * views would each need their own secondary query, which the
 * architecture holds back until needed (decision A4: "every chart
 * uses the same query body"). Display prefs are local `useState`
 * per ARCH §11.
 *
 * Bucket clicks land at
 * `/sessions?from=<bucketStart>&to=<nextBucket>&<preserved>` — the
 * chart-layer `sessionsHrefForBucket` helper keeps the permalink
 * semantics identical to every other time-series chart on the
 * dashboard. The preserved chips come from the global filter
 * state, NOT Section B or C's selections: Section A's bucket click
 * is a "show me everything that happened during this bucket"
 * drill, not a project drill (that's Section B's row click).
 */
export function SpendComposition({
  data,
  filters,
  grain,
  isPending,
  isError,
  error,
}: SpendCompositionProps) {
  const [shape, setShape] = useState<Shape>("area");
  const [, navigate] = useLocation();

  const capped = useMemo(() => topNWithOther(data ?? [], 8), [data]);

  const option = useMemo(() => {
    if (capped.length === 0) return null;
    // The "bars" variant is the same series emitted as a
    // non-stacked bar per bucket — kept inline (no separate
    // `buildSpendCompositionBarsOption`) because the spec marks it
    // secondary and the renderer uses a different ECharts series
    // type. The architecture explicitly did not commit a tokens /
    // calls view here (display prefs, not data contract).
    if (shape === "bars") {
      return {
        ...buildSpendCompositionAreaOption(capped, { unit: "$", grain }),
        series: capped.map((s, i) => ({
          type: "bar" as const,
          name: s.label,
          color: i === capped.length - 1 && s.label === "other" ? "#9AA3AE" : undefined,
          data: s.points.map((p) => [p.t, p.value]),
          emphasis: { focus: "series" as const },
        })),
      };
    }
    return buildSpendCompositionAreaOption(capped, { unit: "$", grain });
  }, [capped, shape, grain]);

  const total = useMemo(() => {
    let sum = 0;
    for (const s of data ?? []) {
      for (const p of s.points) {
        const v = p.value;
        if (typeof v === "number" && Number.isFinite(v)) sum += v;
      }
    }
    return sum;
  }, [data]);

  const projectCount = useMemo(() => {
    const labels = new Set<string>();
    for (const s of data ?? []) labels.add(s.label || s.dimensionKey);
    return labels.size;
  }, [data]);

  const handlePointClick = (params: ECElementEvent) => {
    if (!isBucketClick(params)) return;
    const [timestamp] = params.value;
    navigate(sessionsHrefForBucket(timestamp, grain, filters));
  };

  return (
    <section
      data-testid="spend-composition"
      aria-labelledby="spend-composition-heading"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="spend-composition-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          Spend composition over time
        </h2>
        <fieldset className="flex gap-1" aria-label="Chart shape">
          {SHAPES.map((option_) => (
            <button
              key={option_.value}
              type="button"
              onClick={() => setShape(option_.value)}
              aria-pressed={shape === option_.value}
              className={clsx(TOGGLE_CLASS, shape === option_.value && TOGGLE_ACTIVE_CLASS)}
            >
              {option_.label}
            </button>
          ))}
        </fieldset>
      </div>

      {projectCount > 0 && (
        <p className="mt-1 font-mono text-[11px] text-slate-600 dark:text-[#8A96A5]">
          {projectCount} project{projectCount === 1 ? "" : "s"} · total{" "}
          {formatUnitValue(total, "$")}
        </p>
      )}

      <div className="relative mt-4">
        {isError ? (
          <p role="alert" className="text-sm text-[#B23A3A] dark:text-[#E05252]">
            {error?.message ?? "Failed to load spend composition"}
          </p>
        ) : isPending && capped.length === 0 ? (
          <p role="status" className="text-sm text-slate-500 dark:text-[#8B98A9]">
            Loading spend composition…
          </p>
        ) : capped.length === 0 ? (
          <p role="status" className="text-sm text-slate-500 dark:text-[#8B98A9]">
            No project spend in this range.
          </p>
        ) : option ? (
          <Chart
            option={option}
            className="h-72 w-full"
            ariaLabel={`Spend composition chart; ${projectCount} project${
              projectCount === 1 ? "" : "s"
            }; total ${formatUnitValue(total, "$")}`}
            onPointClick={handlePointClick}
          />
        ) : null}
      </div>
    </section>
  );
}
