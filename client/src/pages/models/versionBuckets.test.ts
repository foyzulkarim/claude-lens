import { describe, expect, it } from "vitest";
import { VERSION_BUCKET_UNKNOWN, bucketVersions, versionBucket } from "./versionBuckets.js";

describe("versionBucket", () => {
  it("buckets a clean semver to major.minor.x", () => {
    expect(versionBucket("3.18.2")).toBe("v3.18.x");
    expect(versionBucket("3.18.0")).toBe("v3.18.x");
    expect(versionBucket("1.0.50")).toBe("v1.0.x");
  });

  it("strips pre-release / build suffixes before bucketing", () => {
    expect(versionBucket("3.18.2-rc.1")).toBe("v3.18.x");
    expect(versionBucket("3.18.0-beta+build.7")).toBe("v3.18.x");
  });

  it("returns 'unknown' for empty / missing input", () => {
    expect(versionBucket("")).toBe(VERSION_BUCKET_UNKNOWN);
    expect(versionBucket(null)).toBe(VERSION_BUCKET_UNKNOWN);
    expect(versionBucket(undefined)).toBe(VERSION_BUCKET_UNKNOWN);
  });

  it("returns 'unknown' for unparseable input rather than throwing", () => {
    expect(versionBucket("not-a-version")).toBe(VERSION_BUCKET_UNKNOWN);
    expect(versionBucket("3")).toBe(VERSION_BUCKET_UNKNOWN);
    expect(versionBucket("3.18")).toBe(VERSION_BUCKET_UNKNOWN);
  });

  it("preserves the literal 'unknown' constant", () => {
    expect(VERSION_BUCKET_UNKNOWN).toBe("unknown");
  });
});

describe("bucketVersions", () => {
  it("groups raw versions into presentation buckets and combines measures", () => {
    const totals = bucketVersions(
      ["3.18.0", "3.18.5", "3.17.9"],
      () => 1,
      (existing, next) => existing + next,
    );
    expect(totals.get("v3.18.x")).toBe(2);
    expect(totals.get("v3.17.x")).toBe(1);
    expect(totals.size).toBe(2);
  });

  it("buckets unknown and empty inputs together under 'unknown'", () => {
    const totals = bucketVersions(
      ["", "not-a-version", null, undefined] as unknown as string[],
      () => 1,
      (existing, next) => existing + next,
    );
    expect(totals.get("unknown")).toBe(4);
  });

  it("uses the combine fn semantics for the first hit (no existing value)", () => {
    const totals = bucketVersions(
      ["3.18.0"],
      () => 42,
      () => {
        throw new Error("combine should not be called for the first hit");
      },
    );
    expect(totals.get("v3.18.x")).toBe(42);
  });

  it("returns an empty Map when input is empty", () => {
    expect(
      bucketVersions(
        [],
        () => 0,
        () => 0,
      ).size,
    ).toBe(0);
  });
});
