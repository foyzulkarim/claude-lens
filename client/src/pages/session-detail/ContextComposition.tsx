import type { SessionDetailContextItem } from "../../../../shared/session-detail-contract.js";
import { formatTokens } from "./format.js";

export interface ContextCompositionProps {
  items: SessionDetailContextItem[];
}

/**
 * Tool-result bytes by originating tool (#P4-5, T10). Horizontal bars
 * sized to the panel's peak share; deterministic order (bytes desc).
 *
 * Privacy boundary (R7): the projector rolls tool-result bytes by
 * originating tool — no target paths, no Bash commands, no result bodies
 * ever cross the wire. The component only displays the aggregate byte
 * count per tool.
 */
export function ContextComposition({ items }: ContextCompositionProps): React.JSX.Element {
  const peak = items.reduce((m, i) => (i.bytes > m ? i.bytes : m), 0);
  return (
    <section
      aria-label="Context composition"
      data-testid="session-detail-context-composition"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
        Context composition
      </h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-[#8A96A5]">
        Tool-result bytes by originating tool — never names paths or commands.
      </p>
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500 dark:text-[#8A96A5]">
          No tool-result bytes recorded.
        </p>
      ) : (
        <ul aria-label="Context bytes by tool" className="mt-3 space-y-2">
          {items.map((item) => {
            const width = peak > 0 ? (item.bytes / peak) * 100 : 0;
            return (
              <li
                key={item.toolName}
                className="flex items-center gap-2 text-[11px]"
                aria-label={`${item.toolName}: ${formatTokens(item.bytes)} bytes`}
              >
                <span className="w-24 font-mono text-slate-700 dark:text-[#E8EDF2]">
                  {item.toolName}
                </span>
                <div className="relative h-3 flex-1 rounded bg-slate-100 dark:bg-[#232B36]">
                  <div
                    className="absolute inset-y-0 left-0 rounded bg-emerald-600 dark:bg-emerald-400"
                    style={{ width: `${width}%` }}
                  />
                </div>
                <span className="w-12 text-right font-mono text-slate-700 dark:text-[#E8EDF2]">
                  {Math.round(item.share * 100)}%
                </span>
                <span className="w-16 text-right font-mono text-[10px] text-slate-500 dark:text-[#8A96A5]">
                  {formatTokens(item.bytes)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
