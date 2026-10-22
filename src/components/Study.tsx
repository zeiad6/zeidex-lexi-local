import { useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, RotateCcw, Square, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/Segmented";
import { useI18n, type Lang } from "@/i18n";
import { abortAll } from "@/lib/engine";
import { errorText } from "@/lib/errors";
import { recorder, saveRun, useHistory } from "@/lib/history";
import { Rating } from "@/components/HistoryDialog";
import { generateStudySet, type Quality, type StudyResult } from "@/lib/pipeline";
import type { Flashcard, Mcq } from "@/lib/text";
import { cn } from "@/lib/utils";

export function Study({
  chunks,
  docName,
  notReady,
  constrained,
  sections,
  outLang,
  quality,
}: {
  chunks: string[];
  docName: string;
  notReady: string;
  constrained: boolean;
  sections: number;
  outLang: Lang;
  quality: Quality;
}) {
  const { t } = useI18n();
  const [set, setSet] = useState<StudyResult | null>(null);
  const [progress, setProgress] = useState<{ step: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"mcq" | "cards">("mcq");
  const controller = useRef<AbortController | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const history = useHistory();

  async function start() {
    controller.current = new AbortController();
    setError("");
    setSet(null);
    setEntryId(null);
    setProgress({ step: 0, total: 1 });
    const rec = recorder();
    try {
      const s = await generateStudySet({
        chunks,
        sections,
        lang: outLang,
        quality,
        constrained,
        signal: controller.current.signal,
        onProgress: (step, total) => setProgress({ step, total }),
        record: rec.record,
      });
      setSet(s);
      if (!s.mcqs.length && !s.flashcards.length) setError(t.noItems);
      else {
        const output = [...s.mcqs.map((m, i) => `${i + 1}. ${m.question}\n• ${m.options[m.answer]}`), ...s.flashcards.map((f) => `Q: ${f.question}\nA: ${f.answer}`)].join("\n\n");
        setEntryId(await saveRun("study", { docName, title: s.mcqs[0]?.question ?? s.flashcards[0].question, lang: outLang, quality, output, data: s }, rec));
      }
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setProgress(null);
    }
  }

  const blocked = !chunks.length ? t.needDoc : notReady;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.studyTitle}</CardTitle>
        <CardDescription>{t.studyDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {progress ? (
            <Button
              variant="destructive"
              onClick={() => {
                controller.current?.abort();
                abortAll();
              }}
            >
              <Square aria-hidden />
              {t.stop}
            </Button>
          ) : (
            <Button variant="accent" onClick={start} disabled={!!blocked}>
              {set ? t.regenerate : t.generate}
            </Button>
          )}
          {blocked && <span className="text-sm text-muted-foreground">{blocked}</span>}
          {entryId && !progress && <Rating id={entryId} rating={history.find((h) => h.id === entryId)?.rating} />}
        </div>

        {progress && (
          <div className="space-y-1.5" aria-live="polite">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{t.generating}</span>
              <span dir="ltr">
                {progress.step} / {progress.total}
              </span>
            </div>
            <Progress value={(progress.step / progress.total) * 100} label={t.generating} />
          </div>
        )}

        {error && <p className="rounded-md bg-danger/10 p-3 text-sm text-danger">{error}</p>}

        {set && set.rejected > 0 && <p className="text-xs text-muted-foreground">{t.rejected(set.rejected)}</p>}

        {set && (set.mcqs.length > 0 || set.flashcards.length > 0) && (
          <div className="space-y-4" dir={outLang === "ar" ? "rtl" : "ltr"} lang={outLang}>
            <Segmented
              label={t.studyTitle}
              value={tab}
              onChange={setTab}
              options={[
                { value: "mcq", label: `${t.mcq} (${set.mcqs.length})` },
                { value: "cards", label: `${t.flashcards} (${set.flashcards.length})` },
              ]}
            />
            {tab === "mcq" ? <Quiz key={set.mcqs.length} mcqs={set.mcqs} /> : <Cards cards={set.flashcards} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Quiz({ mcqs }: { mcqs: Mcq[] }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const answered = Object.keys(checked).length;
  const score = mcqs.filter((m, i) => checked[i] && picked[i] === m.answer).length;

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">
        {t.score}: <span dir="ltr">{score} / {answered}</span>
      </p>
      <ol className="space-y-4">
        {mcqs.map((m, i) => {
          const done = checked[i];
          return (
            <li key={i} className="rounded-lg border border-border p-4">
              <fieldset disabled={done}>
                <legend className="mb-3 font-medium">
                  {i + 1}. {m.question}
                </legend>
                <div className="space-y-2">
                  {m.options.map((opt, j) => (
                    <label
                      key={j}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm transition-colors",
                        done && j === m.answer
                          ? "border-success bg-success/10"
                          : done && j === picked[i]
                            ? "border-danger bg-danger/10"
                            : picked[i] === j
                              ? "border-accent bg-accent/10"
                              : "border-border hover:bg-muted",
                      )}
                    >
                      <input
                        type="radio"
                        name={`q${i}`}
                        className="mt-0.5 accent-[var(--accent)]"
                        checked={picked[i] === j}
                        onChange={() => setPicked((p) => ({ ...p, [i]: j }))}
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              </fieldset>
              {!done ? (
                <Button
                  size="sm"
                  className="mt-3"
                  disabled={picked[i] === undefined}
                  onClick={() => setChecked((c) => ({ ...c, [i]: true }))}
                >
                  {t.check}
                </Button>
              ) : (
                <div className="mt-3 flex gap-2 text-sm" aria-live="polite">
                  {picked[i] === m.answer ? (
                    <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
                  ) : (
                    <XCircle className="size-5 shrink-0 text-danger" aria-hidden />
                  )}
                  <p>
                    {picked[i] === m.answer ? t.correct : `${t.wrong} ${m.options[m.answer]}`}
                    {m.explanation && <span className="block text-muted-foreground">{m.explanation}</span>}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Cards({ cards }: { cards: Flashcard[] }) {
  const { t } = useI18n();
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  if (!cards.length) return null;
  const card = cards[Math.min(i, cards.length - 1)];
  const go = (d: number) => {
    setI((v) => (v + d + cards.length) % cards.length);
    setFlipped(false);
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? t.hideAnswer : t.showAnswer}
        className={cn(
          "flex min-h-48 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 p-6 text-center transition-colors",
          flipped ? "border-accent bg-accent/10" : "border-border bg-muted hover:border-accent/60",
        )}
      >
        <span className="font-display text-lg font-semibold">{card.question}</span>
        {flipped ? (
          <span className="leading-relaxed">{card.answer}</span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <RotateCcw className="size-3" aria-hidden />
            {t.showAnswer}
          </span>
        )}
      </button>
      <div className="flex items-center justify-between">
        {/* Chevrons mirror under RTL so "previous" always points back along the reading direction. */}
        <Button variant="outline" size="sm" onClick={() => go(-1)}>
          <ChevronLeft className="rtl:rotate-180" aria-hidden />
          {t.prev}
        </Button>
        <span className="text-sm text-muted-foreground" dir="ltr">
          {i + 1} / {cards.length}
        </span>
        <Button variant="outline" size="sm" onClick={() => go(1)}>
          {t.next}
          <ChevronRight className="rtl:rotate-180" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
