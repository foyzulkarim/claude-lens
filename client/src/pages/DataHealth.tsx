import { useQuery } from "@tanstack/react-query";
import type { HealthSnapshot, PremiumFileClass } from "../../../shared/health-contract.js";
import { useStableNow } from "./dashboard/useStableNow.js";

// Data Health page (#P4-13 gating #P4-14, #P4-14). Surfaces per-file
// cumulative malformed-line counts the parsers emit (parse-premium.ts
// counts every malformed line on every read; the Store accumulates the
// per-file totals; this page renders them). Without this page the
// "malformed lines never throw" guarantee from architecture §5 is
// invisible to operators — a malformed file would silently co-exist with
// good data until someone grepped the logs.
//
// Polls `GET /api/health` on a 30 s interval (the WS bus carries
// session-level events, not file-level events). The WS bus would be
// overkill here: the consumer is an operator-facing dashboard, not a
// real-time UI.

function formatClassLabel(fileClass: PremiumFileClass): string {
  switch (fileClass) {
    case "cost":
      return "C";
    case "turn-boundaries":
      return "B";
    case "cost-log":
      return "L";
  }
}

/** Strip directory components without pulling in node:path (the browser
 *  bundle cannot resolve `node:path`). Handles both POSIX and Windows
 *  separators since file paths on the server may carry either. */
function basenameOf(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

export function DataHealth() {
  // 30 s poll cadence. The endpoint is cheap (O(observed file count)), and
  // the page is operator-facing rather than real-time.
  const query = useQuery<HealthSnapshot>({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error(`/api/health returned ${res.status}`);
      return (await res.json()) as HealthSnapshot;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
  // useStableNow keeps the "observed for Xm" / "last seen Xm ago"
  // counters from re-rendering on unrelated state changes; we use the
  // same hook the Dashboard uses for "duration" displays.
  const now = useStableNow();

  if (query.isLoading) {
    return <div className="page-stub">Loading health snapshot…</div>;
  }
  if (query.error) {
    return (
      <div className="page-stub" role="alert">
        Could not load health snapshot: {String(query.error)}
      </div>
    );
  }
  const snapshot = query.data;
  if (!snapshot) {
    return <div className="page-stub">No health data yet.</div>;
  }

  const uptimeMs = Math.max(0, now.getTime() - snapshot.observedSince);
  const uptimeMin = Math.round(uptimeMs / 60_000);
  const sortedFiles = [...snapshot.files].sort((a, b) => b.malformedCount - a.malformedCount);

  return (
    <div className="page data-health">
      <header className="data-health__header">
        <h1>Data Health</h1>
        <p className="data-health__summary">
          {formatCount(snapshot.totalMalformedLines)} malformed line
          {snapshot.totalMalformedLines === 1 ? "" : "s"} across{" "}
          {formatCount(snapshot.observedFileCount)} premium file
          {snapshot.observedFileCount === 1 ? "" : "s"} (server up for {formatCount(uptimeMin)}{" "}
          min).
        </p>
      </header>
      {sortedFiles.length === 0 ? (
        <p className="data-health__empty">
          No premium files observed yet. The server accumulates this list as C/B/L sidecars are
          discovered under <code>~/.claude/projects/{/**/}*.jsonl</code> and{" "}
          <code>~/.claude/cost-log.jsonl</code>.
        </p>
      ) : (
        <table className="data-health__table">
          <thead>
            <tr>
              <th scope="col">Class</th>
              <th scope="col">File</th>
              <th scope="col">Session</th>
              <th scope="col">Malformed lines</th>
              <th scope="col">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {sortedFiles.map((entry) => {
              const seenAgoMs = Math.max(0, now.getTime() - entry.lastUpdated);
              const seenAgoLabel =
                seenAgoMs < 60_000
                  ? "just now"
                  : seenAgoMs < 3_600_000
                    ? `${Math.round(seenAgoMs / 60_000)}m ago`
                    : `${Math.round(seenAgoMs / 3_600_000)}h ago`;
              return (
                <tr key={`${entry.fileClass}:${entry.filePath}`}>
                  <td>{formatClassLabel(entry.fileClass)}</td>
                  <td>
                    <code title={entry.filePath}>{basenameOf(entry.filePath)}</code>
                  </td>
                  <td>
                    {entry.sessionId ? (
                      <code>{entry.sessionId.slice(0, 8)}</code>
                    ) : (
                      <span className="data-health__session-global">(global)</span>
                    )}
                  </td>
                  <td className="data-health__count">{formatCount(entry.malformedCount)}</td>
                  <td>{seenAgoLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
