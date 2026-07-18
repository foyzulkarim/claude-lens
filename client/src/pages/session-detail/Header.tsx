import type React from "react";
import { TierBadge, costTierLevel } from "../../components/TierBadge.js";
import { Badge } from "../../components/Badge.js";
import type { SessionDetailHeader } from "../../../../shared/session-detail-contract.js";
import {
  formatCost,
  formatCostBasis,
  formatMedianDelta,
  formatPercent,
  isPremiumUnavailable,
  shortId,
} from "./format.js";

export interface HeaderProps {
  header: SessionDetailHeader;
}

/**
 * Session Detail header (#P4-5, T7): identity (id, project, branch, version,
 * models, time), tier badge, computed cost, and the "vs your median" badge.
 *
 * Honest "unavailable" states: the drift badge (computed vs observed) and
 * the context % are reserved for #P4-13 — when absent we render "—" rather
 * than fabricating 0%. Optional `meta.availability` (passed implicitly via
 * `drift === undefined`) drives a single tier banner explaining what's
 * missing instead of inventing fake numbers.
 */
export function Header({ header }: HeaderProps): React.JSX.Element {
  return (
    <section
      aria-label="Session header"
      data-testid="session-detail-header"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-mono text-[22px] font-semibold text-slate-900 dark:text-[#E8EDF2]">
            {shortId(header.sessionId)}
          </h1>
          <span className="font-mono text-xs text-slate-500 dark:text-[#8A96A5]">
            {header.project}
          </span>
          <span className="font-mono text-xs text-slate-500 dark:text-[#8A96A5]">
            {header.branch}
          </span>
          <span className="font-mono text-xs text-slate-500 dark:text-[#8A96A5]">
            v{header.version}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TierBadge level={costTierLevel(header.tier)}>{formatCostBasis(header.tier)}</TierBadge>
          {header.models.slice(0, 2).map((m) => (
            <Badge key={m}>{m}</Badge>
          ))}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Cost (computed)" value={formatCost(header.costComputed)} />
        <Stat label="vs median" value={formatMedianDelta(header)} />
        <Stat label="Logical turns" value={String(header.logicalTurnCount)} />
        <Stat label="Calls" value={String(header.callCount)} />
        <Stat label="Context (est.)" value={formatPercent(header.contextPctEstimated ?? null)} />
        <Stat label="Drift (computed vs observed)" value={formatCost(header.drift?.delta)} />
        <Stat
          label="Started"
          value={header.firstAt ? header.firstAt.slice(0, 16).replace("T", " ") : "—"}
        />
        <Stat
          label="Last activity"
          value={header.lastAt ? header.lastAt.slice(0, 16).replace("T", " ") : "—"}
        />
      </dl>

      {isPremiumUnavailable(header) ? (
        <p
          role="note"
          data-testid="premium-unavailable"
          className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-200"
        >
          Cost observed, drift, and context samples require premium capture (<code>cost.jsonl</code>
          , <code>turn-boundaries.jsonl</code>,<code>cost-log.jsonl</code>) — landing in #P4-13.
        </p>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-[#8A96A5]">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-sm text-slate-900 dark:text-[#E8EDF2]">{value}</dd>
    </div>
  );
}
