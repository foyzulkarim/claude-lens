import clsx from "clsx";
import type {
  Dimension,
  DistributionEntity,
  Grain,
  Measure,
  ScatterMeasure,
} from "../../../../shared/metrics-contract.js";
import { DIMENSIONS, GRAINS, MEASURES } from "../../../../shared/metrics-contract.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import {
  type PivotChart,
  PIVOT_CHARTS,
  PIVOT_MODES,
  type PivotMode,
  type PivotState,
} from "./state.js";

/**
 * Pivot builder controls (ARCH-explore-page.md §11). All controls are
 * controlled — they read from `state` and call setters that write back to
 * the URL via `usePivotState`. The component renders three regions:
 *   1. Always-visible controls: Measure, Dimension, Grain, Chart, Save
 *   2. Scatter-variant controls (when chart=scatter): X, Y, Size
 *   3. Distribution-variant controls (when mode=distribution): Entity
 *
 * Native `<select>` elements (mirroring `ChartCard.tsx`'s grain selector)
 * keep the markup small and accessible by default. The Chart-type and
 * Mode controls are segmented toggle groups — they're bounded to a small
 * set so a button row is faster to scan than a dropdown.
 */

const MEASURE_LABEL: Record<Measure, string> = {
  costComputed: "Computed $",
  costObserved: "Observed $",
  inputTokens: "Input tokens",
  outputTokens: "Output tokens",
  cacheReadTokens: "Cache read tokens",
  cacheCreateTokens: "Cache write tokens",
  apiCalls: "API calls",
  turns: "Turns",
  sessions: "Sessions",
  toolCalls: "Tool calls",
  cacheHitPct: "Cache hit %",
  wallMinutes: "Wall minutes",
  apiMs: "API latency (ms)",
  linesAdded: "Lines added",
  linesRemoved: "Lines removed",
  gatePassRate: "Gate pass rate",
  toolErrors: "Tool errors",
  cacheSavingsComputed: "Cache savings ($)",
  routingSavingsComputed: "Routing savings ($)",
};

const SCATTER_MEASURE_LABEL: Record<ScatterMeasure, string> = {
  ...MEASURE_LABEL,
  totalTokens: "Total tokens",
};

const DIMENSION_LABEL: Record<Dimension, string> = {
  time: "time",
  project: "project",
  model: "model",
  gitBranch: "branch",
  version: "CC version",
  entrypoint: "entrypoint",
  sidechain: "main vs sidechain",
  tool: "tool name",
  gateStatus: "gate status",
  host: "host",
};

const GRAIN_LABEL: Record<Grain, string> = {
  hour: "hour",
  day: "day",
  week: "week",
  month: "month",
};

const CHART_LABEL: Record<PivotChart, string> = {
  bar: "bar",
  line: "line",
  area: "area",
  scatter: "scatter",
  table: "table",
};

const ENTITY_LABEL: Record<DistributionEntity, string> = {
  session: "session",
  turn: "turn",
  call: "call",
};

const SELECT_CLASS = clsx(
  TOGGLE_CLASS,
  "border border-slate-200 bg-white pr-6 dark:border-[#232B36] dark:bg-[#0B0F14]",
);

export interface PivotBuilderProps {
  state: PivotState;
  onMeasureChange(measure: Measure): void;
  onDimChange(dim: Dimension): void;
  onGrainChange(grain: Grain): void;
  onChartChange(chart: PivotChart): void;
  onModeChange(mode: PivotMode): void;
  onEntityChange(entity: DistributionEntity): void;
  onXChange(x: ScatterMeasure): void;
  onYChange(y: ScatterMeasure): void;
  onSizeChange(size: ScatterMeasure | undefined): void;
}

