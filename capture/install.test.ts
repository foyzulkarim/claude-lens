import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// install.sh idempotency + merge-preservation tests (ARCH-producer-cost-
// capture-tier §Change Footprint, S3-S5). Runs the real installer against a
// temp HOME (via the HOME env var, exactly like the manual verification in
// the architecture doc's task 8) rather than unit-testing the merge logic
// in isolation, so a regression in install.sh's own copy/exec-permission
// wiring shows up here too.

const captureDir = dirname(fileURLToPath(import.meta.url));
const installScript = join(captureDir, "install.sh");

function runInstall(homeDir: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("bash", [installScript], {
      env: { ...process.env, HOME: homeDir },
      encoding: "utf8",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout, stderr: e.stderr };
  }
}

function settingsPath(homeDir: string): string {
  return join(homeDir, ".claude", "settings.json");
}

function backupCount(claudeDir: string): number {
  return readdirSync(claudeDir).filter((f) => f.includes("backup")).length;
}

describe("capture/install.sh", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "claude-lens-capture-install-"));
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("installs into a HOME with no prior settings.json", () => {
    const result = runInstall(homeDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("installed");

    for (const f of [
      "cost-logger.cjs",
      "turn-logger.cjs",
      "statusline-command.cjs",
      "statusline-wrapper.cjs",
    ]) {
      expect(existsSync(join(homeDir, ".claude", "scripts", f))).toBe(true);
    }

    const settings = JSON.parse(readFileSync(settingsPath(homeDir), "utf8"));
    expect(settings.statusLine.command).toContain("statusline-command.cjs");
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.Stop[0].hooks[0].command).toContain("turn-logger.cjs");
  });

  it("writes a backup exactly when settings.json is modified, and none once stable (S4)", () => {
    const claudeDir = join(homeDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    // Pre-existing settings.json with nothing capture-related — the first
    // run must merge into it (and therefore back it up); an install into a
    // brand-new HOME with no prior file has nothing to back up at all,
    // which the first test in this file already covers.
    writeFileSync(settingsPath(homeDir), JSON.stringify({ model: "claude-sonnet-5" }));

    const first = runInstall(homeDir);
    expect(first.status).toBe(0);
    expect(backupCount(claudeDir)).toBe(1);

    const merged = JSON.parse(readFileSync(settingsPath(homeDir), "utf8"));
    expect(merged.model).toBe("claude-sonnet-5");

    // Second run: already fully configured and unchanged → no new backup.
    const second = runInstall(homeDir);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("already configured");
    expect(backupCount(claudeDir)).toBe(1);
  });

  it("produces byte-identical settings.json on a second run with no other changes (S4)", () => {
    runInstall(homeDir);
    const after1 = readFileSync(settingsPath(homeDir), "utf8");
    const second = runInstall(homeDir);
    expect(second.stdout).toContain("already configured");
    const after2 = readFileSync(settingsPath(homeDir), "utf8");
    expect(after2).toBe(after1);
  });

  it("preserves unrelated top-level config and other hook events", () => {
    const claudeDir = join(homeDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      settingsPath(homeDir),
      JSON.stringify({
        model: "claude-sonnet-5",
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo pre" }] }],
          Stop: [{ matcher: "", hooks: [{ type: "command", command: "echo existing-stop" }] }],
        },
      }),
    );

    const result = runInstall(homeDir);
    expect(result.status).toBe(0);
    const merged = JSON.parse(readFileSync(settingsPath(homeDir), "utf8"));
    expect(merged.model).toBe("claude-sonnet-5");
    expect(merged.hooks.PreToolUse).toHaveLength(1);
    expect(merged.hooks.Stop).toHaveLength(2);
    const stopCommands: string[] = merged.hooks.Stop.flatMap(
      (entry: { hooks: { command: string }[] }) => entry.hooks.map((h) => h.command),
    );
    expect(stopCommands).toContain("echo existing-stop");
    expect(stopCommands.some((c) => c.includes("turn-logger.cjs"))).toBe(true);
  });

  it("wraps a foreign statusline exactly once, matching by basename stem (A4)", () => {
    const claudeDir = join(homeDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      settingsPath(homeDir),
      JSON.stringify({
        statusLine: { type: "command", command: "node ~/my-original-statusline.js" },
      }),
    );

    runInstall(homeDir);
    const afterFirst = JSON.parse(readFileSync(settingsPath(homeDir), "utf8"));
    expect(afterFirst.statusLine.command).toContain("statusline-wrapper.cjs");
    const originalJson = JSON.parse(
      readFileSync(join(claudeDir, "scripts", "statusline-original.json"), "utf8"),
    );
    expect(originalJson.command).toBe("node ~/my-original-statusline.js");

    const second = runInstall(homeDir);
    expect(second.stdout).toContain("already configured");
    const afterSecond = JSON.parse(readFileSync(settingsPath(homeDir), "utf8"));
    // Not double-wrapped: still points straight at the wrapper, not nested.
    expect(afterSecond.statusLine.command).toBe(afterFirst.statusLine.command);
  });

  it("treats an already-ours statusline (any extension) as ours, not foreign (A4)", () => {
    const claudeDir = join(homeDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      settingsPath(homeDir),
      JSON.stringify({
        statusLine: {
          type: "command",
          command: `node ${claudeDir}/scripts/statusline-command.js`,
        },
      }),
    );

    const result = runInstall(homeDir);
    expect(result.status).toBe(0);
    const merged = JSON.parse(readFileSync(settingsPath(homeDir), "utf8"));
    // Upgraded in place to .cjs, not wrapped.
    expect(merged.statusLine.command).toContain("statusline-command.cjs");
    expect(merged.statusLine.command).not.toContain("statusline-wrapper");
  });

  it("exits 1 on unparseable settings.json without touching the file (S3)", () => {
    const claudeDir = join(homeDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(settingsPath(homeDir), "{ this is not json");

    const result = runInstall(homeDir);
    expect(result.status).toBe(1);
    expect(readFileSync(settingsPath(homeDir), "utf8")).toBe("{ this is not json");
    expect(existsSync(join(claudeDir, "scripts"))).toBe(true); // scripts still copied
    expect(backupCount(claudeDir)).toBe(0);
  });
});
