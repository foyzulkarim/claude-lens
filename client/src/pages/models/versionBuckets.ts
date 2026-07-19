/**
 * Buckets raw CC semver versions into presentation labels (e.g.
 * `"3.18.2"` → `"v3.18.x"`) for the Models page's Before/After CC update
 * compare panel.
 *
 * Versions are session metadata — the parser stores whatever CC writes.
 * Presentation-level grouping (which versions count as "the same release
 * line") is a UI concern, so this helper lives on the client and the
 * metrics contract stays untouched.
 *
 * Bucket rule: take `major.minor`, drop `patch` and any pre-release
 * suffix, prefix with `"v"`, suffix with `".x"`. Empty / missing input
 * buckets to `"unknown"` to match `orUnknown` semantics in
 * `server/metrics/dimensions.ts` so the page never renders an empty
 * group label.
 */

/** `v3.18.x` etc. The literal string `"unknown"` is reserved for missing
 * values and must never collide with a real version label. */
export const VERSION_BUCKET_UNKNOWN = "unknown";

const VERSION_BUCKET_RE = /^(\d+)\.(\d+)\.\d+(?:[-+].*)?$/;

export function versionBucket(rawVersion: string | null | undefined): string {
  if (rawVersion === null || rawVersion === undefined || rawVersion.length === 0) {
    return VERSION_BUCKET_UNKNOWN;
  }
  const match = VERSION_BUCKET_RE.exec(rawVersion);
  if (!match) return VERSION_BUCKET_UNKNOWN;
  return `v${match[1]}.${match[2]}.x`;
}

/**
 * Groups an iterable of raw versions into one entry per bucket, summing a
 * caller-supplied measure per group. Used by the Before/After panel to
 * reduce a `Series[]` keyed on raw `version` into presentation buckets
 * without re-querying the server.
 *
 * `combine` is called only after the first hit in each bucket — the
 * implementation short-circuits on the `existing === undefined` branch
 * so callers' combine functions can assume both arguments are defined.
 */
export function bucketVersions<V extends string, M>(
  values: Iterable<V>,
  measure: (rawVersion: V) => M,
  combine: (existing: M, next: M) => M,
): Map<string, M> {
  const out = new Map<string, M>();
  for (const raw of values) {
    const bucket = versionBucket(raw);
    const existing = out.get(bucket);
    out.set(bucket, existing === undefined ? measure(raw) : combine(existing, measure(raw)));
  }
  return out;
}
