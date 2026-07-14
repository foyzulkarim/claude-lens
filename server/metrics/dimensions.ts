import type { Dimension } from "../../shared/metrics-contract.js";
import type { ApiCall, Turn } from "../../shared/types.js";

// Value extraction + filter matching for the metrics engine's dimension axes.
// "time" isn't a value-extraction target (engine.ts handles it via grain.ts's
// bucketing, not a per-record lookup); "gateStatus" lives on Turn, not
// ApiCall, hence the split into two functions below.
export type CallDimension = Exclude<Dimension, "time" | "gateStatus">;

const UNKNOWN = "unknown";

// A missing/empty scalar field buckets as "unknown" rather than being
// dropped, so per-bucket totals still reconcile against the unfiltered
// total (architecture cross-cutting rule).
function orUnknown(value: string): string {
  return value === "" ? UNKNOWN : value;
}

export function callDimensionValue(call: ApiCall, dim: CallDimension): string | string[] {
  switch (dim) {
    case "project":
      return orUnknown(call.cwd);
    case "model":
      return orUnknown(call.model);
    case "gitBranch":
      return orUnknown(call.gitBranch);
    case "version":
      return orUnknown(call.version);
    case "entrypoint":
      return orUnknown(call.entrypoint);
    case "sidechain":
      return call.isSidechain ? "sidechain" : "main";
    case "tool":
      // Multi-valued and fans out: a call using N distinct tools is a member
      // of N tool-dimension groups. Zero tools used is a real fact ("used no
      // tools"), not a missing value, so it returns [] rather than
      // ["unknown"] — the call simply contributes to no tool bucket.
      return [...new Set(call.tools.map((t) => t.name))];
    case "host":
      // No real data source yet (architecture §4 — labeled scan roots land
      // in #P4-15). Every call buckets under one constant value until then.
      return "default";
  }
}

export function turnDimensionValue(turn: Turn, dim: "gateStatus"): string {
  return turn[dim] ?? UNKNOWN;
}

export function matchesFilter(
  value: string | string[],
  allowed: (string | number)[] | undefined,
): boolean {
  if (allowed === undefined) return true;
  const values = Array.isArray(value) ? value : [value];
  const allowedStrings = allowed.map(String);
  return values.some((v) => allowedStrings.includes(v));
}
