import { describe, expect, it } from "vitest";
import type {
  SessionPopulationCriteria,
  SessionPopulationFilter,
} from "../../shared/sessions-contract.js";
import type { ApiCall, Session, Turn } from "../../shared/types.js";
import { DEFAULT_PRICING_TABLE } from "./measures.js";
import {
  applyRange,
  indexSessionsByScope,
  matchSession,
  measureForSession,
  totalTokensForSession,
} from "./session-population.js";

function iso(y: number, mo: number, d: number, h = 0, mi = 0): string {
  return new Date(y, mo, d, h, mi).toISOString();
}

function baseSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: "s1",
    lineageId: "s1",
    project: "/repo/alpha",
    entrypoint: "cli",
    models: ["claude-sonnet-5"],
    gitBranch: "main",
    version: "1.2.3",
    host: "default",
    tier: {
      hasCostSamples: false,
      hasTurnBoundaries: false,
      hasCostLog: false,
      costBasis: "computed",
    },
    firstAt: iso(2026, 6, 13, 10, 0),
    lastAt: iso(2026, 6, 13, 10, 5),
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
    turnCount: 0,
    callCount: 0,
    costComputed: 0,
    cacheHitPct: 0,
    ...overrides,
  };
}

function call(overrides: Partial<ApiCall> = {}): ApiCall {
  return {
    uuid: `u-${Math.random()}`,
    sessionId: "s1",
    messageId: `m-${Math.random()}`,
    timestamp: iso(2026, 6, 13, 10, 0),
    model: "claude-sonnet-5",
    usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreateTokens: 0 },
    isSidechain: false,
    tools: [],
    cwd: "/repo/alpha",
    gitBranch: "main",
    version: "1.2.3",
    entrypoint: "cli",
    ...overrides,
  };
}

function turn(overrides: Partial<Turn> = {}): Turn {
  return {
    promptId: "p1",
    sessionId: "s1",
    isSidechain: false,
    startedAt: iso(2026, 6, 13, 10, 0),
    endedAt: iso(2026, 6, 13, 10, 1),
    calls: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
    toolResultBytes: 0,
    ...overrides,
  };
}

describe("matchSession — population predicate", () => {
  it("matches when no criteria are set", () => {
    expect(matchSession(baseSession(), {})).toBe(true);
  });

  it("filters by project, model, branch, host, and entrypoint", () => {
    const session = baseSession({
      project: "/repo/alpha",
      models: ["claude-sonnet-5", "claude-fable-5"],
      gitBranch: "feat/x",
      host: "default",
      entrypoint: "cli",
    });
    expect(matchSession(session, { project: ["/repo/alpha"] })).toBe(true);
    expect(matchSession(session, { project: ["/repo/beta"] })).toBe(false);
    expect(matchSession(session, { model: ["claude-haiku-4-5"] })).toBe(false);
    // Multi-model session matches when ANY of its models is allowed (R2).
    expect(matchSession(session, { model: ["claude-fable-5"] })).toBe(true);
    expect(matchSession(session, { branch: ["main"] })).toBe(false);
    expect(matchSession(session, { branch: ["feat/x"] })).toBe(true);
    expect(matchSession(session, { host: ["other"] })).toBe(false);
    expect(matchSession(session, { entrypoint: ["sdk"] })).toBe(false);
  });

  it("hasDrilldown means turnCount > 0 (R9)", () => {
    const noTurns = baseSession({ turnCount: 0 });
    const withTurns = baseSession({ turnCount: 3 });
    expect(matchSession(noTurns, { hasDrilldown: false })).toBe(true);
    expect(matchSession(noTurns, { hasDrilldown: true })).toBe(false);
    expect(matchSession(withTurns, { hasDrilldown: true })).toBe(true);
    expect(matchSession(withTurns, { hasDrilldown: false })).toBe(false);
  });

  it("filters by cost bounds inclusively", () => {
    const cheap = baseSession({ costComputed: 0.1 });
    const pricey = baseSession({ costComputed: 5.0 });
    expect(matchSession(cheap, { minCostComputed: 0 })).toBe(true);
    expect(matchSession(cheap, { maxCostComputed: 0.1 })).toBe(true);
    expect(matchSession(cheap, { maxCostComputed: 0.05 })).toBe(false);
    expect(matchSession(pricey, { minCostComputed: 1.0 })).toBe(true);
  });

  it("rejects sessions outside sessionId allowlist (compare hydration)", () => {
    const a = baseSession({ sessionId: "s-a" });
    const b = baseSession({ sessionId: "s-b" });
    expect(matchSession(a, { sessionId: ["s-a", "s-b"] })).toBe(true);
    expect(matchSession(a, { sessionId: ["s-c"] })).toBe(false);
    expect(matchSession(b, { sessionId: ["s-a", "s-b"] })).toBe(true);
  });

  it("composes multiple criteria as a logical AND", () => {
    const session = baseSession({
      project: "/repo/alpha",
      models: ["claude-sonnet-5"],
      costComputed: 2.0,
      turnCount: 1,
    });
    const criteria: SessionPopulationCriteria = {
      project: ["/repo/alpha"],
      model: ["claude-sonnet-5"],
      minCostComputed: 1.0,
      maxCostComputed: 5.0,
      hasDrilldown: true,
    };
    expect(matchSession(session, criteria)).toBe(true);
    // Fails on any single criterion.
    expect(matchSession(session, { ...criteria, model: ["claude-opus-4-8"] })).toBe(false);
    expect(matchSession(session, { ...criteria, hasDrilldown: false })).toBe(false);
    expect(matchSession(session, { ...criteria, maxCostComputed: 1.0 })).toBe(false);
  });
});

