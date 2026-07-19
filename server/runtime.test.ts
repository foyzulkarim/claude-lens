import { describe, expect, it } from "vitest";
import type { ApiCall } from "../shared/types.js";
import { priceCall } from "./metrics/measures.js";
import { buildRuntimeMetadata } from "./runtime.js";

function makeCall(overrides: Partial<ApiCall["usage"]> = {}): ApiCall {
  return {
    uuid: "u1",
    sessionId: "s1",
    messageId: "m1",
    timestamp: "2026-07-14T10:00:00.000Z",
    model: "claude-sonnet-5",
    usage: {
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 300,
      cacheCreateTokens: 50,
      ...overrides,
    },
    isSidechain: false,
    tools: [],
    cwd: "/repo",
    gitBranch: "main",
    version: "1.0.0",
    entrypoint: "cli",
  };
}

describe("buildRuntimeMetadata — pricer/priceCall parity (review #8)", () => {
  it("the runtime pricer and priceCall produce identical results for the same (usage, model, pricing)", () => {
    // Review #8: before this fix, runtime.ts's pricer hand-copied priceCall's
    // formula. A future pricing change (rounding, new token category) would
    // have to be applied twice. The fix delegates both to priceUsage so
    // they're guaranteed to agree.
    const meta = buildRuntimeMetadata();
    const call = makeCall();
    expect(meta.pricer(call.usage, call.model)).toBeCloseTo(priceCall(call, meta.pricing), 12);
  });

  it("the runtime pricer returns 0 for an unpriced model (matches priceCall)", () => {
    const meta = buildRuntimeMetadata();
    const call = makeCall();
    call.model = "claude-unknown-future-99";
    expect(meta.pricer(call.usage, call.model)).toBe(0);
    expect(priceCall(call, meta.pricing)).toBe(0);
  });

  it("partial pricing overrides don't break pricer consistency", () => {
    const custom = {
      "claude-sonnet-5": {
        input: 7.0,
        output: 30.0,
        cacheRead: 0.7,
        cacheCreate: 8.75,
      },
    };
    const meta = buildRuntimeMetadata({ pricing: custom });
    const call = makeCall();
    call.model = "claude-sonnet-5";
    expect(meta.pricer(call.usage, call.model)).toBeCloseTo(priceCall(call, custom), 12);
  });
});
