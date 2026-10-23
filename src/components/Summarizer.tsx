import { useRef, useState } from "react";
import { AlertTriangle, Check, Copy, ShieldCheck, Square } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/Segmented";
import { FormattedText } from "@/components/FormattedText";
import { useI18n, type Lang } from "@/i18n";
import { abortAll } from "@/lib/engine";
import { errorText } from "@/lib/errors";
import { modelsOf, recorder, saveRun, titleOf, useHistory } from "@/lib/history";
import { ExportMenu } from "@/components/ExportMenu";
import { fileStem, summaryDoc } from "@/lib/export";
import { copyText, job } from "@/lib/native";
import { Rating } from "@/components/HistoryDialog";
import { Aborted, estimateCalls, summarize, type Quality, type RunStats, type SummaryProgress } from "@/lib/pipeline";
import type { SummaryFormat } from "@/lib/prompts";
import { formatDuration, perFrame } from "@/lib/utils";

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
  const [stats, setStats] = useState<RunStats | null>(null);
  const history = useHistory();
  const controller = useRef<AbortController | null>(null);
  const running = !!progress;

  async function start() {
    controller.current = new AbortController();
    setOutput("");
    setOutputLang(outLang);
    setError("");
    setEntryId(null);
    setStats(null);
    const rec = recorder();
    job.start(t.summaryTitle);
    const stream = perFrame(setOutput);
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
        onProgress: (p) => {
          setProgress(p);
          job.progress(t.summaryTitle, p.step, p.total);
        },
        onToken: stream,
        record: rec.record,
        onStats: setStats,
      });
      stream.cancel();
      setOutput(text);
      job.end(t.summaryTitle, titleOf(text), true);
      setEntryId(await saveRun("summary", { docName, title: titleOf(text), lang: outLang, quality, output: text }, rec));
    } catch (e) {
      if (!(e instanceof Aborted)) setError(errorText(e, t));
      job.end(t.summaryTitle, e instanceof Aborted ? t.stop : errorText(e, t), false);
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
                  await copyText(output);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? t.copied : t.copy}
              </Button>
            </div>
            {!running && stats && <RunReport stats={stats} />}
            {!running && (
              <ExportMenu
                stem={fileStem(docName, "summary")}
                build={() => summaryDoc(output, { docName, lang: outputLang, quality, models: modelsOf(entryId, history) })}
              />
            )}
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

/** Accuracy and token-saving facts about the finished run. */
function RunReport({ stats }: { stats: RunStats }) {
  const { t, lang } = useI18n();
  const g = stats.grounding;
  const saved = [
    stats.cachedSections && t.savedCached(stats.cachedSections),
    stats.duplicateSections && t.savedDuplicates(stats.duplicateSections),
    stats.refineSkipped && t.savedRefine,
  ].filter(Boolean);
  return (
    <div className="space-y-1.5 text-xs" aria-live="polite">
      {g && g.unsupported.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-md bg-accent/15 p-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
          <span>
            {t.groundUnsupported}{" "}
            <span dir="ltr" className="font-semibold">
              {g.unsupported.join(", ")}
            </span>
          </span>
        </p>
      )}
      {g && !g.unsupported.length && g.checked > 0 && (
        <p className="flex items-center gap-1.5 text-success">
          <ShieldCheck className="size-3.5" aria-hidden />
          {t.groundVerified(g.checked)}
        </p>
      )}
      {g && g.coverage < 1 && (
        <p className="text-muted-foreground">
          {t.groundCoverage}: <span dir="ltr">{Math.round(g.coverage * 100)}%</span>
          {g.missingTerms.length > 0 && <> · {g.missingTerms.join(lang === "ar" ? "، " : ", ")}</>}
        </p>
      )}
      {stats.savedTokens > 0 && (
        <p className="text-muted-foreground">
          {t.savedTokens(Math.round(stats.savedTokens / 100) / 10)} — {saved.join(" · ")}
        </p>
      )}
    </div>
  );
}
