/**
 * Shared prompt-search fixtures (#P4-3). Mirrors the project's
 * `cacheLab.fixtures.ts` convention — one place for canonical
 * `SearchIndexResponse` shapes that both the test and the storybook
 * story consume, so the wire-shape contract has a single source of
 * truth for non-production callers.
 */

import type {
  PromptSearchDoc,
  SearchIndexResponse,
} from "../../../../shared/search-index-contract.js";

/** Build a single `PromptSearchDoc` with sensible defaults. */
export function makeDoc(overrides: Partial<PromptSearchDoc> = {}): PromptSearchDoc {
  return {
    id: "s1:p1",
    sessionId: "s1",
    promptId: "p1",
    turnNumber: 1,
    text: "default prompt",
    timestamp: "2026-07-15T10:00:00.000Z",
    cwd: "/Users/me/personal/claude-lens",
    gitBranch: "main",
    ...overrides,
  };
}

export const SAMPLE_INDEX: SearchIndexResponse = {
  prompts: [
    makeDoc({
      id: "s1:p1",
      sessionId: "s1",
      promptId: "p1",
      turnNumber: 1,
      text: "How do I budget my Claude Code usage across a 5-hour subscription window?",
      timestamp: "2026-07-15T10:00:00.000Z",
    }),
    makeDoc({
      id: "s1:p2",
      sessionId: "s1",
      promptId: "p2",
      turnNumber: 2,
      text: "Refactor the parser to handle partial trailing lines more carefully.",
      timestamp: "2026-07-15T10:05:00.000Z",
      gitBranch: "feat/search-index",
    }),
    makeDoc({
      id: "s2:p1",
      sessionId: "s2",
      promptId: "p1",
      turnNumber: 1,
      text: "Add a MiniSearch-backed full-text search across every user prompt.",
      timestamp: "2026-07-12T14:30:00.000Z",
      gitBranch: "feat/search-index",
    }),
  ],
  version: 1,
};

export const EMPTY_INDEX: SearchIndexResponse = { prompts: [], version: 1 };
