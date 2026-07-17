import type { ReactNode } from "react";
import type { TierFlags } from "../../../shared/types.js";
import { Badge, type BadgeVariant } from "./Badge.js";

export type TierLevel = "exact" | "estimated" | "locked";

export interface TierBadgeProps {
  level: TierLevel;
  children?: ReactNode;
}

const DOT: Record<TierLevel, string> = {
  exact: "🟢",
  estimated: "🟡",
  locked: "🔴",
};

const VARIANT: Record<TierLevel, BadgeVariant> = {
  exact: "premium",
  estimated: "computed",
  locked: "fail",
};

const LABEL: Record<TierLevel, string> = {
  exact: "exact",
  estimated: "estimated",
  locked: "locked",
};

/** Maps the shared `TierFlags` contract to a presentational tier level.
 * `locked` is never derivable from `TierFlags` — it's a page-side statement
 * that a premium-only section has no data source at all. */
export function costTierLevel(flags: TierFlags): "exact" | "estimated" {
  return flags.costBasis === "observed" ? "exact" : "estimated";
}

export function TierBadge({ level, children }: TierBadgeProps) {
  return (
    <Badge variant={VARIANT[level]}>
      <span aria-hidden="true">{DOT[level]}</span>
      <span className="sr-only">{LABEL[level]}</span>
      {children ? <span className="ml-1">{children}</span> : null}
    </Badge>
  );
}
