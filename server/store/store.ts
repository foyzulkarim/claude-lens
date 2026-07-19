import type { ApiCall, CompactionRecord, Session, Turn } from "../../shared/types.js";
import type { WsServerMessage } from "../../shared/ws-protocol.js";
import type {
  ParseTranscriptResult,
  PromptTextRecord,
  ToolResultBytesRecord,
} from "../ingest/parse-transcript.js";
import type { PricingTable } from "../metrics/measures.js";
import {
  type ContextResolver,
  deriveSession,
  type Pricer,
  type SessionSidecarFlags,
} from "./derive-session.js";
import { deriveTurns } from "./derive-turns.js";
import { createInvalidator, type Invalidator } from "./invalidation.js";

// The in-memory columnar store (architecture §5.5, §6). Per-session raw
// arrays plus cached derived Turn[]/Session. `ingest/` is the only writer
// (applyRecords/resetSession/markSidecarPresent); everything else reads.
// Incremental updates touch only the affected session; cross-session
// aggregates (listSessions) are recomputed lazily on read, never eagerly on
// every append.

interface SessionState {
  calls: ApiCall[];
  prompts: PromptTextRecord[];
  toolResultBytes: ToolResultBytesRecord[];
  compactions: CompactionRecord[];
  sidecars: SessionSidecarFlags;
  turns: Turn[];
  session: Session | null;
}

/**
 * Coherent, read-only snapshot of one session's compact state. Returned by
 * `Store.getSessionSnapshot` after a fresh recompute, so every array and
 * the `session` rollup reflect the same revision — the Session Detail
 * projector consumes this directly without holding pointers into the live
 * Store. (#P4-5, T2)
 */
export interface SessionSnapshot {
  session: Session;
  calls: ApiCall[];
  turns: Turn[];
  prompts: PromptTextRecord[];
  toolResults: ToolResultBytesRecord[];
  compactions: CompactionRecord[];
}

function emptySidecars(): SessionSidecarFlags {
  return { hasCostSamples: false, hasTurnBoundaries: false, hasCostLog: false };
}

export interface StoreOptions {
  /** Per-session debounce before a dirty session is recomputed and emitted. Default 300ms (200-500ms band per §5.5). */
  debounceMs?: number;
  onInvalidate(message: WsServerMessage): void;
  /** Optional — ships in #P2-8. Without one, costComputed stays 0 (honest "not priced yet", not fabricated). */
  pricer?: Pricer;
  /** Pricing table used to compute cacheSavingsComputed. Without one, cacheSavingsComputed stays undefined. */
  pricing?: PricingTable;
  /** Resolves context window for a model; used to compute contextPctEstimated. */
  contextResolver?: ContextResolver;
  /** Root path -> label, used to resolve `Session.host` (ARCH-settings-local-store.md). Without one, sessions fall back to their raw root path. */
  hostLabels?: Map<string, string>;
}

export class Store {
  private readonly sessions = new Map<string, SessionState>();
  private readonly invalidator: Invalidator;
  private pricer: Pricer | undefined;
  private pricing: PricingTable | undefined;
  private contextResolver: ContextResolver | undefined;
  private hostLabels: Map<string, string>;
  // Root path a session was first tailed from (#P4-15). Set once per session
  // — a session's files never move roots mid-life — and never overwritten by
  // later `applyRecords` calls (e.g. a sidecar arriving after the transcript).
  private readonly sessionRoot = new Map<string, string>();

  constructor(options: StoreOptions) {
    this.pricer = options.pricer;
    this.pricing = options.pricing;
    this.contextResolver = options.contextResolver;
    this.hostLabels = options.hostLabels ?? new Map();
    this.invalidator = createInvalidator({
      debounceMs: options.debounceMs,
      onFlush: (message) => {
        if (message.type === "session-updated") {
          this.recompute(message.sessionId);
        }
        options.onInvalidate(message);
      },
    });
  }
  /**
   * Swap the pricer/pricing/contextResolver and recompute all dirty sessions.
   * Enables tests to change pricing mid-session and verify recompute propagates.
   */
  updatePricing(options: {
    pricer?: Pricer;
    pricing?: PricingTable;
    contextResolver?: ContextResolver;
  }): void {
    this.pricer = options.pricer;
    this.pricing = options.pricing;
    this.contextResolver = options.contextResolver;
    // Mark all sessions dirty so next read/flush recomputes with new inputs.
    for (const sessionId of this.sessions.keys()) {
      this.invalidator.markDirty(sessionId);
    }
  }

