import { useSyncExternalStore } from "react";
import type { ChatMessage } from "./prompts";
import { findLoop } from "./nlp";
import { getSettings } from "./settings";
import type { Backend, WorkerRequest, WorkerResponse } from "@/workers/protocol";

export type EngineStatus = "idle" | "loading" | "ready" | "error";

export interface EngineState {
  status: EngineStatus;
  progress: number;
  progressText: string;
  backend?: Backend;
  model?: string;
  error?: string;
  /** Decode speed of the last call, tokens per second. */
  tps: number;
  totalTokens: number;
  calls: number;
  /** Calls cut short because the model started repeating itself. */
  loopsStopped: number;
}

export interface GenerateOptions {
  maxTokens: number;
  temperature?: number;
  jsonSchema?: object;
  onToken?: (delta: string, full: string) => void;
  /** Stop generation when the output starts looping and keep the text before the loop. */
  guard?: boolean;
}

export interface GenerateResult {
  text: string;
  aborted: boolean;
}

interface Pending {
  resolve: (r: GenerateResult) => void;
  reject: (e: Error) => void;
  opts: GenerateOptions;
  text: string;
  cutAt?: number;
}

class LlmClient {
  private worker = new Worker(new URL("../workers/llm.worker.ts", import.meta.url), { type: "module" });
  private listeners = new Set<() => void>();
  private pending = new Map<number, Pending>();
  private cacheReqs = new Map<number, { resolve: (r: Record<string, boolean>) => void; reject: (e: Error) => void }>();
  private queue: Promise<void> = Promise.resolve();
  private nextId = 1;
  state: EngineState = { status: "idle", progress: 0, progressText: "", tps: 0, totalTokens: 0, calls: 0, loopsStopped: 0 };

  constructor() {
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(e.data);
    this.worker.onerror = (e) => this.set({ status: "error", error: e.message || "Worker crashed" });
  }

  private send(msg: WorkerRequest) {
    this.worker.postMessage(msg);
  }

  private set(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private handle(msg: WorkerResponse) {
    switch (msg.type) {
      case "progress":
        this.set({ progress: msg.progress, progressText: msg.text });
        break;
      case "ready":
        this.set({ status: "ready", progress: 1, backend: msg.backend, model: msg.model, error: undefined });
        break;
      case "token": {
        const p = this.pending.get(msg.id);
        if (!p || p.cutAt !== undefined) break;
        p.text += msg.delta;
        if (p.opts.guard) {
          const cut = findLoop(p.text);
          if (cut >= 0) {
            p.cutAt = cut;
            this.send({ type: "abort" });
            break;
          }
        }
        p.opts.onToken?.(msg.delta, p.text);
        break;
      }
      case "done": {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (!p) break;
        const looped = p.cutAt !== undefined;
        this.set({
          tps: msg.ms > 0 ? (msg.tokens * 1000) / msg.ms : this.state.tps,
          totalTokens: this.state.totalTokens + msg.tokens,
          calls: this.state.calls + 1,
          loopsStopped: this.state.loopsStopped + (looped ? 1 : 0),
        });
        // A guard stop is a successful (shortened) answer, not a user abort.
        p.resolve(looped ? { text: p.text.slice(0, p.cutAt), aborted: false } : { text: msg.text, aborted: msg.aborted });
        break;
      }
      case "cache":
        this.cacheReqs.get(msg.id)?.resolve(msg.cached);
        this.cacheReqs.delete(msg.id);
        break;
      case "error":
        if (msg.id !== undefined) {
          (this.pending.get(msg.id) ?? this.cacheReqs.get(msg.id))?.reject(new Error(msg.message));
          this.pending.delete(msg.id);
          this.cacheReqs.delete(msg.id);
        } else {
          this.set({ status: "error", error: msg.message });
        }
        break;
    }
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  load(backend: Backend, model: string) {
    this.set({ status: "loading", progress: 0, progressText: "", backend, model, error: undefined });
    const s = getSettings();
    this.send({ type: "load", backend, model, contextTokens: s.contextTokens, dtype: s.cpuDtype });
  }

  unload() {
    this.send({ type: "unload" });
    this.set({ status: "idle", progress: 0, progressText: "", model: undefined });
  }

  generate(messages: ChatMessage[], opts: GenerateOptions): Promise<GenerateResult> {
    const id = this.nextId++;
    // One engine, one generation at a time: summary, quiz and Q&A jobs queue behind each other.
    const job = this.queue.then(
      () =>
        new Promise<GenerateResult>((resolve, reject) => {
          this.pending.set(id, { resolve, reject, opts, text: "" });
          this.send({
            type: "generate",
            id,
            messages,
            maxTokens: opts.maxTokens,
            temperature: opts.temperature ?? getSettings().temperature,
            topP: getSettings().topP,
            frequencyPenalty: getSettings().frequencyPenalty,
            jsonSchema: opts.jsonSchema,
          });
        }),
    );
    this.queue = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  abort() {
    this.send({ type: "abort" });
  }

  /** Which of `models` are in the browser cache; with op "delete", removes them first. */
  cache(op: "has" | "delete", backend: Backend, models: string[]) {
    const id = this.nextId++;
    return new Promise<Record<string, boolean>>((resolve, reject) => {
      this.cacheReqs.set(id, { resolve, reject });
      this.send({ type: "cache", id, op, backend, models });
    });
  }
}

export const llm = new LlmClient();

export const useEngine = () => useSyncExternalStore(llm.subscribe, () => llm.state);
