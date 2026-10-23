// Run history in IndexedDB (per browser profile, never uploaded). Each entry keeps the result plus
// the prompt/answer pairs that produced it, so liked runs can be exported as a fine-tuning dataset.
import { useSyncExternalStore } from "react";
import type { TrainingPair } from "./engine";
import { getSettings } from "./settings";

export type HistoryKind = "summary" | "study" | "ask";

export interface HistoryEntry {
  id: string;
  kind: HistoryKind;
  createdAt: number;
  docName: string;
  title: string;
  lang: string;
  quality: string;
  mode: string;
  models: string[];
  output: string;
  /** Structured result (study set, answer sources) for re-display. */
  data?: unknown;
  rating?: 1 | -1;
  pairs: TrainingPair[];
}

const DB = "lexi-local";
const STORE = "history";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" }).createIndex("createdAt", "createdAt");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
  });
}

let entries: HistoryEntry[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function refreshHistory() {
  try {
    entries = ((await tx("readonly", (s) => s.getAll())) as HistoryEntry[]).sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    entries = []; // IndexedDB unavailable (private mode in some browsers): history just stays empty
  }
  emit();
}

export async function addHistory(e: Omit<HistoryEntry, "id" | "createdAt">): Promise<string> {
  const entry: HistoryEntry = { ...e, id: crypto.randomUUID(), createdAt: Date.now() };
  await tx("readwrite", (s) => s.put(entry));
  await refreshHistory();
  return entry.id;
}

export async function rateHistory(id: string, rating: 1 | -1 | undefined) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  await tx("readwrite", (s) => s.put({ ...entry, rating }));
  await refreshHistory();
}

export async function deleteHistory(id: string) {
  await tx("readwrite", (s) => s.delete(id));
  await refreshHistory();
}

export async function clearHistory() {
  await tx("readwrite", (s) => s.clear());
  await refreshHistory();
}

export const useHistory = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => entries,
  );

/**
 * JSONL in the chat "messages" format accepted by OpenAI fine-tuning, Hugging Face TRL, Unsloth and
 * Axolotl. Disliked runs are always excluded; `onlyLiked` keeps just the runs marked 👍.
 */
export function toTrainingJsonl(list: HistoryEntry[], onlyLiked: boolean): string {
  return list
    .filter((e) => e.rating !== -1 && (!onlyLiked || e.rating === 1))
    .flatMap((e) =>
      e.pairs.map((p) =>
        JSON.stringify({
          messages: [...p.messages, { role: "assistant", content: p.output }],
          metadata: { task: p.task, via: p.via, model: p.model, kind: e.kind, rating: e.rating ?? 0 },
        }),
      ),
    )
    .join("\n");
}

export { saveFile as download } from "./native";

/** Collects pairs for one job, then saves the entry when history is on. */
export function recorder() {
  const pairs: TrainingPair[] = [];
  return { pairs, record: (p: TrainingPair) => pairs.push(p), models: () => [...new Set(pairs.map((p) => `${p.via}:${p.model}`))] };
}

/** Saves a finished run when history is on; returns its id for rating, or null. */
export async function saveRun(
  kind: HistoryKind,
  run: { docName: string; title: string; lang: string; quality: string; output: string; data?: unknown },
  rec: ReturnType<typeof recorder>,
): Promise<string | null> {
  const s = getSettings();
  if (!s.historyEnabled) return null;
  try {
    return await addHistory({ kind, ...run, mode: s.mode, models: rec.models(), pairs: rec.pairs });
  } catch {
    return null; // a full or blocked IndexedDB must never fail the run itself
  }
}

/** Models that produced a saved run, for export metadata ("local:Qwen3.5-2B…", "cloud:gpt-…"). */
export const modelsOf = (id: string | null, list: HistoryEntry[]) =>
  (id ? list.find((h) => h.id === id)?.models : undefined)?.map((m) => m.replace(/^(local|cloud):/, "")) ?? [];

/** First meaningful line, for list titles. */
export const titleOf = (text: string) => (text.split("\n").find((l) => l.trim().length > 3) ?? text).trim().slice(0, 90);
