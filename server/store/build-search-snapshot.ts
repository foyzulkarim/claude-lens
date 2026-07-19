/**
 * Pure, Store-independent builder for the `/api/search-index` payload
 * (#P4-3, ARCH §D2 — server/store/build-search-snapshot.ts).
 *
 * Mirrors the `server/cache/analysis.ts` convention: plain arrays in,
 * plain objects out. The route (`server/routes/search.ts`) iterates the
 * live `Store` once to gather per-session prompts/turns, hands the bundle
 * here, and ships the JSON. Unit-testable end-to-end without a Store.
 *
 * Sorting is `(timestamp ASC, sessionId ASC, promptId ASC)` so the wire
 * payload is deterministic across rebuilds — important for ETag-style
 * cache validation if the server ever adds one, and for snapshot tests
 * that compare payloads byte-for-byte.
 *
 * `turnNumber` resolution: a prompt that doesn't resolve to a turn (a
 * trailing user line with no subsequent assistant call) gets
 * `turns.length + 1`, so the deep-link still lands on the next panel.
 * This is the "honest trailing-edge" behavior — never fabricate a turn
 * the session didn't produce, never silently drop a prompt.
 */

import type { PromptSearchDoc, SearchIndexResponse } from "../../shared/search-index-contract.js";
import type { PromptTextRecord } from "../ingest/parse-transcript.js";
import type { Turn } from "../../shared/types.js";

export interface SearchSnapshotSessionInput {
  sessionId: string;
  cwd?: string;
  gitBranch?: string;
  prompts: PromptTextRecord[];
  turns: Turn[];
}

export interface SearchSnapshotInput {
  sessions: SearchSnapshotSessionInput[];
}

/**
 * Builds a `{ prompts, version }` snapshot from per-session input.
 * `version` is a monotonic counter seeded at 1; callers that maintain
 * a long-lived process can pass a higher seed to skip ahead — currently
 * unused, reserved for incremental updates.
 */
export function buildSearchSnapshot(
  input: SearchSnapshotInput,
  options: { version?: number } = {},
): SearchIndexResponse {
  const docs: PromptSearchDoc[] = [];
  for (const session of input.sessions) {
    const turnByPrompt = new Map<string, number>();
    session.turns.forEach((turn, idx) => {
      // 1-based turn number; first turn in `turns[]` is 1.
      turnByPrompt.set(turn.promptId, idx + 1);
    });
    const fallbackTurn = session.turns.length + 1;

    for (const prompt of session.prompts) {
      const id = `${prompt.sessionId}:${prompt.promptId}`;
      docs.push({
        id,
        sessionId: prompt.sessionId,
        promptId: prompt.promptId,
        turnNumber: turnByPrompt.get(prompt.promptId) ?? fallbackTurn,
        text: prompt.text,
        timestamp: prompt.timestamp,
        // Prefer session-level cwd/branch when the prompt doesn't carry its own.
        // (Today the parser doesn't carry cwd/branch on PromptTextRecord — the
        // session-level values are the authoritative context, matching what
        // Session Detail renders.)
        ...(session.cwd !== undefined ? { cwd: session.cwd } : {}),
        ...(session.gitBranch !== undefined ? { gitBranch: session.gitBranch } : {}),
      });
    }
  }

  // Stable sort: timestamp first, then sessionId, then promptId — ensures
  // identical inputs across calls produce identical payloads (snapshot-test
  // friendly).
  docs.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
    if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? -1 : 1;
    return a.promptId < b.promptId ? -1 : a.promptId > b.promptId ? 1 : 0;
  });

  return { prompts: docs, version: options.version ?? 1 };
}
