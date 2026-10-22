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
  | { type: "progress"; progress: number; text: string }
  | { type: "ready"; backend: Backend; model: string }
  | { type: "token"; id: number; delta: string }
  | { type: "done"; id: number; text: string; aborted: boolean; tokens: number; ms: number }
  | { type: "cache"; id: number; cached: Record<string, boolean> }
  | { type: "error"; id?: number; message: string };
