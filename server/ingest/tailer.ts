import type { FileHandle } from "node:fs/promises";
import { open } from "node:fs/promises";
import { basename } from "node:path";
import type { ParseTranscriptResult } from "./parse-transcript.js";
import { parseTranscriptLines } from "./parse-transcript.js";
import type { RegisteredFile } from "./poller.js";
import type { WarmCache, WarmCacheEntry } from "./warm-cache.js";

export interface TailerEvents {
  onRecords?(file: RegisteredFile, result: ParseTranscriptResult): void;
  onFileReset?(file: RegisteredFile): void;
  onFileRemoved?(file: RegisteredFile): void;
}

interface TailFileState {
  offset: number;
  seen: Set<string>;
  chain: Promise<void>;
  // Tracked for future Data Health surfacing (#P2-13); intentionally not read here.
  readErrorCount: number;
  // toolUseId -> tool name, carried across incremental reads so a Bash
  // exit-code fallback (parse-transcript.ts's CQ4 fix) can still resolve
  // the originating tool when its tool_use assistant line landed in an
  // earlier read than its tool_result user line. Rebuilding a fresh map
  // per read (the pre-fix behavior) silently dropped that attribution at
  // every read-chunk boundary.
  toolNameByToolUseId: Map<string, string>;
}

const NEWLINE = 0x0a;

// Bounds a single synchronous read+parse pass during `rereadFromStart`
// (#113 RB-1). A normal incremental growth read is naturally small (bytes
// since the last poll), but a full replay reads the whole file — for a
// session with many/large sub-agent files, one truncation could otherwise
// trigger a burst of large synchronous parses back-to-back, blocking the
// event loop. Reading in bounded chunks with a yield between them (see
// `rereadFromStart`) keeps all the data (unlike a hard size cap, which
// would silently drop legitimate large-session history) while letting
// other work interleave between chunks.
const REREAD_CHUNK_BYTES = 4 * 1024 * 1024;

function freshState(): TailFileState {
  return {
    offset: 0,
    seen: new Set(),
    chain: Promise.resolve(),
    readErrorCount: 0,
    toolNameByToolUseId: new Map(),
  };
}

export class Tailer {
  private readonly files = new Map<string, TailFileState>();
  // Once-gated set for sibling-replay failure warnings (#113 EH-2). Bounded
  // by the number of distinct file paths this tailer has ever replayed —
  // never grows unboundedly. Mirrors the `warnedPremiumReadFailure` /
  // `warnedDiscoverFailure` pattern in pipeline.ts/discovery.ts.
  private readonly warnedRereadFailure = new Set<string>();

  constructor(
    private readonly events: TailerEvents,
    private readonly cache?: WarmCache,
  ) {}

  onFileAdded(file: RegisteredFile): Promise<void> {
    if (file.class !== "transcript") return Promise.resolve();
    const state = freshState();
    this.files.set(file.path, state);
    return this.enqueue(state, () => this.initialRead(file, state));
  }

  private async initialRead(file: RegisteredFile, state: TailFileState): Promise<void> {
    if (this.cache) {
      const cached = await this.loadFromCache(file);
      if (cached) {
        for (const call of cached.calls) {
          state.seen.add(call.messageId);
          for (const tool of call.tools) {
            if (tool.id) state.toolNameByToolUseId.set(tool.id, tool.name);
          }
        }
        state.offset = file.size;
        this.emitRecords(file, cached);
        return;
      }
    }

    await this.readGrowth(file, state, file.size, (result) => {
      if (this.cache) {
        void this.cache
          .save({ path: file.path, size: file.size, mtime: file.mtime }, result)
          .catch(() => {
            // best-effort — a failed cache write only means a slower next boot
          });
      }
    });
  }

  private async loadFromCache(file: RegisteredFile): Promise<WarmCacheEntry | null> {
    try {
      return (
        (await this.cache?.load({ path: file.path, size: file.size, mtime: file.mtime })) ?? null
      );
    } catch {
      return null;
    }
  }

  onFileChanged(file: RegisteredFile): Promise<void> {
    if (file.class !== "transcript") return Promise.resolve();
    let state = this.files.get(file.path);
    if (!state) {
      state = freshState();
      this.files.set(file.path, state);
    }
    return this.enqueue(state, () => this.handleChange(file, state));
  }

