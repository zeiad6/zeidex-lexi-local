// One entry point for every model call. It decides local vs cloud per task (the execution mode),
// applies the user's runtime settings, guards against loops and records training pairs.
import { cloudGenerate, resolveProvider, type Effort } from "./cloud";
import { llm } from "./llm-client";
import { findLoop, isGibberish } from "./nlp";
import type { ChatMessage } from "./prompts";
import { getSettings, type ExecMode } from "./settings";

/** map/study/verify/ask read raw document text; merge/final/refine only see condensed notes. */
export type Task = "map" | "merge" | "final" | "refine" | "study" | "verify" | "ask";
export type Via = "local" | "cloud";

const READS_RAW_TEXT: Task[] = ["map", "study", "verify", "ask"];
const HEAVY: Task[] = ["merge", "final", "refine", "ask"];
const EFFORT: Record<Task, Effort> = { map: "low", merge: "low", verify: "low", study: "medium", final: "medium", refine: "medium", ask: "medium" };
// Below this decode speed the device is too slow for bulk work and the cloud is the better default.
const SLOW_LOCAL_TPS = 4;

export interface RouteContext {
  mode: ExecMode;
  localReady: boolean;
  cloudReady: boolean;
  online: boolean;
  localTps: number;
}

export class RouteError extends Error {}

/**
 * hybrid: raw text never leaves the device — the local model reads, the cloud model writes from its notes.
 * smart: picks per task by availability, connectivity and measured local speed.
 * `avoid` asks for the other engine (cross-model verification) when both are usable.
 */
export function route(task: Task, ctx: RouteContext, avoid?: Via): Via {
  const { mode, localReady, cloudReady } = ctx;
  const usable = (v: Via) => (v === "local" ? localReady : cloudReady && ctx.online);
  const pick = (v: Via): Via => {
    if (usable(v)) return v;
    throw new RouteError(v === "local" ? "local-not-ready" : "cloud-not-ready");
  };
  if (mode === "local") return pick("local");
  if (mode === "cloud") return pick("cloud");

  if (avoid && usable("local") && usable("cloud")) return avoid === "local" ? "cloud" : "local";
  if (mode === "hybrid") return pick(READS_RAW_TEXT.includes(task) ? "local" : "cloud");

  if (!usable("cloud")) return pick("local");
  if (!usable("local")) return "cloud";
  if (HEAVY.includes(task)) return "cloud";
  return ctx.localTps > 0 && ctx.localTps < SLOW_LOCAL_TPS ? "cloud" : "local";
}

export interface TrainingPair {
  task: Task;
  via: Via;
  model: string;
  messages: ChatMessage[];
  output: string;
}

export type Recorder = (pair: TrainingPair) => void;

export interface EngineOptions {
  maxTokens: number;
  temperature?: number;
  jsonSchema?: object;
  onToken?: (delta: string, full: string) => void;
  avoid?: Via;
  record?: Recorder;
}

export interface EngineResult {
  text: string;
  aborted: boolean;
  via: Via;
  model: string;
}

const cloudControllers = new Set<AbortController>();

export function cloudStatus() {
  const s = getSettings();
  const p = resolveProvider(s);
  return { ready: !!p, provider: p };
}

function withExtraInstructions(messages: ChatMessage[]): ChatMessage[] {
  const extra = getSettings().extraInstructions.trim();
  if (!extra) return messages;
  return messages.map((m, i) => (i === 0 && m.role === "system" ? { ...m, content: `${m.content}\n\nAdditional rules from the user:\n${extra}` } : m));
}

export async function generate(task: Task, rawMessages: ChatMessage[], opts: EngineOptions): Promise<EngineResult> {
  const s = getSettings();
  const provider = resolveProvider(s);
  const via = route(
    task,
    {
      mode: s.mode,
      localReady: llm.state.status === "ready",
      cloudReady: !!provider,
      online: typeof navigator === "undefined" || navigator.onLine !== false,
      localTps: llm.state.tps,
    },
    opts.avoid,
  );
  const messages = withExtraInstructions(rawMessages);
  const temperature = opts.temperature ?? s.temperature;
  let result: EngineResult;

  if (via === "local") {
    const r = await llm.generate(messages, {
      maxTokens: opts.maxTokens,
      temperature,
      jsonSchema: opts.jsonSchema,
      guard: s.loopGuard,
      onToken: opts.onToken,
    });
    // Token soup means the GPU computed the model wrongly (16-bit shaders on phone GPUs); passing it on
    // would turn a summary or quiz into garbage instead of telling the user how to fix it.
    if (!r.aborted && isGibberish(r.text)) throw new Error("local-garbage");
    result = { ...r, via, model: llm.state.model ?? "local" };
  } else {
    const p = provider!;
    const controller = new AbortController();
    cloudControllers.add(controller);
    let text = "";
    let cut = -1;
    try {
      await cloudGenerate(p, messages, {
        temperature,
        topP: s.topP,
        effort: EFFORT[task],
        signal: controller.signal,
        onToken: (delta) => {
          if (cut >= 0) return;
          text += delta;
          if (s.loopGuard && (cut = findLoop(text)) >= 0) return controller.abort();
          opts.onToken?.(delta, text);
        },
      });
      result = { text, aborted: false, via, model: p.model };
    } catch (e) {
      // Our own loop-guard abort is a successful, shortened answer; a user abort is not.
      if (cut >= 0) result = { text: text.slice(0, cut), aborted: false, via, model: p.model };
      else if (controller.signal.aborted) result = { text, aborted: true, via, model: p.model };
      else throw e;
    } finally {
      cloudControllers.delete(controller);
    }
  }

  if (opts.record && s.saveTrainingPairs && !result.aborted && result.text.trim()) {
    opts.record({ task, via, model: result.model, messages: rawMessages, output: result.text });
  }
  return result;
}

export function abortAll() {
  llm.abort();
  cloudControllers.forEach((c) => c.abort());
}
