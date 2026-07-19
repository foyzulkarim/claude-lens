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

  it("rejects @import paths that escape the importer's directory (relative)", async () => {
    // Relative escape: projectDir/CLAUDE.md imports "../userDir/escaped.md",
    // which lands outside projectDir — must be rejected, not counted.
    // Without the relative-escape check the imported file (10_000 chars)
    // would inflate the size total and trigger E2 warn.
    const primary = `@import "../${join(userDir, "escaped.md").split("/").pop() ?? "escaped.md"}"\n\n# Project`;
    await writeFile(join(projectDir, "CLAUDE.md"), primary, "utf8");
    await writeFile(join(userDir, "escaped.md"), "x".repeat(10_000), "utf8");
    const results = await evaluateE1E2(
      projectDir,
      { e2MaxChars: 4_000, e2MaxLines: 60 },
      { userClaudePath: join(userDir, "CLAUDE.md") },
    );
    const e1 = results.find((r) => r.gateId === "E1");
    const e2 = results.find((r) => r.gateId === "E2");
    // Project file is small on its own → E2 inactive (pass). The escape
    // attempt is rejected (security, review H1).
    expect(e2?.status).toBe("pass");
    // The rejection surfaces as warn evidence on the active gate.
    const anyEvidence = (e1?.evidence ?? []).concat(e2?.evidence ?? []);
    expect(
      anyEvidence.some(
        (ev) =>
          typeof ev.filePath === "string" &&
          ev.filePath.includes("escaped.md") &&
          ev.detail.includes("rejected"),
      ),
    ).toBe(true);
  });

  it("rejects absolute @import paths outright (review H1 — was a path-traversal bug)", async () => {
    // The pre-fix code allowed `@import "/etc/passwd"` because the
    // guard short-circuited on `!isAbsolute(rawPath)`. The fix rejects
    // absolute paths unconditionally; the importer can't vouch for an
    // arbitrary filesystem location.
    const primary = '@import "/etc/passwd"\n\n# Project';
    await writeFile(join(projectDir, "CLAUDE.md"), primary, "utf8");
    const results = await evaluateE1E2(
      projectDir,
      { e2MaxChars: 4_000, e2MaxLines: 60 },
      { userClaudePath: join(userDir, "CLAUDE.md") },
    );
    const e1 = results.find((r) => r.gateId === "E1");
    const e2 = results.find((r) => r.gateId === "E2");
    expect(e2?.status).toBe("pass");
    const anyEvidence = (e1?.evidence ?? []).concat(e2?.evidence ?? []);
    expect(
      anyEvidence.some(
        (ev) => ev.detail.includes("absolute path not allowed") && ev.filePath === "/etc/passwd",
      ),
    ).toBe(true);
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

  it("treats an unreadable CLAUDE.md as warn, not fail (review H4 — ARCH §Cross-Cutting)", async () => {
    // Use a directory at the expected CLAUDE.md path so readFile fails
    // with EISDIR — portable across POSIX systems without needing
    // chmod/permission manipulation.
    await mkdir(join(projectDir, "CLAUDE.md"), { recursive: true });
    await writeFile(join(userDir, "CLAUDE.md"), "# user config\n", "utf8");
    const results = await evaluateE1E2(
      projectDir,
      { e2MaxChars: 4_000, e2MaxLines: 60 },
      { userClaudePath: join(userDir, "CLAUDE.md") },
    );
    const e1 = results.find((r) => r.gateId === "E1");
    // Project file unreadable but user file is fine: E1 stays active
    // with warn evidence pointing at the unreadable project path.
    expect(e1?.status).toBe("warn");
    expect(
      e1?.evidence.some(
        (ev) =>
          typeof ev.filePath === "string" &&
          ev.filePath.endsWith("CLAUDE.md") &&
          ev.detail.startsWith("checked ") &&
          ev.detail.includes("unreadable"),
      ),
    ).toBe(true);
  });

  it("warns (not fails) when both project and user CLAUDE.md are unreadable", async () => {
    await mkdir(join(projectDir, "CLAUDE.md"), { recursive: true });
    await mkdir(join(userDir, "CLAUDE.md"), { recursive: true });
    const results = await evaluateE1E2(
      projectDir,
      { e2MaxChars: 4_000, e2MaxLines: 60 },
      { userClaudePath: join(userDir, "CLAUDE.md") },
    );
    const e1 = results.find((r) => r.gateId === "E1");
    expect(e1?.status).toBe("warn");
    // Two unreadable evidence entries — one per file.
    const unreadableEntries = (e1?.evidence ?? []).filter((ev) => ev.detail.includes("unreadable"));
    expect(unreadableEntries).toHaveLength(2);
  });
});
