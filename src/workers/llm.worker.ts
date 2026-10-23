/// <reference lib="webworker" />
// All inference runs here so the UI thread never blocks on WebGPU/WASM work.
import type { MLCEngine } from "@mlc-ai/web-llm";
import type { TextGenerationPipeline, InterruptableStoppingCriteria } from "@huggingface/transformers";
import { ENGINE_GONE, type WorkerRequest, type WorkerResponse } from "./protocol";
// Bundled ONNX Runtime files: Transformers.js would otherwise fetch them from a CDN, breaking offline use.
import ortWasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import ortMjs from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";

declare const self: DedicatedWorkerGlobalScope;

let webgpuEngine: MLCEngine | null = null;
let cpuPipeline: TextGenerationPipeline | null = null;
let cpuStopper: InterruptableStoppingCriteria | null = null;
let modelId = "";
let lastLoad: Extract<WorkerRequest, { type: "load" }> | null = null;

const post = (msg: WorkerResponse) => self.postMessage(msg);
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function unload() {
  // A lost device leaves an engine whose unload() itself can throw; it must not block a reload.
  await webgpuEngine?.unload().catch(() => undefined);
  await cpuPipeline?.dispose().catch(() => undefined);
  webgpuEngine = null;
  cpuPipeline = null;
  modelId = "";
}

async function load(req: Extract<WorkerRequest, { type: "load" }>) {
  await unload();
  if (req.backend === "webgpu") await loadWebGpu(req.model, req.contextTokens);
  else await loadCpu(req.model, req.dtype);
  modelId = req.model;
  lastLoad = req;
  post({ type: "ready", backend: req.backend, model: req.model });
}

/** Runs a request; if the engine died underneath it, reloads the same model from cache and retries once. */
async function generateWithRecovery(req: Extract<WorkerRequest, { type: "generate" }>) {
  try {
    await generate(req);
    return;
  } catch (err) {
    if (!lastLoad || !ENGINE_GONE.test(errorMessage(err))) throw err;
    post({ type: "reloading", id: req.id, reason: errorMessage(err) });
  }
  try {
    await load(lastLoad);
    await generate(req);
  } catch (err) {
    // Reload or retry failed too: report an engine-level error so the UI stops showing "Ready"/"Loading".
    await unload();
    lastLoad = null;
    post({ type: "error", message: errorMessage(err) });
    throw err;
  }
}

async function loadWebGpu(model: string, contextTokens: number) {
  const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
  // WebLLM stores every weight shard in Cache Storage as soon as it arrives and skips stored shards on
  // the next load, so an interrupted download resumes from the last finished shard.
  webgpuEngine = await CreateMLCEngine(
    model,
    { initProgressCallback: (r) => post({ type: "progress", progress: r.progress, text: r.text }) },
    // A larger window costs KV-cache VRAM; the user can raise it in Settings when the GPU allows.
    { context_window_size: contextTokens },
  );
}

async function loadCpu(model: string, dtype: string) {
  const { pipeline, env } = await import("@huggingface/transformers");
  if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = { wasm: ortWasm, mjs: ortMjs };
  cpuPipeline = (await pipeline("text-generation", model, {
    device: "wasm",
    dtype: dtype as "q4",
    progress_callback: (p) => {
      // shortcut: transformers.js caches whole files, so an interrupted CPU download restarts the current file.
      if (p.status === "progress_total")
        post({ type: "progress", progress: p.progress / 100, text: p.name, phase: "fetch", loadedBytes: p.loaded, totalBytes: p.total });
    },
  })) as TextGenerationPipeline;
}

// Cache checks live here too, so the 6 MB WebLLM bundle is only ever loaded inside the worker.
async function cacheOp(req: Extract<WorkerRequest, { type: "cache" }>): Promise<Record<string, boolean>> {
  if (req.backend === "webgpu") {
    const { hasModelInCache, deleteModelAllInfoInCache } = await import("@mlc-ai/web-llm");
    if (req.op === "delete") await Promise.all(req.models.map((m) => deleteModelAllInfoInCache(m)));
    const entries = await Promise.all(req.models.map(async (m) => [m, await hasModelInCache(m).catch(() => false)]));
    return Object.fromEntries(entries);
  }
  const cache = await caches.open("transformers-cache");
  const owned = (url: string, m: string) => url.includes(`/${m}/`);
  if (req.op === "delete") {
    const keys = await cache.keys();
    await Promise.all(keys.filter((r) => req.models.some((m) => owned(r.url, m))).map((r) => cache.delete(r)));
  }
  const keys = await cache.keys();
  return Object.fromEntries(req.models.map((m) => [m, keys.some((r) => owned(r.url, m))]));
}

async function generate(req: Extract<WorkerRequest, { type: "generate" }>) {
  let text = "";
  let aborted = false;
  let tokens = 0;
  let firstAt = 0;
  const emit = (delta: string) => {
    if (!delta) return;
    // Decode speed is measured from the first token, so prefill time does not skew tokens/s.
    if (!tokens++) firstAt = performance.now();
    text += delta;
    post({ type: "token", id: req.id, delta });
  };

  if (webgpuEngine) {
    const stream = await webgpuEngine.chat.completions.create({
      messages: req.messages,
      stream: true,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      top_p: req.topP,
      frequency_penalty: req.frequencyPenalty,
      ...(req.jsonSchema && { response_format: { type: "json_object", schema: JSON.stringify(req.jsonSchema) } }),
      // Qwen3 "thinking" would spend the whole token budget on hidden reasoning.
      ...(modelId.startsWith("Qwen3") && { extra_body: { enable_thinking: false } }),
    });
    for await (const chunk of stream) {
      emit(chunk.choices[0]?.delta?.content ?? "");
      if (chunk.choices[0]?.finish_reason === "abort") aborted = true;
    }
  } else if (cpuPipeline) {
    const { TextStreamer, InterruptableStoppingCriteria } = await import("@huggingface/transformers");
    cpuStopper = new InterruptableStoppingCriteria();
    const streamer = new TextStreamer(cpuPipeline.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: emit,
    });
    await cpuPipeline(req.messages, {
      max_new_tokens: req.maxTokens,
      do_sample: false,
      repetition_penalty: 1.1,
      streamer,
      stopping_criteria: cpuStopper,
    });
    aborted = cpuStopper.interrupted;
    cpuStopper = null;
  } else {
    throw new Error("Model not loaded before trying to generate");
  }
  post({ type: "done", id: req.id, text, aborted, tokens, ms: tokens ? performance.now() - firstAt : 0 });
}

const interrupt = () => {
  webgpuEngine?.interruptGenerate();
  cpuStopper?.interrupt();
};

// Requests run one at a time: an unload/load arriving mid-generation used to destroy the GPU device while
// a token readback was pending ("mapAsync ... unmapped before mapping was resolved").
let chain: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  // Abort must reach the running generation, so it skips the queue; unload/load stop it too.
  if (req.type === "abort" || req.type === "unload" || req.type === "load") interrupt();
  if (req.type === "abort") return;
  chain = chain.then(() => handle(req));
  return chain;
};

async function handle(req: Exclude<WorkerRequest, { type: "abort" }>) {
  try {
    switch (req.type) {
      case "load":
        await load(req);
        break;
      case "generate":
        await generateWithRecovery(req);
        break;
      case "unload":
        await unload();
        lastLoad = null;
        break;
      case "cache":
        post({ type: "cache", id: req.id, cached: await cacheOp(req) });
        break;
    }
  } catch (err) {
    const id = req.type === "generate" || req.type === "cache" ? req.id : undefined;
    post({ type: "error", id, message: errorMessage(err) });
  }
}
