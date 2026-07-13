import { stat } from "node:fs/promises";
import type { DiscoveredFile, ScanConfig } from "./discovery.js";
import { discover } from "./discovery.js";

const DEFAULT_FAST_INTERVAL_MS = 3000;
const DEFAULT_SLOW_INTERVAL_MS = 30000;

export interface RegisteredFile {
  path: string;
  class: DiscoveredFile["class"];
  sessionId?: string;
  root: string;
  label?: string;
  size: number;
  mtime: number;
}

export interface IngestEvents {
  onFileAdded?(file: RegisteredFile): void;
  onFileChanged?(file: RegisteredFile): void;
  onFileRemoved?(file: RegisteredFile): void;
}

export class Poller {
  private readonly registry = new Map<string, RegisteredFile>();
  private fastTimer?: ReturnType<typeof setInterval>;
  private slowTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly config: ScanConfig,
    private readonly events: IngestEvents,
  ) {}

  start(): void {
    void this.runDiscovery();
    const fastMs = this.config.fastIntervalMs ?? DEFAULT_FAST_INTERVAL_MS;
    const slowMs = this.config.slowIntervalMs ?? DEFAULT_SLOW_INTERVAL_MS;
    this.fastTimer = setInterval(() => this.pollOnce(), fastMs);
    this.slowTimer = setInterval(() => this.runDiscovery(), slowMs);
  }

  stop(): void {
    if (this.fastTimer) clearInterval(this.fastTimer);
    if (this.slowTimer) clearInterval(this.slowTimer);
    this.fastTimer = undefined;
    this.slowTimer = undefined;
  }

  async runDiscovery(): Promise<void> {
    const snapshot = await discover(this.config);
    const seenPaths = new Set(snapshot.map((f) => f.path));

    for (const [path, file] of this.registry) {
      if (!seenPaths.has(path)) {
        this.registry.delete(path);
        try {
          this.events.onFileRemoved?.(file);
        } catch {
          // consumer callback error — not our concern, must not escape the loop
        }
      }
    }

    for (const found of snapshot) {
      if (this.registry.has(found.path)) continue;

      let size = 0;
      let mtime = 0;
      try {
        const st = await stat(found.path);
        size = st.size;
        mtime = st.mtimeMs;
      } catch {
        // ENOENT (file gone before we could stat it) is expected and silent;
        // an unexpected fs error also just skips this file — next slow pass retries
        continue;
      }

      const registered: RegisteredFile = {
        path: found.path,
        class: found.class,
        sessionId: found.sessionId,
        root: found.root,
        label: found.label,
        size,
        mtime,
      };
      this.registry.set(found.path, registered);
      try {
        this.events.onFileAdded?.(registered);
      } catch {
        // consumer callback error — not our concern, must not escape the loop
      }
    }
  }

  async pollOnce(): Promise<void> {
    for (const file of this.registry.values()) {
      let st: Awaited<ReturnType<typeof stat>>;
      try {
        st = await stat(file.path);
      } catch {
        // ENOENT (deleted between registration and stat) is expected; removal
        // is deferred to the next slow pass regardless of the error's cause
        continue;
      }

      if (st.size !== file.size || st.mtimeMs !== file.mtime) {
        file.size = st.size;
        file.mtime = st.mtimeMs;
        try {
          this.events.onFileChanged?.(file);
        } catch {
          // consumer callback error — not our concern, must not escape the loop
        }
      }
    }
  }
}
