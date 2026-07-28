import { useQuery } from "@tanstack/react-query";
import { getGateReport } from "../../api/gates.js";
import { qk } from "../../api/queryKeys.js";
import { EmptyState } from "../../components/EmptyState.js";
import { useInView } from "../../hooks/useInView.js";
import { ReportCardView } from "./ReportCardView.js";

export interface ReportCardProps {
  sessionId: string;
}

/**
 * Report Card data wrapper (#P4-12; ARCH-p4-12 §High-Level Structure).
 * One lazy-mounted fetch against `/api/sessions/:id/gates`, gated by
 * `useInView(200px)` so the E1/E2 filesystem check doesn't block
 * Session Detail's first paint.
 *
 * The view split mirrors `SessionDetailView.tsx`'s pattern: the page
 * shell handles fetching; this component owns the fetch and a tiny
 * render-only view (`ReportCardView`). Stories + tests get pure-data
 * coverage via `data`/`error` injection through the `data` prop on the
 * view.
 */
export function ReportCard({ sessionId }: ReportCardProps): React.JSX.Element {
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: "200px" }, "report-card");

  const query = useQuery({
    queryKey: qk.gates(sessionId),
    queryFn: ({ signal }) => getGateReport(sessionId, signal),
    enabled: inView,
    staleTime: 5 * 60 * 1000, // 5 min — E1/E2 is "as of now", not "as of last edit"
  });

  return (
    <div ref={ref}>
      {!inView ? (
        <div
          aria-hidden="true"
          data-testid="report-card-placeholder"
          className="h-32 rounded-md border border-slate-200 bg-white dark:border-[#232B36] dark:bg-[#151A21]"
        />
      ) : query.isPending ? (
        <p
          role="status"
          className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-500 dark:border-[#232B36] dark:bg-[#151A21] dark:text-[#8B98A9]"
        >
          Loading Report Card…
        </p>
      ) : query.isError ? (
        // CLAUDE.md mandates an EmptyState-style error WITH a retry
        // affordance. The EmptyState component already accepts
        // `action: {label, onClick}` — `query.refetch` triggers a
        // re-fetch without remounting the placeholder slot.
        <EmptyState
          message={`Couldn't load Report Card: ${
            query.error instanceof Error ? query.error.message : "Unknown error"
          }`}
          action={{ label: "Retry", onClick: () => void query.refetch() }}
        />
      ) : (
        <ReportCardView data={query.data} />
      )}
    </div>
  );
}
