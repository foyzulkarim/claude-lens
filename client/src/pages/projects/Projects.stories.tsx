import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import type { FilterState } from "../../filters/state.js";
import { BranchBreakdown } from "./BranchBreakdown.js";
import { EfficiencyTable } from "./EfficiencyTable.js";
import { ProjectSelector } from "./ProjectSelector.js";
import { SpendComposition } from "./SpendComposition.js";

/**
 * Projects page Storybook stories (Phase 4 standing rule 1:
 * "Component states covered in Storybook (not Cypress)").
 *
 * The Chart component renders an empty canvas in jsdom-based
 * Storybook (ECharts requires a real renderer); coverage of the
 * post-fetch states still happens here, and the canvas-rendering
 * semantics are exercised in the Cypress smoke spec. Mirrors the
 * Models page's coverage split.
 */

const POPULATED_FILTERS: FilterState = {
  range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-18T00:00:00.000Z" },
  project: [],
  model: [],
  branch: [],
  host: [],
};

function point(
  value: number | null,
  t = "2026-07-10T00:00:00.000Z",
): { t: string; value: number | null } {
  return { t, value };
}

function seriesFor(
  measure: Series["measure"],
  label: string,
  values: { t: string; value: number | null }[],
  prevValues?: { t: string; value: number | null }[],
): Series {
  return {
    measure,
    dimensionKey: `project:${label}`,
    label,
    points: values,
    ...(prevValues ? { compareGhost: prevValues } : {}),
    ...(measure === "costComputed" ? { basis: "computed" as const } : {}),
  };
}

function populatedCompositionSeries(): Series[] {
  // Multiple time buckets + multiple projects, so the stacked area
  // composer has real "top-N + other" math to do when this set is
  // large.
  const buckets = [
    "2026-07-01T00:00:00.000Z",
    "2026-07-08T00:00:00.000Z",
    "2026-07-15T00:00:00.000Z",
  ];
  const projects: Array<[string, number[]]> = [
    ["agentic-swe-vod", [40, 50, 60]],
    ["tokenowl_docs", [20, 18, 10]],
    ["skills", [10, 15, 25]],
  ];
  const series: Series[] = [];
  for (const [name, vals] of projects) {
    series.push(
      seriesFor(
        "costComputed",
        name,
        buckets.map((b, i) => point(vals[i] ?? 0, b)),
      ),
    );
  }
  return series;
}

function largeCompositionSeries(): Series[] {
  // 12 projects so the top-N + "other" composer reduces it to 9 bands.
  const buckets = [
    "2026-07-01T00:00:00.000Z",
    "2026-07-08T00:00:00.000Z",
    "2026-07-15T00:00:00.000Z",
  ];
  const series: Series[] = [];
  for (let i = 0; i < 12; i++) {
    const value = 30 - i;
    series.push(
      seriesFor(
        "costComputed",
        `proj-${i}`,
        buckets.map((b) => point(value, b)),
      ),
    );
  }
  return series;
}

function populatedEfficiencySeries(): Series[] {
  // The efficiency table expects a `(measure × project)` Series set
  // with compareGhost populated for the WoW column to render real
  // deltas.
  const projects = [
    { name: "agentic-swe-vod", cost: 82.24, costPrev: 26.32, sessions: 6 },
    { name: "tokenowl_docs", cost: 29.81, costPrev: 36.36, sessions: 4 },
    { name: "skills", cost: 29.04, costPrev: 17.71, sessions: 5 },
    { name: ".claude", cost: 19.61, costPrev: 14.97, sessions: 4 },
    { name: "aswe-lms", cost: 9.0, sessions: 2 }, // no previous period
  ];
  const series: Series[] = [];
  for (const p of projects) {
    series.push(
      seriesFor(
        "costComputed",
        p.name,
        [point(p.cost)],
        p.costPrev !== undefined ? [point(p.costPrev)] : undefined,
      ),
    );
    series.push(seriesFor("sessions", p.name, [point(p.sessions)]));
    series.push(seriesFor("inputTokens", p.name, [point(800_000)]));
    series.push(seriesFor("outputTokens", p.name, [point(60_000)]));
    series.push(seriesFor("cacheReadTokens", p.name, [point(9_500_000)]));
    series.push(seriesFor("cacheCreateTokens", p.name, [point(100_000)]));
    series.push(seriesFor("turns", p.name, [point(40)]));
  }
  return series;
}

