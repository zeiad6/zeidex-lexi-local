import { useEffect, useRef, useState } from "react";
import { Eraser, FileText, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { extractFile, type ExtractedDoc } from "@/lib/pdf";
import { CONVERTIBLE } from "@/lib/convert";
import { onOpenFile } from "@/lib/native";
import { cn } from "@/lib/utils";

const ACCEPT = [".pdf", ".txt", ".md", ".markdown", ...CONVERTIBLE.map((e) => `.${e}`), "application/pdf", "text/plain", "text/markdown"].join(",");

export function Importer({
  doc,
  chunkCount,
  keyTerms,
  onDoc,
}: {
  doc: ExtractedDoc | null;
  chunkCount: number;
  keyTerms: string[];
  onDoc: (d: ExtractedDoc | null) => void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");

  // "Open with / Share to Lexi" on Android hands files over through the bridge.
  useEffect(() => onOpenFile((f) => handle(f)));

  async function handle(file: File | undefined) {
    if (!file) return;
    setError("");
    setProgress({ done: 0, total: 1 });
    try {
      const d = await extractFile(file, (done, total) => setProgress({ done, total }));
      if (d.text.trim().length < 50) {
        setError(t.noText);
        onDoc(null);
      } else onDoc(d);
    } catch (e) {
      setError(e instanceof Error && e.message === "unsupported" ? t.unsupported : `${t.error}: ${String(e)}`);
    } finally {
      setProgress(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.importTitle}</CardTitle>
        <CardDescription>{t.importDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            handle(e.dataTransfer.files[0]);
          }}
          disabled={!!progress}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-sm transition-colors",
            drag ? "border-accent bg-accent/10" : "border-border hover:bg-muted",
          )}
        >
          <Upload className="size-6 text-muted-foreground" aria-hidden />
          <span>{drag ? t.dropActive : doc ? t.replace : t.dropHere}</span>
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => {
            handle(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {progress && (
          <div className="space-y-1.5" aria-live="polite">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{t.extracting}</span>
              <span dir="ltr">
                {progress.done} / {progress.total}
              </span>
            </div>
            <Progress value={(progress.done / progress.total) * 100} label={t.extracting} />
          </div>
        )}

        {error && <p className="rounded-md bg-danger/10 p-3 text-sm text-danger">{error}</p>}

        {doc && !progress && (
          <div className="flex items-start gap-3 rounded-lg bg-muted p-3">
            <FileText className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium" dir="auto">
                {doc.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {/* "label: n" sidesteps Arabic number–noun agreement (3 صفحات vs 11 صفحة). */}
                {t.pages}: {doc.pages.toLocaleString()} · {t.chars}: {doc.text.length.toLocaleString()} · {t.chunks}:{" "}
                {chunkCount}
              </p>
            </div>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => onDoc(null)} aria-label={t.remove}>
              <X />
            </Button>
          </div>
        )}

        {doc && !progress && (doc.removedLines > 0 || doc.referencesCut) && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
            <Eraser className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
            {[doc.removedLines > 0 && t.cleanedLines(doc.removedLines), doc.referencesCut && t.refsCut].filter(Boolean).join(" · ")}
          </p>
        )}

        {doc && !progress && keyTerms.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{t.keyTerms}</p>
            <ul className="flex flex-wrap gap-1.5">
              {keyTerms.map((k) => (
                <li key={k} className="min-w-0 max-w-full">
                  <Badge variant="accent" dir="auto" title={k} className="block max-w-full truncate">
                    {k}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
