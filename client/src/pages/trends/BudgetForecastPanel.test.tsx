// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AppConfig } from "../../../../shared/settings-contract.js";
import type { Series } from "../../../../shared/metrics-contract.js";
import type { ChartProps } from "../../charts/Chart.js";

vi.mock("../../charts/Chart.js", () => ({
  Chart: (_props: ChartProps) => <div data-testid="chart-stub" />,
}));

const getConfigMock = vi.fn<() => Promise<AppConfig>>();
const putConfigMock = vi.fn<(patch: Partial<AppConfig>) => Promise<AppConfig>>();
vi.mock("../../api/config.js", () => ({
  getConfig: () => getConfigMock(),
  putConfig: (patch: Partial<AppConfig>) => putConfigMock(patch),
}));

const postMetricsMock = vi.fn<(query: unknown) => Promise<Series[]>>();
vi.mock("../../api/metrics.js", () => ({
  postMetrics: (query: unknown) => postMetricsMock(query),
}));

const { BudgetForecastPanel } = await import("./BudgetForecastPanel.js");

const NOW = new Date("2026-07-16T14:00:00.000Z");

function dailyPoints(values: number[]): Series[] {
  const points: Series["points"] = values.map((value, i) => ({
    t: `2026-07-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    value,
  }));
  return [{ measure: "costComputed", dimensionKey: "", label: "Cost", points }];
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/trends", static: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <BudgetForecastPanel now={NOW} />
      </Router>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BudgetForecastPanel", () => {
  it("shows 'no budget set' when config has no budget", async () => {
    getConfigMock.mockResolvedValue({ budget: null });
    postMetricsMock.mockResolvedValue(dailyPoints(Array(10).fill(10)));
    renderPanel();
    await waitFor(() => expect(screen.getByText(/No budget set/)).toBeInTheDocument());
  });

  it("renders the progress bar with the configured budget", async () => {
    getConfigMock.mockResolvedValue({ budget: 300 });
    postMetricsMock.mockResolvedValue(dailyPoints(Array(10).fill(10)));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("progressbar")).toBeInTheDocument());
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "300");
  });

  it("shows over-budget styling text when MTD exceeds the budget", async () => {
    getConfigMock.mockResolvedValue({ budget: 50 });
    postMetricsMock.mockResolvedValue(dailyPoints(Array(10).fill(10)));
    renderPanel();
    await waitFor(() => expect(screen.getByText(/— over budget/)).toBeInTheDocument());
  });

  it("saves a new budget via the input + Save button", async () => {
    getConfigMock.mockResolvedValue({ budget: null });
    putConfigMock.mockResolvedValue({ budget: 500 });
    postMetricsMock.mockResolvedValue(dailyPoints(Array(10).fill(10)));
    renderPanel();
    await waitFor(() => expect(screen.getByText(/No budget set/)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Monthly budget cap"), "500");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(putConfigMock).toHaveBeenCalledWith({ budget: 500 }));
  });

  it("shows the not-enough-data notice with fewer than 3 days of MTD data", async () => {
    getConfigMock.mockResolvedValue({ budget: null });
    postMetricsMock.mockResolvedValue(dailyPoints([10, 10]));
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Not enough data yet/)).toBeInTheDocument());
  });

  it("surfaces a fetch error", async () => {
    getConfigMock.mockRejectedValue(new Error("config boom"));
    postMetricsMock.mockResolvedValue(dailyPoints(Array(10).fill(10)));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("config boom"));
  });
});
