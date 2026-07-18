import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ApiCall } from "../../shared/types.js";
import { parseTranscriptLines } from "../ingest/parse-transcript.js";
import { attributeCacheMiss, classifyCacheWrite, partitionCacheStreams } from "./classifier.js";

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

const FIXTURE = "55555555-5555-4555-8555-555555555555.jsonl";

/**
 * Loads the fixture through the existing ingest boundary so future
 * gate fixtures (#P4-11) follow the same path — no separate parser
 * shortcut. Returns the parsed ApiCall[] after asserting the parser
 * saw zero malformed JSON and zero duplicate messageIds (a regression
 * here would silently shift spike counts on the Cypress #P4-9 journey).
 */
function loadCacheLabFixture(): ApiCall[] {
  const lines = readFixtureLines(FIXTURE);
  const result = parseTranscriptLines(lines, new Set());
  expect(result.malformedCount).toBe(0);
  expect(result.duplicateCount).toBe(0);
  return result.calls;
}

describe("cache-lab fixture (#P4-9, T1) regression guard", () => {
  it("preserves the parser contract — both TTL buckets survive dedupe", () => {
    const calls = loadCacheLabFixture();

    // At least one parsed call has cacheCreate5m > 0, one has cacheCreate1h > 0,
    // and one is missing both — proving the parser keeps every optional
    // bucket field through dedupe and would survive the analyzer's
    // "missing buckets = unknown TTL" branch.
    const with5m = calls.filter(
      (c) => typeof c.usage.cacheCreate5m === "number" && c.usage.cacheCreate5m > 0,
    );
    const with1h = calls.filter(
      (c) => typeof c.usage.cacheCreate1h === "number" && c.usage.cacheCreate1h > 0,
    );
    const withoutBuckets = calls.filter(
      (c) =>
        c.usage.cacheCreateTokens > 0 &&
        c.usage.cacheCreate5m === undefined &&
        c.usage.cacheCreate1h === undefined,
    );
    expect(with5m.length).toBeGreaterThan(0);
    expect(with1h.length).toBeGreaterThan(0);
    expect(withoutBuckets.length).toBeGreaterThan(0);
  });

  it("timestamps precede the Dashboard anchor (4444…) so Dashboard's most-recent assertion stays true", () => {
    const calls = loadCacheLabFixture();
    const latest5555 = calls.map((c) => c.timestamp).reduce((max, ts) => (ts > max ? ts : max), "");
    const latest4444 = "2026-07-03T07:02:03.000Z"; // pinned by cypress/e2e/dashboard.cy.ts
    expect(latest5555 < latest4444).toBe(true);
  });

  it("partitions main + 2 sidechain-agent streams; each is independently classifiable", () => {
    const calls = loadCacheLabFixture();
    const streams = partitionCacheStreams(calls);

    // Stream keys are "<sessionId>::main" / "<sessionId>::<agentId>" —
    // the analyzer (T2) and Cypress specs match by prefix, never the
    // literal "main" string. Find the keys by prefix so the test
    // survives a future fixture sessionId change.
    const mainKey = [...streams.keys()].find((k) => k.endsWith("::main"));
    const agentAKey = [...streams.keys()].find((k) => k.endsWith("::agent-5555a"));
    const agentBKey = [...streams.keys()].find((k) => k.endsWith("::agent-5555b"));
    expect(mainKey).toBeDefined();
    expect(agentAKey).toBeDefined();
    expect(agentBKey).toBeDefined();
    expect(streams.get(agentAKey ?? "")?.length).toBe(2);
    expect(streams.get(agentBKey ?? "")?.length).toBe(1);

    const main = streams.get(mainKey ?? "");
    expect(main?.length).toBeGreaterThan(0);
    if (main?.[0]) {
      const classified = classifyCacheWrite(main, 0);
      expect(classified?.baseCause).toBe("first-call");
    }
  });

  it("classifies every K2 cause branch from the main stream in the documented order", () => {
    const calls = loadCacheLabFixture();
    const streams = partitionCacheStreams(calls);
    const mainKey = [...streams.keys()].find((k) => k.endsWith("::main"));
    const main = mainKey ? streams.get(mainKey) : undefined;
    expect(main).toBeDefined();
    if (!main) return;

    const causes = main
      .map((_call, idx) => classifyCacheWrite(main, idx))
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map((r) => r.baseCause);

    // Each of first-call, compaction, model-switch must appear at least
    // once; the trailing unknowns (prefix-change, ttl-lapse, mixed,
    // missing-buckets) share the base cause "unexplained" but land on
    // distinct TTL overlay values — confirmed below.
    expect(causes).toContain("first-call");
    expect(causes).toContain("compaction");
    expect(causes).toContain("model-switch");
    expect(causes).toContain("unexplained");
  });

  it("emits every TTL overlay outcome from the main stream", () => {
    const calls = loadCacheLabFixture();
    const streams = partitionCacheStreams(calls);
    const mainKey = [...streams.keys()].find((k) => k.endsWith("::main"));
    const main = mainKey ? streams.get(mainKey) : undefined;
    expect(main).toBeDefined();
    if (!main) return;

    const attributions = main
      .map((call, idx) => {
        const classified = classifyCacheWrite(main, idx);
        if (!classified) return null;
        // Carry the previous call forward so attributeCacheMiss sees the
        // exact context the analyzer will hand it. The gap-bridge below
        // mirrors what analyzeCacheLab will do (T2).
        const previous = idx > 0 ? main[idx - 1] : undefined;
        return attributeCacheMiss(classified, call, previous);
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);

    // Each of prefix-change, ttl-lapse, unknown appears at least once.
    expect(attributions).toContain("prefix-change");
    expect(attributions).toContain("ttl-lapse");
    expect(attributions).toContain("unknown");
  });
});
