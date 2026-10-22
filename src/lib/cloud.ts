// Cloud generation: the Anthropic SDK for Claude, Google's native API for Gemini, and a streaming
// fetch client for every OpenAI-compatible API (OpenAI, OpenRouter, Groq, Mistral, Ollama, ...).
import catalog from "@/providers.json";
import { nativeFetch } from "./native";
import type { ChatMessage } from "./prompts";
import type { ProviderConfig, Settings } from "./settings";

export interface ProviderDef {
  id: string;
  name: string;
  kind: "anthropic" | "openai" | "gemini";
  baseUrl: string;
  needsKey: boolean;
  defaultModel: string;
  keyUrl: string;
  /** For providers without a model-list endpoint. */
  fallbackModels?: string[];
}

export const PROVIDERS = catalog.providers as ProviderDef[];

export interface ResolvedProvider extends ProviderConfig {
  def: ProviderDef;
  /** Base URL actually requested: the provider's own, or the local proxy route. */
  endpoint: string;
  /** Tells the proxy which upstream to use when the user overrode the base URL. */
  proxyHeaders: Record<string, string>;
}

export type Effort = "low" | "medium" | "high";

/** Where requests go. Android's native HTTP has no CORS limits, so it never needs the proxy. */
export function resolveEndpoint(s: Pick<Settings, "useProxy">, def: ProviderDef, cfg?: Partial<ProviderConfig>) {
  const baseUrl = cfg?.baseUrl || def.baseUrl;
  const proxied = s.useProxy && !nativeFetch;
  return {
    baseUrl,
    endpoint: proxied ? `${location.origin}/api/proxy/${def.id}` : baseUrl,
    proxyHeaders: (proxied && cfg?.baseUrl ? { "x-lexi-base-url": cfg.baseUrl } : {}) as Record<string, string>,
  };
}

/** Merges the user's saved config over the catalog defaults; null when the provider is unusable. */
export function resolveProvider(s: Settings, id = s.activeProvider): ResolvedProvider | null {
  const def = PROVIDERS.find((p) => p.id === id);
  if (!def) return null;
  const cfg = s.providers[id];
  const model = cfg?.model || def.defaultModel;
  const apiKey = cfg?.apiKey ?? "";
  const ep = resolveEndpoint(s, def, cfg);
  if (!ep.baseUrl || !model || (def.needsKey && !apiKey)) return null;
  return { def, apiKey, model, ...ep, maxTokens: cfg?.maxTokens ?? (def.kind === "anthropic" ? 16000 : 4096) };
}

export type CloudErrorCode = "auth" | "cors" | "http" | "refusal";

export class CloudError extends Error {
  constructor(
    message: string,
    public code: CloudErrorCode = "http",
    public status?: number,
  ) {
    super(message);
  }
}

// On Android requests run natively (no CORS); elsewhere the browser fetch or the local proxy.
const http: typeof fetch = nativeFetch ?? ((...a) => fetch(...a));

async function statusError(res: Response, name: string): Promise<CloudError> {
  const detail = (await res.text().catch(() => "")).slice(0, 300);
  const auth = res.status === 401 || res.status === 403;
  return new CloudError(`${name}: HTTP ${res.status} ${detail}`, auth ? "auth" : "http", res.status);
}

/** Browsers report a CORS block as a bare network TypeError; classify it so the UI can say what helps. */
function explain(e: unknown, name: string): never {
  if (e instanceof DOMException && e.name === "AbortError") throw e;
  if (e instanceof CloudError) throw e;
  const status = (e as { status?: number })?.status; // Anthropic SDK APIError
  const msg = e instanceof Error ? e.message : String(e);
  if (status === 401 || status === 403) throw new CloudError(`${name}: ${msg}`, "auth", status);
  if (e instanceof TypeError || /Failed to fetch|NetworkError|Load failed|Connection error/i.test(msg)) {
    throw new CloudError(`${name}: network/CORS error`, "cors");
  }
  throw new CloudError(`${name}: ${msg}`, "http", status);
}

// Loaded on first use so Local-only users never download the SDK.
async function anthropicClient(p: Pick<ResolvedProvider, "apiKey" | "endpoint" | "proxyHeaders">) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic({ apiKey: p.apiKey, baseURL: p.endpoint, dangerouslyAllowBrowser: true, defaultHeaders: p.proxyHeaders, fetch: http, maxRetries: 1 });
}

const splitSystem = (messages: ChatMessage[]) => ({
  system: messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n"),
  turns: messages.filter((m) => m.role !== "system") as { role: "user" | "assistant"; content: string }[],
});

// Claude 5-generation models take `effort`; the server-side refusal fallback exists for these ids only.
const takesEffort = (model: string) => /^claude-(fable|mythos|opus|sonnet|haiku)-5/.test(model);
const takesFallback = (model: string) => /^claude-(fable-5|opus-5|sonnet-5-5)/.test(model);

