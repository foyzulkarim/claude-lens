import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRepoEnv, resolveE2ePort, resolveLanePorts } from "./ports.js";

const originalBase = process.env.CLAUDE_LENS_PORT_BASE;

afterEach(() => {
  if (originalBase === undefined) delete process.env.CLAUDE_LENS_PORT_BASE;
  else process.env.CLAUDE_LENS_PORT_BASE = originalBase;
});

describe("lane ports", () => {
  it("uses the single-checkout defaults", () => {
    expect(resolveLanePorts({})).toEqual({ backend: 4128, vite: 4129, e2e: 4130 });
    expect(resolveE2ePort({})).toBe(4130);
  });

  it("derives non-overlapping service ports from one base", () => {
    expect(resolveLanePorts({ CLAUDE_LENS_PORT_BASE: "5000" })).toEqual({
      backend: 5000,
      vite: 5001,
      e2e: 5002,
    });
  });

  it("preserves the explicit E2E override", () => {
    expect(resolveE2ePort({ CLAUDE_LENS_PORT_BASE: "5000", CLAUDE_LENS_E2E_PORT: "6000" })).toBe(
      6000,
    );
  });

  it.each(["0", "65534", "65535", "1.5", "not-a-port"])("rejects an unusable base %s", (value) => {
    expect(() => resolveLanePorts({ CLAUDE_LENS_PORT_BASE: value })).toThrow(
      /CLAUDE_LENS_PORT_BASE/,
    );
  });

  it("loads a worktree-local .env.local without overriding the shell", async () => {
    const root = await mkdtemp(join(tmpdir(), "claude-lens-ports-"));
    try {
      delete process.env.CLAUDE_LENS_PORT_BASE;
      await writeFile(join(root, ".env.local"), "CLAUDE_LENS_PORT_BASE=5100\n");
      loadRepoEnv(root);
      expect(process.env.CLAUDE_LENS_PORT_BASE).toBe("5100");

      process.env.CLAUDE_LENS_PORT_BASE = "5200";
      loadRepoEnv(root);
      expect(process.env.CLAUDE_LENS_PORT_BASE).toBe("5200");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
