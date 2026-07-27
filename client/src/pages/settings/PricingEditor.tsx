import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  DEFAULT_MODEL_KEYS,
  type ModelRate,
  type PricingTable,
} from "../../../../shared/pricing-contract.js";
import { getConfig, putConfig } from "../../api/config.js";
import { qk } from "../../api/queryKeys.js";
import { TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import { useConfigSyncedFormState } from "./useConfigSyncedFormState.js";

/** Ships as blank-rate placeholder rows when the server has no `pricing`
 * override yet. The model names come from the shared pricing contract's
 * `DEFAULT_MODEL_KEYS` — same list the server's `DEFAULT_PRICING_TABLE`
 * (`server/metrics/measures.ts`) is built from, so the editor's starting
 * point always mirrors what's actually pricing calls today and a future
 * server-side default shows up in the editor automatically (review #19). */

const RATE_FIELDS: { key: keyof ModelRate; label: string }[] = [
  { key: "input", label: "Input" },
  { key: "output", label: "Output" },
  { key: "cacheRead", label: "Cache read" },
  { key: "cacheCreate", label: "Cache write" },
];

function seedRows(pricing: PricingTable | undefined): PricingTable {
  if (pricing && Object.keys(pricing).length > 0) return pricing;
  const seeded: PricingTable = {};
  for (const model of DEFAULT_MODEL_KEYS) {
    seeded[model] = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
  }
  return seeded;
}

/**
 * Pricing table editor (#P4-15, pages spec §10). Ships with default rates
 * (0-priced placeholders for known models) until the server's config has a
 * `pricing` override; saving PUTs the full table. `budget` is echoed from
 * the *live query cache* at submit time (review #19) — closing over
 * `configQuery.data.budget` would silently revert a just-saved budget from
 * a sibling panel. The `["config"]` query invalidation also doesn't wipe
 * this panel's unsaved edits mid-form-filling: `useConfigSyncedFormState`
 * flags dirty on every user edit and skips reseeding until `accept()` is
 * called (after a successful save).
 */
export function PricingEditor() {
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: qk.config(),
    queryFn: ({ signal }) => getConfig(signal),
  });
  const [rows, setRows] = useState<PricingTable>({});
  const [newModel, setNewModel] = useState("");
  const sync = useConfigSyncedFormState<PricingTable>({
    data: configQuery.data,
    apply: (cfg) => seedRows((cfg as { pricing?: PricingTable }).pricing),
    setRows,
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      // Read `budget` from the live cache, not the closure — the closed-over
      // snapshot is stale the moment a sibling panel saves first.
      const current = queryClient.getQueryData(qk.config());
      const budget = (current as { budget?: number | null } | undefined)?.budget ?? null;
      return putConfig({ budget, pricing: rows });
    },
    onSuccess: () => {
      sync.accept();
      queryClient.invalidateQueries({ queryKey: qk.prefixes.config });
      // ARCH-124 (#2): scorecard waste-event dollar estimates are priced
      // from the Store's live pricing at request time, not a startup
      // closure — without this, a rate edit here would leave the
      // Scorecard section / Biggest Lever card showing stale dollars
      // until an unrelated refetch happened to fire.
      queryClient.invalidateQueries({ queryKey: qk.prefixes.scorecard });
    },
  });

  function updateRate(model: string, field: keyof ModelRate, value: string): void {
    sync.markDirty();
    const n = Number(value);
    setRows((prev) => ({
      ...prev,
      [model]: { ...prev[model], [field]: Number.isFinite(n) ? n : 0 },
    }));
  }

  function addModel(): void {
    const name = newModel.trim();
    if (!name || rows[name]) return;
    sync.markDirty();
    setRows((prev) => ({ ...prev, [name]: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 } }));
    setNewModel("");
  }

  const errorMessage = saveMutation.isError ? (saveMutation.error?.message ?? null) : null;

  return (
    <section
      data-testid="pricing-editor"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
          Pricing table <span className="text-xs font-normal text-slate-400">$/MTok</span>
        </h2>
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || configQuery.isPending}
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
        <table className="mt-3 w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 dark:text-[#8A96A5]">
              <th className="py-1">Model</th>
              {RATE_FIELDS.map((f) => (
                <th key={f.key} className="py-1 text-right">
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(rows).map(([model, rate]) => (
              <tr key={model} className="border-t border-slate-100 dark:border-[#232B36]">
                <td className="py-1 font-mono">{model}</td>
                {RATE_FIELDS.map((f) => (
                  <td key={f.key} className="py-1 text-right">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      aria-label={`${model} ${f.label} rate`}
                      value={rate[f.key]}
                      onChange={(e) => updateRate(model, f.key, e.target.value)}
                      className="w-16 rounded border border-slate-200 bg-transparent px-1 py-0.5 text-right dark:border-[#2A323D]"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          placeholder="model name"
          value={newModel}
          onChange={(e) => setNewModel(e.target.value)}
          className="rounded border border-slate-200 bg-transparent px-2 py-1 text-xs dark:border-[#2A323D]"
        />
        <button type="button" onClick={addModel} className={TOGGLE_CLASS}>
          Add model
        </button>
      </div>
      <p className="mt-2 text-[11px] text-slate-400 dark:text-[#6B7684]">
        ships with defaults · unknown model strings surface in Data Health
      </p>
    </section>
  );
}
