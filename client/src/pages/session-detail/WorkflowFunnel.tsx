import type { SessionDetailWorkflow } from "../../../../shared/session-detail-contract.js";

export interface WorkflowFunnelProps {
  workflow: SessionDetailWorkflow;
}

/**
 * Cumulative workflow funnel (#P4-5, T9). Five stages in canonical funnel
 * order (edit / read / plan / verify / commit) where every later stage's
 * count is ≤ the prior stage's. The server's projector enforces this
 * monotonic invariant; the panel surfaces it visually with proportional
 * bars + a numeric label per stage.
 *
 * Gate distinction (architecture A6): the funnel describes coverage only
 * — no pass/fail status, no Report Card content. The labels match the
 * documented V1/P3-class signals so future gates can reuse the same funnel
 * without redesign.
 */
export function WorkflowFunnel({ workflow }: WorkflowFunnelProps): React.JSX.Element {
  const peak = workflow.baseEditCount;
  return (
    <section
      aria-label="Workflow funnel"
      data-testid="session-detail-workflow"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Workflow funnel</h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-[#8A96A5]">
        Edit turns through the five canonical coverage stages. Every later stage counts ≤ the prior
        stage.
      </p>
      <ul aria-label="Workflow stages" className="mt-3 space-y-2">
        {workflow.stages.map((stage, idx) => {
          const width = peak > 0 ? (stage.count / peak) * 100 : 0;
          const isLast = idx === workflow.stages.length - 1;
          return (
            <li
              key={stage.id}
              className="flex items-center gap-2 text-[11px]"
              aria-label={`${stage.label}: ${stage.count}`}
            >
              <span className="w-24 font-mono text-slate-700 dark:text-[#E8EDF2]">
                {stage.label}
              </span>
              <div className="relative h-3 flex-1 rounded bg-slate-100 dark:bg-[#232B36]">
                <div
                  className="absolute inset-y-0 left-0 rounded bg-sky-600 dark:bg-sky-400"
                  style={{ width: `${width}%` }}
                />
              </div>
              <span
                className={`w-10 text-right font-mono ${
                  isLast
                    ? "text-slate-900 dark:text-[#E8EDF2]"
                    : "text-slate-700 dark:text-[#E8EDF2]"
                }`}
              >
                {stage.count}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
