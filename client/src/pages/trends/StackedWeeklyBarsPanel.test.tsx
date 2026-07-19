// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import type { ChartProps } from "../../charts/Chart.js";

vi.mock("../../charts/Chart.js", () => ({
  Chart: (_props: ChartProps) => <div data-testid="chart-stub" />,
}));

const postMetricsMock = vi.fn<(query: unknown) => Promise<Series[]>>();
vi.mock("../../api/metrics.js", () => ({
  postMetrics: (query: unknown) => postMetricsMock(query),
}));

const { StackedWeeklyBarsPanel } = await import("./StackedWeeklyBarsPanel.js");

const NOW = new Date("2026-07-16T14:00:00.000Z");

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/trends", static: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <StackedWeeklyBarsPanel now={NOW} />
      </Router>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StackedWeeklyBarsPanel", () => {
  it("defaults to a project breakdown at week grain", async () => {
    postMetricsMock.mockResolvedValue([]);
    renderPanel();
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalled());
    expect(postMetricsMock.mock.calls[0][0]).toMatchObject({
      dimensions: ["time", "project"],
      grain: "week",
    });
  });

  it("switches to a model breakdown on toggle", async () => {
    postMetricsMock.mockResolvedValue([]);
    renderPanel();
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "model" }));
    await waitFor(() =>
      expect(postMetricsMock.mock.calls.at(-1)?.[0]).toMatchObject({
        dimensions: ["time", "model"],
      }),
    );
  });

  it("shows a loading state, then renders the chart", async () => {
    postMetricsMock.mockResolvedValue([]);
    renderPanel();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    await waitFor(() => expect(screen.getByTestId("chart-stub")).toBeInTheDocument());
  });

  it("surfaces a fetch error", async () => {
    postMetricsMock.mockRejectedValue(new Error("boom"));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"));
  });
});
