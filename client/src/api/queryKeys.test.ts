import { describe, expect, it } from "vitest";
import { qk } from "./queryKeys.js";

describe("qk.metrics", () => {
  it("returns the metrics-prefixed key", () => {
    expect(qk.metrics({} as never)).toEqual(["metrics", {}]);
  });

  it("lives under qk.prefixes.metrics", () => {
    const key = qk.metrics({ measures: ["costComputed"] } as never);
    expect(key[0]).toBe("metrics");
    expect(key[0]).toBe(qk.prefixes.metrics[0]);
  });
});

describe("qk.sessions", () => {
  it("lives under qk.prefixes.sessions", () => {
    const key = qk.sessions({ sort: "lastAt", limit: 25 });
    // Path starts with the sessions prefix — queryClient.invalidateQueries
    // ({queryKey: qk.prefixes.sessions}) matches this.
    expect(key[0]).toBe("sessions");
    expect(key[0]).toBe(qk.prefixes.sessions[0]);
  });

  it("defaults to an empty params object when no argument is passed", () => {
    expect(qk.sessions()).toEqual(["sessions", {}]);
  });

  it("is hash-stable for stable params (same params object → hash-equal key)", async () => {
    // TanStack Query's hashKey sorts object keys, so the same params
    // object — even passed through `qk.sessions(...)` twice — produces a
    // structurally-equal key the cache treats as one slot. We don't want
    // "two distinct array references" to mean "two queries"; we want them
    // to be cache-equivalent.
    const params = { sort: "costComputed" as const, limit: 10 };

    const keyA = qk.sessions(params);
    const keyB = qk.sessions(params);

    expect(keyA).toEqual(keyB);
    // Inner param identity preserved (same reference returned).
    expect(keyA[1]).toBe(keyB[1]);
  });

  it("produces distinct keys for distinct params — sort", () => {
    expect(qk.sessions({ sort: "lastAt" })).not.toEqual(qk.sessions({ sort: "costComputed" }));
  });

  it("produces distinct keys for distinct params — from", () => {
    expect(qk.sessions({ from: "2026-07-01" })).not.toEqual(qk.sessions({ from: "2026-07-02" }));
  });

  it("produces distinct keys for distinct params — project list", () => {
    expect(qk.sessions({ project: ["alpha"] })).not.toEqual(qk.sessions({ project: ["beta"] }));
  });

  it("includes the include=trace flag in the key", () => {
    expect(qk.sessions({ include: "trace" })).toEqual(["sessions", { include: "trace" }]);
    expect(qk.sessions({ include: "trace" })).not.toEqual(qk.sessions());
  });
});

describe("qk.prefixes", () => {
  it("exposes static prefix arrays for invalidation", () => {
    expect(qk.prefixes.metrics).toEqual(["metrics"]);
    expect(qk.prefixes.sessions).toEqual(["sessions"]);
    expect(qk.prefixes.session).toEqual(["session"]);
  });
});

describe("qk.session", () => {
  it("returns the canonical per-id detail key", () => {
    expect(qk.session("abc")).toEqual(["session", "abc"]);
  });

  it("lives under qk.prefixes.session (invalidation prefix match)", () => {
    const key = qk.session("xyz");
    expect(key[0]).toBe(qk.prefixes.session[0]);
  });

  it("is exact-match keyed — distinct IDs produce distinct keys", () => {
    expect(qk.session("a")).not.toEqual(qk.session("b"));
  });
});
