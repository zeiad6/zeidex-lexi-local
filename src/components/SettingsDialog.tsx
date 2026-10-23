import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Eye, EyeOff, ListRestart, RotateCcw, Upload } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { About } from "@/components/About";
import { useI18n, type Lang } from "@/i18n";
import { CloudError, listModels, PROVIDERS, resolveEndpoint } from "@/lib/cloud";
import { nativeFetch } from "@/lib/native";
import { download } from "@/lib/history";
import { runAppUpdateCheck } from "@/lib/updateCheck";
import { notify } from "@/lib/notify";
import {
  DEFAULTS,
  exportSettings,
  getSettings,
  importSettings,
  LIMITS,
  resetSettings,
  updateSettings,
  useSettings,
  type Settings,
} from "@/lib/settings";
import { cn } from "@/lib/utils";

type L = Record<Lang, string>;
type Field =
  | { key: keyof Settings; type: "number"; label: L; help?: L; step?: number }
  | { key: keyof Settings; type: "toggle"; label: L; help?: L }
  | { key: keyof Settings; type: "text" | "textarea"; label: L; help?: L; placeholder?: string }
  | { key: keyof Settings; type: "select"; label: L; help?: L; options: { value: string; label: L }[] };

type SectionId = "exec" | "engine" | "gen" | "doc" | "data" | "about";

