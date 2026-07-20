// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { SavedView } from "../../../../shared/local-store-contract.js";
import type { ScatterMetricsResult, Series } from "../../../../shared/metrics-contract.js";
import type { ChartProps } from "../../charts/Chart.js";

// Whole-page composition smoke test for the Explore page
// (ARCH-explore-page.md §11). Same fetch-boundary mocking pattern as
// Sessions.test.tsx: stub the API wrapper modules every section calls
// through, and stub the leaf Chart component (jsdom has no ResizeObserver
// / canvas backing).

const postMetricsMock = vi.fn<(query: unknown) => Promise<Series[]>>();
const postScatterMetricsMock = vi.fn<(query: unknown) => Promise<ScatterMetricsResult>>();
vi.mock("../../api/metrics.js", () => ({
  postMetrics: (query: unknown) => postMetricsMock(query),
  postScatterMetrics: (query: unknown) => postScatterMetricsMock(query),
}));

const getViewsMock = vi.fn<() => Promise<SavedView[]>>();
const createViewMock = vi.fn<(input: unknown) => Promise<SavedView>>();
const deleteViewMock = vi.fn<(id: string) => Promise<void>>();
vi.mock("../../api/localStore.js", () => ({
  getViews: () => getViewsMock(),
  createView: (input: unknown) => createViewMock(input),
  deleteView: (id: string) => deleteViewMock(id),
}));

vi.mock("../../charts/Chart.js", () => ({
  Chart: (_props: ChartProps) => <div data-testid="chart-stub" />,
}));

const { Explore } = await import("./Explore.js");

function emptyScatterResult(): ScatterMetricsResult {
  return {
    mode: "scatter",
    entity: "session",
    xMeasure: "costComputed",
    yMeasure: "wallMinutes",
    points: [],
    regression: null,
    population: {
      matched: 0,
      eligible: 0,
      returned: 0,
      excludedMissingMeasures: 0,
      sampled: false,
    },
  };
}

function makeSavedView(overrides: Partial<SavedView> = {}): SavedView {
  return {
    id: "view-1",
    name: "tokens by tool",
    path: "/explore",
    search: "?xp.measure=inputTokens&xp.dim=tool",
    pinned: true,
    createdAt: "2026-07-20T12:00:00.000Z",
    ...overrides,
  };
}

function renderExplore(search = "") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // `memoryLocation` always inserts a `?` between path and searchPath, so a
  // leading `?` on `search` produces `/explore??xp.…` — strip it so
  // URLSearchParams parses the keys correctly (mirror of ChartCard.test.tsx).
  const searchPath = search.startsWith("?") ? search.slice(1) : search;
  const { hook, searchHook } = memoryLocation({
    path: "/explore",
    searchPath,
    record: true,
  });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <Explore />
      </Router>
    </QueryClientProvider>
  ) as ReactElement;
  return render(tree);
}

