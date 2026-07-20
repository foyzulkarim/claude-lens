import { readFile } from "node:fs/promises";
import type { WsServerMessage } from "../../shared/ws-protocol.js";
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
  // promise passed in comes from Tailer.onFileAdded/onFileChanged, whose
  // enqueue() swallows task rejections internally (tailer.ts). If track() is
  // ever reused for a promise without that guarantee, attach a .catch first.
  function track(promise: Promise<unknown>): void {
    inFlight.add(promise);
    promise.finally(() => inFlight.delete(promise));
  }

  const tailer = new Tailer(
    {
      onRecords(file, result) {
        if (!file.sessionId) return; // transcript files always have a sessionId (discovery derives it from the filename)
        store.applyRecords(file.sessionId, result, file.root);
      },
      onFileReset(file) {
        if (!file.sessionId) return;
        store.resetSession(file.sessionId);
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
  // malformed lines rather than throwing.
  async function readPremiumFile(file: RegisteredFile): Promise<void> {
    let content: string;
    try {
      content = await readFile(file.path, "utf8");
    } catch {
      return;
    }
    const lines = content.split("\n");
    if (file.class === "cost") {
      if (!file.sessionId) return;
      store.applyCostSamples(file.sessionId, parseCostSampleLines(lines).samples);
    } else if (file.class === "turn-boundaries") {
      if (!file.sessionId) return;
      store.applyTurnBoundaries(file.sessionId, parseTurnBoundaryLines(lines).boundaries);
    } else if (file.class === "cost-log") {
      store.applyCostLog(parseCostLogLines(lines).rows);
    }
  }

  // Defensive .catch so `track()`'s "never rejects" precondition holds even if
  // a store apply method throws unexpectedly (readPremiumFile already swallows
  // read errors, but the store call is outside that try).
  function trackPremium(file: RegisteredFile): void {
    track(readPremiumFile(file).catch((err) => console.error("[ingest] premium read failed", err)));
  }

  const poller = new Poller(config, {
    onFileAdded(file) {
      if (file.class === "transcript") {
        if (file.sessionId) store.setTranscriptPath(file.sessionId, file.path);
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
        if (file.sessionId) store.setTranscriptPath(file.sessionId, file.path);
        track(tailer.onFileChanged(file));
        return;
      }
      trackPremium(file);
    },
    onFileRemoved(file) {
      if (file.class === "transcript") {
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
  };
}
