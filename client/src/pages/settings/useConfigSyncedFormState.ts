import { useEffect, useRef, useState } from "react";

/**
 * Sync local form state from a server-fetched config, *without* clobbering
 * the user's in-progress edits when a sibling Settings panel saves and the
 * shared `["config"]` query refetches (review #19, #P4-15). The earlier
 * pattern — useEffect that unconditionally `setRows(seedRows(data))` on every
 * `data` change — let saving PricingEditor silently wipe unsaved edits in
 * ScanRootsEditor/ThresholdsPanel (or, on save, echo a stale `budget` back
 * and revert a just-saved threshold change).
 *
 * Usage:
 *   const [rows, setRows] = useState(initial);
 *   const sync = useConfigSyncedFormState({
 *     data: configQuery.data,
 *     apply: (cfg) => seedRows(cfg.pricing),
 *     setRows,
 *   });
 *   // dirty becomes true automatically when setRows is called for a user
 *   // edit (panels bump `sync.markDirty()` after each setRows call site — the
 *   // State setter hook is wrapped in the panel's own local helpers).
 *   // After a successful save, call `sync.accept()` so future refetches
 *   // re-seed normally.
 *
 * The hook:
 *   - seeds `rows` once per `data` reference change (not every render)
 *   - skips the seed while `dirty` is true (user has in-progress edits)
 *   - exposes `markDirty()` to flag "I just made a user edit"
 *   - exposes `accept()` to reset the dirty flag (e.g. after a save lands)
 *   - exposes `dirty` so the UI can render an "unsaved changes" indicator
 */
export function useConfigSyncedFormState<T>(args: {
  /** The current config-query data. `undefined` means still loading. */
  data: unknown;
  /** Compute the seeded local state from the loaded config. */
  apply: (cfg: object) => T;
  /** Local-state setter (the same `setX` passed to `useState`). */
  setRows: (next: T | ((prev: T) => T)) => void;
}): { dirty: boolean; markDirty: () => void; accept: () => void } {
  const [dirty, setDirty] = useState(false);
  // Track the config object that produced the current seed so we only
  // re-seed when the server data actually changes, not when a parent
  // re-renders with the same object reference.
  const lastSeededRef = useRef<unknown>(undefined);

  useEffect(() => {
    if (args.data === undefined) return;
    if (lastSeededRef.current === args.data) return;
    lastSeededRef.current = args.data;
    if (dirty) return;
    args.setRows(args.apply(args.data as object));
  }, [args.data, args.apply, args.setRows, dirty]);

  return {
    dirty,
    markDirty: () => setDirty(true),
    accept: () => {
      setDirty(false);
      lastSeededRef.current = args.data;
    },
  };
}
