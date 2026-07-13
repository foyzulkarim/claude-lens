import type { Pricer } from "../store/derive-session.js";
import { Store } from "../store/store.js";
import type { ScanConfig } from "./discovery.js";
import { Poller } from "./poller.js";
import { Tailer } from "./tailer.js";
import type { WarmCache } from "./warm-cache.js";
import type { WsServerMessage } from "../../shared/ws-protocol.js";

// The runnable assembly: discovery -> poller -> tailer -> parser -> store
// (architecture §5, plan #P2-7). Wiring is explicit here rather than
// implicit — #P3-1's `app.ts` reuses this same function; it does not add any
// WS/socket code itself (that boundary is #P3-1's, per `sendInvalidation` in
// server/app.ts).

export interface IngestPipelineOptions {
  onInvalidate(message: WsServerMessage): void;
  warmCache?: WarmCache;
  pricer?: Pricer;
  debounceMs?: number;
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
    pricer: options.pricer,
    debounceMs: options.debounceMs,
  });

  const inFlight = new Set<Promise<unknown>>();
  function track(promise: Promise<unknown>): void {
    inFlight.add(promise);
    promise.finally(() => inFlight.delete(promise));
  }

  const tailer = new Tailer(
    {
      onRecords(file, result) {
        if (!file.sessionId) return; // transcript files always have a sessionId (discovery derives it from the filename)
        store.applyRecords(file.sessionId, result);
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

  const poller = new Poller(config, {
    onFileAdded(file) {
      if (file.class === "transcript") {
        track(tailer.onFileAdded(file));
        return;
      }
      if (file.sessionId && (file.class === "cost" || file.class === "turn-boundaries")) {
        store.markSidecarPresent(file.sessionId, file.class);
      }
      // "cost-log" is a single global file, not per-session — presence
      // wiring for it is deferred to #P4-13 (see Store.markSidecarPresent).
    },
    onFileChanged(file) {
      if (file.class === "transcript") {
        track(tailer.onFileChanged(file));
      }
      // Sidecar file content changes (cost/turn-boundaries/cost-log) are not
      // parsed until #P4-13 — presence was already recorded on add.
    },
    onFileRemoved(file) {
      if (file.class === "transcript") {
        tailer.onFileRemoved(file);
      }
    },
  });

  async function drainInFlight(): Promise<void> {
    let previousSize = -1;
    while (inFlight.size > 0 && inFlight.size !== previousSize) {
      previousSize = inFlight.size;
      await Promise.all([...inFlight]);
    }
  }

  // poller.start() kicks off its own fire-and-forget initial runDiscovery()
  // plus the fast/slow timers. We can't await that internal call, and
  // running our own discovery pass concurrently with it is unsafe — two
  // in-flight runDiscovery() calls can each pass the "already registered"
  // check before either finishes registering, double-registering the same
  // file (and double-counting its calls). So we run one explicit discovery
  // pass ourselves, fully await it, and only then start the poller's timers
  // — its internal repeat finds every path already registered and no-ops.
  // This also gives whenSettled() a deterministic cold-boot barrier.
  const settled = (async () => {
    await poller.runDiscovery();
    await drainInFlight();
    poller.start();
  })();

  return {
    store,
    whenSettled: () => settled,
    stop() {
      poller.stop();
      store.stop();
    },
  };
}
