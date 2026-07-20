// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GateReport } from "../../../../shared/gates-contract.js";
import { ReportCard } from "./ReportCard.js";

// Mock `useInView` so the test environment (JSDOM, no real
// IntersectionObserver fire) doesn't have to wait for an IO event to
// flip the lazy-mount gate. The PR review (#P4-12 finding #4) requires
// `inView` to start `false`; tests that want eager visibility mock it
// to `true` explicitly.
vi.mock("../../hooks/useInView.js", () => ({
  useInView: <T extends HTMLElement>(_opts: IntersectionObserverInit = {}, _fallback = false) => {
    void (null as T | null);
    return { ref: { current: null }, inView: true };
  },
}));

const mockedReport: GateReport = {
  sessionId: "s1",
  score: 0.85,
  scoreLetter: "B",
  evaluatedAt: "2026-07-20T12:00:00.000Z",
  thresholdsUsed: {
    v2Repeat: 3,
    c3MaxChars: 15000,
    k2Spike: 10000,
    e2MaxChars: 4000,
    e2MaxLines: 60,
  },
  gates: [
    { gateId: "V1", status: "pass", evidence: [] },
    { gateId: "V2", status: "pass", evidence: [] },
    { gateId: "P3", status: "pass", evidence: [] },
    { gateId: "C3", status: "pass", evidence: [] },
    { gateId: "K2", status: "pass", evidence: [] },
    { gateId: "E1", status: "warn", evidence: [] },
    { gateId: "E2", status: "pass", evidence: [] },
  ],
};

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

afterEach(cleanup);

describe("ReportCard", () => {
  beforeEach(() => {
    // Fresh module state for every test — `getGateReport` is replaced
    // per-test to drive each render branch.
  });

  it("renders the lazy-mount placeholder when the section is out of view", async () => {
    // Override the default `inView: true` mock so the placeholder branch
    // is exercised. The placeholder is what defers the E1/E2 fs check
    // (#P4-12 review finding #4).
    const useInView = await import("../../hooks/useInView.js");
    vi.spyOn(useInView, "useInView").mockReturnValueOnce({
      ref: { current: null },
      inView: false,
    });
    render(<ReportCard sessionId="s1" />, { wrapper: makeWrapper() });
    expect(screen.getByTestId("report-card-placeholder")).toBeInTheDocument();
    expect(screen.queryByText(/Loading Report Card/i)).toBeNull();
    expect(screen.queryByTestId("report-card")).toBeNull();
  });

  it("renders the loading state when the fetch is pending", async () => {
    const gates = await import("../../api/gates.js");
    vi.spyOn(gates, "getGateReport").mockReturnValueOnce(new Promise(() => {}) as never);
    render(<ReportCard sessionId="s1" />, { wrapper: makeWrapper() });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/Loading Report Card/i);
  });

  it("renders the error EmptyState with a retry affordance when the fetch fails", async () => {
    const gates = await import("../../api/gates.js");
    vi.spyOn(gates, "getGateReport").mockRejectedValueOnce(new Error("boom"));
    render(<ReportCard sessionId="s1" />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText(/Couldn't load Report Card/i)).toBeInTheDocument();
    });
    const retry = screen.getByRole("button", { name: /retry/i });
    expect(retry).toBeInTheDocument();
  });

  it("renders the ReportCardView on success", async () => {
    const gates = await import("../../api/gates.js");
    vi.spyOn(gates, "getGateReport").mockResolvedValueOnce(mockedReport);
    render(<ReportCard sessionId="s1" />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId("report-card")).toBeInTheDocument();
    });
    // The view-level assertions are covered in ReportCardView.test.tsx;
    // here we just confirm the wrapper delegates to the view on success.
    expect(screen.getByText(/0.85 \/ 6 checks/)).toBeInTheDocument();
  });
});
