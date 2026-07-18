// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ScatterMetricsResult } from "../../../../shared/metrics-contract.js";
import type { ChartProps } from "../../charts/Chart.js";
import { DEFAULT_SESSIONS_PAGE_STATE } from "./state.js";

const chartSpy = vi.fn();
vi.mock("../../charts/Chart.js", () => ({
  Chart: (props: ChartProps) => {
    chartSpy(props);
    return <div data-testid="chart-stub" />;
  },
}));

const postScatterMetricsMock = vi.fn<(query: unknown) => Promise<ScatterMetricsResult>>();
vi.mock("../../api/metrics.js", () => ({
  postScatterMetrics: (query: unknown) => postScatterMetricsMock(query),
}));

const { EfficiencyScatterCard } = await import("./EfficiencyScatterCard.js");

function scatterResult(overrides: Partial<ScatterMetricsResult> = {}): ScatterMetricsResult {
  return {
    mode: "scatter",
    entity: "session",
    xMeasure: "costComputed",
    yMeasure: "wallMinutes",
    points: [
      { sessionId: "s1", x: 1, y: 2 },
      { sessionId: "s2", x: 3, y: 4 },
    ],
    regression: { slope: 1, intercept: 0.5, rSquared: 0.9 },
    population: {
      matched: 2,
      eligible: 2,
      returned: 2,
      excludedMissingMeasures: 0,
      sampled: false,
    },
    ...overrides,
  };
}

function renderCard(state = DEFAULT_SESSIONS_PAGE_STATE, onStateChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/sessions", static: true });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <EfficiencyScatterCard
          state={state}
          onStateChange={onStateChange}
          now={new Date("2026-07-15T00:00:00Z")}
        />
      </Router>
    </QueryClientProvider>
  ) as ReactElement;
  return { ...render(tree), onStateChange };
}

beforeEach(() => {
  postScatterMetricsMock.mockReset();
  postScatterMetricsMock.mockResolvedValue(scatterResult());
  chartSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("EfficiencyScatterCard — presets and interaction", () => {
  it("renders the default cost-vs-duration preset active", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByTestId("chart-stub")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /\$ × duration/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("clicking a preset button calls onStateChange with the preset id", async () => {
    const user = userEvent.setup();
    const { onStateChange } = renderCard();
    await waitFor(() => expect(screen.getByTestId("chart-stub")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /tokens × turns/i }));
    expect(onStateChange).toHaveBeenCalledWith({ scatterPreset: "tokens-vs-turns" });
  });

  it("shows population disclosure text (eligible/matched/regression)", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByText(/2 eligible of 2 matched/i)).toBeInTheDocument());
    expect(screen.getByText(/R² 0.900/i)).toBeInTheDocument();
    expect(screen.getByText(/slope 1.000/i)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /scatter points/i })).toBeInTheDocument();
  });

  it("discloses sampling when the population was capped", async () => {
    postScatterMetricsMock.mockResolvedValue(
      scatterResult({
        population: {
          matched: 5000,
          eligible: 4800,
          returned: 500,
          excludedMissingMeasures: 200,
          sampled: true,
        },
      }),
    );
    renderCard();
    await waitFor(() =>
      expect(screen.getByText(/sampled to 500 visual points/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/200 excluded for missing measures/i)).toBeInTheDocument();
  });

  it("renders an honest empty result without a chart when no points are eligible", async () => {
    postScatterMetricsMock.mockResolvedValue(
      scatterResult({
        points: [],
        regression: null,
        population: {
          matched: 3,
          eligible: 0,
          returned: 0,
          excludedMissingMeasures: 3,
          sampled: false,
        },
      }),
    );
    renderCard();
    await waitFor(() => expect(screen.getByText(/0 eligible of 3 matched/i)).toBeInTheDocument());
  });

  it("renders the error boundary independently of other sections", async () => {
    postScatterMetricsMock.mockRejectedValue(new Error("scatter endpoint unreachable"));
    renderCard();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/unreachable/i));
  });

  it("degenerate regression (null) renders without a regression callout", async () => {
    postScatterMetricsMock.mockResolvedValue(scatterResult({ regression: null }));
    renderCard();
    await waitFor(() => expect(screen.getByTestId("chart-stub")).toBeInTheDocument());
    expect(screen.queryByText(/R²/)).not.toBeInTheDocument();
  });
});
