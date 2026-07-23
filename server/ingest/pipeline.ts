import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { WsServerMessage } from "../../shared/ws-protocol.js";
import type { PipelineStats } from "../pipeline-stats.js";
import type { RuntimeMetadata } from "../runtime.js";
import { Store } from "../store/store.js";
import type { ScanConfig } from "./discovery.js";
import {
  parseCostLogLines,
  parseCostSampleLines,
  parseTurnBoundaryLines,
} from "./parse-premium.js";
import { Poller, type RegisteredFile } from "./poller.js";
import { Tailer } from "./tailer.js";
import type { WarmCache } from "./warm-cache.js";

// The runnable assembly: discovery -> poller -> tailer -> parser -> store
// (architecture §5, plan #P2-7). Wiring is explicit here rather than
// implicit — cli.ts reuses this same function and connects `onInvalidate` to
// the WS fan-out (`server/ws/broadcaster.ts`); this module adds no WS/socket
// code itself (#P3-1).

// H1: byte cap on a single premium sidecar read. C/B carry one session's
// data (5 MB is generous for that — a session with 10 k calls is ≈ 1 MB of
// JSONL); L is per-session totals for the whole fleet (50 MB is the upper
// bound on a real fleet at this scale). Anything larger is almost certainly
// an attacker-controlled or runaway-capture file; reject with a warning
// rather than letting `readFile` allocate the whole thing into V8 heap.
const PREMIUM_FILE_SIZE_CAP_BYTES_CB = 5 * 1024 * 1024;
const PREMIUM_FILE_SIZE_CAP_BYTES_L = 50 * 1024 * 1024;

// Once-gated set for readPremiumFile failure warnings (review EH-2).
// Bounded by the number of distinct premium files the poller has ever
// seen since server start — never grows unboundedly. A persistently
// broken C/B/L file surfaces one warning across the process lifetime
// instead of spamming the log on every poll cycle. Mirrors the
// `warnedOnSaveFailure` pattern in warm-cache.ts.
const warnedPremiumReadFailure = new Set<string>();

export interface IngestPipelineOptions {
  onInvalidate(message: WsServerMessage): void;
  warmCache?: WarmCache;
  /**
   * Runtime pricing + context-window metadata (ARCH T5). When provided,
   * all three fields are forwarded to the Store so derived sessions are
   * priced consistently with the Fastify metrics route. Optional for
   * backward compatibility — tests that don't care about pricing can
   * omit it and get unpriced sessions (costComputed = 0, the honest
   * "not priced yet" state).
   */
  metadata?: RuntimeMetadata;
  debounceMs?: number;
  /** Root path -> label, used to resolve `Session.host` (#P4-15). See `runtime.ts`'s `buildHostLabels`. */
  hostLabels?: Map<string, string>;
}

export interface IngestPipeline {
  store: Store;
  /** Resolves once the initial discovery pass and every file's initial tail read have drained — a deterministic cold-boot barrier for benchmarking (#P2-7) and tests. */
  whenSettled(): Promise<void>;
  stop(): void;
  /**
   * Pipeline-level counters surfaced on the Data Health page (#P4-14).
   * The store reads them via the `pipelineStats` callback so its
   * `getHealthSnapshot` stays decoupled from the pipeline class.
   * `transcriptsFound` is the count of distinct transcript files the
   * poller has registered; `transcriptsFailed` is derived from the store's
   * already-computed `transcriptsParsed` count (passed in by the caller),
   * avoiding a second `listSessions()` sweep per `/api/health` request.
   */
  getStats(transcriptsParsed: number): PipelineStats;
}

