/**
 * Pure URL builders for the Models page's dimension drill-throughs.
 *
 * Each helper appends one dimension chip (`model` or `entrypoint`) to
 * the existing serialized global filter query and returns a
 * `/sessions?<that query>` URL. Lives alongside the page directory
 * rather than in `client/src/charts/drilldown.ts` because:
 *
 *   1. These are Models-only — no other page needs them today.
 *   2. The shared `drilldown.ts` is the home for time-bucket drills
 *      (used by charts). Mixing dimension drills in there would couple
 *      the chart layer to Models.
 *   3. The shape is simpler: a dimension value, not a (timestamp, grain)
 *      pair — so a single helper per dimension is the right granularity.
 *
 * `version` is intentionally NOT drilled to /sessions: the Sessions
 * page's URL schema understands `version` only as a sort column, not a
 * filter dimension (see `shared/sessions-contract.ts:SessionListParams`).
 * The Before/After CC-update panel therefore presents the two buckets
 * side-by-side without a drill-link until the Sessions filter contract
 * gains `version`.
 *
 * No React, no router imports — pure URL construction so the page's
 * Storybook stories and Vitest suite can pin behavior without mounting
 * a wouter tree.
 */

import type { FilterState } from "../../filters/state.js";

/** Builds the canonical chip-CSV segment the Filters URL uses for a
 * dimension value (sorted + comma-joined). Single point of truth so the
 * chart layer's `sessionsHrefForBucket` and these helpers stay in
 * lockstep. */
function chipSegment(dimension: "model" | "entrypoint", value: string): string {
  return `${dimension}=${encodeURIComponent(value)}`;
}

/** All four global chip dimensions — kept so the helper preserves every
 * existing filter (project/branch/host) verbatim rather than only the
 * dimension being drilled into. */
function baseFiltersExcept(filters: FilterState, exclude: "model" | "entrypoint"): string {
  const parts: string[] = [];
  if (filters.project.length > 0) {
    parts.push(`project=${[...filters.project].sort().map(encodeURIComponent).join(",")}`);
  }
  if (exclude !== "model" && filters.model.length > 0) {
    parts.push(`model=${[...filters.model].sort().map(encodeURIComponent).join(",")}`);
  }
  if (filters.branch.length > 0) {
    parts.push(`branch=${[...filters.branch].sort().map(encodeURIComponent).join(",")}`);
  }
  if (filters.host.length > 0) {
    parts.push(`host=${[...filters.host].sort().map(encodeURIComponent).join(",")}`);
  }
  // Custom date ranges survive the drill too, so a user drilled into
  // a model from a non-preset range doesn't get bumped back to "7d".
  const range = filters.range;
  if ("preset" in range && range.preset !== "7d") {
    parts.push(`range=${range.preset}`);
  } else if (!("preset" in range)) {
    parts.push(`from=${encodeURIComponent(range.from)}`);
    parts.push(`to=${encodeURIComponent(range.to)}`);
  }
  return parts.join("&");
}

/** `/sessions?model=<value>&<preserved filters>` — replaces any existing
 * model chip so two clicks on the same model produce the same URL. */
export function modelHref(model: string, filters: FilterState): string {
  const base = baseFiltersExcept(filters, "model");
  const seg = chipSegment("model", model);
  return `/sessions?${base ? `${base}&${seg}` : seg}`;
}

/** `/sessions?entrypoint=<value>&<preserved filters>` — replaces any
 * existing entrypoint chip. The Sessions page's URL schema understands
 * `entrypoint=<csv>` as a filter dimension (see
 * `shared/sessions-contract.ts`). */
export function entrypointHref(entrypoint: string, filters: FilterState): string {
  const base = baseFiltersExcept(filters, "entrypoint");
  const seg = chipSegment("entrypoint", entrypoint);
  return `/sessions?${base ? `${base}&${seg}` : seg}`;
}
