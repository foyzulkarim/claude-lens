import type { ScanCoverage as ScanCoverageType } from "../../../../shared/health-contract.js";
import { TierBadge } from "../../components/TierBadge.js";
import { Panel } from "./Panel.js";
import { formatInt } from "./format.js";

export interface ScanCoveragePanelProps {
  scan: ScanCoverageType;
}

/**
 * §2 scan coverage — roots, transcripts found/parsed/failed, and the
 * sidecar coverage stat folded in from the mockup. Always 🟢:
 * transcript-tier + sidecar presence are independent of premium
 * capture, so this section has data on every fleet.
 *
 * File renamed from `ScanCoverage.tsx` (review Q-009) so the filename
 * matches the export, matching every sibling panel file.
 */
export function ScanCoveragePanel({ scan }: ScanCoveragePanelProps) {
  return (
    <Panel
      title="Scan coverage"
      right={<TierBadge level="exact">transcript tier</TierBadge>}
      description="Active scan roots, transcripts found/parsed/failed, and sidecar presence."
    >
      <div className="grid grid-cols-4 gap-4 pt-2">
        <div>
          <div className="text-xs text-slate-500 dark:text-[#8A95A3]">Found</div>
          <div className="text-lg font-semibold text-slate-900 dark:text-[#E8EDF2]">
            {formatInt(scan.transcriptsFound)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-[#8A95A3]">Parsed</div>
          <div className="text-lg font-semibold text-slate-900 dark:text-[#E8EDF2]">
            {formatInt(scan.transcriptsParsed)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-[#8A95A3]">Failed</div>
          <div
            className={`text-lg font-semibold ${
              scan.transcriptsFailed > 0
                ? // amber-700 (review A11Y-5)
                  "text-amber-700 dark:text-amber-400"
                : "text-slate-900 dark:text-[#E8EDF2]"
            }`}
          >
            {formatInt(scan.transcriptsFailed)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-[#8A95A3]">With sidecars</div>
          <div className="text-lg font-semibold text-slate-900 dark:text-[#E8EDF2]">
            {formatInt(scan.sessionsWithSidecars)}
          </div>
        </div>
      </div>

      <div className="pt-4">
        <div className="text-xs text-slate-500 dark:text-[#8A95A3]">Roots scanned</div>
        {scan.roots.length === 0 ? (
          <p className="pt-1 text-sm text-slate-500 dark:text-[#8A95A3]">
            No scan roots configured. Open Settings to add one.
          </p>
        ) : (
          <ul className="space-y-1 pt-1">
            {scan.roots.map((root) => (
              <li
                key={root.path}
                className="flex items-center gap-2 font-mono text-xs text-slate-700 dark:text-[#C8D0DA]"
              >
                <span className="truncate">{root.path}</span>
                {root.label ? (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-[#1F2630] dark:text-[#8A95A3]">
                    {root.label}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
