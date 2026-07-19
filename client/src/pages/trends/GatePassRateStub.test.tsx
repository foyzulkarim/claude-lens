// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GatePassRateStub } from "./GatePassRateStub.js";

describe("GatePassRateStub", () => {
  it("renders the section title and the arrives-with-#P4-12 notice", () => {
    render(<GatePassRateStub />);
    expect(screen.getByText(/Gate pass rate per week/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("#P4-12");
  });
});
