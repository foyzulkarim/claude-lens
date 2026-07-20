import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "wouter";
import type { GateEvidence, GateReport, GateResult } from "../../../../shared/gates-contract.js";
import { GateStatusBadge } from "../../components/GateStatusBadge.js";

export interface ReportCardViewProps {
  data: GateReport;
}

/**
 * Pure presentational Report Card (ARCH-p4-12 §High-Level Structure).
 * Mirrors `SessionDetailView`'s split: this view is presentational,
 * `ReportCard.tsx` owns the fetch. Two evidence drill kinds per
 * gates.md §1:
 *
 *  - turn-keyed evidence (V1, V2, P3, C3, K2) — `turnN`+`callId` →
 *    `/session/:id/turn/:n` (Turn Inspector) with a `callId`-style
 *    anchor the existing route already supports.
 *  - session-scoped evidence (E1/E2) — `filePath`+`detail` only;
 *    RENDERED INLINE below the row rather than navigating (per the
 *    decision in the ARCH: "E1/E2 evidence drill [lands on] Session
 *    Detail itself, no `/api/files` route"). No additional fetch.
 *
 * Score letter uses the new `GateStatusBadge` (single source of color
 * across the five surfaces). Per-gate row repeats the same badge so
 * a fail E1 row reads the same red as a fail Report Card F letter.
 *
 * Hash anchor + focus: the AnomalyFeed deep-links to
 * `/sessions/:id#report-card`; without `id="report-card"` the browser
 * silently fails to scroll, and screen-reader users get no focus
 * target (#P4-12 review finding #21). The `tabIndex={-1}` lets the
 * section programmatically receive focus without putting it in the
 * tab order; the `useEffect` on the route hash focuses it on mount
 * when the URL contains the matching fragment.
 */
export function ReportCardView({ data }: ReportCardViewProps): ReactNode {
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    if (hash !== "report-card") return;
    const node = sectionRef.current;
    if (node && typeof node.focus === "function") node.focus();
    // Run once on mount — the only way the hash changes post-mount is
    // via a parent re-render that re-mounts this view, which would
    // re-fire the effect anyway.
  }, []);

  return (
    <section
      ref={sectionRef}
      id="report-card"
      tabIndex={-1}
      data-testid="report-card"
      aria-label={`Report Card for session ${data.sessionId}`}
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#96631E] dark:border-[#232B36] dark:bg-[#151A21] dark:focus-visible:ring-[#E8A33D]"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Report Card</h2>
        <div className="flex items-center gap-3">
          <GateStatusBadge letter={data.scoreLetter} />
          <span className="font-mono text-xs text-slate-500 dark:text-[#8A96A5]">
            {data.score.toFixed(2)} / 6 checks
          </span>
        </div>
      </header>
      <ul className="flex flex-col gap-2" aria-label="Gate results">
        {data.gates.map((gate) => (
          <GateRow key={gate.gateId} gate={gate} sessionId={data.sessionId} />
        ))}
      </ul>
      <p className="text-xs text-slate-500 dark:text-[#8A96A5]">Evaluated at {data.evaluatedAt}</p>
    </section>
  );
}

interface GateRowProps {
  gate: GateResult;
  sessionId: string;
}

function GateRow({ gate, sessionId }: GateRowProps): ReactNode {
  const isTurnKeyed = gate.evidence.length > 0 && gate.evidence[0]?.turnN !== undefined;
  return (
    <li
      data-testid={`gate-row-${gate.gateId}`}
      data-gate-id={gate.gateId}
      data-status={gate.status}
      className="flex flex-col gap-1 border-b border-slate-100 pb-2 last:border-b-0 dark:border-[#232B36]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-slate-900 dark:text-[#E8EDF2]">
          {gate.gateId}
        </span>
        <GateStatusBadge status={gate.status} />
      </div>
      {gate.evidence.length > 0 ? (
        <ul className="ml-4 flex flex-col gap-1">
          {gate.evidence.map((evidence) => (
            <EvidenceRow
              // Stable by gateId + detail text + (when present) turnN —
              // order within a gate's evidence list is deterministic in
              // the engine's emit order, so the index doesn't actually
              // need to be the tie-breaker.
              key={`${gate.gateId}-${evidence.turnN ?? "x"}-${evidence.detail.slice(0, 32)}`}
              evidence={evidence}
              sessionId={sessionId}
              isTurnKeyed={isTurnKeyed}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

interface EvidenceRowProps {
  evidence: GateEvidence;
  sessionId: string;
  isTurnKeyed: boolean;
}

function EvidenceRow({ evidence, sessionId, isTurnKeyed }: EvidenceRowProps): ReactNode {
  if (isTurnKeyed && evidence.turnN !== undefined) {
    return (
      <li className="flex flex-col gap-0.5 text-xs text-slate-700 dark:text-[#B8C3CC]">
        <p>{evidence.detail}</p>
        <Link
          href={`/session/${encodeURIComponent(sessionId)}/turn/${evidence.turnN}`}
          aria-label={`Open turn ${evidence.turnN} in Turn Inspector`}
          className="text-xs font-medium text-[#96631E] dark:text-[#E8A33D]"
        >
          View turn {evidence.turnN} →
        </Link>
      </li>
    );
  }

  // Session-scoped (E1/E2) — inline expand, no fetch.
  return (
    <li className="flex flex-col gap-0.5 text-xs text-slate-700 dark:text-[#B8C3CC]">
      <p>{evidence.detail}</p>
      {evidence.filePath !== undefined ? (
        <span className="block break-all rounded bg-slate-50 px-1 py-0.5 font-mono text-[11px] text-slate-700 dark:bg-[#0B0F14] dark:text-[#B8C3CC]">
          {evidence.filePath}
        </span>
      ) : null}
    </li>
  );
}
