// Cloud generation: the Anthropic SDK for Claude, a streaming fetch client for every
// OpenAI-compatible API (OpenAI, Gemini, OpenRouter, Groq, Mistral, Ollama, ...).
import catalog from "@/providers.json";
import type { ChatMessage } from "./prompts";
import type { ProviderConfig, Settings } from "./settings";

export interface ProviderDef {
  id: string;
  name: string;
  kind: "anthropic" | "openai";
  baseUrl: string;
  needsKey: boolean;
  defaultModel: string;
  keyUrl: string;
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

/** Merges the user's saved config over the catalog defaults; null when the provider is unusable. */
export function resolveProvider(s: Settings, id = s.activeProvider): ResolvedProvider | null {
  const def = PROVIDERS.find((p) => p.id === id);
  if (!def) return null;
  const cfg = s.providers[id];
  const baseUrl = cfg?.baseUrl || def.baseUrl;
  const model = cfg?.model || def.defaultModel;
  const apiKey = cfg?.apiKey ?? "";
  if (!baseUrl || !model || (def.needsKey && !apiKey)) return null;
  const endpoint = s.useProxy ? `${location.origin}/api/proxy/${id}` : baseUrl;
  const proxyHeaders: Record<string, string> = s.useProxy && cfg?.baseUrl ? { "x-lexi-base-url": cfg.baseUrl } : {};
  return { def, apiKey, model, baseUrl, endpoint, proxyHeaders, maxTokens: cfg?.maxTokens ?? (def.kind === "anthropic" ? 16000 : 4096) };
}

export class CloudError extends Error {}

/** Browsers report a CORS block as a bare network TypeError; say what actually helps. */
function explain(e: unknown, p: ResolvedProvider): never {
  if (e instanceof DOMException && e.name === "AbortError") throw e;
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    throw new CloudError(
      `${p.def.name}: network/CORS error. Enable "Use local proxy" in Settings (desktop app, Docker or npm run serve), or check the base URL.`,
    );
  }
  throw new CloudError(`${p.def.name}: ${msg}`);
}

// Loaded on first use so Local-only users never download the SDK.
async function anthropicClient(p: Pick<ResolvedProvider, "apiKey" | "endpoint" | "proxyHeaders">) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic({ apiKey: p.apiKey, baseURL: p.endpoint, dangerouslyAllowBrowser: true, defaultHeaders: p.proxyHeaders });
}

const splitSystem = (messages: ChatMessage[]) => ({
  system: messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n"),
  turns: messages.filter((m) => m.role !== "system") as { role: "user" | "assistant"; content: string }[],
});

// Claude 5-generation models take `effort`; the server-side refusal fallback exists for these ids only.
const takesEffort = (model: string) => /^claude-(fable|mythos|opus|sonnet|haiku)-5/.test(model);
const takesFallback = (model: string) => /^claude-(fable-5|opus-5|sonnet-5-5)/.test(model);

async function anthropicGenerate(
  p: ResolvedProvider,
  messages: ChatMessage[],
  effort: Effort,
  signal: AbortSignal,
  onToken: (delta: string) => void,
): Promise<string> {
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
    throw new CloudError(`${p.def.name}: the model declined this request (${message.stop_details?.category ?? "policy"}).`);
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

async function openaiGenerate(
  p: ResolvedProvider,
  messages: ChatMessage[],
  temperature: number,
  topP: number,
  signal: AbortSignal,
  onToken: (delta: string) => void,
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...p.proxyHeaders };
  if (p.apiKey) headers.Authorization = `Bearer ${p.apiKey}`;
  if (p.def.id === "openrouter") headers["X-Title"] = "Zeidex Lexi Local";

  const send = (body: object) =>
    fetch(`${p.endpoint}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal });

  let res = await send({ model: p.model, messages, stream: true, max_tokens: p.maxTokens, temperature, top_p: topP });
  if (res.status === 400) {
    // Reasoning models reject sampling params and max_tokens; retry once with the minimal portable body.
    const detail = await res.text();
    if (!/temperature|top_p|max_tokens|unsupported/i.test(detail)) throw new CloudError(`${p.def.name}: ${detail.slice(0, 300)}`);
    res = await send({ model: p.model, messages, stream: true, max_completion_tokens: p.maxTokens });
  }
  if (!res.ok || !res.body) throw new CloudError(`${p.def.name}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const parse = createSseParser();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const data of parse(value)) {
      let delta = "";
      try {
        delta = JSON.parse(data).choices?.[0]?.delta?.content ?? "";
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

export async function cloudGenerate(
  p: ResolvedProvider,
  messages: ChatMessage[],
  opts: { temperature: number; topP: number; effort: Effort; signal: AbortSignal; onToken: (delta: string) => void },
): Promise<string> {
  try {
    return p.def.kind === "anthropic"
      ? await anthropicGenerate(p, messages, opts.effort, opts.signal, opts.onToken)
      : await openaiGenerate(p, messages, opts.temperature, opts.topP, opts.signal, opts.onToken);
  } catch (e) {
    if (e instanceof CloudError) throw e;
    if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");
    explain(e, p);
  }
}

/** Lists model ids so users pick a real one instead of typing a guess. */
export async function listModels(p: Omit<ResolvedProvider, "model"> & { model?: string }): Promise<string[]> {
  try {
    if (p.def.kind === "anthropic") {
      const client = await anthropicClient(p);
      const ids: string[] = [];
      for await (const m of client.models.list()) ids.push(m.id);
      return ids;
    }
    const res = await fetch(`${p.endpoint}/models`, { headers: { ...p.proxyHeaders, ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}) } });
    if (!res.ok) throw new CloudError(`HTTP ${res.status}`);
    const json = await res.json();
    return ((json.data ?? json.models ?? []) as { id?: string; name?: string }[])
      .map((m) => m.id ?? m.name ?? "")
      .filter(Boolean)
      .sort();
  } catch (e) {
    if (e instanceof CloudError) throw e;
    explain(e, p as ResolvedProvider);
  }
}
