import type {
  SessionDetailToolMixItem,
  SessionDetailToolTimelineEvent,
} from "../../../../shared/session-detail-contract.js";

export interface ToolMixProps {
  toolMix: SessionDetailToolMixItem[];
  toolTimeline: SessionDetailToolTimelineEvent[];
}

/**
 * Tool mix + tool timeline (#P4-5, T8). Tool Mix is the per-tool call
 * count and input bytes; Tool Timeline is the chronological event list.
 *
 * The architecture explicitly calls out Tool Mix/Timeline as the binding
 * spec gap absent from the visual mockup — implemented here in full per
 * the spec table, never with a "drop to the mockup" fallback.
 */
export function ToolMix({ toolMix, toolTimeline }: ToolMixProps): React.JSX.Element {
  const peakCount = toolMix.reduce((m, t) => (t.callCount > m ? t.callCount : m), 0);

  return (
    <section
      aria-label="Tool mix"
      data-testid="session-detail-tool-mix"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Tool mix</h2>

      {toolMix.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500 dark:text-[#8A96A5]">No tool calls recorded.</p>
      ) : (
        <ul aria-label="Tool counts" className="mt-3 space-y-1">
          {toolMix.map((tool) => (
            <li
              key={tool.name}
              className="flex items-center gap-2 text-[11px]"
              aria-label={`${tool.name} — ${tool.callCount} calls, ${tool.inputBytes} bytes input`}
            >
              <span className="w-20 font-mono text-slate-700 dark:text-[#E8EDF2]">{tool.name}</span>
              <div className="relative h-2 flex-1 rounded bg-slate-100 dark:bg-[#232B36]">
                <div
                  className="absolute inset-y-0 left-0 rounded bg-indigo-500"
                  style={{
                    width: peakCount > 0 ? `${(tool.callCount / peakCount) * 100}%` : "0%",
                  }}
                />
              </div>
              <span className="w-12 text-right font-mono text-slate-700 dark:text-[#E8EDF2]">
                {tool.callCount}×
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        <h3 className="text-xs font-medium text-slate-500 dark:text-[#8A96A5]">Tool timeline</h3>
        {toolTimeline.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500 dark:text-[#8A96A5]">No tool events.</p>
        ) : (
          <ol
            aria-label="Tool timeline events"
            className="mt-2 max-h-48 overflow-y-auto text-[11px]"
          >
            {toolTimeline.map((event) => (
              <li
                key={`${event.callIndex}-${event.toolName}-${event.timestamp}`}
                className="flex items-center gap-2 border-b border-slate-100 py-1 dark:border-[#232B36]"
              >
                <span className="w-10 text-right font-mono text-slate-500 dark:text-[#8A96A5]">
                  #{event.callIndex + 1}
                </span>
                <span className="w-12 text-right font-mono text-slate-500 dark:text-[#8A96A5]">
                  T{event.turnNumber}
                </span>
                <span className="font-mono text-slate-700 dark:text-[#E8EDF2]">
                  {event.toolName}
                </span>
                <span className="ml-auto font-mono text-[10px] text-slate-500 dark:text-[#8A96A5]">
                  {event.timestamp.slice(11, 19)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
