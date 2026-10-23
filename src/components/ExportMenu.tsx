import { useState } from "react";
import { FileDown, FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { errorText } from "@/lib/errors";
import { exportDoc, type ExportDoc, type ExportFormat } from "@/lib/export";
import { android } from "@/lib/native";
import { notify } from "@/lib/notify";

const FORMATS: { id: ExportFormat; icon: typeof FileText }[] = [
  { id: "pdf", icon: Printer },
  { id: "docx", icon: FileDown },
  { id: "md", icon: FileText },
];

/** Save-as buttons for any result: PDF, Word and Markdown, all from the same document model. */
export function ExportMenu({ build, stem, disabled }: { build: () => ExportDoc; stem: string; disabled?: boolean }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const label: Record<ExportFormat, string> = { pdf: t.exportPdf, docx: t.exportWord, md: t.exportMd };

  async function run(format: ExportFormat) {
    setBusy(format);
    try {
      const where = await exportDoc(build(), format, stem);
      // Android already shows a native "saved to" toast.
      if (where && !android) notify({ title: t.exportSaved, body: where, tone: "success" });
    } catch (e) {
      notify({ title: t.exportFailed, body: errorText(e, t), tone: "warning" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t.exportAs}>
      <span className="text-xs text-muted-foreground">{t.exportAs}</span>
      {FORMATS.map(({ id, icon: Icon }) => (
        <Button key={id} variant="outline" size="sm" disabled={disabled || busy !== null} onClick={() => run(id)} aria-label={`${t.exportAs} ${label[id]}`}>
          <Icon aria-hidden />
          {label[id]}
        </Button>
      ))}
    </div>
  );
}