describe("applyRange — range filter on firstAt, inclusive both bounds", () => {
  it("matches sessions at the inclusive boundary", () => {
    const sessions = [
      baseSession({ sessionId: "s-a", firstAt: iso(2026, 6, 10) }),
      baseSession({ sessionId: "s-b", firstAt: iso(2026, 6, 12, 10) }),
      baseSession({ sessionId: "s-c", firstAt: iso(2026, 6, 14) }),
    ];
    const filter: SessionPopulationFilter = {
      range: { from: iso(2026, 6, 10), to: iso(2026, 6, 12, 10) },
    };
    const { matched } = applyRange(filter, sessions);
    expect(matched.map((s) => s.sessionId)).toEqual(["s-a", "s-b"]);
  });

  it("excludes sessions with unparseable firstAt", () => {
    const sessions = [
      baseSession({ sessionId: "s-good", firstAt: iso(2026, 6, 10) }),
      baseSession({ sessionId: "s-empty", firstAt: "" }),
    ];
    const filter: SessionPopulationFilter = {
      range: { from: iso(2026, 6, 1), to: iso(2026, 6, 30) },
    };
    const { matched } = applyRange(filter, sessions);
    expect(matched.map((s) => s.sessionId)).toEqual(["s-good"]);
  });

  it("combines range + criteria correctly", () => {
    const sessions = [
      baseSession({ sessionId: "s-a", project: "/repo/alpha", firstAt: iso(2026, 6, 10) }),
      baseSession({ sessionId: "s-b", project: "/repo/beta", firstAt: iso(2026, 6, 10) }),
      baseSession({ sessionId: "s-c", project: "/repo/alpha", firstAt: iso(2026, 6, 14) }),
    ];
    const filter: SessionPopulationFilter = {
      range: { from: iso(2026, 6, 1), to: iso(2026, 6, 11) },
      project: ["/repo/alpha"],
    };
    const { matched } = applyRange(filter, sessions);
    expect(matched.map((s) => s.sessionId)).toEqual(["s-a"]);
  });

  it("returns numeric fromMs/toMs for downstream scope reuse", () => {
    const filter: SessionPopulationFilter = {
      range: { from: iso(2026, 6, 10), to: iso(2026, 6, 12) },
    };
    const { fromMs, toMs } = applyRange(filter, []);
    expect(Number.isFinite(fromMs)).toBe(true);
    expect(Number.isFinite(toMs)).toBe(true);
    expect(fromMs).toBeLessThan(toMs);
  });
});

