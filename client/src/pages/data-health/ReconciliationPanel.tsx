import type { ReconciliationRollup } from "../../../../shared/health-contract.js";
import { LockedCard } from "../../components/LockedCard.js";
import { TierBadge } from "../../components/TierBadge.js";
import { Panel } from "./Panel.js";
import { formatInt, formatUsd } from "./format.js";

export interface ReconciliationPanelProps {
  reconciliation: ReconciliationRollup;
}

/**
 * §3 reconciliation — computed $ (Σ `Session.costComputed` from the
 * pricing table) vs observed $ (Σ `Session.premium.costObserved`
 * reconciled from C/L sidecars). The two numbers are independent:
 * unpriced models contribute $0 to `costComputed` honestly, so a
 * large delta between the two surfaces a pricing gap rather than a
 * data bug.
 *
 * The panel is 🔴 when no session has premium capture yet
 * (`sessionsWithObserved === 0`) — the observed column is undefined,
 * not $0, and the user needs the cost-capture setup guide to
 * produce values. Once at least one session is observed, the panel
 * flips to 🟢 and shows the real delta.
 */
export function ReconciliationPanel({ reconciliation }: ReconciliationPanelProps) {
  if (reconciliation.sessionsWithObserved === 0) {
    return (
      <LockedCard
        title="Reconciliation — computed vs observed"
        message="No premium capture observed. Set up cost capture to see computed vs observed $ per session."
      />
    );
  }

  const delta = reconciliation.costObserved - reconciliation.costComputed;
  return (
    <Panel
      title="Reconciliation — computed vs observed"
      right={<TierBadge level="exact">premium</TierBadge>}
      description="Σ computed $ (from pricing) vs Σ observed $ (from C/L sidecars)."
    >
      <div className="grid grid-cols-3 gap-4 pt-2">
        <div>
          <div className="text-xs text-slate-500 dark:text-[#8A95A3]">Sessions observed</div>
          <div className="text-lg font-semibold text-slate-900 dark:text-[#E8EDF2]">
            {formatInt(reconciliation.sessionsWithObserved)}
            <span className="ml-1 text-xs font-normal text-slate-500 dark:text-[#8A95A3]">
              of{" "}
              {formatInt(
                reconciliation.sessionsWithObserved + reconciliation.sessionsWithComputedOnly,
              )}
            </span>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-[#8A95A3]">Cost computed</div>
          <div className="text-lg font-semibold text-slate-900 dark:text-[#E8EDF2]">
            {formatUsd(reconciliation.costComputed)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-[#8A95A3]">Cost observed</div>
          <div className="text-lg font-semibold text-slate-900 dark:text-[#E8EDF2]">
            {formatUsd(reconciliation.costObserved)}
          </div>
        </div>
      </div>
      <div className="pt-3 text-xs text-slate-500 dark:text-[#8A95A3]">
        Δ observed − computed:{" "}
        <span
          className={
            Math.abs(delta) > 0.01
              ? // amber-700 (review A11Y-5)
                "text-amber-700 dark:text-amber-400"
              : "text-slate-700 dark:text-[#C8D0DA]"
          }
        >
          {formatUsd(delta)}
        </span>
      </div>
    </Panel>
  );
}
