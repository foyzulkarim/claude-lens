import { useMemo, useState } from "react";
import type React from "react";
import clsx from "clsx";
import type {
  SessionDetailTimelinePoint,
} from "../../../../shared/session-detail-contract.js";
import { formatCost, formatPercent, formatTokens } from "./format.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../../ui/toggleStyles.js";

export interface CostTimelineProps {
  timeline: SessionDetailTimelinePoint[];
}

type Display = "cumulative" | "per-turn";
type Metric = "cost" | "tokens" | "calls";

const DISPLAYS: Display[] = ["cumulative", "per-turn"];
const METRICS: Metric[] = ["cost", "tokens", "calls"];

/**
 * Fixed-session cost/tokens timeline (#P4-5, T7). One SVG with semantic
 * fallbacks: a per-call bar series, cumulative/per-turn + cost/token/call
 * toggle groups, turn rules, context trace line, and compaction flags.
 *
 * Implementation choice: semantic HTML bar series rather than ECharts
 * because the session's x-axis is fixed (call index, not a time series) and
 * the dense material facts (range, total, markers) belong on the DOM. The
 * architecture explicitly calls out not force-fitting `ChartCard` (range-
 * oriented) onto fixed-session data.
 */
export function CostTimeline({ timeline }: CostTimelineProps): React.JSX.Element {
  const [display, setDisplay] = useState<Display>("cumulative");
  const [metric, setMetric] = useState<Metric>("cost");

  const values = useMemo(() => projectValues(timeline, display, metric), [timeline, display, metric]);

  const total = useMemo(() => values.reduce((sum, v) => sum + v, 0), [values]);
  const peak = useMemo(() => values.reduce((m, v) => (v > m ? v : m), 0), [values]);
  const compactionFlags = useMemo(
    () => timeline.filter((p) => p.isCompaction).length,
    [timeline],
  );
  const turnCount = useMemo(
    () => new Set(timeline.filter((p) => p.isTurnBoundary).map((p) => p.turnNumber)).size,
    [timeline],
  );

  return (
    <section
      aria-label="Cost timeline"
      data-testid="session-detail-timeline"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Cost timeline</h2>
        <div className="flex flex-wrap items-center gap-1">
          <ToggleGroup
            options={DISPLAYS}
            value={display}
            onChange={setDisplay}
            label="Display"
          />
          <ToggleGroup options={METRICS} value={metric} onChange={setMetric} label="Metric" />
        </div>
      </div>

      <p className="sr-only" role="img" aria-label={summaryAriaLabel(values, metric, total)}>
        {summaryAriaLabel(values, metric, total)}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
        <Summary label={metricLabel(metric)} value={formatMetricValue(total, metric)} />
        <Summary label="Peak" value={formatMetricValue(peak, metric)} />
        <Summary label="Turns" value={String(turnCount)} />
        <Summary label="Compactions" value={String(compactionFlags)} />
      </div>

      <TimelineChart timeline={timeline} values={values} display={display} metric={metric} />
    </section>
  );
}

interface ToggleGroupProps<T extends string> {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}

function ToggleGroup<T extends string>({ options, value, onChange, label }: ToggleGroupProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      data-testid={`timeline-toggle-${label.toLowerCase()}`}
      className="inline-flex rounded border border-slate-200 dark:border-[#232B36]"
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={clsx(
            "px-2 py-1 text-xs",
            value === option ? TOGGLE_ACTIVE_CLASS : TOGGLE_CLASS,
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-[#8A96A5]">
        {label}
      </div>
      <div className="font-mono text-sm text-slate-900 dark:text-[#E8EDF2]">{value}</div>
    </div>
  );
}

interface TimelineChartProps {
  timeline: SessionDetailTimelinePoint[];
  values: number[];
  display: Display;
  metric: Metric;
}

function TimelineChart({ timeline, values, display, metric }: TimelineChartProps): React.JSX.Element {
  const width = 800;
  const height = 120;
  const padding = { top: 8, right: 8, bottom: 8, left: 8 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const peak = values.reduce((m, v) => (v > m ? v : m), 0);

  if (timeline.length === 0) {
    return (
      <p className="mt-3 text-sm text-slate-500 dark:text-[#8A96A5]">No calls yet.</p>
    );
  }

  const barWidth = innerWidth / values.length;

  return (
    <svg
      role="img"
      aria-label={`${display} ${metric} per call`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="mt-3 h-32 w-full"
    >
      {/* Bars */}
      {values.map((value, i) => {
        const barHeight = peak > 0 ? (value / peak) * innerHeight : 0;
        const x = padding.left + i * barWidth;
        const y = padding.top + innerHeight - barHeight;
        const isTurnBoundary = timeline[i]?.isTurnBoundary === true;
        const isCompaction = timeline[i]?.isCompaction === true;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={Math.max(barWidth - 1, 0.5)}
              height={barHeight}
              className={clsx(
                "fill-[#96631E] dark:fill-[#E8A33D]",
                isCompaction && "fill-rose-500 dark:fill-rose-400",
              )}
            >
              <title>
                {`Call ${i + 1} · ${timeline[i]?.timestamp ?? ""} · ${formatMetricValue(
                  value,
                  metric,
                )}${isTurnBoundary ? ` · turn ${timeline[i]?.turnNumber ?? ""}` : ""}${
                  isCompaction ? " · compaction" : ""
                }`}
              </title>
            </rect>
            {/* Turn rule: vertical line at the start of each turn boundary */}
            {isTurnBoundary ? (
              <line
                x1={x}
                x2={x}
                y1={padding.top}
                y2={padding.top + innerHeight}
                className="stroke-slate-400 dark:stroke-[#3B4654]"
                strokeDasharray="2 3"
                strokeWidth={1}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function projectValues(
  timeline: SessionDetailTimelinePoint[],
  display: Display,
  metric: Metric,
): number[] {
  if (timeline.length === 0) return [];
  const out: number[] = [];
  let prev = 0;
  for (let i = 0; i < timeline.length; i++) {
    const point = timeline[i];
    if (!point) continue;
    const raw = metricValue(point, metric);
    if (display === "per-turn") {
      out.push(raw - prev);
      prev = raw;
    } else {
      out.push(raw);
      prev = raw;
    }
  }
  return out;
}

function metricValue(point: SessionDetailTimelinePoint, metric: Metric): number {
  switch (metric) {
    case "cost":
      return point.cumulativeCost;
    case "tokens":
      return point.cumulativeTokens;
    case "calls":
      return point.callIndex + 1;
  }
}

function metricLabel(metric: Metric): string {
  switch (metric) {
    case "cost":
      return "Total cost";
    case "tokens":
      return "Total tokens";
    case "calls":
      return "Calls";
  }
}

function formatMetricValue(value: number, metric: Metric): string {
  switch (metric) {
    case "cost":
      return formatCost(value);
    case "tokens":
      return formatTokens(value);
    case "calls":
      return String(value);
  }
}

function summaryAriaLabel(values: number[], metric: Metric, total: number): string {
  const peak = values.reduce((m, v) => (v > m ? v : m), 0);
  return `${metricLabel(metric)} across ${values.length} calls: total ${formatMetricValue(
    total,
    metric,
  )}, peak ${formatMetricValue(peak, metric)}.`;
}

// Suppress "unused" warnings for helpers only referenced through types or in
// future sections.
void formatPercent;
