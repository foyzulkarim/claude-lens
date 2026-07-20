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
 *
 * Duplicate-promptId disambiguation: real transcripts can carry the same
 * promptId twice in one session (a retried or multi-part user line).
 * MiniSearch requires unique doc ids, so we add an ordinal suffix to
 * repeats. The first occurrence keeps the plain `sessionId:promptId`
 * id so the common case is unaffected.
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
 *
 * Single-pass: docs are built with their final disambiguated id
 * (using a per-session `Map<promptId, occurrence>`) and the global
 * sort is applied once at the end. Avoids the two-pass shape of
 * mutating a provisional id after the array is already populated.
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

    // Per-session occurrence counter — keys are the canonical
    // `sessionId:promptId` so two sessions with the same promptId never
    // collide, and within one session each repeat gets a fresh suffix.
    const occurrences = new Map<string, number>();
    const sessionContext =
      session.cwd !== undefined || session.gitBranch !== undefined
        ? {
            ...(session.cwd !== undefined ? { cwd: session.cwd } : {}),
            ...(session.gitBranch !== undefined ? { gitBranch: session.gitBranch } : {}),
          }
        : null;

    for (const prompt of session.prompts) {
      const baseId = `${prompt.sessionId}:${prompt.promptId}`;
      const occurrence = occurrences.get(baseId) ?? 0;
      occurrences.set(baseId, occurrence + 1);
      const id = occurrence === 0 ? baseId : `${baseId}:${occurrence}`;

      const doc: PromptSearchDoc = {
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
        ...(sessionContext ?? {}),
      };
      docs.push(doc);
    }
  }

  // Stable sort: timestamp first, then sessionId, then promptId — ensures
  // identical inputs across calls produce identical payloads (snapshot-test
  // friendly). The dedupe pass is gone — disambiguation already happened
  // during the build pass.
  docs.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
    if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? -1 : 1;
    return a.promptId < b.promptId ? -1 : a.promptId > b.promptId ? 1 : 0;
  });

  return { prompts: docs, version: options.version ?? 1 };
}
