/**
 * Wire shape for `GET /api/version`. `server/version-check.ts` polls the
 * npm registry in the background and caches the result; this is the
 * read-only snapshot the route hands back on every request.
 *
 * `latestVersion` and `lastCheckedAt` are nullable rather than defaulting
 * to a sentinel: before the first successful registry check completes (or
 * if every check has failed, e.g. offline), there is no honest non-null
 * value to report — same "never substitute a fake value for unavailable
 * data" discipline as the tier system (architecture §4).
 */
export interface VersionSnapshot {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  lastCheckedAt: number | null;
}
