import type { FileHandle } from "node:fs/promises";
import { open } from "node:fs/promises";
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
   */
  rereadFromStart(file: RegisteredFile): Promise<void> {
    if (file.class !== "transcript") return Promise.resolve();
    const state = this.files.get(file.path);
    if (!state) return this.onFileAdded(file);
    return this.enqueue(state, async () => {
      state.seen.clear();
      state.offset = 0;
      state.toolNameByToolUseId.clear();
      await this.readGrowth(file, state, file.size);
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
      state.seen.clear();
      state.offset = 0;
      state.toolNameByToolUseId.clear();
      this.emitReset(file);
    }
    await this.readGrowth(file, state, file.size);
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
