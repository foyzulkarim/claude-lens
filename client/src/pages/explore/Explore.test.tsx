// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ScatterMetricsResult, Series } from "../../../../shared/metrics-contract.js";
import type { SavedView } from "../../../../shared/local-store-contract.js";
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

    await waitFor(() => expect(postMetricsMock.mock.calls.length).toBeGreaterThan(1));
    const lastCall = postMetricsMock.mock.calls.at(-1)?.[0] as { mode: string };
    expect(lastCall.mode).toBe("series");
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
});
