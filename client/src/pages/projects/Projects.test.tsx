// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import { branchHref, projectHref } from "./drilldown.js";

const postMetricsMock = vi.fn<(query: unknown) => Promise<Series[]>>();
vi.mock("../../api/metrics.js", () => ({
  postMetrics: (query: unknown) => postMetricsMock(query),
}));

// jsdom has no ResizeObserver / canvas — the Chart stub mirrors
// CacheLab.test.tsx and Models.test.tsx.
vi.mock("../../charts/Chart.js", () => ({
  Chart: (props: { option: { series?: unknown[] }; className?: string; ariaLabel?: string }) => (
    <div
      data-testid="chart-stub"
      data-aria-label={props.ariaLabel ?? ""}
      className={props.className}
    />
  ),
}));

const { Projects } = await import("./Projects.js");
const { EfficiencyTable } = await import("./EfficiencyTable.js");

function renderAt(route = "/projects"): RenderResult {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const location = memoryLocation({ path: route });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <Router hook={location.hook} searchHook={location.searchHook}>
        <Projects />
      </Router>
    </QueryClientProvider>,
  );
  return { ...result, location };
}

interface RenderResult {
  // biome-ignore lint/suspicious/noExplicitAny: testing-library return shape varies; tests pin behavior, not type
  [key: string]: any;
}

function emptySeries(): Series[] {
  return [];
}

function populatedComposition(): Series[] {
  return [
    {
      measure: "costComputed",
      dimensionKey: "project:agentic-swe-vod",
      label: "agentic-swe-vod",
      points: [{ t: "2026-07-10T00:00:00.000Z", value: 40 }],
    },
    {
      measure: "costComputed",
      dimensionKey: "project:tokenowl_docs",
      label: "tokenowl_docs",
      points: [{ t: "2026-07-10T00:00:00.000Z", value: 20 }],
    },
  ];
}

function populatedEfficiency(): Series[] {
  return [
    {
      measure: "costComputed",
      dimensionKey: "project:agentic-swe-vod",
      label: "agentic-swe-vod",
      points: [{ t: "2026-07-10T00:00:00.000Z", value: 82.24 }],
      compareGhost: [{ t: "2026-07-10T00:00:00.000Z", value: 26.32 }],
    },
    {
      measure: "sessions",
      dimensionKey: "project:agentic-swe-vod",
      label: "agentic-swe-vod",
      points: [{ t: "2026-07-10T00:00:00.000Z", value: 6 }],
    },
    {
      measure: "costComputed",
      dimensionKey: "project:tokenowl_docs",
      label: "tokenowl_docs",
      points: [{ t: "2026-07-10T00:00:00.000Z", value: 29.81 }],
    },
    {
      measure: "sessions",
      dimensionKey: "project:tokenowl_docs",
      label: "tokenowl_docs",
      points: [{ t: "2026-07-10T00:00:00.000Z", value: 4 }],
    },
  ];
}

function populatedBranches(): Series[] {
  return [
    {
      measure: "costComputed",
      dimensionKey: "gitBranch:feat/vod-ingest",
      label: "feat/vod-ingest",
      points: [{ t: "2026-07-10T00:00:00.000Z", value: 61.28 }],
    },
    {
      measure: "costComputed",
      dimensionKey: "gitBranch:main",
      label: "main",
      points: [{ t: "2026-07-10T00:00:00.000Z", value: 15.93 }],
    },
  ];
}

afterEach(() => {
  cleanup();
  postMetricsMock.mockReset();
});

