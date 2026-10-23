import { useRef, useState } from "react";
import { MessageCircleQuestion, Square } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormattedText } from "@/components/FormattedText";
import { useI18n, type Lang } from "@/i18n";
import { abortAll } from "@/lib/engine";
import { errorText } from "@/lib/errors";
import { modelsOf, recorder, saveRun, useHistory } from "@/lib/history";
import { ExportMenu } from "@/components/ExportMenu";
import { answerDoc, fileStem } from "@/lib/export";
import { Rating } from "@/components/HistoryDialog";
import type { Bm25 } from "@/lib/nlp";
import { Aborted, ask, type Answer } from "@/lib/pipeline";
import { perFrame } from "@/lib/utils";

interface Turn {
  id: number;
  entryId: string | null;
  question: string;
  answer: Answer | null; // null = nothing in the document matched
  lang: Lang;
}

export function Ask({
  passages,
  index,
  budgetChars,
  docName,
  notReady,
  outLang,
}: {
  passages: string[];
  index: Bm25 | null;
  budgetChars: number;
  docName: string;
  notReady: string;
  outLang: Lang;
}) {
  const { t } = useI18n();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [openSource, setOpenSource] = useState<string | null>(null);
  const nextId = useRef(0);
  const history = useHistory();
  const blocked = !passages.length || !index ? t.needDoc : notReady;

  async function submit() {
    const q = question.trim();
    if (!q || !index || streaming !== null) return;
    setError("");
    setStreaming("");
    const stream = perFrame(setStreaming);
    try {
      const rec = recorder();
      const answer = await ask({ question: q, passages, index, budgetChars, lang: outLang, onToken: stream, record: rec.record });
      const entryId = answer ? await saveRun("ask", { docName, title: q, lang: outLang, quality: "-", output: answer.text, data: answer.sources }, rec) : null;
      setTurns((ts) => [{ id: nextId.current++, entryId, question: q, answer, lang: outLang }, ...ts]);
      setQuestion("");
    } catch (e) {
      if (!(e instanceof Aborted)) setError(errorText(e, t));
    } finally {
      stream.cancel();
      setStreaming(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.askTitle}</CardTitle>
        <CardDescription>{t.askDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="sr-only" htmlFor="ask-input">
            {t.askTitle}
          </label>
          <input
            id="ask-input"
            dir="auto"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t.askPlaceholder}
            disabled={!!blocked}
            className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm placeholder:text-muted-foreground disabled:opacity-50"
          />
          {streaming !== null ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => abortAll()}
            >
              <Square aria-hidden />
              {t.stop}
            </Button>
          ) : (
            <Button type="submit" variant="accent" disabled={!!blocked || !question.trim()}>
              <MessageCircleQuestion aria-hidden />
              {t.askBtn}
            </Button>
          )}
        </form>
        {blocked && <p className="text-sm text-muted-foreground">{blocked}</p>}
        {error && (
          <p className="rounded-md bg-danger/10 p-3 text-sm text-danger" dir="auto">
            {t.error}: {error}
          </p>
        )}

        {streaming !== null && (
          <div className="rounded-lg bg-muted p-4 text-sm" dir={outLang === "ar" ? "rtl" : "ltr"} aria-live="polite">
            <FormattedText text={streaming || "…"} />
          </div>
        )}

        {turns.some((x) => x.answer) && (
          <ExportMenu
            stem={fileStem(docName, "qa")}
            build={() =>
              answerDoc(
                // Oldest first, like a transcript; turns are stored newest first for the screen.
                [...turns].reverse().flatMap((x) => (x.answer ? [{ question: x.question, text: x.answer.text, sources: x.answer.sources }] : [])),
                { docName, lang: turns[0].lang, models: [...new Set(turns.flatMap((x) => modelsOf(x.entryId, history)))] },
              )
            }
          />
        )}

        <ol className="space-y-4">
          {turns.map((turn) => (
            <li key={turn.id} className="rounded-lg border border-border p-4" dir={turn.lang === "ar" ? "rtl" : "ltr"} lang={turn.lang}>
              <p className="mb-2 font-semibold [overflow-wrap:anywhere]" dir="auto">
                {turn.question}
              </p>
              {!turn.answer ? (
                <p className="text-sm text-muted-foreground">{t.noMatch}</p>
              ) : (
                <>
                  <div className="text-sm">
                    <FormattedText text={turn.answer.text} onCite={(n) => setOpenSource(`${turn.id}:${n}`)} />
                  </div>
                  {turn.entryId && (
                    <div className="mt-2">
                      <Rating id={turn.entryId} rating={history.find((h) => h.id === turn.entryId)?.rating} />
                    </div>
                  )}
                  <details className="mt-3 text-xs" open={openSource?.startsWith(`${turn.id}:`)}>
                    <summary className="cursor-pointer text-muted-foreground">
                      {t.sources} ({turn.answer.sources.length})
                    </summary>
                    <ol className="mt-2 space-y-2">
                      {turn.answer.sources.map((s) => (
                        <li
                          key={s.n}
                          dir="auto"
                          className={`[overflow-wrap:anywhere] rounded-md p-2 ${openSource === `${turn.id}:${s.n}` ? "bg-accent/15" : "bg-muted"}`}
                        >
                          <span className="me-1 font-semibold text-accent">[{s.n}]</span>
                          {s.text.length > 400 ? `${s.text.slice(0, 400)}…` : s.text}
                        </li>
                      ))}
                    </ol>
                  </details>
                </>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
