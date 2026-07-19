// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TurnInspectorWaterfallCall } from "../../../../shared/turn-inspector-contract.js";
import { Waterfall } from "./Waterfall.js";

function makeCalls(): TurnInspectorWaterfallCall[] {
  return [
    {
      callIndex: 0,
      messageId: "m1",
      timestamp: "2026-07-14T10:00:00.000Z",
      offsetMs: 0,
      tokens: 100,
      cost: 0.001,
      tools: [],
      isSidechain: false,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    },
    {
      callIndex: 1,
      messageId: "m2",
      timestamp: "2026-07-14T10:00:30.000Z",
      offsetMs: 30_000,
      tokens: 1000,
      cost: 0.01,
      tools: [{ name: "Read", inputBytes: 100 }],
      isSidechain: false,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    },
  ];
}

afterEach(() => {
  cleanup();
});

describe("Waterfall — toggle accessibility", () => {
  it("renders both toggle buttons inside a labelled group", () => {
    render(<Waterfall calls={makeCalls()} />);

    const group = screen.getByRole("group", { name: "Waterfall metric" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "by time" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "by tokens" })).toBeInTheDocument();
  });

  it("marks the default 'by time' toggle as pressed and 'by tokens' as not pressed", () => {
    render(<Waterfall calls={makeCalls()} />);

    expect(screen.getByRole("button", { name: "by time" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "by tokens" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("swaps aria-pressed when the user clicks 'by tokens'", () => {
    render(<Waterfall calls={makeCalls()} />);

    // fireEvent dispatches a synthetic React event; native .click() bypasses
    // the React event system and never triggers the onClick handler.
    fireEvent.click(screen.getByRole("button", { name: "by tokens" }));

    expect(screen.getByRole("button", { name: "by time" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "by tokens" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("Waterfall — empty state", () => {
  it("renders a 'No calls in this turn.' message when calls is empty", () => {
    render(<Waterfall calls={[]} />);

    expect(screen.getByText("No calls in this turn.")).toBeInTheDocument();
    // Toggle group is hidden in the empty state.
    expect(screen.queryByRole("group", { name: "Waterfall metric" })).not.toBeInTheDocument();
  });
});

describe("Waterfall — call rendering", () => {
  it("labels each call with its callIndex + primary tool + tokens", () => {
    render(<Waterfall calls={makeCalls()} />);

    // Default mode = "by time", so the right-hand value is a duration.
    expect(screen.getByLabelText(/Call c1 — .*, .* tokens/)).toBeInTheDocument();
    // Single-tool calls render without the ×N suffix; multi-tool calls
    // would append "×<count>".
    expect(screen.getByLabelText(/Call c2 — Read, .* tokens/)).toBeInTheDocument();
    // By time mode shows the offset duration for c2 (30s).
    expect(screen.getByText("30s")).toBeInTheDocument();
  });
});