const SECTIONS: { id: SectionId; label: L; fields: Field[] }[] = [
  {
    id: "exec",
    label: { ar: "التنفيذ والسحابة", en: "Execution & cloud" },
    fields: [
      {
        key: "mode",
        type: "select",
        label: { ar: "طريقة التنفيذ", en: "Execution mode" },
        options: [
          { value: "local", label: { ar: "محلي فقط", en: "Local only" } },
          { value: "cloud", label: { ar: "سحابي فقط", en: "Cloud only" } },
          { value: "hybrid", label: { ar: "معًا: المحلي يقرأ والسحابي يكتب", en: "Together: local reads, cloud writes" } },
          { value: "smart", label: { ar: "ذكي: يختار لكل خطوة", en: "Smart: picks per step" } },
        ],
      },
      {
        key: "useProxy",
        type: "toggle",
        label: { ar: "استخدام الوسيط المحلي", en: "Use local proxy" },
        help: {
          ar: "يمرّر طلبات السحابة عبر خادم التطبيق (سطح المكتب / Docker / npm run serve) لتجاوز قيود CORS في المتصفح.",
          en: "Routes cloud calls through the app's server (desktop / Docker / npm run serve) to bypass browser CORS limits.",
        },
      },
    ],
  },
  {
    id: "engine",
    label: { ar: "المحرّك المحلي", en: "Local engine" },
    fields: [
      {
        key: "backend",
        type: "select",
        label: { ar: "واجهة التشغيل", en: "Backend" },
        help: { ar: "فرض WASM يفيد عندما يفشل WebGPU رغم اكتشافه.", en: "Forcing WASM helps when WebGPU is detected but crashes." },
        options: [
          { value: "auto", label: { ar: "تلقائي", en: "Automatic" } },
          { value: "webgpu", label: { ar: "WebGPU دائمًا", en: "Always WebGPU" } },
          { value: "wasm", label: { ar: "WASM (المعالج) دائمًا", en: "Always WASM (CPU)" } },
        ],
      },
      {
        key: "gpuPrecision",
        type: "select",
        label: { ar: "دقة حساب معالج الرسوميات", en: "GPU precision" },
        help: {
          ar: "التلقائي يستخدم 16-بت على الحاسوب و32-بت على الهاتف، لأن معالجات الهواتف قد تُخرج نصًا مشوّهًا بدقة 16-بت. يحتاج 32-بت ذاكرة أكثر بنحو 15% وتنزيلًا جديدًا للنموذج.",
          en: "Automatic uses 16-bit on computers and 32-bit on phones, whose GPUs can turn 16-bit output into garbled text. 32-bit needs about 15% more GPU memory and a new model download.",
        },
        options: [
          { value: "auto", label: { ar: "تلقائي", en: "Automatic" } },
          { value: "f16", label: { ar: "16-بت (أسرع)", en: "16-bit (faster)" } },
          { value: "f32", label: { ar: "32-بت (أدق)", en: "32-bit (accurate)" } },
        ],
      },
      {
        key: "customWebllmModel",
        type: "text",
        label: { ar: "نموذج WebLLM مخصّص", en: "Custom WebLLM model" },
        help: { ar: "أي معرّف من قائمة WebLLM الجاهزة، مثل Qwen3-4B-q4f16_1-MLC.", en: "Any WebLLM prebuilt id, e.g. Qwen3-4B-q4f16_1-MLC." },
        placeholder: "Qwen3-4B-q4f16_1-MLC",
      },
      {
        key: "cpuModel",
        type: "text",
        label: { ar: "نموذج المعالج (Hugging Face)", en: "CPU model (Hugging Face)" },
        help: { ar: "مستودع ONNX متوافق مع Transformers.js.", en: "An ONNX repo compatible with Transformers.js." },
      },
      {
        key: "cpuDtype",
        type: "select",
        label: { ar: "دقة نموذج المعالج", en: "CPU model precision" },
        options: (["q4", "q8", "fp16", "fp32"] as const).map((v) => ({ value: v, label: { ar: v, en: v } })),
      },
      {
        key: "contextTokens",
        type: "number",
        step: 1024,
        label: { ar: "نافذة السياق (رموز)", en: "Context window (tokens)" },
        help: { ar: "رفعها يقلل عدد الاستدعاءات لكنه يستهلك ذاكرة رسوميات أكثر. يُطبَّق عند تحميل النموذج التالي.", en: "Larger means fewer calls but more VRAM. Applies on next model load." },
      },
    ],
  },
  {
    id: "gen",
    label: { ar: "التوليد", en: "Generation" },
    fields: [
      { key: "temperature", type: "number", step: 0.05, label: { ar: "الحرارة (temperature)", en: "Temperature" } },
      { key: "topP", type: "number", step: 0.05, label: { ar: "top_p", en: "top_p" } },
      { key: "frequencyPenalty", type: "number", step: 0.05, label: { ar: "عقوبة التكرار", en: "Frequency penalty" } },
      { key: "notesTokens", type: "number", step: 50, label: { ar: "رموز ملاحظات المقطع", en: "Notes tokens per chunk" } },
      { key: "finalTokens", type: "number", step: 100, label: { ar: "رموز الناتج النهائي", en: "Final output tokens" } },
      { key: "refineTokens", type: "number", step: 100, label: { ar: "رموز المراجعة الذاتية", en: "Refine pass tokens" } },
      { key: "studyTokens", type: "number", step: 100, label: { ar: "رموز توليد الأسئلة", en: "Quiz generation tokens" } },
      { key: "answerTokens", type: "number", step: 50, label: { ar: "رموز إجابة «اسأل»", en: "Ask answer tokens" } },
      { key: "loopGuard", type: "toggle", label: { ar: "حارس حلقات التكرار", en: "Loop guard" } },
      {
        key: "extraInstructions",
        type: "textarea",
        label: { ar: "تعليمات إضافية لكل النماذج", en: "Extra instructions for every model" },
        help: { ar: "تُلحَق بتعليمات النظام، مثل: «استخدم مصطلحات طبية دقيقة».", en: "Appended to the system prompt, e.g. “use precise medical terminology”." },
      },
    ],
  },
  {
    id: "doc",
    label: { ar: "المستند", en: "Document" },
    fields: [
      {
        key: "chunkChars",
        type: "number",
        step: 500,
        label: { ar: "حجم المقطع (أحرف)", en: "Chunk size (characters)" },
        help: { ar: "0 = تلقائي حسب النموذج (أكبر بكثير في الوضع السحابي).", en: "0 = automatic per model (much larger in Cloud mode)." },
      },
      { key: "chunkOverlap", type: "number", step: 50, label: { ar: "التداخل بين المقاطع", en: "Chunk overlap" } },
      { key: "removeHeaders", type: "toggle", label: { ar: "حذف الترويسة والتذييل وأرقام الصفحات", en: "Remove headers, footers, page numbers" } },
      { key: "cutReferences", type: "toggle", label: { ar: "استبعاد قائمة المراجع", en: "Exclude the reference list" } },
      { key: "passageChars", type: "number", step: 100, label: { ar: "حجم مقطع البحث في «اسأل»", en: "Ask passage size" } },
      { key: "keywordCount", type: "number", label: { ar: "عدد المصطلحات المحورية", en: "Key terms count" } },
      { key: "fastMaxChunks", type: "number", label: { ar: "أقصى قراءات في الوضع السريع", en: "Max reads in Fast mode" } },
      { key: "studySections", type: "number", label: { ar: "أقسام توليد الأسئلة (0 = تلقائي)", en: "Quiz sections (0 = auto)" } },
    ],
  },
  {
    id: "data",
    label: { ar: "البيانات والتحديثات", en: "Data & updates" },
    fields: [
      { key: "historyEnabled", type: "toggle", label: { ar: "حفظ السجل", en: "Save history" } },
      {
        key: "saveTrainingPairs",
        type: "toggle",
        label: { ar: "حفظ بيانات التدريب مع كل عملية", en: "Save training pairs with each run" },
        help: { ar: "يحفظ التعليمات والإجابات لتصديرها لاحقًا كمجموعة بيانات تدريب.", en: "Keeps prompts and answers to export later as a training dataset." },
      },
      { key: "checkModelUpdates", type: "toggle", label: { ar: "التنبيه عند توفر تحديثات للنماذج", en: "Notify about model updates" } },
      {
        key: "checkAppUpdates",
        type: "toggle",
        label: { ar: "التحقق التلقائي من تحديثات التطبيق", en: "Check for app updates automatically" },
        help: {
          ar: "يومًا بيوم من zeidexsoft.com. لا يُثبَّت أي تحديث إلا إذا طابق توقيعه مفتاح ZeidexSoft وشهادة التطبيق المثبّت.",
          en: "Daily from zeidexsoft.com. An update is installed only if its signature matches the ZeidexSoft key and the installed app's certificate.",
        },
      },
      { key: "updateUrl", type: "text", label: { ar: "عنوان ملف التحديثات", en: "Update manifest URL" } },
    ],
  },
  { id: "about", label: { ar: "عن البرنامج", en: "About" }, fields: [] },
];

