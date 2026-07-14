import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bucketLabel, bucketStart, enumerateBuckets } from "./grain.js";

describe("bucketStart — truncation", () => {
  it("truncates to start of local hour", () => {
    const ms = new Date(2026, 6, 14, 15, 42, 30, 123).getTime();
    expect(bucketStart(ms, "hour")).toBe(new Date(2026, 6, 14, 15, 0, 0, 0).getTime());
  });

  it("truncates to local midnight for day grain", () => {
    const ms = new Date(2026, 6, 14, 15, 42, 30, 123).getTime();
    expect(bucketStart(ms, "day")).toBe(new Date(2026, 6, 14, 0, 0, 0, 0).getTime());
  });

  it("truncates to most-recent local Monday midnight for week grain", () => {
    // 2026-07-14 is a Tuesday; most recent Monday is 2026-07-13.
    const tuesday = new Date(2026, 6, 14, 15, 0, 0).getTime();
    expect(bucketStart(tuesday, "week")).toBe(new Date(2026, 6, 13, 0, 0, 0, 0).getTime());

    // Sunday should roll back to the Monday six days earlier.
    const sunday = new Date(2026, 6, 19, 10, 0, 0).getTime();
    expect(bucketStart(sunday, "week")).toBe(new Date(2026, 6, 13, 0, 0, 0, 0).getTime());

    // Monday itself stays put.
    const monday = new Date(2026, 6, 13, 23, 59, 0).getTime();
    expect(bucketStart(monday, "week")).toBe(new Date(2026, 6, 13, 0, 0, 0, 0).getTime());
  });

  it("truncates to first of local month for month grain", () => {
    const ms = new Date(2026, 6, 14, 15, 0, 0).getTime();
    expect(bucketStart(ms, "month")).toBe(new Date(2026, 6, 1, 0, 0, 0, 0).getTime());
  });
});

describe("bucketLabel — distinct, human-readable per grain", () => {
  it("produces a distinct label shape for each grain", () => {
    const hourMs = new Date(2026, 6, 14, 15, 0, 0).getTime();
    const dayMs = new Date(2026, 6, 14, 0, 0, 0).getTime();
    const weekMs = new Date(2026, 6, 13, 0, 0, 0).getTime();
    const monthMs = new Date(2026, 6, 1, 0, 0, 0).getTime();

    const hourLabel = bucketLabel(hourMs, "hour");
    const dayLabel = bucketLabel(dayMs, "day");
    const weekLabel = bucketLabel(weekMs, "week");
    const monthLabel = bucketLabel(monthMs, "month");

    expect(hourLabel).toMatch(/15/);
    expect(dayLabel).toMatch(/2026/);
    expect(weekLabel).toMatch(/2026/);
    expect(monthLabel).toMatch(/2026/);

    // Week and day must not collapse to the same string for a same-day input.
    expect(weekLabel).not.toBe(dayLabel);
    // Month label should not carry a day-of-month component.
    expect(monthLabel).not.toMatch(/\b1\b/);

    const labels = new Set([hourLabel, dayLabel, weekLabel, monthLabel]);
    expect(labels.size).toBe(4);
  });
});

describe("enumerateBuckets — dense, gap-free", () => {
  it("enumerates every hour bucket in a range with no gaps or duplicates", () => {
    const range = {
      from: new Date(2026, 6, 14, 10, 15, 0).toISOString(),
      to: new Date(2026, 6, 14, 13, 45, 0).toISOString(),
    };
    const buckets = enumerateBuckets(range, "hour");
    expect(buckets).toEqual([
      new Date(2026, 6, 14, 10, 0, 0).getTime(),
      new Date(2026, 6, 14, 11, 0, 0).getTime(),
      new Date(2026, 6, 14, 12, 0, 0).getTime(),
      new Date(2026, 6, 14, 13, 0, 0).getTime(),
    ]);
  });

  it("a single-instant range produces exactly one bucket", () => {
    const instant = new Date(2026, 6, 14, 10, 15, 0).toISOString();
    const buckets = enumerateBuckets({ from: instant, to: instant }, "day");
    expect(buckets).toEqual([new Date(2026, 6, 14, 0, 0, 0).getTime()]);
  });

  it("includes the bucket containing range.to when `to` lands exactly on a bucket boundary", () => {
    const range = {
      from: new Date(2026, 6, 14, 0, 0, 0).toISOString(),
      to: new Date(2026, 6, 16, 0, 0, 0).toISOString(),
    };
    const buckets = enumerateBuckets(range, "day");
    expect(buckets).toEqual([
      new Date(2026, 6, 14, 0, 0, 0).getTime(),
      new Date(2026, 6, 15, 0, 0, 0).getTime(),
      new Date(2026, 6, 16, 0, 0, 0).getTime(),
    ]);
  });

  it("steps correctly across a variable-length month boundary (Jan 31 -> Feb -> Mar)", () => {
    const range = {
      from: new Date(2026, 0, 31, 0, 0, 0).toISOString(),
      to: new Date(2026, 2, 1, 0, 0, 0).toISOString(),
    };
    const buckets = enumerateBuckets(range, "month");
    expect(buckets).toEqual([
      new Date(2026, 0, 1, 0, 0, 0).getTime(),
      new Date(2026, 1, 1, 0, 0, 0).getTime(),
      new Date(2026, 2, 1, 0, 0, 0).getTime(),
    ]);
  });
});

describe("resilience — DST transition", () => {
  const originalTz = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = "America/New_York";
  });

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("a 23-hour DST spring-forward day still buckets as a single day", () => {
    // 2026-03-08 is the US spring-forward date in America/New_York (2am -> 3am).
    const beforeTransition = new Date(2026, 2, 8, 1, 0, 0).getTime();
    const afterTransition = new Date(2026, 2, 8, 20, 0, 0).getTime();

    expect(bucketStart(beforeTransition, "day")).toBe(new Date(2026, 2, 8, 0, 0, 0).getTime());
    expect(bucketStart(afterTransition, "day")).toBe(new Date(2026, 2, 8, 0, 0, 0).getTime());

    const buckets = enumerateBuckets(
      {
        from: new Date(2026, 2, 7, 12, 0, 0).toISOString(),
        to: new Date(2026, 2, 9, 12, 0, 0).toISOString(),
      },
      "day",
    );
    expect(buckets).toEqual([
      new Date(2026, 2, 7, 0, 0, 0).getTime(),
      new Date(2026, 2, 8, 0, 0, 0).getTime(),
      new Date(2026, 2, 9, 0, 0, 0).getTime(),
    ]);
  });
});
