import type { DedupStats } from "../../../../shared/health-contract.js";
import { TierBadge } from "../../components/TierBadge.js";
import { Panel } from "./Panel.js";
import { formatInt } from "./format.js";

export interface DedupPricingStatsProps {
  /** Transcript-tier dedup totals from the snapshot. */
  dedup: DedupStats;
}

/**
 * §1 dedup stat row — three integers in a single horizontal strip so
 * the "raw lines → distinct calls → duplicates" pipeline is obvious
 * at a glance. The panel is always 🟢: dedup is transcript-only and
 * works without premium capture.
 */
export function DedupPricingStats({ dedup }: DedupPricingStatsProps) {
  return (
    <Panel
      title="Dedup stats"
      right={<TierBadge level="exact">transcript tier</TierBadge>}
      description="Raw transcript lines → distinct API calls (message.id dedupe) → duplicates collapsed."
    >
      <div className="grid grid-cols-3 gap-4 pt-2">
        <div>
          <div className="text-xs text-slate-500 dark:text-[#8A95A3]">Raw lines</div>
          <div className="text-lg font-semibold text-slate-900 dark:text-[#E8EDF2]">
            {formatInt(dedup.rawLines)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-[#8A95A3]">Distinct calls</div>
          <div className="text-lg font-semibold text-slate-900 dark:text-[#E8EDF2]">
            {formatInt(dedup.distinctCalls)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-[#8A95A3]">Duplicates</div>
          <div className="text-lg font-semibold text-slate-900 dark:text-[#E8EDF2]">
            {formatInt(dedup.duplicates)}
          </div>
        </div>
      </div>
    </Panel>
  );
}
