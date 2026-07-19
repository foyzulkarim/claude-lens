/** Shared narrow-unknown-to-object guard used across parsing/persistence code. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
