import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateE1E2 } from "./e1e2.js";

let projectDir: string;
let userDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "claude-lens-e1e2-project-"));
  userDir = await mkdtemp(join(tmpdir(), "claude-lens-e1e2-user-"));
  await mkdir(projectDir, { recursive: true });
  await mkdir(userDir, { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
  await rm(userDir, { recursive: true, force: true });
});

describe("E1/E2 — CLAUDE.md missing / bloated", () => {
  it("E1 fails when neither project nor user CLAUDE.md exists", async () => {
    const results = await evaluateE1E2(
      projectDir,
      { e2MaxChars: 4_000, e2MaxLines: 60 },
      { userClaudePath: join(userDir, "CLAUDE.md") },
    );
    const e1 = results.find((r) => r.gateId === "E1");
    const e2 = results.find((r) => r.gateId === "E2");
    expect(e1?.status).toBe("fail");
    expect(e2?.status).toBe("pass"); // inactive
    expect(e1?.evidence).toHaveLength(2);
  });

  it("E1 passes (inactive E2) when project CLAUDE.md exists and is small", async () => {
    await writeFile(join(projectDir, "CLAUDE.md"), "small", "utf8");
    const results = await evaluateE1E2(
      projectDir,
      { e2MaxChars: 4_000, e2MaxLines: 60 },
      { userClaudePath: join(userDir, "CLAUDE.md") },
    );
    const e1 = results.find((r) => r.gateId === "E1");
    const e2 = results.find((r) => r.gateId === "E2");
    expect(e1?.status).toBe("pass");
    expect(e2?.status).toBe("pass"); // inactive
  });

  it("E2 warns (active) when CLAUDE.md is over the char threshold", async () => {
    await writeFile(join(projectDir, "CLAUDE.md"), "x".repeat(5_000), "utf8");
    const results = await evaluateE1E2(
      projectDir,
      { e2MaxChars: 4_000, e2MaxLines: 60 },
      { userClaudePath: join(userDir, "CLAUDE.md") },
    );
    const e1 = results.find((r) => r.gateId === "E1");
    const e2 = results.find((r) => r.gateId === "E2");
    expect(e1?.status).toBe("pass"); // inactive
    expect(e2?.status).toBe("warn");
  });

  it("E2 warns (active) when CLAUDE.md has more than e2MaxLines lines", async () => {
    const lines = Array.from({ length: 70 }, (_, i) => `line ${i}`).join("\n");
    await writeFile(join(projectDir, "CLAUDE.md"), lines, "utf8");
    const results = await evaluateE1E2(
      projectDir,
      { e2MaxChars: 4_000, e2MaxLines: 60 },
      { userClaudePath: join(userDir, "CLAUDE.md") },
    );
    const e2 = results.find((r) => r.gateId === "E2");
    expect(e2?.status).toBe("warn");
  });

  it("follows @import references one level only (R14) — imported file counts in size total", async () => {
    // Primary at exactly 3,990 chars (under threshold). Imported 100 chars
    // → total 4,090 > 4,000 → E2 warn. Without the @import walker this
    // would be a pass.
    const primary = `@import "./extra.md"\n\n# Project\n${"x".repeat(3_970)}`;
    await writeFile(join(projectDir, "CLAUDE.md"), primary, "utf8");
    await writeFile(join(projectDir, "extra.md"), "x".repeat(100), "utf8");
    const results = await evaluateE1E2(
      projectDir,
      { e2MaxChars: 4_000, e2MaxLines: 60 },
      { userClaudePath: join(userDir, "CLAUDE.md") },
    );
    const e2 = results.find((r) => r.gateId === "E2");
    expect(e2?.status).toBe("warn");
  });

  it("rejects @import paths that escape the importer's directory", async () => {
    // /escaped.md is OUTSIDE projectDir — should be rejected, not counted.
    // Primary is 50 chars, no import counted → pass.
    await writeFile(join(projectDir, "CLAUDE.md"), '@import "/escaped.md"\n\n# Project', "utf8");
    await writeFile(join(userDir, "escaped.md"), "x".repeat(10_000), "utf8");
    const results = await evaluateE1E2(
      projectDir,
      { e2MaxChars: 4_000, e2MaxLines: 60 },
      { userClaudePath: join(userDir, "CLAUDE.md") },
    );
    // The absolute /escaped.md import was rejected (security). Project
    // file is small on its own → E2 inactive (pass).
    const e2 = results.find((r) => r.gateId === "E2");
    expect(e2?.status).toBe("pass");
  });

  it("emits only filePath + detail in evidence (no turnN/callId) per R7", async () => {
    await writeFile(join(projectDir, "CLAUDE.md"), "x".repeat(5_000), "utf8");
    const results = await evaluateE1E2(
      projectDir,
      { e2MaxChars: 4_000, e2MaxLines: 60 },
      { userClaudePath: join(userDir, "CLAUDE.md") },
    );
    for (const result of results) {
      for (const ev of result.evidence) {
        expect(ev.turnN).toBeUndefined();
        expect(ev.callId).toBeUndefined();
        expect(ev.filePath).toBeDefined();
        expect(ev.detail).toBeTruthy();
      }
    }
  });
});
