export interface EmptyStateProps {
  message: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <p className="text-sm text-slate-500 dark:text-[#8B98A9]">{message}</p>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-[#8A96A5] dark:hover:bg-[#151A21]"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
