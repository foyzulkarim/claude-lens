import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ScanRootConfig } from "../../../../shared/settings-contract.js";
import { getConfig, putConfig } from "../../api/config.js";
import { qk } from "../../api/queryKeys.js";
import { TOGGLE_CLASS } from "../../ui/toggleStyles.js";

/** A row needs a stable React key independent of its (editable, possibly
 * duplicate-while-typing) `path` value — `clientId` is never sent to the
 * server, only `ScanRootConfig`'s own fields are. */
interface RootRow extends ScanRootConfig {
  clientId: string;
}

/**
 * Scan roots editor (#P4-15, pages spec §10). A root's `label` becomes the
 * `host` dimension everywhere (ARCH-settings-local-store.md A7) and applies
 * live — no restart. Adding/removing/editing a root's *path* requires a
 * restart (ARCH decision A2), called out explicitly so the save action
 * doesn't silently promise something it can't deliver.
 */
export function ScanRootsEditor() {
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: qk.config(),
    queryFn: ({ signal }) => getConfig(signal),
  });
  const [roots, setRoots] = useState<RootRow[]>([]);
  const [pathsChanged, setPathsChanged] = useState(false);

  useEffect(() => {
    if (configQuery.data) {
      setRoots(
        (configQuery.data.scanRoots ?? []).map((r) => ({ ...r, clientId: crypto.randomUUID() })),
      );
      setPathsChanged(false);
    }
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      putConfig({
        budget: configQuery.data?.budget ?? null,
        scanRoots: roots.map(({ path, label }) => ({ path, label })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.prefixes.config });
      setPathsChanged(false);
    },
  });

  function updateLabel(clientId: string, label: string): void {
    setRoots((prev) =>
      prev.map((r) => (r.clientId === clientId ? { ...r, label: label || undefined } : r)),
    );
  }

  function updatePath(clientId: string, path: string): void {
    setRoots((prev) => prev.map((r) => (r.clientId === clientId ? { ...r, path } : r)));
    setPathsChanged(true);
  }

  function removeRoot(clientId: string): void {
    setRoots((prev) => prev.filter((r) => r.clientId !== clientId));
    setPathsChanged(true);
  }

  function addRoot(): void {
    setRoots((prev) => [...prev, { path: "", clientId: crypto.randomUUID() }]);
    setPathsChanged(true);
  }

  const errorMessage = saveMutation.isError ? (saveMutation.error as Error).message : null;

  return (
    <section
      data-testid="scan-roots-editor"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
          Scan roots{" "}
          <span className="text-xs font-normal text-slate-400">label = host dimension</span>
        </h2>
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className={TOGGLE_CLASS}
        >
          Save
        </button>
      </div>

      {configQuery.isPending && (
        <p role="status" className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">
          Loading…
        </p>
      )}
      {configQuery.isError && (
        <p role="alert" className="mt-3 text-sm text-[#B23A3A] dark:text-[#E05252]">
          {configQuery.error.message}
        </p>
      )}
      {errorMessage && (
        <p role="alert" className="mt-2 text-xs text-[#B23A3A] dark:text-[#E05252]">
          {errorMessage}
        </p>
      )}

      {!configQuery.isPending && !configQuery.isError && (
        <>
          {roots.length === 0 && (
            <p className="mt-3 text-xs text-slate-500 dark:text-[#8B98A9]">
              No roots configured — the default{" "}
              <span className="font-mono">~/.claude/projects</span> is scanned.
            </p>
          )}
          {roots.map((root, index) => (
            <div key={root.clientId} className="mt-2 flex items-center gap-2">
              <input
                type="text"
                aria-label={`Root ${index + 1} path`}
                value={root.path}
                onChange={(e) => updatePath(root.clientId, e.target.value)}
                className="flex-1 rounded border border-slate-200 bg-transparent px-2 py-1 font-mono text-xs dark:border-[#2A323D]"
              />
              <input
                type="text"
                placeholder="label"
                aria-label={`Root ${index + 1} label`}
                value={root.label ?? ""}
                onChange={(e) => updateLabel(root.clientId, e.target.value)}
                className="w-32 rounded border border-slate-200 bg-transparent px-2 py-1 text-xs dark:border-[#2A323D]"
              />
              <button
                type="button"
                onClick={() => removeRoot(root.clientId)}
                aria-label={`Remove root ${index + 1}`}
                className={TOGGLE_CLASS}
              >
                ✕
              </button>
            </div>
          ))}
          <button type="button" onClick={addRoot} className={`${TOGGLE_CLASS} mt-2`}>
            Add root
          </button>
        </>
      )}

      <p className="mt-3 text-[11px] text-slate-400 dark:text-[#6B7684]">
        multi-machine via labeled roots — no capture change needed. Label edits apply immediately;{" "}
        {pathsChanged ? (
          <span className="text-[#96631E] dark:text-[#E8A33D]">
            adding/removing/editing a path requires restarting claude-lens.
          </span>
        ) : (
          "path changes require a restart."
        )}
      </p>
    </section>
  );
}
