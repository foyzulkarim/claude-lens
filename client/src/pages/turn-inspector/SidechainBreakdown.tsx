import type { TurnInspectorSidechainBreakdown } from "../../../../shared/turn-inspector-contract.js";
import { formatCost, formatTokens } from "./format.js";

export interface SidechainBreakdownProps {
  breakdown: TurnInspectorSidechainBreakdown;
}

/**
 * Main vs. sidechain cost/token split (#P4-6). Renders a two-row bar pair —
 * main thread always 100%-relative, each sidechain agent shown as its
 * share of the main thread's cost so a small subagent detour reads as
 * visually small.
 */
export function SidechainBreakdown({ breakdown }: SidechainBreakdownProps): React.JSX.Element {
  const { mainCost, mainTokens, mainCallCount, sidechains } = breakdown;

  if (sidechains.length === 0) {
    return (
      <section
        aria-label="Sidechain breakdown"
        data-testid="turn-inspector-sidechains"
        className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
          Sidechain breakdown
        </h2>
        <p className="mt-3 text-xs text-slate-500 dark:text-[#8A96A5]">
          No sidechain (subagent) activity in this turn.
        </p>
      </section>
    );
  }

  const maxCost = Math.max(mainCost, ...sidechains.map((s) => s.cost), 0.000001);

  return (
    <section
      aria-label="Sidechain breakdown"
      data-testid="turn-inspector-sidechains"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
        Sidechain breakdown
      </h2>
      <ul aria-label="Threads" className="mt-3 space-y-1.5">
        <li className="flex items-center gap-2 text-[11px]">
          <span className="w-32 shrink-0 text-slate-600 dark:text-[#8A96A5]">main thread</span>
          <div className="relative h-3 flex-1 rounded bg-slate-100 dark:bg-[#232B36]">
            <div
              className="absolute inset-y-0 left-0 rounded bg-amber-500"
              style={{ width: `${(mainCost / maxCost) * 100}%` }}
            />
          </div>
          <span className="w-14 shrink-0 text-right font-mono">{formatCost(mainCost)}</span>
        </li>
        {sidechains.map((side, i) => (
          <li key={side.agentId ?? i} className="flex items-center gap-2 text-[11px]">
            <span className="w-32 shrink-0 truncate text-slate-600 dark:text-[#8A96A5]">
              sidechain {sidechains.length > 1 ? `#${i + 1}` : ""}
            </span>
            <div className="relative h-3 flex-1 rounded bg-slate-100 dark:bg-[#232B36]">
              <div
                className="absolute inset-y-0 left-0 rounded bg-cyan-400/70"
                style={{ width: `${(side.cost / maxCost) * 100}%` }}
              />
            </div>
            <span className="w-14 shrink-0 text-right font-mono">{formatCost(side.cost)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 font-mono text-[11px] text-slate-400 dark:text-[#5A6675]">
        main: {formatTokens(mainTokens)} tokens, {mainCallCount} calls ·{" "}
        {sidechains
          .map((s) => `${formatTokens(s.tokens)} tokens, ${s.callCount} calls, ${s.primaryModel}`)
          .join(" · ")}
      </p>
    </section>
  );
}
