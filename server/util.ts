/** Shared narrow-unknown-to-object guard used across parsing/persistence code. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Pulls a single field out of an unknown request body, safely. Returns
 * `undefined` when the body is not an object or the field is absent — the
 * "safe-by-default" half of the pattern, paired with a `typeof`-check
 * downstream. Used by every mutating route that reads one field off
 * `request.body` (tags rename, session tag PUT, etc.) so the
 * `body === "object" && body !== null && "X" in body` boilerplate lives
 * in exactly one place (review #19).
 */
export function extractField(body: unknown, key: string): unknown {
  if (!isRecord(body)) return undefined;
  return key in body ? body[key] : undefined;
}
