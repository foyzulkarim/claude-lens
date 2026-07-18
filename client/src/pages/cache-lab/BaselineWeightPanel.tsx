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
export function BaselineWeightPanel({
  points,
  error,
}: {
  points: BaselinePoint[] | undefined;
  error?: Error | null;
}) {
  const resolvedPoints = points ?? [];
  const option = useMemo(() => buildBaselineWeightOption(resolvedPoints), [resolvedPoints]);
  const summary = useMemo(
    () => classifySpanSummary(resolvedPoints.map((p) => ({ t: p.t, value: p.medianTokens }))),
    [resolvedPoints],
  );

  const finite = resolvedPoints.filter(
    (p) => typeof p.medianTokens === "number" && Number.isFinite(p.medianTokens),
  );
  const finiteCount = finite.length;

  return (
    <section
      data-testid="baseline-weight-panel"
      aria-labelledby="baseline-weight-heading"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2
        id="baseline-weight-heading"
        className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
      >
        Baseline weight
      </h2>
      <p className="mt-1 text-xs text-slate-600 dark:text-[#8A96A5]">
        Median first cache-write per session — proxy for system prompt + CLAUDE.md + MCP overhead
      </p>

      {finiteCount === 0 ? (
        <p
          role={error ? "alert" : "status"}
          className="mt-4 text-sm text-slate-500 dark:text-[#8B98A9]"
        >
          {error
            ? `Cache Lab analysis failed: ${error.message}`
            : points
              ? "No baseline samples in range."
              : "Loading…"}
        </p>
      ) : (
        <>
          <Chart
            option={option}
            className="mt-4 h-72 w-full"
            ariaLabel={`Baseline weight trend: ${finiteCount} samples`}
          />
          <p className="mt-2 font-mono text-xs text-slate-600 dark:text-[#8A96A5]">
            {formatUnitValue(summary.total, "tokens")} sum · {finiteCount} samples ·{" "}
            {resolvedPoints.length} buckets
          </p>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-medium text-[#96631E] dark:text-[#E8A33D]">
              View baseline data table
            </summary>
            <table className="mt-2 w-full text-left text-xs">
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th>Median tokens</th>
                  <th>Samples</th>
                </tr>
              </thead>
              <tbody>
                {resolvedPoints.map((point) => (
                  <tr key={point.t}>
                    <td>{point.t}</td>
                    <td>{point.medianTokens ?? "—"}</td>
                    <td>{point.sampleCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <p role="status" aria-live="polite" className="sr-only">
            Baseline trend updated: {finiteCount} samples.
          </p>
        </>
      )}
    </section>
  );
}
