import { afterEach, expect, test, vi } from "vitest";
import { chatModels, cloudGenerate, CloudError, listModels, PROVIDERS, type ResolvedProvider } from "./cloud";

const def = (id: string) => PROVIDERS.find((p) => p.id === id)!;
const prov = (id: string, model = "m"): ResolvedProvider => ({
  def: def(id),
  apiKey: "key-123456",
  model,
  baseUrl: def(id).baseUrl,
  endpoint: def(id).baseUrl,
  proxyHeaders: {},
  maxTokens: 512,
});
const sse = (events: object[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });

afterEach(() => vi.unstubAllGlobals());

test("chatModels drops embedding/speech/image models and dedupes", () => {
  expect(chatModels(["gpt-x", "text-embedding-3", "whisper-1", "dall-e-3", "gpt-x", "tts-1", "llama-guard-3"])).toEqual(["gpt-x"]);
});

test("Gemini lists only generateContent models, key in the query string", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({
      models: [
        { name: "models/gemini-pro-x", supportedGenerationMethods: ["generateContent"] },
        { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  expect(await listModels(prov("gemini"))).toEqual(["gemini-pro-x"]);
  expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("key=key-123456");
});

test("Gemini streams text from the native SSE endpoint", async () => {
  const fetchMock = vi.fn(async () => sse([{ candidates: [{ content: { parts: [{ text: "مرحبا " }] } }] }, { candidates: [{ content: { parts: [{ text: "بك" }] } }] }]));
  vi.stubGlobal("fetch", fetchMock);
  const tokens: string[] = [];
  const out = await cloudGenerate(prov("gemini", "models/gemini-pro-x"), [{ role: "system", content: "s" }, { role: "user", content: "u" }], {
    temperature: 0.3, topP: 0.9, effort: "low", signal: new AbortController().signal, onToken: (d) => tokens.push(d),
  });
  expect(out).toBe("مرحبا بك");
  expect(tokens).toHaveLength(2);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain("/models/gemini-pro-x:streamGenerateContent?alt=sse");
  expect(JSON.parse(String(init.body)).systemInstruction.parts[0].text).toBe("s");
});

test("OpenAI-compatible streaming and the reasoning-model retry", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response('{"error":{"message":"Unsupported parameter: temperature"}}', { status: 400 }))
    .mockResolvedValueOnce(sse([{ choices: [{ delta: { content: "ok" } }] }]));
  vi.stubGlobal("fetch", fetchMock);
  const out = await cloudGenerate(prov("openai"), [{ role: "user", content: "u" }], { temperature: 0.3, topP: 0.9, effort: "low", signal: new AbortController().signal, onToken: () => {} });
  expect(out).toBe("ok");
  expect(JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body))).not.toHaveProperty("temperature");
});

test("auth failures and CORS blocks are classified for the UI", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("bad key", { status: 401 })));
  await expect(listModels(prov("openai"))).rejects.toMatchObject({ code: "auth" });
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  await expect(listModels(prov("groq"))).rejects.toBeInstanceOf(CloudError);
  await expect(listModels(prov("groq"))).rejects.toMatchObject({ code: "cors" });
});

test("providers without a model list fall back to their catalog models", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
  expect(await listModels(prov("perplexity"))).toEqual(def("perplexity").fallbackModels);
});
