import { useSyncExternalStore } from "react";
import type { ChatMessage } from "./prompts";
import { findLoop } from "./nlp";
import { getSettings } from "./settings";
import { parseWebLlmProgress, type Backend, type WorkerRequest, type WorkerResponse } from "@/workers/protocol";

import { classifyLoadError, RETRY_DELAYS_S, type InstallInfo, type LoadErrorKind } from "./install";

/** "paused": a model download was stopped (by the user, or by closing the app) and can be resumed. */
export type EngineStatus = "idle" | "loading" | "paused" | "ready" | "error";

export interface EngineState {
  status: EngineStatus;
  progress: number;
  progressText: string;
  backend?: Backend;
  model?: string;
  error?: string;
  errorKind?: LoadErrorKind;
  install?: InstallInfo;
  /** Load attempt number; >1 while the client retries a dropped download. */
  attempt: number;
  /** Epoch ms of the next automatic retry, while one is scheduled. */
  retryAt?: number;
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

// Cache.add() has no timeout: a dead mobile connection can hang a shard forever. Shards are ~40 MB,
// so 3 minutes without progress is a stall even on a slow link.
const STALL_MS = 180_000;
const PENDING_KEY = "lexi-pending-install";

interface PendingInstall {
  backend: Backend;
  model: string;
}

function readPending(): PendingInstall | null {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null");
    return v && typeof v.model === "string" && (v.backend === "webgpu" || v.backend === "wasm") ? v : null;
  } catch {
    return null;
  }
}

function writePending(p: PendingInstall | null) {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    // Private mode: resume-after-restart is lost, the download itself still works.
  }
}

class LlmClient {
  private worker!: Worker;
  private listeners = new Set<() => void>();
  private pending = new Map<number, Pending>();
  private cacheReqs = new Map<number, { resolve: (r: Record<string, boolean>) => void; reject: (e: Error) => void }>();
  private queue: Promise<void> = Promise.resolve();
  private nextId = 1;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private stallTimer?: ReturnType<typeof setTimeout>;
  private speedSample?: { at: number; bytes: number };
  private quotaChecked = false;
  state: EngineState;

  constructor() {
    const resumable = readPending();
    this.state = {
      status: resumable ? "paused" : "idle",
      progress: 0,
      progressText: "",
      backend: resumable?.backend,
      model: resumable?.model,
      attempt: 0,
      tps: 0,
      totalTokens: 0,
      calls: 0,
      loopsStopped: 0,
    };
    this.spawn();
    if (typeof window !== "undefined") window.addEventListener("online", () => this.retryNow());
  }

