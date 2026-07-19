import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useMemo, useState } from "react";
import type { SeriesMetricsQuery } from "../../../../shared/metrics-contract.js";
import { getConfig, putConfig } from "../../api/config.js";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { Chart } from "../../charts/Chart.js";
import { buildForecastBandOption, type ForecastPoint } from "../../charts/forecast.js";
import { formatUnitValue } from "../../charts/units.js";
import { filtersToQuery, serializeFilters } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import { useStableNow } from "../dashboard/useStableNow.js";
import { computeForecast, daysInUtcMonth, utcMonthStart } from "./forecast.js";

const METHODS: ("linear" | "ewma")[] = ["linear", "ewma"];

function toDateKey(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/** Running cumulative sum, keyed by day — the "Actual" line's input shape. */
function toCumulative(points: { t: string; value: number }[]): ForecastPoint[] {
  let running = 0;
  return points.map((p) => {
    running += p.value;
    return { t: toDateKey(p.t), value: running };
  });
}

function monthEndDateKey(now: Date): string {
  const daysInMonth = daysInUtcMonth(now);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), daysInMonth))
    .toISOString()
    .slice(0, 10);
}

export interface BudgetForecastPanelProps {
  now?: Date;
}

/**
 * Combined Budget + Forecast panel (ARCH-trends-calendar-budget.md decision
 * A2 — one panel, matching the mockup's single chart, rather than two
 * overlapping "will I exceed budget" visualizations). Owns the budget
 * input/save control (acceptance criteria: "budget value persists in
 * ~/.claude-lens/config.json") — the full Settings editor is #P4-15's job.
 */
export function BudgetForecastPanel({ now: injectedNow }: BudgetForecastPanelProps) {
  const { filters } = useFilters();
  const filtersKey = serializeFilters(filters);
  const now = useStableNow(injectedNow);
  const [method, setMethod] = useState<"linear" | "ewma">("linear");
  const [budgetInput, setBudgetInput] = useState("");
  const queryClient = useQueryClient();

  const configQuery = useQuery({
    queryKey: qk.config(),
    queryFn: ({ signal }) => getConfig(signal),
  });

  const saveMutation = useMutation({
    mutationFn: (budget: number | null) => putConfig({ budget }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.prefixes.config });
    },
  });

  const monthStart = useMemo(() => utcMonthStart(now), [now]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey)
  const query = useMemo<SeriesMetricsQuery>(
    () => ({
      measures: ["costComputed"],
      dimensions: [],
      grain: "day",
      range: { from: monthStart.toISOString(), to: now.toISOString() },
      filters: filtersToQuery(filters, now).filters,
    }),
    [monthStart, now, filtersKey],
  );

  const costQuery = useQuery({
    queryKey: qk.metrics(query),
    queryFn: ({ signal }) => postMetrics(query, signal),
    placeholderData: keepPreviousData,
  });

  const budget = configQuery.data?.budget ?? null;
  const dailyPoints = costQuery.data?.[0]?.points ?? [];

  const forecast = useMemo(
    () => computeForecast(dailyPoints, { now, method, budget }),
    [dailyPoints, now, method, budget],
  );

  const actual = useMemo(
    () => toCumulative(dailyPoints.map((p) => ({ t: p.t, value: p.value ?? 0 }))),
    [dailyPoints],
  );

  const option = useMemo(
    () => buildForecastBandOption(actual, forecast, monthEndDateKey(now)),
    [actual, forecast, now],
  );

  const isPending = configQuery.isPending || costQuery.isPending;
  const isError = configQuery.isError || costQuery.isError;
  const errorMessage = configQuery.error?.message ?? costQuery.error?.message;

  const pct = budget && budget > 0 ? Math.min(100, (forecast.mtd / budget) * 100) : 0;
  const overBudget = budget !== null && forecast.mtd > budget;

  function handleSave() {
    if (budgetInput.trim() === "") {
      saveMutation.mutate(null);
      return;
    }
    const parsed = Number(budgetInput);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    saveMutation.mutate(parsed);
  }

  return (
    <section
      data-testid="budget-forecast-panel"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
          Budget &amp; forecast
        </h2>
        <div className="flex items-center gap-1">
          {METHODS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              aria-pressed={method === m}
              className={clsx(TOGGLE_CLASS, method === m && TOGGLE_ACTIVE_CLASS)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="trends-budget-input" className="text-xs text-slate-500 dark:text-[#8A96A5]">
          Monthly budget cap
        </label>
        <input
          id="trends-budget-input"
          type="number"
          min="0"
          step="1"
          placeholder={budget !== null ? String(budget) : "not set"}
          value={budgetInput}
          onChange={(e) => setBudgetInput(e.target.value)}
          className="w-28 rounded border border-slate-200 bg-transparent px-2 py-1 text-xs dark:border-[#2A323D]"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className={TOGGLE_CLASS}
        >
          Save
        </button>
      </div>

      {isPending && (
        <p role="status" className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">
          Loading…
        </p>
      )}
      {isError && (
        <p role="alert" className="mt-3 text-sm text-[#B23A3A] dark:text-[#E05252]">
          {errorMessage}
        </p>
      )}

      {!isPending && !isError && (
        <>
          <div className="mt-4">
            {budget !== null ? (
              <div>
                <div
                  role="progressbar"
                  aria-label={`Budget usage: ${formatUnitValue(forecast.mtd, "$")} of ${formatUnitValue(budget, "$")} budget`}
                  aria-valuenow={Math.round(Math.min(forecast.mtd, budget))}
                  aria-valuemin={0}
                  aria-valuemax={budget}
                  className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-[#0B0F14]"
                >
                  <div
                    className={
                      overBudget
                        ? "h-full rounded-full bg-[#B23A3A] dark:bg-[#E05252]"
                        : "h-full rounded-full bg-[#96631E] dark:bg-[#E8A33D]"
                    }
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-[#8A96A5]">
                  {formatUnitValue(forecast.mtd, "$")} of {formatUnitValue(budget, "$")} budget
                  {overBudget ? " — over budget" : ""}
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-[#8B98A9]">
                No budget set — set one above to see a projection band and Dashboard alerts.
              </p>
            )}
          </div>

          <Chart
            option={option}
            className="mt-4 h-64 w-full"
            ariaLabel="Month-to-date spend with projected month-end band"
          />

          {forecast.crossesBudgetAt && (
            <p className="mt-2 text-[11px] text-[#96631E] dark:text-[#E8A33D]">
              ⚠ upper band crosses cap around {forecast.crossesBudgetAt}
            </p>
          )}
          {forecast.projectedEndOfMonth === null && (
            <p className="mt-2 text-[11px] text-slate-500 dark:text-[#8A96A5]">
              Not enough data yet for a projection — check back after a few days of spend.
            </p>
          )}
        </>
      )}
    </section>
  );
}
