import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// statusline-wrapper.cjs resolves statusline-original.json relative to its
// own __dirname, not cwd — so exercising both branches (delegated original,
// no-original fallback) requires running it from a scratch "scripts" dir we
// control, exactly as install.sh copies it to ~/.claude/scripts/, rather
// than from the repo's own capture/ source directory.

const captureDir = dirname(fileURLToPath(import.meta.url));

const VENDORED_FILES = [
  "statusline-wrapper.cjs",
  "cost-logger.cjs",
  "state-dir.cjs",
  "mapped-dir.cjs",
  "statusline-payload.cjs",
];

function runWrapper(scriptsDir: string, payload: unknown, homeDir: string): { stdout: string } {
  const stdout = execFileSync(process.execPath, [join(scriptsDir, "statusline-wrapper.cjs")], {
    input: JSON.stringify(payload),
    env: { ...process.env, HOME: homeDir },
    encoding: "utf8",
  });
  return { stdout };
}

describe("capture/statusline-wrapper.cjs", () => {
  let scriptsDir: string;
  let homeDir: string;

  beforeEach(() => {
    scriptsDir = mkdtempSync(join(tmpdir(), "claude-lens-capture-wrapper-scripts-"));
    for (const f of VENDORED_FILES) {
      cpSync(join(captureDir, f), join(scriptsDir, f));
    }
    homeDir = mkdtempSync(join(tmpdir(), "claude-lens-capture-wrapper-home-"));
    mkdirSync(join(homeDir, ".claude"), { recursive: true });
  });

  afterEach(() => {
    rmSync(scriptsDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  const payload = {
    session_id: "wrapper-test-session",
    model: { display_name: "claude-sonnet-5" },
    workspace: { current_dir: "/tmp/wrapper-test", added_dirs: [] },
    cost: { total_cost_usd: 0.42, total_api_duration_ms: 1000 },
    context_window: { used_percentage: 10, current_usage: {} },
  };

  it("delegates to the stored original statusline command and passes its stdout through", () => {
    writeFileSync(
      join(scriptsDir, "statusline-original.json"),
      JSON.stringify({ command: "printf 'ORIGINAL OUTPUT'" }),
    );

    const { stdout } = runWrapper(scriptsDir, payload, homeDir);
    expect(stdout).toBe("ORIGINAL OUTPUT");
  });

  it("falls back to a minimal cost line when no original command is stored", () => {
    // No statusline-original.json written — simulates a fresh install with
    // no prior foreign statusline.
    const { stdout } = runWrapper(scriptsDir, payload, homeDir);
    expect(stdout).toBe("[claude-sonnet-5] $0.42\n");
  });

  it("falls back to the minimal cost line when the original command produces no output", () => {
    writeFileSync(
      join(scriptsDir, "statusline-original.json"),
      JSON.stringify({ command: "true" }),
    );

    const { stdout } = runWrapper(scriptsDir, payload, homeDir);
    expect(stdout).toBe("[claude-sonnet-5] $0.42\n");
  });
});
