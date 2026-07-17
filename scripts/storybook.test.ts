import { describe, expect, it } from "vitest";
import { buildStorybookArgs } from "./storybook.js";

describe("storybook lane configuration", () => {
  it("derives the storybook port from the lane base", () => {
    expect(buildStorybookArgs({ CLAUDE_LENS_PORT_BASE: "5000" })).toEqual([
      "dev",
      "-p",
      "5003",
      "-c",
      "client/.storybook",
    ]);
  });

  it("keeps a fixed offset above the E2E port on the single-checkout default", () => {
    expect(buildStorybookArgs({})).toEqual(["dev", "-p", "4131", "-c", "client/.storybook"]);
  });
});
