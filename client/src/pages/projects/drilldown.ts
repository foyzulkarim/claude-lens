/**
 * Pure URL builders for the Projects page's dimension drill-throughs.
 *
 * Two helpers, one filter-source of truth:
 *
 *   - `projectHref(project, filters)` — replaces any existing `project`
 *     chip and emits `/sessions?project=<csv>&<preserved filters>`.
 *   - `branchHref(project, branch, filters)` — keeps the user-funneled
 *     `project=<x>&branch=<csv>&<preserved filters>` shape so a click on
 *     `<project> · by branch` lands directly on the right drilldown view.
 *
 * Both helpers live alongside the page directory rather than in
 * `client/src/charts/drilldown.ts` because:
 *
 *   1. They're Projects-only — no other page needs `projectHref` or
 *      `branchHref` today, and `models/drilldown.ts` already proved the
 *      pattern of per-page helpers gives the right granularity.
 *   2. The shared `charts/drilldown.ts` owns time-bucket drills
 *      (`sessionsHrefForBucket`); mixing dimension chips in there would
 *      couple chart-layer code to a page-specific concern.
 *
 * No React, no router imports — pure URL construction so the page's
 * Storybook stories and Vitest suite can pin behavior without mounting
 * a wouter tree (mirrors `models/drilldown.ts`'s rationale).
 *
 * `branch` is the URL's clean name for the contract's `gitBranch`
 * dimension (`CHIP_DIMENSION` in `filters/state.ts`); the helper
 * reuses that mapping by spelling the chip `branch=` directly.
 */

import type { FilterState } from "../../filters/state.js";

/** Builds the canonical chip-CSV segment the Filters URL uses for one
 * dimension value (sorted + comma-joined for the value list, but
 * `chipSegment` here emits a single-value chip since callers always
 * pass a single project/branch value). Single point of truth so
 * `projectHref` and `branchHref` stay in lockstep with the chart
 * layer's `sessionsHrefForBucket`. */
function chipSegment(chip: "project" | "branch", value: string): string {
  return `${chip}=${encodeURIComponent(value)}`;
}

/** Emits the preserved-filters prefix (`<chip>=<csv>&...`) for every
 * chip dimension except the ones being replaced. Mirrors
 * `models/drilldown.ts`'s `baseFiltersExcept` — kept inline here
 * because Projects' exclude set is two chips at once (`project` and
 * `branch`) for `branchHref`, so a single-purpose helper reads cleaner. */
function baseFiltersExcept(
  filters: FilterState,
  exclude: { project?: boolean; branch?: boolean },
): string {
  const parts: string[] = [];
  if (!exclude.project && filters.project.length > 0) {
    parts.push(`project=${[...filters.project].sort().map(encodeURIComponent).join(",")}`);
  }
  if (!exclude.branch && filters.branch.length > 0) {
    parts.push(`branch=${[...filters.branch].sort().map(encodeURIComponent).join(",")}`);
  }
  if (filters.model.length > 0) {
    parts.push(`model=${[...filters.model].sort().map(encodeURIComponent).join(",")}`);
  }
  if (filters.host.length > 0) {
    parts.push(`host=${[...filters.host].sort().map(encodeURIComponent).join(",")}`);
  }
  // Custom date ranges survive the drill so a user drilled into a
  // project from a non-preset range doesn't get bumped back to "7d".
  const range = filters.range;
  if ("preset" in range && range.preset !== "7d") {
    parts.push(`range=${range.preset}`);
  } else if (!("preset" in range)) {
    parts.push(`from=${encodeURIComponent(range.from)}`);
    parts.push(`to=${encodeURIComponent(range.to)}`);
  }
  return parts.join("&");
}

/** `/sessions?project=<value>&<preserved filters>` — replaces any
 * existing `project` chip so two clicks on the same project produce
 * the same URL. */
export function projectHref(project: string, filters: FilterState): string {
  const base = baseFiltersExcept(filters, { project: true });
  const seg = chipSegment("project", project);
  return `/sessions?${base ? `${base}&${seg}` : seg}`;
}

/** `/sessions?project=<p>&branch=<b>&<preserved filters>` — emits
 * both chips so the Sessions page lands directly on the per-project,
 * per-branch filtered view. Both chips are single-value CSV (no
 * comma-join), so re-clicking the same `<p> · <b>` produces a stable URL. */
export function branchHref(project: string, branch: string, filters: FilterState): string {
  const base = baseFiltersExcept(filters, { project: true, branch: true });
  const projSeg = chipSegment("project", project);
  const branchSeg = chipSegment("branch", branch);
  return `/sessions?${base ? `${base}&${projSeg}&${branchSeg}` : `${projSeg}&${branchSeg}`}`;
}
