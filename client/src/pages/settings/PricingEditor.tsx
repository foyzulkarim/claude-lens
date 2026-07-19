import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ModelRate, PricingTable } from "../../../../shared/pricing-contract.js";
import { getConfig, putConfig } from "../../api/config.js";
import { qk } from "../../api/queryKeys.js";
import { TOGGLE_CLASS } from "../../ui/toggleStyles.js";

/** Ships as blank-rate placeholder rows when the server has no `pricing`
 * override yet — matches the known model names the server's own
 * `DEFAULT_PRICING_TABLE` (server/metrics/measures.ts) ships with, so the
 * editor's starting point mirrors what's actually pricing calls today. */
const KNOWN_MODELS = ["claude-opus-4-8", "claude-sonnet-5", "claude-fable-5", "claude-haiku-4-5"];

const RATE_FIELDS: { key: keyof ModelRate; label: string }[] = [
  { key: "input", label: "Input" },
  { key: "output", label: "Output" },
  { key: "cacheRead", label: "Cache read" },
  { key: "cacheCreate", label: "Cache write" },
];

function seedRows(pricing: PricingTable | undefined): PricingTable {
  if (pricing && Object.keys(pricing).length > 0) return pricing;
  const seeded: PricingTable = {};
  for (const model of KNOWN_MODELS) {
    seeded[model] = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
  }
  return seeded;
}

/**
 * Pricing table editor (#P4-15, pages spec §10). Ships with default rates
 * (0-priced placeholders for known models) until the server's config has a
 * `pricing` override; saving PUTs the full table. `budget` is echoed
 * unchanged in the PUT body — the route requires it on every request
 * (#P4-10's original contract).
 */
export function PricingEditor() {
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: qk.config(),
    queryFn: ({ signal }) => getConfig(signal),
  });
  const [rows, setRows] = useState<PricingTable>({});
  const [newModel, setNewModel] = useState("");

  useEffect(() => {
    if (configQuery.data) setRows(seedRows(configQuery.data.pricing));
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => putConfig({ budget: configQuery.data?.budget ?? null, pricing: rows }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.prefixes.config });
    },
  });

  function updateRate(model: string, field: keyof ModelRate, value: string): void {
    const n = Number(value);
    setRows((prev) => ({
      ...prev,
      [model]: { ...prev[model], [field]: Number.isFinite(n) ? n : 0 },
    }));
  }

  function addModel(): void {
    const name = newModel.trim();
    if (!name || rows[name]) return;
    setRows((prev) => ({ ...prev, [name]: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 } }));
    setNewModel("");
  }

  const errorMessage = saveMutation.isError ? (saveMutation.error as Error).message : null;

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
