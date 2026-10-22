import { useRef, useState } from "react";
import { Check, Copy, Download, Square } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/Segmented";
import { FormattedText } from "@/components/FormattedText";
import { useI18n, type Lang } from "@/i18n";
import { abortAll } from "@/lib/engine";
import { errorText } from "@/lib/errors";
import { recorder, saveRun, titleOf, useHistory } from "@/lib/history";
import { Rating } from "@/components/HistoryDialog";
import { Aborted, estimateCalls, summarize, type Quality, type SummaryProgress } from "@/lib/pipeline";
import type { SummaryFormat } from "@/lib/prompts";
import { formatDuration } from "@/lib/utils";

export function Summarizer({
  chunks,
  chunkChars,
  docName,
  model,
  notReady,
  outLang,
  quality,
  keyTerms,
}: {
  chunks: string[];
  chunkChars: number;
  docName: string;
  model: string;
  notReady: string;
  outLang: Lang;
  quality: Quality;
  keyTerms: string[];
}) {
  const { t } = useI18n();
  const [format, setFormat] = useState<SummaryFormat>("bullets");
  const [output, setOutput] = useState("");
  const [outputLang, setOutputLang] = useState<Lang>(outLang);
  const [progress, setProgress] = useState<SummaryProgress | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [entryId, setEntryId] = useState<string | null>(null);
  const history = useHistory();
  const controller = useRef<AbortController | null>(null);
  const running = !!progress;

  async function start() {
    controller.current = new AbortController();
    setOutput("");
    setOutputLang(outLang);
    setError("");
    setEntryId(null);
    const rec = recorder();
    try {
      const text = await summarize({
        chunks,
        chunkChars,
        format,
        lang: outLang,
        quality,
        model,
        keyTerms,
        signal: controller.current.signal,
        onProgress: setProgress,
        onToken: setOutput,
        record: rec.record,
      });
      setOutput(text);
      setEntryId(await saveRun("summary", { docName, title: titleOf(text), lang: outLang, quality, output: text }, rec));
    } catch (e) {
      if (!(e instanceof Aborted)) setError(errorText(e, t));
    } finally {
      setProgress(null);
    }
  }

  function stop() {
    controller.current?.abort();
    abortAll();
  }

  const phaseLabel =
    progress &&
    { compress: t.phaseCompress, map: t.phaseMap, reduce: t.phaseReduce, final: t.phaseFinal, refine: t.phaseRefine }[
      progress.phase
    ];
  const blocked = !chunks.length ? t.needDoc : notReady;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.summaryTitle}</CardTitle>
        <CardDescription>{t.summaryDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{t.format}</p>
          <Segmented
            label={t.format}
            value={format}
            onChange={setFormat}
            disabled={running}
            options={[
              { value: "bullets", label: t.fmtBullets },
              { value: "executive", label: t.fmtExecutive },
              { value: "exam", label: t.fmtExam },
            ]}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {running ? (
            <Button variant="destructive" onClick={stop}>
              <Square aria-hidden />
              {t.stop}
            </Button>
          ) : (
            <Button variant="accent" onClick={start} disabled={!!blocked}>
              {t.summarize}
            </Button>
          )}
          {blocked ? (
            <span className="text-sm text-muted-foreground">{blocked}</span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {t.estimate}: {estimateCalls(chunks.length, chunkChars, quality)}
            </span>
          )}
        </div>

        {progress && (
          <div className="space-y-1.5" aria-live="polite">
            <div className="flex justify-between gap-3 text-xs text-muted-foreground">
              <span>{phaseLabel}</span>
              <span dir="ltr">
                {progress.step} / {progress.total}
                {progress.eta !== undefined && progress.eta > 0 && ` · ${formatDuration(progress.eta)} ${t.remaining}`}
              </span>
            </div>
            <Progress
              value={["final", "refine", "compress"].includes(progress.phase) ? 100 : (progress.step / progress.total) * 100}
              label={phaseLabel ?? ""}
            />
          </div>
        )}

        {error && (
          <p className="rounded-md bg-danger/10 p-3 text-sm text-danger" dir="auto">
            {t.error}: {error}
          </p>
        )}

        {output && (
          <div className="space-y-2">
            <div className="flex flex-wrap justify-end gap-2">
              {entryId && !running && <Rating id={entryId} rating={history.find((h) => h.id === entryId)?.rating} />}
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(output);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? t.copied : t.copy}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const url = URL.createObjectURL(new Blob([output], { type: "text/markdown;charset=utf-8" }));
                  const a = Object.assign(document.createElement("a"), {
                    href: url,
                    download: `${docName.replace(/\.[^.]+$/, "")}-summary.md`,
                  });
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download aria-hidden />
                {t.download}
              </Button>
            </div>
            <article
              dir={outputLang === "ar" ? "rtl" : "ltr"}
              lang={outputLang}
              className="max-h-[36rem] overflow-y-auto rounded-lg bg-muted p-5"
            >
              <FormattedText text={output} />
            </article>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
