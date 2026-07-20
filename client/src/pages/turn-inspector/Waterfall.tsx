import { useState } from "react";
import type { TurnInspectorWaterfallCall } from "../../../../shared/turn-inspector-contract.js";
import { TierBadge } from "../../components/TierBadge.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import { formatDuration, formatTokens } from "./format.js";

export interface WaterfallProps {
  calls: TurnInspectorWaterfallCall[];
}

type WaterfallMode = "time" | "tokens";

/**
 * API-call waterfall (#P4-6): each call as a horizontal bar. "By time" mode
 * sizes bars by `offsetMs` deltas — the 🟡 timestamp-delta fallback the
 * pages spec calls for (real `api_duration` needs #P4-13); "by tokens" mode
 * is a pure client-side re-sort/re-size of the same `calls[]` array, no
 * extra server data needed.
 */
export function Waterfall({ calls }: WaterfallProps): React.JSX.Element {
  const [mode, setMode] = useState<WaterfallMode>("time");

  if (calls.length === 0) {
    return (
      <section
        aria-label="API-call waterfall"
        data-testid="turn-inspector-waterfall"
        className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
          API-call waterfall
        </h2>
        <p className="mt-3 text-xs text-slate-500 dark:text-[#8A96A5]">No calls in this turn.</p>
      </section>
    );
  }

  // Observed per-call api_duration (#P4-13) upgrades "by time" from the
  // timestamp-delta fallback to real per-call durations. Only when every call
  // carries it — a partial mix would mis-scale the bars against each other.
  const observed = calls.every((c) => c.apiMs !== undefined);
  const maxOffset = Math.max(...calls.map((c) => c.offsetMs), 1);
  const maxApiMs = Math.max(...calls.map((c) => c.apiMs ?? 0), 1);
  const maxTokens = Math.max(...calls.map((c) => c.tokens), 1);
  const rows = mode === "tokens" ? [...calls].sort((a, b) => b.tokens - a.tokens) : calls;

  return (
    <section
      aria-label="API-call waterfall"
      data-testid="turn-inspector-waterfall"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
            API-call waterfall
          </h2>
          {mode === "time" ? (
            observed ? (
              <TierBadge level="exact">observed api_duration</TierBadge>
            ) : (
              <TierBadge level="estimated">timestamp fallback</TierBadge>
            )
          ) : null}
        </div>
        <fieldset aria-label="Waterfall metric" className="flex gap-1 border-0 p-0">
          <button
            type="button"
            aria-pressed={mode === "time"}
            className={mode === "time" ? `${TOGGLE_CLASS} ${TOGGLE_ACTIVE_CLASS}` : TOGGLE_CLASS}
            onClick={() => setMode("time")}
          >
            by time
          </button>
          <button
            type="button"
            aria-pressed={mode === "tokens"}
            className={mode === "tokens" ? `${TOGGLE_CLASS} ${TOGGLE_ACTIVE_CLASS}` : TOGGLE_CLASS}
            onClick={() => setMode("tokens")}
          >
            by tokens
          </button>
        </fieldset>
      </div>

      <ul aria-label="Calls" className="mt-3 space-y-1.5">
        {rows.map((call) => {
          // In time mode, size by observed api_duration when present, else the
          // offset fallback.
          const timeWidth = observed
            ? ((call.apiMs ?? 0) / maxApiMs) * 100
            : (call.offsetMs / maxOffset) * 100;
          const width =
            mode === "time" ? Math.max(timeWidth, 4) : Math.max((call.tokens / maxTokens) * 100, 4);
          const primaryTool = call.tools[0];
          const label = primaryTool
            ? `${primaryTool.name}${call.tools.length > 1 ? ` ×${call.tools.length}` : ""}`
            : "—";
          return (
            <li
              key={call.callIndex}
              className="flex items-center gap-2 text-[11px]"
              aria-label={`Call c${call.callIndex + 1} — ${label}, ${formatTokens(call.tokens)} tokens`}
            >
              <span className="w-7 shrink-0 text-right font-mono text-slate-500 dark:text-[#8A96A5]">
                c{call.callIndex + 1}
              </span>
              <div className="relative h-4 flex-1 rounded bg-slate-100 dark:bg-[#232B36]">
                <div
                  className={
                    call.isSidechain
                      ? "absolute inset-y-0 left-0 rounded bg-cyan-400/70"
                      : "absolute inset-y-0 left-0 rounded bg-amber-500"
                  }
                  style={{ width: `${width}%` }}
                />
              </div>
              <span className="w-28 shrink-0 truncate font-mono text-slate-500 dark:text-[#8A96A5]">
                {label}
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-slate-400 dark:text-[#5A6675]">
                {mode === "time"
                  ? formatDuration(observed ? (call.apiMs ?? 0) : call.offsetMs)
                  : formatTokens(call.tokens)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
