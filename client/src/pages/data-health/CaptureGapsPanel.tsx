import type { CaptureGaps } from "../../../../shared/health-contract.js";
import { formatInt } from "./format.js";
import { SectionHeader } from "./SectionHeader.js";

export interface CaptureGapsPanelProps {
  captureGaps: CaptureGaps;
  totalSessions: number;
}

/**
 * §4 capture-gaps sub-card — sessions without observed-data capture.
 * Always 🟢: derived from `reconciliation.sessionsWithComputedOnly`,
 * which the server already populates from per-session `costBasis`
 * flags. No premium capture is required to *see* the gap (the gap
 * itself is "no premium capture"), but a non-zero value here is the
 * "set up cost capture" CTA trigger.
 */
export function CaptureGapsPanel({ captureGaps, totalSessions }: CaptureGapsPanelProps) {
  const captured = totalSessions - captureGaps.sessionsWithoutObserved;
  return (
    <section
      aria-labelledby="data-health-capture-gaps-title"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <SectionHeader
        title="Capture gaps"
        right={<span className="text-xs text-slate-500 dark:text-[#8A95A3]">premium · 🟢</span>}
        description="Sessions that don't yet have cost-capture files (C or L)."
      />
      <div className="grid grid-cols-2 gap-4 pt-2">
        <div>
          <div className="text-xs text-slate-500 dark:text-[#8A95A3]">Captured</div>
          <div className="text-lg font-semibold text-slate-900 dark:text-[#E8EDF2]">
            {formatInt(captured)}
            <span className="ml-1 text-xs font-normal text-slate-500 dark:text-[#8A95A3]">
              of {formatInt(totalSessions)}
            </span>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-[#8A95A3]">Without capture</div>
          <div
            className={`text-lg font-semibold ${
              captureGaps.sessionsWithoutObserved > 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-slate-900 dark:text-[#E8EDF2]"
            }`}
          >
            {formatInt(captureGaps.sessionsWithoutObserved)}
          </div>
        </div>
      </div>
    </section>
  );
}
