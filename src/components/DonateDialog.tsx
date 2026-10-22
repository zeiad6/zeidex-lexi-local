import { Heart } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { BRAND } from "@/brand";
import { useI18n } from "@/i18n";

export function DonateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  return (
    <Modal open={open} onClose={onClose} title={t.donateTitle} closeLabel={t.close}>
      <div className="space-y-4">
        <p className="flex gap-2 text-sm text-muted-foreground">
          <Heart className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          {t.donateDesc}
        </p>
        <ul className="space-y-2">
          {BRAND.donate.map((d) => (
            <li key={d.id}>
              <a
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-xl border border-border p-4 transition-colors hover:border-accent hover:bg-accent/10"
              >
                <span className="text-2xl" aria-hidden>
                  {d.icon}
                </span>
                <span>
                  <span className="block font-semibold">{d.label[lang]}</span>
                  <span className="block text-xs text-muted-foreground">{d.desc[lang]}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
        <p className="text-center text-xs text-muted-foreground">
          {t.developedBy}{" "}
          <a href={BRAND.developerUrl} target="_blank" rel="noreferrer" className="font-semibold underline-offset-4 hover:underline">
            {BRAND.developer}
          </a>
        </p>
      </div>
    </Modal>
  );
}
