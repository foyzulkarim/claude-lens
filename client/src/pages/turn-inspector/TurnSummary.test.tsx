// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type {
  TurnInspectorNav,
  TurnInspectorSummary,
} from "../../../../shared/turn-inspector-contract.js";
import { TurnSummary } from "./TurnSummary.js";

function renderSummary(summary: TurnInspectorSummary, nav: TurnInspectorNav) {
  const { hook, searchHook } = memoryLocation({ path: "/session/s1/turn/1", static: true });
  return render(
    <Router hook={hook} searchHook={searchHook}>
      <TurnSummary summary={summary} nav={nav} />
    </Router>,
  );
}

afterEach(() => {
  cleanup();
});

describe("TurnSummary", () => {
  const baseSummary: TurnInspectorSummary = {
    sessionId: "s1",
    turnNumber: 1,
    totalTurns: 5,
    promptId: "p1",
    promptText: "hi",
    startedAt: "2026-07-14T10:00:00.000Z",
    endedAt: "2026-07-14T10:00:30.000Z",
    cost: 0.12,
    tokens: 1000,
    callCount: 2,
    models: ["claude-sonnet-5"],
    primaryModel: "claude-sonnet-5",
    fleetPercentile: 50,
    isAnomaly: false,
  };
  const baseNav: TurnInspectorNav = { prevTurnNumber: null, nextTurnNumber: 2, totalTurns: 5 };

  it("renders cost, tokens, percentile, call count, and model badge", () => {
    renderSummary(baseSummary, baseNav);

    expect(screen.getByText("$0.12")).toBeInTheDocument();
    expect(screen.getByText("1.0k tokens")).toBeInTheDocument();
    expect(screen.getByText("p50 of your turns")).toBeInTheDocument();
    expect(screen.getByText("2 API calls")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-5")).toBeInTheDocument();
  });

  it("renders wallMs as a duration (e.g. '12s'), NOT as a token quantity (e.g. '12.0k')", () => {
    // Regression guard for #P4 of the review: formatTokens(12000) would
    // produce "12.0k", then concatenated with "ms" → "wall 12.0kms". The
    // duration formatter keeps the wall-clock reading.
    renderSummary({ ...baseSummary, wallMs: 12_000 }, baseNav);

    const wall = screen.getByText(/^wall /);
    expect(wall.textContent).toBe("wall 12s");
    expect(wall.textContent).not.toContain("k");
  });

  it("renders large wallMs with minutes + seconds", () => {
    renderSummary({ ...baseSummary, wallMs: 4 * 60_000 + 5_000 }, baseNav);

    const wall = screen.getByText(/^wall /);
    expect(wall.textContent).toBe("wall 4m 5s");
  });

  it("renders sub-second wallMs with the millisecond unit", () => {
    renderSummary({ ...baseSummary, wallMs: 750 }, baseNav);

    const wall = screen.getByText(/^wall /);
    expect(wall.textContent).toBe("wall 750ms");
  });

  it("omits the wall line and shows the 'needs cost capture' fallback when wallMs is undefined", () => {
    renderSummary(baseSummary, baseNav);

    // The fallback text only appears when wallMs is absent.
    expect(screen.queryByText(/^wall /)).not.toBeInTheDocument();
    expect(screen.getByText(/needs cost capture/)).toBeInTheDocument();
  });

  it("hides the percentile badge when fleetPercentile is null", () => {
    renderSummary({ ...baseSummary, fleetPercentile: null }, baseNav);

    expect(screen.queryByText(/of your turns/)).not.toBeInTheDocument();
  });
});
