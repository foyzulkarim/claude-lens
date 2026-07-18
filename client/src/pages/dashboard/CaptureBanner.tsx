import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { qk } from "../../api/queryKeys.js";
import { listSessions } from "../../api/sessions.js";
import { describeMissingCapture, hasAnyCapture } from "./format.js";
import { globalCaptureProbeParams } from "./queries.js";

/**
 * Global "set up cost capture" CTA (architecture §"Capture banner", T14).
 * Reads `meta.globalCapture` off a `limit: 1`, filter-free `GET
 * /api/sessions` call — the section-level lock makes global capture
 * presence a property of the whole install, not the active filter bar, so
 * this deliberately does NOT use `useFilters()` (unlike every other
 * dashboard section). Renders nothing once any of the three capture
 * sources (cost samples / turn boundaries / cost log) is present, and
 * nothing while loading or on error — a missing-capture nudge is a nice-to-
 * have, not something worth a visible error state of its own.
 */
export function CaptureBanner() {
  const params = globalCaptureProbeParams();
  const { data } = useQuery({
    queryKey: qk.sessions(params),
    queryFn: ({ signal }) => listSessions(params, signal),
  });

  if (!data || hasAnyCapture(data.meta.globalCapture)) return null;

  const missing = describeMissingCapture(data.meta.globalCapture);

  return (
    <div
      data-testid="capture-banner"
      className="flex flex-col items-start justify-between gap-3 rounded-md border border-[#96631E]/40 bg-[#96631E]/5 p-4 sm:flex-row sm:items-center dark:border-[#E8A33D]/30 dark:bg-[#E8A33D]/5"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
          Set up cost capture
        </p>
        <p className="mt-1 text-xs text-slate-600 dark:text-[#8B98A9]">
          Dollar figures are computed from tokens × pricing. Cost capture adds observed $, latency
          waterfalls, and lines-changed metrics — currently missing: {missing}.
        </p>
      </div>
      <Link
        href="/settings"
        className="shrink-0 rounded border border-[#96631E]/70 px-3 py-1.5 text-xs font-medium text-[#96631E] dark:border-[#E8A33D]/40 dark:text-[#E8A33D]"
      >
        Set up cost capture →
      </Link>
    </div>
  );
}
