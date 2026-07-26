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

const chartSpy = vi.fn();
vi.mock("../../charts/Chart.js", () => ({
  Chart: (props: ChartProps) => {
    chartSpy(props);
    return (
      // biome-ignore lint/a11y/useButtonType: test double
      <button
        data-testid="chart-stub"
        onClick={() => props.onPointClick?.({ value: ["2026-07-10", 5] } as never)}
      >
        chart
      </button>
    );
  },
}));

const postMetricsMock = vi.fn<(query: unknown) => Promise<Series[]>>();
vi.mock("../../api/metrics.js", () => ({
  postMetrics: (query: unknown) => postMetricsMock(query),
}));

const { CalendarHeatmapPanel } = await import("./CalendarHeatmapPanel.js");

const NOW = new Date("2026-07-16T14:00:00.000Z");

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/trends", static: true });
  const navigatedTo: string[] = [];
  const captureNav: typeof hook = () => {
    const [loc, navigate] = hook();
    return [
      loc,
      (to: string, opts) => {
        navigatedTo.push(to);
        navigate(to, opts);
      },
    ];
  };
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Router hook={captureNav} searchHook={searchHook}>
        <CalendarHeatmapPanel now={NOW} />
      </Router>
    </QueryClientProvider>,
  );
  return { ...utils, getNavigations: () => navigatedTo };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CalendarHeatmapPanel", () => {
  it("shows a loading state, then renders the chart once data resolves", async () => {
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

  it("defaults to the $ unit and switches to tokens on toggle", async () => {
    postMetricsMock.mockResolvedValue([]);
    renderPanel();
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalled());
    expect(postMetricsMock.mock.calls[0][0]).toMatchObject({ measures: ["costComputed"] });

    await userEvent.click(screen.getByRole("button", { name: "tokens" }));
    await waitFor(() =>
      expect(postMetricsMock.mock.calls.at(-1)?.[0]).toMatchObject({
        measures: ["inputTokens", "outputTokens", "cacheCreateTokens", "cacheReadTokens"],
      }),
    );
  });

  it("navigates to a filtered Sessions view on cell click", async () => {
    postMetricsMock.mockResolvedValue([]);
    const { getNavigations } = renderPanel();
    await waitFor(() => expect(screen.getByTestId("chart-stub")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("chart-stub"));
    await waitFor(() =>
      expect(getNavigations().some((to) => to.startsWith("/sessions"))).toBe(true),
    );
  });
});
