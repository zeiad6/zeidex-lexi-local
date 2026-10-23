// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 ZeidexSoft — https://zeidexsoft.com
import { useEffect, useMemo, useState } from "react";
import {
  BookOpenText,
  Cloud,
  GraduationCap,
  Heart,
  Languages,
  MessageCircleQuestion,
  Moon,
  ScrollText,
  Settings as SettingsIcon,
  Share2,
  ShieldCheck,
  Sun,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Importer } from "@/components/Importer";
import { EngineDashboard } from "@/components/EngineDashboard";
import { Summarizer } from "@/components/Summarizer";
import { Study } from "@/components/Study";
import { Ask } from "@/components/Ask";
import { Tabs } from "@/components/Tabs";
import { Segmented } from "@/components/Segmented";
import { SettingsDialog } from "@/components/SettingsDialog";
import { HistoryDialog } from "@/components/HistoryDialog";
import { DonateDialog } from "@/components/DonateDialog";
import { ShareDialog } from "@/components/ShareDialog";
import { Toasts } from "@/components/Toasts";
import { BRAND } from "@/brand";
import { dictionaries, I18nContext, type Lang } from "@/i18n";
import { resolveProvider } from "@/lib/cloud";
import { checkGpu, type GpuReport } from "@/lib/gpu";
import { refreshHistory } from "@/lib/history";
import { android, job } from "@/lib/native";
import { runAppUpdateCheck } from "@/lib/updateCheck";
import { useEngine } from "@/lib/llm-client";
import { recommendModel, WEBGPU_MODELS, type ModelOption } from "@/lib/models";
import { Bm25, keywords } from "@/lib/nlp";
import type { ExtractedDoc } from "@/lib/pdf";
import type { Quality } from "@/lib/pipeline";
import { updateSettings, useSettings, type ExecMode } from "@/lib/settings";
import { chunkText } from "@/lib/text";

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // Private mode: preferences just don't persist.
  }
};

// Cloud models have far larger windows than the 4K local ones; bigger chunks mean fewer, more coherent calls.
const CLOUD_CHUNK_CHARS = 24000;

type Dialog = "settings" | "history" | "donate" | "share" | null;

