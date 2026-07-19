import clsx from "clsx";
import type { GateStatus, ScoreLetter } from "../../../shared/gates-contract.js";
import { Badge, type BadgeVariant } from "./Badge.js";

/**
 * One source of truth for the gate status / letter color map across
 * the five surfaces that consume `gates.md` output:
 *
 *  - Session Detail Report Card (per-gate row + overall score letter)
 *  - Dashboard AnomalyFeed (`gateFailure` severity chip)
 *  - Sessions page `gateScore` column (per-session score letter)
 *  - Projects efficiency table (per-project pass-rate cell)
 *  - Trends gate pass-rate trend (no badge directly — but the chart
 *    color band for above/below a threshold reads these same tokens)
 *
 * Two presentation modes:
 *   - `mode="status"` — `pass` / `warn` / `fail` (per-gate rollup,
 *     per-session status, feed severity). Maps to the existing Badge
 *     `pass`/`warn`/`fail` variants (already used elsewhere).
 *   - `mode="letter"` — `A`/`B`/`C`/`D`/`F` (Report Card score letter).
 *     Maps via gates.md §"Report Card scoring" the same way.
 *
 * Both modes share `#E05252`/`#E8A33D`/`#8A96A5`-family tokens the rest
 * of the Dashboard already uses for severity (`AnomalyFeed.SEVERITY_CLASS`),
 * so a fail letter and a fail-severity row read as the same color — the
 * project-centralized token is what the `Badge.tsx` variants already
 * resolve to. No new palette additions.
 */

export interface GateStatusBadgeProps {
  /** Per-gate or per-session status (`pass`/`warn`/`fail`). */
  status?: GateStatus;
  /** Report Card score letter (`A`/`B`/`C`/`D`/`F`). Mutually exclusive with `status`. */
  letter?: ScoreLetter;
  /** Visible label — defaults to the status/letter itself. */
  label?: string;
  /** Optional Tailwind class additions — used by callers needing layout adjustments. */
  className?: string;
}

const STATUS_VARIANT: Record<GateStatus, BadgeVariant> = {
  pass: "pass",
  warn: "warn",
  fail: "fail",
};

/**
 * Letter → status mapping per `gates.md` §"Report Card scoring":
 * A → pass, B → pass, C → warn, D → fail, F → fail. Pure for testability.
 */
const LETTER_TO_STATUS: Record<ScoreLetter, GateStatus> = {
  A: "pass",
  B: "pass",
  C: "warn",
  D: "fail",
  F: "fail",
};

export function statusForLetter(letter: ScoreLetter): GateStatus {
  return LETTER_TO_STATUS[letter];
}

export function GateStatusBadge({ status, letter, label, className }: GateStatusBadgeProps) {
  if (!status && !letter) {
    // Defensive default — render a neutral placeholder rather than
    // mis-render. Five surfaces all pass one or the other; this branch
    // is the only "honest unavailable" seam.
    return <Badge variant="neutral">—</Badge>;
  }
  const resolved = (status ?? (letter ? statusForLetter(letter) : "pass")) as GateStatus;
  const text = label ?? status ?? (letter as string | undefined) ?? "";
  return (
    <span className={clsx("inline-flex", className)}>
      <Badge variant={STATUS_VARIANT[resolved]}>
        <span className="font-mono">{text}</span>
      </Badge>
    </span>
  );
}
