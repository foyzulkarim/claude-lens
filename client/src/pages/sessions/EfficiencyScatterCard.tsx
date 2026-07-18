import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useMemo, useState } from "react";
import { qk } from "../../api/queryKeys.js";
import { postScatterMetrics } from "../../api/metrics.js";
import { Chart } from "../../charts/Chart.js";
import { buildScatterOption } from "../../charts/scatterOption.js";
import type { ScatterMeasure } from "../../../../shared/metrics-contract.js";
import { useFilters } from "../../filters/useFilters.js";
import { useStableNow } from "../dashboard/useStableNow.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import {
  type ScatterPreset,
  type SessionsPageState,
  buildScatterQuery,
  scatterPresets,
} from "./state.js";

// ARCH A4 / A9 / A11: scatter runs server-side on the canonical session
// population. The presets write the same `xMeasure`/`yMeasure` shape that
// a custom selection would, so the section composition is uniform and
// the regression/eligibility metadata always discloses what was sampled
// or unavailable.

const MEASURE_LABEL: Record<ScatterMeasure, string> = {
  costComputed: "Cost ($)",
  costObserved: "Observed $",
  inputTokens: "Input tokens",
  outputTokens: "Output tokens",
  cacheReadTokens: "Cache read tokens",
  cacheCreateTokens: "Cache create tokens",
  apiCalls: "API calls",
  turns: "Turns",
  sessions: "Sessions",
  toolCalls: "Tool calls",
  cacheHitPct: "Cache %",
  wallMinutes: "Duration (min)",
  apiMs: "API latency (ms)",
  linesAdded: "Lines added",
  linesRemoved: "Lines removed",
  gatePassRate: "Gate pass rate",
  toolErrors: "Tool errors",
  cacheSavingsComputed: "Cache savings ($)",
  routingSavingsComputed: "Routing savings ($)",
  totalTokens: "Total tokens",
};

export interface EfficiencyScatterCardProps {
  state: SessionsPageState;
  onStateChange: (patch: Partial<SessionsPageState>) => void;
  /** Optional injection seam for stories / tests. */
  now?: Date;
}

export function EfficiencyScatterCard({
  state,
  onStateChange,
  now: injectedNow,
}: EfficiencyScatterCardProps) {
  const { filters } = useFilters();
  const now = useStableNow(injectedNow);

  const query = useMemo(() => buildScatterQuery(state, filters, now), [state, filters, now]);

  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.metrics(query),
    queryFn: ({ signal }) => postScatterMetrics(query, signal),
    placeholderData: keepPreviousData,
  });
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const option = useMemo(() => {
    if (!data) return null;
    return buildScatterOption(data.points, data.regression, {
      xLabel: MEASURE_LABEL[data.xMeasure] ?? data.xMeasure,
      yLabel: MEASURE_LABEL[data.yMeasure] ?? data.yMeasure,
    });
  }, [data]);

  return (
    <section
      data-testid="efficiency-scatter-card"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
          Efficiency scatter
        </h2>
        <div className="flex items-center gap-1">
          {scatterPresets().map((p) => (
            <PresetButton
              key={p.id}
              id={p.id}
              label={p.label}
              active={state.scatterPreset === p.id}
              onSelect={(id) => onStateChange({ scatterPreset: id })}
            />
          ))}
        </div>
      </div>

      {isPending && (
        <p role="status" className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">
          Loading…
        </p>
      )}
      {isError && (
        <p role="alert" className="mt-3 text-sm text-[#B23A3A] dark:text-[#E05252]">
          {error.message}
        </p>
      )}

      {!isPending && option && (
        <div className="mt-4">
          <Chart
            option={option}
            className="h-72 w-full"
            onPointClick={(params) => {
              const value = params.value;
              if (Array.isArray(value) && typeof value[2] === "string") {
                setSelectedSessionId(value[2]);
              }
            }}
            ariaLabel={
              data
                ? `Scatter chart; ${data.population.eligible} eligible points; ${
                    data.regression ? "regression line shown" : "no regression"
                  }`
                : undefined
            }
          />
          {data && (
            <p className="mt-2 text-xs text-slate-500 dark:text-[#8A96A5]">
              {data.population.eligible} eligible of {data.population.matched} matched
              {data.population.excludedMissingMeasures > 0
                ? ` · ${data.population.excludedMissingMeasures} excluded for missing measures`
                : ""}
              {data.population.sampled
                ? ` · sampled to ${data.population.returned} visual points`
                : ""}
              {data.regression
                ? ` · slope ${data.regression.slope.toFixed(3)} · intercept ${data.regression.intercept.toFixed(3)} · R² ${data.regression.rSquared.toFixed(3)}`
                : ""}
            </p>
          )}
          {data && (
            <table className="sr-only">
              <caption>Scatter points. Activate a session to select its point.</caption>
              <thead>
                <tr>
                  <th scope="col">Session</th>
                  <th scope="col">{MEASURE_LABEL[data.xMeasure]}</th>
                  <th scope="col">{MEASURE_LABEL[data.yMeasure]}</th>
                </tr>
              </thead>
              <tbody>
                {data.points.map((point) => (
                  <tr key={point.sessionId}>
                    <td>
                      <button
                        type="button"
                        aria-pressed={selectedSessionId === point.sessionId}
                        onClick={() => setSelectedSessionId(point.sessionId)}
                      >
                        {point.sessionId}
                      </button>
                    </td>
                    <td>{point.x}</td>
                    <td>{point.y}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {selectedSessionId && (
            <p className="sr-only" aria-live="polite">
              Selected point: {selectedSessionId}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function PresetButton({
  id,
  label,
  active,
  onSelect,
}: {
  id: ScatterPreset;
  label: string;
  active: boolean;
  onSelect: (id: ScatterPreset) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={active}
      className={clsx(TOGGLE_CLASS, active && TOGGLE_ACTIVE_CLASS)}
    >
      {label}
    </button>
  );
}
