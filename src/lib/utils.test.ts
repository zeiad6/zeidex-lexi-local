import { expect, test, vi } from "vitest";
import { perFrame } from "./utils";

test("perFrame renders the latest value once per frame, and cancel drops a late frame", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => (frames[id - 1] = () => {}));
  const seen: string[] = [];
  const push = perFrame((v: string) => seen.push(v));
  push("a");
  push("ab");
  push("abc");
  expect(frames).toHaveLength(1);
  frames[0](0);
  expect(seen).toEqual(["abc"]);
  push("abcd");
  push.cancel();
  frames[1](0);
  expect(seen).toEqual(["abc"]);
  vi.unstubAllGlobals();
});
