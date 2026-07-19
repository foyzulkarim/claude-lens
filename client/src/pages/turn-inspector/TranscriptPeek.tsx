import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { qk } from "../../api/queryKeys.js";
import { getTurnTranscriptPeek, TurnInspectorApiError } from "../../api/turn-inspector.js";

export interface TranscriptPeekProps {
  sessionId: string;
  turnNumber: number;
}

/**
 * Transcript peek panel (#P4-6): collapsed by default. The raw-file read
 * (`GET /api/sessions/:id/transcript?turn=n`) only fires once the user
 * expands the panel — `enabled: expanded` keeps the query from mounting
 * eagerly, matching the issue's "lazy raw-file read route" framing.
 */
export function TranscriptPeek({ sessionId, turnNumber }: TranscriptPeekProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const query = useQuery({
    queryKey: qk.turnTranscript(sessionId, turnNumber),
    queryFn: ({ signal }) => getTurnTranscriptPeek(sessionId, turnNumber, signal),
    enabled: expanded,
  });

  return (
    <section
      aria-label="Transcript peek"
      data-testid="turn-inspector-transcript-peek"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
          Transcript peek
        </h2>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-[#8A96A5] dark:hover:bg-[#151A21]"
        >
          {expanded ? "collapse" : "expand"}
        </button>
      </div>

      {!expanded && <p className="mt-2 text-xs text-slate-500 dark:text-[#8A96A5]">Collapsed.</p>}

      {expanded && query.isPending && (
        <p className="mt-2 text-xs text-slate-500 dark:text-[#8A96A5]">Loading transcript…</p>
      )}

      {expanded && query.isError && (
        <p
          role="alert"
          data-testid="turn-inspector-transcript-error"
          className="mt-2 text-xs text-amber-700 dark:text-amber-300"
        >
          {query.error instanceof TurnInspectorApiError && query.error.status === 404
            ? "Transcript unavailable — the source file may have moved or been removed."
            : "Failed to load transcript."}
        </p>
      )}

      {expanded && query.data && (
        <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-600 dark:border-[#232B36] dark:bg-[#0F131A] dark:text-[#8A96A5]">
          {query.data.lines.length === 0 && <p>No transcript content in this turn's window.</p>}
          {query.data.lines.map((line) => (
            <p key={`${line.role}-${line.toolName ?? ""}-${line.preview}`} className="truncate">
              ▸ {line.role === "assistant-text" && `assistant: "${line.preview}"`}
              {line.role === "tool-use" && `tool_use ${line.toolName} → ${line.preview}`}
              {line.role === "tool-result" &&
                `tool_result${line.toolName ? ` (${line.toolName})` : ""} · ${line.bytes ?? 0} bytes`}
            </p>
          ))}
          {query.data.truncated && (
            <p className="mt-1 text-slate-400 dark:text-[#5A6675]">(previews truncated)</p>
          )}
        </div>
      )}
    </section>
  );
}
