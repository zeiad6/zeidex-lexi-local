// Every tunable of the app lives here and is applied at runtime: a user whose device or network
// breaks the defaults can fix it from the Settings panel without editing code or rebuilding.
import { useSyncExternalStore } from "react";

export type ExecMode = "local" | "cloud" | "hybrid" | "smart";
export type BackendPref = "auto" | "webgpu" | "wasm";
export type CpuDtype = "q4" | "q8" | "fp16" | "fp32";

export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  /** Max output tokens sent to the API; reasoning models spend part of it thinking. */
  maxTokens: number;
}

export interface Settings {
  // Execution
  mode: ExecMode;
  activeProvider: string;
  providers: Record<string, ProviderConfig>;
  /** Route cloud calls through the bundled server (desktop/Docker) to avoid browser CORS limits. */
  useProxy: boolean;
  // Local engine
  backend: BackendPref;
  /** Any WebLLM prebuilt model id; overrides the picker when set. */
  customWebllmModel: string;
  cpuModel: string;
  cpuDtype: CpuDtype;
  contextTokens: number;
  // Generation
  temperature: number;
  topP: number;
  frequencyPenalty: number;
  notesTokens: number;
  finalTokens: number;
  refineTokens: number;
  studyTokens: number;
  answerTokens: number;
  loopGuard: boolean;
  extraInstructions: string;
  // Document
  chunkChars: number; // 0 = the model's own default
  chunkOverlap: number;
  removeHeaders: boolean;
  cutReferences: boolean;
  passageChars: number;
  keywordCount: number;
  fastMaxChunks: number;
  // Study
  studySections: number;
  // Data
  historyEnabled: boolean;
  saveTrainingPairs: boolean;
  checkModelUpdates: boolean;
  checkAppUpdates: boolean;
  /** Signed manifest published on zeidexsoft.com (see scripts/release-manifest.mjs). */
  updateUrl: string;
}

export const DEFAULTS: Settings = {
  mode: "local",
  activeProvider: "anthropic",
  providers: {},
  useProxy: false,
  backend: "auto",
  customWebllmModel: "",
  cpuModel: "onnx-community/Qwen2.5-0.5B-Instruct",
  cpuDtype: "q4",
  contextTokens: 4096,
  temperature: 0.3,
  topP: 0.9,
  frequencyPenalty: 0.3,
  notesTokens: 450,
  finalTokens: 1100,
  refineTokens: 1000,
  studyTokens: 1000,
  answerTokens: 600,
  loopGuard: true,
  extraInstructions: "",
  chunkChars: 0,
  chunkOverlap: 200,
  removeHeaders: true,
  cutReferences: true,
  passageChars: 1200,
  keywordCount: 12,
  fastMaxChunks: 6,
  studySections: 0, // 0 = automatic (4 on GPU, 6 in Maximum, 2 on CPU)
  historyEnabled: true,
  saveTrainingPairs: true,
  checkModelUpdates: true,
  checkAppUpdates: true,
  updateUrl: "https://zeidexsoft.com/updates/lexi-local.json",
};

/** Bounds for numeric settings; values outside are clamped, so a bad import can't break the app. */
export const LIMITS: Partial<Record<keyof Settings, [number, number]>> = {
  contextTokens: [1024, 131072],
  temperature: [0, 2],
  topP: [0.05, 1],
  frequencyPenalty: [0, 2],
  notesTokens: [64, 8192],
  finalTokens: [128, 16384],
  refineTokens: [128, 16384],
  studyTokens: [256, 16384],
  answerTokens: [64, 8192],
  chunkChars: [0, 60000],
  chunkOverlap: [0, 2000],
  passageChars: [300, 8000],
  keywordCount: [0, 40],
  fastMaxChunks: [1, 50],
  studySections: [0, 20],
};

const KEY = "lexi-settings-v1";

/** Merges untrusted input over the defaults, dropping unknown keys and wrong types. */
export function sanitize(input: unknown): Settings {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = { ...DEFAULTS } as Record<string, unknown>;
  for (const [k, def] of Object.entries(DEFAULTS)) {
    const v = raw[k];
    if (v === undefined || typeof v !== typeof def) continue;
    if (typeof def === "number") {
      if (!Number.isFinite(v)) continue;
      const lim = LIMITS[k as keyof Settings];
      out[k] = lim ? Math.min(lim[1], Math.max(lim[0], v as number)) : v;
    } else if (k === "providers") {
      out[k] = sanitizeProviders(v);
    } else out[k] = v;
  }
  for (const [k, allowed] of [
    ["mode", ["local", "cloud", "hybrid", "smart"]],
    ["backend", ["auto", "webgpu", "wasm"]],
    ["cpuDtype", ["q4", "q8", "fp16", "fp32"]],
  ] as const) {
    if (!(allowed as readonly unknown[]).includes(out[k])) out[k] = DEFAULTS[k];
  }
  return out as unknown as Settings;
}

function sanitizeProviders(v: unknown): Record<string, ProviderConfig> {
  const out: Record<string, ProviderConfig> = {};
  if (!v || typeof v !== "object") return out;
  for (const [id, cfg] of Object.entries(v as Record<string, Partial<ProviderConfig>>)) {
    if (!cfg || typeof cfg !== "object") continue;
    out[id] = {
      apiKey: typeof cfg.apiKey === "string" ? cfg.apiKey.trim() : "",
      model: typeof cfg.model === "string" ? cfg.model.trim() : "",
      baseUrl: typeof cfg.baseUrl === "string" ? cfg.baseUrl.trim().replace(/\/+$/, "") : "",
      maxTokens: Number.isFinite(cfg.maxTokens) ? Math.min(131072, Math.max(256, cfg.maxTokens as number)) : 4096,
    };
  }
  return out;
}

function load(): Settings {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return { ...DEFAULTS };
  }
}

let current: Settings = typeof localStorage === "undefined" ? { ...DEFAULTS } : load();
const listeners = new Set<() => void>();

export const getSettings = () => current;

export function updateSettings(patch: Partial<Settings>) {
  current = sanitize({ ...current, ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage blocked (private mode): settings still apply for this session.
  }
  listeners.forEach((l) => l());
}

export function resetSettings(keys?: (keyof Settings)[]) {
  if (!keys) return updateSettings({ ...DEFAULTS, providers: current.providers });
  updateSettings(Object.fromEntries(keys.map((k) => [k, DEFAULTS[k]])) as Partial<Settings>);
}

/** Export without API keys unless asked: a settings file gets shared far more than it should. */
export function exportSettings(includeKeys: boolean): string {
  const s = structuredClone(current);
  if (!includeKeys) for (const p of Object.values(s.providers)) p.apiKey = "";
  return JSON.stringify(s, null, 2);
}

export function importSettings(json: string) {
  const parsed = JSON.parse(json);
  const merged = sanitize({ ...current, ...parsed });
  // Keep existing keys when the imported file had them stripped.
  for (const [id, p] of Object.entries(merged.providers)) if (!p.apiKey && current.providers[id]) p.apiKey = current.providers[id].apiKey;
  updateSettings(merged);
}

export const subscribeSettings = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useSettings = () => useSyncExternalStore(subscribeSettings, getSettings);