async function anthropicGenerate(p: ResolvedProvider, messages: ChatMessage[], effort: Effort, signal: AbortSignal, onToken: (d: string) => void) {
  const client = await anthropicClient(p);
  const { system, turns } = splitSystem(messages);
  // No temperature/top_p: the Messages API rejects sampling parameters on current models.
  const stream = client.beta.messages.stream(
    {
      model: p.model,
      max_tokens: p.maxTokens,
      ...(system && { system }),
      messages: turns,
      ...(takesEffort(p.model) && { output_config: { effort } }),
      ...(takesFallback(p.model) && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
    },
    { signal },
  );
  stream.on("text", (delta) => onToken(delta));
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    throw new CloudError(`${p.def.name}: the model declined this request (${message.stop_details?.category ?? "policy"}).`, "refusal");
  }
  return message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

/** Incremental SSE reader: feed raw chunks, get back complete `data:` payloads. */
export function createSseParser() {
  let buffer = "";
  return (chunk: string): string[] => {
    buffer += chunk;
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    return events.flatMap((ev) =>
      ev
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .filter((d) => d && d !== "[DONE]"),
    );
  };
}

async function readSse(res: Response, pick: (json: unknown) => string, onToken: (d: string) => void) {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const parse = createSseParser();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const data of parse(value)) {
      let delta = "";
      try {
        delta = pick(JSON.parse(data));
      } catch {
        continue; // keep-alive comments and partial vendor extensions
      }
      if (delta) {
        text += delta;
        onToken(delta);
      }
    }
  }
  return text;
}

async function openaiGenerate(p: ResolvedProvider, messages: ChatMessage[], temperature: number, topP: number, signal: AbortSignal, onToken: (d: string) => void) {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...p.proxyHeaders };
  if (p.apiKey) headers.Authorization = `Bearer ${p.apiKey}`;
  if (p.def.id === "openrouter") headers["X-Title"] = "Zeidex Lexi Local";
  const send = (body: object) => http(`${p.endpoint}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal });

  let res = await send({ model: p.model, messages, stream: true, max_tokens: p.maxTokens, temperature, top_p: topP });
  if (res.status === 400) {
    // Reasoning models reject sampling params and max_tokens; retry once with the minimal portable body.
    const detail = await res.clone().text();
    if (!/temperature|top_p|max_tokens|unsupported/i.test(detail)) throw await statusError(res, p.def.name);
    res = await send({ model: p.model, messages, stream: true, max_completion_tokens: p.maxTokens });
  }
  if (!res.ok || !res.body) throw await statusError(res, p.def.name);
  return readSse(res, (j) => (j as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content ?? "", onToken);
}

const geminiModel = (id: string) => id.replace(/^models\//, "");

/** Gemini's native API: the key goes in the query string, which Google's CORS policy allows from browsers. */
async function geminiGenerate(p: ResolvedProvider, messages: ChatMessage[], temperature: number, topP: number, signal: AbortSignal, onToken: (d: string) => void) {
  const { system, turns } = splitSystem(messages);
  const url = `${p.endpoint}/models/${geminiModel(p.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(p.apiKey)}`;
  const res = await http(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...p.proxyHeaders },
    signal,
    body: JSON.stringify({
      ...(system && { systemInstruction: { parts: [{ text: system }] } }),
      contents: turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
      generationConfig: { temperature, topP, maxOutputTokens: p.maxTokens },
    }),
  });
  if (!res.ok || !res.body) throw await statusError(res, p.def.name);
  type Chunk = { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return readSse(res, (j) => ((j as Chunk).candidates?.[0]?.content?.parts ?? []).map((x) => x.text ?? "").join(""), onToken);
}

export async function cloudGenerate(
  p: ResolvedProvider,
  messages: ChatMessage[],
  opts: { temperature: number; topP: number; effort: Effort; signal: AbortSignal; onToken: (delta: string) => void },
): Promise<string> {
  try {
    if (p.def.kind === "anthropic") return await anthropicGenerate(p, messages, opts.effort, opts.signal, opts.onToken);
    if (p.def.kind === "gemini") return await geminiGenerate(p, messages, opts.temperature, opts.topP, opts.signal, opts.onToken);
    return await openaiGenerate(p, messages, opts.temperature, opts.topP, opts.signal, opts.onToken);
  } catch (e) {
    if (opts.signal.aborted && !(e instanceof CloudError)) throw new DOMException("aborted", "AbortError");
    explain(e, p.def.name);
  }
}

// Model-list endpoints return embeddings, speech, image and moderation models too; none can chat.
const NOT_CHAT = /embed|whisper|tts|transcri|dall-?e|image|imagen|veo|audio|speech|moderation|rerank|realtime|search-preview|computer-use|davinci|babbage|clip|guard|aqa|bison|gecko/i;

export function chatModels(ids: string[]): string[] {
  return [...new Set(ids)].filter((id) => id && !NOT_CHAT.test(id)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Lists the chat models this key can use, so users pick a real one instead of typing a guess. */
export async function listModels(p: Pick<ResolvedProvider, "def" | "apiKey" | "endpoint" | "proxyHeaders">): Promise<string[]> {
  try {
    if (p.def.kind === "anthropic") {
      const client = await anthropicClient(p);
      const ids: string[] = [];
      for await (const m of client.models.list()) ids.push(m.id);
      return chatModels(ids);
    }
    if (p.def.kind === "gemini") {
      const res = await http(`${p.endpoint}/models?pageSize=1000&key=${encodeURIComponent(p.apiKey)}`, { headers: p.proxyHeaders });
      if (!res.ok) throw await statusError(res, p.def.name);
      type M = { name: string; supportedGenerationMethods?: string[] };
      const json = (await res.json()) as { models?: M[] };
      return chatModels((json.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => geminiModel(m.name)));
    }
    const res = await http(`${p.endpoint}/models`, { headers: { ...p.proxyHeaders, ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}) } });
    if (res.status === 404 && p.def.fallbackModels) return p.def.fallbackModels;
    if (!res.ok) throw await statusError(res, p.def.name);
    const json = await res.json();
    return chatModels(((json.data ?? json.models ?? []) as { id?: string; name?: string }[]).map((m) => m.id ?? m.name ?? ""));
  } catch (e) {
    explain(e, p.def.name);
  }
}
