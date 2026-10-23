import { useEffect, useState } from "react";
import { BookOpenText, Download, GraduationCap, MessageCircleQuestion, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormattedText } from "@/components/FormattedText";
import { useI18n } from "@/i18n";
import { clearHistory, deleteHistory, download, modelsOf, rateHistory, refreshHistory, toTrainingJsonl, useHistory, type HistoryKind } from "@/lib/history";
import { ExportMenu } from "@/components/ExportMenu";
import { fileStem, historyDoc } from "@/lib/export";
import { cn } from "@/lib/utils";

const ICON: Record<HistoryKind, typeof BookOpenText> = { summary: BookOpenText, study: GraduationCap, ask: MessageCircleQuestion };

export function Rating({ id, rating }: { id: string; rating?: 1 | -1 }) {
  const { t } = useI18n();
  const btn = "inline-flex size-8 items-center justify-center rounded-md border border-border hover:bg-muted [&_svg]:size-4";
  return (
    <span className="inline-flex gap-1">
      <button type="button" aria-label={t.rateUp} aria-pressed={rating === 1} className={cn(btn, rating === 1 && "border-success bg-success/15 text-success")} onClick={() => rateHistory(id, rating === 1 ? undefined : 1)}>
        <ThumbsUp />
      </button>
      <button type="button" aria-label={t.rateDown} aria-pressed={rating === -1} className={cn(btn, rating === -1 && "border-danger bg-danger/15 text-danger")} onClick={() => rateHistory(id, rating === -1 ? undefined : -1)}>
        <ThumbsDown />
      </button>
    </span>
  );
}

export function HistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const entries = useHistory();
  const [openId, setOpenId] = useState<string | null>(null);
  const [onlyLiked, setOnlyLiked] = useState(false);

  useEffect(() => {
    if (open) refreshHistory();
  }, [open]);

  const exportTraining = () => {
    const jsonl = toTrainingJsonl(entries, onlyLiked);
    download(`lexi-training-${new Date().toISOString().slice(0, 10)}.jsonl`, jsonl, "application/jsonl");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.history}
      closeLabel={t.close}
      wide
      footer={
        <>
          <Button variant="outline" size="sm" onClick={exportTraining} disabled={!entries.length}>
            <Download />
            {t.exportTraining}
          </Button>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" className="accent-[var(--accent)]" checked={onlyLiked} onChange={(e) => setOnlyLiked(e.target.checked)} />
            {t.exportTrainingLiked}
          </label>
          <Button variant="outline" size="sm" onClick={() => download("lexi-history.json", JSON.stringify(entries, null, 2), "application/json")} disabled={!entries.length}>
            <Download />
            {t.exportHistory}
          </Button>
          <Button variant="destructive" size="sm" className="ms-auto" disabled={!entries.length} onClick={() => confirm(t.confirmDeleteAll) && clearHistory()}>
            <Trash2 />
            {t.deleteAll}
          </Button>
        </>
      }
    >
      <p className="mb-4 rounded-lg bg-muted p-3 text-xs text-muted-foreground">{t.trainingNote}</p>
      {!entries.length ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t.historyEmpty}</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => {
            const Icon = ICON[e.kind];
            const expanded = openId === e.id;
            return (
              <li key={e.id} className="rounded-lg border border-border">
                {/* Phones: title on its own full-width line, actions underneath; side by side from sm up. */}
                <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <Icon className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium [overflow-wrap:anywhere]" dir="auto">
                        {e.title}
                      </p>
                      <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        <span dir="auto">{e.docName}</span> · {new Date(e.createdAt).toLocaleString(lang === "ar" ? "ar" : "en")}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge>{e.mode}</Badge>
                        <Badge>{e.quality}</Badge>
                        {e.models.map((m) => (
                          <Badge key={m} variant="accent" className="max-w-full">
                            <span dir="ltr" className="truncate">
                              {m.replace(/-q\d\w*-MLC$/, "")}
                            </span>
                          </Badge>
                        ))}
                        <Badge>{e.pairs.length} pairs</Badge>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 self-end sm:self-auto">
                    <Rating id={e.id} rating={e.rating} />
                    <Button variant="outline" size="sm" onClick={() => setOpenId(expanded ? null : e.id)}>
                      {expanded ? t.hide : t.view}
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8" aria-label={t.deleteEntry} onClick={() => deleteHistory(e.id)}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                {expanded && (
                  <div className="border-t border-border bg-muted/50">
                    <div className="border-b border-border px-4 py-2">
                      <ExportMenu stem={fileStem(e.docName, e.kind)} build={() => historyDoc({ ...e, models: modelsOf(e.id, entries) })} />
                    </div>
                    <div className="max-h-96 overflow-y-auto p-4 text-sm [overflow-wrap:anywhere]" dir={e.lang === "ar" ? "rtl" : "ltr"}>
                      <FormattedText text={e.output} />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
