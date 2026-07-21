import type { ParseErrorSummary } from "../../../../shared/health-contract.js";
import { basename, formatInt } from "./format.js";
import { SectionHeader } from "./SectionHeader.js";

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
    <section
      aria-labelledby="data-health-parse-errors-title"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <SectionHeader
        title="Parse errors"
        right={
          <span className="text-xs text-slate-500 dark:text-[#8A95A3]">transcript tier · 🟢</span>
        }
        description="Malformed transcript lines the parser couldn't classify. Top files below; full count in the number."
      />
      <div className="grid grid-cols-2 gap-4 pt-2">
        <div>
          <div className="text-xs text-slate-500 dark:text-[#8A95A3]">Malformed lines</div>
          <div
            className={`text-lg font-semibold ${
              parseErrors.malformedLines > 0
                ? "text-amber-600 dark:text-amber-400"
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
        <div className="max-h-48 overflow-y-auto pt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500 dark:border-[#232B36] dark:text-[#8A95A3]">
                <th className="py-1 pr-2 font-medium">File</th>
                <th className="py-1 pr-2 text-right font-medium">Lines</th>
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
        </div>
      ) : null}
    </section>
  );
}
