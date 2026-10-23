import { expect, test, vi } from "vitest";

// WebLLM drops its model when the GPU device is lost; the next request throws ModelNotLoadedError.
let creates = 0;
let failNext: string | false = false;
const events: string[] = [];
vi.mock("@mlc-ai/web-llm", () => ({
  CreateMLCEngine: vi.fn(async () => {
    creates++;
    return {
      unload: vi.fn(async () => {
        events.push("unload");
      }),
      interruptGenerate: vi.fn(() => events.push("interrupt")),
      chat: {
        completions: {
          create: vi.fn(async () => {
            if (failNext) {
              const message = failNext;
              failNext = false;
              throw new Error(message);
            }
            return (async function* () {
              yield { choices: [{ delta: { content: "hello" }, finish_reason: null }] };
              events.push("streamed");
              yield { choices: [{ delta: { content: " world" }, finish_reason: "stop" }] };
            })();
          }),
        },
      },
    };
  }),
}));

const posted: { type: string; [k: string]: unknown }[] = [];
const scope = { postMessage: (m: { type: string }) => posted.push(m), onmessage: null as null | ((e: { data: unknown }) => Promise<void>) };
vi.stubGlobal("self", scope);
await import("./llm.worker");
const send = (data: unknown) => scope.onmessage!({ data });

test("a model dropped by a lost GPU device is reloaded and the request retried", async () => {
  await send({ type: "load", backend: "webgpu", model: "Qwen3.5-0.8B-q4f16_1-MLC", contextTokens: 4096, dtype: "q4" });
  expect(posted.at(-1)).toMatchObject({ type: "ready" });
  failNext = "Model not loaded before trying to complete ChatCompletionRequest. Please ensure you have called MLCEngine.reload(model)";
  posted.length = 0;
  await send({ type: "generate", id: 7, messages: [{ role: "user", content: "hi" }], maxTokens: 10, temperature: 0, topP: 1, frequencyPenalty: 0 });
  expect(posted.map((m) => m.type)).toEqual(["reloading", "ready", "token", "token", "done"]);
  expect(posted.at(-1)).toMatchObject({ id: 7, text: "hello world", aborted: false });
  expect(creates).toBe(2);
});

test("a token readback cut off by a lost device is recovered", async () => {
  failNext = "Failed to execute 'mapAsync' on 'GPUBuffer': Buffer was unmapped before mapping was resolved.";
  posted.length = 0;
  await send({ type: "generate", id: 6, messages: [], maxTokens: 10, temperature: 0, topP: 1, frequencyPenalty: 0 });
  expect(posted.map((m) => m.type)).toEqual(["reloading", "ready", "token", "token", "done"]);
});

test("an unload sent mid-generation waits for it instead of destroying the device under it", async () => {
  events.length = 0;
  posted.length = 0;
  const running = send({ type: "generate", id: 5, messages: [], maxTokens: 10, temperature: 0, topP: 1, frequencyPenalty: 0 });
  const unloading = send({ type: "unload" });
  await Promise.all([running, unloading]);
  expect(events).toEqual(["interrupt", "streamed", "unload"]);
  expect(posted.at(-1)).toMatchObject({ type: "done", id: 5 });
  await send({ type: "load", backend: "webgpu", model: "Qwen3.5-0.8B-q4f16_1-MLC", contextTokens: 4096, dtype: "q4" });
});

test("other generation errors are not retried", async () => {
  posted.length = 0;
  await send({ type: "generate", id: 8, messages: [], maxTokens: 10, temperature: 0, topP: 1, frequencyPenalty: 0, jsonSchema: undefined });
  expect(posted.at(-1)).toMatchObject({ type: "done", id: 8 });
  await send({ type: "unload" });
  posted.length = 0;
  await send({ type: "generate", id: 9, messages: [], maxTokens: 10, temperature: 0, topP: 1, frequencyPenalty: 0 });
  // Unloaded on purpose: no automatic reload, just an error for that request.
  expect(posted).toEqual([{ type: "error", id: 9, message: "Model not loaded before trying to generate" }]);
});