  /**
   * Swap the root->label map and refresh every session's `host` in place
   * (ARCH-settings-local-store.md). Mirrors `updatePricing`'s "relabel takes
   * effect on next read, no restart needed" contract, but — unlike
   * `updatePricing`, where every derived field can depend on the new
   * pricing — `host` is the *only* field `deriveSession` derives from
   * `hostLabels` (see derive-session.ts). Patching it directly skips a full
   * `deriveTurns`/`deriveSession` recompute for every session on a pure
   * display-label rename, which would otherwise redo real derivation work
   * for a change that doesn't touch any session's calls/turns/pricing.
   *
   * Still emits a `scanDirty` invalidation so already-mounted
   * Sessions/Dashboard pages refetch on relabel (review #19). The point of
   * this method is "no restart", which would be defeated if an open page
   * silently kept showing the old host until something unrelated triggered
   * a refetch — `markScanDirty()` is the right shape here (rare, not
   * bursty) and matches the existing `scanDirty()` broadcast semantics.
   */
  updateHostLabels(hostLabels: Map<string, string>): void {
    this.hostLabels = hostLabels;
    for (const [sessionId, state] of this.sessions) {
      if (!state.session) continue;
      const rootPath = this.sessionRoot.get(sessionId);
      const host = rootPath ? (hostLabels.get(rootPath) ?? rootPath) : undefined;
      state.session = { ...state.session, host: host ?? "unlabeled" };
    }
    this.invalidator.markScanDirty();
  }