function FieldRow({ field, lang }: { field: Field; lang: Lang }) {
  const s = useSettings();
  const value = s[field.key];
  const changed = JSON.stringify(value) !== JSON.stringify(DEFAULTS[field.key]);
  const id = `set-${field.key}`;
  const set = (v: unknown) => updateSettings({ [field.key]: v } as Partial<Settings>);
  const input = "h-9 w-full rounded-md border border-border bg-background px-3 text-sm";
  const lim = LIMITS[field.key];

  return (
    <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-start sm:gap-4">
      <div>
        <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
          {field.label[lang]}
          {changed && (
            <button type="button" className="text-xs text-accent underline" onClick={() => resetSettings([field.key])}>
              ↺
            </button>
          )}
        </label>
        {field.help && <p className="text-xs text-muted-foreground">{field.help[lang]}</p>}
      </div>
      <div>
        {field.type === "toggle" ? (
          <input id={id} type="checkbox" className="size-5 accent-[var(--accent)]" checked={!!value} onChange={(e) => set(e.target.checked)} />
        ) : field.type === "select" ? (
          <select id={id} className={input} value={String(value)} onChange={(e) => set(e.target.value)}>
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label[lang]}
              </option>
            ))}
          </select>
        ) : field.type === "number" ? (
          <input
            id={id}
            type="number"
            dir="ltr"
            className={input}
            value={Number(value)}
            step={field.step ?? 1}
            min={lim?.[0]}
            max={lim?.[1]}
            onChange={(e) => e.target.value !== "" && set(Number(e.target.value))}
          />
        ) : field.type === "textarea" ? (
          <textarea id={id} dir="auto" rows={3} className={cn(input, "h-auto py-2")} value={String(value)} onChange={(e) => set(e.target.value)} />
        ) : (
          <input id={id} dir="ltr" className={input} value={String(value)} placeholder={field.placeholder} onChange={(e) => set(e.target.value)} />
        )}
      </div>
    </div>
  );
}

