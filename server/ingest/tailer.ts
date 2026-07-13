import type { FileHandle } from "node:fs/promises";
import { open } from "node:fs/promises";
import type { ParseTranscriptResult } from "./parse-transcript.js";
import { parseTranscriptLines } from "./parse-transcript.js";
import type { RegisteredFile } from "./poller.js";

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
}

const NEWLINE = 0x0a;

function freshState(): TailFileState {
  return { offset: 0, seen: new Set(), chain: Promise.resolve(), readErrorCount: 0 };
}

export class Tailer {
  private readonly files = new Map<string, TailFileState>();

  constructor(private readonly events: TailerEvents) {}

  onFileAdded(file: RegisteredFile): Promise<void> {
    if (file.class !== "transcript") return Promise.resolve();
    const state = freshState();
    this.files.set(file.path, state);
    return this.enqueue(state, () => this.readGrowth(file, state, file.size));
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
      this.emitReset(file);
    }
    await this.readGrowth(file, state, file.size);
  }

  private async readGrowth(
    file: RegisteredFile,
    state: TailFileState,
    targetSize: number,
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

      const result = parseTranscriptLines(lines, state.seen);
      this.emitRecords(file, result);
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
