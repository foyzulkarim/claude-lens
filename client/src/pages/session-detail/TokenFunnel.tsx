import type { SessionDetailTokenFunnel } from "../../../../shared/session-detail-contract.js";
import { formatTokens } from "./format.js";

export interface TokenFunnelProps {
  funnel: SessionDetailTokenFunnel;
}

/**
 * Semantic token-flow panel (#P4-5, T10). Four bars in the canonical
 * server-reconciled order — context offered = cache served + fresh
 * billed, output separate. Every value comes straight from the projector's
 * reconciled response so a malformed payload fails the runtime guard at
 * fetch, not in render.
 *
 * Narrative intent: "context vs output" is the headline ratio the panel
 * exists to surface. We compute it once here for the readable summary line
 * but never alter the server's reconciled numbers — the bars always equal
 * `funnel.contextOffered` and `funnel.output` directly.
 */
export function TokenFunnel({ funnel }: TokenFunnelProps): React.JSX.Element {
  const peak = Math.max(funnel.contextOffered, funnel.output, 1);
  const ratio = funnel.contextOffered > 0 ? funnel.output / funnel.contextOffered : 0;
  return (
    <section
      aria-label="Token funnel"
      data-testid="session-detail-token-funnel"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Token funnel</h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-[#8A96A5]">
        Output is ~{(ratio * 100).toFixed(1)}% of the wire context.
      </p>
      <ul aria-label="Token stages" className="mt-3 space-y-2">
        <FunnelBar label="Context offered" value={funnel.contextOffered} peak={peak} />
        <FunnelBar label="Cache served" value={funnel.cacheServed} peak={peak} />
        <FunnelBar label="Fresh billed" value={funnel.freshBilled} peak={peak} />
        <FunnelBar label="Output" value={funnel.output} peak={peak} />
      </ul>
    </section>
  );
}

function FunnelBar({
  label,
  value,
  peak,
}: {
  label: string;
  value: number;
  peak: number;
}): React.JSX.Element {
  const width = peak > 0 ? (value / peak) * 100 : 0;
  return (
    <li
      className="flex items-center gap-2 text-[11px]"
      aria-label={`${label}: ${formatTokens(value)}`}
    >
      <span className="w-28 font-mono text-slate-700 dark:text-[#E8EDF2]">{label}</span>
      <div className="relative h-3 flex-1 rounded bg-slate-100 dark:bg-[#232B36]">
        <div
          className="absolute inset-y-0 left-0 rounded bg-violet-600 dark:bg-violet-400"
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="w-16 text-right font-mono text-slate-700 dark:text-[#E8EDF2]">
        {formatTokens(value)}
      </span>
    </li>
  );
}
