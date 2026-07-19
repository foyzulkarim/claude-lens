import { describe, expect, it } from "vitest";
import type { FilterState } from "../../filters/state.js";
import { branchHref, projectHref } from "./drilldown.js";

const emptyFilters: FilterState = {
  range: { preset: "7d" },
  project: [],
  model: [],
  branch: [],
  host: [],
};

const populatedFilters: FilterState = {
  range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-18T00:00:00.000Z" },
  project: ["claude-lens"],
  model: ["claude-fable-5"],
  branch: ["main"],
  host: [],
};

describe("drilldown — projectHref", () => {
  it("builds a /sessions URL with just the project when filters are empty", () => {
    expect(projectHref("claude-lens", emptyFilters)).toBe("/sessions?project=claude-lens");
  });

  it("preserves sibling filters and replaces the existing project chip", () => {
    const href = projectHref("other-project", populatedFilters);
    expect(href.startsWith("/sessions?")).toBe(true);
    const params = new URLSearchParams(href.slice("/sessions?".length));
    expect(params.get("project")).toBe("other-project");
    expect(params.get("model")).toBe("claude-fable-5");
    expect(params.get("branch")).toBe("main");
    expect(params.get("from")).toBe("2026-07-01T00:00:00.000Z");
    expect(params.get("to")).toBe("2026-07-18T00:00:00.000Z");
  });

  it("preserves a non-default range preset", () => {
    const filters: FilterState = { ...emptyFilters, range: { preset: "30d" } };
    expect(projectHref("claude-lens", filters)).toBe("/sessions?range=30d&project=claude-lens");
  });

  it("drops the default '7d' preset (canonical URL form)", () => {
    expect(projectHref("claude-lens", emptyFilters)).not.toContain("range=");
  });

  it("percent-encodes unsafe characters", () => {
    expect(projectHref("Claude Lens, dev", emptyFilters)).toBe(
      "/sessions?project=Claude%20Lens%2C%20dev",
    );
  });
});

describe("drilldown — branchHref", () => {
  it("emits project and branch chips when filters are empty", () => {
    const href = branchHref("claude-lens", "feat/x", emptyFilters);
    // The raw URL must percent-encode the slash so two clicks on
    // `<p> · feat/x` produce the same URL (and the chip survives a
    // parseFilters round-trip). The decoded values are read out via
    // `params.get`.
    expect(href.startsWith("/sessions?")).toBe(true);
    expect(href).toContain("branch=feat%2Fx");
    const params = new URLSearchParams(href.slice("/sessions?".length));
    expect(params.get("project")).toBe("claude-lens");
    expect(params.get("branch")).toBe("feat/x");
  });

  it("replaces both the existing project and branch chips", () => {
    const href = branchHref("other-project", "fix/y", populatedFilters);
    const params = new URLSearchParams(href.slice("/sessions?".length));
    expect(params.get("project")).toBe("other-project");
    expect(params.get("branch")).toBe("fix/y");
    expect(params.get("model")).toBe("claude-fable-5");
    expect(params.get("from")).toBe("2026-07-01T00:00:00.000Z");
    expect(params.get("to")).toBe("2026-07-18T00:00:00.000Z");
  });

  it("preserves host and entrypoint-style siblings that are not project/branch", () => {
    const filters: FilterState = {
      ...emptyFilters,
      host: ["mac-mini-home"],
      range: { preset: "30d" },
    };
    const href = branchHref("claude-lens", "main", filters);
    const params = new URLSearchParams(href.slice("/sessions?".length));
    expect(params.get("project")).toBe("claude-lens");
    expect(params.get("branch")).toBe("main");
    expect(params.get("host")).toBe("mac-mini-home");
    expect(params.get("range")).toBe("30d");
  });
});
