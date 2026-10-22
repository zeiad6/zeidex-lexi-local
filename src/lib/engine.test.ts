import { expect, test, vi } from "vitest";

vi.mock("./llm-client", () => ({ llm: { state: { status: "idle", tps: 0 }, generate: vi.fn(), abort: vi.fn() } }));
const { route, RouteError } = await import("./engine");
const { createSseParser } = await import("./cloud");

const both = { mode: "smart" as const, localReady: true, cloudReady: true, online: true, localTps: 20 };

test("local and cloud modes are strict", () => {
  expect(route("map", { ...both, mode: "local" })).toBe("local");
  expect(route("map", { ...both, mode: "cloud" })).toBe("cloud");
  expect(() => route("map", { ...both, mode: "local", localReady: false })).toThrow(RouteError);
});

test("hybrid keeps raw document text on the device", () => {
  const ctx = { ...both, mode: "hybrid" as const };
  for (const t of ["map", "study", "verify", "ask"] as const) expect(route(t, ctx)).toBe("local");
  for (const t of ["merge", "final", "refine"] as const) expect(route(t, ctx)).toBe("cloud");
  expect(() => route("map", { ...ctx, localReady: false })).toThrow(RouteError);
});

test("smart routes by task, speed and availability", () => {
  expect(route("map", both)).toBe("local");
  expect(route("final", both)).toBe("cloud");
  expect(route("map", { ...both, localTps: 2 })).toBe("cloud");
  expect(route("final", { ...both, online: false })).toBe("local");
  expect(route("final", { ...both, cloudReady: false })).toBe("local");
  expect(route("map", { ...both, localReady: false })).toBe("cloud");
});

test("cross-model verification picks the other engine when both are usable", () => {
  expect(route("verify", both, "local")).toBe("cloud");
  expect(route("verify", both, "cloud")).toBe("local");
  expect(route("verify", { ...both, cloudReady: false }, "local")).toBe("local");
});

test("SSE parser handles split chunks, CRLF and [DONE]", () => {
  const parse = createSseParser();
  expect(parse('data: {"a":1}\n\ndata: {"b"')).toEqual(['{"a":1}']);
  expect(parse(':2}\r\n\r\ndata: [DONE]\n\n')).toEqual(['{"b":2}']);
});
