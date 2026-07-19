import { useQuery } from "@tanstack/react-query";
import { qk } from "../../api/queryKeys.js";
import { listSessions } from "../../api/sessions.js";

const STEPS = [
  { badge: "1", text: "Copy cost-logger.js + turn-logger.js to ~/.claude/scripts" },
  { badge: "2", text: "Add statusline wrapper + Stop hook to settings.json" },
  { badge: "3", text: "Run one session → verify below" },
];

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/**
 * Cost-capture setup guide (#P4-15, pages spec §10). Static instructional
 * steps (copy scripts, wire the Stop hook) plus a live "verified" readout
 * sourced from `GET /api/sessions`'s `meta.captureSummary` — reuses the
 * existing fleet-wide capture aggregate instead of the not-yet-built
 * `/api/health` (#P4-14).
 */
export function CostCaptureGuide() {
  const query = useQuery({
    queryKey: qk.sessions({ limit: 1 }),
    queryFn: ({ signal }) => listSessions({ limit: 1 }, signal),
  });

  const summary = query.data?.meta.captureSummary;
  const verified = summary !== undefined && summary.capturingSessions > 0;

  return (
    <section
      data-testid="cost-capture-guide"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
        Cost capture setup{" "}
        <span className="text-xs font-normal text-slate-400">unlocks 🔴 features</span>
      </h2>
      <ol className="mt-3 flex flex-col gap-2 text-xs text-slate-600 dark:text-[#8A96A5]">
        {STEPS.map((step) => (
          <li key={step.badge} className="flex items-start gap-2">
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-[#232B36]">
              {step.badge}
            </span>
            <span>{step.text}</span>
          </li>
        ))}
        <li className="flex items-start gap-2">
          <span
            className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
              verified
                ? "bg-[#1E7A4D]/10 text-[#1E7A4D] dark:bg-[#3DDC8A]/10 dark:text-[#3DDC8A]"
                : "bg-slate-100 dark:bg-[#232B36]"
            }`}
          >
            {verified ? "✓" : "…"}
          </span>
          <span>
            {query.isPending && "Checking capture status…"}
            {query.isError && (
              <span className="text-[#B23A3A] dark:text-[#E05252]">{query.error.message}</span>
            )}
            {!query.isPending &&
              !query.isError &&
              summary &&
              (verified ? (
                <>
                  Last verified:{" "}
                  {summary.lastCapturedAt ? formatTimestamp(summary.lastCapturedAt) : "just now"} ·{" "}
                  {summary.capturingSessions} session{summary.capturingSessions === 1 ? "" : "s"}{" "}
                  capturing
                </>
              ) : (
                "No sessions capturing yet — complete steps 1–3 above."
              ))}
          </span>
        </li>
      </ol>
    </section>
  );
}
