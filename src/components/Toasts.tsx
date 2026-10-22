import { useEffect } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/i18n";
import { dismiss, useToasts, type Toast } from "@/lib/notify";
import { cn } from "@/lib/utils";

const AUTO_DISMISS_MS = 9000;

function ToastItem({ t }: { t: Toast }) {
  const { t: tr } = useI18n();
  useEffect(() => {
    if (t.action) return; // actionable toasts wait for the user
    const id = setTimeout(() => dismiss(t.id), AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [t]);
  return (
    <li
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-xl border bg-card p-4 shadow-lg",
        t.tone === "warning" ? "border-accent" : t.tone === "success" ? "border-success" : "border-border",
      )}
    >
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">{t.title}</p>
        {t.body && <p className="mt-0.5 text-muted-foreground">{t.body}</p>}
        {t.action && (
          <button
            type="button"
            className="mt-2 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
            onClick={() => {
              t.action!.run();
              dismiss(t.id);
            }}
          >
            {t.action.label}
          </button>
        )}
      </div>
      <button type="button" onClick={() => dismiss(t.id)} className="text-muted-foreground hover:text-foreground" aria-label={tr.close}>
        <X className="size-4" />
      </button>
    </li>
  );
}

export function Toasts() {
  const toasts = useToasts();
  return (
    <ol className="pointer-events-none fixed inset-x-4 bottom-4 z-50 ms-auto flex max-w-sm flex-col gap-2 [&>li]:pointer-events-auto">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </ol>
  );
}
