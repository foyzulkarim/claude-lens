import type { PricingCoverage as PricingCoverageType } from "../../../../shared/health-contract.js";
import { TierBadge } from "../../components/TierBadge.js";
import { Panel } from "./Panel.js";

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

  // Single `<section>` (review Q-007) with body that branches between
  // empty + populated states — the chrome is shared, only the inner
  // content differs.
  const rightSlot =
    modelsSeen.length === 0 ? (
      <TierBadge level="exact">transcript tier</TierBadge>
    ) : unpricedModels.length === 0 ? (
      <TierBadge level="exact">all priced</TierBadge>
    ) : (
      // Unpriced models ⇒ their cost is an estimate rather than a hard
      // price, so the tier badge flips to `estimated` (🟡) to match the
      // page's machine-readable tier contract (architecture §4).
      <TierBadge level="estimated">{`${unpricedModels.length} gap${
        unpricedModels.length === 1 ? "" : "s"
      }`}</TierBadge>
    );

  const body =
    modelsSeen.length === 0 ? (
      <p className="pt-2 text-sm text-slate-500 dark:text-[#8A95A3]">
        No models seen yet — the dashboard will populate this once transcripts arrive.
      </p>
    ) : (
      <section
        // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions require focusable tabIndex per WAI-ARIA APG; the lint rule's category list doesn't include `region`, but the accessibility win is real for keyboard-only users
        tabIndex={0}
        aria-label="Pricing coverage table — scroll to see all rows"
        className="max-h-64 overflow-y-auto pt-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4FC3D9]/60"
      >
        <table className="w-full text-sm">
          <caption className="sr-only">Pricing status by model across the fleet.</caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500 dark:border-[#232B36] dark:text-[#8A95A3]">
              <th scope="col" className="py-1 pr-2 font-medium">
                Model
              </th>
              <th scope="col" className="py-1 pr-2 font-medium">
                Status
              </th>
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
                    // amber-700 (#B45309) clears WCAG AA 4.5:1 on white;
                    // the previous amber-600 was 3.19:1 (review A11Y-5).
                    <span className="text-amber-700 dark:text-amber-400">unpriced</span>
                  ) : (
                    <span className="text-slate-500 dark:text-[#8A95A3]">priced</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );

  return (
    <Panel
      title="Pricing coverage"
      right={rightSlot}
      description="Models seen across the fleet vs the configured pricing table."
    >
      {body}
    </Panel>
  );
}
