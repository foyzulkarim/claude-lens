import type { CaptureGaps } from "../../../../shared/health-contract.js";
import { TierBadge } from "../../components/TierBadge.js";
import { Link } from "wouter";
import { Panel } from "./Panel.js";
import { formatInt } from "./format.js";

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
 *
 * Phase 4 DoD: the "View sessions" drill link is the page's contract
 * drill — clicking it lands on the Sessions page with the global URL
 * filter state preserved (architecture §11 / decision A1). Cypress
 * smoke (`cypress/e2e/data-health.cy.ts`) asserts both the URL change
 * and the destination render so a regression in the permalink
 * serialization is caught.
 */
export function CaptureGapsPanel({ captureGaps, totalSessions }: CaptureGapsPanelProps) {
  const captured = totalSessions - captureGaps.sessionsWithoutObserved;
  return (
    <Panel
      title="Capture gaps"
      right={<TierBadge level="exact">premium</TierBadge>}
      description="Sessions that don't yet have cost-capture files (C or L)."
    >
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
                ? // amber-700 (review A11Y-5)
                  "text-amber-700 dark:text-amber-400"
                : "text-slate-900 dark:text-[#E8EDF2]"
            }`}
          >
            {formatInt(captureGaps.sessionsWithoutObserved)}
          </div>
        </div>
      </div>
      <div className="pt-3">
        <Link
          href="/sessions"
          className="text-xs font-medium text-[#0E7A8C] underline-offset-2 hover:underline dark:text-[#4FC3D9]"
          data-testid="data-health-drill-sessions"
        >
          View sessions →
        </Link>
      </div>
    </Panel>
  );
}
