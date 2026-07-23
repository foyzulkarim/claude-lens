import type { HealthSnapshot } from "../../../../shared/health-contract.js";
import { BoundaryMismatchesPanel } from "./BoundaryMismatchesPanel.js";
import { CaptureGapsPanel } from "./CaptureGapsPanel.js";
import { DedupPricingStats } from "./DedupPricingStats.js";
import { ParseErrorsPanel } from "./ParseErrorsPanel.js";
import { PricingCoverageTable } from "./PricingCoverageTable.js";
import { ReconciliationPanel } from "./ReconciliationPanel.js";
import { ScanCoveragePanel } from "./ScanCoveragePanel.js";
import { useHealthQuery } from "./useHealthQuery.js";

/**
 * Data Health page shell (pages spec §9; #P4-14). One query →
 * `HealthSnapshot` → six panels:
 *
 *   §1 Dedup stats · pricing coverage · parse errors
 *   §2 Scan coverage (roots, found/parsed/failed, sidecar)
 *   §3 Reconciliation (computed vs observed $)
 *   §4 Capture gaps + boundary/promptId mismatches
 *
 * Per-section loading / empty / error states are owned by the panels
 * themselves (TierBadge / LockedCard / "0" are all valid renders), so
 * a single fetch failure here doesn't blank the page. The `isPending`
 * flag is passed only to the page-level status line; the panels
 * render against the last-known snapshot (staleTime: 30s in the
 * hook) so a refetch never flashes the page empty.
 */
export interface DataHealthProps {
  /** Test seam: stories/tests inject a snapshot directly so they can
   *  render the page without wiring a query client. Production code
   *  leaves this unset and reads via the hook. */
  snapshot?: HealthSnapshot | null;
}

export function DataHealth({ snapshot: injectedSnapshot }: DataHealthProps = {}) {
  const query = useHealthQuery({ enabled: injectedSnapshot === undefined });
  const snapshot = injectedSnapshot ?? query.data ?? null;
  const isPending = injectedSnapshot ? false : query.isPending;
  const isError = injectedSnapshot ? false : query.isError;
  // Live-region announcement for background refetches (review A11Y-6).
  // The page renders against the last-known snapshot via `staleTime: 30s`,
  // so a refetch never flashes the page empty — but screen-reader users
  // have no other signal that the numbers just refreshed. We surface a
  // concise "Data Health updated" via `aria-live="polite"` whenever a new
  // snapshot arrives after the first one.
  const isFetchingAfterFirst = query.isFetching && !!query.data && !injectedSnapshot;

  if (isError && !snapshot) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-[#E8EDF2]">Data Health</h1>
        {/* `role="alert"` (review A11Y-6) — error is announced immediately. */}
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          Failed to load the health snapshot: {query.error?.message ?? "unknown error"}
        </p>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-[#E8EDF2]">Data Health</h1>
        {/* `role="status"` + `aria-live="polite"` (review A11Y-6) — loading
            is announced without interrupting the current announcement. */}
        <p role="status" aria-live="polite" className="text-sm text-slate-500 dark:text-[#8A95A3]">
          Loading…
        </p>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-[#E8EDF2]">Data Health</h1>
        <p className="text-sm text-slate-500 dark:text-[#8A95A3]">No data yet.</p>
      </div>
    );
  }

  const totalSessions = snapshot.sidecarCoverage.total;

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-[#E8EDF2]">Data Health</h1>
      <p className="text-xs text-slate-500 dark:text-[#8A95A3]">
        Trust indicators for everything the dashboard shows. Server uptime since{" "}
        {new Date(snapshot.observedSince).toLocaleString()}.
      </p>

      <DedupPricingStats dedup={snapshot.dedup} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PricingCoverageTable coverage={snapshot.pricingCoverage} />
        <ParseErrorsPanel parseErrors={snapshot.parseErrors} />
      </div>

      <ScanCoveragePanel scan={snapshot.scan} />

      <ReconciliationPanel reconciliation={snapshot.reconciliation} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CaptureGapsPanel captureGaps={snapshot.captureGaps} totalSessions={totalSessions} />
        <BoundaryMismatchesPanel />
      </div>

      {/* Visually-hidden live region (review A11Y-6): announces background
          refetches so screen-reader users know the dashboard refreshed
          without having to manually re-read every section. */}
      <p role="status" aria-live="polite" className="sr-only">
        {isFetchingAfterFirst ? "Data Health updated." : ""}
      </p>
    </div>
  );
}
