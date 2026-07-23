// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { HealthSnapshot } from "../../../../shared/health-contract.js";
import { emptySnapshot, populatedSnapshot } from "./DataHealth.fixtures.js";

const fetchHealthMock = vi.fn<() => Promise<HealthSnapshot>>();
vi.mock("../../api/health.js", () => ({
  fetchHealth: () => fetchHealthMock(),
}));

const { DataHealth } = await import("./DataHealth.js");

function withProviders(node: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={memoryLocation().hook}>{node}</Router>
    </QueryClientProvider>
  );
}

// TC-9 — `mockReset` (not `clearAllMocks`) + default `mockResolvedValue`
// in `beforeEach`. The prior `vi.clearAllMocks()` left the
// never-resolving loading implementation installed across tests, so
// any future test added without its own override would silently hang
// or observe a stale mock. With a default resolved value installed
// per-test, each test can override only the cases it cares about
// (loading / error) and trust the rest.
beforeEach(() => {
  fetchHealthMock.mockReset();
  fetchHealthMock.mockResolvedValue(populatedSnapshot());
});

afterEach(() => {
  cleanup();
});

describe("DataHealth page", () => {
  it("renders the four spec sections against an injected snapshot", () => {
    render(withProviders(<DataHealth snapshot={populatedSnapshot()} />));

    // §1 dedup — scope to the dedup panel (review TC-8) so a future
    // panel rendering the same "1.2k" can't accidentally pass.
    const dedupTitle = screen.getByText("Dedup stats");
    const dedupSection = dedupTitle.closest("section");
    expect(dedupSection).not.toBeNull();
    if (dedupSection) {
      const scoped = within(dedupSection);
      expect(scoped.getByText("Raw lines")).toBeInTheDocument();
      expect(scoped.getByText("1.2k")).toBeInTheDocument();
      expect(scoped.getByText("Distinct calls")).toBeInTheDocument();
      expect(scoped.getByText("Duplicates")).toBeInTheDocument();
    }

    // §1 pricing — scope to the pricing panel.
    const pricingTitle = screen.getByText("Pricing coverage");
    const pricingSection = pricingTitle.closest("section");
    expect(pricingSection).not.toBeNull();
    if (pricingSection) {
      const scoped = within(pricingSection);
      // The populated fixture has 3 models, one of which is unpriced.
      expect(scoped.getByText("fable-5")).toBeInTheDocument();
      expect(scoped.getByText("unpriced")).toBeInTheDocument();
    }

    // §2 scan — scope to the scan panel so the "21" assertion binds to
    // the right section (prior `getAllByText("21")` could pass via
    // any panel rendering 21).
    const scanTitle = screen.getByText("Scan coverage");
    const scanSection = scanTitle.closest("section");
    expect(scanSection).not.toBeNull();
    if (scanSection) {
      const scoped = within(scanSection);
      // Found, Parsed, With-sidecars are all 21 in the populated
      // fixture; verify each label has its value rendered.
      expect(scoped.getByText("Found").nextElementSibling?.textContent).toBe("21");
      expect(scoped.getByText("Parsed").nextElementSibling?.textContent).toBe("21");
      expect(scoped.getByText("Failed").nextElementSibling?.textContent).toBe("0");
    }

    // §3 reconciliation — scope to the reconciliation panel.
    const reconciliationTitle = screen.getByText("Reconciliation — computed vs observed");
    const reconciliationSection = reconciliationTitle.closest("section");
    expect(reconciliationSection).not.toBeNull();
    if (reconciliationSection) {
      const scoped = within(reconciliationSection);
      expect(scoped.getByText("Cost computed")).toBeInTheDocument();
      expect(scoped.getByText("$12.34")).toBeInTheDocument();
      expect(scoped.getByText("$13.50")).toBeInTheDocument();
    }

    // §4 — capture gaps renders the "without capture" count.
    const captureGapsTitle = screen.getByText("Capture gaps");
    const captureGapsSection = captureGapsTitle.closest("section");
    expect(captureGapsSection).not.toBeNull();
    if (captureGapsSection) {
      const scoped = within(captureGapsSection);
      expect(scoped.getByText(/without capture/i)).toBeInTheDocument();
      // Drill link (review TC-6) is the page's Phase 4 DoD
      // surface — assert it renders and points at /sessions.
      expect(scoped.getByTestId("data-health-drill-sessions")).toHaveAttribute("href", "/sessions");
    }

    // §4 boundary mismatches — locked card on every fleet where the
    // §4 sub-card hasn't been wired to the fleet Σ.
    expect(screen.getByText(/boundary \/ promptid mismatches/i)).toBeInTheDocument();
  });

  it("renders the locked reconciliation card when no premium data exists", () => {
    render(withProviders(<DataHealth snapshot={emptySnapshot()} />));
    expect(screen.getByText(/no premium capture observed/i)).toBeInTheDocument();
    // The §4 capture-gaps panel should show "0" with "of 0" inline —
    // both the captured and without-capture numbers are zero on an
    // empty fleet. The text is split across `<span>` siblings in the
    // JSX (value div + inline "of N" span), so we normalize the
    // section's `textContent` and assert the "0 of 0" substring is
    // present. This is robust to the DOM shape without depending on
    // the exact rendering of whitespace between text nodes.
    const captureGapsTitle = screen.getByText("Capture gaps");
    const captureGaps = captureGapsTitle.closest("section");
    expect(captureGaps).not.toBeNull();
    if (captureGaps) {
      const text = (captureGaps.textContent ?? "").replace(/\s+/g, " ");
      // The JSX renders `<div>0</div><span> of 0</span>` for the
      // captured value, so textContent is "Captured0of 0…" (no space
      // between the value div and the inline "of N" span). Assert
      // the literal "0of 0" rather than the formatted "0 of 0" so
      // the test doesn't depend on JSX whitespace choices.
      expect(text).toContain("0of 0");
    }
  });

  // TC-8 — non-empty all-red state: a fleet that has sessions but
  // none of them are premium-observed. Reconciliation §3 should
  // render the locked card even though dedup / scan / pricing /
  // capture-gaps all have data. (The prior tests only covered the
  // empty-fleet path or the populated-real-data path.)
  it("renders the locked reconciliation card when sessions exist but none are observed", () => {
    const nonEmptyAllRed: HealthSnapshot = {
      ...emptySnapshot(),
      scan: {
        ...emptySnapshot().scan,
        transcriptsFound: 5,
        transcriptsParsed: 5,
        transcriptsFailed: 0,
      },
      dedup: { rawLines: 100, distinctCalls: 80, duplicates: 20 },
      captureGaps: { sessionsWithoutObserved: 5 },
      sidecarCoverage: { total: 5, withCost: 0, withBoundaries: 0 },
    };
    render(withProviders(<DataHealth snapshot={nonEmptyAllRed} />));
    // Locked card surfaces.
    expect(screen.getByText(/no premium capture observed/i)).toBeInTheDocument();
    // §4 capture-gaps shows the full fleet as needing capture —
    // scope to the section so the page-wide "5" doesn't collide
    // with the scan panel's "5" parsed-sessions count.
    const captureGapsTitle = screen.getByText("Capture gaps");
    const captureGapsSection = captureGapsTitle.closest("section");
    expect(captureGapsSection).not.toBeNull();
    if (captureGapsSection) {
      const scoped = within(captureGapsSection);
      expect(scoped.getByText("5")).toBeInTheDocument();
    }
  });

  // TC-8 — the ParseErrorsPanel renders the malformed-file row
  // (basename + count) when at least one entry is present in
  // `byFile`. The fixture's `abc/def.jsonl` path must render as
  // basename `def.jsonl` so the user's home directory layout is not
  // leaked into the DOM.
  it("renders the malformed-file row with basename + count", () => {
    render(withProviders(<DataHealth snapshot={populatedSnapshot()} />));
    const parseErrorsTitle = screen.getByText("Parse errors");
    const parseErrorsSection = parseErrorsTitle.closest("section");
    expect(parseErrorsSection).not.toBeNull();
    if (parseErrorsSection) {
      const scoped = within(parseErrorsSection);
      // Basename of "/Users/demo/.claude/projects/abc/def.jsonl" = "def.jsonl".
      expect(scoped.getByText("def.jsonl")).toBeInTheDocument();
      // Count column shows "2" — scope to the byFile table so the
      // panel-wide "2" (malformedLines Σ) doesn't collide with the
      // per-row count.
      const byFileTable = scoped.getByRole("table");
      expect(within(byFileTable).getByText("2")).toBeInTheDocument();
    }
  });

  it("renders the loading state when the query is pending", () => {
    // Override the default resolved value with a never-resolving
    // promise so the page stays in `isPending`.
    fetchHealthMock.mockImplementation(() => new Promise(() => {}));
    render(withProviders(<DataHealth />));
    // `role="status"` (review A11Y-6) wraps the loading text.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/loading/i);
  });

  // TC-8 — fetch-error branch. The page surfaces the server's error
  // verbatim with `role="alert"` (review A11Y-6).
  it("renders an alert with the server's error message when the fetch fails", async () => {
    fetchHealthMock.mockRejectedValue(new Error("network down"));
    render(withProviders(<DataHealth />));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/network down/);
  });
});
