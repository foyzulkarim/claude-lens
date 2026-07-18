import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { getSessionDetail, SessionDetailApiError } from "../api/session-detail.js";
import { qk } from "../api/queryKeys.js";
import { SessionDetailView } from "./session-detail/SessionDetailView.js";

/**
 * Session Detail route shell (#P4-5, T6). Owns exactly ONE page-level
 * TanStack Query for the addressed session — every panel renders the same
 * resource so a stale-second mid-refetch can't render two divergent
 * sections. The validated response is handed to a pure view component so
 * visual sections never reach back into the API layer.
 *
 * Cancellation: TanStack Query's `useQuery` forwards its AbortSignal to
 * `fetch`, so unmounting the page or replacing the route id during the
 * in-flight request resolves the promise without surfacing a user-facing
 * error (architecture decision A8, "no duplicate requests from concurrent
 * UI"). The T6 test exercises this by toggling the ID mid-fetch.
 *
 * Error model: the network/transport throws surface through `query.error`;
 * `SessionDetailApiError(404)` is distinguished from generic failures so
 * the page can render a "session not found" panel inside `AppShell`
 * rather than a top-level error boundary.
 */
export function SessionDetail() {
  const { id } = useParams<{ id: string }>();

  const query = useQuery({
    queryKey: qk.session(id ?? ""),
    queryFn: ({ signal }) => getSessionDetail(id ?? "", signal),
    enabled: typeof id === "string" && id.length > 0,
  });

  if (typeof id !== "string" || id.length === 0) {
    return (
      <div role="status" aria-live="polite" className="p-6 text-sm text-slate-500">
        No session id in the URL.
      </div>
    );
  }

  if (query.isPending) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="session-detail-loading"
        className="p-6 text-sm text-slate-500 dark:text-[#5A6675]"
      >
        Loading session…
      </div>
    );
  }

  if (query.isError) {
    const err = query.error;
    if (err instanceof SessionDetailApiError && err.status === 404) {
      return (
        <div
          role="alert"
          data-testid="session-detail-not-found"
          className="p-6 text-sm text-amber-700 dark:text-amber-300"
        >
          <h1 className="mb-1 text-base font-semibold">Session not found</h1>
          <p>
            No session with id <code className="rounded bg-slate-100 px-1 py-0.5">{id}</code> is
            registered with the running ingest.
          </p>
        </div>
      );
    }
    return (
      <div
        role="alert"
        data-testid="session-detail-error"
        className="p-6 text-sm text-red-700 dark:text-red-300"
      >
        <h1 className="mb-1 text-base font-semibold">Failed to load session</h1>
        <p>{err instanceof Error ? err.message : "Unknown error fetching session detail."}</p>
      </div>
    );
  }

  // Data is guaranteed by `isError=false` + `isPending=false` here, but
  // TanStack's types still call it `SessionDetailResponse | undefined`. We
  // belt-and-suspenders with `data &&` so a hypothetical intermediate state
  // never dereferences undefined.
  if (!query.data) {
    return null;
  }

  return <SessionDetailView data={query.data} />;
}
