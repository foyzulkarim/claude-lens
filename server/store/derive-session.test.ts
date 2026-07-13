import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTranscriptLines } from "../ingest/parse-transcript.js";
import { deriveSession } from "./derive-session.js";
import { deriveTurns } from "./derive-turns.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(
  __dirname,
  "..",
  "..",
  "test",
  "fixtures",
  "projects",
  "-Users-demo-project-alpha",
);

function readFixtureLines(filename: string): string[] {
  const content = readFileSync(join(fixturesDir, filename), "utf8");
  return content.split("\n").filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === ""));
}

const noSidecars = { hasCostSamples: false, hasTurnBoundaries: false, hasCostLog: false };

describe("deriveSession — fixture-driven rollups", () => {
  it("rolls up models, usage, and counts from the clean multi-turn fixture", () => {
    const lines = readFixtureLines("11111111-1111-4111-8111-111111111111.jsonl");
    const parsed = parseTranscriptLines(lines, new Set());
    const turns = deriveTurns(parsed.calls, parsed.prompts, parsed.toolResultBytes);

    const session = deriveSession(
      "11111111-1111-4111-8111-111111111111",
      parsed.calls,
      turns,
      noSidecars,
    );

    expect(session.callCount).toBe(parsed.calls.length);
    expect(session.turnCount).toBe(turns.length);
    expect(session.models.sort()).toEqual(["claude-fable-5", "claude-sonnet-5"]);
    // Exact totals across all 5 deduped calls in the fixture (computed independently
    // from the raw fixture JSON, not derived from this code) — a stronger check than
    // loose bounds, and consistent with the exact per-turn sums in derive-turns.test.ts.
    expect(session.usage).toMatchObject({
      inputTokens: 4000,
      outputTokens: 200,
      cacheReadTokens: 1200,
      cacheCreateTokens: 5300,
      cacheCreate5m: 300,
      cacheCreate1h: 5000,
    });
    expect(session.cacheHitPct).toBeCloseTo(1200 / (4000 + 1200 + 5300));
  });

  it("defaults costComputed to 0 without a pricer, and applies an injected pricer", () => {
    const lines = readFixtureLines("11111111-1111-4111-8111-111111111111.jsonl");
    const parsed = parseTranscriptLines(lines, new Set());
    const turns = deriveTurns(parsed.calls, parsed.prompts, parsed.toolResultBytes);

    const unpriced = deriveSession(
      "11111111-1111-4111-8111-111111111111",
      parsed.calls,
      turns,
      noSidecars,
    );
    expect(unpriced.costComputed).toBe(0);
    expect(unpriced.tier.costBasis).toBe("computed");

    const flatPricer = (usage: { inputTokens: number }) => usage.inputTokens * 0.001;
    const priced = deriveSession(
      "11111111-1111-4111-8111-111111111111",
      parsed.calls,
      turns,
      noSidecars,
      flatPricer,
    );
    expect(priced.costComputed).toBeGreaterThan(0);
    expect(priced.costComputed).toBeCloseTo(unpriced.usage.inputTokens * 0.001);
  });

  it("carries sidecar presence into tier flags", () => {
    const session = deriveSession("s1", [], [], {
      hasCostSamples: true,
      hasTurnBoundaries: false,
      hasCostLog: true,
    });
    expect(session.tier).toMatchObject({
      hasCostSamples: true,
      hasTurnBoundaries: false,
      hasCostLog: true,
    });
  });

  it("returns a zeroed rollup for a session with no calls", () => {
    const session = deriveSession("empty-session", [], [], noSidecars);
    expect(session.callCount).toBe(0);
    expect(session.turnCount).toBe(0);
    expect(session.usage.inputTokens).toBe(0);
    expect(session.cacheHitPct).toBe(0);
    expect(session.firstAt).toBe("");
    expect(session.durationMs).toBeUndefined();
  });
});