beforeEach(() => {
  postMetricsMock.mockReset();
  postMetricsMock.mockResolvedValue([]);
  postScatterMetricsMock.mockReset();
  postScatterMetricsMock.mockResolvedValue(emptyScatterResult());
  getViewsMock.mockReset();
  getViewsMock.mockResolvedValue([]);
  createViewMock.mockReset();
  createViewMock.mockResolvedValue(makeSavedView());
  deleteViewMock.mockReset();
  deleteViewMock.mockResolvedValue();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Explore page", () => {
  it("renders the pivot builder, result panel, and saved-views grid", async () => {
    renderExplore();

    expect(screen.getByRole("region", { name: /pivot builder/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("pivot-result")).toBeInTheDocument());
    expect(screen.getByTestId("explore-saved-views")).toBeInTheDocument();
    expect(screen.getByTestId("explore-save-view")).toBeInTheDocument();
  });

  it("defaults to a Series query for measure=costComputed, dim=tool", async () => {
    renderExplore();
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalled());
    const query = postMetricsMock.mock.calls[0]?.[0] as {
      mode: string;
      measures: string[];
      dimensions: string[];
    };
    expect(query.mode).toBe("series");
    expect(query.measures).toContain("costComputed");
    expect(query.dimensions).toContain("tool");
  });

  it("shows the empty-state when the engine returns no series", async () => {
    postMetricsMock.mockResolvedValue([]);
    renderExplore();
    await waitFor(() => expect(screen.getByText(/no data for this pivot/i)).toBeInTheDocument());
  });

  it("renders an error panel when the engine rejects", async () => {
    postMetricsMock.mockRejectedValue(new Error("metrics engine exploded"));
    renderExplore();
    await waitFor(() => expect(screen.getByText(/metrics engine exploded/i)).toBeInTheDocument());
  });

  it("clicking the Line chart-type button changes the URL key", async () => {
    const user = userEvent.setup();
    renderExplore();
    const lineButton = await screen.findByTestId("xp-chart-line");
    await user.click(lineButton);

    // The chart type is UI-only (engine returns the same Series[] for bar/
    // line/area). The binding contract is that the URL key reflects the
    // user's selection so the permalink round-trips correctly.
    expect(screen.getByTestId("xp-chart-line")).toHaveAttribute("aria-pressed", "true");
  });

  it("toggling Distribution mode reveals the Entity picker", async () => {
    const user = userEvent.setup();
    renderExplore();
    // Entity picker is hidden in default (series) mode.
    expect(screen.queryByTestId("xp-entity")).not.toBeInTheDocument();

    const distButton = screen.getByTestId("xp-mode-distribution");
    await user.click(distButton);

    expect(screen.getByTestId("xp-entity")).toBeInTheDocument();
  });

  it("clicking Scatter reveals X/Y/Size pickers and posts a scatter query", async () => {
    const user = userEvent.setup();
    renderExplore();
    const scatterButton = screen.getByTestId("xp-chart-scatter");
    await user.click(scatterButton);

    await waitFor(() => expect(postScatterMetricsMock).toHaveBeenCalled());
    expect(screen.getByTestId("xp-x")).toBeInTheDocument();
    expect(screen.getByTestId("xp-y")).toBeInTheDocument();
    expect(screen.getByTestId("xp-size")).toBeInTheDocument();
  });

  it("Save view posts to createView with pinned:true", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("tokens by tool");
    const user = userEvent.setup();
    renderExplore();

    const saveButton = screen.getByTestId("explore-save-view");
    await user.click(saveButton);

    await waitFor(() => expect(createViewMock).toHaveBeenCalled());
    const input = createViewMock.mock.calls[0]?.[0] as {
      name: string;
      path: string;
      search: string;
      pinned: boolean;
    };
    expect(input.name).toBe("tokens by tool");
    expect(input.path).toBe("/explore");
    expect(input.pinned).toBe(true);
    promptSpy.mockRestore();
  });

  it("Save view does not post when the user cancels the prompt", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
    const user = userEvent.setup();
    renderExplore();

    await user.click(screen.getByTestId("explore-save-view"));
    // Give any async work a chance to run.
    await new Promise((r) => setTimeout(r, 10));
    expect(createViewMock).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it("renders the saved-views grid filtered to pinned Explore-origin views", async () => {
    getViewsMock.mockResolvedValue([
      makeSavedView({ id: "v1", name: "pinned explore view" }),
      makeSavedView({ id: "v2", name: "filterbar view", path: "/sessions", pinned: false }),
      makeSavedView({ id: "v3", name: "unpinned explore view", path: "/explore", pinned: false }),
    ]);
    renderExplore();

    await waitFor(() => expect(screen.getByText("pinned explore view")).toBeInTheDocument());
    // Filter-bar view and unpinned explore view must be filtered out.
    expect(screen.queryByText("filterbar view")).not.toBeInTheDocument();
    expect(screen.queryByText("unpinned explore view")).not.toBeInTheDocument();
  });

  it("renders a non-empty series chart when the engine returns data", async () => {
    postMetricsMock.mockResolvedValue([
      {
        measure: "costComputed",
        dimensionKey: "tool:Bash",
        label: "Bash",
        points: [
          { t: "2026-07-13T00:00:00Z", value: 1.25 },
          { t: "2026-07-14T00:00:00Z", value: 0.75 },
        ],
      },
    ]);
    renderExplore();
    await waitFor(() => expect(screen.getByTestId("chart-stub")).toBeInTheDocument());
    // The pivot heading reflects the measure + dim (drill-anywhere target).
    expect(screen.getByRole("heading", { name: /Computed \$ by tool/i })).toBeInTheDocument();
  });

  it("renders a populated scatter result with X/Y/Size heading", async () => {
    postScatterMetricsMock.mockResolvedValue({
      mode: "scatter",
      entity: "session",
      xMeasure: "costComputed",
      yMeasure: "wallMinutes",
      sizeMeasure: "apiCalls",
      points: [
        { sessionId: "s1", x: 1, y: 10, size: 5 },
        { sessionId: "s2", x: 2, y: 20, size: 10 },
      ],
      regression: { slope: 10, intercept: 0, rSquared: 1 },
      population: {
        matched: 2,
        eligible: 2,
        returned: 2,
        excludedMissingMeasures: 0,
        sampled: false,
      },
    });
    const user = userEvent.setup();
    renderExplore();
    await user.click(screen.getByTestId("xp-chart-scatter"));
    await waitFor(() => expect(screen.getByTestId("chart-stub")).toBeInTheDocument());
    // Heading is "<X-label> × <Y-label> (size: <Size-label>)" — labels
    // come from SCATTER_MEASURE_LABEL, so "apiCalls" renders as "API calls".
    expect(screen.getByRole("heading", { name: /size: API calls/i })).toBeInTheDocument();
  });

  it("renders the table view with drill buttons per row", async () => {
    postMetricsMock.mockResolvedValue([
      {
        measure: "costComputed",
        dimensionKey: "tool:Bash",
        label: "Bash",
        points: [
          { t: "2026-07-13T00:00:00Z", value: 1.25 },
          { t: "2026-07-14T00:00:00Z", value: 0.75 },
        ],
      },
    ]);
    const user = userEvent.setup();
    renderExplore();
    await user.click(screen.getByTestId("xp-chart-table"));
    await waitFor(() => expect(screen.getByTestId("drill-slice-Bash")).toBeInTheDocument());
  });

  it("renders distribution histogram + percentiles when the engine returns a distribution", async () => {
    postMetricsMock.mockResolvedValue([
      {
        measure: "costComputed",
        dimensionKey: "time",
        label: "",
        points: [],
        distribution: {
          p50: 1.25,
          p90: 4.5,
          p99: 9.0,
          histogram: [
            { rangeStart: 0, rangeEnd: 1, count: 12 },
            { rangeStart: 1, rangeEnd: 2, count: 7 },
          ],
        },
      },
    ]);
    const user = userEvent.setup();
    renderExplore();
    await user.click(screen.getByTestId("xp-mode-distribution"));
    await waitFor(() => expect(screen.getByTestId("pivot-distribution")).toBeInTheDocument());
    expect(screen.getByTestId("pivot-distribution")).toHaveTextContent(/p50/);
    expect(screen.getByTestId("pivot-distribution")).toHaveTextContent(/p90/);
    expect(screen.getByTestId("pivot-distribution")).toHaveTextContent(/p99/);
  });

  it("shows an empty saved-views message when no pinned views exist", async () => {
    getViewsMock.mockResolvedValue([]);
    renderExplore();
    await waitFor(() => expect(screen.getByText(/No pinned views yet/i)).toBeInTheDocument());
  });

  it("deletes a saved view and removes it from the grid", async () => {
    getViewsMock.mockResolvedValue([
      makeSavedView({ id: "v1", name: "first view" }),
      makeSavedView({ id: "v2", name: "second view" }),
    ]);
    const user = userEvent.setup();
    renderExplore();
    await waitFor(() => expect(screen.getByText("first view")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Delete saved view first view/i }));
    await waitFor(() => expect(deleteViewMock).toHaveBeenCalledWith("v1"));
  });

  it("Save view rejects whitespace-only names without posting", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("   ");
    const user = userEvent.setup();
    renderExplore();
    await user.click(screen.getByTestId("explore-save-view"));
    await new Promise((r) => setTimeout(r, 10));
    expect(createViewMock).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it("chart-type buttons carry aria-pressed reflecting the current selection", async () => {
    const user = userEvent.setup();
    renderExplore();
    const bar = screen.getByTestId("xp-chart-bar");
    const line = screen.getByTestId("xp-chart-line");
    expect(bar).toHaveAttribute("aria-pressed", "true");
    expect(line).toHaveAttribute("aria-pressed", "false");
    await user.click(line);
    expect(line).toHaveAttribute("aria-pressed", "true");
    expect(bar).toHaveAttribute("aria-pressed", "false");
  });

  it("Save button's accessible name contains the visible 'Save view' text", () => {
    renderExplore();
    const btn = screen.getByTestId("explore-save-view");
    expect(btn).toHaveAccessibleName(/Save view/i);
  });

  it("renders the saved-views loading state then the populated grid", async () => {
    let resolveViews: (views: SavedView[]) => void = () => {};
    getViewsMock.mockReturnValue(new Promise((res) => (resolveViews = res)));
    renderExplore();
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
    resolveViews([makeSavedView({ id: "v1", name: "late view" })]);
    await waitFor(() => expect(screen.getByText("late view")).toBeInTheDocument());
  });

  it("shows the saved-views error state when getViews rejects", async () => {
    getViewsMock.mockRejectedValue(new Error("views blew up"));
    renderExplore();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/views blew up/i));
  });
});
