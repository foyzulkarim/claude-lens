// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GateReport } from "../../../../shared/gates-contract.js";
import { ReportCardView } from "./ReportCardView.js";

afterEach(cleanup);

function buildReport(overrides: Partial<GateReport> = {}): GateReport {
  return {
    sessionId: "s1",
    score: 0.5,
    scoreLetter: "C",
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
      {
        gateId: "C3",
        status: "warn",
        evidence: [
          {
            detail: "Tool result was 18,243 chars (over 15,000 cap)",
            turnN: 4,
            callId: "call-7",
          },
        ],
      },
      { gateId: "K2", status: "pass", evidence: [] },
      {
        gateId: "E1",
        status: "fail",
        evidence: [
          {
            detail: "Project CLAUDE.md missing.",
            filePath: "/Users/demo/proj/CLAUDE.md",
          },
        ],
      },
      { gateId: "E2", status: "pass", evidence: [] },
    ],
    ...overrides,
  };
}

describe("ReportCardView", () => {
  it("renders the seven gates in the gates.md prose order", () => {
    render(<ReportCardView data={buildReport()} />);
    const list = screen.getByRole("list", { name: "Gate results" });
    const rows = within(list).getAllByTestId(/^gate-row-/);
    expect(rows.map((r) => r.getAttribute("data-gate-id"))).toEqual([
      "V1",
      "V2",
      "P3",
      "C3",
      "K2",
      "E1",
      "E2",
    ]);
  });

  it("deep-links turn-keyed evidence to Turn Inspector", () => {
    render(<ReportCardView data={buildReport()} />);
    const c3Row = screen.getByTestId("gate-row-C3");
    const link = within(c3Row).getByRole("link", { name: /Open turn 4/ });
    expect(link.getAttribute("href")).toBe("/session/s1/turn/4");
  });

  it("renders session-scoped evidence (E1/E2) inline with the filePath", () => {
    render(<ReportCardView data={buildReport()} />);
    const e1Row = screen.getByTestId("gate-row-E1");
    within(e1Row).getByText("Project CLAUDE.md missing.");
    within(e1Row).getByText("/Users/demo/proj/CLAUDE.md");
    // No "View turn" link should exist for E1.
    expect(within(e1Row).queryByRole("link")).toBeNull();
  });

  it("renders the score letter and score fraction in the header", () => {
    render(<ReportCardView data={buildReport({ score: 0.95, scoreLetter: "A" })} />);
    const card = screen.getByTestId("report-card");
    within(card).getByText("A");
    within(card).getByText("0.95 / 6 checks");
  });
});
