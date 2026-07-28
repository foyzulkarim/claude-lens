// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GateStatusBadge } from "./GateStatusBadge.js";

afterEach(cleanup);

describe("GateStatusBadge", () => {
  it("announces the generic Score/Gate status text when no custom label is given", () => {
    render(<GateStatusBadge letter="B" />);
    expect(screen.getByRole("img", { name: "Score: B, Gate status: pass" })).toBeInTheDocument();
  });

  it("folds a custom label into the aria-label instead of always announcing the generic text (#124 review finding #21)", () => {
    render(<GateStatusBadge letter="B" label="Hygiene B" />);
    expect(
      screen.getByRole("img", { name: "Hygiene B: B, Gate status: pass" }),
    ).toBeInTheDocument();
  });

  it("still shows the custom label as the visible text", () => {
    render(<GateStatusBadge letter="B" label="Hygiene B" />);
    expect(screen.getByText("Hygiene B")).toBeInTheDocument();
  });

  it("distinguishes two badges on the same page with different labels (Report Card vs Scorecard)", () => {
    render(
      <>
        <GateStatusBadge letter="B" />
        <GateStatusBadge letter="B" label="Hygiene B" />
      </>,
    );
    expect(screen.getByRole("img", { name: "Score: B, Gate status: pass" })).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Hygiene B: B, Gate status: pass" }),
    ).toBeInTheDocument();
  });
});
