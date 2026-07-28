// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AppConfig } from "../../../../shared/settings-contract.js";

const getConfigMock = vi.fn<(signal?: AbortSignal) => Promise<AppConfig>>();
const putConfigMock = vi.fn<(patch: Partial<AppConfig>) => Promise<AppConfig>>();
vi.mock("../../api/config.js", () => ({
  getConfig: (signal?: AbortSignal) => getConfigMock(signal),
  putConfig: (patch: Partial<AppConfig>) => putConfigMock(patch),
}));

const { ThresholdsPanel } = await import("./ThresholdsPanel.js");

const FULL_CONFIG: AppConfig = {
  budget: 300,
  anomalyFactor: 5,
  gateThresholds: {
    v2Repeat: 4,
    c3MaxChars: 20_000,
    k2Spike: 12_000,
    e2MaxChars: 5_000,
    e2MaxLines: 80,
  },
  scorecardThresholds: {
    floorCalls: 12,
    calibrationMinSessions: 25,
    A: 96,
    B: 88,
    C: 72,
    D: 55,
  },
};

function renderPanel(): ReturnType<typeof render> & { queryClient: QueryClient } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/settings", static: true });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <ThresholdsPanel />
      </Router>
    </QueryClientProvider>
  ) as ReactElement;
  return Object.assign(render(tree), { queryClient });
}

function bandInput(letter: "A" | "B" | "C" | "D"): HTMLInputElement {
  return screen.getByLabelText(`Scorecard band ${letter} (%, min)`) as HTMLInputElement;
}

beforeEach(() => {
  getConfigMock.mockReset();
  putConfigMock.mockReset();
  getConfigMock.mockResolvedValue(structuredClone(FULL_CONFIG));
  putConfigMock.mockImplementation(async (patch) => ({ ...FULL_CONFIG, ...patch }) as AppConfig);
});

afterEach(() => {
  cleanup();
});

describe("ThresholdsPanel (#124 review finding #9)", () => {
  it("renders both threshold groups with the seeded values", async () => {
    renderPanel();
    await screen.findByTestId("scorecard-thresholds-heading");
    expect(bandInput("A")).toHaveValue(96);
    expect(bandInput("D")).toHaveValue(55);
  });

  it("names the thresholds table for screen-reader table navigation (#124 review finding #22)", async () => {
    renderPanel();
    await screen.findByTestId("scorecard-thresholds-heading");
    expect(
      screen.getByRole("table", { name: "Budget, gate, and cache scorecard thresholds" }),
    ).toBeInTheDocument();
  });

  it("blocks Save and shows an alert when the scorecard bands are out of order, without calling putConfig", async () => {
    renderPanel();
    await screen.findByTestId("scorecard-thresholds-heading");

    fireEvent.change(bandInput("D"), { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/A > B > C > D/i);
    });
    expect(putConfigMock).not.toHaveBeenCalled();
  });

  it("saves a valid edit and invalidates both the config and scorecard query prefixes", async () => {
    const { queryClient } = renderPanel();
    await screen.findByTestId("scorecard-thresholds-heading");
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.change(bandInput("A"), { target: { value: "97" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(putConfigMock).toHaveBeenCalledTimes(1));
    expect(putConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scorecardThresholds: expect.objectContaining({ A: 97, B: 88, C: 72, D: 55 }),
      }),
    );
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["config"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["scorecard"] });
    });
  });

  it("clamps a band value typed above 100 down to 100 before it could ever be saved", async () => {
    renderPanel();
    await screen.findByTestId("scorecard-thresholds-heading");

    fireEvent.change(bandInput("A"), { target: { value: "150" } });

    expect(bandInput("A")).toHaveValue(100);
  });

  it("clamps a band value typed below 0 up to 0", async () => {
    renderPanel();
    await screen.findByTestId("scorecard-thresholds-heading");

    fireEvent.change(bandInput("D"), { target: { value: "-5" } });

    expect(bandInput("D")).toHaveValue(0);
  });
});
