import { describe, expect, it } from "vitest";
import { buildStorybookArgs } from "./storybook.js";

describe("storybook lane configuration", () => {
  it("derives the storybook port from the lane base and pins it exactly", () => {
    expect(buildStorybookArgs({ CLAUDE_LENS_PORT_BASE: "5000" })).toEqual([
      "dev",
      "-p",
      "5003",
      "--exact-port",
      "-c",
      "client/.storybook",
    ]);
  });

  it("keeps a fixed offset above the E2E port on the single-checkout default", () => {
    expect(buildStorybookArgs({})).toContain("4131");
  });

  it("forwards additional CLI arguments", () => {
    expect(buildStorybookArgs({ CLAUDE_LENS_PORT_BASE: "5000" }, ["--smoke-test", "--ci"])).toEqual(
      ["dev", "-p", "5003", "--exact-port", "-c", "client/.storybook", "--smoke-test", "--ci"],
    );
  });

  it.each([
    ["-p", "7000"],
    ["--port=7000"],
    ["--exact-port"],
    ["-c", "elsewhere"],
  ])("rejects overrides of wrapper-managed flags: %s", (...override) => {
    expect(() => buildStorybookArgs({}, [...override])).toThrow(/managed by this wrapper/);
  });
});
