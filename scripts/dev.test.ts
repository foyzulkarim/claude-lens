import { describe, expect, it } from "vitest";
import { buildDevProcesses } from "./dev.js";

describe("dev process configuration", () => {
  it("wires the server and client to the same lane base", () => {
    const processes = buildDevProcesses({ CLAUDE_LENS_PORT_BASE: "5000" });
    expect(processes).toHaveLength(2);
    expect(processes[0]?.args).toContain("5000");
    expect(processes[1]?.args).toEqual(["--config", "client/vite.config.ts"]);
  });

  it("supports a server-only lane", () => {
    expect(buildDevProcesses({ CLAUDE_LENS_PORT_BASE: "5000" }, { serverOnly: true })).toHaveLength(
      1,
    );
  });
});