  /**
   * Rewind a file to offset 0 and re-read it whole, WITHOUT emitting a reset
   * (#113). Used for the sibling-rewind path: when one file of a multi-file
   * session truncates, the pipeline resets the shared session once and then
   * asks every other file of that session to replay itself, so the siblings'
   * records survive the reset. Emitting a reset here instead would have each
   * sibling wipe the records the previous one just replayed.
   *
   * Cross-file duplication from this reread landing on top of an
   * already-applied incremental read (#113 AP-1) is guarded at the store
   * layer (`Store.applyRecords`'s session-wide `appliedMessageIds`), not
   * here — this method has no visibility into what the store already has.
   */
  rereadFromStart(file: RegisteredFile): Promise<void> {
    if (file.class !== "transcript") return Promise.resolve();
    const state = this.files.get(file.path);
    if (!state) return this.onFileAdded(file);
    return this.enqueue(state, async () => {
      // #113 EH-1: this task was queued behind whatever was already in
      // `state.chain` when `rereadFromStart` was called. If the file was
      // removed and rediscovered in the meantime, `onFileRemoved` deleted
      // this `state` from `this.files` and a fresh one (with its own
      // `onFileAdded` initial read already in flight) took its place.
      // Applying this stale state's read on top of that would duplicate
      // records, so bail — the fresh registration's own read covers it.
      if (this.files.get(file.path) !== state) return;
      this.resetTailState(state);
      const errorsBefore = state.readErrorCount;
      // Chunked, not one Buffer.alloc(file.size) read (#113 RB-1) — see
      // REREAD_CHUNK_BYTES.
      while (state.offset < file.size) {
        const before = state.offset;
        const target = Math.min(file.size, state.offset + REREAD_CHUNK_BYTES);
        await this.readGrowth(file, state, target);
        if (state.offset === before) break; // no full line in this chunk (e.g. a trailing partial line) — the next regular growth read picks it up once more content/a newline arrives, same as the unchunked path's behavior.
        if (state.offset < file.size) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
      if (state.readErrorCount > errorsBefore && !this.warnedRereadFailure.has(file.path)) {
        this.warnedRereadFailure.add(file.path);
        console.warn("[ingest] sibling replay hit a read error", {
          path: basename(file.path),
        });
      }
    });
  }

  onFileRemoved(file: RegisteredFile): void {
    this.files.delete(file.path);
    try {
      this.events.onFileRemoved?.(file);
    } catch {
      // consumer callback error — not our concern, must not escape
    }
  }

  private enqueue(state: TailFileState, task: () => Promise<void>): Promise<void> {
    // A task rejection must never poison state.chain — a rejected chain would
    // make every future enqueue() for this file a no-op (.then(task) on a
    // rejected promise skips task and stays rejected forever).
    state.chain = state.chain.then(() =>
      task().catch(() => {
        state.readErrorCount++;
      }),
    );
    return state.chain;
  }

  private async handleChange(file: RegisteredFile, state: TailFileState): Promise<void> {
    if (file.size < state.offset) {
      this.resetTailState(state);
      this.emitReset(file);
    }
    await this.readGrowth(file, state, file.size);
  }

  // Shared by the truncation branch above and `rereadFromStart` (#113 CQ-2)
  // — both need to forget everything read so far so the next `readGrowth`
  // starts a clean re-parse from byte 0. Kept as one place so a future
  // field added to `TailFileState` can't be reset in one call site and
  // forgotten in the other.
  private resetTailState(state: TailFileState): void {
    state.seen.clear();
    state.offset = 0;
    state.toolNameByToolUseId.clear();
  }

  private async readGrowth(
    file: RegisteredFile,
    state: TailFileState,
    targetSize: number,
    onParsed?: (result: ParseTranscriptResult) => void,
  ): Promise<void> {
    const length = targetSize - state.offset;
    if (length <= 0) return;

    let handle: FileHandle;
    try {
      handle = await open(file.path, "r");
    } catch {
      state.readErrorCount++;
      return;
    }

    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, state.offset);
      const slice = buffer.subarray(0, bytesRead);
      const lastNewline = slice.lastIndexOf(NEWLINE);
      if (lastNewline === -1) return;

      const text = slice.subarray(0, lastNewline + 1).toString("utf8");
      const lines = text.slice(0, -1).split("\n");
      state.offset += lastNewline + 1;

      const result = parseTranscriptLines(lines, state.seen, state.toolNameByToolUseId);
      this.emitRecords(file, result);
      onParsed?.(result);
    } catch {
      state.readErrorCount++;
    } finally {
      try {
        await handle.close();
      } catch {
        state.readErrorCount++;
      }
    }
  }

  private emitRecords(file: RegisteredFile, result: ParseTranscriptResult): void {
    try {
      this.events.onRecords?.(file, result);
    } catch {
      // consumer callback error — not our concern, must not escape
    }
  }

  private emitReset(file: RegisteredFile): void {
    try {
      this.events.onFileReset?.(file);
    } catch {
      // consumer callback error — not our concern, must not escape
    }
  }
}
