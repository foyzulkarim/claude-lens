import type { ApiCall, CompactionRecord, Session, Turn } from "../../shared/types.js";
import type { SearchIndexResponse } from "../../shared/search-index-contract.js";
import type { WsServerMessage } from "../../shared/ws-protocol.js";
import type {
  ParseTranscriptResult,
  PromptTextRecord,
  ToolResultBytesRecord,
} from "../ingest/parse-transcript.js";
import type { CostLogRow, CostSample, TurnBoundary } from "../ingest/parse-premium.js";
import type { PricingTable } from "../metrics/measures.js";
import {
  type ContextResolver,
  deriveSession,
  type Pricer,
  type SessionSidecarFlags,
} from "./derive-session.js";
import { deriveTurns } from "./derive-turns.js";
import { reconcilePremium } from "./reconcile-premium.js";
import { createInvalidator, type Invalidator } from "./invalidation.js";
import { buildSearchSnapshot } from "./build-search-snapshot.js";

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
  /**
   * Parsed premium capture-file content (#P4-13). Written whole (full-replace)
   * by the pipeline on each cost/turn-boundaries/cost-log file change, and
   * consumed by `reconcile-premium.ts` during recompute to produce observed
   * values. Empty/undefined until a matching sidecar is discovered; kept
   * independent of the transcript arrays so a transcript truncation
   * (`resetSession`) never wipes premium data (they are separate files with
   * their own change events).
   */
  costSamples: CostSample[];
  turnBoundaries: TurnBoundary[];
  /** This session's row from the global `cost-log.jsonl` (L), if present. */
  costLogRow?: CostLogRow;
  turns: Turn[];
  session: Session | null;
  /** Absolute path of this session's transcript `.jsonl` file, set by the
   * ingest pipeline when the file is first discovered (#P4-6). Used only by
   * the Turn Inspector transcript-peek route for an on-demand raw-file
   * read — never affects derived Session/Turn shape, so setting it never
   * marks the session dirty. */
  transcriptPath?: string;
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
  // Monotonic counter for `buildSearchSnapshot()` results (#P4-3). Bumps
  // on every call so the client can detect a stale index if/when the
  // server ships incremental updates.
  private searchSnapshotVersion = 0;
  // Sessions whose `applyRecords` appended at least one prompt since the
  // last debounced flush (#P4-3, ARCH A8). After the existing
  // `session-updated` fires, the onFlush hook below also emits a
  // `session-prompts-changed` for any session in this set, then clears
  // it. Bounded by the dirty-session set — never grows unboundedly.
  private readonly pendingPromptChanges = new Set<string>();

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
          // If this session's last debounce window appended prompts,
          // emit the prompt-specific invalidation after the
          // generic session-updated. The client can refetch the search
          // index only — not metrics/sessions/detail — saving a round-
          // trip on prompt-only mutations. ARCH A8: only when prompts
          // were actually appended during the window.
          if (this.pendingPromptChanges.delete(message.sessionId)) {
            options.onInvalidate({
              type: "session-prompts-changed",
              sessionId: message.sessionId,
            });
          }
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
        costSamples: [],
        turnBoundaries: [],
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
    // Mark this session for a prompt-specific invalidation iff prompts
    // were actually appended. Reset (`resetSession`) wipes prompts but
    // does NOT add to this set — truncations ride the existing
    // `session-updated` so the client re-fetches the index naturally;
    // we don't need a parallel "prompts-removed" message.
    if (result.prompts.length > 0) {
      this.pendingPromptChanges.add(sessionId);
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

  /**
   * Replace a session's parsed C (`<uuid>.cost.jsonl`) cost samples (#P4-13).
   * Full-replace, not append: premium files are small and the pipeline
   * re-reads the whole file on every change, so there is no offset/dedupe
   * bookkeeping (parse-premium.ts). Setting the samples also flips the
   * `hasCostSamples` tier flag — the file's presence is what tier detection
   * means, so an empty-but-present cost file still upgrades the session's
   * `costBasis` to observed (with a $0 observed total, the honest value).
   */
  applyCostSamples(sessionId: string, samples: CostSample[]): void {
    const state = this.stateFor(sessionId);
    state.costSamples = samples;
    state.sidecars.hasCostSamples = true;
    this.invalidator.markDirty(sessionId);
  }

  /** Replace a session's parsed B (`<uuid>.turn-boundaries.jsonl`) boundaries (#P4-13). Full-replace, mirrors `applyCostSamples`. */
  applyTurnBoundaries(sessionId: string, boundaries: TurnBoundary[]): void {
    const state = this.stateFor(sessionId);
    state.turnBoundaries = boundaries;
    state.sidecars.hasTurnBoundaries = true;
    this.invalidator.markDirty(sessionId);
  }

  /**
   * Route the parsed global `cost-log.jsonl` (L) rows to their sessions
   * (#P4-13). L has no file-level sessionId, so each row is fanned out by its
   * own `session_id`, creating session state for a session not yet seen via a
   * transcript (mirrors `markSidecarPresent`). The whole file re-parses on
   * every change, so a single L mutation re-fans across every referenced
   * session and marks each dirty — a recompute burst. L changes rarely (one
   * row per finished session), so this is accepted (#P4-13 R2); revisit only
   * if L files turn hot. Rows dropped from a later L revision leave a stale
   * `costLogRow` on their session (L is append-mostly, so not handled).
   */
  applyCostLog(rows: CostLogRow[]): void {
    for (const row of rows) {
      const state = this.stateFor(row.sessionId);
      state.costLogRow = row;
      state.sidecars.hasCostLog = true;
      this.invalidator.markDirty(row.sessionId);
    }
  }

  /**
   * Record the absolute path of a session's transcript file (#P4-6, Turn
   * Inspector's lazy transcript-peek route). Overwrites rather than
   * appends, so a rotated/replaced file's new path always wins. Does
   * **not** call `markDirty` — this is not derived-session metadata, and
   * marking it dirty would trigger a spurious recompute + WS broadcast
   * every time the poller's fast-stat loop re-touches the file.
   */
  setTranscriptPath(sessionId: string, path: string): void {
    const state = this.stateFor(sessionId);
    state.transcriptPath = path;
  }

  /** Absolute path of a session's transcript file, or `undefined` if the
   * session is unknown or no transcript file has been observed yet. */
  getTranscriptPath(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.transcriptPath;
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
    const turns = deriveTurns(state.calls, state.prompts, state.toolResultBytes);
    // Reconcile premium C/B/L content into observed annotations before
    // deriving the session (#P4-13). With no sidecar content this returns the
    // same arrays untouched (zero-cost transcript-only path); otherwise it
    // returns annotated copies of the calls/turns carrying observed fields.
    // We persist the annotated calls back onto state so fleet reads
    // (`listCalls` → metrics engine) see observed `apiMs`/`costObserved`/lines
    // too. Idempotent across recomputes: reconcile recomputes absolute values
    // from the raw samples each time, never incrementing.
    const reconciled = reconcilePremium(state.calls, turns, {
      costSamples: state.costSamples,
      turnBoundaries: state.turnBoundaries,
      costLogRow: state.costLogRow,
    });
    state.calls = reconciled.calls;
    state.turns = reconciled.turns;
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
      reconciled.session,
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

  /**
   * Build a snapshot of every session's prompts suitable for the client to
   * build a MiniSearch index from (#P4-3, ARCH-p4-3-search-index.md §A1).
   * Delegates the per-session work to the pure `buildSearchSnapshot` function
   * (mirrors the cache-lab analysis convention — Store does no aggregation
   * itself, only gathers state and hands off).
   *
   * Lazy-recomputes each dirty session before snapshotting so the
   * derived `turns[]` used to resolve `turnNumber` is always fresh.
   * Same caveat as `listSessions`/`listTurns`: a session mid-debounce
   * reflects its last fully-derived state, never a half-written append.
   *
   * `version` is a monotonic per-process counter that bumps on every call
   * — the wire shape carries it so a future incremental-update client can
   * detect "the server has a fresher snapshot than the one I have."
   *
   * Per-session error handling: a single corrupted session's
   * `recompute()` throwing (e.g. an `unreachable:` invariant in
   * `deriveTurns`/`deriveSession`) is logged and skipped — search
   * degrades to "missing that one session" rather than the whole
   * 500 that would break search across every other healthy session.
   */
  buildSearchSnapshot(): SearchIndexResponse {
    const sessions: Array<{
      sessionId: string;
      cwd?: string;
      gitBranch?: string;
      prompts: PromptTextRecord[];
      turns: Turn[];
    }> = [];
    for (const [sessionId, state] of this.sessions) {
      try {
        if (!state.session) this.recompute(sessionId);
        const reifiedState = this.sessions.get(sessionId);
        const session = reifiedState?.session ?? state.session;
        sessions.push({
          sessionId,
          cwd: session?.project, // session.project is the cwd path (derived)
          gitBranch: session?.gitBranch,
          prompts: state.prompts,
          turns: state.turns,
        });
      } catch (err) {
        // Single bad session must not take down the whole search index.
        // The next `session-updated` for this session will re-attempt
        // the snapshot — and a successful recompute will lift it back
        // into the response on the next request.
        // eslint-disable-next-line no-console
        console.warn(
          `[search-index] skipping session ${sessionId} due to error:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    const version = ++this.searchSnapshotVersion;
    return buildSearchSnapshot({ sessions }, { version });
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
