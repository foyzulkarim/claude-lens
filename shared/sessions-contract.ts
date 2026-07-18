/**
 * Sessions-list wire contract. Defines the query vocabulary, list item shape,
 * and response metadata for the dashboard sessions API.
 */

import type { TierFlags } from "./types.js";

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

export interface SessionListParams {
  sort?: "lastAt" | "costComputed" | "durationMs" | "cacheSavingsComputed" | "maxTurnCostComputed";
  order?: "asc" | "desc";
  offset?: number;
  limit?: number;
  from?: string; // ISO date
  to?: string;
  project?: string[];
  model?: string[];
  branch?: string[];
  host?: string[];
  include?: "trace";
}

// ---------------------------------------------------------------------------
// List item
// ---------------------------------------------------------------------------

export interface TracePoint {
  turnIndex: number;
  cost: number;
  timestamp: string;
}

export interface SessionListItem {
  sessionId: string;
  startedAt: string;
  lastAt: string;
  project: string;
  model: string;
  branch?: string;
  host?: string;
  durationMs: number;
  turnCount: number;
  costComputed: number;
  cacheSavingsComputed?: number;
  maxTurnCostComputed?: number;
  contextPctEstimated?: number;
  /** Opt-in: cumulative priced turn values. Present only when include=trace. */
  trace?: TracePoint[];
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export interface SessionListMeta {
  matchedExtent: { from: string; to: string } | null;
  globalCapture: TierFlags;
}

export interface SessionListResponse {
  items: SessionListItem[];
  total: number;
  meta: SessionListMeta;
}