export function PivotBuilder({
  state,
  onMeasureChange,
  onDimChange,
  onGrainChange,
  onChartChange,
  onModeChange,
  onEntityChange,
  onXChange,
  onYChange,
  onSizeChange,
}: PivotBuilderProps) {
  const isScatter = state.chart === "scatter";
  const isDistribution = !isScatter && state.mode === "distribution";

  return (
    <section
      aria-label="Pivot builder"
      className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Build a view</h2>
      <div className="flex flex-wrap items-center gap-2">
        {!isScatter && (
          <>
            <ControlLabel htmlFor="xp-measure">Measure</ControlLabel>
            <select
              id="xp-measure"
              data-testid="xp-measure"
              value={state.measure}
              onChange={(e) => onMeasureChange(e.target.value as Measure)}
              className={SELECT_CLASS}
            >
              {MEASURES.map((m) => (
                <option key={m} value={m}>
                  {MEASURE_LABEL[m]}
                </option>
              ))}
            </select>

            <ControlLabel htmlFor="xp-dim">Dimension</ControlLabel>
            <select
              id="xp-dim"
              data-testid="xp-dim"
              value={state.dim}
              onChange={(e) => onDimChange(e.target.value as Dimension)}
              className={SELECT_CLASS}
            >
              {DIMENSIONS.filter((d) => d !== "time").map((d) => (
                <option key={d} value={d}>
                  {DIMENSION_LABEL[d]}
                </option>
              ))}
            </select>

            <ControlLabel htmlFor="xp-grain">Grain</ControlLabel>
            <select
              id="xp-grain"
              data-testid="xp-grain"
              value={state.grain}
              onChange={(e) => onGrainChange(e.target.value as Grain)}
              className={SELECT_CLASS}
            >
              {GRAINS.map((g) => (
                <option key={g} value={g}>
                  {GRAIN_LABEL[g]}
                </option>
              ))}
            </select>
          </>
        )}

        <ControlLabel as="span">Chart</ControlLabel>
        <fieldset aria-label="Chart type" className="flex items-center gap-1 border-0 p-0">
          {PIVOT_CHARTS.map((chart) => (
            <button
              key={chart}
              type="button"
              aria-pressed={state.chart === chart}
              data-testid={`xp-chart-${chart}`}
              onClick={() => onChartChange(chart)}
              className={clsx(TOGGLE_CLASS, state.chart === chart && TOGGLE_ACTIVE_CLASS)}
            >
              {CHART_LABEL[chart]}
            </button>
          ))}
        </fieldset>

        <ControlLabel as="span">Mode</ControlLabel>
        <fieldset
          aria-label="Series or distribution"
          className="flex items-center gap-1 border-0 p-0"
        >
          {PIVOT_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={state.mode === mode}
              disabled={isScatter}
              data-testid={`xp-mode-${mode}`}
              onClick={() => onModeChange(mode)}
              className={clsx(
                TOGGLE_CLASS,
                state.mode === mode && !isScatter && TOGGLE_ACTIVE_CLASS,
                isScatter && "cursor-not-allowed opacity-40",
              )}
            >
              {mode}
            </button>
          ))}
        </fieldset>

        {isDistribution && (
          <>
            <ControlLabel htmlFor="xp-entity">Entity</ControlLabel>
            <select
              id="xp-entity"
              data-testid="xp-entity"
              value={state.entity}
              onChange={(e) => onEntityChange(e.target.value as DistributionEntity)}
              className={SELECT_CLASS}
            >
              {(Object.keys(ENTITY_LABEL) as DistributionEntity[]).map((entity) => (
                <option key={entity} value={entity}>
                  {ENTITY_LABEL[entity]}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {isScatter && (
        <div className="flex flex-wrap items-center gap-2">
          <ControlLabel htmlFor="xp-x">X</ControlLabel>
          <select
            id="xp-x"
            data-testid="xp-x"
            value={state.x}
            onChange={(e) => onXChange(e.target.value as ScatterMeasure)}
            className={SELECT_CLASS}
          >
            {SCATTER_MEASURES.map((m) => (
              <option key={m} value={m}>
                {SCATTER_MEASURE_LABEL[m]}
              </option>
            ))}
          </select>
          <ControlLabel htmlFor="xp-y">Y</ControlLabel>
          <select
            id="xp-y"
            data-testid="xp-y"
            value={state.y}
            onChange={(e) => onYChange(e.target.value as ScatterMeasure)}
            className={SELECT_CLASS}
          >
            {SCATTER_MEASURES.map((m) => (
              <option key={m} value={m}>
                {SCATTER_MEASURE_LABEL[m]}
              </option>
            ))}
          </select>
          <ControlLabel htmlFor="xp-size">Size</ControlLabel>
          <select
            id="xp-size"
            data-testid="xp-size"
            value={state.size ?? ""}
            onChange={(e) =>
              onSizeChange(e.target.value === "" ? undefined : (e.target.value as ScatterMeasure))
            }
            className={SELECT_CLASS}
          >
            <option value="">—</option>
            {SCATTER_MEASURES.map((m) => (
              <option key={m} value={m}>
                {SCATTER_MEASURE_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
      )}
    </section>
  );
}

/** The ScatterMeasure union = Measure ∪ {"totalTokens"}. Build the
 * option list inline rather than re-exporting a constant from the shared
 * contract (the contract intentionally keeps this in a type-only position). */
const SCATTER_MEASURES: readonly ScatterMeasure[] = [...MEASURES, "totalTokens"];

function ControlLabel({
  htmlFor,
  as = "label",
  children,
}: {
  htmlFor?: string;
  as?: "label" | "span";
  children: React.ReactNode;
}) {
  const className =
    "ml-1 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-[#8A96A5]";
  if (as === "span") {
    return <span className={className}>{children}</span>;
  }
  return (
    <label htmlFor={htmlFor} className={className}>
      {children}
    </label>
  );
}
