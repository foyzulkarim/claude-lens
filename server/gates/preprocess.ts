import type { ApiCall, Turn } from "../../shared/types.js";

/**
 * Gates engine shared preprocessing (gates.md §"Shared preprocessing").
 *
 * Every gate in this set operates on the **main thread only** — sub-agent
 * behavior (`isSidechain: true`) is the Agent tool's prompting habit, not
 * the user's. `partitionCacheStreams` (server/cache/classifier.ts) already
 * partitions by stream; this module flattens that contract to "main only"
 * so downstream gates never have to filter themselves.
 *
 * The preprocess pass also materializes a `mainTurnNByMessageId` index
 * (call.messageId → 1-indexed main turn number) once, so turn-keyed
 * gates (C3, K2) don't each rebuild their own copy — review
 * nice-to-have "duplicated turnNByMessageId map".
 *
 * The preprocess pass is intentionally minimal — gates own their own
 * per-gate normalization (Bash command whitespace collapse for V2,
 * `@`-mention matching for P3, etc.) so each gate's logic stays
 * self-contained and unit-testable in isolation.
 */

export interface PreprocessedSession {
  /** Main-chain calls only, in source order (already chronological per parse-transcript). */
  mainCalls: ApiCall[];
  /** Main-chain turns only, in source order. Sidechain turns are dropped wholesale. */
  mainTurns: Turn[];
  /** Sidechain calls explicitly excluded — used by C3 for "remaining API calls in session" (ARCH A7). */
  sidechainCalls: ApiCall[];
  /** Sidechain turns explicitly excluded — available for the engine's future diagnostics, not used by gates today. */
  sidechainTurns: Turn[];
  /** call.messageId → 1-indexed main turn number. Built once here; consumed by C3 and K2. */
  mainTurnNByMessageId: ReadonlyMap<string, number>;
}

/**
 * Partition calls and turns into main vs. sidechain sets. Drops nothing —
 * both buckets are returned so the engine can compute "remaining API calls
 * in session" (C3, ARCH A7) including sidechain, while each gate sees only
 * main. Deterministic: input order is preserved within each bucket so
 * downstream gates can iterate without re-sorting.
 */
export function preprocess(calls: ApiCall[], turns: Turn[]): PreprocessedSession {
  const mainCalls: ApiCall[] = [];
  const sidechainCalls: ApiCall[] = [];
  for (const call of calls) {
    if (call.isSidechain) sidechainCalls.push(call);
    else mainCalls.push(call);
  }

  const mainTurns: Turn[] = [];
  const sidechainTurns: Turn[] = [];
  for (const turn of turns) {
    if (turn.isSidechain) sidechainTurns.push(turn);
    else mainTurns.push(turn);
  }

  // Materialize call.messageId → 1-indexed main turn number in a single
  // sweep. Gates consume this read-only; mutating it inside a gate would
  // defeat the "build once" optimization.
  const mainTurnNByMessageId = new Map<string, number>();
  for (let i = 0; i < mainTurns.length; i++) {
    const turn = mainTurns[i];
    if (!turn) continue;
    const turnN = i + 1;
    for (const call of turn.calls) {
      mainTurnNByMessageId.set(call.messageId, turnN);
    }
  }

  return {
    mainCalls,
    mainTurns,
    sidechainCalls,
    sidechainTurns,
    mainTurnNByMessageId,
  };
}