function populatedBranchSeries(): Series[] {
  // 5 branches — the default cap shows 3, the "show all" toggle
  // expands to 5.
  const branches: Array<[string, number]> = [
    ["feat/vod-ingest", 61.28],
    ["main", 15.93],
    ["fix/upload-retry", 5.03],
    ["chore/cleanup", 2.5],
    ["feat/analytics", 1.1],
  ];
  return branches.map(([branch, cost]) => seriesFor("costComputed", branch, [point(cost)]));
}

function withQueryClient(children: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function withRouter(children: ReactElement, path = "/projects") {
  const { hook, searchHook } = memoryLocation({ path, static: true });
  return (
    <Router hook={hook} searchHook={searchHook}>
      {children}
    </Router>
  );
}

function PageStack({ children }: { children: ReactNode }) {
  return (
    <div className="flex max-w-5xl flex-col gap-4 bg-slate-50 p-4 dark:bg-[#0B0F14]">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page-level stories (full composition)
// ---------------------------------------------------------------------------

function PopulatedPage() {
  return withRouter(
    withQueryClient(
      <PageStack>
        <SpendComposition
          data={populatedCompositionSeries()}
          filters={POPULATED_FILTERS}
          grain="day"
        />
        <EfficiencyTable data={populatedEfficiencySeries()} filters={POPULATED_FILTERS} />
        <ProjectSelector
          projects={["agentic-swe-vod", "tokenowl_docs", "skills", ".claude"]}
          selectedProjectId="agentic-swe-vod"
          onSelect={() => {}}
        />
        <BranchBreakdown
          data={populatedBranchSeries()}
          project="agentic-swe-vod"
          filters={POPULATED_FILTERS}
        />
      </PageStack>,
    ),
  );
}

function EmptyPage() {
  return withRouter(
    withQueryClient(
      <PageStack>
        <SpendComposition data={[]} filters={POPULATED_FILTERS} grain="day" />
        <EfficiencyTable data={[]} filters={POPULATED_FILTERS} />
        <ProjectSelector projects={[]} selectedProjectId={null} onSelect={() => {}} />
        <BranchBreakdown data={[]} project={null} filters={POPULATED_FILTERS} />
      </PageStack>,
    ),
  );
}

function LoadingPage() {
  return withRouter(
    withQueryClient(
      <PageStack>
        <SpendComposition data={undefined} filters={POPULATED_FILTERS} grain="day" isPending />
        <EfficiencyTable data={undefined} filters={POPULATED_FILTERS} isPending />
        <ProjectSelector projects={[]} selectedProjectId={null} onSelect={() => {}} isPending />
        <BranchBreakdown data={undefined} project={null} filters={POPULATED_FILTERS} isPending />
      </PageStack>,
    ),
  );
}

function FailedPage() {
  return withRouter(
    withQueryClient(
      <PageStack>
        <SpendComposition
          data={undefined}
          filters={POPULATED_FILTERS}
          grain="day"
          isError
          error={new Error("Metrics endpoint unreachable")}
        />
        <EfficiencyTable
          data={undefined}
          filters={POPULATED_FILTERS}
          isError
          error={new Error("Metrics endpoint unreachable")}
        />
        <ProjectSelector projects={[]} selectedProjectId={null} onSelect={() => {}} />
        <BranchBreakdown
          data={undefined}
          project={null}
          filters={POPULATED_FILTERS}
          isError
          error={new Error("Metrics endpoint unreachable")}
        />
      </PageStack>,
    ),
  );
}

function LargeSetPage() {
  return withRouter(
    withQueryClient(
      <PageStack>
        <SpendComposition data={largeCompositionSeries()} filters={POPULATED_FILTERS} grain="day" />
      </PageStack>,
    ),
  );
}

const meta: Meta = { title: "Pages/Projects/States" };
export default meta;
type Story = StoryObj;

export const AllPopulated: Story = { render: () => <PopulatedPage /> };
export const AllEmpty: Story = { render: () => <EmptyPage /> };
export const AllLoading: Story = { render: () => <LoadingPage /> };
export const AllFailed: Story = { render: () => <FailedPage /> };
export const TopNComposer: Story = { render: () => <LargeSetPage /> };

export { populatedBranchSeries, populatedCompositionSeries, populatedEfficiencySeries };
