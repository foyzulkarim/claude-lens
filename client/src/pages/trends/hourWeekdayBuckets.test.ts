import { describe, expect, it } from "vitest";
import type { Series } from "../../../../shared/metrics-contract.js";
import { bucketHourWeekday } from "./hourWeekdayBuckets.js";

function series(points: Series["points"]): Series {
  return { measure: "costComputed", dimensionKey: "time", label: "Cost", points };
}

describe("bucketHourWeekday", () => {
  it("produces a dense 7x24 grid (168 cells) even from empty input", () => {
    expect(bucketHourWeekday([])).toHaveLength(7 * 24);
  });

  it("every cell defaults to 0 when no point lands there", () => {
    const cells = bucketHourWeekday([]);
    expect(cells.every((c) => c.value === 0)).toBe(true);
  });

  it("buckets a UTC Wednesday 14:00 point into weekday=2, hour=14", () => {
    // 2026-07-01 is a Wednesday (UTC).
    const cells = bucketHourWeekday([series([{ t: "2026-07-01T14:00:00.000Z", value: 10 }])]);
    const cell = cells.find((c) => c.weekday === 2 && c.hour === 14);
    expect(cell?.value).toBe(10);
  });

  it("Monday maps to weekday 0 and Sunday maps to weekday 6", () => {
    // 2026-06-29 is a Monday, 2026-07-05 is the following Sunday (UTC).
    const cells = bucketHourWeekday([
      series([
        { t: "2026-06-29T08:00:00.000Z", value: 3 },
        { t: "2026-07-05T08:00:00.000Z", value: 7 },
      ]),
    ]);
    expect(cells.find((c) => c.weekday === 0 && c.hour === 8)?.value).toBe(3);
    expect(cells.find((c) => c.weekday === 6 && c.hour === 8)?.value).toBe(7);
  });

  it("sums multiple points landing in the same (weekday, hour) cell", () => {
    const cells = bucketHourWeekday([
      series([
        { t: "2026-07-01T14:00:00.000Z", value: 10 },
        { t: "2026-07-08T14:00:00.000Z", value: 5 }, // also a Wednesday
      ]),
    ]);
    const cell = cells.find((c) => c.weekday === 2 && c.hour === 14);
    expect(cell?.value).toBe(15);
  });

  it("treats a null point value as 0 rather than dropping the cell", () => {
    const cells = bucketHourWeekday([series([{ t: "2026-07-01T14:00:00.000Z", value: null }])]);
    const cell = cells.find((c) => c.weekday === 2 && c.hour === 14);
    expect(cell?.value).toBe(0);
  });

  it("skips an unparseable timestamp instead of throwing", () => {
    expect(() => bucketHourWeekday([series([{ t: "not-a-date", value: 10 }])])).not.toThrow();
  });

  it("only reads the first series when multiple are passed", () => {
    const a = series([{ t: "2026-07-01T14:00:00.000Z", value: 10 }]);
    const b = series([{ t: "2026-07-01T15:00:00.000Z", value: 999 }]);
    const cells = bucketHourWeekday([a, b]);
    expect(cells.find((c) => c.weekday === 2 && c.hour === 15)?.value).toBe(0);
    expect(cells.find((c) => c.weekday === 2 && c.hour === 14)?.value).toBe(10);
  });
});
