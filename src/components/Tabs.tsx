import { useId, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon: ReactNode;
  panel: ReactNode;
}

/** Panels stay mounted (hidden) so a running job and its output survive switching tabs. */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: TabItem<T>[] }) {
  const id = useId();
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const step = (e.key === "ArrowRight") !== rtl ? 1 : -1;
    const i = items.findIndex((t) => t.value === value);
    const next = items[(i + step + items.length) % items.length];
    onChange(next.value);
    document.getElementById(`${id}-tab-${next.value}`)?.focus();
  };

  return (
    <div>
      <div role="tablist" onKeyDown={onKey} className="mb-4 flex gap-1 rounded-xl border border-border bg-card p-1 shadow-sm">
        {items.map((t) => (
          <button
            key={t.value}
            id={`${id}-tab-${t.value}`}
            role="tab"
            type="button"
            aria-selected={value === t.value}
            aria-controls={`${id}-panel-${t.value}`}
            tabIndex={value === t.value ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors [&_svg]:size-4",
              value === t.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      {items.map((t) => (
        <div key={t.value} id={`${id}-panel-${t.value}`} role="tabpanel" aria-labelledby={`${id}-tab-${t.value}`} hidden={value !== t.value}>
          {t.panel}
        </div>
      ))}
    </div>
  );
}
