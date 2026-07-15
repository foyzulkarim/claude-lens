import type { ReactNode } from "react";

// Shared placeholder shell for the 11 page stubs — real layouts land per-page
// in Phase 4; this just proves routing + (where present) the query layer.
export function PageStub({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-[#E8EDF2]">{title}</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-[#5A6675]">
        Page stub — #P4 builds this out.
      </p>
      {children}
    </div>
  );
}