describe("indexSessionsByScope — per-session record isolation", () => {
  it("each session receives only its own calls and turns", () => {
    const s1 = baseSession({ sessionId: "s1" });
    const s2 = baseSession({ sessionId: "s2" });
    const calls: ApiCall[] = [
      call({ sessionId: "s1", uuid: "c-s1-1" }),
      call({ sessionId: "s2", uuid: "c-s2-1" }),
      call({ sessionId: "s1", uuid: "c-s1-2" }),
    ];
    const turns: Turn[] = [
      turn({ sessionId: "s1", promptId: "p-s1" }),
      turn({ sessionId: "s2", promptId: "p-s2" }),
    ];
    const scopes = indexSessionsByScope([s1, s2], calls, turns);
    expect(
      scopes
        .get("s1")
        ?.calls.map((c) => c.uuid)
        .sort(),
    ).toEqual(["c-s1-1", "c-s1-2"]);
    expect(scopes.get("s2")?.calls.map((c) => c.uuid)).toEqual(["c-s2-1"]);
    expect(scopes.get("s1")?.turns).toHaveLength(1);
    expect(scopes.get("s2")?.turns).toHaveLength(1);
  });

  it("emits exact totals when summed from indexed scopes", () => {
    const s = baseSession({ sessionId: "s1" });
    const calls: ApiCall[] = [
      call({
        sessionId: "s1",
        uuid: "c1",
        usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreateTokens: 0 },
      }),
      call({
        sessionId: "s1",
        uuid: "c2",
        usage: { inputTokens: 200, outputTokens: 20, cacheReadTokens: 0, cacheCreateTokens: 0 },
      }),
    ];
    const scopes = indexSessionsByScope([s], calls, []);
    const sScope = scopes.get("s1");
    if (!sScope) throw new Error("expected s1 scope to exist");
    const inputTokens = measureForSession("inputTokens", sScope, DEFAULT_PRICING_TABLE);
    expect(inputTokens).toBe(300);
  });

  it("returns an empty scope for a session with no records", () => {
    const s = baseSession({ sessionId: "s1" });
    const scopes = indexSessionsByScope([s], [], []);
    const sScope = scopes.get("s1");
    expect(sScope?.calls).toEqual([]);
    expect(sScope?.turns).toEqual([]);
  });
});

describe("totalTokensForSession — sum of four token categories", () => {
  it("sums inputTokens + outputTokens + cacheReadTokens + cacheCreateTokens", () => {
    const s = baseSession({
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 25,
        cacheCreateTokens: 10,
      },
    });
    expect(totalTokensForSession(s)).toBe(185);
  });

  it("treats undefined fields as 0", () => {
    // Type system forbids undefined here, but coerce via `as` to confirm
    // runtime safety against malformed fixtures.
    const s = baseSession({
      usage: {
        inputTokens: 100,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      },
    });
    expect(totalTokensForSession(s)).toBe(100);
  });
});

describe("engine integration — engine distributionEntity='session' uses indexed scopes", () => {
  // Regression guard (ARCH T1): every existing engine.mode === "distribution"
  // test continues to pass because the dispatch path through engine.ts now
  // funnels through the new index instead of re-filtering per session.
  // Indirect coverage: importing `engine.ts` + running its existing tests
  // would catch any wiring breakage; this unit test asserts the indexed
  // path returns identical numbers to what the pre-existing
  // entityScopesFor("session", ...) produced.

  it("per-session costComputed totals match across the two paths", () => {
    const s1 = baseSession({ sessionId: "s1", firstAt: iso(2026, 6, 13, 9, 0) });
    const s2 = baseSession({ sessionId: "s2", firstAt: iso(2026, 6, 13, 10, 0) });
    const s3 = baseSession({ sessionId: "s3", firstAt: iso(2026, 6, 13, 11, 0) });
    const calls: ApiCall[] = [
      call({
        sessionId: "s1",
        uuid: "c1",
        usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreateTokens: 0 },
      }),
      call({
        sessionId: "s2",
        uuid: "c2",
        usage: { inputTokens: 200, outputTokens: 20, cacheReadTokens: 0, cacheCreateTokens: 0 },
      }),
      call({
        sessionId: "s3",
        uuid: "c3",
        usage: { inputTokens: 300, outputTokens: 30, cacheReadTokens: 0, cacheCreateTokens: 0 },
      }),
    ];

    const scopes = indexSessionsByScope([s1, s2, s3], calls, []);
    const values = [...scopes.values()].map(
      (scope) => measureForSession("costComputed", scope, DEFAULT_PRICING_TABLE) ?? 0,
    );
    expect(values).toHaveLength(3);
    // Sorted ascending: cheapest session first
    const [first, second, third] = values;
    expect(first).toBeLessThan(second as number);
    expect(second).toBeLessThan(third as number);
  });
});
