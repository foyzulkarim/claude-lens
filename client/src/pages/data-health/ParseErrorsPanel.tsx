import type { ParseErrorSummary } from "../../../../shared/health-contract.js";
import { TierBadge } from "../../components/TierBadge.js";
import { Panel } from "./Panel.js";
import { basename, formatInt } from "./format.js";

export interface ParseErrorsPanelProps {
  parseErrors: ParseErrorSummary;
}

/**
 * §1 parse-errors sub-card — total malformed-line count plus the
 * top-N files. The full Σ is shown in the header; the table is a
 * drill-down ("which files?") rather than the canonical number.
 * Always 🟢: transcript-tier malformed counts.
 */
export function ParseErrorsPanel({ parseErrors }: ParseErrorsPanelProps) {
  return (
    <Panel
      title="Parse errors"
      right={<TierBadge level="exact">transcript tier</TierBadge>}
      description="Malformed transcript lines the parser couldn't classify. Top files below; full count in the number."
    >
      <div className="grid grid-cols-2 gap-4 pt-2">
        <div>
          <div className="text-xs text-slate-500 dark:text-[#8A95A3]">Malformed lines</div>
          <div
            className={`text-lg font-semibold ${
              parseErrors.malformedLines > 0
                ? // amber-700 (review A11Y-5): 5.12:1 on white vs amber-600's 3.26:1
                  "text-amber-700 dark:text-amber-400"
                : "text-slate-900 dark:text-[#E8EDF2]"
            }`}
          >
            {formatInt(parseErrors.malformedLines)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-[#8A95A3]">Files affected</div>
          <div className="text-lg font-semibold text-slate-900 dark:text-[#E8EDF2]">
            {formatInt(parseErrors.byFile.length)}
          </div>
        </div>
      </div>
      {parseErrors.byFile.length > 0 ? (
        <section
          // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions require focusable tabIndex per WAI-ARIA APG; the lint rule's category list doesn't include `region`, but the accessibility win is real for keyboard-only users
          tabIndex={0}
          aria-label="Malformed transcript lines by file — scroll to see all rows"
          className="max-h-48 overflow-y-auto pt-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4FC3D9]/60"
        >
          <table className="w-full text-sm">
            <caption className="sr-only">
              Malformed transcript lines, grouped by source file (top {parseErrors.byFile.length}).
            </caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500 dark:border-[#232B36] dark:text-[#8A95A3]">
                <th scope="col" className="py-1 pr-2 font-medium">
                  File
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">
                  Lines
                </th>
              </tr>
            </thead>
            <tbody>
              {parseErrors.byFile.map(({ filePath, count }) => (
                <tr
                  key={filePath}
                  className="border-b border-slate-100 last:border-0 dark:border-[#1F2630]"
                >
                  <td className="py-1 pr-2 font-mono text-xs text-slate-700 dark:text-[#C8D0DA]">
                    {basename(filePath)}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-slate-700 dark:text-[#C8D0DA]">
                    {formatInt(count)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </Panel>
  );
}