export function startIngest(config: ScanConfig, options: IngestPipelineOptions): IngestPipeline {
  const store = new Store({
    onInvalidate: options.onInvalidate,
    pricer: options.metadata?.pricer,
    pricing: options.metadata?.pricing,
    contextResolver: options.metadata?.contextResolver,
    debounceMs: options.debounceMs,
    hostLabels: options.hostLabels,
  });

  const inFlight = new Set<Promise<unknown>>();
  // track() assumes `promise` never rejects — true today because every
  // promise passed in comes from Tailer.onFileAdded/onFileChanged/
  // rereadFromStart, whose enqueue() swallows task rejections internally
  // (tailer.ts). If track() is ever reused for a promise without that
  // guarantee, attach a .catch first.
  function track(promise: Promise<unknown>): void {
    inFlight.add(promise);
    promise.finally(() => inFlight.delete(promise));
  }

  // #P4-14: count distinct transcript files the poller has registered
  // since server start. The store's `getHealthSnapshot` derives
  // `transcriptsFailed` from this (found - parsed) on every read, so
  // the pipeline only needs to maintain the "found" side. Sidecar
  // files (C/B/L) are excluded — the Data Health page surfaces
  // malformed-line counts for those via the existing
  // `premiumFileHealth` map on the store, not via this counter.
  const discoveredTranscriptPaths = new Set<string>();

  // #113: a session is no longer 1:1 with a file. A session's sidechain
  // activity lives in sibling `<uuid>/subagents/agent-*.jsonl` files that
  // discovery routes to the same `sessionId`. `resetSession` clears the
  // whole session, so a truncation in ANY of its files would otherwise
  // silently drop the records contributed by the others. This index lets
  // the reset handler replay them. The stored `RegisteredFile` objects are
  // the poller's own registry entries, which it mutates in place on each
  // poll — so `size`/`mtime` read here are always current.
  const filesBySession = new Map<string, Map<string, RegisteredFile>>();

  function indexSessionFile(file: RegisteredFile): void {
    if (file.class !== "transcript" || !file.sessionId) return;
    let group = filesBySession.get(file.sessionId);
    if (!group) {
      group = new Map<string, RegisteredFile>();
      filesBySession.set(file.sessionId, group);
    }
    group.set(file.path, file);
  }

  function forgetSessionFile(file: RegisteredFile): void {
    if (file.class !== "transcript" || !file.sessionId) return;
    const group = filesBySession.get(file.sessionId);
    if (!group) return;
    group.delete(file.path);
    if (group.size === 0) filesBySession.delete(file.sessionId);
  }

  // Shared by the poller's onFileAdded/onFileChanged transcript branches
  // below — both need to index the file into `filesBySession` and keep
  // `setTranscriptPath` pinned to the parent (never a sub-agent file).
  function registerTranscriptFile(file: RegisteredFile): void {
    indexSessionFile(file);
    // `agentId` set = a sub-agent sidechain file (#113). Its records
    // belong to this session, but the session's transcript path must
    // stay pinned to the parent `<uuid>.jsonl` — otherwise whichever
    // agent file registered last would win and Session Detail would
    // deep-link into a sub-agent transcript.
    if (file.sessionId && file.agentId === undefined) {
      store.setTranscriptPath(file.sessionId, file.path);
    }
  }
  // Receives the store's already-computed `transcriptsParsed` count so
  // `transcriptsFailed` can be derived without a second `listSessions()`
  // sweep per `/api/health` (review P-001 — both the pipeline and the
  // store used to walk every session with `callCount > 0` per request).
  function getStats(transcriptsParsed: number): PipelineStats {
    const transcriptsFound = discoveredTranscriptPaths.size;
    return {
      transcriptsFound,
      transcriptsFailed: Math.max(0, transcriptsFound - transcriptsParsed),
    };
  }

  const tailer = new Tailer(
    {
      onRecords(file, result) {
        if (!file.sessionId) return; // transcript files always have a sessionId (discovery derives it from the filename)
        store.applyRecords(file.sessionId, result, file.root);
      },
      onFileReset(file) {
        if (!file.sessionId) return;
        // #113 EH-3: relies on at most one `onFileReset` per session per
        // poll cycle, even if two sibling files both truncate in the same
        // cycle — otherwise the second reset would wipe the first reset's
        // sibling replays before they land. That holds today only because
        // `Poller.pollOnce` awaits `stat()` sequentially per file, so this
        // callback (and everything it synchronously triggers) finishes
        // before the next file in the registry is even stat'd. Not a
        // documented guarantee elsewhere — a future parallelized
        // `pollOnce` would need to preserve or replace it.
        store.resetSession(file.sessionId);
        // Replay this session's other files (parent transcript and/or
        // sibling sub-agent transcripts) — the reset above wiped their
        // records too (#113). Skipped entirely for the common
        // one-file-per-session case, where the group holds only `file`.
        const group = filesBySession.get(file.sessionId);
        if (!group) return;
        for (const sibling of group.values()) {
          if (sibling.path === file.path) continue;
          track(tailer.rereadFromStart(sibling));
        }
      },
      onFileRemoved() {
        // Session state is kept even if its file disappears mid-run — no
        // cleanup requirement in #P2-6/#P2-7 scope.
      },
    },
    options.warmCache,
  );

  // Read a premium C/B/L sidecar whole and apply it with full-replace store
  // semantics (#P4-13, plan D5). These files are small (one session for C/B;
  // one row per session for L), so re-reading the entire file on every change
  // — no byte-offset tailing, no dedupe — is both simpler and cheap. Never
  // rejects: read failures (a file that vanished between the poll and this
  // read) are swallowed and retried on the next poll; the parsers count
  // malformed lines rather than throwing. Files exceeding the per-class size
  // cap (H1) are skipped with a single warning rather than throwing — a
  // malformed or wrong-sidecar file must not crash ingest.
  async function readPremiumFile(file: RegisteredFile): Promise<void> {
    const cap =
      file.class === "cost-log" ? PREMIUM_FILE_SIZE_CAP_BYTES_L : PREMIUM_FILE_SIZE_CAP_BYTES_CB;
    let size: number;
    try {
      const stats = await stat(file.path);
      size = stats.size;
    } catch (err) {
      // Review EH-2: previously silent — a broken symlink, perm
      // denial, or path replaced by a directory left no log line.
      // Now warn once per file (basename + errno only — never the
      // absolute path, security #4) so a flapping file doesn't spam
      // logs on every poll cycle.
      if (!warnedPremiumReadFailure.has(file.path)) {
        warnedPremiumReadFailure.add(file.path);
        console.warn("[ingest] premium stat failed", {
          path: basename(file.path),
          code: (err as NodeJS.ErrnoException | undefined)?.code ?? "UNKNOWN",
        });
      }
      return;
    }
    if (size > cap) {
      console.warn("[ingest] premium file exceeds size cap", {
        path: basename(file.path),
        size,
        cap,
      });
      return;
    }
    let content: string;
    try {
      content = await readFile(file.path, "utf8");
    } catch (err) {
      // Review EH-2: same once-gate as the stat branch — a read
      // failure on a previously-good file is the most common
      // "operator has no idea why the page is stale" complaint.
      if (!warnedPremiumReadFailure.has(file.path)) {
        warnedPremiumReadFailure.add(file.path);
        console.warn("[ingest] premium read failed", {
          path: basename(file.path),
          code: (err as NodeJS.ErrnoException | undefined)?.code ?? "UNKNOWN",
        });
      }
      return;
    }
    const lines = content.split("\n");
    if (file.class === "cost") {
      if (!file.sessionId) return;
      // H6: the parser cross-checks every record's `session_id` against the
      // filename-derived sessionId and counts mismatches as malformed,
      // preventing a `B`-tagged record inside `A.cost.jsonl` from silently
      // contributing to A's session.
      // E1: thread the parser's `malformedCount` + the absolute path into
      // the Store's per-file health accumulator (review E1 — Data Health
      // surfacing of `malformedCount`).
      const costResult = parseCostSampleLines(lines, file.sessionId);
      store.applyCostSamples(file.sessionId, costResult.samples, {
        malformedCount: costResult.malformedCount,
        filePath: file.path,
      });
    } else if (file.class === "turn-boundaries") {
      if (!file.sessionId) return;
      const boundaryResult = parseTurnBoundaryLines(lines, file.sessionId);
      store.applyTurnBoundaries(file.sessionId, boundaryResult.boundaries, {
        malformedCount: boundaryResult.malformedCount,
        filePath: file.path,
      });
    } else if (file.class === "cost-log") {
      // L is intentionally routed by its own `session_id` (one row may
      // upgrade any session in the fleet) — no expectedSessionId here.
      const logResult = parseCostLogLines(lines);
      store.applyCostLog(logResult.rows, {
        malformedCount: logResult.malformedCount,
        filePath: file.path,
      });
    }
  }

  // Defensive .catch so `track()`'s "never rejects" precondition holds even if
  // a store apply method throws unexpectedly (readPremiumFile already swallows
  // read errors via the once-gated warnings above, but the store call is
  // outside that try). The error log intentionally redacts the absolute path
  // (security #4) — only the basename + errno code are surfaced so a
  // shared-log reader can't harvest a user's home directory layout.
  function trackPremium(file: RegisteredFile): void {
    track(
      readPremiumFile(file).catch((err) => {
        const code = (err as NodeJS.ErrnoException | undefined)?.code ?? "UNKNOWN";
        console.error("[ingest] premium apply failed", {
          code,
          path: basename(file.path),
        });
      }),
    );
  }

  const poller = new Poller(config, {
    onFileAdded(file) {
      if (file.class === "transcript") {
        // #P4-14: track distinct transcript files the poller has
        // registered since server start. The Set ignores duplicates
        // so a re-registration after a removal+rediscovery is
        // idempotent (see onFileRemoved for the matching delete).
        discoveredTranscriptPaths.add(file.path);
        registerTranscriptFile(file);
        track(tailer.onFileAdded(file));
        return;
      }
      // C/B/L sidecars (cost, turn-boundaries, cost-log) — parse content now
      // (#P4-13). cost-log is a single global file with no per-file sessionId;
      // Store.applyCostLog fans its rows out to their sessions.
      trackPremium(file);
    },
    onFileChanged(file) {
      if (file.class === "transcript") {
        registerTranscriptFile(file);
        track(tailer.onFileChanged(file));
        return;
      }
      trackPremium(file);
    },
    onFileRemoved(file) {
      if (file.class === "transcript") {
        // #P4-14: drop the file from the discovered set so
        // `transcriptsFound` doesn't overcount after a re-discovery.
        // tailer.onFileRemoved also resets the session's transcript
        // counters (calls/duplicates/malformed) via store.resetSession.
        discoveredTranscriptPaths.delete(file.path);
        forgetSessionFile(file);
        tailer.onFileRemoved(file);
      }
      // A removed premium file leaves the session's last observed values in
      // place — same "state kept even if its file disappears" stance as
      // transcript removal above; no cleanup requirement in #P4-13 scope.
    },
  });

  async function drainInFlight(): Promise<void> {
    // Loops until the set is empty, not until its size merely stabilizes —
    // a size-equality check can't distinguish "nothing changed" from "one
    // resolved while a different one was added," which would exit early
    // with promises still pending. Safe to call repeatedly: Promise.all
    // re-snapshots inFlight fresh each pass.
    while (inFlight.size > 0) {
      await Promise.all([...inFlight]);
    }
  }

  let stopped = false;

  // poller.start() kicks off its own fire-and-forget initial runDiscovery()
  // plus the fast/slow timers. We can't await that internal call, and
  // running our own discovery pass concurrently with it is unsafe — two
  // in-flight runDiscovery() calls can each pass the "already registered"
  // check before either finishes registering, double-registering the same
  // file (and double-counting its calls). So we run one explicit discovery
  // pass ourselves, fully await it, and only then start the poller's timers
  // — its internal repeat finds every path already registered and no-ops.
  // This also gives whenSettled() a deterministic cold-boot barrier.
  //
  // The `stopped` check right before poller.start() closes the other half
  // of that gap: if stop() is called while this IIFE is still awaiting
  // discovery/drain, we must not resurrect the poller's timers afterward —
  // stop() has to be a real boundary, not just a timer sweep that a
  // still-in-flight boot sequence undoes a moment later.
  const settled = (async () => {
    await poller.runDiscovery();
    await drainInFlight();
    if (stopped) return;
    poller.start();
  })();

  return {
    store,
    whenSettled: () => settled,
    stop() {
      stopped = true;
      poller.stop();
      store.stop();
    },
    getStats,
  };
}