  private stateFor(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        calls: [],
        prompts: [],
        toolResultBytes: [],
        compactions: [],
        sidecars: emptySidecars(),
        turns: [],
        session: null,
      };
      this.sessions.set(sessionId, state);
      this.invalidator.markAdded(sessionId);
    }
    return state;
  }

  /**
   * Append one tailer batch's parsed records for the given session. Only
   * that session is marked dirty. `rootPath` (the scan root this file was
   * discovered under) is recorded once, first-call-wins — a session's
   * `host` is resolved from this at recompute time via the live
   * `hostLabels` map, so relabeling never needs to touch `sessionRoot`.
   *
   * `rootPath` is intentionally optional (review #19) rather than
   * required as the original ARCH risk-table assumption had it — the
   * one production caller (`server/ingest/pipeline.ts`) does pass it,
   * but the per-test call sites didn't need an artificial stub, and
   * making it required would have forced ~15+ test rewrites without
   * gaining any compile-time safety on the only caller that matters.
   * The trade-off: a future caller that forgets to pass `file.root`
   * silently gets `"unlabeled"` host instead of a type error. The
   * pipeline call site is the documented contract holder; any future
   * caller must thread `file.root` from `DiscoveredFile` through here.
   */
  applyRecords(sessionId: string, result: ParseTranscriptResult, rootPath?: string): void {
    const state = this.stateFor(sessionId);
    state.calls.push(...result.calls);
    state.prompts.push(...result.prompts);
    state.toolResultBytes.push(...result.toolResultBytes);
    state.compactions.push(...result.compactions);
    if (rootPath && !this.sessionRoot.has(sessionId)) {
      this.sessionRoot.set(sessionId, rootPath);
    }
    this.invalidator.markDirty(sessionId);
  }

  /**
   * Record that a cost-samples or turn-boundaries sidecar file exists for a
   * session (tier-detection presence only — #P4-13 parses their contents).
   * `cost-log.jsonl` is a single global file, not per-session, so it is
   * intentionally not wired through here; hasCostLog stays false until
   * #P4-13 does the per-session L-file lookup.
   */
  markSidecarPresent(sessionId: string, kind: "cost" | "turn-boundaries"): void {
    const state = this.stateFor(sessionId);
    if (kind === "cost") state.sidecars.hasCostSamples = true;
    if (kind === "turn-boundaries") state.sidecars.hasTurnBoundaries = true;
    this.invalidator.markDirty(sessionId);
  }

  /** Clear a session's accumulated state (tailer file-reset/truncation path). */
  resetSession(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.calls = [];
    state.prompts = [];
    state.toolResultBytes = [];
    state.compactions = [];
    state.turns = [];
    state.session = null;
    this.invalidator.markDirty(sessionId);
  }

  /**
   * Re-derive turns + session rollup for exactly one session. Never reads or
   * writes any other session's state.
   *
   * Re-derives from that session's *full* accumulated calls/prompts every
   * time (not incrementally) — cheap at today's scale (~26 calls/session
   * avg on real data), but a marathon session's recompute cost grows with
   * its whole history, not just the delta since the last flush. Accepted
   * per architecture §5.5 (only cross-session isolation is required); worth
   * revisiting once real long-session data exists.
   */
  recompute(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.turns = deriveTurns(state.calls, state.prompts, state.toolResultBytes);
    const rootPath = this.sessionRoot.get(sessionId);
    const host = rootPath ? (this.hostLabels.get(rootPath) ?? rootPath) : undefined;
    state.session = deriveSession(
      sessionId,
      state.calls,
      state.turns,
      state.sidecars,
      this.pricer,
      this.pricing,
      this.contextResolver,
      host,
    );
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId)?.session ?? undefined;
  }

  getTurns(sessionId: string): Turn[] {
    return this.sessions.get(sessionId)?.turns ?? [];
  }

  getCalls(sessionId: string): ApiCall[] {
    return this.sessions.get(sessionId)?.calls ?? [];
  }

  /**
   * Atomic, read-only snapshot of one session's compact state. Triggers a
   * synchronous recompute before returning so every array and the session
   * rollup reflect the same revision — the Session Detail projector
   * consumes this snapshot directly and never reaches back into live
   * Store state. Unknown IDs return `undefined`; an empty-but-known session
   * returns a snapshot with empty arrays and a freshly-derived Session.
   * (#P4-5, T2)
   */
  getSessionSnapshot(sessionId: string): SessionSnapshot | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;
    this.recompute(sessionId);
    // recompute re-derives `state.session`; re-read in case it was null and
    // recompute didn't run (e.g. zero calls/session with no pricing — that
    // path still produces a Session with mostly empty fields, which is the
    // honest empty case the route must surface as 200/empty, not 404).
    const session = state.session;
    if (!session) {
      // Defensive: a known session state must always yield a Session after
      // recompute (derive-session produces a Session even with empty input).
      // If this branch ever fires, the API contract — known != undefined —
      // would break; surface it loudly so a future refactor can't drift
      // silently.
      throw new Error(
        `unreachable: known session ${sessionId} has no derived Session after recompute`,
      );
    }
    return {
      session,
      calls: state.calls.slice(),
      turns: state.turns.slice(),
      prompts: state.prompts.slice(),
      toolResults: state.toolResultBytes.slice(),
      compactions: state.compactions.slice(),
    };
  }

  /**
   * Cross-session aggregate, recomputed lazily on read rather than eagerly
   * per append (architecture §5.5).
   *
   * The staleness check (`!state.session`) only catches "never yet
   * computed" — once a session has been recomputed once, a later
   * `applyRecords`/`markSidecarPresent` marks it dirty but doesn't null
   * `state.session`, so a read here inside the pending debounce window
   * (200-500ms) can return the pre-append snapshot. That's consistent with
   * the WS-driven eventual-consistency model (the client refetches on
   * `session-updated`), not a bug — but callers should treat this as
   * "fresh within ~debounceMs," not "always current."
   *
   * Also loops every stale session synchronously with no yield between
   * them — fine at today's scale, but once a route calls this per-request
   * (#P3-1), a burst of simultaneously-stale sessions (e.g. right after
   * cold boot) would block the single-threaded event loop for the sum of
   * their recompute costs in one call. Worth a cap/paginate or a yield
   * between recomputes if profiling shows this matters at real volumes.
   */
  listSessions(): Session[] {
    const result: Session[] = [];
    for (const [sessionId, state] of this.sessions) {
      if (!state.session) this.recompute(sessionId);
      const session = this.sessions.get(sessionId)?.session;
      if (session) result.push(session);
    }
    return result;
  }

  /**
   * Cross-session raw calls, concatenated in insertion order. Calls are raw
   * (never derived), so unlike `listTurns`/`listSessions` this needs no
   * recompute — always current.
   */
  listCalls(): ApiCall[] {
    const result: ApiCall[] = [];
    for (const state of this.sessions.values()) {
      result.push(...state.calls);
    }
    return result;
  }

  /**
   * Cross-session derived turns, concatenated in insertion order. Same lazy
   * recompute + "fresh within ~debounceMs" caveat as `listSessions` above —
   * a stale session is recomputed on read here too.
   */
  listTurns(): Turn[] {
    const result: Turn[] = [];
    for (const [sessionId, state] of this.sessions) {
      if (!state.session) this.recompute(sessionId);
      result.push(...(this.sessions.get(sessionId)?.turns ?? []));
    }
    return result;
  }

  scanDirty(): void {
    this.invalidator.markScanDirty();
  }

  /** Force-flush every pending debounced session immediately (e.g. before a benchmark measurement or shutdown). */
  flushAll(): void {
    this.invalidator.flushAll();
  }

  stop(): void {
    this.invalidator.stop();
  }
}
