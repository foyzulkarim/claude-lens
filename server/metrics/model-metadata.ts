/**
 * Model context-window catalog and resolver.
 *
 * Context: used by T4's derive-session to compute the optional `contextPctEstimated`
 * field on the Dashboard page (#P4-2, #P4-4).
 *
 * Token values are placeholder (200 000) and should be verified against the
 * official Anthropic model reference before production use.
 *
 * Model names must match `shared/types.ts` / `DEFAULT_PRICING_TABLE` exactly.
 * Note: the spec (#P4-2) references `claude-haiku-4-5-20251001` as the key;
 * `DEFAULT_PRICING_TABLE` uses `claude-haiku-4-5`. Both are kept in sync
 * with their respective sources so consumers get the correct resolution path.
 */

/** Default context window catalog: model name → max context window in tokens. */
export const DEFAULT_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-sonnet-5": 200_000,
  "claude-fable-5": 200_000,
  "claude-opus-4-8": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
};

/**
 * Resolves the context window for a given model.
 *
 * @param model        - The exact model name string to look up.
 * @param catalog      - A model-name → token-count map.  Defaults to
 *                      `DEFAULT_CONTEXT_WINDOWS`.
 * @returns            - The context window in tokens, or `null` if the model
 *                      is not in the catalog or the catalog is empty.
 */
export function resolveContextWindow(
  model: string,
  catalog: Record<string, number> = DEFAULT_CONTEXT_WINDOWS,
): number | null {
  // Guard: empty catalog must return null, not 0 (Object.values would return [])
  if (Object.keys(catalog).length === 0) return null;
  return catalog[model] ?? null;
}
