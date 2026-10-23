import type { ChatMessage } from "@/lib/prompts";

export type Backend = "webgpu" | "wasm";

export type WorkerRequest =
  | { type: "load"; backend: Backend; model: string; contextTokens: number; dtype: string }
  | {
      type: "generate";
      id: number;
      messages: ChatMessage[];
      maxTokens: number;
      temperature: number;
      topP: number;
      frequencyPenalty: number;
      jsonSchema?: object;
    }
  | { type: "abort" }
  | { type: "unload" }
  | { type: "cache"; id: number; op: "has" | "delete"; backend: Backend; models: string[] };

export type WorkerResponse =
  | {
      type: "progress";
      progress: number;
      text: string;
      /** "fetch" = downloading weights, "cache" = reading them from storage onto the device. */
      phase?: "fetch" | "cache";
      loadedBytes?: number;
      totalBytes?: number;
    }
  | { type: "ready"; backend: Backend; model: string }
  /** The engine lost its model (GPU device lost); the worker reloads it and retries request `id`. */
  | { type: "reloading"; id: number; reason: string }
  | { type: "token"; id: number; delta: string }
  | { type: "done"; id: number; text: string; aborted: boolean; tokens: number; ms: number }
  | { type: "cache"; id: number; cached: Record<string, boolean> }
  | { type: "error"; id?: number; message: string };

// WebLLM unloads the model by itself when the GPU device is lost (Android backgrounding the app, GPU
// memory pressure, a driver reset) and only logs it; the next request then fails with one of these.
export const ENGINE_GONE = /Model not loaded before trying|ModelNotLoadedError|device (is |was )?lost|lost the device|instance.*disposed/i;

// WebLLM only reports progress as text: "Fetching param cache[3/38]: 120MB fetched. 7% completed, ...".
const WEBLLM_PROGRESS = /^(Fetching param|Loading model from) cache\[\d+\/\d+\]: (\d+)MB/;
const MiB = 1024 * 1024;

export function parseWebLlmProgress(progress: number, text: string): WorkerResponse {
  const m = text.match(WEBLLM_PROGRESS);
  if (!m) return { type: "progress", progress, text };
  const loadedBytes = Number(m[2]) * MiB;
  return {
    type: "progress",
    progress,
    text,
    phase: m[1] === "Fetching param" ? "fetch" : "cache",
    loadedBytes,
    totalBytes: progress > 0 ? loadedBytes / progress : undefined,
  };
}