export default function App() {
  const [lang, setLang] = useState<Lang>(read("lang") === "en" ? "en" : "ar");
  const [outLang, setOutLang] = useState<Lang>(lang);
  const [quality, setQuality] = useState<Quality>((read("quality") as Quality) || "balanced");
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [gpu, setGpu] = useState<GpuReport | null>(null);
  const [model, setModel] = useState<ModelOption>(WEBGPU_MODELS[0]);
  const [doc, setDoc] = useState<ExtractedDoc | null>(null);
  const [tab, setTab] = useState<"summary" | "study" | "ask">("summary");
  const [dialog, setDialog] = useState<Dialog>(null);
  const engine = useEngine();
  const settings = useSettings();
  const t = dictionaries[lang];

  useEffect(() => {
    refreshHistory();
    checkGpu().then((r) => {
      setGpu(r);
      setModel(recommendModel(r));
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.title = t.appName;
    write("lang", lang);
  }, [lang, t.appName]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    write("theme", dark ? "dark" : "light");
    android?.setSystemBars(dark);
  }, [dark]);

  // The Android daily update job runs without the page, so it needs these two settings natively.
  useEffect(() => android?.configureUpdates(settings.checkAppUpdates, settings.updateUrl), [settings.checkAppUpdates, settings.updateUrl]);

  useEffect(() => write("quality", quality), [quality]);

  useEffect(() => {
    const id = setTimeout(() => runAppUpdateCheck(dictionaries[lang], false), 5000);
    return () => clearTimeout(id);
    // Once per launch; the check itself is rate-limited to once a day.
  }, []);

  // Model downloads run for minutes: keep the Android process alive and show progress in a notification.
  // Deliberately keyed on status/progress only: `t` and `engine.model` changing must not restart the job.
  useEffect(() => {
    if (engine.status === "loading") job.start(t.modelJob);
    else if (engine.status === "ready") job.end(t.modelJob, engine.model ?? "", true);
    else if (engine.status === "error") job.end(t.modelJob, engine.error ?? "", false);
    else if (engine.status === "paused") job.end(t.modelJob, t.installPaused, false);
  }, [engine.status]);
  useEffect(() => {
    if (engine.status === "loading") job.progress(t.modelJob, Math.round(engine.progress * 100), 100);
  }, [engine.progress]);

  const provider = resolveProvider(settings);
  const localOk = engine.status === "ready";
  const cloudOk = !!provider;
  const mode = settings.mode;
  const notReady =
    mode === "local"
      ? localOk ? "" : t.needEngine
      : mode === "cloud"
        ? cloudOk ? "" : t.cloudNotReady
        : mode === "hybrid"
          ? !localOk ? t.localNotReady : !cloudOk ? t.cloudNotReady : ""
          : localOk || cloudOk ? "" : t.needEngine;

  const chunkChars = settings.chunkChars || (mode === "cloud" && cloudOk ? CLOUD_CHUNK_CHARS : model.chunkChars);
  const chunks = useMemo(() => (doc ? chunkText(doc.text, chunkChars, settings.chunkOverlap) : []), [doc, chunkChars, settings.chunkOverlap]);
  const keyTerms = useMemo(() => (chunks.length && settings.keywordCount ? keywords(chunks, settings.keywordCount) : []), [chunks, settings.keywordCount]);
  const passages = useMemo(() => (doc ? chunkText(doc.text, settings.passageChars, 150) : []), [doc, settings.passageChars]);
  const index = useMemo(() => (passages.length ? new Bm25(passages) : null), [passages]);
  const webgpu = engine.backend === "webgpu";
  const sections = settings.studySections || (webgpu || mode === "cloud" ? (quality === "max" ? 6 : 4) : 2);
  const recommended = gpu ? recommendModel(gpu).id : undefined;
  const qualityHint = { fast: t.qFastHint, balanced: t.qBalancedHint, max: t.qMaxHint }[quality];
  const modeHint = { local: t.modeLocalHint, cloud: t.modeCloudHint, hybrid: t.modeHybridHint, smart: t.modeSmartHint }[mode];
  const docName = doc?.name ?? "document";
  const iconBtn = "size-8";

  return (
    <I18nContext.Provider value={{ lang, t }}>
      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-10 border-b border-border bg-card lg:bg-card/80 lg:backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
            <img src="./icon.svg" alt="" className="size-9" />
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-xl font-bold leading-tight">{t.appName}</h1>
              <p className="hidden text-sm text-muted-foreground sm:block">{t.tagline}</p>
            </div>
            {localOk && (
              <Badge variant="default">
                <Zap className="size-3 text-accent" aria-hidden />
                <span dir="ltr">
                  {engine.model?.split("-q")[0]} {engine.tps > 0 && `· ${engine.tps.toFixed(1)} tok/s`}
                </span>
              </Badge>
            )}
            {mode !== "local" && cloudOk && (
              <Badge variant="accent">
                <Cloud className="size-3" aria-hidden />
                <span dir="ltr">{provider!.model}</span>
              </Badge>
            )}
            {mode === "local" && (
              <span className="hidden lg:inline-flex">
                <Badge variant="success">
                  <ShieldCheck className="size-3.5" aria-hidden />
                  {t.privacy}
                </Badge>
              </span>
            )}
            <Button variant="outline" size="icon" className={iconBtn} onClick={() => setDialog("history")} aria-label={t.history} title={t.history}>
              <ScrollText />
            </Button>
            <Button variant="outline" size="icon" className={iconBtn} onClick={() => setDialog("share")} aria-label={t.share} title={t.share}>
              <Share2 />
            </Button>
            <Button variant="outline" size="icon" className={iconBtn} onClick={() => setDialog("donate")} aria-label={t.donate} title={t.donate}>
              <Heart className="text-danger" />
            </Button>
            <Button variant="outline" size="icon" className={iconBtn} onClick={() => setDialog("settings")} aria-label={t.settings} title={t.settings}>
              <SettingsIcon />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const next = lang === "ar" ? "en" : "ar";
                setLang(next);
                setOutLang(next);
              }}
            >
              <Languages aria-hidden />
              {t.toggleLang}
            </Button>
            <Button variant="outline" size="icon" className={iconBtn} onClick={() => setDark((d) => !d)} aria-label={t.toggleTheme}>
              {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
            </Button>
          </div>
        </header>

        {/* grid-cols-1 = minmax(0,1fr): an unbreakable word must never widen the phone layout (Android WebView zooms out). */}
        <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="min-w-0 space-y-6">
            <Importer doc={doc} chunkCount={chunks.length} keyTerms={keyTerms} onDoc={setDoc} />
            <EngineDashboard gpu={gpu} selected={model} recommended={recommended} onSelect={setModel} />
          </div>

          <div className="min-w-0">
            <section className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">{t.execMode}</p>
                <Segmented
                  label={t.execMode}
                  value={mode}
                  onChange={(m: ExecMode) => updateSettings({ mode: m })}
                  options={[
                    { value: "local", label: t.modeLocal },
                    { value: "cloud", label: t.modeCloud },
                    { value: "hybrid", label: t.modeHybrid },
                    { value: "smart", label: t.modeSmart },
                  ]}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">{t.quality}</p>
                <Segmented
                  label={t.quality}
                  value={quality}
                  onChange={setQuality}
                  options={[
                    { value: "fast", label: t.qFast },
                    { value: "balanced", label: t.qBalanced },
                    { value: "max", label: t.qMax },
                  ]}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">{t.outLang}</p>
                <Segmented
                  label={t.outLang}
                  value={outLang}
                  onChange={setOutLang}
                  options={[
                    { value: "ar", label: t.arabic },
                    { value: "en", label: t.english },
                  ]}
                />
              </div>
              <div className="basis-full space-y-1 text-xs text-muted-foreground">
                <p>{modeHint}</p>
                <p>{qualityHint}</p>
                {(mode === "cloud" || mode === "smart") && cloudOk && <p className="text-accent">{t.cloudPrivacy(provider!.def.name)}</p>}
                {mode !== "local" && !cloudOk && (
                  <button type="button" className="text-accent underline" onClick={() => setDialog("settings")}>
                    {t.cloudNotReady}
                  </button>
                )}
              </div>
            </section>

            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                {
                  value: "summary",
                  label: t.stepSummary,
                  icon: <BookOpenText aria-hidden />,
                  panel: (
                    <Summarizer
                      chunks={chunks}
                      chunkChars={chunkChars}
                      docName={docName}
                      model={engine.model ?? provider?.model ?? model.id}
                      notReady={notReady}
                      outLang={outLang}
                      quality={quality}
                      keyTerms={keyTerms}
                    />
                  ),
                },
                {
                  value: "study",
                  label: t.stepStudy,
                  icon: <GraduationCap aria-hidden />,
                  panel: (
                    <Study
                      chunks={chunks}
                      docName={docName}
                      notReady={notReady}
                      constrained={webgpu}
                      sections={sections}
                      outLang={outLang}
                      quality={quality}
                    />
                  ),
                },
                {
                  value: "ask",
                  label: t.stepAsk,
                  icon: <MessageCircleQuestion aria-hidden />,
                  panel: (
                    <Ask passages={passages} index={index} budgetChars={chunkChars} docName={docName} notReady={notReady} outLang={outLang} />
                  ),
                },
              ]}
            />
          </div>
        </main>

        <footer className="border-t border-border py-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()}{" "}
          <a href={BRAND.developerUrl} target="_blank" rel="noreferrer" className="font-semibold text-foreground underline-offset-4 hover:underline">
            {BRAND.developer}
          </a>{" "}
          · {BRAND.license} ·{" "}
          <button type="button" className="underline-offset-4 hover:underline" onClick={() => setDialog("donate")}>
            {t.donate}
          </button>
        </footer>

        <SettingsDialog open={dialog === "settings"} onClose={() => setDialog(null)} />
        <HistoryDialog open={dialog === "history"} onClose={() => setDialog(null)} />
        <DonateDialog open={dialog === "donate"} onClose={() => setDialog(null)} />
        <ShareDialog open={dialog === "share"} onClose={() => setDialog(null)} />
        <Toasts />
      </div>
    </I18nContext.Provider>
  );
}
