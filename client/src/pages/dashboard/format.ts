import type { TierFlags } from "../../../../shared/types.js";

/**
 * True when at least one premium capture source (cost-samples, turn-boundary,
 * or cost-log) is present for the whole install — the condition the
 * CaptureBanner (T14) uses to decide whether to render at all. Named for the
 * "C/B/L" shorthand the architecture doc uses for the three capture files.
 */
export function hasAnyCapture(flags: TierFlags): boolean {
  return flags.hasCostSamples || flags.hasTurnBoundaries || flags.hasCostLog;
}

/**
 * Names the specific capture sources missing from `flags`, in the same C/B/L
 * order the architecture doc introduces them — feeds the CaptureBanner's
 * copy so the CTA names what's actually absent rather than a generic
 * "no capture" statement.
 */
export function describeMissingCapture(flags: TierFlags): string {
  const missing: string[] = [];
  if (!flags.hasCostSamples) missing.push("observed cost samples");
  if (!flags.hasTurnBoundaries) missing.push("turn-boundary latency");
  if (!flags.hasCostLog) missing.push("the cost log");
  return missing.join(", ");
}