describe("Projects page shell", () => {
  it("renders the page heading and every section's testid", async () => {
    postMetricsMock.mockResolvedValue(populatedComposition());
    renderAt();

    expect(screen.getByRole("heading", { name: /^Projects$/, level: 1 })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("spend-composition")).toBeInTheDocument();
    });
    expect(screen.getByTestId("projects-efficiency")).toBeInTheDocument();
    expect(screen.getByTestId("project-selector")).toBeInTheDocument();
    expect(screen.getByTestId("branch-breakdown")).toBeInTheDocument();
  });

  it("renders loading copy while data is in flight", () => {
    postMetricsMock.mockReturnValue(new Promise(() => {}));
    renderAt();

    expect(screen.getByText(/Loading spend composition…/i)).toBeInTheDocument();
    expect(screen.getByText(/Loading projects…/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Pick a project above to see its branch-level spend/i),
    ).toBeInTheDocument();
  });

  it("renders empty-state copy when the engine returns no series", async () => {
    postMetricsMock.mockResolvedValue(emptySeries());
    renderAt();

    await waitFor(() => {
      // All three populated sections render their empty copy.
      expect(screen.getByText(/No project spend in this range\./i)).toBeInTheDocument();
    });
    expect(screen.getByText(/No projects in this range\./i)).toBeInTheDocument();
  });

  it("surfaces the failure state when an upstream error reaches a panel", async () => {
    postMetricsMock.mockRejectedValue(new Error("Metrics endpoint unreachable"));
    renderAt();

    await waitFor(() => {
      // Multiple panels (SpendComposition + EfficiencyTable) surface
      // the same error message — use getAllByText so the assertion
      // doesn't blow up on >1 match.
      expect(screen.getAllByText(/Metrics endpoint unreachable/i).length).toBeGreaterThan(0);
    });
  });

  it("auto-selects the top-cost project the first time efficiency lands", async () => {
    postMetricsMock.mockImplementation((query: unknown) => {
      const q = query as { dimensions: string[]; measures: string[] };
      // The efficiency query is the time × project query that asks for
      // several measures at once.
      if (
        q.dimensions.length === 2 &&
        q.dimensions[0] === "time" &&
        q.dimensions[1] === "project" &&
        Array.isArray(q.measures) &&
        q.measures.length > 1
      ) {
        return Promise.resolve(populatedEfficiency());
      }
      // Branches-by-project query.
      if (q.dimensions.length === 1 && q.dimensions[0] === "gitBranch") {
        return Promise.resolve(populatedBranches());
      }
      // Composition (time × project) and any other queries: return
      // the empty set.
      return Promise.resolve(emptySeries());
    });
    renderAt();

    await waitFor(() => {
      // The first efficiency row is `agentic-swe-vod` (cost 82.24),
      // so the section heading should reflect that selection once the
      // auto-select effect runs.
      expect(screen.getByText(/agentic-swe-vod · by branch/i)).toBeInTheDocument();
    });
  });

  it("requests time buckets and shows the latest nonzero activity", async () => {
    const filters: import("../../filters/state.js").FilterState = {
      range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-10T00:00:00.000Z" },
      project: [],
      model: [],
      branch: [],
      host: [],
    };
    const data: Series[] = [
      {
        measure: "costComputed",
        dimensionKey: "project:active-project",
        label: "active-project",
        points: [
          { t: "2026-07-01T00:00:00.000Z", value: 10 },
          { t: "2026-07-10T00:00:00.000Z", value: 0 },
        ],
      },
      {
        measure: "sessions",
        dimensionKey: "project:active-project",
        label: "active-project",
        points: [{ t: "2026-07-09T00:00:00.000Z", value: 1 }],
      },
    ];

    const { hook, searchHook } = memoryLocation({ path: "/projects", static: true });
    render(
      <Router hook={hook} searchHook={searchHook}>
        <EfficiencyTable data={data} filters={filters} now={new Date("2026-07-10T00:00:00.000Z")} />
      </Router>,
    );

    expect(screen.getByText("1d ago")).toBeInTheDocument();
  });

  it("clears a selected project that disappears after a global project filter changes", async () => {
    const branchFilters: string[][] = [];
    postMetricsMock.mockImplementation((query: unknown) => {
      const q = query as {
        dimensions: string[];
        measures: string[];
        filters?: { project?: string[] };
      };
      if (q.dimensions[0] === "gitBranch") {
        branchFilters.push(q.filters?.project ?? []);
        return Promise.resolve(populatedBranches());
      }
      if (q.dimensions[0] === "time" && q.dimensions[1] === "project") {
        return Promise.resolve(
          q.filters?.project?.includes("tokenowl_docs")
            ? populatedEfficiency().filter((s) => s.label === "tokenowl_docs")
            : populatedEfficiency(),
        );
      }
      return Promise.resolve(emptySeries());
    });
    const { location } = renderAt();

    await screen.findByText(/agentic-swe-vod · by branch/i);
    fireEvent.click(screen.getByRole("button", { name: "agentic-swe-vod" }));
    location.navigate("/projects?project=tokenowl_docs");

    await waitFor(() => {
      expect(screen.getByText(/tokenowl_docs · by branch/i)).toBeInTheDocument();
    });
    expect(branchFilters.every((projects) => projects.length <= 1)).toBe(true);
  });

  it("builds the projectHref URL with preserved filters when the table row is clicked", () => {
    const baseFilters: import("../../filters/state.js").FilterState = {
      range: { preset: "7d" },
      project: [],
      model: [],
      branch: [],
      host: [],
    };
    expect(projectHref("agentic-swe-vod", baseFilters)).toBe("/sessions?project=agentic-swe-vod");

    const customRange: import("../../filters/state.js").FilterState = {
      range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-18T00:00:00.000Z" },
      project: [],
      model: [],
      branch: [],
      host: [],
    };
    expect(projectHref("agentic-swe-vod", customRange)).toContain("project=agentic-swe-vod");
  });

  it("builds the branchHref URL with both project and branch chips", () => {
    const baseFilters: import("../../filters/state.js").FilterState = {
      range: { preset: "7d" },
      project: [],
      model: [],
      branch: [],
      host: [],
    };
    const href = branchHref("agentic-swe-vod", "feat/vod-ingest", baseFilters);
    // Raw URL must percent-encode the slash so two clicks on the same
    // branch produce the same URL.
    expect(href).toContain("branch=feat%2Fvod-ingest");
    const params = new URLSearchParams(href.slice("/sessions?".length));
    expect(params.get("project")).toBe("agentic-swe-vod");
    expect(params.get("branch")).toBe("feat/vod-ingest");
  });
});

// Reference the helper for closure even though the routes don't use
// it directly; keeps the linker from stripping the project file when
// strict tree-shaking is on.
void ({} as ReactElement);
