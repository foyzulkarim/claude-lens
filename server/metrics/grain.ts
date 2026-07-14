import type { Grain } from "../../shared/metrics-contract.js";

// No date library (architecture §2 — server-side date libs are a rejected
// dependency): bucket on epoch ms via native local-timezone Date getters,
// label via Intl. Local system timezone and Monday-start weeks are ARCH's
// flagged defaults, not confirmed requirements — isolated to this file if
// they need correcting later.

function startOfDay(epochMs: number): Date {
  const d = new Date(epochMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function bucketStart(epochMs: number, grain: Grain): number {
  const d = new Date(epochMs);
  switch (grain) {
    case "hour":
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
    case "day":
      return startOfDay(epochMs).getTime();
    case "week": {
      const day = startOfDay(epochMs);
      const dayOfWeek = day.getDay(); // 0=Sun..6=Sat
      const diffToMonday = (dayOfWeek + 6) % 7; // Mon=0..Sun=6
      day.setDate(day.getDate() - diffToMonday);
      return day.getTime();
    }
    case "month":
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }
}

// Per-case return (not break + a shared trailing return) so a future Grain
// addition fails to compile here instead of silently no-op'ing and hanging
// enumerateBuckets's while loop at runtime (review finding M5).
function nextBucket(bucketStartMs: number, grain: Grain): number {
  const d = new Date(bucketStartMs);
  switch (grain) {
    case "hour":
      d.setHours(d.getHours() + 1);
      return d.getTime();
    case "day":
      d.setDate(d.getDate() + 1);
      return d.getTime();
    case "week":
      d.setDate(d.getDate() + 7);
      return d.getTime();
    case "month":
      d.setMonth(d.getMonth() + 1);
      return d.getTime();
  }
}

const HOUR_LABEL_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const DAY_LABEL_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
});
const MONTH_LABEL_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
});

export function bucketLabel(epochMs: number, grain: Grain): string {
  const d = new Date(epochMs);
  switch (grain) {
    case "hour":
      return HOUR_LABEL_FORMAT.format(d);
    case "day":
      return DAY_LABEL_FORMAT.format(d);
    case "week":
      return `Week of ${DAY_LABEL_FORMAT.format(d)}`;
    case "month":
      return MONTH_LABEL_FORMAT.format(d);
  }
}

/**
 * Every bucket start in [range.from, range.to], ascending, inclusive of the
 * bucket containing range.to. Dense by construction — independent of
 * whether any data exists in a given bucket, so callers get gap-free output.
 */
export function enumerateBuckets(range: { from: string; to: string }, grain: Grain): number[] {
  const fromMs = Date.parse(range.from);
  const toMs = Date.parse(range.to);
  const lastBucket = bucketStart(toMs, grain);

  const buckets: number[] = [];
  let cursor = bucketStart(fromMs, grain);
  while (cursor <= lastBucket) {
    buckets.push(cursor);
    cursor = nextBucket(cursor, grain);
  }
  return buckets;
}
