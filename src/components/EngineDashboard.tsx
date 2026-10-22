import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Cpu, HardDrive, Trash2, Zap } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/i18n";
import type { GpuReport } from "@/lib/gpu";
import { llm, useEngine } from "@/lib/llm-client";
import { CPU_MODEL, forGpu, WEBGPU_MODELS, type ModelOption } from "@/lib/models";
import { cn, formatBytes } from "@/lib/utils";
import { useSettings } from "@/lib/settings";
import { checkForModelUpdates, markUpdated } from "@/lib/updates";
import { notify } from "@/lib/notify";

export function EngineDashboard({
  gpu,
  selected,
  recommended,
  onSelect,
}: {
  gpu: GpuReport | null;
  selected: ModelOption;
  recommended?: string;
  onSelect: (m: ModelOption) => void;
}) {
  const { t, lang } = useI18n();
  const engine = useEngine();
  const s = useSettings();
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const updating = useRef<string | null>(null);
  // The Settings backend preference overrides detection: forcing WASM fixes GPUs that detect but crash.
  const webgpu = s.backend === "wasm" ? false : s.backend === "webgpu" ? true : !!gpu?.webgpu;
  const backend = webgpu ? "webgpu" : "wasm";
  const models = useMemo<ModelOption[]>(() => {
    if (!webgpu) return [{ ...CPU_MODEL, id: s.cpuModel, label: s.cpuModel.split("/").pop() ?? s.cpuModel }];
    const custom: ModelOption[] = s.customWebllmModel
      ? [{ id: s.customWebllmModel, label: s.customWebllmModel, vramMB: 0, chunkChars: 4000, note: { ar: "نموذج مخصّص من الإعدادات", en: "Custom model from Settings" } }]
      : [];
    return [...custom, ...WEBGPU_MODELS];
  }, [webgpu, s.cpuModel, s.customWebllmModel]);
  const resolve = useCallback((m: ModelOption) => (webgpu ? forGpu(m.id, gpu?.f16 ?? true) : m.id), [webgpu, gpu]);
  const busy = engine.status === "loading";

  useEffect(() => {
    if (gpu && !models.some((m) => m.id === selected.id)) onSelect(models[0]);
  }, [gpu, models, selected.id, onSelect]);

  const refreshCache = useCallback(async () => {
    if (!gpu) return;
    const ids = models.map(resolve);
    const status = await llm.cache("has", backend, ids).catch(() => ({}) as Record<string, boolean>);
    setCached(Object.fromEntries(models.map((m, i) => [m.id, !!status[ids[i]]])));
    if (!s.checkModelUpdates) return;
    const outdated = await checkForModelUpdates(ids.filter((id) => status[id])).catch(() => []);
    for (const id of outdated) {
      notify({
        title: t.modelUpdate,
        body: t.modelUpdateBody(id),
        tone: "warning",
        action: {
          label: t.updateNow,
          run: async () => {
            updating.current = id;
            if (engine.status === "ready") llm.unload();
            await llm.cache("delete", backend, [id]).catch(() => undefined);
            llm.load(backend, id);
          },
        },
      });
    }
  }, [gpu, models, resolve, backend, s.checkModelUpdates, t, engine.status]);

  useEffect(() => {
    refreshCache();
    // Re-check only when the engine changes state, not on every render of refreshCache's deps.
  }, [engine.status, gpu, models]);

  useEffect(() => {
    if (engine.status === "ready" && updating.current) {
      markUpdated(updating.current);
      updating.current = null;
    }
  }, [engine.status]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.engineTitle}</CardTitle>
        <CardDescription>{t.engineDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Compatibility report */}
        {!gpu ? (
          <p className="text-sm text-muted-foreground">{t.gpuChecking}</p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Badge variant={webgpu ? "success" : "danger"}>
                {webgpu ? <Zap className="size-3" aria-hidden /> : <Cpu className="size-3" aria-hidden />}
                {webgpu ? t.gpuOk : t.gpuNo}
              </Badge>
              {webgpu && (
                <Badge>
                  {t.f16}: {gpu.f16 ? t.yes : t.no}
                </Badge>
              )}
              {gpu.maxBufferSize && (
                <Badge>
                  {t.maxBuffer}: <span dir="ltr">{formatBytes(gpu.maxBufferSize)}</span>
                </Badge>
              )}
              {gpu.storageUsed !== undefined && (
                <Badge>
                  <HardDrive className="size-3" aria-hidden />
                  {t.storage}:{" "}
                  <span dir="ltr">
                    {formatBytes(gpu.storageUsed)} / {formatBytes(gpu.storageQuota ?? 0)}
                  </span>
                </Badge>
              )}
              {gpu.persisted !== undefined && (
                <Badge>
                  {t.persisted}: {gpu.persisted ? t.yes : t.no}
                </Badge>
              )}
            </div>
            {gpu.adapter && (
              <p className="text-xs text-muted-foreground" dir="ltr">
                {gpu.adapter}
              </p>
            )}
            {!webgpu && (
              <p className="flex gap-2 rounded-md bg-accent/15 p-3 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                {t.gpuNoHint}
              </p>
            )}
          </div>
        )}

        {/* Model picker */}
        {gpu && (
          <fieldset className="space-y-2" disabled={busy || engine.status === "ready"}>
            <legend className="mb-2 text-sm font-medium">
              {t.model} · <span className="text-muted-foreground">{webgpu ? t.backendGpu : t.backendCpu}</span>
            </legend>
            {models.map((m) => (
              <label
                key={m.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors has-disabled:cursor-default",
                  selected.id === m.id ? "border-accent bg-accent/10" : "border-border hover:bg-muted",
                )}
              >
                <input
                  type="radio"
                  name="model"
                  className="accent-[var(--accent)]"
                  checked={selected.id === m.id}
                  onChange={() => onSelect(m)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span dir="ltr">{m.label}</span>
                    {recommended === m.id && <Badge variant="accent">{t.recommended}</Badge>}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {m.note[lang]}
                    {m.vramMB > 0 && (
                      <>
                        {" · "}
                        {t.vram} <span dir="ltr">{(m.vramMB / 1024).toFixed(1)} GB</span>
                      </>
                    )}
                  </span>
                </span>
                <Badge variant={cached[m.id] ? "success" : "default"}>{cached[m.id] ? t.cached : t.notCached}</Badge>
              </label>
            ))}
          </fieldset>
        )}

        {/* Load state */}
        {busy && (
          <div className="space-y-1.5" aria-live="polite">
            <div className="flex justify-between gap-3 text-xs text-muted-foreground">
              <span className="truncate" dir="ltr">
                {engine.progressText || t.loading}
              </span>
              <span dir="ltr">{Math.round(engine.progress * 100)}%</span>
            </div>
            <Progress value={engine.progress * 100} label={t.loading} />
          </div>
        )}
        {engine.status === "ready" && engine.calls > 0 && (
          <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            {[
              [t.speed, `${engine.tps.toFixed(1)} tok/s`],
              [t.tokens, engine.totalTokens.toLocaleString()],
              [t.calls, engine.calls.toLocaleString()],
              [t.loops, engine.loopsStopped.toLocaleString()],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-muted px-2 py-2">
                <dt className="text-[0.7rem] text-muted-foreground">{label}</dt>
                <dd className="text-sm font-semibold" dir="ltr">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {engine.status === "error" && (
          <p className="rounded-md bg-danger/10 p-3 text-sm text-danger" dir="auto">
            {t.error}: {engine.error}
          </p>
        )}

        {gpu && (
          <div className="flex flex-wrap items-center gap-2">
            {engine.status === "ready" ? (
              <>
                <Badge variant="success">
                  {t.ready} · <span dir="ltr">{engine.model}</span>
                </Badge>
                <Button variant="outline" size="sm" onClick={() => llm.unload()}>
                  {t.unload}
                </Button>
              </>
            ) : (
              <Button onClick={() => llm.load(backend, resolve(selected))} disabled={busy}>
                {busy ? t.loading : t.load}
              </Button>
            )}
            {cached[selected.id] && engine.status !== "ready" && !busy && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await llm.cache("delete", backend, [resolve(selected)]).catch(() => undefined);
                  refreshCache();
                }}
              >
                <Trash2 aria-hidden />
                {t.deleteCache}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
