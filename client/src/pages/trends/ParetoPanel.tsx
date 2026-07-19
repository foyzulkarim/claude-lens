import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import clsx from "clsx";
import { useMemo, useState } from "react";
import type {
  Distribution,
  DistributionMetricsQuery,
} from "../../../../shared/metrics-contract.js";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { Chart } from "../../charts/Chart.js";
import { buildParetoOption } from "../../charts/pareto.js";
import { DataTable } from "../../components/DataTable.js";
import { filtersToQuery, serializeFilters } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import { useStableNow } from "../dashboard/useStableNow.js";

type Variant = "curve" | "table";
const VARIANTS: Variant[] = ["curve", "table"];

interface DecileRow {
  decile: number;
  cumulativeValuePct: number;
}

/**
 * Picks, for each 10% turn-share mark, the last curve point at or below it
 * — `Distribution["pareto"]["curve"]` is already sorted ascending by
 * `entityPct` (one entry per ranked turn), so this is a nearest-below
 * lookup, not a re-derivation of the server's math.
 */
export function paretoDecileRows(curve: NonNullable<Distribution["pareto"]>["curve"]): DecileRow[] {
  const rows: DecileRow[] = [];
  for (let decile = 10; decile <= 100; decile += 10) {
    let closest = curve[0];
    for (const point of curve) {
      if (point.entityPct <= decile) closest = point;
      else break;
    }
    rows.push({ decile, cumulativeValuePct: closest?.cumulativeValuePct ?? 0 });
  }
  return rows;
}

const decileColumnHelper = createColumnHelper<DecileRow>();
const DECILE_COLUMNS: ColumnDef<DecileRow, number>[] = [
  decileColumnHelper.accessor("decile", {
    header: "Top turns (%)",
    cell: (info) => `${info.getValue()}%`,
  }),
  decileColumnHelper.accessor("cumulativeValuePct", {
    header: "Cumulative spend (%)",
    meta: { align: "right", mono: true },
    cell: (info) => `${info.getValue().toFixed(1)}%`,
  }),
];

export interface ParetoPanelProps {
  now?: Date;
}

/**
 * Pareto "spend concentration" panel (pages spec §8). The server's
 * `mode: "distribution"` engine already computes the cumulative curve and
 * top-decile share (`distributions.ts`'s `buildPareto`) — this panel does
 * no math of its own (architecture §8 "one engine serves every chart").
 */
export function ParetoPanel({ now: injectedNow }: ParetoPanelProps) {
  const { filters } = useFilters();
  const filtersKey = serializeFilters(filters);
  const now = useStableNow(injectedNow);
  const [variant, setVariant] = useState<Variant>("curve");

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey)
  const query = useMemo<DistributionMetricsQuery>(
    () => ({
      measures: ["costComputed"],
      dimensions: [],
      grain: "day",
      mode: "distribution",
      distributionEntity: "turn",
      ...filtersToQuery(filters, now),
    }),
    [filtersKey, now],
  );

  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.metrics(query),
    queryFn: ({ signal }) => postMetrics(query, signal),
    placeholderData: keepPreviousData,
  });

  const pareto = data?.[0]?.distribution?.pareto;
  const option = useMemo(() => buildParetoOption(pareto), [pareto]);
  const decileRows = useMemo(() => paretoDecileRows(pareto?.curve ?? []), [pareto]);

  return (
    <section
      data-testid="pareto-panel"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
          Pareto — spend concentration
        </h2>
        <div className="flex items-center gap-1">
          {VARIANTS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVariant(v)}
              aria-pressed={variant === v}
              className={clsx(TOGGLE_CLASS, variant === v && TOGGLE_ACTIVE_CLASS)}
            >
              {v}
            </button>
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

      {!isPending && !isError && pareto && (
        <>
          {pareto.topDecileValuePct > 0 && (
            <p className="mt-1 text-xs text-slate-500 dark:text-[#8A96A5]">
              Top 10% of turns = {pareto.topDecileValuePct.toFixed(0)}% of spend
            </p>
          )}
          {variant === "curve" ? (
            <Chart
              option={option}
              className="mt-4 h-64 w-full"
              ariaLabel="Pareto curve: cumulative spend by turn rank"
            />
          ) : (
            <div className="mt-4">
              <DataTable
                data={decileRows}
                columns={DECILE_COLUMNS}
                label="Pareto decile table"
                getRowId={(row) => String(row.decile)}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
