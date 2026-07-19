import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { qk } from "../api/queryKeys.js";
import { getTurnInspector, TurnInspectorApiError } from "../api/turn-inspector.js";
import { TurnInspectorView } from "./turn-inspector/TurnInspectorView.js";

/**
 * Turn Inspector route shell (#P4-6). Accepts the canonical one-based
 * evidence-link shape settled in `specs/gates.md` and used by Session
 * Detail's turn-table drill links (A11): `/session/:sessionId/turn/:turnNumber`.
 * Owns exactly one page-level TanStack Query (mirrors `SessionDetail.tsx`);
 * the transcript peek is a second, independently-lazy query owned by
 * `TranscriptPeek.tsx` itself.
 */
export function TurnInspector() {
  const { sessionId, turnNumber } = useParams<{ sessionId: string; turnNumber: string }>();
  const n = turnNumber !== undefined ? Number(turnNumber) : Number.NaN;
  const validParams =
    typeof sessionId === "string" && sessionId.length > 0 && Number.isInteger(n) && n > 0;

  const query = useQuery({
    queryKey: qk.turnInspector(sessionId ?? "", validParams ? n : 0),
    queryFn: ({ signal }) => getTurnInspector(sessionId ?? "", n, signal),
    enabled: validParams,
  });

  if (!validParams) {
    return (
      <div role="status" aria-live="polite" className="p-6 text-sm text-slate-500">
        No session id / turn number in the URL.
      </div>
    );
  }

  if (query.isPending) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="turn-inspector-loading"
        className="p-6 text-sm text-slate-500 dark:text-[#5A6675]"
      >
        Loading turn…
      </div>
    );
  }

  if (query.isError) {
    const err = query.error;
    if (err instanceof TurnInspectorApiError && err.status === 404) {
      return (
        <div
          role="alert"
          data-testid="turn-inspector-not-found"
          className="p-6 text-sm text-amber-700 dark:text-amber-300"
        >
          <h1 className="mb-1 text-base font-semibold">Turn not found</h1>
          <p>
            No turn <code className="rounded bg-slate-100 px-1 py-0.5">{turnNumber}</code> in
            session <code className="rounded bg-slate-100 px-1 py-0.5">{sessionId}</code>.
          </p>
        </div>
      );
    }
    return (
      <div
        role="alert"
        data-testid="turn-inspector-error"
        className="p-6 text-sm text-red-700 dark:text-red-300"
      >
        <h1 className="mb-1 text-base font-semibold">Failed to load turn</h1>
        <p>{err instanceof Error ? err.message : "Unknown error fetching turn detail."}</p>
      </div>
    );
  }

  if (!query.data) {
    return null;
  }

  return <TurnInspectorView data={query.data} />;
}
