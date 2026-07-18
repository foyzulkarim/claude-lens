import { useMemo } from "react";
import { Chart } from "../../charts/Chart.js";
import { formatUnitValue } from "../../charts/units.js";
import { buildBaselineWeightOption, classifySpanSummary } from "./chart-options.js";
import type { BaselinePoint } from "../../../../shared/cache-lab-contract.js";

/**
 * Cache Lab baseline-weight panel (ARCH §T6 R6): median "first cache
 * write per session" over time. This is the proxy for system prompt +
 * CLAUDE.md + MCP overhead — a growing baseline means the user added
 * setup (CLAUDE.md, MCP servers, etc.) that future calls pay for on
 * every prompt.
 */
export function BaselineWeightPanel({ points }: { points: BaselinePoint[] }) {
  const option = useMemo(() => buildBaselineWeightOption(points), [points]);
  const summary = useMemo(
    () => classifySpanSummary(points.map((p) => ({ t: p.t, value: p.medianTokens }))),
    [points],
  );

  const finite = points.filter(
    (p) => typeof p.medianTokens === "number" && Number.isFinite(p.medianTokens),
  );
  const finiteCount = finite.length;

  return (
    <section
      data-testid="baseline-weight-panel"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Baseline weight</h2>
      <p className="mt-1 text-xs text-slate-600 dark:text-[#8A96A5]">
        Median first cache-write per session — proxy for system prompt + CLAUDE.md + MCP overhead
      </p>

      {finiteCount === 0 ? (
        <p role="status" className="mt-4 text-sm text-slate-500 dark:text-[#8B98A9]">
          No baseline samples in range.
        </p>
      ) : (
        <>
          <Chart
            option={option}
            className="mt-4 h-72 w-full"
            ariaLabel={`Baseline weight trend: ${finiteCount} samples`}
          />
          <p className="mt-2 font-mono text-xs text-slate-600 dark:text-[#8A96A5]">
            {formatUnitValue(summary.total, "tokens")} sum · {finiteCount} samples · {points.length}{" "}
            buckets
          </p>
        </>
      )}
    </section>
  );
}
