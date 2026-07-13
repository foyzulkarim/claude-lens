import type { ApiCall, Session, Turn } from "../../shared/types.js";
import type { WsServerMessage } from "../../shared/ws-protocol.js";
import type {
  ParseTranscriptResult,
  PromptTextRecord,
  ToolResultBytesRecord,
} from "../ingest/parse-transcript.js";
import { deriveSession, type Pricer, type SessionSidecarFlags } from "./derive-session.js";
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
  sidecars: SessionSidecarFlags;
  turns: Turn[];
  session: Session | null;
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
}

export class Store {
  private readonly sessions = new Map<string, SessionState>();
  private readonly invalidator: Invalidator;
  private readonly pricer: Pricer | undefined;

  constructor(options: StoreOptions) {
    this.pricer = options.pricer;
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

  private stateFor(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        calls: [],
        prompts: [],
        toolResultBytes: [],
        sidecars: emptySidecars(),
        turns: [],
        session: null,
      };
      this.sessions.set(sessionId, state);
      this.invalidator.markAdded(sessionId);
    }
    return state;
  }

  /** Append one tailer batch's parsed records for the given session. Only that session is marked dirty. */
  applyRecords(sessionId: string, result: ParseTranscriptResult): void {
    const state = this.stateFor(sessionId);
    state.calls.push(...result.calls);
    state.prompts.push(...result.prompts);
    state.toolResultBytes.push(...result.toolResultBytes);
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
    state.session = deriveSession(sessionId, state.calls, state.turns, state.sidecars, this.pricer);
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