// Model lists per provider+key for this session, so reopening Settings does not refetch.
const modelCache = new Map<string, string[]>();

function errorMessage(e: unknown, lang: Lang): string {
  const tr = (ar: string, en: string) => (lang === "ar" ? ar : en);
  if (e instanceof CloudError) {
    if (e.code === "auth") return tr("المفتاح مرفوض (401/403): تأكد من نسخه كاملًا وأنه مفعّل لدى المزوّد.", "Key rejected (401/403): check it was copied fully and is active.");
    if (e.code === "cors")
      return tr(
        "المتصفح منع الاتصال بهذا المزوّد (CORS). استخدم تطبيق Android أو سطح المكتب، أو فعّل «الوسيط المحلي» مع npm run serve أو Docker.",
        "The browser blocked this provider (CORS). Use the Android or desktop app, or turn on “Use local proxy” with npm run serve or Docker.",
      );
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

function ProviderEditor({ lang }: { lang: Lang }) {
  const s = useSettings();
  const def = PROVIDERS.find((p) => p.id === s.activeProvider) ?? PROVIDERS[0];
  const cfg = s.providers[def.id] ?? { apiKey: "", model: "", baseUrl: "", maxTokens: def.kind === "anthropic" ? 16000 : 4096 };
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "loading" | "ok" | "error"; text: string }>({ kind: "idle", text: "" });
  const [manual, setManual] = useState(false);
  const input = "h-9 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm";
  const tr = (ar: string, en: string) => (lang === "ar" ? ar : en);
  // Always read the freshest settings when saving: the debounced fetch below may finish later.
  const save = (patch: Partial<typeof cfg>) => {
    const now = getSettings();
    const base = now.providers[def.id] ?? cfg;
    updateSettings({ providers: { ...now.providers, [def.id]: { ...base, ...patch } } });
  };
  const canFetch = !!(cfg.baseUrl || def.baseUrl) && (!def.needsKey || cfg.apiKey.length >= 8);
  const cacheKey = `${def.id}|${cfg.baseUrl}|${cfg.apiKey}|${s.useProxy}`;

  const fetchModels = useCallback(
    async (force = false) => {
      const cached = modelCache.get(cacheKey);
      if (cached && !force) {
        setModels(cached);
        setStatus({ kind: "ok", text: tr(`✓ ${cached.length} نموذجًا متاحًا لهذا المفتاح`, `✓ ${cached.length} models available for this key`) });
        return;
      }
      setStatus({ kind: "loading", text: tr("جارٍ جلب النماذج المتاحة لهذا المفتاح…", "Fetching the models this key can use…") });
      try {
        const ids = await listModels({ def, apiKey: cfg.apiKey, ...resolveEndpoint(s, def, cfg) });
        modelCache.set(cacheKey, ids);
        setModels(ids);
        setStatus({ kind: "ok", text: tr(`✓ ${ids.length} نموذجًا متاحًا لهذا المفتاح`, `✓ ${ids.length} models available for this key`) });
        // Pick a model automatically so the provider is ready as soon as the key works.
        const current = getSettings().providers[def.id]?.model;
        if (ids.length && (!current || !ids.includes(current))) save({ model: ids.includes(def.defaultModel) ? def.defaultModel : ids[0] });
      } catch (e) {
        setModels([]);
        setStatus({ kind: "error", text: `✗ ${errorMessage(e, lang)}` });
      }
    },
    // Keyed on the inputs that change the result; def/cfg/s are derived from them.
    [cacheKey],
  );

  // Fetch as soon as a key is typed or pasted (debounced), and when switching providers.
  useEffect(() => {
    setModels([]);
    setFilter("");
    setStatus({ kind: "idle", text: "" });
    if (!canFetch) return;
    const id = setTimeout(() => fetchModels(), 700);
    return () => clearTimeout(id);
  }, [cacheKey, canFetch, fetchModels]);

  const shown = filter ? models.filter((m) => m.toLowerCase().includes(filter.toLowerCase())) : models;
  const currentModel = cfg.model || def.defaultModel;

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-4">
        <label htmlFor="prov" className="text-sm font-medium">
          {tr("المزوّد السحابي", "Cloud provider")}
        </label>
        <select id="prov" className={input} value={def.id} onChange={(e) => updateSettings({ activeProvider: e.target.value })}>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {s.providers[p.id]?.apiKey ? " ✓" : ""}
            </option>
          ))}
        </select>
      </div>
      {(def.needsKey || def.id === "custom") && (
        <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-4">
          <label htmlFor="key" className="text-sm font-medium">
            {tr("مفتاح API", "API key")}
            {def.keyUrl && (
              <a className="ms-2 text-xs text-accent underline" href={def.keyUrl} target="_blank" rel="noreferrer">
                {tr("احصل على مفتاح", "Get a key")}
              </a>
            )}
            <span className="block text-xs font-normal text-muted-foreground">
              {tr("يُحفظ في هذا الجهاز فقط، ويُرسل إلى المزوّد وحده.", "Stored only on this device; sent only to the provider.")}
            </span>
          </label>
          <div className="flex min-w-0 gap-1">
            <input
              id="key"
              dir="ltr"
              type={showKey ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              className={input}
              value={cfg.apiKey}
              onChange={(e) => save({ apiKey: e.target.value.trim() })}
            />
            <Button variant="outline" size="icon" className="size-9 shrink-0" onClick={() => setShowKey((v) => !v)} aria-label={tr("إظهار المفتاح", "Show key")}>
              {showKey ? <EyeOff /> : <Eye />}
            </Button>
          </div>
        </div>
      )}
      <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-4">
        <label htmlFor="model" className="text-sm font-medium">
          {tr("النموذج", "Model")}
          <span className="block text-xs font-normal text-muted-foreground">
            {tr("تُجلب تلقائيًا كل النماذج التي يتيحها مفتاحك.", "Every model your key can use is fetched automatically.")}
          </span>
        </label>
        <div className="min-w-0 space-y-1.5">
          {models.length > 0 && !manual ? (
            <>
              {models.length > 15 && (
                <input dir="ltr" className={input} placeholder={tr("ابحث في النماذج…", "Search models…")} value={filter} onChange={(e) => setFilter(e.target.value)} />
              )}
              <select id="model" dir="ltr" className={input} value={shown.includes(currentModel) ? currentModel : ""} onChange={(e) => save({ model: e.target.value })}>
                {!shown.includes(currentModel) && <option value="">{tr("اختر نموذجًا…", "Choose a model…")}</option>}
                {shown.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <input
              id="model"
              dir="ltr"
              className={input}
              placeholder={def.defaultModel || tr("اسم النموذج", "Model id")}
              value={cfg.model}
              onChange={(e) => save({ model: e.target.value.trim() })}
            />
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" onClick={() => fetchModels(true)} disabled={!canFetch || status.kind === "loading"}>
              <ListRestart />
              {tr("تحديث القائمة", "Refresh list")}
            </Button>
            {models.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setManual((v) => !v)}>
                {manual ? tr("اختر من القائمة", "Pick from list") : tr("إدخال يدوي", "Type manually")}
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-4">
        <label htmlFor="base" className="text-sm font-medium">
          {tr("عنوان الخدمة (Base URL)", "Base URL")}
        </label>
        <input id="base" dir="ltr" className={input} placeholder={def.baseUrl} value={cfg.baseUrl} onChange={(e) => save({ baseUrl: e.target.value.trim() })} />
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-4">
        <label htmlFor="maxt" className="text-sm font-medium">
          {tr("أقصى رموز للإجابة", "Max output tokens")}
          <span className="block text-xs font-normal text-muted-foreground">
            {tr("نماذج الاستدلال تستهلك جزءًا منها في التفكير.", "Reasoning models spend part of it thinking.")}
          </span>
        </label>
        <input id="maxt" type="number" dir="ltr" min={256} max={131072} step={256} className={input} value={cfg.maxTokens} onChange={(e) => save({ maxTokens: Number(e.target.value) })} />
      </div>
      {status.text && (
        <p
          role="status"
          className={cn("break-words text-xs", status.kind === "error" ? "text-danger" : status.kind === "ok" ? "text-success" : "text-muted-foreground")}
          dir="auto"
        >
          {status.text}
        </p>
      )}
      {nativeFetch && <p className="text-xs text-muted-foreground">{tr("يعمل الاتصال عبر التطبيق مباشرة، دون قيود المتصفح.", "Requests go through the app natively, without browser limits.")}</p>}
    </div>
  );
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [section, setSection] = useState<SectionId>("exec");
  const fileInput = useRef<HTMLInputElement>(null);
  const current = SECTIONS.find((x) => x.id === section)!;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.settings}
      closeLabel={t.close}
      wide
      footer={
        <>
          <Button variant="outline" size="sm" onClick={() => download("lexi-settings.json", exportSettings(false), "application/json")}>
            <Download />
            {lang === "ar" ? "تصدير (دون المفاتيح)" : "Export (no keys)"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <Upload />
            {lang === "ar" ? "استيراد" : "Import"}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                importSettings(await f.text());
                notify({ title: lang === "ar" ? "استُورِدت الإعدادات" : "Settings imported", tone: "success" });
              } catch (err) {
                notify({ title: t.error, body: String(err), tone: "warning" });
              }
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            className="ms-auto"
            onClick={() => confirm(lang === "ar" ? "إعادة كل الإعدادات للافتراضي؟ (تبقى مفاتيح API)" : "Reset all settings to defaults? (API keys are kept)") && resetSettings()}
          >
            <RotateCcw />
            {lang === "ar" ? "إعادة الضبط" : "Reset all"}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label={t.settings} className="flex gap-1 overflow-x-auto md:flex-col">
          {SECTIONS.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-current={section === x.id}
              onClick={() => setSection(x.id)}
              className={cn(
                "shrink-0 rounded-lg px-3 py-2 text-start text-sm",
                section === x.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {x.label[lang]}
            </button>
          ))}
        </nav>
        <section className="min-w-0 space-y-5">
          {section === "exec" && <ProviderEditor lang={lang} />}
          {current.fields.map((f) => (
            <FieldRow key={f.key} field={f} lang={lang} />
          ))}
          {section === "data" && (
            <Button variant="outline" size="sm" onClick={() => runAppUpdateCheck(t, true)}>
              <ListRestart />
              {t.checkUpdatesNow}
            </Button>
          )}
          {section === "data" && "Notification" in window && Notification.permission === "default" && (
            <Button variant="outline" size="sm" onClick={() => Notification.requestPermission()}>
              {lang === "ar" ? "السماح بإشعارات النظام" : "Allow system notifications"}
            </Button>
          )}
          {section === "about" && <About />}
          {section !== "about" && (
            <p className="text-xs text-muted-foreground">
              <Badge>↺</Badge> {lang === "ar" ? "يعيد الحقل إلى قيمته الافتراضية. كل التغييرات تُطبَّق فورًا." : "resets a field to its default. Every change applies immediately."}
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}
