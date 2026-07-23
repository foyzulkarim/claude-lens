import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { fetchCaptureAssets } from "../../api/captureAssets.js";
import { qk } from "../../api/queryKeys.js";
import { listSessions } from "../../api/sessions.js";

interface Step {
  badge: string;
  content: ReactNode;
}

/**
 * Setup steps driven by the resolved `capture/` directory
 * (ARCH-producer-cost-capture-tier §API Contracts, R4). Three states:
 * resolving, resolved (real runnable command + a delegate-to-Claude-Code
 * prompt, R8), and unresolved (manual fallback, S7) — a dev server started
 * outside a build, or an install stripped of `dist/capture`.
 */
function buildSteps(captureDir: string | null | undefined, isPending: boolean): Step[] {
  if (isPending) {
    return [
      { badge: "1", content: "Resolving capture assets…" },
      { badge: "2", content: "Run one session → verify below" },
    ];
  }
  if (captureDir) {
    const installCmd = `bash ${captureDir}/install.sh`;
    return [
      {
        badge: "1",
        content: (
          <>
            Run{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] dark:bg-[#232B36]">
              {installCmd}
            </code>{" "}
            in a terminal on this machine.
          </>
        ),
      },
      {
        badge: "2",
        content: (
          <>
            Or paste this into a Claude Code session on this machine:{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] dark:bg-[#232B36]">
              Please run {installCmd} to set up claude-lens cost capture.
            </code>
          </>
        ),
      },
      { badge: "3", content: "Run one session → verify below" },
    ];
  }
  return [
    {
      badge: "1",
      content:
        "Capture assets weren't found on this server (a dev server started outside a build, or a stripped install).",
    },
    {
      badge: "2",
      content: (
        <>
          From a repo checkout, copy <code>capture/*.cjs</code> into <code>~/.claude/scripts</code>{" "}
          and merge <code>capture/settings.snippet.json</code> into{" "}
          <code>~/.claude/settings.json</code> — see <code>capture/README.md</code>.
        </>
      ),
    },
    { badge: "3", content: "Run one session → verify below" },
  ];
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/**
 * Cost-capture setup guide (#P4-15, pages spec §10; paths wired to real
 * assets by ARCH-producer-cost-capture-tier). Steps are driven by
 * `GET /api/capture-assets` so they name a real, runnable install path
 * instead of static phantom-file instructions — even for `npx` installs,
 * whose unpack directory is unguessable (R7). The live "verified" readout
 * sourced from `GET /api/sessions`'s `meta.captureSummary` is unchanged.
 */
export function CostCaptureGuide() {
  const assetsQuery = useQuery({
    queryKey: qk.captureAssets(),
    queryFn: ({ signal }) => fetchCaptureAssets(signal),
  });
  const STEPS = buildSteps(assetsQuery.data?.captureDir, assetsQuery.isPending);

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
            <span>{step.content}</span>
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
