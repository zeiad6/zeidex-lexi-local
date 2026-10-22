import { expect, test } from "vitest";
import { createBridgeFetch, toBase64, type HttpEvent } from "./native";

function fakeBridge(script: (id: string, emit: (ev: HttpEvent) => void, req: { method: string; url: string; headers: Record<string, string>; body: string }) => void) {
  let cb: (id: string, ev: HttpEvent) => void = () => {};
  const aborted: string[] = [];
  const f = createBridgeFetch(
    {
      httpStart: (id, method, url, headersJson, body) => setTimeout(() => script(id, (ev) => cb(id, ev), { method, url, headers: JSON.parse(headersJson), body }), 0),
      httpAbort: (id) => aborted.push(id),
    },
    (c) => (cb = c),
  );
  return { f, aborted };
}

test("bridge fetch streams chunks and passes method, headers and body", async () => {
  let seen: { method: string; url: string; headers: Record<string, string>; body: string } | undefined;
  const { f } = fakeBridge((_, emit, req) => {
    seen = req;
    emit({ type: "head", status: 200, headers: { "content-type": "text/event-stream" } });
    emit({ type: "chunk", data: toBase64(new TextEncoder().encode("data: a\n\n")) });
    emit({ type: "chunk", data: toBase64(new TextEncoder().encode("data: b\n\n")) });
    emit({ type: "end" });
  });
  const res = await f("https://api.example/v1/x", { method: "POST", headers: { Authorization: "Bearer k" }, body: '{"q":1}' });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("data: a\n\ndata: b\n\n");
  expect(seen).toMatchObject({ method: "POST", url: "https://api.example/v1/x", headers: { authorization: "Bearer k" } });
  expect(atob(seen!.body)).toBe('{"q":1}');
});

test("bridge fetch rejects on a network error before headers", async () => {
  const { f } = fakeBridge((_, emit) => emit({ type: "error", message: "unreachable" }));
  await expect(f("https://x")).rejects.toThrow("unreachable");
});

test("abort tells the native side to stop", async () => {
  const { f, aborted } = fakeBridge(() => {});
  const c = new AbortController();
  const p = f("https://x", { signal: c.signal });
  await new Promise((r) => setTimeout(r, 5));
  c.abort();
  await expect(p).rejects.toThrow(/abort/i);
  expect(aborted).toHaveLength(1);
});