  private spawn() {
    this.worker = new Worker(new URL("../workers/llm.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(e.data);
    this.worker.onerror = (e) => {
      // A crashed worker never answers again: fail everything in flight and start a fresh one.
      const message = e.message || "Worker crashed";
      this.restart(new Error(message));
      this.loadFailed(message);
    };
  }

  /** Kills the worker (the only way to stop an in-flight WebLLM download) and starts a fresh one. */
  private restart(reason: Error) {
    this.worker.terminate();
    this.pending.forEach((p) => p.reject(reason));
    this.cacheReqs.forEach((c) => c.reject(reason));
    this.pending.clear();
    this.cacheReqs.clear();
    this.spawn();
  }

  private send(msg: WorkerRequest) {
    this.worker.postMessage(msg);
  }

  private set(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private clearTimers() {
    clearTimeout(this.retryTimer);
    clearTimeout(this.stallTimer);
    this.retryTimer = this.stallTimer = undefined;
  }

  private armStall() {
    clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => {
      this.restart(new Error("download stalled"));
      this.loadFailed("download stalled");
    }, STALL_MS);
  }

  private loadFailed(message: string) {
    if (this.state.status !== "loading") {
      this.set({ status: "error", error: message, errorKind: classifyLoadError(message) });
      return;
    }
    this.clearTimers();
    const kind = classifyLoadError(message);
    const delay = RETRY_DELAYS_S[this.state.attempt - 1];
    if (kind === "network" && delay !== undefined) {
      // Finished shards stay cached, so each retry continues where the last attempt stopped.
      this.set({ progressText: message, errorKind: kind, retryAt: Date.now() + delay * 1000 });
      this.retryTimer = setTimeout(() => this.attemptLoad(), delay * 1000);
      return;
    }
    // Only a dropped connection is worth offering as "resume" on the next launch.
    if (kind !== "network") writePending(null);
    this.set({ status: "error", error: message, errorKind: kind, retryAt: undefined, install: undefined });
  }

  private async checkQuota(install: InstallInfo) {
    if (this.quotaChecked || install.phase !== "fetch" || !install.totalBytes) return;
    this.quotaChecked = true;
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    if (!est?.quota || this.state.status !== "loading") return;
    const free = est.quota - (est.usage ?? 0);
    const needed = (install.totalBytes - install.loadedBytes) * 1.05;
    if (free < needed) {
      this.restart(new Error("quota"));
      writePending(null);
      this.set({ status: "error", errorKind: "quota", error: `quota: ${Math.ceil(needed / 2 ** 20)} MB needed, ${Math.floor(free / 2 ** 20)} MB free` });
    }
  }

  private onProgress(raw: Extract<WorkerResponse, { type: "progress" }>) {
    this.armStall();
    // WebLLM reports bytes only inside its progress text; transformers.js sends them as fields.
    const msg = raw.phase ? raw : (parseWebLlmProgress(raw.progress, raw.text) as typeof raw);
    let install: InstallInfo | undefined;
    if (msg.loadedBytes !== undefined && msg.phase) {
      const now = performance.now();
      let speed = this.state.install?.speed;
      const s = this.speedSample;
      if (msg.phase === "fetch" && s && msg.loadedBytes > s.bytes && now - s.at > 500) {
        const sample = ((msg.loadedBytes - s.bytes) * 1000) / (now - s.at);
        speed = speed ? speed * 0.7 + sample * 0.3 : sample;
      }
      if (!s || now - s.at > 500) this.speedSample = { at: now, bytes: msg.loadedBytes };
      const left = msg.totalBytes ? msg.totalBytes - msg.loadedBytes : undefined;
      install = {
        phase: msg.phase,
        loadedBytes: msg.loadedBytes,
        totalBytes: msg.totalBytes,
        speed: msg.phase === "fetch" ? speed : undefined,
        eta: msg.phase === "fetch" && speed && left !== undefined ? (left / speed) * 1000 : undefined,
      };
      void this.checkQuota(install);
    }
    this.set({ progress: msg.progress, progressText: msg.text, install, retryAt: undefined });
  }

  private handle(msg: WorkerResponse) {
    switch (msg.type) {
      case "progress":
        if (this.state.status === "loading") this.onProgress(msg);
        break;
      case "ready":
        this.clearTimers();
        writePending(null);
        this.set({ status: "ready", progress: 1, backend: msg.backend, model: msg.model, error: undefined, errorKind: undefined, install: undefined, retryAt: undefined });
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
          this.loadFailed(msg.message);
        }
        break;
    }
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private attemptLoad() {
    const { backend, model } = this.state;
    if (!backend || !model) return;
    this.clearTimers();
    this.quotaChecked = false;
    this.speedSample = undefined;
    this.set({ status: "loading", attempt: this.state.attempt + 1, retryAt: undefined });
    this.armStall();
    const s = getSettings();
    this.send({ type: "load", backend, model, contextTokens: s.contextTokens, dtype: s.cpuDtype });
  }

  load(backend: Backend, model: string) {
    writePending({ backend, model });
    this.set({ progress: 0, progressText: "", backend, model, error: undefined, errorKind: undefined, install: undefined, attempt: 0 });
    this.attemptLoad();
  }

  /** Continues a paused or failed download; stored shards are not fetched again. */
  resume() {
    const p = readPending() ?? (this.state.backend && this.state.model ? { backend: this.state.backend, model: this.state.model } : null);
    if (p) this.load(p.backend, p.model);
  }

  /** Stops a download but keeps what was fetched, so `resume()` picks it up later. */
  pause() {
    if (this.state.status !== "loading") return;
    this.clearTimers();
    this.restart(new Error("paused"));
    this.set({ status: "paused", retryAt: undefined, install: this.state.install && { ...this.state.install, speed: undefined, eta: undefined } });
  }

  /** Retries a scheduled download immediately (e.g. when the connection comes back). */
  retryNow() {
    if (this.state.status === "loading" && this.state.retryAt) this.attemptLoad();
  }

  /** Forgets a paused download. Fetched shards stay cached until the user deletes the model. */
  cancelInstall() {
    if (this.state.status === "loading") this.restart(new Error("cancelled"));
    this.clearTimers();
    writePending(null);
    this.set({ status: "idle", progress: 0, progressText: "", install: undefined, retryAt: undefined, error: undefined, errorKind: undefined, model: undefined });
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
