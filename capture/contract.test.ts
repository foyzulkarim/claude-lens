import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseCostLogLines,
  parseCostSampleLines,
  parseTurnBoundaryLines,
} from "../server/ingest/parse-premium.js";

// A9 — producer↔parser contract test (ARCH-producer-cost-capture-tier §API
// Contracts / Architecture Decisions Log). Feeds synthetic statusline + Stop
// payloads through the real vendored .cjs scripts (spawned exactly as
// Claude Code would invoke them) into a temp HOME, then asserts the emitted
// C/B/L lines round-trip through the parsers this repo already ships with
// zero malformed lines and every field populated. This is the only thing
// that enforces R2 ("field names match parse-premium.ts exactly") — a
// silent drift here would otherwise only be caught by human inspection.

const captureDir = dirname(fileURLToPath(import.meta.url));

function runScript(script: string, payload: unknown, homeDir: string): void {
  execFileSync(process.execPath, [join(captureDir, script)], {
    input: JSON.stringify(payload),
    cwd: captureDir,
    env: { ...process.env, HOME: homeDir },
  });
}

function readLines(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "");
}

describe("producer ↔ parser contract (A9)", () => {
  let homeDir: string;
  let sessionIds: string[];

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "claude-lens-capture-contract-"));
    // Mirrors reality: on a real machine, ~/.claude/ already exists (Claude
    // Code itself creates it for settings.json / projects/) by the time a
    // user installs capture. cost-logger.cjs's L-file write assumes its
    // parent directory exists (only the per-session C directory is
    // mkdir'd), so a from-scratch temp HOME must pre-create it too.
    mkdirSync(join(homeDir, ".claude"), { recursive: true });
    sessionIds = [];
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
    // cost-logger.cjs's PREV_STATE_FILE / CACHE_ACCUM_FILE deliberately live
    // in the *system* tmpdir (not $HOME) keyed only by session_id — that's
    // why a fresh randomUUID() per test is required (a fixed id would
    // accumulate stale state across repeated runs), and cleaning them up
    // here keeps the real machine's /tmp from collecting test litter.
    for (const id of sessionIds) {
      for (const prefix of [
        "statusline-prevstate-",
        "statusline-cache-accum-",
        "statusline-lastactivity-",
      ]) {
        rmSync(join(tmpdir(), `${prefix}${id}`), { force: true });
      }
    }
  });

  function newSessionId(): string {
    const id = randomUUID();
    sessionIds.push(id);
    return id;
  }

  it("emits C/B/L lines that parse cleanly with every field populated", () => {
    const sessionId = newSessionId();
    // S8 — a dotted cwd exercises the `[/.]` → `-` slug rule.
    const cwd = "/Users/tester/work/my.project";
    const mappedDir = cwd.replace(/[/.]/g, "-");

    const statuslinePayload = {
      session_id: sessionId,
      model: { display_name: "claude-sonnet-5" },
      workspace: { current_dir: cwd, added_dirs: [] },
      cost: {
        total_cost_usd: 0.1234,
        total_duration_ms: 60_000,
        total_api_duration_ms: 5_000,
        total_lines_added: 3,
        total_lines_removed: 1,
      },
      context_window: {
        used_percentage: 42,
        current_usage: { cache_read_input_tokens: 100, cache_creation_input_tokens: 50 },
      },
    };
    runScript("statusline-command.cjs", statuslinePayload, homeDir);

    const stopPayload = {
      session_id: sessionId,
      workspace: { current_dir: cwd },
      transcript_path: `/root/.claude/projects/${mappedDir}/${sessionId}.jsonl`,
    };
    runScript("turn-logger.cjs", stopPayload, homeDir);

    const costFile = join(homeDir, ".claude", "projects", mappedDir, `${sessionId}.cost.jsonl`);
    const boundaryFile = join(
      homeDir,
      ".claude",
      "projects",
      mappedDir,
      `${sessionId}.turn-boundaries.jsonl`,
    );
    const costLogFile = join(homeDir, ".claude", "cost-log.jsonl");

    const costResult = parseCostSampleLines(readLines(costFile), sessionId);
    expect(costResult.malformedCount).toBe(0);
    expect(costResult.samples).toHaveLength(1);
    const sample = costResult.samples[0];
    expect(sample.sessionId).toBe(sessionId);
    expect(sample.timestamp).not.toBe("");
    expect(sample.cumulativeCostUsd).toBe(0.1234);
    expect(sample.costDeltaUsd).toBe(0.1234);
    expect(sample.apiDurationMs).toBe(5_000);
    expect(sample.contextPct).toBe(42);
    expect(sample.linesAdded).toBe(3);
    expect(sample.linesRemoved).toBe(1);
    expect(sample.cacheReadTokens).toBe(100);
    expect(sample.cacheWriteTokens).toBe(50);
    // Not emitted by the producer (ARCH Open Questions default) — the
    // parser must still treat this as a clean line, not a malformed one.
    expect(sample.promptId).toBeUndefined();

    const boundaryResult = parseTurnBoundaryLines(readLines(boundaryFile), sessionId);
    expect(boundaryResult.malformedCount).toBe(0);
    expect(boundaryResult.boundaries).toHaveLength(1);
    const boundary = boundaryResult.boundaries[0];
    expect(boundary.sessionId).toBe(sessionId);
    expect(boundary.turnEnd).not.toBe("");
    expect(boundary.turnEndEpoch).toBeGreaterThan(0);
    expect(boundary.transcriptPath).toBe(stopPayload.transcript_path);

    const logResult = parseCostLogLines(readLines(costLogFile));
    expect(logResult.malformedCount).toBe(0);
    expect(logResult.rows).toHaveLength(1);
    const row = logResult.rows[0];
    expect(row.sessionId).toBe(sessionId);
    expect(row.costUsd).toBe(0.1234);
    expect(row.dir).toBe(cwd);
    expect(row.model).toBe("claude-sonnet-5");
    expect(row.durationMs).toBe(60_000);
    expect(row.cacheRead).toBe(100);
    expect(row.cacheWrite).toBe(50);
    expect(row.linesAdded).toBe(3);
    expect(row.linesRemoved).toBe(1);
    expect(row.contextPct).toBe(42);
  });

  it("upserts the L row on a second tick instead of duplicating it", () => {
    const sessionId = newSessionId();
    const cwd = "/Users/tester/work/plain";
    const mappedDir = cwd.replace(/[/.]/g, "-");
    const basePayload = {
      session_id: sessionId,
      model: { display_name: "claude-sonnet-5" },
      workspace: { current_dir: cwd, added_dirs: [] },
      context_window: { used_percentage: 10, current_usage: {} },
    };

    runScript(
      "statusline-command.cjs",
      { ...basePayload, cost: { total_cost_usd: 0.01, total_api_duration_ms: 1000 } },
      homeDir,
    );
    runScript(
      "statusline-command.cjs",
      { ...basePayload, cost: { total_cost_usd: 0.02, total_api_duration_ms: 2000 } },
      homeDir,
    );

    const costLogFile = join(homeDir, ".claude", "cost-log.jsonl");
    const logResult = parseCostLogLines(readLines(costLogFile));
    expect(logResult.malformedCount).toBe(0);
    expect(logResult.rows).toHaveLength(1);
    expect(logResult.rows[0].costUsd).toBe(0.02);

    const costFile = join(homeDir, ".claude", "projects", mappedDir, `${sessionId}.cost.jsonl`);
    const costResult = parseCostSampleLines(readLines(costFile), sessionId);
    expect(costResult.malformedCount).toBe(0);
    expect(costResult.samples).toHaveLength(2);
  });
});
