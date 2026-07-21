import type { PricingCoverage as PricingCoverageType } from "../../../../shared/health-contract.js";
import { SectionHeader } from "./SectionHeader.js";

export interface PricingCoverageTableProps {
  coverage: PricingCoverageType;
}

/**
 * §1 pricing coverage — the list of `ApiCall.model` values seen across
 * the fleet, with the unpriced subset called out so the user can fix
 * the gap (Settings → Pricing table editor, #P4-15). Always 🟢: derived
 * purely from calls + the pricing table; no premium capture required.
 */
export function PricingCoverageTable({ coverage }: PricingCoverageTableProps) {
  const { modelsSeen, unpricedModels } = coverage;
  const unpriced = new Set(unpricedModels);

  if (modelsSeen.length === 0) {
    return (
      <section
        aria-labelledby="data-health-pricing-title"
        className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <SectionHeader
          title="Pricing coverage"
          right={
            <span className="text-xs text-slate-500 dark:text-[#8A95A3]">transcript tier · 🟢</span>
          }
          description="Models seen across the fleet vs the configured pricing table."
        />
        <p className="text-sm text-slate-500 dark:text-[#8A95A3]">
          No models seen yet — the dashboard will populate this once transcripts arrive.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="data-health-pricing-title"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <SectionHeader
        title="Pricing coverage"
        right={
          <span className="text-xs text-slate-500 dark:text-[#8A95A3]">
            {unpricedModels.length === 0
              ? "all priced · 🟢"
              : `${unpricedModels.length} gap${unpricedModels.length === 1 ? "" : "s"} · action needed`}
          </span>
        }
        description="Models seen across the fleet vs the configured pricing table."
      />
      <div className="max-h-64 overflow-y-auto pt-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500 dark:border-[#232B36] dark:text-[#8A95A3]">
              <th className="py-1 pr-2 font-medium">Model</th>
              <th className="py-1 pr-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {modelsSeen.map((model) => (
              <tr
                key={model}
                className="border-b border-slate-100 last:border-0 dark:border-[#1F2630]"
              >
                <td className="py-1 pr-2 font-mono text-xs text-slate-700 dark:text-[#C8D0DA]">
                  {model}
                </td>
                <td className="py-1 pr-2">
                  {unpriced.has(model) ? (
                    <span className="text-amber-600 dark:text-amber-400">unpriced</span>
                  ) : (
                    <span className="text-slate-500 dark:text-[#8A95A3]">priced</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
