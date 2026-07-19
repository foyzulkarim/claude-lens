import { Link } from "wouter";
import type { Series } from "../../../../shared/metrics-contract.js";
import { pointValue } from "../../charts/series-math.js";
import { formatUnitValue } from "../../charts/units.js";
import {
  StatCard,
  type StatCardProps,
  type StatDelta,
  StatRow,
} from "../../components/StatCard.js";
import type { FilterState } from "../../filters/state.js";
import { modelHref } from "./drilldown.js";

/**
 * Top-N model stat cards (pages spec §6 "Call-level token & $ split").
 * Each card shows: model name, total $ + previous-period delta, % of
 * fleet spend + session count, and drills to /sessions?model=<x>.
 *
 * The metrics engine returns one `Series` per (measure, dimensionKey)
 * for non-time queries — see `server/metrics/engine.ts:286-294`. So for
 * `dimensions: ["model"]`, `measures: ["costComputed", "sessions"]` we
 * get N model groups × 2 measures = 2N Series, each with a single
 * point summing the model across the range. We bucket by
 * `dimensionKey` (which includes the dimension prefix the engine adds,
 * e.g. `"model:claude-fable-5"`) and read `label` for the human-readable
 * model name.
 *
 * Drill pattern mirrors Dashboard's `DrillStatCard`
 * (`pages/dashboard/StatCardsRow.tsx`): the `<Link>` uses
 * `display: contents` so the anchor is the click target without
 * breaking `StatRow`'s grid layout.
 */

export interface ModelStatsRowProps {
  data: Series[] | undefined;
  filters: FilterState;
  isPending?: boolean;
  isError?: boolean;
  error?: Error | null;
  /** Defaults to 4 to match the mockup's column count. */
  topN?: number;
}

interface ModelRow {
  model: string;
  costCurrent: number;
  costPrevious: number | null;
  sessionCount: number;
  shareOfTotal: number;
}

function deriveRows(data: Series[] | undefined, topN: number): ModelRow[] {
  if (!data || data.length === 0) return [];

  // Group by dimensionKey, picking out cost + session measure totals.
  const byModel = new Map<string, ModelRow>();

  for (const series of data) {
    const key = series.dimensionKey;
    const model = series.label || key;
    let row = byModel.get(key);
    if (!row) {
      row = {
        model,
        costCurrent: 0,
        costPrevious: null,
        sessionCount: 0,
        shareOfTotal: 0,
      };
      byModel.set(key, row);
    }

    if (series.measure === "costComputed") {
      row.costCurrent = series.points.reduce((sum, p) => sum + pointValue(p), 0);
      if (series.compareGhost && series.compareGhost.length > 0) {
        row.costPrevious = series.compareGhost.reduce((sum, p) => sum + pointValue(p), 0);
      }
    } else if (series.measure === "sessions") {
      // Session-grain measures can double-count multi-model sessions
      // (a session using models A+B counts under both — see
      // server/metrics/engine.ts:174). Each Series represents one
      // (model, scope) pair; summing `points` across that single
      // point is the per-model session count.
      row.sessionCount = series.points.reduce((sum, p) => sum + pointValue(p), 0);
    }
  }

  const rows = [...byModel.values()];
  const total = rows.reduce((sum, r) => sum + r.costCurrent, 0);
  for (const row of rows) {
    row.shareOfTotal = total > 0 ? row.costCurrent / total : 0;
  }

  return rows
    .filter((r) => r.costCurrent > 0)
    .sort((a, b) => b.costCurrent - a.costCurrent)
    .slice(0, topN);
}

function buildDelta(current: number, previous: number | null): StatDelta | undefined {
  if (previous === null || previous === undefined || previous === 0) return undefined;
  const pct = ((current - previous) / previous) * 100;
  const rounded = Math.round(Math.abs(pct));
  if (!Number.isFinite(rounded)) return undefined;
  const direction: StatDelta["direction"] = rounded === 0 ? "flat" : pct > 0 ? "up" : "down";
  // Spend up is bad (cost sentiment).
  const sentiment: StatDelta["sentiment"] =
    direction === "flat" ? "neutral" : direction === "up" ? "bad" : "good";
  return { text: `${rounded}%`, direction, sentiment };
}

const COMPACT_INT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function renderSub(row: ModelRow): string {
  const pctText = `${Math.round(row.shareOfTotal * 100)}%`;
  const sessionsText =
    row.sessionCount === 1 ? "1 session" : `${COMPACT_INT.format(row.sessionCount)} sessions`;
  return `${pctText} of spend · ${sessionsText}`;
}

export function ModelStatsRow({
  data,
  filters,
  isPending,
  isError,
  error,
  topN = 4,
}: ModelStatsRowProps) {
  if (isPending) {
    return (
      <section aria-label="Model stats" data-testid="model-stats-row">
        <StatRow columns={topN}>
          {Array.from({ length: topN }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton cards have no identity
            <StatCard key={i} label="—" value="—" />
          ))}
        </StatRow>
      </section>
    );
  }

  if (isError) {
    return (
      <section aria-label="Model stats" data-testid="model-stats-row">
        <div
          role="alert"
          className="rounded-md border border-[#B23A3A] bg-[#FDF4E3] p-4 text-sm text-[#B23A3A] dark:border-[#E05252] dark:bg-[#3A2C18] dark:text-[#E05252]"
        >
          Failed to load model stats: {error?.message ?? "unknown error"}
        </div>
      </section>
    );
  }

  const rows = deriveRows(data, topN);

  if (rows.length === 0) {
    return (
      <section aria-label="Model stats" data-testid="model-stats-row">
        <p role="status" className="text-sm text-slate-500 dark:text-[#8B98A9]">
          No model spend in this range.
        </p>
      </section>
    );
  }

  const columns = Math.max(1, rows.length);

  return (
    <section aria-label="Model stats" data-testid="model-stats-row">
      <StatRow columns={columns}>
        {rows.map((row) => {
          const href = modelHref(row.model, filters);
          const delta = buildDelta(row.costCurrent, row.costPrevious);
          const accent: StatCardProps["accent"] = "money";
          return (
            <Link
              key={row.model}
              href={href}
              aria-label={`${row.model}: ${formatUnitValue(row.costCurrent, "$")} — view sessions`}
              className="contents"
            >
              <StatCard
                label={row.model}
                value={formatUnitValue(row.costCurrent, "$")}
                accent={accent}
                delta={delta}
                sub={renderSub(row)}
              />
            </Link>
          );
        })}
      </StatRow>
    </section>
  );
}
